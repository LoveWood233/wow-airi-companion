#!/usr/bin/env python3
"""Decode every delivered frame; collect continuity diagnostics and review images.

These metrics detect corrupt/empty/clipped frames and rank temporal anomalies.
They do not certify equipment identity or anatomically correct joint motion.
"""
from pathlib import Path
from contextlib import contextmanager
import argparse,concurrent.futures,hashlib,heapq,json,math,os,subprocess,sys,tempfile,threading
from build_state import INCOMPLETE,build_lock
import cv2
import numpy as np

W,H=640,360
ROOT=Path(__file__).resolve().parent.parent
CLASSES=('warrior','hunter','mage','rogue','paladin','warlock','priest','druid')
DECODE_TIMEOUT=300
PROBE_TIMEOUT=30

def overlap(first,second):
    first,second=Path(first).resolve(),Path(second).resolve()
    return first==second or first in second.parents or second in first.parents

def validate_job_paths(media,render_report,output):
    """Also protect direct audit_job callers before creating any output."""
    protected=[media.parent,render_report.parent,ROOT/'source',ROOT/'manifests',ROOT/'tools']
    if any(overlap(output,path) for path in protected):
        raise ValueError('Audit output overlaps an input directory: '+str(output))
    destination=output/(media.stem+'.json')
    for source in (media,render_report):
        if destination.exists() and source.exists() and destination.samefile(source):
            raise ValueError('Audit output aliases an input file: '+str(destination))

def atomic_json(path,value):
    temporary=None
    try:
        with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',prefix='.audit-',suffix='.tmp',dir=path.parent,delete=False) as handle:
            temporary=Path(handle.name)
            json.dump(value,handle,ensure_ascii=False,indent=2)
            handle.write('\n');handle.flush();os.fsync(handle.fileno())
        os.replace(temporary,path)
    finally:
        if temporary is not None:temporary.unlink(missing_ok=True)

@contextmanager
def decoded_stream(media,timeout):
    """Keep stderr out of the video pipe and interrupt stalled reads on timeout."""
    if not math.isfinite(timeout) or timeout<=0:
        raise ValueError('Decode timeout must be a positive finite number')
    with tempfile.TemporaryFile() as errors:
        proc=subprocess.Popen(['ffmpeg','-nostdin','-v','error','-c:v','libvpx-vp9','-i',str(media),'-f','rawvideo','-pix_fmt','rgba','-'],stdout=subprocess.PIPE,stderr=errors)
        expired=threading.Event()
        def expire():
            if proc.poll() is None:
                expired.set()
                try:proc.kill()
                except ProcessLookupError:pass
        timer=threading.Timer(timeout,expire)
        timer.daemon=True
        try:
            timer.start()
            try:
                yield proc.stdout
                code=proc.wait(timeout=5)
            except BaseException as error:
                if expired.is_set():
                    raise TimeoutError(f'FFmpeg decode exceeded {timeout:g}s: {media.name}') from error
                raise
            if expired.is_set():raise TimeoutError(f'FFmpeg decode exceeded {timeout:g}s: {media.name}')
            if code:
                errors.seek(0,os.SEEK_END);size=errors.tell();errors.seek(max(0,size-2000))
                raise RuntimeError(errors.read().decode('utf-8',errors='replace') or f'FFmpeg exited with status {code}')
        finally:
            timer.cancel();timer.join()
            if proc.poll() is None:
                try:proc.kill()
                except ProcessLookupError:pass
            try:proc.wait(timeout=5)
            finally:proc.stdout.close()

def prepare_jobs(media_root,output,selected=None,timeout=DECODE_TIMEOUT):
    """Require the full committed action set for every explicitly selected class."""
    media_root,output=Path(media_root).resolve(),Path(output).resolve()
    classes=tuple(dict.fromkeys(CLASSES if selected is None else selected))
    if not classes or any(c not in CLASSES for c in classes):
        raise ValueError('Select at least one supported class')
    if not math.isfinite(timeout) or timeout<=0:raise ValueError('Decode timeout must be positive and finite')
    packs,reports=media_root/'packs',media_root/'reports'
    if not packs.is_dir() or not reports.is_dir():
        raise ValueError('Media root must contain packs/ and reports/ directories')
    protected=[packs,reports,ROOT/'source',ROOT/'manifests',ROOT/'tools']
    if any(overlap(output,path) for path in protected):
        raise ValueError('Audit output overlaps an input directory: '+str(output))
    plan=json.loads((ROOT/'source/action-plan.json').read_text(encoding='utf-8'))
    if {c['id'] for c in plan['classes']}!=set(CLASSES):raise ValueError('Unexpected action-plan classes')
    names=[a['file'] for a in plan['actions']]
    if len(names)!=120 or len(set(names))!=120 or any(Path(n).name!=n or not n.endswith('.webm') or '\\' in n for n in names):
        raise ValueError('Action plan must list 120 unique WebM basenames')
    jobs=[]
    for class_id in classes:
        directory=packs/class_id
        if os.path.lexists(directory/INCOMPLETE):
            raise ValueError('Incomplete render must be rebuilt before auditing: '+class_id)
        manifest=json.loads((ROOT/'manifests'/class_id/'pack.json').read_text(encoding='utf-8'))
        if manifest.get('files')!=names:raise ValueError('Manifest differs from action plan: '+class_id)
        if not directory.is_dir():raise ValueError('Missing class directory: '+class_id)
        actual={p.name for p in directory.iterdir() if p.is_file() and p.suffix.lower()=='.webm'}
        if actual!=set(names):
            missing=sorted(set(names)-actual);extra=sorted(actual-set(names))
            raise ValueError(f'Incomplete media for {class_id}; missing={missing}, unexpected={extra}')
        for name in names:
            media=directory/name;render_report=reports/class_id/(Path(name).stem+'.json');destination=output/class_id
            if not render_report.is_file():raise ValueError('Missing render report: '+str(render_report))
            if any(overlap(destination,path) for path in protected):
                raise ValueError('Audit output overlaps an input directory: '+str(destination))
            validate_job_paths(media,render_report,destination)
            jobs.append((media,render_report,destination,timeout))
    return jobs,classes

def sha_file(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        while chunk:=f.read(1024*1024):h.update(chunk)
    return h.hexdigest()

def read_frame(stream):
    size=W*H*4;chunks=[];count=0
    while count<size:
        chunk=stream.read(size-count)
        if not chunk:
            if count:raise ValueError('Truncated decoded RGBA frame')
            return None
        chunks.append(chunk);count+=len(chunk)
    return np.frombuffer(b''.join(chunks),np.uint8).reshape(H,W,4)

def contact(frames,path):
    rows=(len(frames)+3)//4
    canvas=np.full((rows*384,1280,3),235,np.uint8)
    for cell,(index,rgba) in enumerate(frames):
        x=cell%4*320;y=cell//4*384
        im=rgba[:,160:480].astype(np.float32)
        rgb=im[:,:,:3]*(im[:,:,3:4]/255)+235*(1-im[:,:,3:4]/255)
        canvas[y:y+360,x:x+320]=cv2.cvtColor(np.uint8(np.rint(rgb)),cv2.COLOR_RGB2BGR)
        cv2.putText(canvas,f'frame {index} | {index/60:.3f}s',(x+8,y+377),cv2.FONT_HERSHEY_SIMPLEX,.45,(30,30,30),1,cv2.LINE_AA)
    # Never follow an existing output-file symlink or modify a shared hard link.
    fd,name=tempfile.mkstemp(prefix='.audit-page-',suffix='.jpg',dir=path.parent)
    os.close(fd);temporary=Path(name)
    try:
        if not cv2.imwrite(str(temporary),canvas,[cv2.IMWRITE_JPEG_QUALITY,92]):
            raise OSError('Unable to write contact page: '+str(path))
        os.replace(temporary,path)
    finally:temporary.unlink(missing_ok=True)

def cached_audit(dest,output,digest,auditor_sha,report_sha,expected):
    try:
        old=json.loads(dest.read_text(encoding='utf-8'))
        if not (old.get('schema')==3 and old.get('status')=='decoded_all_frames'
                and old.get('sha256')==digest and old.get('auditor_sha256')==auditor_sha
                and old.get('render_report_sha256')==report_sha
                and old.get('frames_decoded')==expected):return None
        pages=old.get('contact_pages')
        hashes=old.get('contact_page_sha256',{})
        if not isinstance(pages,list) or not pages or not isinstance(hashes,dict):return None
        if any(not isinstance(name,str) or Path(name).name!=name for name in pages):return None
        if set(pages)!=set(hashes):return None
        if any(sha_file(output/name)!=hashes[name] for name in pages):return None
        return old
    except (OSError,ValueError,TypeError,AttributeError):
        return None

def audit_job(job):
    media,render_report,output=map(Path,job[:3])
    timeout=job[3] if len(job)==4 else DECODE_TIMEOUT
    validate_job_paths(media,render_report,output)
    if os.path.lexists(media.parent/INCOMPLETE):raise ValueError('Incomplete render must be rebuilt before auditing')
    output.mkdir(parents=True,exist_ok=True)
    dest=output/(media.stem+'.json')
    digest=sha_file(media)
    auditor_sha=sha_file(Path(__file__))
    report_bytes=render_report.read_bytes()
    report_sha=hashlib.sha256(report_bytes).hexdigest()
    report=json.loads(report_bytes)
    if report.get('sha256')!=digest:
        raise ValueError('Render report media SHA256 does not match: '+str(media))
    expected=report['frames'];timeline=report['timeline']
    if type(expected) is not int or not 2<=expected<=120*60:
        raise ValueError('Render report frame count must be between 2 and 7200')
    old=cached_audit(dest,output,digest,auditor_sha,report_sha,expected)
    if old is not None:return old
    meta=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(media)],timeout=PROBE_TIMEOUT))
    assert len(meta['streams'])==1,'Media has unexpected streams'
    s=meta['streams'][0]
    assert s['codec_name']=='vp9' and (s['width'],s['height'])==(W,H)
    assert s['r_frame_rate']=='60/1' and s.get('tags',{}).get('alpha_mode')=='1'
    # Every distinct pose transition is represented, including recovery edges.
    samples={0,expected-1};seen=set()
    if report.get('fixed_source_equipment'):
        samples.update(round(x) for x in np.linspace(0,expected-1,24))
        if report.get('jump_trajectory'):
            samples.update(min(expected-1,round(t*60)) for t in (.75,1.1,1.25,1.5,1.8,2.05,2.35,2.6,4.25,4.8,5.35,6.5))
    for (ta,a),(tb,b) in zip(timeline,timeline[1:]):
        if a==b or (a,b) in seen:continue
        seen.add((a,b))
        for ratio in (0,.25,.5,.75,1):samples.add(min(expected-1,round((ta+(tb-ta)*ratio)*60)))
    selected={};top=[];last=None;first=None;deltas=[];tiles=[];areas=[];centroids=[]
    empty=[];edge_max=0;edge_frames=[];opaque_min=255;count=0
    with decoded_stream(media,timeout) as stream:
        while (frame:=read_frame(stream)) is not None:
            if count>=expected:raise ValueError('Decoded more frames than the render report declares')
            if count in samples:selected[count]=frame.copy()
            alpha=frame[:,:,3]
            edge=int(max(alpha[:4].max(),alpha[-4:].max(),alpha[:,:4].max(),alpha[:,-4:].max()))
            edge_max=max(edge_max,edge)
            if edge>4:edge_frames.append(count)
            opaque_min=min(opaque_min,int(alpha.max()))
            if np.count_nonzero(alpha>32)<1200:empty.append(count)
            tiny=cv2.resize(frame,(160,90),interpolation=cv2.INTER_AREA).astype(np.float32)/255
            matte=tiny[:,:,:3]*tiny[:,:,3:4]+.9*(1-tiny[:,:,3:4])
            mask=tiny[:,:,3]>.125;ys,xs=np.where(mask);areas.append(int(mask.sum()))
            centroids.append((float(xs.mean())*4,float(ys.mean())*4) if len(xs) else (0,0))
            if first is None:first=matte.copy()
            if last is not None:
                diff=np.abs(matte-last).mean(2)*255
                delta=float(diff.mean());tile=float(max(diff[y:y+10,x:x+10].mean() for y in range(0,90,10) for x in range(0,160,10)))
                deltas.append(delta);tiles.append(tile)
                rank=tile+delta
                if len(top)<8:heapq.heappush(top,(rank,count,frame.copy()))
                elif rank>top[0][0]:heapq.heapreplace(top,(rank,count,frame.copy()))
            last=matte;count+=1
    assert count==expected,f'Frame count {count} != {expected}'
    shifts=np.linalg.norm(np.diff(np.array(centroids),axis=0),axis=1)
    max_tile_frame=int(np.argmax(tiles))+1
    findings=[]
    if empty:findings.append('empty_visible_frame')
    if edge_frames:findings.append('visible_canvas_boundary_contact')
    if opaque_min<245:findings.append('low_foreground_opacity')
    if max(deltas)>8:findings.append('large_global_adjacent_change_review')
    if max(tiles)>65:findings.append('large_local_adjacent_change_review')
    if shifts.max()>12:findings.append('large_centroid_step_review')
    for _,index,frame in top:selected.setdefault(index,frame)
    ordered=sorted(selected.items());pages=[]
    for page,start in enumerate(range(0,len(ordered),16)):
        path=output/(media.stem+f'.frames-{page:02d}.jpg');contact(ordered[start:start+16],path);pages.append(path.name)
    if sha_file(media)!=digest or sha_file(render_report)!=report_sha:
        raise RuntimeError('Audit inputs changed while decoding; rerun with stable media and render report')
    result={'schema':3,'auditor_sha256':auditor_sha,'render_report_sha256':report_sha,'class':media.parent.name,'name':media.stem,'sha256':digest,'status':'decoded_all_frames','frames_decoded':count,
            'fps':60,'size':[W,H],'alpha_decoded_for_every_frame':True,'canvas_edge_alpha_max':edge_max,'edge_contact_frames':edge_frames,'empty_frames':empty,
            'minimum_frame_max_alpha':opaque_min,'adjacent_mean_delta_max_255':max(deltas),'adjacent_mean_delta_p99_255':float(np.percentile(deltas,99)),
            'adjacent_local_tile_delta_max_255':max(tiles),'maximum_local_change_frame':max_tile_frame,'centroid_step_max_pixels':float(shifts.max()),
            'loop_first_last_mean_delta_255':float(np.abs(first-last).mean()*255),'expected_loop_same_pose':timeline[0][1]==timeline[-1][1],
            'review_flags':findings,'selected_frame_ids':sorted(selected),'contact_pages':pages,
            'contact_page_sha256':{name:sha_file(output/name) for name in pages},
            'visual_review_status':'pending','limitations':'Automated continuity diagnostics are not equipment recognition or anatomical correctness proof. Contact pages require visual review.'}
    atomic_json(dest,result)
    return result

def run_audits(jobs,classes,out,workers):
    results=[];pending=[]
    pool=concurrent.futures.ProcessPoolExecutor(max_workers=workers)
    try:
        pending=[pool.submit(audit_job,job) for job in jobs]
        for future in concurrent.futures.as_completed(pending):
            r=future.result()
            results.append(r);print(json.dumps({k:r[k] for k in ('class','name','frames_decoded','review_flags')},ensure_ascii=False),flush=True)
    except Exception as error:
        print(json.dumps({'status':'failed','error':str(error)},ensure_ascii=False),file=sys.stderr)
        return 1
    finally:
        for future in pending:future.cancel()
        pool.shutdown(wait=True,cancel_futures=True)
    summary={'clips':len(results),'decoded_frames':sum(r['frames_decoded'] for r in results),'flagged_clips':sum(bool(r['review_flags']) for r in results),
             'classes':list(classes),'expected_clips':len(jobs),'full_eight_class_scope':set(classes)==set(CLASSES),
             'scope':'All 120 actions per selected class decoded and measured; visual acceptance remains a separate recorded review.'}
    out.mkdir(parents=True,exist_ok=True);atomic_json(out/'summary.json',summary)
    print(json.dumps(summary,ensure_ascii=False))
    return 0

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--media-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--workers',type=int,default=3);p.add_argument('--class',dest='classes',action='append',choices=CLASSES)
    p.add_argument('--decode-timeout',type=float,default=DECODE_TIMEOUT,help='maximum seconds per FFmpeg decode (default: 300)')
    args=p.parse_args(argv);media=args.media_root.resolve();out=args.output.resolve()
    if args.workers<1:p.error('workers must be positive')
    # Reject invalid paths before build_lock is allowed to create its lock file.
    try:prepare_jobs(media,out,args.classes,args.decode_timeout)
    except (OSError,ValueError,KeyError,TypeError) as error:p.error(str(error))
    try:
        with build_lock(media):
            jobs,classes=prepare_jobs(media,out,args.classes,args.decode_timeout)
            return run_audits(jobs,classes,out,args.workers)
    except (OSError,ValueError,KeyError,TypeError) as error:
        print(json.dumps({'status':'failed','error':str(error)},ensure_ascii=False),file=sys.stderr)
        return 1

if __name__=='__main__':sys.exit(main())
