#!/usr/bin/env python3
"""Drive Boston tile container (DBT2): one gzip-compressed binary per world tile
holding building metadata, tile-local context (curbs, park paths) and quantized
building geometry. Shared by the compiler, the validator and detail scripts;
`src/simulation/tile-format.ts` is the runtime reader of the same layout.

Layout (little-endian, whole file gzip-compressed):
  'DBT2' | uint32 header bytes | header JSON | pad to 4
  int16 positions (x,y,z per vertex, hundredths of a metre, relative to each
  building's anchor) | pad to 4 | uint16 or uint32 local vertex indices
  (facade triangles then roof triangles per building)
"""
from __future__ import annotations
import gzip, json, math, pathlib, struct
import numpy as np
from mesh_winding import orient_shells

MAGIC=b'DBT2'
SCALE=.01
SCALES=(.01,.02,.05,.1)

def mesh_record(vertices,faces,anchor,base,repair_winding=True):
 """Quantize a building mesh: drop degenerate or buried triangles, split facade
 and roof by face normal, deduplicate vertices. Returns (positions int16 Nx3,
 facade uint32 Mx3, roof uint32 Kx3, scale) or None when nothing visible
 remains. The quantization step is the finest of SCALES that keeps every vertex
 within the int16 range of the anchor (1 cm up to 327 m, 10 cm up to 3.2 km),
 so extensive complexes such as the Prudential keep their single survey mesh."""
 v=np.asarray(vertices,dtype=np.float64).reshape(-1,3);f=np.asarray(faces,dtype=np.int64).reshape(-1,3)
 if len(f)==0 or len(v)==0:return None
 a,b,c=v[f[:,0]],v[f[:,1]],v[f[:,2]];n=np.cross(b-a,c-a);length=np.linalg.norm(n,axis=1)
 top=np.maximum(np.maximum(a[:,1],b[:,1]),c[:,1]);keep=(length>1e-7)&(top>=base+.01)
 f=f[keep];n=n[keep];length=length[keep]
 if len(f)==0:return None
 roof=np.abs(n[:,1]/length)>.65
 local=v-np.asarray(anchor,dtype=np.float64);reach=np.abs(local).max()
 scale=next((s for s in SCALES if reach/s<=32767),None)
 if scale is None:raise ValueError('Vertex exceeds the 3.2 km anchor range')
 q=np.rint(local/scale).astype(np.int64)
 unique,inverse=np.unique(q,axis=0,return_inverse=True);f=inverse.reshape(-1)[f]
 ok=(f[:,0]!=f[:,1])&(f[:,1]!=f[:,2])&(f[:,0]!=f[:,2]);f=f[ok];roof=roof[ok]
 if len(f)==0:return None
 used,remap=np.unique(f,return_inverse=True);f=remap.reshape(-1,3)
 # Imported surveys are authored independently and can contain an inverted
 # shell beside correctly oriented parts. Repair at the final packaged scale;
 # positions, topology and the facade/roof split remain unchanged.
 if repair_winding:f=orient_shells(unique[used]*scale+np.asarray(anchor),f)[0]
 return unique[used].astype(np.int16),f[~roof].astype(np.uint32),f[roof].astype(np.uint32),scale

def write_tile(path,header,geometry):
 """geometry: list aligned with header['buildings'] of (positions,facade,roof,scale) from mesh_record."""
 total=sum(len(g[0]) for g in geometry);wide=any(len(g[0])>65535 for g in geometry)
 header=dict(header);header['indexBytes']=4 if wide else 2;header['vertexCount']=int(total)
 for entry,record in zip(header['buildings'],geometry):
  positions,facade,roof=record[:3];scale=record[3] if len(record)>3 else SCALE
  entry['v']=int(len(positions));entry['f']=int(facade.size);entry['r']=int(roof.size)
  if scale!=SCALE:entry['scale']=scale
  elif 'scale' in entry:del entry['scale']
 header_bytes=json.dumps(header,separators=(',',':')).encode();out=bytearray(MAGIC+struct.pack('<I',len(header_bytes))+header_bytes)
 while len(out)%4:out.append(0)
 for record in geometry:out.extend(np.ascontiguousarray(record[0],dtype='<i2').tobytes())
 while len(out)%4:out.append(0)
 kind='<u4' if wide else '<u2'
 for record in geometry:out.extend(np.ascontiguousarray(record[1],dtype=kind).tobytes());out.extend(np.ascontiguousarray(record[2],dtype=kind).tobytes())
 path.parent.mkdir(parents=True,exist_ok=True)
 with gzip.open(path,'wb',compresslevel=9) as f:f.write(bytes(out))
 return len(out)

def read_tile(path):
 """Return (header, buildings) with absolute float positions and face index lists."""
 with gzip.open(path,'rb') as f:raw=f.read()
 if raw[:4]!=MAGIC:raise ValueError(f'{path} is not a DBT2 tile')
 length=struct.unpack_from('<I',raw,4)[0];header=json.loads(raw[8:8+length].decode());offset=8+length;offset+=(-offset)%4
 index_offset=offset+header['vertexCount']*6;index_offset+=(-index_offset)%4
 kind='<u4' if header['indexBytes']==4 else '<u2';size=header['indexBytes'];buildings=[]
 for entry in header['buildings']:
  count=entry['v'];q=np.frombuffer(raw,dtype='<i2',count=count*3,offset=offset).reshape(-1,3).astype(np.float64);offset+=count*6
  positions=q*entry.get('scale',SCALE)+np.asarray(entry['anchor'],dtype=np.float64)
  n=entry['f']+entry['r'];indices=np.frombuffer(raw,dtype=kind,count=n,offset=index_offset).astype(np.int64).reshape(-1,3);index_offset+=n*size
  buildings.append({**entry,'positions':positions,'facade':indices[:entry['f']//3],'roof':indices[entry['f']//3:]})
 return header,buildings

def tile_of(x,z,size):
 return math.floor(x/size),math.floor(z/size)

def tile_name(tx,tz):
 return f't_{tx}_{tz}.bin'
