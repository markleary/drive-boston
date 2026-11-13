#!/usr/bin/env python3
"""Validate the tiled metro package: city.json with its graded and source
elevation grids, the far-distance hulls, every DBT2 tile (geometry inside its
documented envelope, audited ground normalization, supported upper parts),
navigable spawn clearance and a continuous surface-road route to every
destination. Needs the data virtualenv (numpy, shapely):

  .venv-data/bin/python scripts/validate-city.py [--data-dir public/data]
"""
import argparse, copy, gzip, heapq, json, math, pathlib, struct, sys
import hashlib
from collections import defaultdict
import numpy as np
from shapely.geometry import Polygon, Point
from shapely.ops import unary_union
from shapely.prepared import prep
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'));import tileformat
from mesh_winding import orient_patches,orient_shells
from building_clearance import RoadClearanceIndex
from building_collision_policy import exact_far_collision
from far_massing import Corridors,encode,read_far,shell_massing
from harvard_bridge import validate_harvard_profile
from harvard_cambridge import validate_cambridge
from road_connections import validate_source_connections
from longfellow_connections import validate_longfellow_connections
from rutherford_connections import validate_rutherford
from leverett_connections import validate_leverett
from museum_approaches import validate_approaches
from road_structure_clearance import validate_bridge_clearance
from water_crossings import level_water_crossings,water_inputs
from land_approaches import TOWN_LINKS,level_land_approaches,restore_sources,water_chain_ids,levelled_water_ids
import north_overpasses
import i93_north
import boston_highways
import footbridges
from harvard_terrain import repair_memorial_terrain
from road_generation_audit import validate_surfaces
from roadway_buildings import roadway_buildings
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
towns={'Cambridge','Somerville','Brookline','Chelsea','Everett','Medford','Malden','Melrose'};excluded={'Roslindale','West Roxbury','Hyde Park','Harbor Islands'}
names={n['name'] for n in city['neighborhoods']}
assert towns<=names and not names&excluded,'town and excluded-neighborhood policy'
assert {'Back Bay','Beacon Hill','Downtown','Chinatown','Mission Hill','Fenway','Longwood','Dorchester','Roxbury','Jamaica Plain','South Boston','East Boston','Charlestown','Allston','Brighton','Mattapan','North End','West End','South End'}<=names
assert all(n['town']==(n['name'] in towns) for n in city['neighborhoods'])
assert {'Boston Common','Public Garden','Back Bay Fens','Franklin Park','Arnold Arboretum'}<={p['name'] for p in city['parks']},'a major park was omitted'
for area in city['parks']+city['water']:
 assert area['rings'] and all(len(ring)>=3 and all(math.isfinite(v) for p in ring for v in p) for ring in area['rings'])

# Hydro unions connect rivers at different heights; their render partitions
# must survive regeneration and preserve mapped shores/islands without overlap.
largest_water=max(city['water'],key=lambda a:Polygon(a['rings'][0],a['rings'][1:]).area)
assert largest_water.get('surfaces'),'run build-water-surfaces.py after terrain grading to retain horizontal basin/reach levels'
for area in city['water']:
 if 'surfaces' not in area:continue
 polygons=[]
 for surface in area['surfaces']:
  assert math.isfinite(surface['level']),f"{area['id']} has a missing water level"
  rings=surface['rings'];assert rings and all(len(r)>=3 and all(math.isfinite(v) for p in r for v in p) for r in rings)
  polygon=Polygon(rings[0],rings[1:]);assert polygon.is_valid and polygon.area>0,f"{area['id']} has an invalid water surface ({surface['name']})"
  polygons.append(polygon)
 outline=Polygon(area['rings'][0],area['rings'][1:]);joined=unary_union(polygons);tolerance=max(1,outline.area*1e-6)
 assert outline.symmetric_difference(joined).area<tolerance,f"{area['id']} water surfaces leave gaps or escape the mapped shoreline"
 assert sum(p.area for p in polygons)-joined.area<1,f"{area['id']} water planes overlap"

# ---- elevation grids
grid=city['elevation'];w,h,cell=grid['width'],grid['height'],grid['cellSize']
assert grid['encoding']=='int16-gzip' and grid.get('graded') and grid.get('source') and grid.get('grading'),'ship a graded grid with its ungraded source beside it'
def reproducible(name):
 """Shipped gzip streams must depend on their content alone (tileformat.write_gzip, Node zlib): zero mtime, no name, no extra fields."""
 head=(data_dir/name).read_bytes()[:10];assert head[:3]==b'\x1f\x8b\x08' and head[3]==0 and head[4:8]==b'\0\0\0\0',f'{name} gzip header carries a timestamp or file name; rebuild with the reproducible writers'
def load_grid(name):
 reproducible(name);values=np.frombuffer(gzip.decompress((data_dir/name).read_bytes()),dtype='<i2').astype(np.float64)*grid.get('scale',.01)
 assert values.size==w*h and np.isfinite(values).all();return values
heights=load_grid(grid['file']);source=load_grid(grid['source'])
assert repair_memorial_terrain(city,heights,apply=False)['changedVertices']==0,'Memorial underpass terrain needs restore-water-crossings.py'
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
reproducible(city['tiles']['far']);raw=gzip.decompress((data_dir/city['tiles']['far']).read_bytes());assert raw[:4]==b'DBF2'
length=struct.unpack_from('<I',raw,4)[0];far_header=json.loads(raw[8:8+length]);body=8+length;body+=(-body)%4
assert far_header['size']==city['tiles']['size']
far_counts={};far_flags={};far_total=0;far_fragments=0;far_hidden=0
for entry in far_header['tiles']:
 offset=body+entry['offset'];primaries=0;previous=None;flags_for_tile=[]
 for n in range(entry['count']):
  points,height_cm,base_cm,flags,style=struct.unpack_from('<HHhBB',raw,offset);offset+=8+points*4
  assert 3<=points<=60 and 0<=flags<=15 and height_cm>0
  if flags&8:
   assert previous is not None and previous&4,'massing fragments must follow a hidden primary'
   assert flags&2==previous&2,'massing fragments must share their primary exact-mesh flag'
   far_fragments+=1
  else:primaries+=1;previous=flags;far_hidden+=bool(flags&4);flags_for_tile.append(flags)
 far_counts[entry['key']]=primaries;far_total+=primaries
 far_flags[entry['key']]=flags_for_tile
assert far_total==city['tiles']['buildingCount'] and far_fragments>20 and far_hidden>=3,'sprawling complexes must ship terraced far massing'
# Each hidden primary with the fragments after it, for the build-far-massing.py rerun check in the tile loop.
far_massing={}
for key,records in read_far(raw)[1].items():
 for record in records:
  if record[6]&8:far_massing[key][-1][1]+=record
  else:far_massing.setdefault(key,[]).append([record,b''])
massing_corridors=Corridors(city['roads']);massing_complexes=0

# ---- tiles
tiles=city['tiles'];keys=tiles['keys'];tile_dir=data_dir/tiles['directory'];size=tiles['size']
assert len(keys)==len(set(keys)) and {f't_{k}.bin' for k in keys}=={p.name for p in tile_dir.glob('*.bin')},'tile manifest must match the files shipped'
assert set(far_counts)<=set(keys),'far hull tiles must be manifest tiles (tiles holding only curbs, paths or roads have no hulls)'
policies={'assessor-style','assessor-storeys','catalog-metres-and-source-floor','source-floor-no-catalog-ground','legacy-backbay-feet','cambridge-catalog-feet-and-source-floor','osm-type-default','osm-levels','osm-height-tag'}
west,north,east,south=provenance['legacyCoreBounds']
buildings={};footprints_by_tile=defaultdict(list);curbs=0;park_paths=0;triangles=0;grounded=0;supported=[];scaled=0
pavements=0;borders=0;sidewalks=0;bricks=0;islands=0;driveways=0;aprons=0;stalls=0;bare=0;measured_roads={r['id'] for r in city['roads'] if r.get('pavedWidth')};road_ids={r['id'] for r in city['roads']}
clearance_index=RoadClearanceIndex(city['roads']);surface_headers={}
for key in keys:
 tx,tz=map(int,key.split('_'));reproducible(f'{tiles["directory"]}/{tileformat.tile_name(tx,tz)}');header,entries=tileformat.read_tile(tile_dir/tileformat.tile_name(tx,tz))
 surface_headers[key]={k:header[k] for k in ('tx','tz','size','streetPavement','streetSidewalks','deckPavement','sidewalks','islands','driveways','buildings')};surface_headers[key]['parking']=header.get('parking',[])
 assert (header['tx'],header['tz'],header['size'])==(tx,tz,size) and len(entries)==far_counts.get(key,0)
 curbs+=len(header['curbs']);park_paths+=len(header['parkPaths']);assert all(isinstance(r,str) for r in header['roads'])
 # Curb-bounded roadways, inventory sidewalks and islands (build-street-surfaces.py).
 for record in header['pavements']:
  e=record['edges'];assert record['road'] in road_ids and len(e)>=8 and len(e)%4==0 and all(isinstance(v,int) for v in e),f"{key}: malformed pavement record for {record.get('road')}"
  assert all(2.3<=math.hypot(e[i]-e[i+2],e[i+1]-e[i+3])/100<=60 for i in range(0,len(e),4)),f"{key}: implausible roadway width on {record['road']}"
  assert set(record.get('walk',[0,0]))<={0,1} and len(record.get('walk',[0,0]))==2
  pavements+=1
 for record in header.get('borderPavements',[]):
  assert record['road'] in road_ids and len(record['edges'])%4==0 and len(record['edges'])>=8,f'border record {record["road"]} in tile {key}';borders+=1
 for walk in header['sidewalks']:
  assert walk['rings'] and all(len(ring)>=3 for ring in walk['rings']) and walk.get('material','concrete') in ('concrete','brick');sidewalks+=1;bricks+=walk.get('material')=='brick'
 for rings in header['islands']:
  assert rings and all(len(ring)>=3 for ring in rings) and Polygon(rings[0]).area<=2600,f'{key}: island exceeds the closed-face limit';islands+=1
 for rings in header['driveways']:
  assert rings and all(len(ring)>=3 for ring in rings) and Polygon(rings[0]).area<=size*size,f'{key}: driveway part exceeds its tile';driveways+=1
 # The roadway beside a highway deck's lanes (highway_roadways.py), filed like a street's record, and the stalls of the surface lots (parking_lots.py).
 for record in header.get('highwayPavements',[]):
  e=record['edges'];assert len(e)>=8 and len(e)%4==0 and all(isinstance(v,int) for v in e) and all(math.hypot(e[i]-e[i+2],e[i+1]-e[i+3])/100<=60 for i in range(0,len(e),4)),f"{key}: malformed highway roadway of {record.get('road')}";aprons+=1
 # stretches of the tile's curbs with nothing attached, which the runtime leaves undrawn (street_surfaces.bare_curbs): [curb, from, to, ...] in centimetres along it
 gaps=header.get('bareCurbs',[]);assert len(gaps)%3==0 and all(isinstance(v,int) for v in gaps),f'{key}: malformed bare curb list'
 for i in range(0,len(gaps),3):
  c,a,b=gaps[i:i+3];assert 0<=c<len(header['curbs']) and 0<=a<b<=sum(math.dist(p,q) for p,q in zip(header['curbs'][c],header['curbs'][c][1:]))*100+2,f'{key}: a bare stretch off its curb';bare+=1
 parking=header.get('parking',[]);assert len(parking)%3==0 and all(isinstance(v,int) for v in parking),f'{key}: malformed parking stalls'
 assert all(0<=parking[i]<size*100 and 0<=parking[i+1]<size*100 and 0<=parking[i+2]<36000 for i in range(0,len(parking),3)),f'{key}: a parking stall outside its tile';stalls+=len(parking)//3
 for ordinal,b in enumerate(entries):
  assert b['id'] not in buildings,f"duplicate building {b['id']}";buildings[b['id']]=b
  x,z=b['center'];assert tx*size<=x<(tx+1)*size and tz*size<=z<(tz+1)*size,'building filed in the wrong tile'
  assert covered.covers(Point(x,z)),f"building outside coverage: {b['id']}"
  assert len(b['footprint'])>=3 and b['height']>0 and b['district'] in names and b['norm']['policy'] in policies
  crossing_roads=clearance_index.overlaps(b)
  assert b.get('roadOverlaps',[])==[r['id'] for r in crossing_roads],f"{b['id']} road-overlap metadata is stale"
  if crossing_roads:
   assert b.get('collision')=='mesh',f"{b['id']} convex proxy crosses a street; regenerate building clearance metadata"
  assert bool(far_flags[key][ordinal]&2)==exact_far_collision(b),f"{b['id']} far proxy collision policy is stale"
  if far_flags[key][ordinal]&4:
   primary,shipped=far_massing[key][ordinal];massing_complexes+=not b.get('structure')
   assert shipped or b.get('structure'),f"{b['id']} is hidden from the far city without massing fragments"
   assert encode(shell_massing(b,massing_corridors),primary,tx*size,tz*size)==shipped,f"{b['id']} far massing is stale; rerun build-far-massing.py"
  p=b['positions'];base=b['baseElevation'];assert len(p)==b['v']>0 and np.isfinite(p).all()
  if not b.get('structure'):
   shell=np.concatenate([b['facade'],b['roof']])
   assert not orient_shells(p,shell)[1],f"{b['id']} contains an inverted occupied shell"
   assert not orient_patches(p,shell)[1],f"{b['id']} has walls or roofs wound into the building"
  assert b['facade'].max(initial=-1)<b['v'] and b['roof'].max(initial=-1)<b['v'] and b['facade'].size+b['roof'].size>0
  top=p[:,1].max();bottom=p[:,1].min();step=b.get('scale',tileformat.SCALE);triangles+=len(b['facade'])+len(b['roof'])
  if b.get('source')=='osm-extrusion':
   assert 0<b['eaveHeight']<=b['height']+.02,f"{b['id']} lacks a valid wall/eave height"
   eave=base+b['eaveHeight']
   assert abs(eave-b['norm']['max'])<.011,f"{b['id']} eave differs from the extrusion audit"
   # Assessor-shaped houses (house_shapes.py) face each wing and tower away from its own part, which can face the footprint centre; their winding is verified by orient_shells/orient_patches above.
   for faces in [b['facade'],b['roof']] if not b['norm']['policy'].startswith('assessor') else []:
    a,c,d=p[faces[:,0]],p[faces[:,1]],p[faces[:,2]];n=np.cross(c-a,d-a);length=np.linalg.norm(n,axis=1)
    ends=(np.maximum.reduce([a[:,1],c[:,1],d[:,1]])>eave+.02)&(np.abs(n[:,1])<length*.05)
    outward=((a+c+d)/3)[:,[0,2]]-np.asarray(b['center'])
    assert np.all(np.sum(n[ends][:,[0,2]]*outward[ends],axis=1)>0),f"{b['id']} has an inward-facing gable end"
  if step!=tileformat.SCALE:scaled+=1;assert step in tileformat.SCALES and np.abs(p-np.asarray(b['anchor'])).max()/step<=32767
  assert bottom>=base-step/2-.001,f"{b['id']} falls below its documented base elevation"
  assert top<=base+b['height']+step/2+.012,f"{b['id']} height double-translated or misreported"
  if b.get('partOf'):supported.append(b)
  elif b['norm']['policy']=='legacy-backbay-feet':assert west<=x<=east and north<=z<=south,'original Back Bay normalization applied outside core'
  # (a shell carved for a highway passage may have lost its lowest faces to the corridor: Parcel 12 over the Turnpike's Massachusetts Avenue ramp)
  elif b['source']!='osm-extrusion':assert abs(bottom-base)<=step/2+.002 or ((b.get('buildingPassage') or {}).get('highway') and bottom>base),f"floating primary building {b['id']}: {bottom-base:.3f} m gap";grounded+=1
  footprints_by_tile[(tx,tz)].append((b['id'],b['footprint'],min(v[0] for v in b['footprint']),max(v[0] for v in b['footprint']),min(v[1] for v in b['footprint']),max(v[1] for v in b['footprint'])))
assert len(buildings)==far_total
roadway_conflicts=roadway_buildings(city,surface_headers)
assert not roadway_conflicts,f'Compact buildings obstruct measured roadways: {roadway_conflicts}'
surface_audit=validate_surfaces(surface_headers)
for b in supported:
 parent=buildings.get(b['partOf']);assert parent,f"{b['id']} claims an absent parent"
 own=Polygon(b['footprint']).buffer(0);overlap=own.intersection(Polygon(parent['footprint']).buffer(0)).area/max(.01,own.area)
 assert overlap>=.895,f"{b['id']} upper part lacks footprint support"
 assert b['norm']['min']<=parent['norm']['max']+.251 and abs(b['baseElevation']-parent['baseElevation'])<.001 and abs(b['norm']['ground']-parent['norm']['ground'])<.001,f"{b['id']} support does not reach the upper part"
landmark_ids={b['id'] for b in city['landmarkBuildings']}
assert landmark_ids<=set(buildings) and all(buildings[b['id']]['center']==b['center'] for b in city['landmarkBuildings'])
assert {'BOS-KBIA4-2XA04-WNETP','BOS-1WKHX-X382F-V5VL1','BOS-Q6TUK-T7ZG3-2SJKK','BOS-73AP7-T4BL0-O4QDM','BOS-DA4MQ-LLJZX-89MF5','BOS-2ZJZB-IWPEJ-JUBMC','BOS-0HKZL-2YJWH-V1GAU','BOS-2E9SM-83L3W-UVT08','BOS-4WO5X-6OJI5-G5S26','BOS-HO11N-VJBYE-3RDXF','BOS-3R76C-CGBE8-V3V1H'}<=landmark_ids,'exact-mesh complexes must be addressable before their tiles stream'
structures=[b for b in buildings.values() if b.get('structure')];assert {b['id'] for b in structures}=={'BOS-2E9SM-83L3W-UVT08'} and all(len(b['footprint'])==4 and Polygon(b['footprint']).area<50 for b in structures),'structures carry a token footprint'
assert {'BOS-2TDFM-6RXRJ-7SQZ9','BOS-P19FP-VQY0E-MMBXS'}<=set(buildings),'original Back Bay churches were lost'
assert sum(b['district']=='Back Bay' for b in buildings.values())>=160,'original Back Bay coverage was lost'
assert curbs>10000 and park_paths>1000 and len(city['signals'])>1000
surface_roads=[r for r in city['roads'] if not r.get('elevations') and not r.get('tunnel')]
assert pavements==len(surface_roads),f'{pavements} roadway records for {len(surface_roads)} surface roads; run build-street-surfaces.py'
assert all(1.5<=r['pavedWidth']<=45 for r in city['roads'] if r.get('pavedWidth')) and len(measured_roads)>len(surface_roads)*.7,'measured paved widths'
assert sidewalks>20000 and bricks>500 and islands>100 and driveways>100,'sidewalk inventory, curb islands and driveway fills were not installed'
street_surfaces=provenance.get('streetSurfaces');assert street_surfaces and street_surfaces['pavements']==pavements and street_surfaces.get('borderPavements',borders)==borders and street_surfaces['sidewalkParts']==sidewalks and street_surfaces['islandParts']==islands and street_surfaces['drivewayParts']==driveways and street_surfaces.get('highwayAprons',0)==aprons==len(((provenance.get('bostonHighways') or {}).get('roadways') or {}).get('aprons',[])) and street_surfaces.get('parkingStalls',0)==stalls and street_surfaces.get('bareCurbs',0)==bare,'provenance must describe the installed street surfaces'
# A stall stands on the asphalt its package draws for a lot, off the street sidewalks, and touches no street pavement (parking_lots.misplaced):
# cars parked in a roadway are fixed colliders in the travel surface, a lot beyond the coverage has no asphalt to stand on, and the sidewalk band
# of a street is where its walkers pace and its trees stand.
import parking_lots
misplaced_stalls=parking_lots.misplaced(parking_lots.in_world(surface_headers),parking_lots.tile_polygons(surface_headers,'streetPavement'),parking_lots.tile_polygons(surface_headers,'driveways'),parking_lots.tile_polygons(surface_headers,'streetSidewalks'))
assert not misplaced_stalls,f'{len(misplaced_stalls)} parking stalls stand in a street, on a sidewalk or off the asphalt of their lot, the first at {misplaced_stalls[0]}; run build-street-surfaces.py'
# and no two stalls share ground (a lot OpenStreetMap maps twice is laid out once: parking_lots.merged)
crowded_stalls=parking_lots.crowded(parking_lots.in_world(surface_headers))
assert not crowded_stalls,f'{len(crowded_stalls)} pairs of parking stalls share ground, the first at {crowded_stalls[0]}; run build-street-surfaces.py'

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
validate_harvard_profile(city['roads'])
validate_cambridge(city['roads'],lambda p:elevation(*p))
validate_source_connections(city['roads'],lambda p:elevation(*p))
validate_longfellow_connections(city['roads'],lambda p:elevation(*p))
validate_rutherford(city,json.loads((ROOT/'public/data/road-connections-source.json').read_text()),heights)
validate_leverett(city,json.loads((ROOT/'public/data/leverett-connections-source.json').read_text()),heights)
museum_source=data_dir/'museum-approaches-source.json'
validate_approaches(city,json.loads(museum_source.read_text()),heights)
assert provenance['museumRoadConnections']['sourceSHA256']==hashlib.sha256(museum_source.read_bytes()).hexdigest(),'Museum approach provenance differs from the retained source'
validate_bridge_clearance(city['roads'],elevation)
# The Massachusetts Turnpike and Storrow Drive (build-boston-highways.py) are the last road stage: replay it and check
# its records, then check every stage before it on the roads and grid as that stage found them (before_stage).
highways=provenance.get('bostonHighways');base_roads,base_heights,base_grid=city['roads'],heights,north_overpasses.load_grid(data_dir/grid['file'])
assert bool(highways)==any(boston_highways.stage_owned(r) for r in city['roads']),'provenance must describe the Turnpike and Storrow Drive stage; run build-boston-highways.py'
if highways:
 highways_path=data_dir/boston_highways.SOURCE_NAME;assert highways['source']['sha256']==hashlib.sha256(highways_path.read_bytes()).hexdigest(),'the highway source sidecar changed without regeneration'
 highway_counts=boston_highways.validate(data_dir,city,highways,elevation)
 assert boston_highways.replay(data_dir,city,highways,json.loads(highways_path.read_text())),'Turnpike or Storrow Drive roads, tunnel sidecar, terrain or building records differ from a replay of build-boston-highways.py'
 base_roads,base_heights=boston_highways.before_stage(city['roads'],heights,highways,grid.get('scale',.01));base_grid=i93_north.staged_heights(base_grid,highways)
 print(f"Validated the Turnpike and Storrow Drive: {highway_counts['decks']} deck and {highway_counts['tunnels']} tunnel records of {highway_counts['routes']} routes ({highway_counts['streetLandings']} street landings, {highway_counts['signs']} warning signs; {highway_counts['meshBuildings']} buildings with exact collision, {highway_counts['passages']} passages, {highway_counts['removedBuildings']} structures removed) match a replay of build-boston-highways.py.")
# The footbridges over those roads (build-footbridges.py): a replay writes the same park paths, and every deck leaves the roads beneath it their room.
footbridge_record=provenance.get('footbridges');footbridge_path=data_dir/footbridges.SOURCE_NAME
assert bool(footbridge_record)==footbridge_path.exists(),'provenance must describe the footbridge stage; run build-footbridges.py'
if footbridge_record:
 assert footbridge_record['source']['sha256']==hashlib.sha256(footbridge_path.read_bytes()).hexdigest(),'the footbridge source sidecar changed without regeneration'
 footbridge_counts=footbridges.validate(data_dir,city,footbridge_record,json.loads(footbridge_path.read_text()))
 print(f"Validated {footbridge_counts['bridges']} footbridges over the Turnpike and Storrow Drive: {footbridge_counts['meters']} m in {footbridge_counts['paths']} park paths, steepest {footbridge_counts['steepest']*100:.1f}%")
base_city={**city,'roads':base_roads}
def base_elevation(x,z):return elevation(x,z,base_heights)
# Interstate 93 (build-i93-north.py) runs after the stages replayed below: replay it and check its
# records, then check those stages on the roads and grid as they left them (before_stage).
i93=provenance.get('i93North');pre_roads,pre_heights=base_roads,base_heights
assert bool(i93)==any(i93_north.stage_owned(r) for r in base_roads),'provenance must describe the I-93 stage; run build-i93-north.py'
if i93:
 i93_path=data_dir/i93_north.SOURCE_NAME;assert i93['source']['sha256']==hashlib.sha256(i93_path.read_bytes()).hexdigest(),'the I-93 source sidecar changed without regeneration'
 i93_counts=i93_north.validate(base_city,i93,i93_north.tunnel_joins(data_dir,city),base_elevation)
 assert i93_north.replay(data_dir,base_city,i93,json.loads(i93_path.read_text()),north_overpasses.tile_footprints(data_dir,city),base_grid),'I-93 roads, terrain cuts or survey cut differ from a replay of build-i93-north.py'
 pre_roads,pre_heights=i93_north.before_stage(base_roads,base_heights,i93,grid.get('scale',.01))
 print(f"Validated I-93: {i93_counts['carriageways']} carriageway pieces, {i93_counts['ramps']} ramps ({i93_counts['streetLandings']} street landings) and {i93_counts['traces']} survey traces match a replay of build-i93-north.py; at {i93_counts['twinStations']} stations with only a median between them the two carriageways share a height or are listed apart.")
def pre_elevation(x,z):return elevation(x,z,pre_heights)
if north_overpasses.applies(pre_roads):
 recorded=provenance.get('northOverpasses');assert recorded,'provenance must describe the northern overpass repairs; run level-north-overpasses.py'
 staged=i93_north.staged_heights(base_grid,i93) if i93 else None
 assert north_overpasses.replay(data_dir,{**city,'roads':pre_roads},recorded,staged),'northern overpass streets, decks or terrain differ from a replay of their recorded sources; run level-north-overpasses.py'
water_polygons,water_level=water_inputs(city);decks=level_water_crossings(pre_roads,water_polygons,pre_elevation,water_level,apply=False)
assert not decks['changedRoads'],f"{len(decks['changedRoads'])} water-crossing deck profiles need level-water-crossings.py: {', '.join(decks['changedRoads'][:6])}"
recorded=provenance.get('waterCrossingDecks');assert recorded and [c['roads'] for c in recorded['chains']]==[c['roads'] for c in decks['chains']] and all(abs(x-y)<.001 for a,b in zip(recorded['chains'],decks['chains']) for x,y in zip(a['deck'],b['deck'])),'provenance must describe the installed water-crossing decks'
land=level_land_approaches(pre_roads,pre_elevation,water_chain_ids(decks),apply=False,profile_excluded=levelled_water_ids(decks))
assert not land['changedRoads'],f"{len(land['changedRoads'])} land approaches need level-land-approaches.py: {', '.join(land['changedRoads'][:6])}"
recorded=provenance.get('landApproaches');assert recorded and {'seams','floored','links'}<=set(recorded),'provenance must describe the installed land approaches'
roads_map={r['id']:r for r in pre_roads};replay=copy.deepcopy(pre_roads);restore_sources(replay,recorded);replayed=level_land_approaches(replay,pre_elevation,water_chain_ids(decks),profile_excluded=levelled_water_ids(decks))
from reviewed_road_inputs import source_hash
assert recorded.get('reviewedSourceSHA256')==source_hash(),'reviewed road inputs changed without regeneration'
assert provenance.get('streetMeshes',{}).get('reviewedSourceSHA256')==source_hash(),'reviewed pavement inputs changed without surface regeneration'
for key in ('seams','floored','links','profiles','reviewed'):assert [{k:v for k,v in e.items() if k!='way'} for e in recorded.get(key,[])]==replayed[key],f"provenance {key} do not match a replay of the land approaches from their recorded sources"
replay_map={r['id']:r for r in replay}
for id in replayed['changedRoads']:assert replay_map[id]==roads_map[id],f"{id} differs from the replay of its recorded land-approach source"
for seam in recorded['seams']:
 road=roads_map[seam['road']];assert ('elevations' not in road) if seam['surface'] else (road.get('startLevel'),road.get('endLevel'))==(0,0),f"{seam['road']} is recorded as a levelled seam stub but still carries a lifted end"
assert [l['road'] for l in recorded['links']]==[l['road'] for l in TOWN_LINKS],'every declared town link must be installed'
for link in TOWN_LINKS:
 ramp=roads_map[link['road']];join=roads_map[link['join']];assert any(ramp['points'][i] in (join['points'][0],join['points'][-1]) for i in (0,-1)),f"{link['road']} does not reach {link['join']}"
for road in city['roads']:
 if not road.get('sourceSeam'):continue
 for end,id in zip((0,-1),road['sourceSeam']['roads']):
  parent=roads_map[id];indices=[i for i in (0,-1) if parent['points'][i]==road['points'][end]]
  assert indices,f"{road['id']} does not reach its source parent {id}"
  if road.get('elevations'):assert abs(road['elevations'][end]-parent['elevations'][indices[0]])<.0002,f"{road['id']} has a height step at {id}"
# A street both sources carried (connect-source-seams.py source_copies) has one record: none lies along the other source's line all along,
# and the records that left are again the copies when they are put back among the roads that stayed (before the highway stages).
from source_seams import source_copies
copy_record=provenance.get('sourceCopies');assert copy_record is not None and not copy_record['held'],'provenance must describe the streets both sources carried, none held back; run connect-source-seams.py'
_,doubled,held_back=source_copies(city['roads'])
assert not doubled and not held_back,f"{len(doubled)+len(held_back)} records lie along the other source's line of the same street ({', '.join([c['road']['id'] for c in doubled]+[h['road'] for h in held_back][:6])}); run connect-source-seams.py"
replayed=source_copies(pre_roads+[copy.deepcopy(c['road']) for c in copy_record['removed']])
assert not replayed[2] and [(c['road'],c['of']) for c in replayed[1]]==[(c['road'],c['of']) for c in copy_record['removed']],'the recorded source copies are not the copies of the roads that stayed; run connect-source-seams.py'
print(f"Validated {len(copy_record['removed'])} records taken out as a second source's copy of a street ({sum(c['road']['id'].startswith('osm-') for c in copy_record['removed'])} town, {sum(not c['road']['id'].startswith('osm-') for c in copy_record['removed'])} Boston): none left, and a replay takes the same ones.")
# Streets split at a town line (connect-source-seams.py town seams): each recorded join still meets the street it was carried to.
seam_joins=provenance.get('townSeams',{}).get('joins',[]);at_vertex=defaultdict(list)
assert {j['road'] for j in seam_joins}<={r['id'] for r in city['roads'] if r.get('townSeam')},'provenance must list the town seams; run connect-source-seams.py'
for r in city['roads']:
 for q in r['points']:at_vertex[(round(q[0],3),round(q[1],3))].append(r['id'])
for j in seam_joins:
 met=at_vertex[(round(j['point'][0],3),round(j['point'][1],3))]
 assert len(met)>=2 and j['road'] in met and j['to'] in met and (j['road']!=j['to'] or met.count(j['road'])>=2),f"town seam {j['road']} no longer meets {j['to']} at {j['point']}"
# Bridges split at a town line (town_bridge_joints): the two pieces still meet lifted and level with each other.
for joint in provenance.get('townSeams',{}).get('bridgeJoints',{}).get('joints',[]):
 pieces=[(r,i) for r in city['roads'] if r['id']==joint['road'] for i in (0,-1) if r['points'][i]==joint['point']]
 assert len(pieces)==2 and all(r.get('townSeam') and r.get('elevations') and r.get('startLevel' if i==0 else 'endLevel')==1 for r,i in pieces),f"bridge {joint['road']} is no longer joined at {joint['point']}"
 assert abs(pieces[0][0]['elevations'][pieces[0][1]]-pieces[1][0]['elevations'][pieces[1][1]])<.0002,f"bridge {joint['road']} has a height step at {joint['point']}"
# Bridges cut mid-span by the edge of the map (edge_bridge_stubs): the edge end lifted, no step at the joints back to the landing.
for bridge in provenance.get('townSeams',{}).get('edgeBridges',{}).get('bridges',[]):
 at=lambda p,id:[(r,i) for r in city['roads'] if r['id']==id and r.get('townSeam') and r.get('elevations') for i in (0,-1) if r['points'][i]==p]
 edge=at(bridge['edge'],bridge['roads'][0]);assert len(edge)==1 and edge[0][0].get('startLevel' if edge[0][1]==0 else 'endLevel')==1,f"edge bridge {bridge['roads'][0]} lost its lifted edge end"
 piece,end=edge[0]
 for nxt in bridge['roads'][1:]:
  q=piece['points'][-1 if end==0 else 0];lift=piece['elevations'][-1 if end==0 else 0];joined=at(q,nxt)
  assert len(joined)==1 and abs(joined[0][0]['elevations'][joined[0][1]]-lift)<.0002,f"edge bridge {bridge['roads'][0]} has a step at {nxt}"
  piece,end=joined[0]
# Restored water spans (connect-source-seams.py): recorded, joined end to end, lifted where they meet a deck.
spans=[r for r in city['roads'] if r.get('clippedSpan')];crossings=provenance.get('clippedWaterSpans',{}).get('crossings',[])
assert sorted(i for c in crossings for i in c['roads'])==sorted(r['id'] for r in spans),'provenance must list the restored water spans; run connect-source-seams.py'
ends_at=defaultdict(list)
for r in city['roads']:
 for i in (0,-1):ends_at[tuple(r['points'][i])].append((r,i))
for crossing in crossings:
 for terminal in crossing['terminals']:
  joined=[(r,i) for r,i in ends_at[tuple(terminal['point'])] if r['id']==terminal['road'] and not r.get('clippedSpan')]
  assert joined,f"water span {crossing['roads'][0]} does not reach {terminal['road']}"
  for r,i in joined:assert not r.get('elevations') or r.get('startLevel' if i==0 else 'endLevel')==1,f"{r['id']} meets water span {crossing['roads'][0]} without a lifted end"
for span in spans:
 assert span['bridge']['kind']=='restored-water-span' and len(span['elevations'])==len(span['points']),f"{span['id']} must be a restored deck piece"
 for i in (0,-1):
  others=[(r,j) for r,j in ends_at[tuple(span['points'][i])] if r is not span];assert others,f"{span['id']} ends in mid-air"
  for r,j in others:
   if r.get('elevations'):assert abs(r['elevations'][j]-span['elevations'][i])<.0002,f"{span['id']} has a height step at {r['id']}"
cells=defaultdict(list)
for r in city['roads']:
 assert len(r['points'])>=2 and r['oneway'] in (-1,0,1) and 3<=r['width']<=20,r['id']
 if r.get('elevations'):assert len(r['elevations'])==len(r['points']) and all(math.isfinite(v) for v in r['elevations']),'invalid deck profile'
 if r.get('deckWidths'):assert r.get('elevations') and len(r['deckWidths'])==len(r['points']) and all(math.isfinite(v) and 3<=v<=20 for v in r['deckWidths']),'invalid per-section deck width'
 if r.get('deckTangents'):assert set(r['deckTangents'])<={'start','end'} and all(len(v)==2 and all(math.isfinite(n) for n in v) and math.hypot(*v)>.001 for v in r['deckTangents'].values()),'invalid shared deck tangent'
 for x,z in r['points']:
  assert bounds['minX']-.01<=x<=bounds['maxX']+.01 and bounds['minZ']-.01<=z<=bounds['maxZ']+.01
  assert covered.covers(Point(x,z)),f"road escapes curated coverage: {r['name']} {r['id']}"
 for a,b in zip(r['points'],r['points'][1:]):
  for i in range(int(min(a[0],b[0])//250),int(max(a[0],b[0])//250)+1):
   for j in range(int(min(a[1],b[1])//250),int(max(a[1],b[1])//250)+1):cells[(i,j)].append((r,a,b))
assert any(r['name']=='Newbury Street' for r in city['roads']) and any(r['name']=='Massachusetts Avenue' for r in city['roads'])
# Boston centerlines drop every limited-access name; the OSM towns keep surface trunks such as Concord Turnpike (Route 2) but never motorways.
# Interstate 93 north of the tunnel and the Turnpike are their own stages (build-i93-north.py and build-boston-highways.py, validated above): their decks are the only interstate records.
assert not any(not i93_north.stage_owned(r) and not boston_highways.stage_owned(r) and (r['name'].startswith(('Interstate ','I-')) or 'Expressway' in r['name'] or 'Massachusetts Turnpike' in r['name'] or ('Turnpike' in r['name'] and not r['id'].startswith('osm-'))) for r in city['roads']),'highway or tunnel flattened into street network'
# Tunnels remain separately profiled instead of entering the terrain-grading
# street graph. Validate their shipped sidecar and retained source provenance.
if city.get('tunnels'):
 tunnels=json.loads((data_dir/city['tunnels']['file']).read_text());source=json.loads((data_dir/'central-artery-source.json').read_text())
 assert tunnels['provenance']['sourceSHA256']==hashlib.sha256(json.dumps(source,sort_keys=True).encode()).hexdigest(),'tunnel source fixture changed without regeneration'
 ids={r['id'] for r in tunnels['roads']};assert len(ids)==len(tunnels['roads'])==13
 assert not ids.intersection(r['id'] for r in city['roads']),'tunnel sidecar duplicates a surface road'
 assert len(tunnels['landmarks'])==3 and all(l['driveStart']['roadId'] in ids for l in tunnels['landmarks'])
 assert sum(bool(r['tunnel'].get('capStart'))+bool(r['tunnel'].get('capEnd')) for r in tunnels['roads'])==2,'both southern bore ends must close'
 for r in tunnels['roads']:
  assert len(r['points'])==len(r['elevations'])>=2 and r['oneway']==1 and 'traffic' not in r
  if r.get('deckEdgeElevations'):
   assert len(r['deckEdgeElevations'])==len(r['points']) and all(len(pair)==2 and all(math.isfinite(y) for y in pair) for pair in r['deckEdgeElevations']),f"invalid tunnel crossfall: {r['id']}"
  if r.get('deckWidths'):
   assert len(r['deckWidths'])==len(r['points']) and all(math.isfinite(w) and 3<=w<=20 for w in r['deckWidths']),f"invalid tunnel width profile: {r['id']}"
  assert 4<=r['tunnel']['clearance']<=7 and 3<=r['width']<=20
  assert all(math.isfinite(v) for p in r['points'] for v in p) and all(math.isfinite(y) for y in r['elevations'])
  assert all(covered.covers(Point(*p)) for p in r['points']),f"tunnel escapes coverage: {r['id']}"
  length=sum(math.dist(a,b) for a,b in zip(r['points'],r['points'][1:]))
  assert all(0<=a<b<=length+.01 for a,b in r['tunnel']['covered']),f"invalid tunnel roof interval: {r['id']}"
  assert all(abs(yb-ya)/max(.001,math.dist(a,b))<.131 for a,b,ya,yb in zip(r['points'],r['points'][1:],r['elevations'],r['elevations'][1:])),f"excessive tunnel grade: {r['id']}"
 print(f"Validated {len(ids)} underground roads and {len(tunnels['landmarks'])} tunnel entrances.")
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
assert {'hancock','trinity','library','brigham-circle','mission-hill','fenway-park','kenmore-square','state-house','downtown-crossing','chinatown-gate','boston-common','public-garden','huntington-mfa','bowker-overpass','harvard-square','harvard-yard','mit-great-dome','kendall-square','davis-square','union-square','prospect-hill','coolidge-corner','brookline-village','bunker-hill-monument','jfk-library','franklin-park-zoo','arnold-arboretum','castle-island','logan-airport','td-garden','faneuil-hall','old-north-church','custom-house','everett-square','medford-square','malden-center','oak-grove','melrose-ymca','ell-pond','melrose-highlands'}<=ids
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
# ---- static rail track (rail.json, build-rail-tracks.py): optional, checked against the package it was built on
rail_path=data_dir/'rail.json';rail=None
if rail_path.exists():
 from rail_tracks import package_digest
 rail=json.loads(rail_path.read_text());assert rail.get('version')==1 and rail['tracks'],'rail.json format'
 assert rail.get('inputs',{}).get('package')==package_digest(city,gzip.decompress((data_dir/grid['file']).read_bytes()),gzip.decompress((data_dir/grid['source']).read_bytes())),'rail.json was built on other streets or terrain; rerun build-rail-tracks.py'
 rail_ids={t['id'] for t in rail['tracks']};rail_burial=0
 for t in rail['tracks']:
  pts=np.asarray(t['points'],float);assert len(pts)>=2 and np.isfinite(pts).all(),f"{t['id']} track points"
  for key in ('bridges','covered','crossings'):assert all(0<=r['start']<r['end']<=t['length']+.01 for r in t[key]),f"{t['id']} {key} span outside the track"
  # Outside covered spans the bed may only let narrow terrain spikes poke through (rail_tracks NARROW, LIFT_CAP).
  for d,(x,z,y) in zip(np.linspace(0,t['length'],len(pts)),pts):
   if not any(c['start']-4<=d<=c['end']+4 for c in t['covered']):rail_burial=max(rail_burial,elevation(x,z)-y)
 assert rail_burial<3.5,f'rails run {rail_burial:.2f} m under the graded terrain outside a covered span'
 for c in rail['crossings']:
  street=[r for r in city['roads'] if r.get('name','')==c['name'] and not r.get('elevations') and min(distance_to_segment([c['x'],c['z']],a,b) for a,b in zip(r['points'],r['points'][1:]))<=r['width']/2+1]
  assert set(c['tracks'])<=rail_ids and street and abs(c['y']-elevation(c['x'],c['z']))<.5,f"level crossing off its street: {c['name']}"
 for b in rail['bumpers']:
  t=next(t for t in rail['tracks'] if t['id']==b['track']);assert min(math.dist([b['x'],b['z']],t['points'][k][:2]) for k in (0,-1))<.5,f"bumper off the end of {b['track']}"
tile_bytes=sum(p.stat().st_size for p in tile_dir.glob('*.bin'))
print(f"Validated {len(buildings)} buildings ({scaled} coarser-quantized complexes, {grounded} grounded primary meshes, {len(supported)} supported upper parts, {triangles} triangles) in {len(keys)} tiles ({tile_bytes/1e6:.1f} MB), {len(city['roads'])} roads, {curbs} curbs, {park_paths} park paths, {len(city['signals'])} signals, {len(city['landmarks'])} destinations.")
print(f"Far massing verified: {far_fragments} fragments for {massing_complexes} sprawling complexes match a build-far-massing.py rerun.")
if rail:print(f"Rail verified: {len(rail['tracks'])} tracks, {sum(len(t['bridges']) for t in rail['tracks'])} bridge spans and {len(rail['crossings'])} level crossings match the package streets and terrain (deepest uncovered bed {rail_burial:.2f} m under a terrain spike).")
print(f"Terrain verified: {w}x{h} at {cell} m, graded range {heights.min():.2f}..{heights.max():.2f} m, {changed} cells graded (max cut {grid['grading']['maxCut']} m, fill {grid['grading']['maxFill']} m). Spawn is {clearance:.2f} m from the nearest building.")
