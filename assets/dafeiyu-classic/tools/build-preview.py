#!/usr/bin/env python3
"""Build an offline review page beside a complete candidate packs/ directory."""
from pathlib import Path
import argparse,hashlib,json,os,shutil
ROOT=Path(__file__).resolve().parent.parent

def media_identity(path):
    digest=hashlib.sha256();size=0
    with path.open('rb') as handle:
        before=os.fstat(handle.fileno())
        while chunk:=handle.read(1024*1024):
            digest.update(chunk);size+=len(chunk)
        after=os.fstat(handle.fileno())
    current=path.stat()
    signature=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
    if signature(before)!=signature(after) or signature(after)!=signature(current):
        raise ValueError('Media changed while building preview: '+str(path))
    return {'sha256':digest.hexdigest(),'bytes':size}

def build(media_root):
    plan=json.loads((ROOT/'source/action-plan.json').read_text())
    rows=[]
    for c in plan['classes']:
        for action in plan['actions']:
            path=media_root/'packs'/c['id']/action['file']
            if not path.is_file():raise ValueError('Missing media: '+str(path.relative_to(media_root)))
            report=json.loads((media_root/'reports'/c['id']/(action['name']+'.json')).read_text())
            if report.get('class')!=c['id'] or report.get('name')!=action['name']:
                raise ValueError('Render report identity mismatch: '+str(path.relative_to(media_root)))
            actual=media_identity(path)
            if (type(report.get('bytes')) is not int or report['bytes']!=actual['bytes']
                    or report.get('sha256')!=actual['sha256']):
                raise ValueError('Render report media hash/size mismatch: '+str(path.relative_to(media_root)))
            rows.append({'class':c['id'],'action':action['name'],'fixed':bool(report.get('fixed_source_equipment'))})
    data=json.dumps({'classes':plan['classes'],'actions':plan['actions'],'media':rows},ensure_ascii=False).replace('</','<\\/')
    template=(ROOT/'tools/preview-template.html').read_text()
    assert template.count('__PACK_DATA__')==1
    target=media_root/'index.html';temporary=target.with_suffix('.html.tmp');temporary.write_text(template.replace('__PACK_DATA__',data));os.replace(temporary,target)
    for name in ('IMPORT.txt','ATTRIBUTION.txt'):shutil.copyfile(ROOT/name,media_root/name)
    return {'status':'review_page_built','clips':len(rows),'fixed_master_clips':sum(x['fixed'] for x in rows),'visual_acceptance':False}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--media-root',type=Path,required=True)
    print(json.dumps(build(p.parse_args().media_root.resolve())))
