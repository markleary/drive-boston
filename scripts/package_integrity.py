"""Linear integrity checks for the shipped metro files, without generator replay.

DBT2/DBF2 layouts mirror tileformat.py and the runtime readers. Geometry quality,
source provenance and regeneration equivalence remain in validate-city.py.
"""
import gzip
import json
import math
import pathlib
import re
import struct

import numpy as np

from building_collision_policy import exact_far_collision

FLOAT32_MAX=np.finfo(np.float32).max


def require(condition, message):
 if not condition:raise ValueError(message)


def finite_float(value):
 result=float(value)
 require(math.isfinite(result),f'non-finite JSON number: {value}')
 return result


def invalid_constant(value):
 raise ValueError(f'non-finite JSON number: {value}')


def parse_json(raw):
 return json.loads(raw,parse_float=finite_float,parse_constant=invalid_constant)


def integer(value, minimum=0):
 return type(value) is int and value>=minimum


def point(value, dimensions):
 return isinstance(value,list) and len(value)==dimensions and all(type(v) in (int,float) and math.isfinite(v) for v in value)


def read_gzip(path):
 raw=path.read_bytes()
 require(len(raw)>=10 and raw[:4]==b'\x1f\x8b\x08\0' and raw[4:8]==b'\0'*4,f'{path.name}: non-reproducible gzip header')
 return gzip.decompress(raw)


def container(raw, magic):
 require(len(raw)>=8 and raw[:4]==magic,f'expected {magic.decode()} container')
 length=struct.unpack_from('<I',raw,4)[0]
 require(8+length<=len(raw),'truncated container header')
 header=parse_json(raw[8:8+length]);body=(8+length+3)&~3
 require(body<=len(raw),'truncated container padding')
 return header,body


def far_records(raw, size, keys):
 header,body=container(raw,b'DBF2')
 require(header['size']==size,'far tile size differs from manifest')
 result={};offset=body
 for tile in header['tiles']:
  key=tile['key']
  require(key in keys and key not in result,f'far tile {key}: absent or duplicate manifest key')
  require(integer(tile['count']) and integer(tile['offset']) and body+tile['offset']==offset,f'far tile {key}: invalid offset/count')
  primaries=[];previous=None
  for _ in range(tile['count']):
   require(offset+8<=len(raw),f'far tile {key}: truncated record')
   points,height,base,flags,style=struct.unpack_from('<HHhBB',raw,offset)
   require(3<=points<=60 and height>0 and flags<=15,f'far tile {key}: invalid record')
   offset+=8+points*4
   require(offset<=len(raw),f'far tile {key}: truncated footprint')
   if flags&8:
    require(previous is not None and previous&4 and flags&4 and flags&2==previous&2,f'far tile {key}: orphan or inconsistent massing fragment')
   else:
    primaries.append((height/100,base/100,flags));previous=flags
  result[key]=primaries
 require(offset==len(raw),'far container has unreferenced bytes')
 return result


def tile_records(raw, key, size, far, buildings):
 header,body=container(raw,b'DBT2');tx,tz=map(int,key.split('_'))
 require((header['tx'],header['tz'],header['size'])==(tx,tz,size),f'{key}: wrong tile coordinates/size')
 entries=header['buildings'];vertices=header['vertexCount'];width=header['indexBytes']
 require(integer(vertices) and width in (2,4),f'{key}: invalid vertex count/index width')
 require(len(entries)==len(far),f'{key}: detailed/far building counts differ')
 require(all(integer(b.get('v'),1) and integer(b.get('f')) and integer(b.get('r')) and b['f']%3==b['r']%3==0 and b['f']+b['r']>0 for b in entries),f'{key}: invalid building vertex/triangle counts')
 require(sum(b['v'] for b in entries)==vertices,f'{key}: vertex count differs from building records')
 indices=(body+vertices*6+3)&~3
 require(indices+sum(b['f']+b['r'] for b in entries)*width==len(raw),f'{key}: truncated or unreferenced geometry bytes')
 triangles=0
 for b,(height,base,flags) in zip(entries,far):
  identifier=b['id'];label=f'{key}/{identifier}'
  require(isinstance(identifier,str) and identifier and identifier not in buildings,f'{label}: duplicate or invalid building ID')
  require(point(b['center'],2) and tx*size<=b['center'][0]<(tx+1)*size and tz*size<=b['center'][1]<(tz+1)*size,f'{label}: building outside owning tile')
  require(len(b['footprint'])>=3 and all(point(p,2) for p in b['footprint']),f'{label}: invalid footprint')
  require(point(b['anchor'],3) and b.get('scale',.01) in (.01,.02,.05,.1),f'{label}: invalid anchor/scale')
  require(b['height']>0 and abs(height-b['height'])<.011 and abs(base-b['baseElevation'])<.011,f'{label}: detailed/far height or base differs')
  require(bool(flags&2)==exact_far_collision(b),f'{label}: detailed/far collision policy differs')
  positions=np.frombuffer(raw,dtype='<i2',count=b['v']*3,offset=body).reshape(-1,3)*b.get('scale',.01)+np.asarray(b['anchor'])
  require(np.isfinite(positions).all() and (np.abs(positions)<=FLOAT32_MAX).all(),f'{label}: non-finite runtime positions')
  count=b['f']+b['r'];faces=np.frombuffer(raw,dtype='<u4' if width==4 else '<u2',count=count,offset=indices)
  require(int(faces.max())<b['v'],f'{label}: vertex index out of range')
  body+=b['v']*6;indices+=count*width;triangles+=count//3
  buildings[identifier]={'center':b['center'],'partOf':b.get('partOf')}
 return triangles


def validate_package(data_dir):
 data_dir=pathlib.Path(data_dir)
 city=parse_json((data_dir/'city.json').read_bytes())
 provenance=parse_json((data_dir/'provenance.json').read_bytes())
 require(provenance.get('region')=='metro','expected a metro package')
 for key in ('origin','bounds','coverage','spawn','elevation','tiles','landmarkBuildings','roads','signals','landmarks','neighborhoods','parks','water'):
  require(key in city,f'city.json lacks {key}')
 grid=city['elevation']
 require(grid['encoding']=='int16-gzip' and integer(grid['width'],2) and integer(grid['height'],2) and grid['cellSize']>0 and grid.get('scale',.01)>0,'invalid elevation dimensions/encoding')
 for name in (grid['file'],grid['source']):
  raw=read_gzip(data_dir/name)
  require(len(raw)==grid['width']*grid['height']*2,f'{name}: elevation byte count differs from dimensions')
  heights=np.frombuffer(raw,dtype='<i2').astype(np.float64)*grid.get('scale',.01)
  require(np.isfinite(heights).all() and (np.abs(heights)<=FLOAT32_MAX).all(),f'{name}: non-finite runtime heights')
 tiles=city['tiles'];keys=tiles['keys'];size=tiles['size'];directory=data_dir/tiles['directory']
 require(size>0 and all(isinstance(k,str) and re.fullmatch(r'-?\d+_-?\d+',k) for k in keys) and len(keys)==len(set(keys)),'invalid or duplicate manifest tile keys')
 require({f't_{k}.bin' for k in keys}=={p.name for p in directory.glob('*.bin')},'tile manifest differs from files shipped')
 far=far_records(read_gzip(data_dir/tiles['far']),size,set(keys))
 require(sum(map(len,far.values()))==tiles['buildingCount'],'far building count differs from manifest')
 buildings={};triangles=0
 for key in keys:
  try:triangles+=tile_records(read_gzip(directory/f't_{key}.bin'),key,size,far.get(key,[]),buildings)
  except (ValueError,KeyError,TypeError,struct.error) as error:raise ValueError(f'tile {key}: {error}') from error
 require(len(buildings)==tiles['buildingCount'],'detailed building count differs from manifest')
 for identifier,b in buildings.items():
  require(not b['partOf'] or b['partOf'] in buildings,f'{identifier}: missing supporting building {b["partOf"]}')
 for b in city['landmarkBuildings']:
  require(b['id'] in buildings and buildings[b['id']]['center']==b['center'],f'{b["id"]}: landmark index differs from tile')
 # These files are loaded separately by resolveCity/main. Parse them without
 # reconstructing their road network, terrain grading or procedural geometry.
 tunnels=city.get('tunnels',{});sidecars=tunnels.get('files') or ([tunnels['file']] if tunnels.get('file') else [])
 for name in dict.fromkeys([*sidecars,'transit.json']):
  payload=parse_json((data_dir/name).read_bytes())
  required=('roads','landmarks','sources') if name in sidecars else ('routes',)
  require(all(isinstance(payload.get(field),list) for field in required),f'{name}: missing runtime arrays')
 if (data_dir/'rail.json').exists():parse_json((data_dir/'rail.json').read_bytes())
 return {'tiles':len(keys),'buildings':len(buildings),'triangles':triangles,'elevationSamples':grid['width']*grid['height']}
