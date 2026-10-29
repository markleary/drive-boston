"""Refresh postprocessed road ownership without re-encoding tile meshes."""
import gzip,json,math,struct
from shapely.geometry import LineString,box
from tileformat import write_gzip,write_tile,tile_name


def refresh_road_tiles(data_dir,city,roads,removed_ids=()):
 size=city['tiles']['size'];owned={r['id'] for r in roads}|set(removed_ids);wanted={}
 for road in roads:
  line=LineString(road['points']);x0,z0,x1,z1=line.bounds;radius=max(road.get('deckWidths',[]) or [road['width']])/2+2
  x0-=radius;z0-=radius;x1+=radius;z1+=radius
  for tx in range(math.floor(x0/size),math.floor(x1/size)+1):
   for tz in range(math.floor(z0/size),math.floor(z1/size)+1):
    if box(tx*size,tz*size,(tx+1)*size,(tz+1)*size).buffer(radius).intersects(line):wanted.setdefault((tx,tz),set()).add(road['id'])
 changed=[];keys=set(city['tiles']['keys'])
 for key in sorted(keys|{f'{tx}_{tz}' for tx,tz in wanted}):
  tx,tz=map(int,key.split('_'));path=data_dir/'tiles'/tile_name(tx,tz);ids=wanted.get((tx,tz),set())
  if path.exists():
   raw=gzip.decompress(path.read_bytes());length=struct.unpack_from('<I',raw,4)[0];header=json.loads(raw[8:8+length]);payload=raw[(8+length+3)//4*4:]
   updated=sorted((set(header['roads'])-owned)|ids)
   if header['roads']==updated:continue
   header['roads']=updated;encoded=json.dumps(header,separators=(',',':')).encode();result=b'DBT2'+struct.pack('<I',len(encoded))+encoded
   result+=b'\0'*((-len(result))%4)+payload;write_gzip(path,result)
  elif ids:
   write_tile(path,{'tx':tx,'tz':tz,'size':size,'buildings':[],'curbs':[],'parkPaths':[],'roads':sorted(ids)},[]);keys.add(key)
  else:continue
  changed.append(key)
 city['tiles']['keys']=sorted(keys,key=lambda key:tuple(map(int,key.split('_'))))
 return changed
