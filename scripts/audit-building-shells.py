#!/usr/bin/env python3
"""Audit all packaged building sources; --repair reverses inverted survey shells
and the inward-wound wall and roof patches of inconsistently wound shells."""
import argparse,json,pathlib
from collections import Counter
import numpy as np
import tileformat
from mesh_winding import orient_patches,orient_shells

def run(data_dir,repair=False):
 counts=Counter();findings=[];changed=0
 for path in sorted((data_dir/'tiles').glob('*.bin')):
  header,buildings=tileformat.read_tile(path);records=[];dirty=False
  for entry,b in zip(header['buildings'],buildings):
   counts[b.get('source','unknown')]+=1
   faces=np.concatenate([b['facade'],b['roof']]);out,changes=orient_shells(b['positions'],faces);out,patches=orient_patches(b['positions'],out)
   # Survey bridges intentionally carry open decks and piers; they are not
   # occupied building envelopes and must not be inferred as solid shells.
   if b.get('structure'):changes=[];patches=[];out=faces
   if changes or patches:
    findings.append({'id':b['id'],'name':b.get('name'),'source':b.get('source'),'district':b['district'],'center':b['center'],'components':changes,'patches':patches})
    if repair:dirty=True
   scale=entry.get('scale',tileformat.SCALE)
   q=np.rint((b['positions']-np.asarray(entry['anchor']))/scale).astype(np.int16)
   records.append((q,out[:len(b['facade'])],out[len(b['facade']):],scale))
  if dirty:tileformat.write_tile(path,header,records);changed+=1
 return {'sources':dict(counts),'invertedBuildings':len(findings),'invertedComponents':sum(len(f['components']) for f in findings),'invertedPatches':sum(len(f['patches']) for f in findings),'patchTriangles':sum(r['triangles'] for f in findings for r in f['patches']),'changedTiles':changed,'findings':findings}

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--data-dir',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parents[1]/'public/data')
 parser.add_argument('--repair',action='store_true');parser.add_argument('--report',type=pathlib.Path)
 args=parser.parse_args();report=run(args.data_dir,args.repair)
 if args.report:args.report.write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({k:v for k,v in report.items() if k!='findings'}))
