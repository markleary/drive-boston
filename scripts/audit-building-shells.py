#!/usr/bin/env python3
"""Audit packaged building shells; --repair fixes winding and missing soffits.
Use --building-id to limit a repair to selected buildings without a full rebuild.
"""
import argparse,json,pathlib
from collections import Counter
import numpy as np
import tileformat
from mesh_winding import orient_patches,orient_shells
from building_undersides import close_undersides

def run(data_dir,repair=False,building_ids=None):
 counts=Counter();findings=[];changed=0
 for path in sorted((data_dir/'tiles').glob('*.bin')):
  header,buildings=tileformat.read_tile(path);records=[];dirty=False
  for entry,b in zip(header['buildings'],buildings):
   counts[b.get('source','unknown')]+=1
   faces=np.concatenate([b['facade'],b['roof']]);out=faces;changes=[];patches=[];undersides=[]
   # Survey bridges intentionally carry open decks and piers; they are not
   # occupied building envelopes and must not be inferred as solid shells.
   if not b.get('structure') and (not building_ids or b['id'] in building_ids):
    out,changes=orient_shells(b['positions'],faces);out,patches=orient_patches(b['positions'],out)
    out,undersides=close_undersides(b['positions'],out,b['baseElevation'])
   if changes or patches or undersides:
    findings.append({'id':b['id'],'name':b.get('name'),'source':b.get('source'),'district':b['district'],'center':b['center'],'components':changes,'patches':patches,'undersides':undersides})
    if repair:dirty=True
   scale=entry.get('scale',tileformat.SCALE)
   q=np.rint((b['positions']-np.asarray(entry['anchor']))/scale).astype(np.int16)
   records.append((q,out[:len(b['facade'])],out[len(b['facade']):],scale))
  if dirty:tileformat.write_tile(path,header,records);changed+=1
 return {'sources':dict(counts),'invertedBuildings':sum(bool(f['components'] or f['patches']) for f in findings),'invertedComponents':sum(len(f['components']) for f in findings),'invertedPatches':sum(len(f['patches']) for f in findings),'patchTriangles':sum(r['triangles'] for f in findings for r in f['patches']),'missingUndersides':sum(len(f['undersides']) for f in findings),'undersideTriangles':sum(r['triangles'] for f in findings for r in f['undersides']),'changedTiles':changed,'findings':findings}

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--data-dir',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parents[1]/'public/data')
 parser.add_argument('--repair',action='store_true');parser.add_argument('--report',type=pathlib.Path)
 parser.add_argument('--building-id',action='append',help='Only inspect/repair this building (repeatable)')
 args=parser.parse_args();report=run(args.data_dir,args.repair,set(args.building_id or []))
 if args.report:args.report.write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({k:v for k,v in report.items() if k!='findings'}))
