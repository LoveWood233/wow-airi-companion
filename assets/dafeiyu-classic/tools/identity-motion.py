#!/usr/bin/env python3
"""Fixed-source, continuous happy jump. Never mixes outfit drawings.

This is a constrained 2D texture deformation, not a reconstructed 3D skeleton.
No generated raster asset is edited or repainted. The render samples an immutable
source texture through one continuous invertible coordinate map per frame.
"""
from pathlib import Path
import argparse, hashlib, json, math, subprocess
import cv2
import numpy as np

W,H=640,360
FPS=60
DURATION=8
POLICY='warrior_fixed_texture_continuous_jump_v1'

def smoothstep(a,b,x):
    t=np.clip((x-a)/(b-a),0,1)
    return t*t*(3-2*t)

def pulse(t,start,end):
    if not start<t<end:return 0.0
    return math.sin(math.pi*(t-start)/(end-start))**2

def capsule(x,y,ax,ay,bx,by,inner,outer):
    vx,vy=bx-ax,by-ay
    u=np.clip(((x-ax)*vx+(y-ay)*vy)/(vx*vx+vy*vy),0,1)
    d=np.sqrt((x-ax-u*vx)**2+(y-ay-u*vy)**2)
    return 1-smoothstep(inner,outer,d)

def rect(x,y,x0,y0,x1,y1,feather=5):
    return (smoothstep(x0-feather,x0,x)*(1-smoothstep(x1,x1+feather,x))*
            smoothstep(y0-feather,y0,y)*(1-smoothstep(y1,y1+feather,y)))

class FixedIdentityJump:
    def __init__(self, rgba, class_id='warrior'):
        if rgba.shape!=(H,W,4):raise ValueError('Expected 640x360 RGBA master')
        self.source=rgba.copy()
        self.class_id=class_id
        if class_id!='warrior':raise ValueError('This calibrated rig supports warrior only')
        a=rgba.astype(np.float32)/255
        a[:,:,:3]*=a[:,:,3:4]
        self.premul=a
        self.grid=np.stack(np.meshgrid(np.arange(W,dtype=np.float32),np.arange(H,dtype=np.float32)),axis=2)
        self.source_hash=hashlib.sha256(rgba.tobytes()).hexdigest()

    @staticmethod
    def channels(t):
        crouch=sum(8*pulse(t,s+.55,s+1.25)+5*pulse(t,s+2.35,s+2.85) for s in (0,3))
        lift=sum(31*pulse(t,s+1.25,s+2.35) for s in (0,3))
        arms=sum(pulse(t,s+.85,s+2.85) for s in (0,3))
        tuck=sum(pulse(t,s+1.25,s+2.35) for s in (0,3))
        sway=sum(2.0*math.sin(2*math.pi*(t-s-1.25)/1.8)*pulse(t,s+.75,s+3.05) for s in (0,3))
        tilt=sum(.008*math.sin(2*math.pi*(t-s-.65)/2.3)*pulse(t,s+.55,s+3.05) for s in (0,3))
        return dict(crouch=crouch,lift=lift,arms=arms,tuck=tuck,sway=sway,tilt=tilt)

    def forward(self, points, t):
        """Source coordinates -> destination; one fixed texture, no dissolves."""
        c=self.channels(t)
        x,y=points[...,0],points[...,1]
        dx=np.zeros_like(x);dy=np.zeros_like(y)
        # Chest and equipped objects move with the torso, preserving their shapes.
        # All coordinates are in the 640x360 master; no pose-dependent new masks.
        armor=rect(x,y,270,188,378,278,18)
        shield=rect(x,y,372,191,412,278,20)
        sword=rect(x,y,255,254,299,316,20)
        protected=np.maximum.reduce([armor,shield,sword])
        # Feet remain planted during anticipation and landing compression.
        upper=1-smoothstep(278,324,y)
        dy+=c['crouch']*np.maximum(upper,protected)
        # Slight lower-leg bend/splay while airborne, without replacing leg art.
        legs=rect(x,y,289,278,361,326,12)
        sign=np.tanh((x-325)/8)
        dx+=1.5*c['tuck']*sign*legs*(1-protected)
        dy-=1.5*c['tuck']*legs*(1-protected)
        # Hair trails the torso; equipment pixels are explicitly protected.
        outer=1-rect(x,y,279,0,370,360,12)
        hair=outer*smoothstep(138,215,y)*(1-protected)
        dx+=c['sway']*hair
        dy+=.6*c['tuck']*hair
        # Small continuous forearm cheer. No new pixels are invented behind arms.
        for side,ax,ay,bx,by in [(-1,281,214,283,255),(1,365,214,367,255)]:
            weight=capsule(x,y,ax,ay,bx,by,4,30)
            # Don't drag shield/sword. Upper shoulder attaches to torso naturally.
            weight*=smoothstep(210,247,y)*(1-np.maximum(shield,sword))
            angle=-side*math.radians(7)*c['arms']
            cs,sn=math.cos(angle),math.sin(angle)
            rx,ry=x-ax,y-ay
            dx+=(cs*rx-sn*ry-rx)*weight
            dy+=(sn*rx+cs*ry-ry)*weight
        # Almost-rigid torso lean and world-space jump apply to every item.
        px=x+dx-323;py=y+dy-325
        cs,sn=math.cos(c['tilt']),math.sin(c['tilt'])
        out=np.empty_like(points)
        out[...,0]=cs*px-sn*py+323
        out[...,1]=sn*px+cs*py+325-c['lift']
        return out

    def inverse_map(self,t):
        q=self.grid.copy()
        for _ in range(12):q+=self.grid-self.forward(q,t)
        return q

    def frame(self,t):
        if not math.isfinite(t):raise ValueError('Time must be finite')
        if max(abs(v) for v in self.channels(t).values())<1e-12:
            self.last_inverse_residual=0.0
            return self.source.copy()
        mapped=self.inverse_map(t)
        inverse_error=np.linalg.norm(self.forward(mapped,t)-self.grid,axis=2)
        visible=cv2.remap(self.source[:,:,3],mapped,None,cv2.INTER_NEAREST,borderMode=cv2.BORDER_CONSTANT)>32
        self.last_inverse_residual=float(inverse_error[visible].max())
        p=cv2.remap(self.premul,mapped,None,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
        a=np.clip(p[:,:,3:4],0,1)
        rgb=np.divide(p[:,:,:3],a,out=np.zeros_like(p[:,:,:3]),where=a>1e-6)
        return np.rint(np.clip(np.concatenate([rgb,a],axis=2),0,1)*255).astype(np.uint8)

    def diagnostic(self,t):
        f=self.forward(self.grid,t)
        fx_y,fx_x=np.gradient(f[...,0]);fy_y,fy_x=np.gradient(f[...,1])
        determinant=fx_x*fy_y-fx_y*fy_x
        alpha=self.source[...,3]>32
        return {'jacobian_min_on_visible_source':float(determinant[alpha].min()),'jacobian_max_on_visible_source':float(determinant[alpha].max()),'max_displacement':float(np.linalg.norm(f-self.grid,axis=2)[alpha].max())}


def read_rgba(path):
    return cv2.cvtColor(cv2.imread(str(path),cv2.IMREAD_UNCHANGED),cv2.COLOR_BGRA2RGBA)

def face_components(base, generated, config):
    h,w=base.shape[:2]
    m=np.asarray(config['generated_to_reference_affine'],np.float32)
    edit=cv2.warpAffine(generated,m,(w,h),flags=cv2.INTER_LANCZOS4,borderMode=cv2.BORDER_CONSTANT)
    mask=np.zeros((h,w),np.uint8)
    cv2.fillPoly(mask,[np.asarray(config['mask_polygon'],np.int32)],255)
    feather=float(config['inward_feather_pixels'])
    distance=cv2.distanceTransform(mask,cv2.DIST_L2,5)
    alpha=np.clip(distance/feather,0,1).astype(np.float32)
    alpha=alpha*alpha*(3-2*alpha)
    alpha*=np.minimum(base[:,:,3],edit[:,:,3]).astype(np.float32)/255
    return edit,alpha

def apply_face(base,edit,mask,strength=1):
    s=float(np.clip(strength,0,1))
    out=base.copy()
    m=(mask*s)[...,None]
    out[:,:,:3]=np.rint(base[:,:,:3].astype(np.float32)*(1-m)+edit[:,:,:3].astype(np.float32)*m).astype(np.uint8)
    # Preserve source alpha, including face edges, exactly.
    return out


class WarriorHappyJump(FixedIdentityJump):
    """The expression texture differs only within the registered facial mask."""
    def __init__(self, base, generated, config):
        super().__init__(base, 'warrior')
        edit,mask=face_components(base,generated,config)
        if np.any(mask[200:]) or not np.any(mask):
            raise ValueError('Expression mask must stay inside the face, above equipment')
        happy=apply_face(base,edit,mask,1)
        changed=np.any(happy!=base,axis=2)
        if np.any(changed[mask==0]) or not np.array_equal(happy[:,:,3],base[:,:,3]):
            raise ValueError('Expression altered pixels outside the facial mask or alpha')
        self.expression_premul=happy.astype(np.float32)/255
        self.expression_premul[:,:,:3]*=self.expression_premul[:,:,3:4]
        self.face_mask=mask
        self.face_diagnostic={'outside_face_mask_changed_pixels':int(np.count_nonzero(changed[mask==0])),
                              'equipment_region_changed_pixels':int(changed[200:].sum()),
                              'alpha_unchanged':True,'changed_pixels':int(changed.sum())}

    @staticmethod
    def expression_weight(t):
        return float(smoothstep(.45,.65,t)*(1-smoothstep(6.05,6.25,t)))

    def frame(self,t):
        if not math.isfinite(t):
            raise ValueError('Animation time must be finite')
        weight=self.expression_weight(t)
        if weight<=0:return super().frame(t)
        mapped=self.inverse_map(t)
        error=np.linalg.norm(self.forward(mapped,t)-self.grid,axis=2)
        visible=self.source[:,:,3]>32
        self.last_inverse_residual=float(error[visible].max())
        texture=self.premul+(self.expression_premul-self.premul)*weight
        p=cv2.remap(texture,mapped,None,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
        a=np.clip(p[:,:,3:4],0,1)
        rgb=np.divide(p[:,:,:3],a,out=np.zeros_like(p[:,:,:3]),where=a>1e-6)
        return np.rint(np.clip(np.concatenate([rgb,a],axis=2),0,1)*255).astype(np.uint8)


def build_warrior(source_root):
    source_root=Path(source_root)
    base=read_rgba(source_root/'base-keyframes'/'warrior'/'frame-00.png')
    generated=read_rgba(source_root/'expressions'/'warrior'/'happy-face.png')
    config=json.loads((source_root/'expressions'/'warrior'/'happy-face.json').read_text())
    if list(base.shape[1::-1])!=config['reference_size'] or list(generated.shape[1::-1])!=config['generated_size']:
        raise ValueError('Expression alignment has stale dimensions')
    return WarriorHappyJump(base,generated,config)
