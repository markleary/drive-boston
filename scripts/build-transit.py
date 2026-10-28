#!/usr/bin/env python3
"""Compile a small, offline MBTA Huntington corridor (no live service promises)."""
import argparse,json,pathlib,urllib.parse,urllib.request,math,xml.etree.ElementTree as ET
from pyproj import Transformer
from shapely.geometry import Polygon,LineString,Point
from shapely.ops import unary_union
ROOT=pathlib.Path(__file__).resolve().parents[1]
FT=1200/3937
PROJECT=Transformer.from_crs(4326,2249,always_xy=True)
def world(lon,lat):
 x,y=PROJECT.transform(lon,lat);return[(x-771100)*FT,-(y-2952900)*FT]
def polyline(text):
 result=[];last=[0,0];i=0
 while i<len(text):
  for axis in range(2):
   number=0;shift=0
   while True:
    b=ord(text[i])-63;i+=1;number|=(b&31)<<shift;shift+=5
    if b<32:break
   last[axis]+=~(number>>1) if number&1 else number>>1
  result.append([last[1]/1e5,last[0]/1e5])
 return result
def main():
 p=argparse.ArgumentParser();p.add_argument('--cache',type=pathlib.Path,default=ROOT/'data-source-cache/transit');p.add_argument('--output',type=pathlib.Path,default=ROOT/'public/data/transit.json');p.add_argument('--download',action='store_true');args=p.parse_args();args.cache.mkdir(parents=True,exist_ok=True)
 for route in ['Green-E','39']:
  for kind in ['shapes','stops']:
   file=args.cache/f'{route}-{kind}.json';url='https://api-v3.mbta.com/'+kind+'?'+urllib.parse.urlencode({'filter[route]':route})
   if args.download or not file.exists():
    with urllib.request.urlopen(url,timeout=90) as response:data=json.load(response)
    file.write_text(json.dumps({'url':url,'response':data},indent=2))
 nodes={};ways={}
 for name,bbox in [('huntington-portal','-71.090,42.339,-71.085,42.344'),('huntington-middle','-71.104,42.333,-71.090,42.340'),('huntington-south','-71.113,42.3279,-71.102,42.335')]:
  file=args.cache/(name+'.osm')
  if args.download or not file.exists():
   with urllib.request.urlopen('https://api.openstreetmap.org/api/0.6/map?bbox='+bbox,timeout=120)as response:file.write_bytes(response.read())
  osm=ET.fromstring(file.read_bytes());nodes.update({n.attrib['id']:[float(n.attrib['lon']),float(n.attrib['lat'])]for n in osm.findall('node')});ways.update({w.attrib['id']:[n.attrib['ref']for n in w.findall('nd')]for w in osm.findall('way')})
 city=json.loads((ROOT/'public/data/city.json').read_text());coverage=unary_union([Polygon(p)for p in city['coverage']]);routes=[]
 for line,shape_id,kind,destination in [('Green-E','canonical-8000015','tram','E MEDFORD / TUFTS'),('Green-E','canonical-8000018','tram','E HEATH STREET'),('39','390178','bus','39 FOREST HILLS'),('39','390179','bus','39 BACK BAY')]:
  raw=json.loads((args.cache/f'{line}-shapes.json').read_text());shape=next(s for s in raw['response']['data'] if s['id']==shape_id)
  geographic=polyline(shape['attributes']['polyline'])
  # OSM tunnel portal ways642267568/642267673 meet surface at42.340976/42.341002.
  # Do not paint the Green Line subway as tracks through downtown streets.
  if kind=='tram':
   ids=['831542201','9267575','832390268','832390271','832390272'] if shape_id=='canonical-8000015'else ['832390273','832390270','832390269','218004436','831542200']
   path=[]
   for id in ids:
    refs=ways[id]
    if path and path[-1]!=refs[0]:raise ValueError('Disconnected mapped rail ways')
    path.extend(refs if not path else refs[1:])
   geographic=[nodes[id]for id in path]
  source=LineString([world(*p)for p in geographic]);clipped=source.intersection(coverage.buffer(-7));segments=[clipped]if clipped.geom_type=='LineString'else[g for g in clipped.geoms if g.geom_type=='LineString'];geometry=max(segments,key=lambda p:p.length)
  points=list(geometry.coords)
  if source.project(Point(points[-1]))<source.project(Point(points[0])):points.reverse();geometry=LineString(points)
  stops=[]
  for stop in json.loads((args.cache/f'{line}-stops.json').read_text())['response']['data']:
   a=stop['attributes'];pt=Point(world(a['longitude'],a['latitude']))
   if geometry.distance(pt)>25:continue
   along=geometry.project(pt)
   if along<15 or along>geometry.length-15:continue
   at=geometry.interpolate(along);stops.append({'id':stop['id'],'name':a['name'],'distance':round(along,3),'position':[round(at.x,3),round(at.y,3)]})
  stops.sort(key=lambda s:s['distance']);dedup=[]
  for s in stops:
   if not dedup or s['distance']-dedup[-1]['distance']>35:dedup.append(s)
  routes.append({'id':shape_id,'line':line,'kind':kind,'destination':destination,'points':[[round(x,3),round(z,3)]for x,z in points],'stops':dedup,'length':round(geometry.length,3),'sourceShape':shape_id,'sourceWays':ids if kind=='tram'else []})
 result={'routes':routes,'sources':[{'name':'MBTA V3 public route shapes and stops','url':'https://www.mbta.com/developers/v3-api','license':'MassDOT developer data terms; MBTA attribution retained'},{'name':'OpenStreetMap separate Huntington Green Line surface tracks','url':'https://www.openstreetmap.org/way/642267568','license':'© OpenStreetMap contributors, ODbL 1.0'}],'notes':'Original interpretive MBTA-style vehicles. Green-E separate directed OSM tracks with MBTA station names/positions; surface only, ending at the portal north of Northeastern. Buses follow source Route39 geometry from Back Bay south to the existing coverage edge. Operating speed, dwell, traffic behavior and frequency are game assumptions; no real-time service or timetable.'}
 args.output.write_text(json.dumps(result,separators=(',',':'))+'\n');print(json.dumps({'routes':[{k:r[k]for k in ['id','kind','length']}for r in routes],'stops':[len(r['stops'])for r in routes]},indent=2))
if __name__=='__main__':main()
