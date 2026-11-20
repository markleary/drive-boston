#!/usr/bin/env python3
"""Logan International Airport's airfield: runways, taxiways, aprons, stands, jet bridges and parked aircraft.

The survey the package is built from has the airport's buildings and its landside roads; the airfield itself is bare
ground in it. This stage writes `airfield.json`, a sidecar the runtime drapes on the terrain (src/render/logan-airfield.ts):

* **Runways** come from the FAA's own record (National Airspace System Resources, the cycle effective 29 October 2026,
  read through AirNav's KBOS page): the two ends of each runway by latitude and longitude, its width, the displaced
  thresholds and the marking class of each end. `RUNWAYS` holds that table; every length it gives is checked against the
  published one (`RUNWAY_SLACK`), and every end against the OpenStreetMap runway line (`END_SLACK`), so a slip in either
  source stops the build.
* **Everything else** comes from OpenStreetMap's aeroway features (`osm-logan-aeroways.json` in the source cache, cut
  to the sidecar `logan-airfield-source.json` by `extract`): taxiway and taxilane centre lines, apron outlines, blast
  pads and arrestor beds (stopways), stand lead-in lines, jet bridges, holding positions, and the outlines of the
  buildings on the airport, which parked aircraft keep clear of.

Pavement is compiled here, once, into four layers that do not overlap (runway, taxiway, apron, shoulder), cut to the
land (the airport's outline less mapped water) and filed per 1 km tile, in centimetres from the tile's origin like the
street surfaces. OpenStreetMap carries no taxiway widths: `TAXIWAY` is the 75 ft of the design group Logan's taxiways
are built to, with `TAXI_SHOULDER` beside it. A tile the airfield reaches that the package does not have (no building
stands on the north-east corner of the field, so `build-metro.py` wrote none) is added empty, so its terrain is drawn
and collides like any other.

Aircraft are placed here too, so that the choice is the same on every visit and is checked against the buildings:
`place_aircraft` takes a fixed share of the stands (`stand_draw` hashes the stand's reference), nose toward the
terminal on the lead-in line, each one clear of every building outline and of the aircraft already placed.
"""
from __future__ import annotations
import gzip,hashlib,json,math,pathlib,struct
import shapely
from pyproj import Transformer
from shapely.geometry import LineString,MultiPolygon,Point,Polygon,box
from shapely.ops import linemerge,polygonize,unary_union
from shapely.prepared import prep
from tileformat import write_gzip

SOURCE_NAME='logan-airfield-source.json';OUTPUT_NAME='airfield.json';CACHE_NAME='osm-logan-aeroways.json'
BBOX=[-71.040,42.343,-70.972,42.388]  # west, south, east, north
FT=.3048
METHOD='FAA runway ends, widths, displaced thresholds and marking classes; OpenStreetMap taxiways, aprons, stopways, stands and jet bridges; pavement in four disjoint layers per 1 km tile'
TO_FEET=Transformer.from_crs(4326,2249,always_xy=True);METRES=1200/3937
SOURCES=[{'name':'FAA National Airspace System Resources: Logan International Airport runway ends, widths, displaced thresholds and marking classes','url':'https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/','license':'US Government work; public domain'},
 {'name':'OpenStreetMap aeroway features for Logan International Airport (taxiways, aprons, stands, jet bridges)','url':'https://www.openstreetmap.org/copyright','license':'ODbL 1.0'}]


def world(lon,lat):
 """Longitude and latitude to the package's metres (x east, z south), as every Boston street is projected."""
 e,n=TO_FEET.transform(lon,lat);return ((e-771100)*METRES,-(n-2952900)*METRES)


def dm(degrees,minutes):return degrees+minutes/60
# FAA NASR, effective 29 October 2026 (AirNav KBOS). Ends in degrees and decimal minutes (north, west), feet otherwise.
RUNWAYS=[
 {'id':'04L/22R','length':7864,'width':150,'grooved':True,'ends':[{'name':'4L','at':((42,21.479295),(71,0.860312)),'displaced':0,'marking':'precision'},{'name':'22R','at':((42,22.697932),(71,0.270832)),'displaced':819,'marking':'precision'}]},
 {'id':'04R/22L','length':10006,'width':150,'grooved':True,'ends':[{'name':'4R','at':((42,21.063490),(71,0.707633)),'displaced':1155,'marking':'precision'},{'name':'22L','at':((42,22.613998),(70,59.957455)),'displaced':1199,'marking':'precision'}]},
 {'id':'09/27','length':7001,'width':150,'grooved':True,'ends':[{'name':'9','at':((42,21.345250),(71,0.773645)),'displaced':0,'marking':'basic'},{'name':'27','at':((42,21.612945),(70,59.262127)),'displaced':0,'marking':'precision'}]},
 {'id':'14/32','length':5000,'width':100,'grooved':True,'ends':[{'name':'14','at':((42,21.395868),(71,1.396477)),'displaced':0,'marking':'basic'},{'name':'32','at':((42,20.915942),(71,0.494735)),'displaced':0,'marking':'precision'}]},
 {'id':'15L/33R','length':2557,'width':100,'grooved':False,'ends':[{'name':'15L','at':((42,22.391680),(71,0.516745)),'displaced':0,'marking':'basic'},{'name':'33R','at':((42,22.092985),(71,0.116680)),'displaced':0,'marking':'basic'}]},
 {'id':'15R/33L','length':10083,'width':150,'grooved':True,'ends':[{'name':'15R','at':((42,22.456248),(71,1.073528)),'displaced':882,'marking':'precision'},{'name':'33L','at':((42,21.279047),(70,59.495163)),'displaced':0,'marking':'precision'}]},
]
RUNWAY_SLACK=1.0   # metres between a runway's length by its ends and its published length
END_SLACK=12.0     # metres from a FAA runway end to the OpenStreetMap runway line
TAXIWAY=22.86      # 75 ft
TAXILANE=18.0
TAXI_SHOULDER=6.0
STAND=38.0         # the width paved about a stand's lead-in line
ISLAND=9000.0      # square metres: a gap in the apron no larger than this is paved
APRON_CLOSE=24.0   # gaps in the apron narrower than twice this are apron
RUNWAY_SHOULDER={150:7.62,100:3.05}  # 25 ft beside a 150 ft runway, 10 ft beside a 100 ft one
LAND_MARGIN=12.0   # the airport's outline is drawn inside the perimeter fence here and outside it there
SLIVER=6.0         # square metres
SIMPLIFY=.12
KEPT=('runway','stopway','taxiway','taxilane','apron','parking_position','jet_bridge','terminal','hangar','tower','aerodrome')

# Parked aircraft: generic types (no airline's markings), metres. `door` is the forward left door behind the nose,
# `gear` the nose wheel, which stops on the end of the lead-in line.
AIRCRAFT={
 'wide':{'length':63.7,'span':60.3,'body':5.64,'tail':16.9,'door':7.6,'gear':6.7},
 'narrow':{'length':37.6,'span':35.8,'body':3.95,'tail':11.8,'door':5.1,'gear':5.1},
 'regional':{'length':31.7,'span':28.7,'body':3.0,'tail':9.9,'door':4.2,'gear':3.9},
 'business':{'length':20.9,'span':19.5,'body':2.2,'tail':6.2,'door':4.0,'gear':2.6},
}
OCCUPANCY=.27     # share of the stands considered that hold an aircraft
WING_ROOM=3.0     # metres between two parked aircraft
BUILDING_ROOM=1.5 # metres between an aircraft and a building outline
BRIDGE_REACH=14.0 # a jet bridge's head moves this far, at most, to meet the door
LIVERIES=9        # the runtime's count of tail schemes (src/simulation/logan-airfield.ts)


def unpack(path):
 """A tile's header and its binary payload."""
 raw=gzip.decompress(pathlib.Path(path).read_bytes());length=struct.unpack_from('<I',raw,4)[0];return json.loads(raw[8:8+length]),raw[(8+length+3)//4*4:]


def write_header(path,header,payload):
 encoded=json.dumps(header,separators=(',',':')).encode();out=b'DBT2'+struct.pack('<I',len(encoded))+encoded;write_gzip(path,out+b'\0'*((-len(out))%4)+payload)


def stand_draw(ref):
 """A fixed number in [0, 1) per stand reference: the same stands are occupied on every build."""
 return int.from_bytes(hashlib.sha256(ref.encode()).digest()[:4],'big')/2**32


def extract(source_dir):
 """Cut the cached Overpass response to what the stage reads: aeroway ways and relations, holding positions with the
 way they lie on, and the outlines of the buildings inside the airport."""
 raw=json.loads((pathlib.Path(source_dir)/CACHE_NAME).read_text());elements=raw['elements']
 pts=lambda geometry:[[round(p['lon'],7),round(p['lat'],7)] for p in geometry]
 ways=[];nodes=[];relations=[];buildings=[];on_way={}
 aerodrome=next(Polygon(pts(e['geometry'])) for e in elements if e['type']=='way' and e.get('tags',{}).get('aeroway')=='aerodrome')
 for e in elements:
  tags=e.get('tags',{});kind=tags.get('aeroway')
  if e['type']=='way' and kind in KEPT:
   ways.append({'id':e['id'],'kind':kind,**{k:tags[k] for k in ('ref','name','surface','width','stopway') if k in tags},'points':pts(e['geometry'])})
   if kind in('taxiway','taxilane'):
    for i,n in enumerate(e['nodes']):on_way.setdefault(n,(e,i))
  elif e['type']=='relation' and kind in('apron','terminal'):
   relations.append({'id':e['id'],'kind':kind,**({'name':tags['name']} if 'name' in tags else {}),'rings':[{'role':m.get('role') or 'outer','points':pts(m['geometry'])} for m in e['members'] if m['type']=='way' and m.get('geometry')]})
  elif e['type']=='way' and 'building' in tags and len(e['geometry'])>3 and aerodrome.contains(Polygon(pts(e['geometry'])).representative_point()):
   buildings.append({'id':e['id'],'points':pts(e['geometry'])})
 for e in elements:
  tags=e.get('tags',{})
  if e['type']=='node' and tags.get('aeroway')=='holding_position' and e['id'] in on_way:
   way,i=on_way[e['id']];g=way['geometry'];a=g[max(0,i-1)];b=g[min(len(g)-1,i+1)]
   nodes.append({'id':e['id'],'kind':'holding_position','at':[round(e['lon'],7),round(e['lat'],7)],'along':[[round(a['lon'],7),round(a['lat'],7)],[round(b['lon'],7),round(b['lat'],7)]],'way':way['id']})
  elif e['type']=='node' and tags.get('aeroway')=='windsock':nodes.append({'id':e['id'],'kind':'windsock','at':[round(e['lon'],7),round(e['lat'],7)]})
 key=lambda v:v['id']
 return {'source':'OpenStreetMap contributors, Open Database License 1.0','query':{'bbox':BBOX,'statements':['nwr["aeroway"]','way["building"]']},'extract':{'osmBase':raw.get('osm3s',{}).get('timestamp_osm_base'),'elements':len(elements)},
  'ways':sorted(ways,key=key),'relations':sorted(relations,key=key),'nodes':sorted(nodes,key=key),'buildings':sorted(buildings,key=key)}


def polygons(geometry):
 """The polygons of any shapely result, slivers dropped."""
 if geometry.is_empty:return []
 parts=geometry.geoms if hasattr(geometry,'geoms') else [geometry]
 return [p for p in parts if isinstance(p,Polygon) and p.area>=SLIVER]


def runway_plan():
 """The runways in the package's metres, each checked against its published length."""
 plan=[]
 for r in RUNWAYS:
  ends=[]
  for e in r['ends']:
   (lat,lon)=e['at'];ends.append({'name':e['name'],'point':world(-dm(*lon),dm(*lat)),'displaced':e['displaced']*FT,'marking':e['marking']})
  length=math.dist(ends[0]['point'],ends[1]['point'])
  assert abs(length-r['length']*FT)<=RUNWAY_SLACK,f"runway {r['id']} is {length:.1f} m by its ends, {r['length']*FT:.1f} m published"
  plan.append({'id':r['id'],'width':r['width']*FT,'shoulder':RUNWAY_SHOULDER[r['width']],'grooved':r['grooved'],'length':length,'ends':ends})
 return plan


def strip(a,b,width,before=0.,after=0.):
 """The rectangle of `width` about the line from a to b, carried on `before` and `after` beyond its ends."""
 length=math.dist(a,b);tx=(b[0]-a[0])/length;tz=(b[1]-a[1])/length;nx=-tz;nz=tx;h=width/2
 p=(a[0]-tx*before,a[1]-tz*before);q=(b[0]+tx*after,b[1]+tz*after)
 return Polygon([(p[0]+nx*h,p[1]+nz*h),(q[0]+nx*h,q[1]+nz*h),(q[0]-nx*h,q[1]-nz*h),(p[0]-nx*h,p[1]-nz*h)])


def project(source):
 """The source's features in metres."""
 line=lambda w:[world(*p) for p in w['points']]
 ways=[{**w,'line':line(w)} for w in source['ways']]
 relations=[{**r,'rings':[{'role':m['role'],'line':line(m)} for m in r['rings']]} for r in source['relations']]
 return ways,relations


def ring_polygons(rings):
 """A multipolygon relation's members as polygons: its outer ways joined into rings, with the inners that lie in them cut out."""
 closed=lambda role:[Polygon(m['line']).buffer(0) for m in rings if m['role']==role and len(m['line'])>3 and m['line'][0]==m['line'][-1]]
 open_outers=[LineString(m['line']) for m in rings if m['role']=='outer' and len(m['line'])>1 and m['line'][0]!=m['line'][-1]]
 outers=closed('outer')+[p.buffer(0) for p in polygonize(linemerge(open_outers))] if open_outers else closed('outer');inners=closed('inner')
 return [o.difference(unary_union(inners)) if inners else o for o in outers]


def obstacles(source,ways,relations):
 """What an aircraft keeps clear of: every building outline on the airport, the terminals and hangars among them."""
 shapes=[Polygon([world(*p) for p in b['points']]).buffer(0) for b in source['buildings']]
 shapes+=[Polygon(w['line']).buffer(0) for w in ways if w['kind'] in('terminal','hangar','tower') and len(w['line'])>3]
 for r in relations:
  if r['kind']=='terminal':shapes.extend(ring_polygons(r['rings']))
 return [s for s in shapes if not s.is_empty]


# Every shape is held on a centimetre grid and every overlay is made on it (GEOS's fixed-precision overlay), so that
# the sidecar is the same bytes on any machine. In floating point the last bit of a buffer's arc differs between an
# x86 and an ARM build of the same GEOS, and where two layers share an edge that bit decided whether a sliver of a
# few square metres was cut off, how a ring was noded and where it began: a replay on Linux x64 gave the shoulder
# layer 7 m2 less than the installed package and began 21 of its rings elsewhere, and CI refused it.
GRID=.01
def fixed(shape):return shapely.set_precision(shape,GRID)
def join(shapes):return shapely.union_all([fixed(s) for s in shapes],grid_size=GRID)
def less(a,b):return shapely.difference(a,b,grid_size=GRID)
def both(a,b):return shapely.intersection(a,b,grid_size=GRID)


def land(city,aerodrome):
 """Where pavement may lie: the airport, a margin about its outline, less mapped water."""
 water=join([Polygon(w['rings'][0],w['rings'][1:]).buffer(0) for w in city['water'] if len(w['rings'][0])>3 and Polygon(w['rings'][0]).intersects(aerodrome)])
 return less(fixed(aerodrome.buffer(LAND_MARGIN)),fixed(water.buffer(1.0)))


def pavement(city,ways,relations,runways,obstacles_=()):
 """The four layers, disjoint, on land: runway over taxiway over apron over shoulder."""
 aerodrome=next(Polygon(w['line']) for w in ways if w['kind']=='aerodrome').buffer(0);ground=land(city,aerodrome);solid=join(list(obstacles_)) if len(obstacles_) else Polygon()
 runway=join([strip(r['ends'][0]['point'],r['ends'][1]['point'],r['width']) for r in runways])
 edge=join([strip(r['ends'][0]['point'],r['ends'][1]['point'],r['width']+2*r['shoulder']) for r in runways])
 stopways=[];beds=[]
 for w in ways:
  if w['kind']!='stopway':continue
  width=float(w.get('width',46));shape=LineString(w['line']).buffer(width/2,cap_style='flat')
  (beds if w.get('stopway')=='emas' else stopways).append(shape)
 taxi_lines=[LineString(w['line']) for w in ways if w['kind']=='taxiway' and len(w['line'])>1]
 lane_lines=[LineString(w['line']) for w in ways if w['kind']=='taxilane' and len(w['line'])>1]
 taxiway=join([l.buffer(TAXIWAY/2,quad_segs=6) for l in taxi_lines])
 taxi_edge=join([l.buffer(TAXIWAY/2+TAXI_SHOULDER,quad_segs=6) for l in taxi_lines])
 aprons=[Polygon(w['line']).buffer(0) for w in ways if w['kind']=='apron' and len(w['line'])>3]
 for r in relations:
  if r['kind']=='apron':aprons.extend(ring_polygons(r['rings']))
 # A stand is paved as wide as the aircraft it takes, and the wedges the mapped outlines leave between a pier's
 # taxilanes are apron too: the union is closed over `APRON_CLOSE`.
 stands=[LineString(w['line']).buffer(STAND/2,quad_segs=4) for w in ways if w['kind']=='parking_position' and len(w['line'])>1]
 apron=fixed(fixed(join(aprons+[l.buffer(TAXILANE/2,quad_segs=6) for l in lane_lines]+stands).buffer(APRON_CLOSE,quad_segs=4)).buffer(-APRON_CLOSE,quad_segs=4))
 apron=less(join([apron]+beds),solid)
 shoulder=join([edge,taxi_edge]+stopways)
 layers={'runway':runway,'taxiway':less(taxiway,runway),'apron':less(less(apron,runway),taxiway)}
 # A small gap wholly inside the pavement with apron along a good part of its edge is a painted island on the
 # apron, not grass: the islands between converging taxiways, which have none, stay.
 whole=join(list(layers.values())+[shoulder]);islands=[];beside=fixed(layers['apron'].buffer(.5))
 for part in polygons(whole):
  for ring in part.interiors:
   hole=Polygon(ring)
   if hole.area<=ISLAND and hole.exterior.intersection(beside).length>=.3*hole.exterior.length and not hole.intersects(solid):islands.append(hole)
 if islands:layers['apron']=less(less(join([layers['apron']]+islands),runway),taxiway)
 layers['shoulder']=less(shoulder,join(list(layers.values())))
 return {name:fixed(both(shape,ground).simplify(SIMPLIFY)) for name,shape in layers.items()},aerodrome,ground


def canonical(rings):
 """A polygon's rings in one form whatever the overlay handed back: each begun at its least vertex, the outline
 anticlockwise and the holes clockwise (x east, z south, by the shoelace sum), the holes in order of their first vertex."""
 out=[]
 for i,flat in enumerate(rings):
  pts=[(flat[k],flat[k+1]) for k in range(0,len(flat),2)];area=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(pts,pts[1:]+pts[:1]))
  if (area<0)==(i==0):pts.reverse()
  k=pts.index(min(pts));pts=pts[k:]+pts[:k];out.append([v for p in pts for v in p])
 return [out[0]]+sorted(out[1:])


def tiled(layers,size):
 """Each layer cut to the 1 km tiles: {tile key: {layer: [polygon: [ring: flat centimetres from the tile's origin]]}}."""
 tiles={}
 for name,shape in layers.items():
  minx,minz,maxx,maxz=shape.bounds
  for tx in range(math.floor(minx/size),math.floor(maxx/size)+1):
   for tz in range(math.floor(minz/size),math.floor(maxz/size)+1):
    cell=box(tx*size,tz*size,(tx+1)*size,(tz+1)*size);out=[]
    for p in polygons(both(shape,cell)):
     rings=[]
     for ring in [p.exterior,*p.interiors]:
      flat=[];last=None
      for x,z in list(ring.coords)[:-1]:
       q=(round((x-tx*size)*100),round((z-tz*size)*100))
       if q!=last:flat.extend(q);last=q
      if len(flat)>=6 and flat[:2]==flat[-2:]:flat=flat[:-2]
      if len(flat)>=6:rings.append(flat)
     if rings and len(rings[0])>=6:out.append(canonical(rings))
    if out:tiles.setdefault(f'{tx}_{tz}',{})[name]=sorted(out)
 return dict(sorted(tiles.items(),key=lambda kv:tuple(map(int,kv[0].split('_')))))


def cut_lines(lines,keep,minimum=3.0):
 """The parts of the lines inside `keep`, as point lists of at least `minimum` metres."""
 out=[]
 for line in lines:
  whole=LineString(line);part=whole.intersection(keep)
  # In order along the line, whatever order the overlay gives the pieces in.
  for piece in sorted([g for g in (part.geoms if hasattr(part,'geoms') else [part]) if isinstance(g,LineString) and g.length>=minimum],key=lambda g:round(whole.project(Point(g.coords[0])),2)):
   out.append([(x,z) for x,z in piece.simplify(.1).coords])
 return out


def aircraft_shape(kind,nose,heading):
 """An aircraft's plan (fuselage and wing as two rectangles) with its nose at `nose`, pointing along `heading` (a unit vector)."""
 a=AIRCRAFT[kind];hx,hz=heading;tail=(nose[0]-hx*a['length'],nose[1]-hz*a['length'])
 wing=(nose[0]-hx*a['length']*.47,nose[1]-hz*a['length']*.47)
 return unary_union([LineString([nose,tail]).buffer(a['body']/2,cap_style='flat'),strip((wing[0]+hz*a['span']/2,wing[1]-hx*a['span']/2),(wing[0]-hz*a['span']/2,wing[1]+hx*a['span']/2),a['length']*.2)])


def stand_kind(ref,length):
 """The type of aircraft a stand takes, by its terminal: the international terminal's stands and the long cargo stands
 hold wide bodies, the regional piers the smaller jets."""
 r=ref.upper()
 if r.startswith('E'):return 'wide' if length>=95 else 'narrow'
 if r.startswith(('NC','SC')):return 'wide' if length>=58 else 'narrow'
 if r.startswith(('H','J','D')) or length<34:return 'regional'
 return 'narrow'


def place_aircraft(ways,buildings,pavement_area,aprons):
 """A fixed share of the stands with an aircraft on each, nose toward the nearer building, and business jets on the
 general aviation ramp. Returns the aircraft and the jet bridges, a bridge's head moved to its aircraft's door."""
 solid=unary_union(buildings) if buildings else Polygon();near=prep(solid.buffer(BUILDING_ROOM));bridges=[w for w in ways if w['kind']=='jet_bridge' and len(w['line'])>1]
 # A bridge runs from the terminal to its head: the end farther from every building is the head.
 for b in bridges:
  if solid.distance(Point(b['line'][0]))>solid.distance(Point(b['line'][-1])):b['line']=b['line'][::-1]
 heads=[(Point(b['line'][-1]),Point(b['line'][0]),b) for b in bridges];placed=[];taken=[]
 stands=sorted([w for w in ways if w['kind']=='parking_position' and len(w['line'])>1 and w.get('ref')],key=lambda w:(stand_draw(w['ref']+str(w['id'])),w['id']))
 for w in stands:
  if stand_draw(w['ref']+str(w['id']))>=OCCUPANCY:continue
  line=w['line'];length=sum(math.dist(line[i],line[i+1]) for i in range(len(line)-1));kind=stand_kind(w['ref'],length)
  # The nose end of a lead-in line is the one nearer a building or a jet bridge.
  d=lambda p:min([solid.distance(Point(p))]+[min(h.distance(Point(p)),t.distance(Point(p))) for h,t,_ in heads])
  if d(line[0])<d(line[-1]):line=line[::-1]
  stop=line[-1];back=line[-2];seg=math.dist(stop,back)
  if seg<1:continue
  heading=((stop[0]-back[0])/seg,(stop[1]-back[1])/seg);a=AIRCRAFT[kind]
  for kind in ([kind,'narrow','regional'] if kind=='wide' else [kind,'regional'] if kind=='narrow' else [kind]):
   a=AIRCRAFT[kind];nose=(stop[0]+heading[0]*a['gear'],stop[1]+heading[1]*a['gear']);shape=aircraft_shape(kind,nose,heading)
   if near.intersects(shape) or any(shape.distance(other)<WING_ROOM for other in taken) or not pavement_area.buffer(2).contains(shape):continue
   taken.append(shape);placed.append({'stand':w['ref'],'kind':kind,'nose':nose,'heading':heading});break
 # General aviation: business jets in a row along the long side of the ramp that carries the name.
 for ramp in aprons:
  if 'signature' not in (ramp.get('name') or '').lower():continue
  shape=Polygon(ramp['line']).buffer(0);box_=shape.minimum_rotated_rectangle;c=list(box_.exterior.coords)[:4]
  sides=sorted([(math.dist(c[i],c[(i+1)%4]),i) for i in range(4)],reverse=True);i=sides[0][1];p=c[i];q=c[(i+1)%4];L=sides[0][0];ux=(q[0]-p[0])/L;uz=(q[1]-p[1])/L
  centre=shape.centroid;vx,vz=-uz,ux
  if (centre.x-p[0])*vx+(centre.y-p[1])*vz<0:vx,vz=-vx,-vz
  a=AIRCRAFT['business'];n=0
  for s in range(1,int(L//(a['span']+8))):
   along=s*(a['span']+8);nose=(p[0]+ux*along+vx*(a['length']+14),p[1]+uz*along+vz*(a['length']+14));plane=aircraft_shape('business',nose,(vx,vz))
   if stand_draw(f'signature-{s}')>=.7 or not shape.contains(plane) or near.intersects(plane) or any(plane.distance(o)<WING_ROOM for o in taken):continue
   taken.append(plane);placed.append({'stand':f'GA{s}','kind':'business','nose':nose,'heading':(vx,vz)});n+=1
 out_bridges=[]
 for b in bridges:
  line=list(b['line']);head=Point(line[-1]);best=None
  for plane,shape in zip(placed,taken):
   if plane['kind']=='business':continue
   a=AIRCRAFT[plane['kind']];hx,hz=plane['heading'];nx,nz=plane['nose']
   # The forward left door: left of the heading (x east, z south: left of (hx, hz) is (hz, -hx)).
   door=(nx-hx*a['door']+hz*(a['body']/2+.4),nz-hz*a['door']-hx*(a['body']/2+.4));reach=head.distance(Point(door))
   if reach<=BRIDGE_REACH and (best is None or reach<best[0]):best=(reach,door,shape,(hz,-hx))
  docked=False
  # The bridge comes to the door from the aircraft's left, over neither its wing nor its nose.
  if best and not LineString([line[-2],(best[1][0]+best[3][0]*2.4,best[1][1]+best[3][1]*2.4)]).buffer(1.3).intersects(best[2]):
   line[-1]=best[1];docked=True
  out_bridges.append({'ref':b.get('ref',''),'line':line,'docked':docked})
 return placed,out_bridges


def holds(source,runways):
 """Holding positions: the point, the taxiway's direction there (toward the runway it guards) and the runway."""
 out=[]
 for n in source['nodes']:
  if n['kind']!='holding_position':continue
  p=world(*n['at']);a=world(*n['along'][0]);b=world(*n['along'][1]);L=math.dist(a,b)
  if L<.5:continue
  t=((b[0]-a[0])/L,(b[1]-a[1])/L);best=None
  for r in runways:
   d=LineString([r['ends'][0]['point'],r['ends'][1]['point']]);gap=d.distance(Point(p))
   if best is None or gap<best[0]:best=(gap,d)
  if best is None or best[0]>160:continue
  c=best[1].interpolate(best[1].project(Point(p)))
  if (c.x-p[0])*t[0]+(c.y-p[1])*t[1]<0:t=(-t[0],-t[1])
  out.append({'point':p,'toward':t})
 return out


def terminals(ways,relations):
 """The passenger terminals' outlines by name (the runtime finishes the surveyed shells by them)."""
 out=[];flat=lambda ring:[round(v,2) for p in list(ring.coords)[:-1] for v in p]
 for w in ways:
  if w['kind']=='terminal' and w.get('name') and len(w['line'])>3:out.append({'name':w['name'],'ring':flat(Polygon(w['line']).buffer(0).simplify(.5).exterior)})
 for r in relations:
  if r['kind']=='terminal':
   for shape in ring_polygons(r['rings']):
    for part in polygons(shape):out.append({'name':r.get('name',''),'ring':flat(part.simplify(.5).exterior)})
 return sorted(out,key=lambda t:(t['name'],t['ring'][0]))


def build(city,source):
 """The airfield from the package's city record and the source sidecar. Nothing is written."""
 size=city['tiles']['size'];ways,relations=project(source);runways=runway_plan()
 # Every FAA runway end lies on the OpenStreetMap runway it names.
 mapped=unary_union([LineString(w['line']) for w in ways if w['kind'] in('runway','stopway')])
 for r in runways:
  for e in r['ends']:
   gap=mapped.distance(Point(e['point']));assert gap<=END_SLACK,f"runway end {e['name']} lies {gap:.1f} m from the mapped runway"
 buildings=obstacles(source,ways,relations)
 layers,aerodrome,ground=pavement(city,ways,relations,runways,buildings);paved=unary_union(list(layers.values()))
 runway_area=layers['runway'];clear=ground.difference(runway_area.buffer(1.0))
 taxi=cut_lines([w['line'] for w in ways if w['kind'] in('taxiway','taxilane')],clear)
 leads=cut_lines([w['line'] for w in ways if w['kind']=='parking_position' and len(w['line'])>1],clear)
 aircraft,bridges=place_aircraft(ways,buildings,paved,[w for w in ways if w['kind']=='apron'])
 r2=lambda p:[round(p[0],2),round(p[1],2)];flat=lambda line:[round(v,2) for p in line for v in p]
 stop=[]
 for w in ways:
  if w['kind']!='stopway' or len(w['line'])<2:continue
  stop.append({'line':flat([w['line'][0],w['line'][-1]]),'width':float(w.get('width',46)),'bed':w.get('stopway')=='emas'})
 tiles=tiled(layers,size)
 return {
  'version':1,'name':'General Edward Lawrence Logan International Airport','icao':'KBOS','elevationFeet':19,'tileSize':size,
  'bounds':dict(zip(('minX','minZ','maxX','maxZ'),[round(v,1) for v in paved.bounds])),
  'runways':[{'id':r['id'],'width':round(r['width'],2),'shoulder':r['shoulder'],'grooved':r['grooved'],'ends':[{'name':e['name'],'point':r2(e['point']),'displaced':round(e['displaced'],2),'marking':e['marking']} for e in r['ends']]} for r in runways],
  'stopways':stop,
  'taxiLines':[flat(l) for l in taxi],'standLines':[flat(l) for l in leads],
  'holds':[{'point':r2(h['point']),'toward':[round(h['toward'][0],4),round(h['toward'][1],4)]} for h in holds(source,runways)],
  'aircraft':[{'stand':a['stand'],'kind':a['kind'],'nose':r2(a['nose']),'heading':[round(a['heading'][0],4),round(a['heading'][1],4)],'livery':int(stand_draw('livery'+a['stand'])*LIVERIES)} for a in aircraft],
  'jetBridges':[{'ref':b['ref'],'line':flat(b['line']),'docked':b['docked']} for b in bridges],
  'windsocks':[r2(world(*n['at'])) for n in source['nodes'] if n['kind']=='windsock'],
  'outline':flat(list(aerodrome.simplify(1.5).exterior.coords)[:-1]),'terminals':terminals(ways,relations),
  'area':{name:round(shape.area) for name,shape in layers.items()},
  'tiles':tiles,
 }


def summary(airfield):
 kinds={}
 for a in airfield['aircraft']:kinds[a['kind']]=kinds.get(a['kind'],0)+1
 return {'runways':len(airfield['runways']),'runwayMetres':round(sum(math.dist(*[e['point'] for e in r['ends']]) for r in airfield['runways'])),'area':airfield['area'],'tiles':list(airfield['tiles']),
  'taxiLines':len(airfield['taxiLines']),'standLines':len(airfield['standLines']),'holds':len(airfield['holds']),'aircraft':kinds,'jetBridges':len(airfield['jetBridges']),'dockedBridges':sum(b['docked'] for b in airfield['jetBridges'])}


def dump(airfield):return (json.dumps(airfield,separators=(',',':'))+'\n').encode()


def install(data_dir,source,check=False):
 """Write airfield.json and add, empty, any tile the airfield reaches that the package lacks. Returns (record, changed)."""
 data_dir=pathlib.Path(data_dir);city=json.loads((data_dir/'city.json').read_text());airfield=build(city,source);changed=[]
 keys=set(city['tiles']['keys']);size=city['tiles']['size'];added=[]
 for k in airfield['tiles']:
  path=data_dir/city['tiles']['directory']/f't_{k}.bin'
  if k in keys and path.exists():continue
  tx,tz=map(int,k.split('_'));added.append(k);keys.add(k);changed.append(f't_{k}.bin')
  if not check:write_header(path,empty_tile(tx,tz,size),b'')
 previous=sorted(json.loads((data_dir/'provenance.json').read_text()).get('loganAirfield',{}).get('addedTiles',[]))
 added=sorted(set(added)|{k for k in previous if k in airfield['tiles']},key=lambda v:tuple(map(int,v.split('_'))))
 credits=[c for c in SOURCES if not any(e['name']==c['name'] for e in city['sources'])]
 if keys!=set(city['tiles']['keys']) or credits:
  changed.append('city.json')
  if not check:city['tiles']['keys']=sorted(keys,key=lambda v:tuple(map(int,v.split('_'))));city['sources']=city['sources']+credits;(data_dir/'city.json').write_text(json.dumps(city,separators=(',',':'))+'\n')
 out=data_dir/OUTPUT_NAME;payload=dump(airfield)
 if not out.exists() or out.read_bytes()!=payload:
  changed.append(OUTPUT_NAME)
  if not check:out.write_bytes(payload)
 return {'method':METHOD,'file':OUTPUT_NAME,'sha256':hashlib.sha256(payload).hexdigest(),'faa':{'effective':'2026-10-29','runways':[r['id'] for r in RUNWAYS]},'addedTiles':added,**summary(airfield)},changed


def empty_tile(tx,tz,size):
 """A tile no building stands in, with every list the street-surface stage gives a tile."""
 return {'tx':tx,'tz':tz,'size':size,'buildings':[],'curbs':[],'parkPaths':[],'roads':[],'indexBytes':2,'vertexCount':0,'pavements':[],'sidewalks':[],'islands':[],'driveways':[],'borderPavements':[],'streetPavement':[],'streetSidewalks':[],'deckPavement':[],'parking':[],'highwayPavements':[],'bareCurbs':[]}


def validate(data_dir,city,record,source):
 """The installed airfield is the one a replay builds, its tiles exist, its layers do not overlap and its aircraft stand clear."""
 data_dir=pathlib.Path(data_dir);installed=(data_dir/OUTPUT_NAME).read_bytes();airfield=build(city,source)
 assert installed==dump(airfield),'airfield.json differs from a replay of build-logan-airfield.py'
 assert record['sha256']==hashlib.sha256(installed).hexdigest() and {k:record[k] for k in summary(airfield)}==summary(airfield),'the airfield provenance record differs from a replay'
 keys=set(city['tiles']['keys']);assert set(airfield['tiles'])<=keys,'the airfield reaches a tile the package does not have'
 assert all(any(e['name']==c['name'] for e in city['sources']) for c in SOURCES),'city.json credits the airfield\'s sources'
 for k in record['addedTiles']:
  header,payload=unpack(data_dir/city['tiles']['directory']/f't_{k}.bin');assert not header['buildings'] and not payload,f'tile {k} was added empty for the airfield'
 size=airfield['tileSize'];shapes={}
 for key,layers in airfield['tiles'].items():
  tx,tz=map(int,key.split('_'))
  for name,polys in layers.items():
   for rings in polys:
    ring=lambda flat:[(tx*size+flat[i]/100,tz*size+flat[i+1]/100) for i in range(0,len(flat),2)]
    shapes.setdefault(name,[]).append(Polygon(ring(rings[0]),[ring(r) for r in rings[1:]]).buffer(0))
 merged={name:unary_union(parts) for name,parts in shapes.items()};names=sorted(merged)
 for i,a in enumerate(names):
  for b in names[i+1:]:
   overlap=merged[a].intersection(merged[b]).area;assert overlap<60,f'airfield layers {a} and {b} overlap by {overlap:.0f} m2'
 for r in airfield['runways']:
  a,b=[e['point'] for e in r['ends']];inside=strip(a,b,r['width']-1).intersection(merged['runway']).area/strip(a,b,r['width']-1).area
  assert inside>.985,f"runway {r['id']} is paved over {inside:.1%} of its length"
 buildings=unary_union(obstacles(source,*project(source)));planes=[]
 for a in airfield['aircraft']:
  shape=aircraft_shape(a['kind'],a['nose'],a['heading']);assert shape.distance(buildings)>=BUILDING_ROOM-.1,f"the aircraft on stand {a['stand']} stands in a building"
  assert all(shape.distance(o)>=WING_ROOM-.1 for o in planes),f"the aircraft on stand {a['stand']} stands in another";planes.append(shape)
 return summary(airfield)
