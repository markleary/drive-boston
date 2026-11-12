"""Footbridges over the Massachusetts Turnpike and Storrow Drive.

build-metro.py keeps a mapped path only inside the park polygons, so a footbridge over Storrow Drive kept the
pieces of its ramps that lie in the Esplanade or on a strip of lawn and lost the span over the roadway, which is
no park. The runtime then drew every piece that was left as a bridge of its own, a low arch between its two ends
on the ground. On bare ground that passed for a path; since build-boston-highways.py put Storrow Drive under
them, five bridges stood half built on its banks (the two at Boston University, the ones at Fairfield and
Dartmouth Street and the Arthur Fiedler Footbridge), and the footbridge over the Turnpike at Franklin Street in
Allston, which touches no park, was missing altogether.

This stage installs each bridge whole from `footbridges-source.json`: the OpenStreetMap ways of every bridge in
FOOTBRIDGES (the way that spans the road and every bridge way joined to it through shared vertices: ramps,
landings between ramps, steps), cut from the cached path extract by --extract.

- Line: the ways of one bridge in order from one end on the ground to the other, as one line. A turn sharper
  than BEND is rounded (FILLET), since the deck's cross sections follow the line's direction and pinch at a
  corner, and the line is stored at stations no more than STEP apart.
- Heights: both ends stand on the ground at a park path's height over it (PATH_RISE). Every way that crosses a
  road, and every way between two that do, is the deck: level, at the height the highest crossing asks for (the
  road's surface across the bridge's width, the room under the slab and the slab: Storrow Drive's posted 10 ft,
  the Turnpike's room under its street bridges, a street's under a levelled bridge). A tunnel record's roofed
  stretch asks for nothing: the bridge crosses its roof. From each end the ways before the deck are the ramp: one
  grade along their length from the ground to the deck, held over the ground where it rises faster, with a way
  mapped level between two inclines (a landing where a ramp turns back) kept level.
- Tiles: each bridge is one park path per tile it touches (`footbridge-<id>-<tile>_<n>`, `bridge`, `elevations`
  beside `points`, `steps` for the station ranges that are mapped as steps, `bridgePoints` when a tile border
  cuts it), which the runtime draws and collides from those heights instead of its arch (footbridges.ts). The
  pieces build-metro.py left of the same ways are taken out and kept in the provenance record.
- City: `city.json` lists every deck (`footbridges`: id, width, points, elevations), so that what stands under one
  (a lighting mast of the Turnpike, a sign gantry, a cut's wall) can be left out before the bridge's tile is loaded:
  the runtime's deckUndersideAt reads it.

The stage reads the roads and the graded grid as the stages before it leave them and writes nothing they read, so
a rerun on the installed package writes the same tiles; validate-city.py replays it (plan) and checks the room
under every deck (validate). Deck heights and clearances are game estimates, not surveyed structures."""
import gzip,json,math,struct
from shapely.geometry import LineString
from shapely.strtree import STRtree
import boston_highways as H
from road_structure_clearance import crossing_points,road_height
from tileformat import write_gzip
from water_crossings import grid_sampler

SOURCE_NAME='footbridges-source.json'
EXTRACT='osm-metro-paths.json'
PREFIX='footbridge-'
KINDS=('footway','path','pedestrian','steps','cycleway')
TAGS=('highway','bridge','layer','incline','width','name','covered','step_count','foot','bicycle','surface')
SLAB=.22              # the runtime's footbridge slab (footbridges.ts)
PATH_RISE=.052        # a park path's ribbon over the terrain, which a landing meets
STREET_UNDER=H.BENEATH-H.THICKNESS  # room under the slab over a street, as under a levelled street bridge
MARGIN=.05            # kept over the room a road asks for
STEP=2.0              # longest stretch between two stored stations
BEND=math.radians(35) # a sharper turn is rounded
FILLET=1.3            # with this radius where the legs are long enough
ENDS=1.5              # a road crossing this close to an end on the ground is the street the bridge lands on
METHOD=('OpenStreetMap bridge ways of each footbridge joined into one line from ground to ground, sharp turns rounded; the ways over a road level at the room the highest crossing asks for under the slab '
 "(Storrow Drive's posted clearance, the Turnpike's room under its street bridges, a street's), a tunnel record's roofed stretch asking for nothing; "
 'the ways before them one grade from the ground to the deck, held over the ground, a way mapped level between two inclines kept level; '
 'one park path per tile with stored heights, replacing the pieces of the same ways clipped to the park polygons')

# The way that spans the road names each bridge; --extract collects the bridge ways joined to it. `width` is a reviewed deck width where the
# mapped one is wider than the mapped legs of a ramp lie apart (the Fiedler helix's turns are 2 to 2.5 m apart, Silber Way's ramp 2.7 m).
FOOTBRIDGES=[
 {'id':'marsh-chapel','span':114011284},       # Boston University Beach to the Esplanade, steps at both ends
 {'id':'silber-way','span':831546284,'width':2.4},
 {'id':'fairfield-street','span':807419773,'width':2.6},  # OpenStreetMap: Gloucester Street Overpass
 {'id':'dartmouth-street','span':806668962,'width':2.6},
 {'id':'arthur-fiedler','span':98384166,'width':2.2},
 {'id':'franklin-street','span':834057756},    # over the Turnpike between Lincoln Street and Cambridge Street, Allston
]


def key(p):return (round(p[0],2),round(p[1],2))


def extract(source_dir):
 """The source sidecar: every listed bridge with the bridge ways joined to its span through shared vertices."""
 data=json.loads((source_dir/EXTRACT).read_text());ways={}
 for e in data['elements']:
  if e.get('type')=='way' and e.get('tags',{}).get('highway') in KINDS and e['tags'].get('bridge','no')!='no' and len(e.get('geometry') or [])>1:ways[e['id']]=e
 at={}
 for e in ways.values():
  for g in e['geometry']:at.setdefault((g['lon'],g['lat']),set()).add(e['id'])
 bridges=[]
 for spec in FOOTBRIDGES:
  assert spec['span'] in ways,f"footbridge way {spec['span']} is missing from {EXTRACT}"
  chain={spec['span']};queue=[spec['span']]
  while queue:
   for g in ways[queue.pop()]['geometry']:
    for other in sorted(at[(g['lon'],g['lat'])]-chain):chain.add(other);queue.append(other)
  bridges.append({'id':spec['id'],'ways':[{'id':i,'tags':{k:ways[i]['tags'][k] for k in TAGS if k in ways[i]['tags']},'points':[H.project(g['lon'],g['lat']) for g in ways[i]['geometry']]} for i in sorted(chain)]})
 return {'version':1,'name':'Footbridges over the Massachusetts Turnpike and Storrow Drive','source':f'OpenStreetMap path extract (data-source-cache/{EXTRACT})','url':'https://www.openstreetmap.org/',
  'license':'ODbL 1.0, © OpenStreetMap contributors','extract':data.get('osm3s',{}).get('timestamp_osm_base'),
  'projection':'EPSG:4326 to Massachusetts State Plane feet (EPSG:2249), metres from 771100 E, 2952900 N, z southward, like every Boston street','bridges':bridges}


def ordered(ways):
 """The ways of a bridge from one end on the ground to the other, each turned to run that way. A bridge is one line: no branch, no loop."""
 ends={}
 for w in ways:
  for e in (0,-1):ends.setdefault(key(w['points'][e]),[]).append(w['id'])
 loose=sorted(k for k,v in ends.items() if len(v)==1)
 if len(loose)!=2 or any(len(v)>2 for v in ends.values()):raise ValueError(f"footbridge ways {[w['id'] for w in ways]} do not form one line from ground to ground")
 left={w['id']:w for w in ways};at=loose[0];out=[]
 while left:
  w=next((w for w in sorted(left.values(),key=lambda w:w['id']) if at in (key(w['points'][0]),key(w['points'][-1]))),None)
  if w is None:raise ValueError(f"footbridge ways {sorted(left)} are not joined to the rest")
  del left[w['id']];points=w['points'] if key(w['points'][0])==at else w['points'][::-1];out.append({**w,'points':[list(p) for p in points]});at=key(points[-1])
 return out


def rounded(points,owners):
 """Round every turn sharper than BEND with an arc of FILLET (less where a leg is too short for it: the 2.7 m end of a ramp that turns back becomes
 a half circle). `owners[i]` is the way of the segment that starts at point i; an arc's first half belongs to the way that runs into the turn."""
 out=[list(points[0])];own=[]
 for i in range(1,len(points)-1):
  a,p,b=points[i-1],points[i],points[i+1];ax,az=p[0]-a[0],p[1]-a[1];bx,bz=b[0]-p[0],b[1]-p[1];la,lb=math.hypot(ax,az),math.hypot(bx,bz)
  turn=math.atan2(ax*bz-az*bx,ax*bx+az*bz) if la>1e-6 and lb>1e-6 else 0
  if abs(turn)<BEND:out.append(list(p));own.append(owners[i-1]);continue
  # tangent length: the radius asks FILLET*tan(turn/2); a leg gives half of itself (the turn at its other end may want the other half)
  t=min(FILLET*math.tan(abs(turn)/2),.5*la,.5*lb);radius=t/math.tan(abs(turn)/2);ux,uz=ax/la,az/la
  start=[p[0]-ux*t,p[1]-uz*t];side=1 if turn>0 else -1;cx,cz=start[0]-uz*radius*side,start[1]+ux*radius*side;n=max(2,math.ceil(abs(turn)/math.radians(18)))
  angle=math.atan2(start[1]-cz,start[0]-cx);out.append(start);own.append(owners[i-1])
  for k in range(1,n+1):
   f=angle+turn*k/n;out.append([cx+radius*math.cos(f),cz+radius*math.sin(f)]);own.append(owners[i-1] if k<=n/2 else owners[i])
 out.append(list(points[-1]));own.append(owners[-1])
 return out,own


def stationed(points,owners):
 """Stations no more than STEP apart along the line, every vertex kept."""
 out=[list(points[0])];own=[]
 for a,b,o in zip(points,points[1:],owners):
  n=max(1,math.ceil(math.dist(a,b)/STEP-1e-9))
  for k in range(1,n+1):out.append([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n]);own.append(o)
 return out,own


def level(way):return str(way['tags'].get('incline','')).strip() in ('0','0%')


def room(road):
 """Room a road asks for under a footbridge's slab."""
 if road.get('highway')=='storrow' or road.get('bridge',{}).get('id')=='storrow':return H.STORROW_UNDER
 return H.CLEAR_UNDER if road.get('highway') or H.stage_owned(road) or road.get('lanes') else STREET_UNDER


def covered(road,along):
 """Whether a road is roofed at a station. A tunnel record that lists no `covered` intervals is roofed all along (Road.tunnel in src/types.ts, tunnelCoveredAt in src/simulation/tunnels.ts); one that lists none of its length is an open cut."""
 tunnel=road.get('tunnel')
 if tunnel is None:return False
 spans=tunnel.get('covered');return spans is None or any(a-1e-6<=along<=b+1e-6 for a,b in spans)


def package_roads(data_dir,city):
 """Every road a footbridge may cross: the package's own and the tunnel sidecars' records."""
 roads=list(city['roads'])
 for name in (city.get('tunnels') or {}).get('files',[]):roads+=json.loads((data_dir/name).read_text())['roads']
 return roads


class Roads:
 def __init__(self,roads):self.roads=roads;self.lines=[LineString(r['points']) for r in roads];self.tree=STRtree(self.lines)
 def crossing(self,line):
  for j in sorted(self.tree.query(line,predicate='intersects').tolist()):
   for q in crossing_points(line.intersection(self.lines[j])):yield self.roads[j],self.lines[j],q


def profile(spec,bridge,roads,ground):
 """One bridge's line and heights: {points, elevations, stairs (per segment: mapped as steps), width, kind, name, deck, landings, crossings, grade, length, ways}."""
 ways=ordered(bridge['ways']);points=[];owners=[]
 for k,w in enumerate(ways):
  for p in w['points'][(1 if points else 0):]:
   if points:owners.append(k)
   points.append(p)
 points,owners=stationed(*rounded(points,owners));line=LineString(points);n=len(points)
 along=[0.0]
 for a,b in zip(points,points[1:]):along.append(along[-1]+math.dist(a,b))
 span=next(w for w in ways if w['id']==spec['span']);width=spec.get('width') or float(span['tags'].get('width') or (3 if span['tags']['highway']=='cycleway' else 2.6))
 # The crossings, each with the height its road asks the deck for; the ways that hold one, and those between them, are the deck.
 crossings=[];first=last=None
 for road,road_line,q in roads.crossing(line):
  at=line.project(q)
  if min(at,along[-1]-at)<ENDS or covered(road,road_line.project(q)):continue
  # the road's surface across the bridge's width, along the road
  d=road_line.project(q);surface=max(road_height(road,[c.x,c.y],ground) for c in (road_line.interpolate(d+o) for o in (-width/2,0,width/2)))
  i=min(range(n-1),key=lambda i:abs((along[i]+along[i+1])/2-at));k=owners[i];first=k if first is None else min(first,k);last=k if last is None else max(last,k)
  crossings.append({'road':road['id'],'name':road.get('name',''),'at':round(at,2),'surface':round(surface,3),'room':room(road)})
 if first is None:raise ValueError(f"footbridge {spec['id']} crosses no road")
 if first==0 or last==len(ways)-1:raise ValueError(f"footbridge {spec['id']} has no ramp before its deck")
 deck=round(max(c['surface']+c['room'] for c in crossings)+SLAB+MARGIN,4)
 lands=[round(ground(*points[0])+PATH_RISE,4),round(ground(*points[-1])+PATH_RISE,4)]
 # A ramp climbs by its length; a way mapped level between two inclines takes none of the climb.
 def weight(i):return 0.0 if level(ways[owners[i]]) else along[i+1]-along[i]
 a=next(i for i in range(n-1) if owners[i]>=first);b=next(i for i in range(n-1,0,-1) if owners[i-1]<=last)   # the deck's first and last station
 up=sum(weight(i) for i in range(a));down=sum(weight(i) for i in range(b,n-1))
 if not up or not down:raise ValueError(f"footbridge {spec['id']} has no incline before its deck")
 heights=[deck]*n;run=0.0
 for i in range(a):heights[i]=lands[0]+(deck-lands[0])*run/up;run+=weight(i)
 run=0.0
 for i in range(n-1,b,-1):heights[i]=lands[1]+(deck-lands[1])*run/down;run+=weight(i-1)
 heights=[h if i in (0,n-1) else max(h,ground(*p)+PATH_RISE) for i,(p,h) in enumerate(zip(points,heights))]
 grade=max(abs(heights[i+1]-heights[i])/(along[i+1]-along[i]) for i in range(n-1))
 stairs=[ways[k]['tags']['highway']=='steps' for k in owners]
 name=next((w['tags']['name'] for w in [span]+ways if w['tags'].get('name')),'')
 return {'id':spec['id'],'name':name,'kind':span['tags']['highway'],'width':width,'points':[[round(p[0],3),round(p[1],3)] for p in points],'elevations':[round(h,4) for h in heights],'stairs':stairs,
  'deck':deck,'landings':lands,'crossings':sorted(crossings,key=lambda c:c['at']),'grade':round(grade,4),'length':round(along[-1],2),'ways':[w['id'] for w in ways]}


def fragments(points,heights,stairs,size):
 """The line cut at tile borders, a vertex added where a segment crosses one: [(tx, tz, points, heights, stairs)], `stairs` per segment."""
 def tile(a,b):return (math.floor((a[0]+b[0])/2/size),math.floor((a[1]+b[1])/2/size))
 pts=[points[0]];high=[heights[0]];flags=[]
 for i in range(1,len(points)):
  a,b=points[i-1],points[i];cuts=[]
  for axis in (0,1):
   lo,hi=sorted((a[axis],b[axis]))
   for g in range(math.floor(lo/size)+1,math.floor(hi/size)+1):
    if lo<g*size<hi:cuts.append((g*size-a[axis])/(b[axis]-a[axis]))
  for t in sorted(cuts):pts.append([round(a[0]+(b[0]-a[0])*t,3),round(a[1]+(b[1]-a[1])*t,3)]);high.append(round(heights[i-1]+(heights[i]-heights[i-1])*t,4));flags.append(stairs[i-1])
  pts.append(b);high.append(heights[i]);flags.append(stairs[i-1])
 out=[];start=0
 for i in range(1,len(pts)):
  if i==len(pts)-1 or tile(pts[i-1],pts[i])!=tile(pts[i],pts[i+1]):out.append((*tile(pts[start],pts[start+1]),pts[start:i+1],high[start:i+1],flags[start:i]));start=i
 return out


def entries(planned,size):
 """Park path entries by tile key for one planned bridge."""
 parts=fragments(planned['points'],planned['elevations'],planned['stairs'],size);out={};count={}
 for tx,tz,points,heights,stairs in parts:
  k=f'{tx}_{tz}';n=count.get(k,0);count[k]=n+1
  entry={'id':f"{PREFIX}{planned['id']}-{k}_{n}",'points':points,'width':planned['width'],'bridge':True,'name':planned['name'],'kind':planned['kind'],'elevations':heights}
  if len(parts)>1:entry['bridgePoints']=planned['points']
  # the station ranges mapped as steps
  steps=[];i=0
  while i<len(stairs):
   if stairs[i]:
    j=i
    while j<len(stairs) and stairs[j]:j+=1
    steps.append([i,j]);i=j
   else:i+=1
  if steps:entry['steps']=steps
  out.setdefault(k,[]).append(entry)
 return out


def plan(data_dir,city,source):
 """Every bridge planned on the package: (the planned bridges, their tile entries by tile key)."""
 from north_overpasses import load_grid
 grid=city['elevation'];scale=grid.get('scale',.01);sample=grid_sampler(grid,load_grid(data_dir/grid['file']));ground=lambda x,z:sample(x,z)*scale
 roads=Roads(package_roads(data_dir,city));by_id={b['id']:b for b in source['bridges']};planned=[];tiles={}
 for spec in FOOTBRIDGES:
  p=profile(spec,by_id[spec['id']],roads,ground);planned.append(p)
  for k,items in entries(p,city['tiles']['size']).items():tiles.setdefault(k,[]).extend(items)
 return planned,tiles


def unpack(path):
 raw=gzip.decompress(path.read_bytes());length=struct.unpack_from('<I',raw,4)[0]
 return json.loads(raw[8:8+length]),raw[(8+length+3)//4*4:]


def write_header(path,header,payload):
 encoded=json.dumps(header,separators=(',',':')).encode();raw=b'DBT2'+struct.pack('<I',len(encoded))+encoded;write_gzip(path,raw+b'\0'*((-len(raw))%4)+payload)


def summary(p):return {k:p[k] for k in ('id','name','ways','width','length','deck','landings','grade','crossings')}


def decks(planned):
 """The decks as city.json lists them."""
 return [{k:p[k] for k in ('id','width','points','elevations')} for p in planned]


def install(data_dir,source,previous=None,check=False):
 """Write the bridges into the tiles and list their decks in city.json; returns (the provenance record, the files changed). `previous` is the
 record of an earlier run, whose replaced pieces stay on record (a rerun no longer finds them in the tiles)."""
 city=json.loads((data_dir/'city.json').read_text());planned,tiles=plan(data_dir,city,source);size=city['tiles']['size']
 clipped=tuple(f'osm-way-{w}-' for p in planned for w in p['ways']);replaced={(r['tile'],r['path']['id']):r for r in (previous or {}).get('replaced',[])};keys=set(city['tiles']['keys']);changed=[]
 for k in sorted(keys|set(tiles),key=lambda v:tuple(map(int,v.split('_')))):
  path=data_dir/'tiles'/f't_{k}.bin'
  if path.exists():header,payload=unpack(path)
  elif k in tiles:
   tx,tz=map(int,k.split('_'));header={'tx':tx,'tz':tz,'size':size,'buildings':[],'curbs':[],'parkPaths':[],'roads':[],'indexBytes':2,'vertexCount':0};payload=b'';keys.add(k)
  else:continue
  before=json.dumps(header['parkPaths'],separators=(',',':'));kept=[]
  for old in header['parkPaths']:
   if old['id'].startswith(PREFIX):continue
   if old['id'].startswith(clipped):replaced[(k,old['id'])]={'tile':k,'path':old};continue
   kept.append(old)
  header['parkPaths']=kept+tiles.get(k,[])
  if before!=json.dumps(header['parkPaths'],separators=(',',':')):
   changed.append(k)
   if not check:write_header(path,header,payload)
 listed=decks(planned)
 if keys!=set(city['tiles']['keys']) or city.get('footbridges')!=listed:
  changed.append('city.json')
  if not check:city['tiles']['keys']=sorted(keys,key=lambda v:tuple(map(int,v.split('_'))));city['footbridges']=listed;(data_dir/'city.json').write_text(json.dumps(city,separators=(',',':'))+'\n')
 return {'method':METHOD,'bridges':[{**summary(p),'tiles':sorted(k for k,items in tiles.items() if any(e['id'].startswith(f"{PREFIX}{p['id']}-") for e in items))} for p in planned],
  'replaced':[replaced[k] for k in sorted(replaced)]},changed


def validate(data_dir,city,record,source):
 """Check the installed bridges: a replay writes the same tiles, no clipped piece of a bridge way is left, every deck leaves its roads their room,
 and both ends stand on the ground. Returns the counts."""
 planned,tiles=plan(data_dir,city,source);clipped=tuple(f'osm-way-{w}-' for p in planned for w in p['ways']);found={}
 for k in city['tiles']['keys']:
  header,_=unpack(data_dir/'tiles'/f't_{k}.bin')
  for path in header.get('parkPaths',[]):
   assert not path['id'].startswith(clipped),f"tile {k} still holds {path['id']}, a clipped piece of a footbridge"
   if path['id'].startswith(PREFIX):found.setdefault(k,[]).append(path)
 assert found==tiles,'footbridge paths in the tiles differ from a replay of build-footbridges.py'
 assert city.get('footbridges')==decks(planned),'the footbridge decks listed in city.json differ from a replay of build-footbridges.py'
 assert [summary(p) for p in planned]==[{k:b[k] for k in b if k!='tiles'} for b in record['bridges']],'the footbridge provenance record differs from a replay of build-footbridges.py'
 for p in planned:
  for c in p['crossings']:assert p['deck']-SLAB-c['surface']>=c['room']-1e-6,f"footbridge {p['id']} leaves {c['road']} {p['deck']-SLAB-c['surface']:.2f} m"
  assert len(p['elevations'])==len(p['points']) and all(math.dist(a,b)<=STEP+1e-6 for a,b in zip(p['points'],p['points'][1:])),f"footbridge {p['id']} stations"
 return {'bridges':len(planned),'paths':sum(map(len,tiles.values())),'meters':round(sum(p['length'] for p in planned),1),'steepest':max(p['grade'] for p in planned)}
