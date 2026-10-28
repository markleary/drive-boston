#!/usr/bin/env python3
"""Validate the tiled metro package: city.json with its graded and source
elevation grids, the far-distance hulls, every DBT2 tile (geometry inside its
documented envelope, audited ground normalization, supported upper parts),
navigable spawn clearance and a continuous surface-road route to every
destination. Needs the data virtualenv (numpy, shapely):

  .venv-data/bin/python scripts/validate-city.py [--data-dir public/data]
"""
import argparse, gzip, heapq, json, math, pathlib, struct, sys
from collections import defaultdict
import numpy as np
from shapely.geometry import Polygon, Point
from shapely.ops import unary_union
from shapely.prepared import prep
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'));import tileformat
from mesh_winding import orient_shells
parser=argparse.ArgumentParser();parser.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');args=parser.parse_args()
data_dir=args.data_dir;city=json.loads((data_dir/'city.json').read_text());provenance=json.loads((data_dir/'provenance.json').read_text())
assert provenance.get('region')=='metro','validate-city.py checks metro packages written by scripts/build-metro.py'
for key in ['origin','bounds','coverage','spawn','elevation','tiles','landmarkBuildings','roads','signals','landmarks','neighborhoods','parks','water']:assert key in city,f'city.json lacks {key}'
assert 'buildings' not in city and 'curbs' not in city,'metro buildings and curbs live in tiles, not city.json'
bounds=city['bounds'];spawn=city['spawn'];sp=[spawn['x'],spawn['z']]

# ---- coverage and districts
coverage=unary_union([Polygon(p) for p in city['coverage']]);covered=prep(coverage.buffer(.05))
assert len(city['coverage'])==provenance['coveragePolygons']>=1 and all(len(p)>3 for p in city['coverage'])
assert abs(coverage.area-provenance['coverageAreaSquareMeters'])<coverage.area*.02,'coverage outlines (exteriors only) must match the compiled union'
towns={'Cambridge','Somerville','Brookline'};excluded={'Roslindale','West Roxbury','Hyde Park','Harbor Islands'}
names={n['name'] for n in city['neighborhoods']}
assert towns<=names and not names&excluded,'town and excluded-neighborhood policy'
assert {'Back Bay','Beacon Hill','Downtown','Chinatown','Mission Hill','Fenway','Longwood','Dorchester','Roxbury','Jamaica Plain','South Boston','East Boston','Charlestown','Allston','Brighton','Mattapan','North End','West End','South End'}<=names
assert all(n['town']==(n['name'] in towns) for n in city['neighborhoods'])
assert {'Boston Common','Public Garden','Back Bay Fens','Franklin Park','Arnold Arboretum'}<={p['name'] for p in city['parks']},'a major park was omitted'
for area in city['parks']+city['water']:
 assert area['rings'] and all(len(ring)>=3 and all(math.isfinite(v) for p in ring for v in p) for ring in area['rings'])

# ---- elevation grids
grid=city['elevation'];w,h,cell=grid['width'],grid['height'],grid['cellSize']
assert grid['encoding']=='int16-gzip' and grid.get('graded') and grid.get('source') and grid.get('grading'),'ship a graded grid with its ungraded source beside it'
def load_grid(name):
 values=np.frombuffer(gzip.decompress((data_dir/name).read_bytes()),dtype='<i2').astype(np.float64)*grid.get('scale',.01)
 assert values.size==w*h and np.isfinite(values).all();return values
heights=load_grid(grid['file']);source=load_grid(grid['source'])
assert cell<=12 and heights.min()>-100 and 50<heights.max()<200,"harbour channels reach about -80 m on the local datum; hills stay under 120 m"
assert grid['originX']<=bounds['minX'] and grid['originX']+(w-1)*cell>=bounds['maxX'] and grid['originZ']<=bounds['minZ'] and grid['originZ']+(h-1)*cell>=bounds['maxZ']
delta=heights-source;changed=int((np.abs(delta)>.001).sum())
# grade-terrain counts float changes over 1 mm before the centimetre quantization collapses the smallest ones.
assert grid['grading']['changedVertices']*.9<=changed<=grid['grading']['changedVertices'] and np.abs(delta).max()<max(grid['grading']['maxCut'],grid['grading']['maxFill'])+.02,'grading record must describe the shipped grid'
assert changed>100000 and changed<w*h*.5,'grading touched an implausible share of the grid'
def elevation(x,z,values=heights):
 fx=max(0,min(w-1,(x-grid['originX'])/cell));fz=max(0,min(h-1,(z-grid['originZ'])/cell));i=min(w-2,int(fx));j=min(h-2,int(fz));tx=fx-i;tz=fz-j;k=j*w+i
 a,b,c,d=values[k],values[k+1],values[k+w],values[k+w+1]
 return a+(b-a)*tx+(c-a)*tz if tx+tz<=1 else d+(c-d)*(1-tx)+(b-d)*(1-tz)
assert abs(elevation(*sp,source))<.1,'original Back Bay reference datum moved'
assert abs(elevation(*sp))<.5,'graded spawn height drifted from the datum'

# ---- far hulls (DBF2)
raw=gzip.decompress((data_dir/city['tiles']['far']).read_bytes());assert raw[:4]==b'DBF2'
length=struct.unpack_from('<I',raw,4)[0];far_header=json.loads(raw[8:8+length]);body=8+length;body+=(-body)%4
assert far_header['size']==city['tiles']['size']
far_counts={};far_total=0;far_fragments=0;far_hidden=0
for entry in far_header['tiles']:
 offset=body+entry['offset'];primaries=0;previous=None
 for n in range(entry['count']):
  points,height_cm,base_cm,flags,style=struct.unpack_from('<HHhBB',raw,offset);offset+=8+points*4
  assert 3<=points<=60 and 0<=flags<=15 and height_cm>0
  if flags&8:assert previous is not None and previous&4,'massing fragments must follow a hidden primary';far_fragments+=1
  else:primaries+=1;previous=flags;far_hidden+=bool(flags&4)
 far_counts[entry['key']]=primaries;far_total+=primaries
assert far_total==city['tiles']['buildingCount'] and far_fragments>20 and far_hidden>=3,'sprawling complexes must ship terraced far massing'

# ---- tiles
tiles=city['tiles'];keys=tiles['keys'];tile_dir=data_dir/tiles['directory'];size=tiles['size']
assert len(keys)==len(set(keys)) and {f't_{k}.bin' for k in keys}=={p.name for p in tile_dir.glob('*.bin')},'tile manifest must match the files shipped'
assert set(far_counts)<=set(keys),'far hull tiles must be manifest tiles (tiles holding only curbs, paths or roads have no hulls)'
policies={'catalog-metres-and-source-floor','source-floor-no-catalog-ground','legacy-backbay-feet','cambridge-catalog-feet-and-source-floor','osm-type-default','osm-levels','osm-height-tag'}
west,north,east,south=provenance['legacyCoreBounds']
buildings={};footprints_by_tile=defaultdict(list);curbs=0;park_paths=0;triangles=0;grounded=0;supported=[];scaled=0
for key in keys:
 tx,tz=map(int,key.split('_'));header,entries=tileformat.read_tile(tile_dir/tileformat.tile_name(tx,tz))
 assert (header['tx'],header['tz'],header['size'])==(tx,tz,size) and len(entries)==far_counts.get(key,0)
 curbs+=len(header['curbs']);park_paths+=len(header['parkPaths']);assert all(isinstance(r,str) for r in header['roads'])
 for b in entries:
  assert b['id'] not in buildings,f"duplicate building {b['id']}";buildings[b['id']]=b
  x,z=b['center'];assert tx*size<=x<(tx+1)*size and tz*size<=z<(tz+1)*size,'building filed in the wrong tile'
  assert covered.covers(Point(x,z)),f"building outside coverage: {b['id']}"
  assert len(b['footprint'])>=3 and b['height']>0 and b['district'] in names and b['norm']['policy'] in policies
  p=b['positions'];base=b['baseElevation'];assert len(p)==b['v']>0 and np.isfinite(p).all()
  if not b.get('structure'):
   assert not orient_shells(p,np.concatenate([b['facade'],b['roof']]))[1],f"{b['id']} contains an inverted occupied shell"
  assert b['facade'].max(initial=-1)<b['v'] and b['roof'].max(initial=-1)<b['v'] and b['facade'].size+b['roof'].size>0
  top=p[:,1].max();bottom=p[:,1].min();step=b.get('scale',tileformat.SCALE);triangles+=len(b['facade'])+len(b['roof'])
  if b.get('source')=='osm-extrusion':
   assert 0<b['eaveHeight']<=b['height']+.02,f"{b['id']} lacks a valid wall/eave height"
   eave=base+b['eaveHeight']
   assert abs(eave-b['norm']['max'])<.011,f"{b['id']} eave differs from the extrusion audit"
   for faces in [b['facade'],b['roof']]:
    a,c,d=p[faces[:,0]],p[faces[:,1]],p[faces[:,2]];n=np.cross(c-a,d-a);length=np.linalg.norm(n,axis=1)
    ends=(np.maximum.reduce([a[:,1],c[:,1],d[:,1]])>eave+.02)&(np.abs(n[:,1])<length*.05)
    outward=((a+c+d)/3)[:,[0,2]]-np.asarray(b['center'])
    assert np.all(np.sum(n[ends][:,[0,2]]*outward[ends],axis=1)>0),f"{b['id']} has an inward-facing gable end"
  if step!=tileformat.SCALE:scaled+=1;assert step in tileformat.SCALES and np.abs(p-np.asarray(b['anchor'])).max()/step<=32767
  assert bottom>=base-step/2-.001,f"{b['id']} falls below its documented base elevation"
  assert top<=base+b['height']+step/2+.012,f"{b['id']} height double-translated or misreported"
  if b.get('partOf'):supported.append(b)
  elif b['norm']['policy']=='legacy-backbay-feet':assert west<=x<=east and north<=z<=south,'original Back Bay normalization applied outside core'
  elif b['source']!='osm-extrusion':assert abs(bottom-base)<=step/2+.002,f"floating primary building {b['id']}: {bottom-base:.3f} m gap";grounded+=1
  footprints_by_tile[(tx,tz)].append((b['id'],b['footprint'],min(v[0] for v in b['footprint']),max(v[0] for v in b['footprint']),min(v[1] for v in b['footprint']),max(v[1] for v in b['footprint'])))
assert len(buildings)==far_total
for b in supported:
 parent=buildings.get(b['partOf']);assert parent,f"{b['id']} claims an absent parent"
 own=Polygon(b['footprint']).buffer(0);overlap=own.intersection(Polygon(parent['footprint']).buffer(0)).area/max(.01,own.area)
 assert overlap>=.895,f"{b['id']} upper part lacks footprint support"
 assert b['norm']['min']<=parent['norm']['max']+.251 and abs(b['baseElevation']-parent['baseElevation'])<.001 and abs(b['norm']['ground']-parent['norm']['ground'])<.001,f"{b['id']} support does not reach the upper part"
landmark_ids={b['id'] for b in city['landmarkBuildings']}
assert landmark_ids<=set(buildings) and all(buildings[b['id']]['center']==b['center'] for b in city['landmarkBuildings'])
assert {'BOS-KBIA4-2XA04-WNETP','BOS-1WKHX-X382F-V5VL1','BOS-Q6TUK-T7ZG3-2SJKK','BOS-73AP7-T4BL0-O4QDM','BOS-DA4MQ-LLJZX-89MF5','BOS-2ZJZB-IWPEJ-JUBMC','BOS-0HKZL-2YJWH-V1GAU','BOS-2E9SM-83L3W-UVT08','BOS-4WO5X-6OJI5-G5S26'}<=landmark_ids,'exact-mesh complexes must be addressable before their tiles stream'
structures=[b for b in buildings.values() if b.get('structure')];assert {b['id'] for b in structures}=={'BOS-2E9SM-83L3W-UVT08'} and all(len(b['footprint'])==4 and Polygon(b['footprint']).area<50 for b in structures),'structures carry a token footprint'
assert {'BOS-2TDFM-6RXRJ-7SQZ9','BOS-P19FP-VQY0E-MMBXS'}<=set(buildings),'original Back Bay churches were lost'
assert sum(b['district']=='Back Bay' for b in buildings.values())>=160,'original Back Bay coverage was lost'
assert curbs>10000 and park_paths>1000 and len(city['signals'])>1000

def point_in_polygon(x,z,poly):
 inside=False
 for i,a in enumerate(poly):
  b=poly[i-1]
  if (a[1]>z)!=(b[1]>z) and x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]:inside=not inside
 return inside
def buildings_near(x,z,reach=0):
 tx,tz=tileformat.tile_of(x,z,size)
 for dx in (-1,0,1):
  for dz in (-1,0,1):
   for identifier,poly,x0,x1,z0,z1 in footprints_by_tile.get((tx+dx,tz+dz),()):
    if x0-reach<=x<=x1+reach and z0-reach<=z<=z1+reach:yield identifier,poly
def inside_building(x,z):return any(point_in_polygon(x,z,poly) for _,poly in buildings_near(x,z))
def distance_to_segment(p,a,b):
 dx,dz=b[0]-a[0],b[1]-a[1];u=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz or 1)))
 return math.hypot(p[0]-a[0]-u*dx,p[1]-a[1]-u*dz)

# ---- roads
cells=defaultdict(list)
for r in city['roads']:
 assert len(r['points'])>=2 and r['oneway'] in (-1,0,1) and 3<=r['width']<=20,r['id']
 if r.get('elevations'):assert len(r['elevations'])==len(r['points']) and all(math.isfinite(v) for v in r['elevations']),'invalid deck profile'
 if r.get('deckWidths'):assert r.get('elevations') and len(r['deckWidths'])==len(r['points']) and all(math.isfinite(v) and 3<=v<=r['width'] for v in r['deckWidths']),'invalid per-section deck width'
 if r.get('deckTangents'):assert set(r['deckTangents'])=={'start','end'} and all(len(v)==2 and all(math.isfinite(n) for n in v) and math.hypot(*v)>.001 for v in r['deckTangents'].values()),'invalid shared deck tangent'
 for x,z in r['points']:
  assert bounds['minX']-.01<=x<=bounds['maxX']+.01 and bounds['minZ']-.01<=z<=bounds['maxZ']+.01
  assert covered.covers(Point(x,z)),f"road escapes curated coverage: {r['name']} {r['id']}"
 for a,b in zip(r['points'],r['points'][1:]):
  for i in range(int(min(a[0],b[0])//250),int(max(a[0],b[0])//250)+1):
   for j in range(int(min(a[1],b[1])//250),int(max(a[1],b[1])//250)+1):cells[(i,j)].append((r,a,b))
assert any(r['name']=='Newbury Street' for r in city['roads']) and any(r['name']=='Massachusetts Avenue' for r in city['roads'])
# Boston centerlines drop every limited-access name; the OSM towns keep surface trunks such as Concord Turnpike (Route 2) but never motorways.
assert not any((r['name'].startswith('Interstate ') or 'Expressway' in r['name'] or 'Massachusetts Turnpike' in r['name'] or ('Turnpike' in r['name'] and not r['id'].startswith('osm-'))) for r in city['roads']),'highway or tunnel flattened into street network'
def roadway_depth(point):
 i,j=int(point[0]//250),int(point[1]//250);best=math.inf
 for di in (-1,0,1):
  for dj in (-1,0,1):
   for r,a,b in cells.get((i+di,j+dj),()):best=min(best,distance_to_segment(point,a,b)-r['width']/2)
 return best
assert min(distance_to_segment(sp,a,b) for r in city['roads'] if r['name']=='Boylston Street' for a,b in zip(r['points'],r['points'][1:]))<3,'spawn outside Boylston travel lane'
assert not inside_building(*sp),'spawn in building'
clearance=min(distance_to_segment(sp,a,b) for _,poly in buildings_near(*sp,40) for a,b in zip(poly,poly[1:]+poly[:1]));assert clearance>4,'spawn lacks vehicle clearance'

# ---- destinations
ids={l['id'] for l in city['landmarks']}
assert {'hancock','trinity','library','brigham-circle','mission-hill','fenway-park','kenmore-square','state-house','downtown-crossing','chinatown-gate','boston-common','public-garden','huntington-mfa','bowker-overpass','harvard-square','harvard-yard','mit-great-dome','kendall-square','davis-square','union-square','prospect-hill','coolidge-corner','brookline-village','bunker-hill-monument','jfk-library','franklin-park-zoo','arnold-arboretum','castle-island','logan-airport','td-garden','faneuil-hall','old-north-church','custom-house'}<=ids
assert len(ids)==len(city['landmarks'])
assert next(l for l in city['landmarks'] if l['id']=='mission-hill').get('driveStart'),'missing safe hill arrival'
for landmark in city['landmarks']:
 assert covered.covers(Point(*landmark['position'])),f"destination outside coverage: {landmark['name']}"
 arrival=landmark.get('driveStart')
 if not arrival:continue
 point=[arrival['x'],arrival['z']];assert all(math.isfinite(arrival[k]) for k in ['x','z','yaw'])
 if arrival.get('roadId'):assert any(r['id']==arrival['roadId'] and r.get('elevations') for r in city['roads']),'unknown arrival deck'
 assert covered.covers(Point(*point)) and not inside_building(*point),f"arrival inside building or outside coverage: {landmark['name']}"
 assert roadway_depth(point)<0,f"arrival outside roadway: {landmark['name']}"
assert elevation(*next(l for l in city['landmarks'] if l['id']=='mission-hill')['position'])>45 and elevation(*next(l for l in city['landmarks'] if l['id']=='brigham-circle')['position'])>5

# ---- connectivity: a continuous surface-road route from the spawn to every destination
graph=defaultdict(list);positions={};road_edges=defaultdict(list)
def node(point,y):
 key=(round(point[0]*2),round(point[1]*2),round(y*2));positions[key]=point;return key
for road in city['roads']:
 ys=road.get('elevations')
 for i,(a,b) in enumerate(zip(road['points'],road['points'][1:])):
  ka,kb=node(a,ys[i] if ys else elevation(*a)),node(b,ys[i+1] if ys else elevation(*b));length=math.dist(a,b)
  graph[ka].append((kb,length,road['id']));graph[kb].append((ka,length,road['id']));road_edges[road['id']].extend([ka,kb])
start_road=min(city['roads'],key=lambda r:min(distance_to_segment(sp,a,b) for a,b in zip(r['points'],r['points'][1:])))
starts=set(road_edges[start_road['id']]);distance={k:math.dist(positions[k],sp) for k in starts};queue=[(d,k) for k,d in distance.items()];heapq.heapify(queue)
while queue:
 d,a=heapq.heappop(queue)
 if d!=distance[a]:continue
 for b,cost,_ in graph[a]:
  candidate=d+cost
  if candidate<distance.get(b,math.inf):distance[b]=candidate;heapq.heappush(queue,(candidate,b))
reached=sum(1 for k in positions if k in distance)
assert reached>len(positions)*.9,f'only {reached} of {len(positions)} road nodes connect to the spawn'
print(f'Road network: {reached} of {len(positions)} nodes connect to the spawn.')
detached=0
for landmark in city['landmarks']:
 arrival=landmark.get('driveStart');point=[arrival['x'],arrival['z']] if arrival else landmark['position']
 road=next((r for r in city['roads'] if arrival and r['id']==arrival.get('roadId')),None) or min(city['roads'],key=lambda r:min(distance_to_segment(point,a,b) for a,b in zip(r['points'],r['points'][1:])))
 reachable=[k for k in road_edges[road['id']] if k in distance]
 if landmark.get('detached'):assert not reachable and 'East Boston' in landmark['description'],f"{landmark['name']} is marked detached but connects by road";detached+=1;print(f"Detached {landmark['name']}: {landmark['detached']}");continue
 assert reachable,f"disconnected destination: {landmark['name']}"
 best=min(distance[k]+math.dist(positions[k],point) for k in reachable)
 print(f"Connected {landmark['name']}: {best:.0f} m by road; elevation {elevation(*landmark['position']):.2f} m.")
tile_bytes=sum(p.stat().st_size for p in tile_dir.glob('*.bin'))
print(f"Validated {len(buildings)} buildings ({scaled} coarser-quantized complexes, {grounded} grounded primary meshes, {len(supported)} supported upper parts, {triangles} triangles) in {len(keys)} tiles ({tile_bytes/1e6:.1f} MB), {len(city['roads'])} roads, {curbs} curbs, {park_paths} park paths, {len(city['signals'])} signals, {len(city['landmarks'])} destinations.")
print(f"Terrain verified: {w}x{h} at {cell} m, graded range {heights.min():.2f}..{heights.max():.2f} m, {changed} cells graded (max cut {grid['grading']['maxCut']} m, fill {grid['grading']['maxFill']} m). Spawn is {clearance:.2f} m from the nearest building.")
