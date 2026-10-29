#!/usr/bin/env python3
"""Compare two metro packages (staging directories or public/data) file by file:
tiles, far.bin, both elevation grids, city.json and provenance.json. Reports
byte-identical files, files whose gzip bytes differ around identical content,
and content differences (which tile buildings, header sections or manifest keys).
Two runs of the rebuild chain from the same sources must report no difference;
after a data change, the list is the review of what the change touched.

  .venv-data/bin/python scripts/compare-metro.py /tmp/boston-a /tmp/boston-b
"""
import argparse, gzip, json, pathlib, struct, sys
import numpy as np

def compare(a,b):
 lines=[];differences=0
 def gz(p):raw=p.read_bytes();return raw,gzip.decompress(raw)
 same=0;header_only=0
 names=sorted({p.name for p in (a/'tiles').glob('*.bin')}|{p.name for p in (b/'tiles').glob('*.bin')})
 for name in names:
  if not (a/'tiles'/name).exists() or not (b/'tiles'/name).exists():lines.append(f'tiles/{name}: only in {"a" if (a/"tiles"/name).exists() else "b"}');differences+=1;continue
  (ra,da),(rb,db)=gz(a/'tiles'/name),gz(b/'tiles'/name)
  if ra==rb:same+=1;continue
  if da==db:header_only+=1;continue
  differences+=1;why=[]
  na,nb=struct.unpack_from('<I',da,4)[0],struct.unpack_from('<I',db,4)[0];ha,hb=json.loads(da[8:8+na]),json.loads(db[8:8+nb])
  for key in sorted(set(ha)|set(hb)):
   if json.dumps(ha.get(key))==json.dumps(hb.get(key)):continue
   if key!='buildings':why.append(f'header.{key}');continue
   ids=[x['id'] for x in ha[key]],[x['id'] for x in hb[key]]
   if ids[0]!=ids[1]:why.append(f'building set/order ({len(ids[0])} vs {len(ids[1])}, {len(set(ids[0])^set(ids[1]))} unshared)')
   else:
    changed=[x['id'] for x,y in zip(ha[key],hb[key]) if json.dumps(x)!=json.dumps(y)];why.append(f'{len(changed)} building records ({", ".join(changed[:4])}{", ..." if len(changed)>4 else ""})')
  # The header JSON is padded to 4 bytes before the geometry (tileformat.write_tile), so
  # the body starts at the padded offset; a metadata change that crosses a 4-byte boundary
  # otherwise reads as a geometry change.
  ga,gb=da[8+na+(-(8+na))%4:],db[8+nb+(-(8+nb))%4:]
  if ga!=gb:why.append(f'geometry ({len(ga)} vs {len(gb)} bytes)')
  lines.append(f'tiles/{name}: '+'; '.join(why))
 lines.insert(0,f'tiles: {same} byte-identical, {header_only} identical content behind a different gzip header, {differences} differ')
 differences+=header_only
 for name in ['far.bin','elevation.bin','elevation-source.bin']:
  if not (a/name).exists() and not (b/name).exists():lines.append(f'{name}: absent from both (an ungraded build has no elevation-source.bin)');continue
  if not (a/name).exists() or not (b/name).exists():lines.append(f'{name}: only in {"a" if (a/name).exists() else "b"}');differences+=1;continue
  (ra,da),(rb,db)=gz(a/name),gz(b/name)
  if ra==rb:lines.append(f'{name}: byte-identical');continue
  differences+=1
  if da==db:lines.append(f'{name}: identical content behind a different gzip header');continue
  if name.startswith('elevation'):
   x,y=np.frombuffer(da,'<i2'),np.frombuffer(db,'<i2');cells=np.flatnonzero(x!=y) if x.size==y.size else None
   lines.append(f'{name}: {"grid sizes differ" if cells is None else f"{cells.size} cells differ, largest {np.abs(x[cells].astype(int)-y[cells].astype(int)).max()} cm"}')
  else:lines.append(f'{name}: content differs ({len(da)} vs {len(db)} bytes)')
 for name in ['city.json','provenance.json']:
  if not (a/name).exists() or not (b/name).exists():lines.append(f'{name}: only in {"a" if (a/name).exists() else "b"}');differences+=1;continue
  ta,tb=(a/name).read_text(),(b/name).read_text()
  if ta==tb:lines.append(f'{name}: byte-identical');continue
  # Numbers compare by value: the chain's Python steps write 12.0 where Node's JSON writes 12.
  differences+=1;ja,jb=json.loads(ta,parse_int=float),json.loads(tb,parse_int=float)
  keys=[k for k in sorted(set(ja)|set(jb)) if json.dumps(ja.get(k))!=json.dumps(jb.get(k))]
  if not keys:lines.append(f'{name}: identical values behind different number formatting');continue
  detail=[]
  for k in keys:
   if isinstance(ja.get(k),dict) and isinstance(jb.get(k),dict):detail.append(k+'.{'+','.join(kk for kk in sorted(set(ja[k])|set(jb[k])) if json.dumps(ja[k].get(kk))!=json.dumps(jb[k].get(kk)))+'}')
   elif isinstance(ja.get(k),list) and isinstance(jb.get(k),list) and len(ja[k])==len(jb[k]):detail.append(f'{k}[{sum(1 for x,y in zip(ja[k],jb[k]) if json.dumps(x)!=json.dumps(y))} of {len(ja[k])} entries]')
   else:detail.append(k)
  lines.append(f'{name}: differs in '+', '.join(detail))
 return lines,differences

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter);p.add_argument('a',type=pathlib.Path);p.add_argument('b',type=pathlib.Path);args=p.parse_args()
 lines,differences=compare(args.a,args.b);print('\n'.join(lines));print('identical packages' if not differences else f'{differences} files differ');sys.exit(1 if differences else 0)
