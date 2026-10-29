#!/usr/bin/env python3
"""Install source-verified Chelsea places, DCR park geometry and walking paths."""
import argparse,gzip,hashlib,importlib.util,json,math,pathlib,struct
from shapely.geometry import Point,LineString
from shapely.ops import unary_union
from tileformat import write_gzip

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('metro',ROOT/'scripts/build-metro.py');metro=importlib.util.module_from_spec(spec);spec.loader.exec_module(metro)
PARK_ID='park-osm-relation-3079557-0-0'
PATH_PREFIX='chelsea-mary-path-'


def unpack(path):
 raw=gzip.decompress(path.read_bytes());length=struct.unpack_from('<I',raw,4)[0]
 return json.loads(raw[8:8+length]),raw[(8+length+3)//4*4:]


def write_header(path,header,payload):
 encoded=json.dumps(header,separators=(',',':')).encode();raw=b'DBT2'+struct.pack('<I',len(encoded))+encoded;write_gzip(path,raw+b'\0'*((-len(raw))%4)+payload)


def install(data_dir,source_file):
 city_path=data_dir/'city.json';city=json.loads(city_path.read_text());source=json.loads(source_file.read_text());park=unary_union(metro.osm_polygons(source['park'],require_complete=True)).simplify(.3,preserve_topology=True)
 city['parks']=[p for p in city['parks'] if p['id']!=PARK_ID]+[{'id':PARK_ID,'name':"Mary O'Malley State Park",'rings':metro.polygon_rings(park),'kind':'park'}]
 area=park.buffer(1);paths=[]
 for e in source['paths']:
  tags=e.get('tags',{});points=[metro.xy(p['lon'],p['lat']) for p in e.get('geometry',[])];kind=tags.get('highway')
  if len(points)<2 or kind not in ['footway','path','pedestrian','steps','cycleway']:continue
  try:width=float(tags.get('width',2.6))
  except (TypeError,ValueError):width=2.6
  for i,points in enumerate(metro.central.clipped_lines(points,area)):
   paths.append({'id':PATH_PREFIX+str(e['id'])+f'-{i}','points':points,'width':max(1,min(width,8)),'bridge':tags.get('bridge','no')!='no','name':tags.get('name',''),'kind':kind})
 tile_paths={};size=city['tiles']['size']
 for path in paths:
  bounds=LineString(path['points']).bounds;fragments=[]
  for tx in range(math.floor(bounds[0]/size),math.floor(bounds[2]/size)+1):
   for tz in range(math.floor(bounds[1]/size),math.floor(bounds[3]/size)+1):
    for i,points in enumerate(metro.clip_to_tile(path['points'],tx,tz)):fragments.append((tx,tz,i,points))
  for tx,tz,i,points in fragments:
   item={**path,'id':path['id']+f'-{tx}_{tz}_{i}','points':points}
   if path['bridge'] and len(fragments)>1:item['bridgePoints']=path['points']
   tile_paths.setdefault(f'{tx}_{tz}',[]).append(item)
 keys=set(city['tiles']['keys']);all_buildings=[];changed=[]
 for key in sorted(keys|set(tile_paths),key=lambda v:tuple(map(int,v.split('_')))):
  path=data_dir/'tiles'/f't_{key}.bin'
  if path.exists():header,payload=unpack(path)
  else:
   tx,tz=map(int,key.split('_'));header={'tx':tx,'tz':tz,'size':size,'buildings':[],'curbs':[],'parkPaths':[],'roads':[],'indexBytes':2,'vertexCount':0};payload=b'';keys.add(key)
  all_buildings.extend(header['buildings']);before=json.dumps(header,separators=(',',':'));kept=[]
  for old in header['parkPaths']:
   if old['id'].startswith(PATH_PREFIX):continue
   line=LineString(old['points'])
   if line.intersection(area).length<.05:kept.append(old);continue
   remaining=line.difference(area);parts=metro.polygon_parts_lines(remaining)
   for i,part in enumerate(parts):
    if part.length>.5:kept.append({**old,'id':old['id']+f'-outside-mary-{i}','points':[metro.rounded(p) for p in part.coords]})
  header['parkPaths']=kept+tile_paths.get(key,[])
  if before!=json.dumps(header,separators=(',',':')):write_header(path,header,payload);changed.append(key)
 city['tiles']['keys']=sorted(keys,key=lambda v:tuple(map(int,v.split('_'))))
 places=[]
 for record in source['places']:
  point=metro.rounded(metro.xy(record['longitude'],record['latitude']));near=[b for b in all_buildings if math.dist(b['center'],point)<600]
  roads=[r for r in city['roads'] if r['id']==record['arrivalRoadId']]
  if not roads:roads=[r for r in city['roads'] if r['name']==record['arrivalStreet'] and LineString(r['points']).distance(Point(point))<600]
  assert roads,f'Missing named arrival street for {record["id"]}'
  arrival=metro.central.safe_arrival(point,roads,near);road=metro.nearest_road(roads,[arrival['x'],arrival['z']])
  if road.get('elevations'):arrival['roadId']=road['id']
  entry={'id':record['id'],'name':record['name'],'position':point,'description':record['description'],'driveStart':arrival}
  city['landmarks']=[entry if p['id']==entry['id'] else p for p in city['landmarks']]
  places.append({**record,'position':point,'driveStart':arrival,'arrivalRoadId':road['id']})
 city_path.write_text(json.dumps(city,separators=(',',':'))+'\n')
 pp=data_dir/'provenance.json';provenance=json.loads(pp.read_text());provenance['chelseaPlaces']={'sourceSHA256':hashlib.sha256(source_file.read_bytes()).hexdigest(),'places':places,'park':{'osmRelation':3079557,'reference':source['parkReference'],'areaSquareMeters':round(park.area),'pathWays':len(source['paths']),'pathFragments':sum(map(len,tile_paths.values()))},'method':'Named square polygon, named square junction and DCR waterfront park; safe arrivals on Broadway and Commandants Way. Full multipolygon member geometry retained and source park paths clipped into existing DBT2 tiles.'};provenance['tiles']['count']=len(keys)
 pp.write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 return {'places':[p['id'] for p in places],'parkAreaSquareMeters':round(park.area),'pathFragments':sum(map(len,tile_paths.values())),'changedTiles':changed}


if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');parser.add_argument('--source-file',type=pathlib.Path,default=ROOT/'public/data/chelsea-places-source.json');a=parser.parse_args();print(json.dumps(install(a.data_dir,a.source_file),indent=2))
