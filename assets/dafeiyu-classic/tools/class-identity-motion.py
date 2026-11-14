#!/usr/bin/env python3
"""Bounded continuous motion from one immutable, manually calibrated master.

Only the explicitly named small-motion actions and emotions are supported. Outfit pixels never
come from another drawing. Facial expressions sample registered existing source
drawings through a face-only mask. This is a small-motion 2D rig, not a skeleton
capable of lifting hidden arms through a large angle or reconstructing occlusion.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import math

import cv2
import numpy as np

_spec = importlib.util.spec_from_file_location('fixed_identity_shared', Path(__file__).with_name('identity-motion.py'))
shared = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(shared)

POLICY = 'class_fixed_master_bounded_continuous_motion_v2_click_joy'
EMOTION_POLICY = 'class_fixed_master_face_only_emotions_v1'
CLASSES = ('warrior', 'hunter', 'mage', 'rogue', 'paladin', 'warlock', 'priest', 'druid')
KEEP = ('待机呼吸休闲', '碎碎念-对屏碎碎念', '工作状态-雀跃庆祝')
JUMP = '开心蹦跳'
CLICK_JOY = '点击回应-开心跃动'
EMOTIONS = ('害怕', '害羞', '难过（眼睛饱含泪水）', '想去玩（期待星星眼）', '大哭')
EMOTION_CLASSES = CLASSES
W, H = 640, 360


def supports(task):
    return ((task.get('class') in EMOTION_CLASSES and task.get('name') in EMOTIONS) or
            (task.get('class') in CLASSES and task.get('name') in KEEP + (JUMP, CLICK_JOY)
            and not (task.get('class') == 'warrior' and task.get('name') == JUMP))
            )


def policy_for(task):
    return EMOTION_POLICY if task.get('name') in EMOTIONS else POLICY


def metadata_paths(source, task=None):
    source = Path(source)
    if task and task.get('name') in EMOTIONS:
        return [source / 'class-identity-motion.json', source / 'expressions/class-emotion-face-sources.json']
    return [source / 'class-identity-motion.json', source / 'expressions/class-face-sources.json']


def source_paths(task, source):
    if not supports(task):
        raise ValueError('Unsupported fixed-master action')
    root = Path(source)
    if task['name'] in EMOTIONS:
        return [root / 'base-keyframes' / task['class'] / 'frame-00.png',
                root / 'sheets' / task['class'] / 'emotions.png']
    # Includes the small registered face-source bank for reproducible provenance.
    return [root / 'base-keyframes' / task['class'] / f'frame-{i:02d}.png' for i in (0, 2, 6, 9, 10)]


def _polygon_weight(points, feather):
    mask = np.zeros((H, W), np.uint8)
    cv2.fillPoly(mask, [np.asarray(points, np.int32)], 255)
    if feather == 0:
        return mask.astype(np.float32) / 255
    distance = cv2.distanceTransform(255 - mask, cv2.DIST_L2, 5)
    # Keep antialiased metal edges and narrow tips inside the rigid core even
    # when a hand-labelled outline is a few source pixels too tight.
    return (1 - shared.smoothstep(8, 8+feather, distance)).astype(np.float32)


def _sample_continuous(field, x, y):
    """True bilinear weights; OpenCV's 1/32-map quantization jitters inverses."""
    ix = np.floor(x).astype(np.int32)
    iy = np.floor(y).astype(np.int32)
    fx, fy = x-ix, y-iy
    xx, yy = np.clip(ix,0,W-2), np.clip(iy,0,H-2)
    value = ((1-fx)*(1-fy)*field[yy,xx]+fx*(1-fy)*field[yy,xx+1]
             +(1-fx)*fy*field[yy+1,xx]+fx*fy*field[yy+1,xx+1])
    return np.where((ix>=0)&(ix<W-1)&(iy>=0)&(iy<H-1),value,0)


def registered_lower_face_map(spec):
    """Static registration correction below the eyes, never a larger face mask."""
    calibration=spec['lower_face_compression']
    anchor,ratio=calibration['from_y'],calibration['ratio']
    if not (140<=anchor<=180 and .5<=ratio<=1):
        raise ValueError('Invalid lower-face calibration')
    grid=np.stack(np.meshgrid(np.arange(W,dtype=np.float32),np.arange(H,dtype=np.float32)),axis=2)
    target=grid[...,1];q=target.copy()
    for _ in range(16):
        shift=(1-ratio)*np.maximum(0,q-anchor)*shared.smoothstep(anchor,anchor+8,q)
        q+=target-(q-shift)
    grid[...,1]=q
    return grid


class ClassIdentityMotion:
    def __init__(self, task, source, config, faces):
        self.task, self.config = dict(task), config
        self.class_id, self.name = task['class'], task['name']
        self.duration = 8 if self.name in EMOTIONS else {KEEP[0]: 4, KEEP[1]: 4, KEEP[2]: 10, JUMP: 8, CLICK_JOY: 10}[self.name]
        self.source = shared.read_rgba(Path(source) / config['master'])
        if self.source.shape != (H, W, 4):
            raise ValueError('Expected 640x360 RGBA master')
        if hashlib.sha256((Path(source) / config['master']).read_bytes()).hexdigest() != config['master_sha256']:
            raise ValueError('Manual rig calibration is stale: master hash changed')
        self.grid = np.stack(np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32)), axis=2)
        visible_y, visible_x = np.where(self.source[..., 3] > 0)
        self.maximum_lift = min(31., float(visible_y.min())-5.)
        # Solve only the possible sprite footprint. This changes no sampling
        # coordinates and leaves a generous margin for all bounded channels.
        self.roi = (max(0,int(visible_x.min())-18), 0,
                    min(W,int(visible_x.max())+19), min(H,int(visible_y.max())+20))
        x, y = self.grid[..., 0], self.grid[..., 1]
        protection = [shared.rect(x, y, *config['torso'], 18)]
        protection += [shared.rect(x, y, *r, 18) for r in config['shoulders']]
        protection += [_polygon_weight(p, 20) for p in config['weapons']]
        self.protection = np.maximum.reduce(protection).astype(np.float32)
        self.arm_weapon_fields={}
        for side,attachment in ((-1,'left_arm'),(1,'right_arm')):
            masks=[_polygon_weight(p,20) for p,a in zip(config['weapons'],config['weapon_attachments']) if a==attachment]
            self.arm_weapon_fields[side]=np.maximum.reduce(masks) if masks else None
        self.face_mask = self._face_mask(config['face_offset'])
        self.textures = {0: self._premul(self.source)}
        self.texture_rgba = {0: self.source}
        for idx, spec in faces.items():
            image_path = Path(source) / spec['path']
            if hashlib.sha256(image_path.read_bytes()).hexdigest() != spec['sha256']:
                raise ValueError('Registered face source changed')
            image = shared.read_rgba(image_path)
            if 'crop' in spec:
                x0,y0,x1,y1 = spec['crop']
                image = image[y0:y1,x0:x1]
            edit = cv2.warpAffine(image, np.asarray(spec['to_master_affine'], np.float32), (W, H), flags=cv2.INTER_LINEAR)
            expression_mask = self.face_mask
            if 'source_face_bottom' in spec:
                # The source drawing's collar/hands must not enter the face
                # even when an atlas head is smaller than the master head.
                source_mask = (np.indices(image.shape[:2])[0] <= spec['source_face_bottom']).astype(np.float32)
                aligned_mask = cv2.warpAffine(source_mask, np.asarray(spec['to_master_affine'],np.float32), (W,H),flags=cv2.INTER_LINEAR)
                expression_mask = self.face_mask*aligned_mask
            if 'lower_face_compression' in spec:
                lower_map=registered_lower_face_map(spec)
                edit=cv2.remap(edit,lower_map,None,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
                # Re-apply the immutable target mask after remapping the source
                # validity field; no displaced expression can touch the collar.
                expression_mask=self.face_mask*cv2.remap(aligned_mask,lower_map,None,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
            frame = shared.apply_face(self.source, edit, expression_mask, 1)
            changed = np.any(frame != self.source, axis=2)
            if np.any(changed[self.face_mask == 0]) or not np.array_equal(frame[..., 3], self.source[..., 3]):
                raise ValueError('Face-only expression escaped mask')
            self.texture_rgba[int(idx)] = frame
            self.textures[int(idx)] = self._premul(frame)
        self.diagnostics = {
            'policy': policy_for(task), 'coordinate_space': '640x360 master',
            'immutable_master': config['master'], 'master_sha256': config['master_sha256'],
            'fixed_parts': ['head ornaments', 'shoulder armor', 'chest armor', 'weapons and equipped objects'],
            'arm_pivots_and_forearm_ends': config['arms'],
            'maximum_forearm_angle_degrees': config['arm_angle_degrees'],
            'maximum_lift_pixels': self.maximum_lift,
            'action_choreography': ('three_click_response_hops_10_seconds' if self.name==CLICK_JOY else self.name),
            'weapon_protection_polygons': config['weapons'],
            'weapon_core_margin_pixels': 8,
            'weapon_attachments': config['weapon_attachments'],
            'expression_outside_face_changed_pixels': 0, 'expression_alpha_unchanged': True,
            'limits': ['Bounded continuous forearm cheer; not a high-V arm raise.',
                       'One source texture with mild hair/leg deformation; no 3D reconstruction.',
                       'Numeric invariants do not replace rendered-frame visual review.'],
        }
        if self.name in EMOTIONS:
            self.diagnostics.update({
                'action_choreography': ('frightened_tremble', 'shy_inward_forearms_and_head_dip',
                                       'watery_eyes_slow_slump', 'star_pupils_anticipatory_lean',
                                       'closed_eyes_tear_streams_and_sobbing_shudder')[EMOTIONS.index(self.name)],
                'expression_source': faces[str(100+EMOTIONS.index(self.name))],
                'face_transition': 'short face-only dissolve; facial transition is separately reviewed, not a joint interpolation',
                'max_head_dip_pixels': 3.2,
            })

    @staticmethod
    def _premul(rgba):
        a = rgba.astype(np.float32) / 255
        a[..., :3] *= a[..., 3:4]
        return a

    def _face_mask(self, offset):
        polygon = np.asarray([[283,159],[292,150],[299,142],[304,142],[307,153],
                              [314,164],[321,170],[330,172],[335,171],[331,162],
                              [337,150],[342,141],[348,147],[357,153],[366,157],
                              [368,168],[364,180],[354,187],[340,191],[324,194],
                              [308,191],[295,186],[287,177]], np.int32)
        polygon += np.asarray(offset, np.int32)
        mask = np.zeros((H, W), np.uint8)
        cv2.fillPoly(mask, [polygon], 255)
        distance = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
        mask = shared.smoothstep(0, 1.5, distance).astype(np.float32)
        mask *= self.source[..., 3].astype(np.float32) / 255
        if np.any(mask[198:]):
            raise ValueError('Facial mask overlaps equipment')
        return mask

    def channels(self, t):
        if self.name in EMOTIONS:
            envelope = float(shared.smoothstep(.15,.65,t)*(1-shared.smoothstep(7.1,7.65,t)))
            c = dict(crouch=0.,lift=0.,arms=0.,tuck=0.,sway=0.,tilt=0.,head_dip=0.)
            if self.name==EMOTIONS[0]:
                tremble=math.sin(2*math.pi*4.5*t)
                c.update(crouch=1.2+.22*tremble,arms=.5+.08*tremble,
                         sway=.35*tremble,tilt=.004*tremble,head_dip=.8)
            elif self.name==EMOTIONS[1]:
                c.update(crouch=1.2,arms=-.45,head_dip=3.2,
                         tilt=.007*math.sin(math.pi*t/6),sway=.25*math.sin(math.pi*t/3))
            elif self.name==EMOTIONS[2]:
                c.update(crouch=2.2+.18*math.sin(math.pi*t/2),arms=-.12,
                         head_dip=2.6,tilt=-.004*math.sin(math.pi*t/8))
            elif self.name==EMOTIONS[3]:
                eager=math.sin(2*math.pi*t/1.6)
                c.update(crouch=-1.1-.4*eager,arms=.35+.08*eager,
                         head_dip=-1.0,tilt=.003*eager,sway=.25*eager)
            else:
                sob=math.sin(2*math.pi*2.75*t)
                c.update(crouch=1.7+.7*sob,arms=-.2+.06*sob,
                         head_dip=2.1-.45*sob,tilt=.0018*math.sin(2*math.pi*2*t))
            return {key:value*envelope for key,value in c.items()}
        if self.name == CLICK_JOY:
            # Preserve this original action's 10-second contract and three
            # response beats. It is not a slowed or renamed 8-second jump.
            c = dict(crouch=0.,lift=0.,arms=0.,tuck=0.,sway=0.,tilt=0.)
            for start,end in ((.65,1.65),(3.35,3.95),(5.65,6.25),(7.95,8.55)):
                c['crouch'] += 5*shared.pulse(t,start,end)
            for start,end in ((1.65,3.35),(3.95,5.65),(6.25,7.95)):
                airborne=shared.pulse(t,start,end)
                c['lift'] += .9*self.maximum_lift*airborne
                c['tuck'] += .8*airborne
                c['sway'] += .7*math.sin(2*math.pi*(t-start)/(end-start))*airborne
                c['tilt'] += .004*math.sin(2*math.pi*(t-start)/(end-start))*airborne
            c['arms']=float(shared.smoothstep(.65,1.05,t)*(1-shared.smoothstep(8.1,8.7,t)))
            return c
        if self.name == JUMP:
            c = shared.FixedIdentityJump.channels(t)
            c['lift'] *= self.maximum_lift / 31.
            return c
        c = dict(crouch=0., lift=0., arms=0., tuck=0., sway=0., tilt=0.)
        if self.name == KEEP[2]:
            c['arms'] = float(shared.smoothstep(.65, 1., t) * (1-shared.smoothstep(6.9, 7.6, t)))
            for start in (1.6, 3.45, 5.3):
                c['crouch'] += 3 * shared.pulse(t, start-.3, start)
                c['lift'] += 10 * shared.pulse(t, start, start+.85)
                c['tuck'] += .5 * shared.pulse(t, start, start+.85)
                c['sway'] += .8 * math.sin((t-start)*math.pi*2) * shared.pulse(t,start-.3,start+1.2)
            return c
        envelope = float(shared.smoothstep(.05, .35, t) * (1-shared.smoothstep(self.duration-.35, self.duration-.05, t)))
        # A torso/neck breathing deformation with planted feet, not a whole-image bob.
        c['crouch'] = -.65 * math.sin(math.pi*t/2)**2 * envelope
        c['sway'] = .4 * math.sin(math.pi*t) * envelope
        if self.name == KEEP[1]:
            c['arms'] = .28 * shared.pulse(t, .25, 3.75)
        return c

    def expression(self, t):
        if self.name in EMOTIONS:
            return 100+EMOTIONS.index(self.name),float(shared.smoothstep(.2,.4,t)*(1-shared.smoothstep(7.4,7.6,t)))
        if self.name == CLICK_JOY:
            return 10,float(shared.smoothstep(.45,.7,t)*(1-shared.smoothstep(8.7,9.,t)))
        if self.name == JUMP:
            return 10, shared.WarriorHappyJump.expression_weight(t)
        if self.name == KEEP[2]:
            if t < 1.6:
                return 9, float(shared.smoothstep(.65,.9,t)*(1-shared.smoothstep(1.4,1.6,t)))
            return 10, float(shared.smoothstep(1.6,1.8,t)*(1-shared.smoothstep(7.,7.6,t)))
        if self.name == KEEP[0]:
            return 2, max(shared.pulse(t,.85,1.2), shared.pulse(t,2.6,2.95))
        # Registered mouth opening. Eyelids and eyebrows are deliberately unchanged.
        weight = sum(shared.pulse(t, s, s+.3) for s in np.arange(.25,3.55,.43))
        return 6, min(1., weight)

    def forward(self, points, t):
        c = self.channels(t)
        x,y = points[...,0],points[...,1]
        protected = _sample_continuous(self.protection, x, y)
        foot = self.config['foot_y']
        upper = 1-shared.smoothstep(foot-36,foot,y)
        dx = np.zeros_like(x)
        dy = c['crouch'] * np.maximum(upper,protected)
        if self.name in EMOTIONS:
            # This bounded head/neck deformation is continuous and cannot pull
            # shoulder metal or a quiver along with the head. Equipment remains
            # in its original rigid torso/forearm attachment fields.
            head = 1-shared.smoothstep(168+self.config['face_offset'][1],
                                      195+self.config['face_offset'][1],y)
            dy += c['head_dip']*head*(1-protected)
        legs = shared.rect(x,y,*self.config['leg_rect'],8)
        dx += 1.3*c['tuck']*np.tanh((x-322)/8)*legs*(1-protected)
        dy -= 1.3*c['tuck']*legs*(1-protected)
        outer = 1-shared.rect(x,y,281,0,367,360,12)
        hair = outer*shared.smoothstep(140,215,y)*(1-protected)
        dx += c['sway']*hair
        dy += .5*c['tuck']*hair
        for side,arm in zip((-1,1),self.config['arms']):
            ax,ay,bx,by=arm
            weight=shared.capsule(x,y,ax,ay,bx,by,5,24)
            weight*=shared.smoothstep(ay,by-5,y)*(1-protected)
            # Held dagger/hammer must travel with its wrist. A small-angle rigid
            # attachment prevents the protection mask from freezing the hand.
            if self.arm_weapon_fields[side] is not None:
                weight=np.maximum(weight,_sample_continuous(self.arm_weapon_fields[side],x,y))
            angle=-side*math.radians(self.config['arm_angle_degrees'])*c['arms']
            cs,sn=math.cos(angle),math.sin(angle)
            rx,ry=x-ax,y-ay
            dx+=(cs*rx-sn*ry-rx)*weight
            dy+=(sn*rx+cs*ry-ry)*weight
        px,py=x+dx-322,y+dy-foot
        cs,sn=math.cos(c['tilt']),math.sin(c['tilt'])
        out=np.empty_like(points)
        out[...,0]=cs*px-sn*py+322
        out[...,1]=sn*px+cs*py+foot-c['lift']
        return out

    def inverse_map(self,t):
        x0,y0,x1,y1=self.roi
        target=self.grid[y0:y1,x0:x1]
        q=target.copy()
        for _ in range(24):
            q+=target-self.forward(q,t)
        out=self.grid.copy()
        out[y0:y1,x0:x1]=q
        return out

    def frame(self,t):
        if not math.isfinite(t):
            raise ValueError('Animation time must be finite')
        idx,weight=self.expression(t)
        c=self.channels(t)
        if max(abs(v) for v in c.values())<1e-12 and weight<=0:
            return self.source.copy()
        texture=self.textures[0]+(self.textures[idx]-self.textures[0])*weight
        if self.name==KEEP[1]:
            # Speech may only change the mouth, never open/closed eye drawings.
            _,yy=self.grid[...,0],self.grid[...,1]
            mouth=shared.smoothstep(179+self.config['face_offset'][1],184+self.config['face_offset'][1],yy)
            texture=self.textures[0]+(texture-self.textures[0])*mouth[...,None]
        mapped=self.inverse_map(t)
        p=cv2.remap(texture,mapped,None,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
        a=np.clip(p[...,3:4],0,1)
        rgb=np.divide(p[...,:3],a,out=np.zeros_like(p[...,:3]),where=a>1e-6)
        return np.rint(np.clip(np.concatenate([rgb,a],axis=2),0,1)*255).astype(np.uint8)

    def diagnostic(self,t):
        f=self.forward(self.grid,t)
        fx_y,fx_x=np.gradient(f[...,0]);fy_y,fy_x=np.gradient(f[...,1])
        det=fx_x*fy_y-fx_y*fy_x
        visible=self.source[...,3]>32
        mapped=self.inverse_map(t)
        output_visible=cv2.remap(self.source[...,3],mapped,None,cv2.INTER_NEAREST)>32
        residual=np.linalg.norm(self.forward(mapped,t)-self.grid,axis=2)
        return {'jacobian_min_on_visible_source':float(det[visible].min()),
                'maximum_inverse_residual_on_visible_output':float(residual[output_visible].max()),
                'max_displacement':float(np.linalg.norm(f-self.grid,axis=2)[visible].max())}


def build(task,source):
    if not supports(task):
        raise ValueError('Unsupported fixed-master action; warrior happy jump remains in identity-motion.py')
    config=json.loads((Path(source)/'class-identity-motion.json').read_text(encoding='utf-8'))['classes'][task['class']]
    bank='class-emotion-face-sources.json' if task['name'] in EMOTIONS else 'class-face-sources.json'
    faces=json.loads((Path(source)/'expressions'/bank).read_text(encoding='utf-8'))['classes'][task['class']]
    if task['name'] in EMOTIONS:
        idx=str(100+EMOTIONS.index(task['name']))
        faces={idx:faces[idx]}
    return ClassIdentityMotion(task,source,config,faces)
