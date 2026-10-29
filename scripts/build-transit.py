#!/usr/bin/env python3
"""Compile an offline MBTA extract: the western Green Line B/C/D/E surface tracks and the typical
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
# Directed western branches, from their outer terminus to the named surface portal way.
# Keep the short D branch underpasses; exclude the central subway and northern viaduct.
GREEN_BRANCHES={
 'Green-B':{0:('11359933','196203216'),1:('2887650','534703890')},
 'Green-C':{0:('11359934','832397801'),1:('2887651','832397802')},
 'Green-D':{0:('10099593','832410941'),1:('2887652','832410940')},
}
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
def typical_patterns(args,route):
 raw=fetch(args,route,'route_patterns',{'filter[route]':route,'include':'representative_trip'});trips={t['id']:t for t in raw.get('included',[])if t['type']=='trip'};chosen={}
 for pattern in sorted(raw['data'],key=lambda p:(p['attributes']['direction_id'],p['attributes'].get('sort_order',0))):
  a=pattern['attributes'];trip=trips[pattern['relationships']['representative_trip']['data']['id']]
  # Through-routed trips list other routes' patterns (the 39 carries 21/32/38 ones).
  if pattern['relationships']['route']['data']['id']!=route or a['typicality']!=1 or a['direction_id'] in chosen:continue
  chosen[a['direction_id']]=(trip['relationships']['shape']['data']['id'],f"{route.removeprefix('Green-')} {trip['attributes']['headsign'].upper()}")
 if len(chosen)!=2:raise ValueError(f'Route {route} needs one typical pattern per direction, found {chosen}')
 return[(*chosen[d],d)for d in (0,1)]
def surface_track(args,line,direction):
 relation_id,portal_way=GREEN_BRANCHES[line][direction];file=args.cache/f'green-{relation_id}.osm'
 if args.download or not file.exists():
  with urllib.request.urlopen(f'https://api.openstreetmap.org/api/0.6/relation/{relation_id}/full',timeout=120)as response:file.write_bytes(response.read())
 osm=ET.fromstring(file.read_bytes());nodes={n.attrib['id']:[float(n.attrib['lon']),float(n.attrib['lat'])]for n in osm.findall('node')};ways={w.attrib['id']:w for w in osm.findall('way')}
 relation=next(r for r in osm.findall('relation')if r.attrib['id']==relation_id)
 tracks=[]
 for member in relation.findall('member'):
  if member.attrib['type']!='way':continue
  way=ways[member.attrib['ref']];tags={t.attrib['k']:t.attrib['v']for t in way.findall('tag')}
  if tags.get('railway')=='light_rail':tracks.append((way,tags))
 portal=next(i for i,(way,_)in enumerate(tracks)if way.attrib['id']==portal_way)
 tracks=tracks[portal:]if direction==0 else tracks[:portal+1]
 refs=[];covered=[];bridges=[];distance=0;ids=[]
 for way,tags in tracks:
  part=[n.attrib['ref']for n in way.findall('nd')]
  if refs and refs[-1]==part[-1]:part.reverse()
  if refs and refs[-1]!=part[0]:raise ValueError(f'Disconnected {line} track at way {way.attrib["id"]}')
  length=LineString([world(*nodes[n])for n in part]).length
  if tags.get('tunnel','no')!='no' or tags.get('covered','no')!='no':covered.append({'start':distance,'end':distance+length})
  if tags.get('bridge','no')!='no':bridges.append({'start':distance,'end':distance+length})
  refs.extend(part if not refs else part[1:]);ids.append(way.attrib['id']);distance+=length
 return [nodes[n]for n in refs],ids,covered,bridges,relation_id

def clearance_track(points):
 # The shipped 118 Davis Avenue footprint leaves only 20 cm beside the source D
 # centerline, and the next house at 5 Elm touches the vehicle's edge. Shift BOTH
 # tracks south, preserving their separation; each small offset has cosine tapers.
 # This is a local game alignment correction, not a surveyed track relocation.
 adjusted=[]
 for a,b in zip(points,points[1:]):
  local=min(a[0],b[0])<-3998 and max(a[0],b[0])>-4119 and abs((a[1]+b[1])/2-2100)<100
  steps=max(1,math.ceil(math.dist(a,b)/2))if local else 1
  for i in range(steps):
   t=i/steps;x=a[0]+(b[0]-a[0])*t;z=a[1]+(b[1]-a[1])*t
   if abs(z-2100)<100:
    for center,offset,plateau,taper in [(-4038,1.6,10,30),(-4099,.6,5,15)]:
     distance=abs(x-center)
     if distance<plateau+taper:z+=offset*(1 if distance<=plateau else .5+.5*math.cos(math.pi*(distance-plateau)/taper))
   adjusted.append([x,z])
 adjusted.append(points[-1]);return LineString(adjusted)

def main():
 p=argparse.ArgumentParser();p.add_argument('--cache',type=pathlib.Path,default=ROOT/'data-source-cache/transit');p.add_argument('--output',type=pathlib.Path,default=ROOT/'public/data/transit.json');p.add_argument('--download',action='store_true');args=p.parse_args();args.cache.mkdir(parents=True,exist_ok=True)
 for kind in ['shapes','stops']:fetch(args,'Green-E',kind,{'filter[route]':'Green-E'})
 selected=[('Green-E',shape,'tram',destination,1 if i==0 else 0)for i,(shape,(destination,_))in enumerate(GREEN_E.items())]
 for line in GREEN_BRANCHES:
  for kind in ['shapes','stops']:fetch(args,line,kind,{'filter[route]':line})
  selected.extend((line,shape,'tram',destination,direction)for shape,destination,direction in typical_patterns(args,line))
 for route in BUS_ROUTES:
  for kind in ['shapes','stops']:fetch(args,route,kind,{'filter[route]':route})
  selected.extend((route,shape,'bus',destination,direction)for shape,destination,direction in typical_patterns(args,route))
 nodes={};ways={}
 for name,bbox in [('huntington-portal','-71.090,42.339,-71.085,42.344'),('huntington-middle','-71.104,42.333,-71.090,42.340'),('huntington-south','-71.113,42.3279,-71.102,42.335')]:
  file=args.cache/(name+'.osm')
  if args.download or not file.exists():
   with urllib.request.urlopen('https://api.openstreetmap.org/api/0.6/map?bbox='+bbox,timeout=120)as response:file.write_bytes(response.read())
  osm=ET.fromstring(file.read_bytes());nodes.update({n.attrib['id']:[float(n.attrib['lon']),float(n.attrib['lat'])]for n in osm.findall('node')});ways.update({w.attrib['id']:[n.attrib['ref']for n in w.findall('nd')]for w in osm.findall('way')})
 city=json.loads((ROOT/'public/data/city.json').read_text());coverage=unary_union([Polygon(p)for p in city['coverage']]);inside=prep(coverage.buffer(-7));routes=[]
 for line,shape_id,kind,destination,direction in selected:
  raw=json.loads((args.cache/f'{line}-shapes.json').read_text());shape=next(s for s in raw['response']['data'] if s['id']==shape_id)
  geographic=polyline(shape['attributes']['polyline'])
  # OSM tunnel portal ways642267568/642267673 meet surface at42.340976/42.341002.
  # Do not paint the Green Line subway as tracks through downtown streets.
  covered=[];bridges=[];relation_id=None;ids=[]
  if line in GREEN_BRANCHES:geographic,ids,covered,bridges,relation_id=surface_track(args,line,direction)
  elif kind=='tram':
   ids=GREEN_E[shape_id][1]
   path=[]
   for id in ids:
    refs=ways[id]
    if path and path[-1]!=refs[0]:raise ValueError('Disconnected mapped rail ways')
    path.extend(refs if not path else refs[1:])
   geographic=[nodes[id]for id in path]
  source=LineString([world(*p)for p in geographic]);runs=[]
  if line=='Green-D':
   original=source;source=clearance_track(list(source.coords))
   for spans in [covered,bridges]:
    for span in spans:
     span['start']=source.project(original.interpolate(span['start']));span['end']=source.project(original.interpolate(span['end']))
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
   # MBTA parent-station coordinates can sit beyond a terminal platform end (Cleveland
   # Circle is 54 m beyond the inbound route's first node). Place its dwell inside the
   # mapped platform with room for a single car; never extend a track beyond coverage.
   terminal=line in GREEN_BRANCHES and a['name'] in ['Boston College','Cleveland Circle']
   if geometry.distance(pt)>(60 if terminal else 25):continue
   along=geometry.project(pt)
   if terminal:along=max(25,min(geometry.length-25,along))
   if along<15 or along>geometry.length-15:continue
   at=geometry.interpolate(along);stops.append({'id':stop['id'],'name':a['name'],'distance':round(along,3),'position':[round(at.x,3),round(at.y,3)]})
  stops.sort(key=lambda s:s['distance']);dedup=[]
  for s in stops:
   if not dedup or s['distance']-dedup[-1]['distance']>35:dedup.append(s)
  route={'id':shape_id,'line':line,'kind':kind,'destination':destination,'points':[[round(x,3),round(z,3)]for x,z in points],'stops':dedup,'length':round(geometry.length,3),'sourceShape':shape_id,'sourceWays':ids,'coveragePercent':kept}
  if kind=='tram':route['directionId']=direction
  if relation_id:route['sourceRelation']=relation_id
  if line=='Green-D':route['alignmentNote']='Both tracks shift south by up to 1.6 m beside the shipped 118 Davis Avenue footprint (osm-way-29919123), and 0.6 m beside 5 Elm Street (osm-way-29903831), with smooth 30/15 m approaches; original game clearance corrections, not surveyed relocations.'
  spans=[{'start':round(max(0,c['start']-start),3),'end':round(min(geometry.length,c['end']-start),3)}for c in covered if c['end']>start and c['start']<end]
  if spans:route['covered']=spans
  bridge_spans=[{'start':round(max(0,c['start']-start),3),'end':round(min(geometry.length,c['end']-start),3)}for c in bridges if c['end']>start and c['start']<end]
  if bridge_spans:route['bridges']=sorted(bridge_spans,key=lambda s:s['start'])
  routes.append(route)
 result={'routes':routes,'sources':[{'name':'MBTA V3 public route shapes and stops','url':'https://www.mbta.com/developers/v3-api','license':'MassDOT developer data terms; MBTA attribution retained'},{'name':'OpenStreetMap separate directed Green Line surface tracks','url':'https://www.openstreetmap.org/relation/2887650','license':'© OpenStreetMap contributors, ODbL 1.0'}],'notes':'Original interpretive MBTA-style vehicles. Western Green-B/C/D/E branches use separate directed OSM tracks and MBTA station names/positions. B/C/D terminate at the Blandford Street, Saint Mary’s Street and Fenway subway portals; E ends north of Northeastern. Short D branch underpasses are retained as covered spans. The D is clipped at the Brookline/Newton boundary; northern Green Line extensions and the central subway are not modeled. Buses follow the typical MBTA pattern of each listed route in both directions, clipped to the playable coverage (coveragePercent records how much of the source shape is kept); destination signs show the MBTA headsign. Operating speed, dwell, traffic behavior and frequency are game assumptions; no real-time service or timetable.'}
 args.output.write_text(json.dumps(result,separators=(',',':'))+'\n');print(json.dumps([{k:r[k]for k in ['id','line','destination','length','coveragePercent']}|{'stops':len(r['stops'])}for r in routes],indent=1))
if __name__=='__main__':main()
