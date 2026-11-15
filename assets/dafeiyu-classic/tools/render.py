#!/usr/bin/env python3
"""Render v0.4.0 equipment repairs with continuous RGBA correspondence.

Not a replacement for full frame-by-frame original video choreography. This
is a 60 fps key-pose remake of the original named actions with class outfits.
Input illustrations are immutable. Cropping/padding only; no drawing by code.
Sources resolve beside this tool, independently of the working directory.
Requires ffmpeg and ffprobe on PATH (libvpx-vp9 encoding and alpha decoding).
"""
from __future__ import annotations
import argparse, bisect, concurrent.futures, hashlib, importlib.util, json, math, multiprocessing, os, shutil, subprocess, sys, time
from pathlib import Path
import cv2
import numpy as np
from build_state import INCOMPLETE, atomic_bytes, build_lock, exclusive_lock, temporary_path

TOOLS=Path(__file__).resolve().parent
ASSET=TOOLS.parent
SOURCE=ASSET/'source'
OUT=ASSET/'build'
CLASSES=['warrior','hunter','mage','rogue','paladin','warlock','priest','druid']
FPS=60
KEEP=['待机呼吸休闲','碎碎念-对屏碎碎念','工作状态-雀跃庆祝']
NEW=['害怕','害羞','难过（眼睛饱含泪水）','想去玩（期待星星眼）','大哭','开心蹦跳']
RENDER_POLICY='v040_equipment_source_revision_neural_RGBA_v1'
MOTION_BACKEND='rife'
_neural_module=None
RUN_EXIT_POLICY='retain_last_gait_pose_until_smooth_recovery_v1'
JUMP_ARM_POLICY='warrior_manual_correspondence_continuous_arm_rotation_v1'
TRANSFORM_ACTIONS={'变鸽子','蓝鲸现世','萌化小幽灵'}
TRANSFORM_POLICY='premultiplied_alpha_dissolve_between_incompatible_forms_v1'
spec=importlib.util.spec_from_file_location('smooth',TOOLS/'continuous-motion.py')
smooth=importlib.util.module_from_spec(spec); spec.loader.exec_module(smooth)
smooth.WIDTH=smooth.HEIGHT=320
jumpspec=importlib.util.spec_from_file_location('jump_motion',TOOLS/'jump-motion.py')
jump_motion=importlib.util.module_from_spec(jumpspec);jumpspec.loader.exec_module(jump_motion)
identityspec=importlib.util.spec_from_file_location('identity_motion',TOOLS/'identity-motion.py')
identity_motion=importlib.util.module_from_spec(identityspec);identityspec.loader.exec_module(identity_motion)
classspec=importlib.util.spec_from_file_location('class_identity_motion',TOOLS/'class-identity-motion.py')
class_identity_motion=importlib.util.module_from_spec(classspec);classspec.loader.exec_module(class_identity_motion)

def warrior_identity_jump(task):
    return task['class']=='warrior' and task['name']=='开心蹦跳'

def fixed_identity_action(task):
    return warrior_identity_jump(task) or class_identity_motion.supports(task)

def neural_module():
    global _neural_module
    if _neural_module is None:
        module_spec=importlib.util.spec_from_file_location('neural_motion',TOOLS/'neural-motion.py')
        _neural_module=importlib.util.module_from_spec(module_spec);module_spec.loader.exec_module(_neural_module)
    return _neural_module

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def crop_map(cls,sheet):
    path=SOURCE/'extraction-crops.json'
    data=json.loads(path.read_text(encoding='utf-8'))
    rows=[x for x in data.get('entries',[]) if x['class']==cls and x['sheet']==sheet]
    if not rows:return {}
    actual=digest(SOURCE/'sheets'/cls/(sheet+'.png'))
    # Historical crops only describe their exact PNG. A repaired atlas may
    # have different grid boundaries and must never inherit an old trim.
    combined={}
    for row in rows:
        if row['source_sha256']!=actual:continue
        value=combined.setdefault(int(row['cell']),{'bottom_trim_px':0,'right_trim_px':0})
        for edge in value:
            trim=int(row.get(edge,0))
            if trim and value[edge] not in (0,trim):
                raise ValueError(f'Conflicting extraction corrections: {cls}/{sheet}/{row["cell"]}')
            if trim:value[edge]=trim
    # Keep historical bottom-only snapshots stable. Side corrections may be a
    # separate entry for the same cell and must be merged rather than overwrite.
    return {k:(v if v['right_trim_px'] else v['bottom_trim_px']) for k,v in combined.items()}

def trim_cell_boundary(cell,correction):
    values=correction if isinstance(correction,dict) else {'bottom_trim_px':correction}
    bottom=int(values.get('bottom_trim_px',0));right=int(values.get('right_trim_px',0))
    h,w=cell.shape[:2]
    if not (0<=bottom<h//8 and 0<=right<w//8):
        raise ValueError('Extraction trim exceeds the audited cell boundary')
    # Pad back to the exact original grid dimensions; no pose translation or
    # rescaling is introduced, and all retained RGBA pixels stay identical.
    kept=cell[:h-bottom,:w-right].copy()
    return cv2.copyMakeBorder(kept,0,bottom,0,right,cv2.BORDER_CONSTANT,value=(0,0,0,0))

def sheet_cells(path):
    a=cv2.imread(str(path),cv2.IMREAD_UNCHANGED)
    if a is None or a.ndim!=3 or a.shape[2]!=4: raise ValueError(f'Invalid RGBA atlas {path}')
    a=cv2.cvtColor(a,cv2.COLOR_BGRA2RGBA)
    h,w=a.shape[:2]
    cells=[]; corrections=crop_map(path.parent.name,path.stem)
    for k in range(16):
        r,c=divmod(k,4)
        cell=a[r*h//4:(r+1)*h//4,c*w//4:(c+1)*w//4]
        if k in corrections:
            # Audited extraction boundary: the removed strip belongs to the
            # next atlas row, not this sprite. Source PNG remains unchanged.
            cell=trim_cell_boundary(cell,corrections[k])
        cell=cv2.resize(cell,(320,320),interpolation=cv2.INTER_AREA if w>1280 else cv2.INTER_LANCZOS4)
        if cell[:,:,3].min()!=0 or cell[:,:,3].max()<240: raise ValueError(f'Invalid alpha cell {k}: {path}')
        if np.count_nonzero(cell[:,:,3]>32)<1200: raise ValueError(f'Empty atlas cell {k}: {path}')
        cells.append(cell)
    return cells

def neutral(cls):
    a=cv2.imread(str(SOURCE/'base-keyframes'/cls/'frame-00.png'),cv2.IMREAD_UNCHANGED)
    return cv2.cvtColor(a,cv2.COLOR_BGRA2RGBA)[20:340,160:480].copy()

def source_list(task):
    cls=task['class']; name=task['name']
    base=SOURCE/'sheets'/cls
    if warrior_identity_jump(task):return [SOURCE/'expressions'/'warrior'/'happy-face.png']
    if class_identity_motion.supports(task):return class_identity_motion.source_paths(task,SOURCE)
    if name in KEEP:return [SOURCE/'base-keyframes'/cls/f'frame-{i:02d}.png' for i in range(16)]
    if name=='开心蹦跳':return [base/'happy-jump.png']
    if name.startswith('睡觉-') or name=='原地小憩沉眠':return [base/'locomotion-sleep.png']
    if name in ['开心小跑','侧身急躁跑','原地左转奔跑']:
        return [base/'locomotion-sleep.png']+([] if name=='开心小跑' else [base/'turnaround.png'])
    if name=='小幅度原地360度旋转展示':return [base/'turnaround.png']
    if name in NEW or name=='小幅度原地360度旋转展示': return [base/'emotions.png']
    sources=[base/(task['sheet']+'.png')]
    if name.startswith('睡觉-'):
        plan=json.loads((SOURCE/'atlas-plan.json').read_text(encoding='utf-8'))
        start=next(x for x in plan['actions'] if x['name']=='睡觉-开始')
        sources.append(base/(start['sheet']+'.png'))
    return list(dict.fromkeys(sources))

def effective_crops(task):
    out={}
    for path in source_list(task):
        changes=crop_map(task['class'],path.stem)
        if path.stem==task.get('sheet'):
            changes={k:v for k,v in changes.items() if k in task.get('cells',[])}
        elif path.stem=='emotions':
            ids=range(NEW.index(task['name'])*2,NEW.index(task['name'])*2+2) if task['name'] in NEW[:5] else range(10,16)
            changes={k:v for k,v in changes.items() if k in ids}
        if changes:out[path.stem]=changes
    return out

def poses_for(task):
    cls,name=task['class'],task['name']; z=neutral(cls)
    if warrior_identity_jump(task):return [z],'identity_happy_jump'
    if class_identity_motion.supports(task):return [z],'class_identity'
    sources=source_list(task)
    if name in KEEP:
        return [cv2.cvtColor(cv2.imread(str(p),-1),cv2.COLOR_BGRA2RGBA)[20:340,160:480].copy() for p in sources],'base_'+name
    all_cells={p.stem:sheet_cells(p) for p in sources}
    if name=='开心蹦跳':
        cells=all_cells['happy-jump']
        # One constant alignment for the entire sequence preserves intended
        # crouching and knee bends; never independently snap each frame to a box.
        zy,zx=np.where(z[:,:,3]>32);sy,sx=np.where(cells[0][:,:,3]>32)
        scale=(zy.max()-zy.min()+1)/(sy.max()-sy.min()+1)
        dx=(zx.min()+zx.max())/2-scale*(sx.min()+sx.max())/2
        dy=zy.max()-scale*sy.max()
        matrix=np.array([[scale,0,dx],[0,scale,dy]],np.float32)
        aligned=[smooth.to_rgba(cv2.warpAffine(smooth.premultiply(c),matrix,(320,320),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)) for c in cells]
        return [z]+aligned,'happy_jump'
    if 'locomotion-sleep' in all_cells:
        bridge=all_cells['locomotion-sleep']
        if name=='原地小憩沉眠':return [z]+bridge[:8],'dense_nap'
        if name.startswith('睡觉-'):return [z]+bridge[:8],'dense_'+{'睡觉-开始':'sleep_start','睡觉-循环':'sleep_loop','睡觉-起来':'sleep_end'}[name]
        if name=='开心小跑':return [z]+bridge[12:16],'dense_run_front'
        return [z]+all_cells['turnaround'][:5]+bridge[8:12],'dense_run_left'
    if 'turnaround' in all_cells:return [z]+all_cells['turnaround'],'dense_spin'
    if name in NEW[:5]:
        i=NEW.index(name)*2; return [z,all_cells['emotions'][i],all_cells['emotions'][i+1]],'emotion'
    if name in ['卖萌转圈圈','小幅度原地360度旋转展示']:
        return [z]+all_cells['emotions'][10:16],'spin'
    a,b=[all_cells[task['sheet']][i] for i in task['cells']]
    if name.startswith('睡觉-'):
        plan=json.loads((SOURCE/'atlas-plan.json').read_text(encoding='utf-8'))
        start=next(x for x in plan['actions'] if x['name']=='睡觉-开始')
        sleeping=all_cells[start['sheet']][start['cells'][1]]
        if name=='睡觉-开始': return [z,a,sleeping],'sleep_start'
        if name=='睡觉-循环': return [sleeping,b,sleeping],'sleep_loop'
        return [sleeping,a,z],'sleep_end'
    return [z,a,b],task.get('motion','gesture')

def schedule(kind,name):
    if kind=='identity_happy_jump':return [(0,0),(8,0)],8
    if kind=='class_identity':
        duration=8 if name in class_identity_motion.EMOTIONS else {KEEP[0]:4,KEEP[1]:4,KEEP[2]:10,'开心蹦跳':8,'点击回应-开心跃动':10}[name]
        return [(0,0),(duration,0)],duration
    if name in KEEP:
        timelines=json.loads((SOURCE/'base-timelines.json').read_text(encoding='utf-8'))
        base=next(v for v in timelines.values() if v['file']==name+'.webm')
        return base['poses'],base['duration']
    if kind=='happy_jump':
        # Two eager jumps: continuous crouch, push-off, high-V joy, and landing.
        seq=[(0,0),(.3,0),(.75,1)]
        phases=[(.9,2),(1.15,3),(1.3,4),(1.45,5),(1.6,6),(1.75,7),(1.9,8),(2.05,9),(2.2,10),(2.35,11),(2.5,12),(2.7,13),(2.9,14),(3.1,15),(3.35,16)]
        seq+=phases+[(round(t+3,3),p) for t,p in phases]
        seq += [(6.7,1),(7.4,0),(8,0)]
        return seq,8
    if kind=='dense_sleep_start':return [(0,0),(.3,0),(.8,1),(1.7,2),(2.5,3),(3.3,4),(4.2,5),(6,5)],6
    if kind=='dense_sleep_loop':return [(0,5),(.5,5),(2.7,6),(3.2,6),(5.5,5),(6,5)],6
    if kind=='dense_sleep_end':return [(0,5),(.4,5),(1.2,7),(2,8),(2.8,2),(4.2,1),(5.2,0),(6,0)],6
    if kind=='dense_nap':
        # Same 10-second original action, with actual lowering/rising bridge
        # drawings. Avoid the former neutral<->prone two-pose torso dissolve.
        return [(0,0),(.35,0),(.75,1),(1.35,2),(1.9,3),(2.45,4),
                (3.,5),(3.3,6),(4.3,5),(5.3,6),(6.3,5),(6.9,5),
                (7.5,7),(8.1,8),(8.8,1),(9.35,0),(10,0)],10
    if kind=='dense_spin':
        seq=[(0,0),(.5,0),(1,1)];step=.16 if name=='卖萌转圈圈' else .22;t=1
        for _ in range(2):
            for i in list(range(2,17))+[1]:t+=step;seq.append((round(t,3),i))
        seq += [(round(t+.4,3),1),(round(t+1,3),0),(10,0)]
        return seq,10
    if kind=='dense_run_front':
        seq=[(0,0),(.5,0),(1,1)]
        for i in range(28):seq.append((round(1.2+i*.2,3),1+(i+1)%4))
        seq += [(7,1),(7.6,0),(8,0)]
        return seq,8
    if kind=='dense_run_left':
        seq=[(0,0),(.3,0),(.55,1),(.8,2),(1.05,3),(1.3,4),(1.5,5),(1.75,6)]
        active_end=5.2 if name=='原地左转奔跑' else 7.2
        t=1.75;i=0
        while t+.18<active_end:
            t+=.18;i+=1;seq.append((round(t,3),6+i%4))
        # Do not force phase 6 in a remaining 0.03–0.05 s interval: that made
        # the legs teleport at the end of the active movement window.
        seq += [(active_end,seq[-1][1]),(active_end+.25,5),(active_end+.5,4),(active_end+.75,3),(active_end+1,2),(active_end+1.25,1),(active_end+1.55,0),(10,0)]
        return seq,10
    if kind=='spin':
        # Six real viewpoints around the vertical axis. Complete two turns.
        seq=[(0,0),(.55,0),(1.0,1)]
        step=.42 if name=='卖萌转圈圈' else .56
        t=1.0
        for _ in range(2):
            for i in [2,3,4,5,6,1]: t+=step; seq.append((round(t,3),i))
        seq += [(round(t+.5,3),1),(round(t+1.1,3),0),(10,0)]
        return seq,10
    if kind=='sleep_start': return [(0,0),(.6,0),(2,1),(3,1),(5,2),(6,2)],6
    if kind=='sleep_end': return [(0,0),(.6,0),(2.5,1),(3.2,1),(5,2),(6,2)],6
    if kind=='sleep_loop': return [(0,0),(.5,0),(2.8,1),(3.2,1),(5.5,0),(6,0)],6
    if name in ['螃蟹走路','原地漂浮踏步','原地左转奔跑']:
        # Preserve room for upstream move leadSec and tailSec parameters.
        if name=='原地左转奔跑':
            seq=[(0,0),(1.3,0),(1.75,1)]
            for i in range(8): seq.append((2.15+i*.4,2 if i%2==0 else 1))
            seq.extend([(5.05,1),(5.2,0),(10,0)])
        else:
            seq=[(0,0),(1.5,0),(2.0,1)]
            for i in range(14): seq.append((round(2.4+i*.4,3),2 if i%2==0 else 1))
            seq.extend([(7.8,1),(8.0,0),(10,0)])
        return seq,10
    if kind=='emotion':
        return [(0,0),(.4,0),(1.2,1),(1.65,1),(2.35,2),(2.7,2),(3.4,1),
                (3.75,1),(4.45,2),(4.8,2),(5.5,1),(5.9,1),(6.8,0),(8,0)],8
    # Distinct semantic A/B drawings carry each original action, with deliberate
    # anticipatory, contact and recovery poses. Holds are part of the timing.
    return [(0,0),(.45,0),(1.25,1),(1.65,1),(2.45,2),(2.8,2),(3.6,1),
            (3.95,1),(4.75,2),(5.1,2),(5.9,1),(6.25,1),(7.05,2),
            (7.45,2),(8.35,1),(9.15,0),(10,0)],10

def ensure_owner_alive():
    parent=multiprocessing.parent_process()
    if parent is not None and not parent.is_alive():
        raise RuntimeError('Render owner exited; refusing to publish an orphan worker result')


def encode(task):
    target=OUT/'packs'/task['class']/(task['name']+'.webm')
    target.parent.mkdir(parents=True,exist_ok=True)
    lock=OUT/'.render-locks'/task['class']/(task['name']+'.lock')
    with exclusive_lock(lock), temporary_path(target,suffix='.encoding.webm') as temporary:
        ensure_owner_alive()
        return encode_locked(task,temporary)


def encode_locked(task,tmp):
    cv2.setNumThreads(1)
    cls,name=task['class'],task['name']
    pack=OUT/'packs'/cls; pack.mkdir(parents=True,exist_ok=True)
    repdir=OUT/'reports'/cls; repdir.mkdir(parents=True,exist_ok=True)
    target=pack/(name+'.webm'); report_path=repdir/(name+'.json')
    provenance=render_provenance(task)
    extraction_crops=effective_crops(task)
    if target.exists() and report_path.exists():
        try:
            r=json.loads(report_path.read_text(encoding='utf-8'))
        except (OSError,ValueError):
            r={}
        sources_current=r.get('render_policy')==RENDER_POLICY
        sources_current=sources_current and all(r.get(k)==v for k,v in provenance.items())
        sources_current=sources_current and r.get('extraction_crops',{})==json.loads(json.dumps(extraction_crops))
        if name in TRANSFORM_ACTIONS:sources_current=sources_current and r.get('transition_policy')==TRANSFORM_POLICY
        if name in ('原地左转奔跑','侧身急躁跑'):sources_current=sources_current and r.get('run_exit_policy')==RUN_EXIT_POLICY
        if fixed_identity_action(task):
            expected_policy=identity_motion.POLICY if warrior_identity_jump(task) else class_identity_motion.policy_for(task)
            sources_current=sources_current and r.get('equipment_identity_policy')==expected_policy
        if r.get('sha256')==digest(target) and sources_current:
            return {'class':cls,'name':name,'status':'already_validated'}
    if shutil.disk_usage(OUT).free<900*1024**2: raise RuntimeError('Less than 900MiB free; stopping before disk exhaustion')
    frames,kind=poses_for(task); timeline,duration=schedule(kind,name)
    assert all(timeline[i][0]<timeline[i+1][0] for i in range(len(timeline)-1)),(name,timeline)
    rig=identity_motion.build_warrior(SOURCE) if kind=='identity_happy_jump' else (class_identity_motion.build(task,SOURCE) if kind=='class_identity' else None)
    if kind=='class_identity':assert rig.duration==duration
    tween=None if rig is not None else (neural_module().Tween(frames) if MOTION_BACKEND=='rife' else smooth.Tween(frames))
    times=[x[0] for x in timeline]; count=duration*FPS
    jump_amplitude=0.0
    if kind=='happy_jump':
        top=min(int(np.where(f[:,:,3]>32)[0].min()) for f in frames[4:14])
        jump_amplitude=float(max(8,min(32,20+top-9)))
    command=['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgba','-video_size','640x360',
             '-framerate','60','-i','pipe:0','-vf','format=yuva420p','-c:v','libvpx-vp9',
             '-crf','22','-b:v','0','-pix_fmt','yuva420p','-auto-alt-ref','0',
             '-row-mt','1','-cpu-used','5','-threads','2','-an',str(tmp)]
    p=subprocess.Popen(command,stdin=subprocess.PIPE,stderr=subprocess.PIPE)
    # Repeat cycles share the exact already calculated optical-flow samples.
    cache={}; visible=set(); first_raw=last_raw=None
    last_metric=None; adjacent_deltas=[]
    started=time.monotonic()
    try:
        for k in range(count):
            t=k/FPS; n=min(len(timeline)-2,bisect.bisect_right(times,t)-1)
            ta,a=timeline[n]; tb,b=timeline[n+1]
            ratio=(t-ta)/(tb-ta)
            if k==0: a=b=timeline[0][1]; ratio=0
            if k==count-1: a=b=timeline[-1][1]; ratio=0
            key=('fixed_identity',k) if rig is not None else ((a,b,round(ratio,6)) if a!=b else (a,a,0))
            lift=0.0
            if kind=='happy_jump':
                for takeoff in (1.3,4.3):
                    if takeoff<t<takeoff+1.4:lift=jump_amplitude*math.sin(math.pi*(t-takeoff)/1.4)**2
                key=(*key,round(lift,6))
            if key not in cache:
                if rig is not None:
                    canvas=rig.frame(t)
                elif name in TRANSFORM_ACTIONS and {a,b}=={1,2}:
                    # Different species have incompatible facial/body topology.
                    # Preserve each drawing and dissolve through the magic pose
                    # instead of spatially stretching a face into another form.
                    phase=float(np.clip((ratio-.25)/.5,0,1))
                    weight=phase*phase*(3-2*phase)
                    cell=smooth.to_rgba(tween.premul[a]*(1-weight)+tween.premul[b]*weight)
                else:
                    cell=tween.frame(a,b,ratio)
                if rig is None:
                    canvas=np.zeros((360,640,4),np.uint8); canvas[20:340,160:480]=cell
                if lift:
                    matrix=np.array([[1,0,0],[0,1,-lift]],np.float32)
                    canvas=smooth.to_rgba(cv2.warpAffine(smooth.premultiply(canvas),matrix,(640,360),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT))
                raw=canvas.tobytes(); cache[key]=raw
                visible.add(hashlib.sha256(raw).hexdigest())
            raw=cache[key]
            # A cheap full-duration adjacent-frame diagnostic, not anatomical QA.
            rgba=np.frombuffer(raw,np.uint8).reshape(360,640,4)
            tiny=cv2.resize(rgba,(160,90),interpolation=cv2.INTER_AREA).astype(np.float32)/255
            metric=tiny[:,:,:3]*tiny[:,:,3:4]+.9*(1-tiny[:,:,3:4])
            if last_metric is not None:adjacent_deltas.append(float(np.abs(metric-last_metric).mean()*255))
            last_metric=metric
            if k==0: first_raw=raw
            last_raw=raw
            p.stdin.write(raw)
        p.stdin.close(); err=p.stderr.read()
        if p.wait(): raise RuntimeError(err.decode()[-3000:])
    except BaseException:
        p.kill(); p.wait(); raise
    minimum_visible=12 if name=='待机呼吸休闲' else 30
    if len(visible)<minimum_visible: raise ValueError(f'Insufficient genuine intermediates {cls}/{name}: {len(visible)}')
    meta=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',str(tmp)]))
    s=meta['streams'][0]
    assert s['r_frame_rate']=='60/1' and int(s['nb_read_frames'])==count
    assert s['codec_name']=='vp9' and s['tags']['alpha_mode']=='1' and len(meta['streams'])==1
    # Decode actual alpha at a held semantic pose and inspect transparent margin.
    decoded=subprocess.check_output(['ffmpeg','-v','error','-c:v','libvpx-vp9','-i',str(tmp),'-ss','2','-frames:v','1','-f','rawvideo','-pix_fmt','rgba','-'])
    sample=np.frombuffer(decoded,np.uint8).reshape(360,640,4)
    assert sample[:,:,3].min()==0 and sample[:,:,3].max()>=245
    assert np.count_nonzero(sample[:,:,3]>32)>1200
    # VP9 alpha is quantized at CRF22: up to 1/255 padding noise was observed.
    # Catch visible boundary contact while tolerating imperceptible codec noise.
    edge_alpha_max=int(max(sample[:4,:,3].max(),sample[-4:,:,3].max(),sample[:,:4,3].max(),sample[:,-4:,3].max()))
    assert edge_alpha_max<=4, f'Visible alpha at canvas boundary: {edge_alpha_max}'
    assert tmp.stat().st_size<32*1024**2
    if render_provenance(task)!=provenance or effective_crops(task)!=extraction_crops:
        tmp.unlink(missing_ok=True)
        raise RuntimeError('Render inputs changed while encoding; rerun with stable sources')
    # A terminated owner releases the build lock on spawn-based platforms.
    # Old workers must not publish into a later build after that happens.
    ensure_owner_alive()
    os.replace(tmp,target)
    r={'class':cls,'name':name,'status':'encoded_and_decoded','method':'continuous_bidirectional_RGBA_flow_without_midpoint_endpoint_switch','render_policy':RENDER_POLICY,
       'fps':60,'duration_seconds':duration,'frames':count,'size':[640,360],'alpha_decoded':True,
       'decoded_canvas_edge_alpha_max':edge_alpha_max,
       'distinct_source_rgba_frames':len(visible),'new_hand_drawn_intermediates':False,
       'first_last_source_pixels_match':first_raw==last_raw,'loop_type':kind,
       'codec':'vp9','crf':22,'bytes':target.stat().st_size,'sha256':digest(target),
       **provenance,
       'extraction_crops':extraction_crops,
       'timeline':timeline,'elapsed_seconds':round(time.monotonic()-started,2)}
    r['continuity_diagnostic']={'adjacent_matte_mean_delta_max_255':max(adjacent_deltas),'adjacent_matte_mean_delta_p99_255':float(np.percentile(adjacent_deltas,99)),'algorithm_has_midpoint_hard_cut':False,'metric_is_not_joint_or_visual_correctness_proof':True}
    if rig is None and MOTION_BACKEND=='rife':
        r['method']='RIFE_correspondence_premultiplied_RGBA_with_continuous_endpoint_flow_taper'
        r['interpolation']=neural_module().model_metadata()
    if kind=='happy_jump':r['jump_trajectory']={'amplitude_pixels':jump_amplitude,'takeoffs_seconds':[1.3,4.3],'airtime_seconds':1.4,'position_and_velocity_continuous':True,'turning':False}
    if kind=='dense_run_left':r['run_exit_policy']=RUN_EXIT_POLICY
    if rig is not None:
        r['method']='single_equipment_texture_continuous_coordinate_map_with_face_only_expression'
        r['equipment_identity_policy']=identity_motion.POLICY if warrior_identity_jump(task) else class_identity_motion.policy_for(task)
        r['fixed_source_equipment']=True
        if warrior_identity_jump(task):
            r['jump_trajectory']={'amplitude_pixels':31.0,'takeoffs_seconds':[1.25,4.25],'airtime_seconds':1.1,'position_and_velocity_continuous':True,'turning':False}
            r['face_only_expression']=rig.face_diagnostic
        else:
            r['fixed_identity_diagnostics']=rig.diagnostics
            if name=='开心蹦跳':
                r['jump_trajectory']={'amplitude_pixels':rig.maximum_lift,'takeoffs_seconds':[1.25,4.25],'airtime_seconds':1.1,'position_and_velocity_continuous':True,'turning':False}
    if name in TRANSFORM_ACTIONS:r['transition_policy']=TRANSFORM_POLICY
    atomic_bytes(report_path,(json.dumps(r,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
    return {k:r[k] for k in ['class','name','status','bytes','elapsed_seconds']}

def input_images(task):
    # Every non-base action also reads the neutral pose for alignment/recovery.
    paths=source_list(task)
    if task['name'] not in KEEP:
        paths=[SOURCE/'base-keyframes'/task['class']/'frame-00.png']+paths
    return list(dict.fromkeys(paths))


def render_provenance(task):
    def records(paths,root):
        return [{'path':p.relative_to(root).as_posix(),'sha256':digest(p)} for p in paths]
    # Relevant extraction entries are recorded and compared separately. An
    # unrelated class's crop correction must not invalidate this render.
    metadata=[SOURCE/name for name in ('atlas-plan.json','base-timelines.json')]
    if warrior_identity_jump(task):metadata.append(SOURCE/'expressions'/'warrior'/'happy-face.json')
    if class_identity_motion.supports(task):metadata+=class_identity_motion.metadata_paths(SOURCE,task)
    renderer_files=[TOOLS/name for name in ('render.py','build_state.py','continuous-motion.py','jump-motion.py','jump-arm-guides.json','identity-motion.py','requirements.txt')]
    if class_identity_motion.supports(task):renderer_files.append(TOOLS/'class-identity-motion.py')
    interpolation={}
    if not fixed_identity_action(task) and MOTION_BACKEND=='rife':
        renderer_files += [TOOLS/name for name in ('neural-motion.py','requirements-rife.txt','rife_v426/IFNet_HDv3.py','rife_v426/warplayer.py','rife_v426/UPSTREAM.json')]
        interpolation=neural_module().model_metadata()
    return {
        'source_sheets':records(input_images(task),SOURCE),
        'source_metadata':records(metadata,SOURCE),
        'renderer_inputs':records(renderer_files,ASSET),
        'python_dependencies':{'numpy':np.__version__,'opencv':cv2.__version__},
        'motion_backend':'fixed_identity' if fixed_identity_action(task) else MOTION_BACKEND,
        'neural_interpolation':interpolation,
    }


def tasks():
    originals=json.loads((SOURCE/'atlas-plan.json').read_text(encoding='utf-8'))['actions']
    listed={x['name'] for x in originals}
    if len(listed)!=len(originals):
        raise ValueError('atlas-plan.json contains duplicate action names')
    extra=[{'name':x} for x in KEEP+NEW+['小幅度原地360度旋转展示'] if x not in listed]
    actions=originals+extra
    if len(actions)!=120:
        raise ValueError(f'Expected 120 actions per class, found {len(actions)}')
    return [dict(x,**{'class':c}) for c in CLASSES for x in actions]


def initialize_worker(output,backend='rife'):
    global OUT,MOTION_BACKEND
    OUT=Path(output)
    MOTION_BACKEND=backend


def positive_int(value):
    number=int(value)
    if number<1:
        raise argparse.ArgumentTypeError('must be at least 1')
    return number


def complete_manifests(selected):
    """Read the checked-in contract only for fully selected class packs."""
    result={}
    for cls in dict.fromkeys(task['class'] for task in selected):
        names={task['name']+'.webm' for task in selected if task['class']==cls}
        if len(names)!=120:
            continue
        content=(ASSET/'manifests'/cls/'pack.json').read_bytes()
        manifest=json.loads(content)
        if len(manifest.get('files',[]))!=120 or set(manifest['files'])!=names:
            raise ValueError(f'manifests/{cls}/pack.json does not match the 120 render actions')
        result[cls]=content
    return result


def begin_render(output,selected):
    """Invalidate old manifests before any WebM can be replaced.

    Partial/failed runs keep this marker. A complete class rerun is required to
    restore importability; valid per-action results remain available as cache.
    """
    classes=list(dict.fromkeys(task['class'] for task in selected))
    # A directory alias could bypass the common build lock and redirect writes
    # into another build. Reject all selected output aliases before invalidation.
    for parent in ('packs','reports','.render-locks'):
        directory=output/parent
        if directory.is_symlink():
            raise ValueError(f'Render output must not contain symlink directories: {directory}')
        for cls in classes:
            child=directory/cls
            if child.is_symlink():
                raise ValueError(f'Render output must not contain symlink directories: {child}')
            if child.exists() and (not child.is_dir() or any(p.is_symlink() for p in child.iterdir())):
                raise ValueError(f'Render output must be a directory without symlinks: {child}')
    for cls in classes:
        pack=output/'packs'/cls
        pack.mkdir(parents=True,exist_ok=True)
        marker={'status':'render_incomplete','class':cls,
                'recovery':'Rerun all 120 actions for this class before importing or packaging.'}
        atomic_bytes(pack/INCOMPLETE,(json.dumps(marker,ensure_ascii=False)+'\n').encode('utf-8'))
        (pack/'pack.json').unlink(missing_ok=True)


def publish_manifests(output,selected,failures,manifests):
    """Partial renders never create a manifest claiming a complete pack."""
    results=[]
    failed_classes={cls for cls,_ in failures}
    for cls in dict.fromkeys(task['class'] for task in selected):
        pack=output/'packs'/cls
        names=[task['name']+'.webm' for task in selected if task['class']==cls]
        status='not_written_partial_selection'
        if cls in failed_classes:
            status='not_written_failed'
        elif cls in manifests:
            if not all((pack/name).is_file() for name in names):
                raise RuntimeError(f'Cannot publish {cls}: a rendered WebM is missing')
            # Only complete, successful runs may clear the persistent failure
            # marker. A failed publication must not leave an importable pack.
            try:
                atomic_bytes(pack/'pack.json',manifests[cls])
                (pack/INCOMPLETE).unlink()
            except BaseException:
                (pack/'pack.json').unlink(missing_ok=True)
                raise
            status='written'
        if status!='written':
            (pack/'pack.json').unlink(missing_ok=True)
        results.append({'class':cls,'selected_actions':len(names),'manifest_status':status})
    return results


def main():
    global MOTION_BACKEND
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--class',dest='classes',action='append',choices=CLASSES,
                   help='render one class; repeat to select several (default: all eight)')
    p.add_argument('--action',dest='actions',action='append',
                   help='exact action name; repeat to select several (default: all 120)')
    p.add_argument('--workers',type=positive_int,default=2,
                   help='parallel encoder processes (default: 2)')
    p.add_argument('--motion-backend',choices=['rife','dis'],default='rife',
                   help='rife uses verified neural correspondence; dis reproduces the historical interpolation')
    p.add_argument('--output',type=Path,default=ASSET/'build',
                   help='output directory for packs/ and reports/ (default: assets/dafeiyu-classic/build)')
    args=p.parse_args()
    MOTION_BACKEND=args.motion_backend
    for binary in ('ffmpeg','ffprobe'):
        if shutil.which(binary) is None:
            p.error(f'{binary} is required on PATH; ffmpeg must support libvpx-vp9')
    try:
        selected=tasks()
        known={x['name'] for x in selected}
        unknown=set(args.actions or [])-known
        if unknown:
            p.error('unknown action name(s): '+', '.join(sorted(unknown)))
        selected=[x for x in selected if (not args.classes or x['class'] in args.classes)
                  and (not args.actions or x['name'] in args.actions)]
        required={SOURCE/name for name in ('atlas-plan.json','extraction-crops.json','base-timelines.json')}
        for task in selected:
            required.update(input_images(task))
        missing=sorted(path.relative_to(SOURCE).as_posix() for path in required if not path.is_file())
        if missing:
            p.error('missing source files: '+', '.join(missing))
        manifests=complete_manifests(selected)
    except (OSError,ValueError,KeyError) as error:
        p.error(str(error))
    output=args.output.expanduser().resolve()
    # Protect the checked-in inputs from accidentally being used as build output.
    if output==SOURCE or SOURCE in output.parents or output==TOOLS or TOOLS in output.parents:
        p.error('--output must be outside the source/ and tools/ directories')
    output.mkdir(parents=True,exist_ok=True)
    try:
        with build_lock(output):
            return render_selected(output,selected,manifests,args.workers)
    except (OSError,ValueError,RuntimeError) as error:
        p.error(str(error))


def render_selected(output,selected,manifests,workers):
    begin_render(output,selected)
    completed=0
    failures=[]
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers,
            initializer=initialize_worker,initargs=(str(output),MOTION_BACKEND)) as pool:
        pending={pool.submit(encode,task):(task['class'],task['name']) for task in selected}
        for future in concurrent.futures.as_completed(pending):
            key=pending[future]
            try:
                print(json.dumps(future.result(),ensure_ascii=False),flush=True)
                completed+=1
            except Exception as error:
                print(json.dumps({'error':str(error),'class':key[0],'name':key[1]},ensure_ascii=False),flush=True)
                failures.append(key)
    packs=publish_manifests(output,selected,failures,manifests)
    print(json.dumps({'requested':len(selected),'completed':completed,'failed':failures,
                     'sources_read_only':True,'packs':packs},ensure_ascii=False),flush=True)
    return 1 if failures else 0


if __name__=='__main__':
    sys.exit(main())
