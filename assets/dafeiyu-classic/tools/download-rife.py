#!/usr/bin/env python3
"""Download the pinned upstream RIFE authoring weights, verifying both hashes."""
from pathlib import Path
import argparse,hashlib,json,os,tempfile,urllib.request,zipfile

TOOLS=Path(__file__).resolve().parent
def install(destination):
    meta=json.loads((TOOLS/'rife_v426/UPSTREAM.json').read_text(encoding='utf-8'))
    if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest()==meta['weights_sha256']:
        return destination
    destination.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as directory:
        archive=Path(directory)/'model.zip'
        with urllib.request.urlopen(meta['network_archive'],timeout=60) as response,archive.open('wb') as output:
            while chunk:=response.read(1024*1024):output.write(chunk)
        if hashlib.sha256(archive.read_bytes()).hexdigest()!=meta['archive_sha256']:
            raise ValueError('RIFE archive hash mismatch')
        with zipfile.ZipFile(archive) as z:
            weights=z.read('RIFEv4.26_0921/flownet.pkl')
        if hashlib.sha256(weights).hexdigest()!=meta['weights_sha256']:
            raise ValueError('RIFE weights hash mismatch')
        staged=Path(directory)/'flownet.pkl';staged.write_bytes(weights);os.replace(staged,destination)
    return destination

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path,default=TOOLS.parent/'build/models/rife-v4.26/flownet.pkl')
    print(install(p.parse_args().output.expanduser().resolve()))
