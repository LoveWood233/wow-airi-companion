#!/usr/bin/env python3
"""RIFE correspondence with premultiplied RGBA and exact continuous endpoints.

The model predicts flow and visibility, never new character pixels. This reduces
DIS correspondence ghosts; it cannot prove anatomy or fix inconsistent drawings.
"""
from pathlib import Path
import hashlib,importlib.util,json,os,sys
import numpy as np
import torch
import torch.nn.functional as F

TOOLS=Path(__file__).resolve().parent
POLICY='rife426_premultiplied_RGBA_endpoint_flow_taper_v1'
MODEL_SHA='45c7f74156704769dc9f85cfcaf8552e1e926f9399dcfa3a553dee88fac6f53f'
DEFAULT_MODEL=TOOLS.parent/'build/models/rife-v4.26/flownet.pkl'
_engine=None

def load_vendor():
    name='_dafeiyu_rife426'
    if name not in sys.modules:
        spec=importlib.util.spec_from_file_location(name,TOOLS/'rife_v426/__init__.py',submodule_search_locations=[str(TOOLS/'rife_v426')])
        package=importlib.util.module_from_spec(spec);sys.modules[name]=package;spec.loader.exec_module(package)
    from _dafeiyu_rife426.IFNet_HDv3 import IFNet
    from _dafeiyu_rife426.warplayer import warp
    return IFNet,warp

def model_path():
    return Path(os.environ.get('DAFEIYU_RIFE_MODEL',str(DEFAULT_MODEL))).expanduser().resolve()

def model_metadata():
    path=model_path()
    if not path.is_file():raise FileNotFoundError('Run tools/download-rife.py to obtain authoring weights: '+str(path))
    sha=hashlib.sha256(path.read_bytes()).hexdigest()
    if sha!=MODEL_SHA:raise ValueError('RIFE model checksum mismatch')
    device='mps' if torch.backends.mps.is_available() else 'cuda' if torch.cuda.is_available() else 'cpu'
    return {'policy':POLICY,'weights_sha256':sha,'torch':torch.__version__,'device':device,'dtype':'float32','pixel_generation':False}

class Engine:
    def __init__(self):
        self.metadata=model_metadata();self.device=torch.device(self.metadata['device'])
        IFNet,self.warp=load_vendor();self.net=IFNet().eval().to(self.device)
        weights=torch.load(model_path(),map_location='cpu',weights_only=True)
        weights={k.removeprefix('module.'):v for k,v in weights.items()}
        # These two documented upstream training-only modules are absent in inference.
        weights={k:v for k,v in weights.items() if not k.startswith(('teacher.','caltime.'))}
        self.net.load_state_dict(weights,strict=True)

    @torch.inference_mode()
    def predict(self,rgba_a,rgba_b,amount):
        h,w=rgba_a.shape[-2:];pad=(0,(-w)%64,0,(-h)%64)
        a,b=[F.pad(x,pad,mode='replicate') for x in (rgba_a,rgba_b)]
        matte_a=a[:,:3]+.55*(1-a[:,3:4]);matte_b=b[:,:3]+.55*(1-b[:,3:4])
        flow,logit,_=self.net(torch.cat((matte_a,matte_b),1),float(amount),[16,8,4,2,1])
        f=flow[-1];mask=torch.sigmoid(logit)
        def taper(v):
            v=float(np.clip(v,0,1));return v*v*v*(v*(v*6-15)+10)
        start=taper(amount/.05);end=taper((1-amount)/.05)
        # Close to endpoints, return the corresponding flow to zero and visibility
        # to one continuously, avoiding a forced last-frame endpoint switch.
        mask=((1-start)+start*mask)*end
        premul=self.warp(a,f[:,:2]*start)*mask+self.warp(b,f[:,2:4]*end)*(1-mask)
        out=premul[0,:,:h,:w].permute(1,2,0).cpu().numpy()
        alpha=np.clip(out[:,:,3:4],0,1)
        color=np.divide(out[:,:,:3],alpha,out=np.zeros_like(out[:,:,:3]),where=alpha>1e-5)
        return np.uint8(np.rint(np.clip(np.concatenate((color,alpha),2),0,1)*255))

class Tween:
    def __init__(self,frames):
        global _engine
        if not frames or any(f.shape!=frames[0].shape for f in frames) or frames[0].shape[-1]!=4:
            raise ValueError('All poses must share an H x W x 4 shape')
        if _engine is None:_engine=Engine()
        self.engine=_engine;self.frames=frames
        self.premul=[];self.tensors=[]
        for frame in frames:
            p=frame.astype(np.float32)/255;p[:,:,:3]*=p[:,:,3:4]
            self.premul.append(p)
            self.tensors.append(torch.from_numpy(p.transpose(2,0,1).copy()).unsqueeze(0).to(_engine.device))

    def frame(self,i,j,amount):
        if not np.isfinite(amount):raise ValueError('Interpolation amount must be finite')
        if i==j or amount<=0:return self.frames[i]
        if amount>=1:return self.frames[j]
        return self.engine.predict(self.tensors[i],self.tensors[j],float(amount))
