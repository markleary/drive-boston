#!/usr/bin/env python3
"""Cache openly licensed OSM park paths and water outlines for Boston's parks.

Official Boston park and water polygons are preferred by build-city.py. OSM is
used for the pedestrian network and bridge alignment, not driving road geometry.
Requires pyproj; public endpoints are only queried during offline preparation.
"""
from __future__ import annotations
import argparse,json,pathlib,time,urllib.parse,urllib.request,xml.etree.ElementTree as ET,concurrent.futures
from pyproj import Transformer

ENDPOINTS=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']
BBOX=[42.337,-71.111,42.359,-71.059]
FT=1200/3937
TO_FEET=Transformer.from_crs(4326,2249,always_xy=True)

def xy(lon,lat):
 x,y=TO_FEET.transform(lon,lat)
 return [round((x-771100)*FT,3),round(-(y-2952900)*FT,3)]

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=pathlib.Path,required=True);p.add_argument('--osm-api',action='store_true');args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
 raw_path=args.output/'park-osm-source.json'
 query='[out:json][timeout:180];('+''.join(f'way["highway"="{kind}"]({",".join(map(str,BBOX))});' for kind in ['footway','path','pedestrian','steps'])+f'way["natural"="water"]({",".join(map(str,BBOX))});way["leisure"="park"]({",".join(map(str,BBOX))});node["historic"="monument"]({",".join(map(str,BBOX))}););out tags geom;'
 if not raw_path.exists() and args.osm_api:
  boxes=[[-71.073,42.3505,-71.0615,42.3585],[-71.100,42.3375,-71.088,42.3475],[-71.094,42.3475,-71.071,42.3545]]
  def get_map(box):
   url='https://api.openstreetmap.org/api/0.6/map?bbox='+','.join(map(str,box))
   req=urllib.request.Request(url,headers={'User-Agent':'DriveBostonParkData/0.1'})
   with urllib.request.urlopen(req,timeout=150) as response:return ET.fromstring(response.read())
  elements={}
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   for root in pool.map(get_map,boxes):
    nodes={n.attrib['id']:{'lat':float(n.attrib['lat']),'lon':float(n.attrib['lon'])} for n in root.findall('node')}
    for way in root.findall('way'):
     tags={t.attrib['k']:t.attrib['v'] for t in way.findall('tag')}
     if tags.get('highway') not in ['footway','path','pedestrian','steps'] and tags.get('natural')!='water' and tags.get('leisure')!='park':continue
     refs=[n.attrib['ref'] for n in way.findall('nd')]
     if not all(n in nodes for n in refs):continue
     identifier=int(way.attrib['id']);elements[identifier]={'type':'way','id':identifier,'tags':tags,'geometry':[nodes[n] for n in refs]}
  raw_path.write_text(json.dumps({'elements':list(elements.values()),'source':'OpenStreetMap API 0.6 map download','bbox':boxes}))
 if not raw_path.exists():
  last=None
  for endpoint in ENDPOINTS:
   try:
    req=urllib.request.Request(endpoint,data=urllib.parse.urlencode({'data':query}).encode(),headers={'User-Agent':'DriveBostonParkData/0.1'})
    with urllib.request.urlopen(req,timeout=210) as response:payload=response.read()
    data=json.loads(payload)
    if 'elements' not in data:raise RuntimeError(data)
    raw_path.write_bytes(payload);break
   except Exception as e:last=e
  else:raise RuntimeError(last)
 raw=json.loads(raw_path.read_text());paths=[];water=[];parks=[];monuments=[]
 for item in raw['elements']:
  t=item.get('tags',{});points=[xy(p['lon'],p['lat']) for p in item.get('geometry',[])];identifier=f"osm-{item['type']}-{item['id']}"
  if t.get('highway') and len(points)>1 and t.get('area')!='yes':
   try:width=float(t.get('width',3.5 if t['highway']=='pedestrian' else 2.6))
   except ValueError:width=2.6
   paths.append({'id':identifier,'points':points,'width':max(1,min(width,8)),'bridge':t.get('bridge','no')!='no','name':t.get('name',''),'kind':t['highway']})
  if t.get('natural')=='water' and len(points)>3 and points[0]==points[-1]:water.append({'id':identifier,'name':t.get('name','Water'),'rings':[points[:-1]]})
  if t.get('leisure')=='park' and len(points)>3 and points[0]==points[-1]:parks.append({'id':identifier,'name':t.get('name','Park'),'rings':[points[:-1]]})
  if item['type']=='node' and t.get('historic')=='monument':monuments.append({'id':identifier,'name':t.get('name','Monument'),'position':xy(item['lon'],item['lat'])})
 provenance={'name':'OpenStreetMap park paths and water outlines','url':'https://www.openstreetmap.org/copyright','license':'OpenStreetMap contributors, ODbL 1.0','retrieved':'2026-10-27','bbox':raw.get('bbox',BBOX),'method':raw.get('source','Overpass API query'),'endpoint':'https://api.openstreetmap.org/api/0.6/map' if raw.get('source') else ENDPOINTS[0],'query':None if raw.get('source') else query,'timestamp':raw.get('osm3s',{}).get('timestamp_osm_base')}
 (args.output/'parks-runtime.json').write_text(json.dumps({'parkPaths':paths,'water':water,'parks':parks,'parkMonuments':monuments,'provenance':provenance},separators=(',',':'))+'\n')
 print(json.dumps({'paths':len(paths),'water':len(water),'parks':len(parks),'monuments':len(monuments),'output':str(args.output/'parks-runtime.json')}))

if __name__=='__main__':main()
