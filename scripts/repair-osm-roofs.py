#!/usr/bin/env python3
"""Repair pre-fix DBT2 extrusions without rebuilding survey meshes or terrain.

The original normalization audit records the extrusion's eave elevation. Retain
every quantized vertex and roof pitch, expose that wall height to the renderer,
and orient vertical gable ends outwards instead of testing them against up.
Safe to rerun: tiles already repaired are not rewritten.
"""
import argparse
import pathlib
import numpy as np
import tileformat


def repair(path):
 header,buildings=tileformat.read_tile(path)
 changed=False;ends=0;houses=0;geometry=[]
 for entry,b in zip(header['buildings'],buildings):
  positions=b['positions'];facade=b['facade'].copy();roof=b['roof'].copy()
  if b.get('source')=='osm-extrusion':
   houses+=1
   eave=b['norm']['max'];height=round(eave-b['baseElevation'],2)
   if entry.get('eaveHeight')!=height:entry['eaveHeight']=height;changed=True
   for faces in [facade,roof]:
    for i,f in enumerate(faces):
     p=positions[f];n=np.cross(p[1]-p[0],p[2]-p[0]);length=np.linalg.norm(n)
     # Only the vertical end caps extend above the audited eave. The
     # centroid vector is valid here: these roofs use a convex rectangle.
     if length<1e-8 or p[:,1].max()<=eave+.02 or abs(n[1])/length>.05:continue
     outward=p.mean(axis=0)[[0,2]]-np.asarray(b['center'])
     if np.dot(n[[0,2]],outward)<0:
      faces[i]=f[[0,2,1]];changed=True;ends+=1
  scale=entry.get('scale',tileformat.SCALE)
  q=np.rint((positions-np.asarray(entry['anchor']))/scale).astype(np.int16)
  geometry.append((q,facade,roof,scale))
 if changed:tileformat.write_tile(path,header,geometry)
 return changed,houses,ends


if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--data-dir',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parents[1]/'public/data')
 args=parser.parse_args();totals=[0,0,0]
 for path in sorted((args.data_dir/'tiles').glob('*.bin')):
  result=repair(path)
  totals=[a+b for a,b in zip(totals,result)]
 print(f'{totals[0]} tiles updated; {totals[1]} generated buildings checked; {totals[2]} inward gable ends repaired')
