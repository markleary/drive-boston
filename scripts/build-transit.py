#!/usr/bin/env python3
"""Compile an offline MBTA extract: the Green Line E surface tracks and the typical
pattern of each listed bus route, clipped to the playable coverage (no live service promises)."""
import argparse,json,pathlib,time,urllib.error,urllib.parse,urllib.request,math,xml.etree.ElementTree as ET
from pyproj import Transformer
from shapely.geometry import Polygon,LineString,Point
from shapely.ops import unary_union,substring
from shapely.prepared import prep
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
GREEN_E={'canonical-8000015':('E MEDFORD / TUFTS',['831542201','9267575','832390268','832390271','832390272']),'canonical-8000018':('E HEATH STREET',['832390273','832390270','832390269','218004436','831542200'])}
# Typical (typicality 1) MBTA bus patterns, one per direction; each is clipped to coverage.
BUS_ROUTES=['39','1','66','28','23','57','86','9']
# Station busways and the Harvard Square bus tunnel are not streets: metres cut from the
# (start, end) of a shape so a bus begins and finishes on the public road (the Forest Hills,
# Ruggles and Mattapan busways, and the tunnel portal below Harvard Square).
TRIM={'390179':(40,0),'280217':(95,25),'230246':(75,0),'660341':(0,230),'860193':(0,225)}
def fetch(args,route,kind,query):
 file=args.cache/f'{route}-{kind}.json';url='https://api-v3.mbta.com/'+kind+'?'+urllib.parse.urlencode(query)
 if args.download or not file.exists():
  for attempt in range(6):
   try:
    with urllib.request.urlopen(url,timeout=90) as response:data=json.load(response);break
   except urllib.error.HTTPError as error:
    # Anonymous MBTA access allows 20 requests a minute; wait out the window.
    if error.code!=429 or attempt==5:raise
    time.sleep(20)
  file.write_text(json.dumps({'url':url,'response':data},indent=2))
 return json.loads(file.read_text())['response']
def bus_patterns(args,route):
 raw=fetch(args,route,'route_patterns',{'filter[route]':route,'include':'representative_trip'});trips={t['id']:t for t in raw.get('included',[])if t['type']=='trip'};chosen={}
 for pattern in sorted(raw['data'],key=lambda p:(p['attributes']['direction_id'],p['attributes'].get('sort_order',0))):
  a=pattern['attributes'];trip=trips[pattern['relationships']['representative_trip']['data']['id']]
  # Through-routed trips list other routes' patterns (the 39 carries 21/32/38 ones).
  if pattern['relationships']['route']['data']['id']!=route or a['typicality']!=1 or a['direction_id'] in chosen:continue
  chosen[a['direction_id']]=(trip['relationships']['shape']['data']['id'],f"{route} {trip['attributes']['headsign'].upper()}")
 if len(chosen)!=2:raise ValueError(f'Route {route} needs one typical pattern per direction, found {chosen}')
 return[chosen[d]for d in (0,1)]
def main():
 p=argparse.ArgumentParser();p.add_argument('--cache',type=pathlib.Path,default=ROOT/'data-source-cache/transit');p.add_argument('--output',type=pathlib.Path,default=ROOT/'public/data/transit.json');p.add_argument('--download',action='store_true');args=p.parse_args();args.cache.mkdir(parents=True,exist_ok=True)
 for kind in ['shapes','stops']:fetch(args,'Green-E',kind,{'filter[route]':'Green-E'})
 selected=[('Green-E',shape,'tram',destination)for shape,(destination,_)in GREEN_E.items()]
 for route in BUS_ROUTES:
  for kind in ['shapes','stops']:fetch(args,route,kind,{'filter[route]':route})
  selected.extend((route,shape,'bus',destination)for shape,destination in bus_patterns(args,route))
 nodes={};ways={}
 for name,bbox in [('huntington-portal','-71.090,42.339,-71.085,42.344'),('huntington-middle','-71.104,42.333,-71.090,42.340'),('huntington-south','-71.113,42.3279,-71.102,42.335')]:
  file=args.cache/(name+'.osm')
  if args.download or not file.exists():
   with urllib.request.urlopen('https://api.openstreetmap.org/api/0.6/map?bbox='+bbox,timeout=120)as response:file.write_bytes(response.read())
  osm=ET.fromstring(file.read_bytes());nodes.update({n.attrib['id']:[float(n.attrib['lon']),float(n.attrib['lat'])]for n in osm.findall('node')});ways.update({w.attrib['id']:[n.attrib['ref']for n in w.findall('nd')]for w in osm.findall('way')})
 city=json.loads((ROOT/'public/data/city.json').read_text());coverage=unary_union([Polygon(p)for p in city['coverage']]);inside=prep(coverage.buffer(-7));routes=[]
 for line,shape_id,kind,destination in selected:
  raw=json.loads((args.cache/f'{line}-shapes.json').read_text());shape=next(s for s in raw['response']['data'] if s['id']==shape_id)
  geographic=polyline(shape['attributes']['polyline'])
  # OSM tunnel portal ways642267568/642267673 meet surface at42.340976/42.341002.
  # Do not paint the Green Line subway as tracks through downtown streets.
  if kind=='tram':
   ids=GREEN_E[shape_id][1]
   path=[]
   for id in ids:
    refs=ways[id]
    if path and path[-1]!=refs[0]:raise ValueError('Disconnected mapped rail ways')
    path.extend(refs if not path else refs[1:])
   geographic=[nodes[id]for id in path]
  source=LineString([world(*p)for p in geographic]);runs=[]
  # Classify the shape every 4 m along its length. The coverage union has seams between its
  # polygons and a bus loop may briefly leave the map at a town line, so runs of samples inside
  # are joined across gaps under 40 m and the longest run of the source shape is kept.
  for s in range(0,int(source.length)+4,4):
   s=min(s,source.length)
   if not inside.contains(source.interpolate(s)):continue
   if runs and s-runs[-1][1]<40:runs[-1][1]=s
   else:runs.append([s,s])
  start,end=max(runs,key=lambda r:r[1]-r[0]);cut=TRIM.get(shape_id,(0,0));geometry=substring(source,start+cut[0],end-cut[1])
  points=list(geometry.coords);kept=round(100*geometry.length/source.length)
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
  routes.append({'id':shape_id,'line':line,'kind':kind,'destination':destination,'points':[[round(x,3),round(z,3)]for x,z in points],'stops':dedup,'length':round(geometry.length,3),'sourceShape':shape_id,'sourceWays':ids if kind=='tram'else [],'coveragePercent':kept})
 result={'routes':routes,'sources':[{'name':'MBTA V3 public route shapes and stops','url':'https://www.mbta.com/developers/v3-api','license':'MassDOT developer data terms; MBTA attribution retained'},{'name':'OpenStreetMap separate Huntington Green Line surface tracks','url':'https://www.openstreetmap.org/way/642267568','license':'© OpenStreetMap contributors, ODbL 1.0'}],'notes':'Original interpretive MBTA-style vehicles. Green-E separate directed OSM tracks with MBTA station names/positions; surface only, ending at the portal north of Northeastern. Buses follow the typical MBTA pattern of each listed route in both directions, clipped to the playable coverage (coveragePercent records how much of the source shape is kept); destination signs show the MBTA headsign. Operating speed, dwell, traffic behavior and frequency are game assumptions; no real-time service or timetable.'}
 args.output.write_text(json.dumps(result,separators=(',',':'))+'\n');print(json.dumps([{k:r[k]for k in ['id','line','destination','length','coveragePercent']}|{'stops':len(r['stops'])}for r in routes],indent=1))
if __name__=='__main__':main()
