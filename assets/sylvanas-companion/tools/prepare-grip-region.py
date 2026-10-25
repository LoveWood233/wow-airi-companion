"""Read the generated PNG alpha and author mesh/UV metadata; never edit pixels."""
from pathlib import Path
from PIL import Image
import numpy as np,json
root=Path(__file__).resolve().parents[1]
land=json.loads((root/'source/grip-landmarks.json').read_text(encoding='utf-8-sig'))
image=Image.open(root/'source'/land['page'])
a=np.array(image.getchannel('A'))
y,x=np.where(a>=64); px=int(x.min())-4;py=int(y.min())-4; w=int(x.max())+5-px;h=int(y.max())+5-py
mask=a[py:py+h,px:px+w]>=64
rows={int(yy):(int(np.where(mask[yy])[0][0]),int(np.where(mask[yy])[0][-1])) for yy in np.where(mask.any(axis=1))[0]}
def simp(p,eps=1.4):
 if len(p)<3:return p
 v=np.array(p,float);ab=v[-1]-v[0]
 t=np.clip(((v-v[0])@ab)/(ab@ab),0,1) if ab@ab else np.zeros(len(p))
 d=np.linalg.norm(v-(v[0]+t[:,None]*ab),axis=1);i=int(np.argmax(d))
 return simp(p[:i+1],eps)[:-1]+simp(p[i:],eps) if d[i]>eps else [p[0],p[-1]]
left=[(max(0,rows[y][0]-1),y) for y in rows]
right=[(min(w,rows[y][1]+2),y) for y in rows]
poly=simp(left)+list(reversed(simp(right)))
region={'name':'arm-right','page':land['page'],'x':px,'y':py,'width':w,'height':h,'polygon':[[round(xx/w,7),round(yy/h,7)] for xx,yy in poly]}
p=root/'source/atlas-regions.json';doc=json.loads(p.read_text(encoding='utf-8-sig'));doc['regions']=[region if r['name']=='arm-right' else r for r in doc['regions']];doc['pages']={land['page']:{'width':image.width,'height':image.height}};p.write_text(json.dumps(doc,indent=2),encoding='utf-8')
sx,sy=land['shoulderPx'];ex,ey=land['elbowPx'];gx,gy=land['gripPx'];aw,ah=w*land['pixelScale'][0],h*land['pixelScale'][1]
p=root/'source/rig-layout.json';layout=json.loads(p.read_text(encoding='utf-8-sig'));part=layout['parts']['arm-right'];part.update(width=aw,height=ah,pivotX=(sx-px)/w,pivotY=(sy-py)/h,elbowX=(ex-sx)*aw/w,elbowY=(sy-ey)*ah/h)
layout['parts']['bow']['rotation']=land['bowRotation']
layout['grip']={'armUV':[(gx-px)/w,(gy-py)/h],'bowUV':land['bowGripUV']}
p.write_text(json.dumps(layout,indent=2),encoding='utf-8');print('region',px,py,w,h,'polygon',len(poly),'grip',layout['grip'])
