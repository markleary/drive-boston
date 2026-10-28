#!/usr/bin/env python3
"""Validate the compiled geography/GLB, including navigable spawn clearance."""
import argparse, heapq, json, math, pathlib, struct
from collections import defaultdict
ROOT=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');args=parser.parse_args()
city=json.loads((args.data_dir/'city.json').read_text())
provenance=json.loads((args.data_dir/'provenance.json').read_text())
source_models={m['Model_ID']:m for m in provenance['models']}
buf=(args.data_dir/'city.glb').read_bytes()
magic,version,length=struct.unpack_from('<III',buf)
assert (magic,version,length)==(0x46546c67,2,len(buf)), 'Invalid GLB container'
json_length,json_type=struct.unpack_from('<I4s',buf,12)
assert json_type==b'JSON'
gltf=json.loads(buf[20:20+json_length])
bin_length,bin_type=struct.unpack_from('<I4s',buf,20+json_length)
assert bin_type==b'BIN\0' and 28+json_length+bin_length==len(buf)
assert len(gltf['meshes'])==len(city['buildings'])>100
ids=[b['id'] for b in city['buildings']]
assert len(ids)==len(set(ids))
assert {n['extras']['buildingId'] for n in gltf['nodes']}==set(ids)
assert {'hancock','trinity','library'}<={l['id'] for l in city['landmarks']}
assert any(r['name']=='Newbury Street' for r in city['roads'])
assert any(r['name']=='Commonwealth Avenue' for r in city['roads'])
assert all(r['oneway'] in (-1,0,1) and 3<=r['width']<=20 for r in city['roads'])
assert len(city['curbs'])>100 and len(city['signals'])>20
bounds=city['bounds']
expanded=bool(city.get('elevation'))
central=provenance.get('region')=='central'
assert (5600<bounds['maxX']-bounds['minX']<5800 and 4200<bounds['maxZ']-bounds['minZ']<4400) if central else (3700<bounds['maxX']-bounds['minX']<3800 and 3100<bounds['maxZ']-bounds['minZ']<3200) if expanded else (800<bounds['maxX']-bounds['minX']<850 and 650<bounds['maxZ']-bounds['minZ']<700)
for r in city['roads']:
 assert len(r['points'])>=2
 for x,z in r['points']:
  assert bounds['minX']-.01<=x<=bounds['maxX']+.01
  assert bounds['minZ']-.01<=z<=bounds['maxZ']+.01
for a in gltf['accessors']:
 view=gltf['bufferViews'][a['bufferView']]
 assert view['byteOffset']%4==0 and view['byteOffset']+view['byteLength']<=bin_length
 assert a['count']>0
 for k in ('min','max'):
  if k in a:assert all(math.isfinite(v) for v in a[k])
buildings_by_id={b['id']:b for b in city['buildings']}
mesh_minima={}
for mesh in gltf['meshes']:
 building=buildings_by_id[mesh['name']];base=building.get('baseElevation',0)
 mesh_minima[mesh['name']]=min(gltf['accessors'][p['attributes']['POSITION']]['min'][1] for p in mesh['primitives'])
 for primitive in mesh['primitives']:
  assert primitive['material'] in (0,1)
  attrs=primitive['attributes'];p=gltf['accessors'][attrs['POSITION']]
  assert p['count']==gltf['accessors'][attrs['NORMAL']]['count']==gltf['accessors'][attrs['TEXCOORD_0']]['count']
  assert p['min'][1]>=base-.001, 'Mesh falls below its documented base elevation'
  assert p['max'][1]<=base+building['height']+.012, 'Building height double-translated or misreported'
  assert gltf['accessors'][primitive['indices']]['count']%3==0

def point_in_polygon(x,z,poly):
 inside=False
 for i,a in enumerate(poly):
  b=poly[i-1]
  if (a[1]>z)!=(b[1]>z) and x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]:inside=not inside
 return inside

def distance_to_segment(p,a,b):
 dx,dz=b[0]-a[0],b[1]-a[1];u=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz or 1)))
 return math.hypot(p[0]-a[0]-u*dx,p[1]-a[1]-u*dz)

def polygon_area(poly):
 return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1])))/2 if poly else 0

def convex_intersection(subject,clip):
 # Metadata footprints are convex hulls; this makes support validation possible
 # with the standard library rather than trusting the compiler's classification.
 output=[list(p) for p in subject]
 for a,b in zip(clip,clip[1:]+clip[:1]):
  if not output:break
  source=output;output=[];previous=source[-1]
  cross=lambda p:(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
  dp=cross(previous)
  for current in source:
   dc=cross(current)
   if (dc>=-1e-6)!=(dp>=-1e-6):
    t=dp/(dp-dc);output.append([previous[0]+(current[0]-previous[0])*t,previous[1]+(current[1]-previous[1])*t])
   if dc>=-1e-6:output.append(current)
   previous=current;dp=dc
 return output
spawn=city['spawn'];sp=[spawn['x'],spawn['z']]
assert not any(point_in_polygon(*sp,b['footprint']) for b in city['buildings']), 'Spawn in building'
road_distance=min(distance_to_segment(sp,a,b) for r in city['roads'] if r['name']=='Boylston Street' for a,b in zip(r['points'],r['points'][1:]))
assert road_distance<3,'Spawn outside Boylston travel lane'
clearance=min(distance_to_segment(sp,a,b) for building in city['buildings'] for a,b in zip(building['footprint'],building['footprint'][1:]+building['footprint'][:1]))
assert clearance>4,'Spawn lacks vehicle clearance'
print(f"Validated {len(ids)} building meshes, {len(city['roads'])} road paths, {len(city['landmarks'])} destinations, and GLB buffers. Spawn is {road_distance:.2f} m from road center and {clearance:.2f} m from nearest building.")

if expanded:
 expected={'hancock','trinity','library','brigham-circle','mission-hill'}
 if central:expected|={'fenway-park','kenmore-square','state-house','downtown-crossing','chinatown-gate','boston-common','public-garden','huntington-mfa'}
 if provenance.get('roadStructures'):expected.add('bowker-overpass')
 assert {l['id'] for l in city['landmarks']}==expected
 assert sum(b.get('district')=='Back Bay' for b in city['buildings'])>=160, 'Original Back Bay coverage was lost'
 assert {'BOS-2TDFM-6RXRJ-7SQZ9','BOS-P19FP-VQY0E-MMBXS'}<=set(ids), 'Original Back Bay churches were lost'
 supported_parts=0;grounded_primary=0
 for building in city['buildings']:
  model=source_models[building['id']];base=building['baseElevation'];offset=mesh_minima[building['id']]-base
  assert 'normalizationGroundMeters' in model, 'Missing audited source-ground normalization'
  expected=max(0,model['sourceMinimumMeters']-model['normalizationGroundMeters'])
  assert abs(offset-expected)<.002, 'GLB ground offset does not match source metre normalization'
  if building.get('partOf'):
   parent=buildings_by_id[building['partOf']];parent_source=source_models[parent['id']]
   overlap=polygon_area(convex_intersection(building['footprint'],parent['footprint']))/max(.01,polygon_area(building['footprint']))
   assert overlap>=.895, 'Claimed upper part lacks footprint support'
   assert model['sourceMinimumMeters']<=parent_source['sourceMaximumMeters']+.251, 'Claimed support does not reach upper part'
   assert abs(base-parent['baseElevation'])<.001, 'Upper part uses a different terrain translation'
   assert abs(model['normalizationGroundMeters']-parent_source['normalizationGroundMeters'])<.001, 'Upper part lost its parent source datum'
   supported_parts+=1
  elif model['normalizationPolicy']!='legacy-backbay-feet':
   assert abs(offset)<.002,f"Floating primary building: {building['id']} has {offset:.2f}m gap"
   grounded_primary+=1
  else:
   west,north,east,south=provenance.get('legacyCoreBounds',[-470.397,-432.484,356.823,238.068])
   assert west<=building['center'][0]<=east and north<=building['center'][1]<=south, 'Original Back Bay normalization applied outside core'
 print(f'Ground contact verified: {grounded_primary} expanded-area primary meshes touch their base; {supported_parts} upper parts have geometric and vertical support.')
 grid=city['elevation'];w=grid['width'];h=grid['height'];cell=grid['cellSize'];heights=grid['heights']
 assert len(heights)==w*h and all(math.isfinite(v) for v in heights)
 assert cell<=12 and min(heights)>-30 and 50<max(heights)<100
 assert grid['originX']<=bounds['minX'] and grid['originX']+(w-1)*cell>=bounds['maxX']
 assert grid['originZ']<=bounds['minZ'] and grid['originZ']+(h-1)*cell>=bounds['maxZ']
 def elevation(x,z):
  fx=max(0,min(w-1,(x-grid['originX'])/cell));fz=max(0,min(h-1,(z-grid['originZ'])/cell));i=min(w-2,int(fx));j=min(h-2,int(fz));tx=fx-i;tz=fz-j;k=j*w+i
  a,b,c,d=heights[k],heights[k+1],heights[k+w],heights[k+w+1]
  return a+(b-a)*tx+(c-a)*tz if tx+tz<=1 else d+(c-d)*(1-tx)+(b-d)*(1-tz)
 assert abs(elevation(*sp))<.1, 'Original Back Bay reference datum moved'
 assert city.get('coverage') and all(len(poly)>3 for poly in city['coverage'])
 def covered(point):
  return any(point_in_polygon(*point,poly) or min(distance_to_segment(point,a,b) for a,b in zip(poly,poly[1:]+poly[:1]))<.015 for poly in city['coverage'])
 assert all(covered(b['center']) for b in city['buildings'])
 assert all(covered(p) for r in city['roads'] for p in r['points']), 'Road escapes curated coverage'
 arrival=next(l for l in city['landmarks'] if l['id']=='mission-hill').get('driveStart');assert arrival,'Missing safe hill arrival'
 arrival_point=[arrival['x'],arrival['z']]
 assert covered(arrival_point) and not any(point_in_polygon(*arrival_point,b['footprint']) for b in city['buildings']), 'Hill arrival inside building or outside coverage'
 assert min(distance_to_segment(arrival_point,a,b)-r['width']/2 for r in city['roads'] for a,b in zip(r['points'],r['points'][1:]))<0,'Hill arrival is outside a roadway'
 for landmark in city['landmarks']:
  arrival=landmark.get('driveStart')
  if not arrival:continue
  point=[arrival['x'],arrival['z']]
  assert all(math.isfinite(arrival[k]) for k in ['x','z','yaw']),'Non-finite destination arrival'
  if arrival.get('roadId'):assert any(r['id']==arrival['roadId'] and r.get('elevations')for r in city['roads']),'Unknown arrival deck'
  assert covered(point),'Destination arrival outside coverage'
  assert not any(point_in_polygon(*point,b['footprint']) for b in city['buildings']),f"Arrival inside building: {landmark['name']}"
  assert min(distance_to_segment(point,a,b)-r['width']/2 for r in city['roads'] for a,b in zip(r['points'],r['points'][1:]))<0,f"Arrival outside roadway: {landmark['name']}"
 if central:
  assert len(city['coverage'])==1,'Requested neighborhood union has disconnected pieces'
  assert {n['name'] for n in city['neighborhoods']}=={'Mission Hill','Longwood','Fenway','Back Bay','Bay Village','Leather District','Chinatown','Beacon Hill','Downtown'}
  assert {'Boston Common','Public Garden','Back Bay Fens'}<={p['name'] for p in city['parks']},'A requested major park was omitted'
  for park in city['parks']+city['water']:
   assert park['rings'] and all(len(ring)>=3 and all(math.isfinite(v) for p in ring for v in p) for ring in park['rings'])
  assert len(city.get('parkPaths',[]))>100 and any(p.get('bridge') for p in city['parkPaths']),'Missing park path/bridge network'
  for path in city['parkPaths']:
   assert 1<=path['width']<=8 and len(path['points'])>=2
   assert all(all(math.isfinite(v) for v in p) and covered(p) for p in path['points']),'Park path outside curated map'
  assert not any(r['name'].startswith('Interstate ') or 'Turnpike' in r['name'] or 'Expressway' in r['name'] for r in city['roads']),'Highway or tunnel flattened into street network'
 # Actual source topology must provide a continuous surface-road route from
 # the original spawn to both new destinations, not merely disconnected tiles.
 graph=defaultdict(list);positions={};road_edges=defaultdict(list)
 def node(point,y):
  key=(round(point[0]*2),round(point[1]*2),round(y*2));positions[key]=point;return key
 for road in city['roads']:
  if road.get('elevations'):
   assert len(road['elevations'])==len(road['points']) and all(math.isfinite(v)for v in road['elevations']),'Invalid deck profile'
  for i,(a,b) in enumerate(zip(road['points'],road['points'][1:])):
   ys=road.get('elevations');ka,kb=node(a,ys[i]if ys else elevation(*a)),node(b,ys[i+1]if ys else elevation(*b));length=math.dist(a,b);graph[ka].append((kb,length,road['id']));graph[kb].append((ka,length,road['id']));road_edges[road['id']].extend([ka,kb])
 start_road=min(city['roads'],key=lambda r:min(distance_to_segment(sp,a,b) for a,b in zip(r['points'],r['points'][1:])))
 starts=set(road_edges[start_road['id']]);distance={k:math.dist(positions[k],sp) for k in starts};queue=[(d,k) for k,d in distance.items()];heapq.heapify(queue);previous={}
 while queue:
  d,a=heapq.heappop(queue)
  if d!=distance[a]:continue
  for b,cost,road_id in graph[a]:
   candidate=d+cost
   if candidate<distance.get(b,math.inf):distance[b]=candidate;previous[b]=(a,road_id);heapq.heappush(queue,(candidate,b))
 for landmark in city['landmarks']:
  target=landmark['position'];arrival=landmark.get('driveStart');arrival_point=[arrival['x'],arrival['z']] if arrival else target
  road=next((r for r in city['roads']if arrival and r['id']==arrival.get('roadId')),None) or min(city['roads'],key=lambda r:min(distance_to_segment(arrival_point,a,b) for a,b in zip(r['points'],r['points'][1:])))
  reachable=[k for k in road_edges[road['id']] if k in distance];assert reachable,f"Disconnected destination: {landmark['name']}"
  endpoint=min(reachable,key=lambda k:distance[k]+math.dist(positions[k],target));route=[];k=endpoint
  while k in previous:k,r=previous[k];route.append(r)
  route.reverse();names=[]
  by_id={r['id']:r for r in city['roads']}
  for r in route:
   name=by_id[r]['name']
   if not names or names[-1]!=name:names.append(name)
  if landmark['id']=='brigham-circle':assert elevation(*target)>5
  if landmark['id']=='mission-hill':assert elevation(*target)>45
  print(f"Connected {landmark['name']}: {distance[endpoint]+math.dist(positions[endpoint],target):.0f}m via {', '.join(names)}; elevation {elevation(*target):.2f}m.")
 print(f"Terrain verified: {w}x{h} at {cell}m, elevation range {min(heights):.2f}..{max(heights):.2f}m; shaped coverage and elevated mesh bounds valid.")
