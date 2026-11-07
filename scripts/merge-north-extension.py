#!/usr/bin/env python3
"""Merge the generated northern towns (Everett, Medford, Malden, Melrose) into
the versioned metro package.

As merge-metro-extension.py did for Chelsea, the committed package is the
baseline: its roads, profiles, repairs, buildings, tiles and graded terrain are
kept, and only what the four towns add comes from the fresh build (build-metro.py
and grade-terrain.mjs on the extended sources, written to --data-dir, which this
script then overwrites with the merged package).

The terrain lattice grew north (fetch-terrain.py --anchor), so the fresh raw grid
must repeat the baseline raw grid byte for byte below its new northern rows. The
new rows take the fresh grading; baseline rows take it only near new streets
(pavement edge +30 m, smoothstep back to the baseline at +90 m) and in a 90 m
band below the old north edge, so the seam carries no step. Baseline town curbs
are removed (build-street-surfaces.py regenerates every town curb from one
union across the towns, so a street crossing a town line is not capped). Run
after grade-terrain.mjs, before connect-source-seams.py and the rest of the chain.
"""
import argparse,copy,gzip,hashlib,json,math,pathlib,shutil,struct
from collections import Counter,defaultdict
import numpy as np
from shapely.geometry import LineString,Point,Polygon,box
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely import set_precision,union_all
import tileformat
from tileformat import write_gzip
from road_tiles import refresh_road_tiles
from far_massing import read_far

NORTH=('Everett','Medford','Malden','Melrose')
GENERATED={'city.json','elevation.bin','elevation-source.bin','far.bin','provenance.json'}
SEAM=15  # rows (90 m) below the old north edge that fade from the fresh grading to the baseline


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def unpack(path):
 raw=gzip.decompress(path.read_bytes());length=struct.unpack_from('<I',raw,4)[0]
 return json.loads(raw[8:8+length]),raw[(8+length+3)//4*4:]


def write_header(path,header,payload):
 encoded=json.dumps(header,separators=(',',':')).encode();raw=b'DBT2'+struct.pack('<I',len(encoded))+encoded
 write_gzip(path,raw+b'\0'*((-len(raw))%4)+payload)


def records(header,payload):
 """Each building's stored int16 positions and facade/roof indices, ready for tileformat.write_tile."""
 kind='<u4' if header.get('indexBytes')==4 else '<u2';size=4 if kind=='<u4' else 2;offset=0;index=header.get('vertexCount',0)*6;index+=(-index)%4;out=[]
 for b in header['buildings']:
  q=np.frombuffer(payload,dtype='<i2',count=b['v']*3,offset=offset).reshape(-1,3);offset+=b['v']*6
  idx=np.frombuffer(payload,dtype=kind,count=b['f']+b['r'],offset=index).astype(np.uint32);index+=(b['f']+b['r'])*size
  out.append((q,idx[:b['f']],idx[b['f']:],b.get('scale',tileformat.SCALE)))
 return out


def polygon_list(geom):return [geom] if geom.geom_type=='Polygon' else [g for g in getattr(geom,'geoms',[]) if g.geom_type=='Polygon']


def midpoint(points):
 line=LineString(points);p=line.interpolate(line.length/2);return Point(p.x,p.y)


def per_town_curbs(roads,towns):
 """The town curbs build-street-surfaces.py wrote while each town had its own
 pavement union, reproduced for exact removal from the baseline tiles."""
 from street_surfaces import town_pavements,chunked,FILLET,LIP
 out=[]
 for area in towns.values():
  pavements=town_pavements(roads,area,LIP)
  if pavements:out+=chunked(unary_union(pavements).buffer(FILLET,join_style=1).buffer(-FILLET,join_style=1).boundary,.03)
 return out


def strip_town_curbs(headers,base,size):
 """Remove the baseline's town curbs (exact pieces, per tile, as street surfaces installed them from the baseline roads)."""
 from street_surfaces import tiles_touching,clip_line,tile_key
 roads=copy.deepcopy(base['roads'])
 for r in roads:
  if 'sourcePoints' in r:r['points']=r.pop('sourcePoints')
 surface=[r for r in roads if not r.get('elevations') and not r.get('tunnel')]
 towns={n['name']:unary_union([Polygon(ring) for ring in n['rings']]) for n in base['neighborhoods'] if n.get('town')}
 expected={}
 for curb in per_town_curbs(surface,towns):
  for tx,tz in tiles_touching(LineString(curb),size):
   key=tile_key(tx,tz)
   if key in headers:expected.setdefault(key,[]).extend(clip_line(curb,box(tx*size,tz*size,(tx+1)*size,(tz+1)*size)))
 removed=missing=0
 for key,parts in expected.items():
  want=Counter(json.dumps(c) for c in parts);tile=headers[key];kept=[]
  for c in tile['curbs']:
   k=json.dumps(c)
   if want[k]>0:want[k]-=1;removed+=1
   else:kept.append(c)
  missing+=sum(want.values());tile['curbs']=kept
 return removed,missing


def road_weights(grid,roads,inner=30,outer=90):
 """Influence of the new ground streets: 1 to 30 m beyond the pavement edge, smoothstep to 0 at 90 m (merge-metro-extension.py)."""
 height,width=grid['height'],grid['width'];cell=grid['cellSize'];weights=np.zeros((height,width),dtype=np.float32)
 for road in roads:
  if road.get('elevations'):continue
  half=road['width']/2;radius=half+outer
  for a,b in zip(road['points'],road['points'][1:]):
   i0=max(0,math.floor((min(a[0],b[0])-radius-grid['originX'])/cell));i1=min(width-1,math.ceil((max(a[0],b[0])+radius-grid['originX'])/cell))
   j0=max(0,math.floor((min(a[1],b[1])-radius-grid['originZ'])/cell));j1=min(height-1,math.ceil((max(a[1],b[1])+radius-grid['originZ'])/cell))
   if i1<i0 or j1<j0:continue
   xs,zs=np.meshgrid(grid['originX']+np.arange(i0,i1+1)*cell,grid['originZ']+np.arange(j0,j1+1)*cell)
   dx,dz=b[0]-a[0],b[1]-a[1];t=np.clip(((xs-a[0])*dx+(zs-a[1])*dz)/(dx*dx+dz*dz or 1),0,1)
   distance=np.hypot(xs-a[0]-dx*t,zs-a[1]-dz*t)-half
   u=np.clip((outer-distance)/(outer-inner),0,1);window=weights[j0:j1+1,i0:i1+1];np.maximum(window,u*u*(3-2*u),out=window)
 return weights


def old_envelope(base_provenance):
 """The baseline's geographic envelope in world metres (its hydro was clipped to it)."""
 import importlib.util
 spec=importlib.util.spec_from_file_location('city_compiler',pathlib.Path(__file__).resolve().parent/'build-city.py');central=importlib.util.module_from_spec(spec);spec.loader.exec_module(central)
 return central.geographic_polygon(base_provenance['bbox'])


def water_pools():
 import importlib.util
 spec=importlib.util.spec_from_file_location('water_surfaces',pathlib.Path(__file__).resolve().parent/'build-water-surfaces.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 return module.river_pools


def new_water(base,city,region,grid=None,heights=None):
 """Hydro the extended envelope adds: the fresh merged outlines minus the baseline
 water (slivers from the different simplification removed). A part touching the
 baseline's basin outline continues one of its surfaces, so it takes that
 surface's level along the seam instead of a separate DEM estimate."""
 old=unary_union([Polygon(w['rings'][0],w['rings'][1:]).buffer(0) for w in base['water']])
 fresh=unary_union([Polygon(w['rings'][0],w['rings'][1:]).buffer(0) for w in city['water']])
 added=fresh.difference(old.buffer(.5,join_style=2)).intersection(region).buffer(-1,join_style=2).buffer(1,join_style=2)
 surfaces=[(Polygon(s['rings'][0],s['rings'][1:]).buffer(0),s['level']) for w in base['water'] for s in w.get('surfaces',[])]
 out=[];parts=[added] if added.geom_type=='Polygon' else list(getattr(added,'geoms',[]))
 parts=sorted([p for p in parts if p.geom_type=='Polygon' and p.area>=50],key=lambda p:(round(p.bounds[0],1),round(p.bounds[1],1)))
 river_pools=water_pools() if heights is not None else None
 for i,part in enumerate(parts):
  part=set_precision(part.simplify(.3,preserve_topology=True),.001)
  if part.geom_type!='Polygon' or part.is_empty:continue
  names=[(part.intersection(Polygon(w['rings'][0],w['rings'][1:]).buffer(0)).area,w['name']) for w in city['water'] if w['name'] not in ('Water','water','Hydro','',None)]
  names=[n for n in names if n[0]>1]
  entry={'id':f'north-water-{i}','name':max(names)[1] if names else 'Water','rings':[[[round(x,3),round(z,3)] for x,z in ring.coords[:-1]] for ring in [part.exterior,*part.interiors]]}
  touching=[(part.buffer(2).intersection(s).area,level) for s,level in surfaces if part.distance(s)<1.5]
  if touching:
   seam=max(touching)[1];pools=river_pools(part,grid,heights) if river_pools and part.area>=20000 else [(part,seam)]
   # Pools at their own DEM levels (Upper Mystic Lake stands above its dam); a pool on the seam continues the baseline surface.
   levels=defaultdict(list)
   for pool,level in pools:levels[seam if any(pool.distance(s)<1.5 for s,_ in surfaces) else level].append(pool)
   entry['surfaces']=[]
   for level in sorted(levels):
    for piece in polygon_list(set_precision(unary_union(levels[level]),.001)):
     if piece.area>.01:entry['surfaces'].append({'name':entry['name'],'level':level,'rings':[[[round(x,3),round(z,3)] for x,z in ring.coords[:-1]] for ring in [piece.exterior,*piece.interiors]]})
  out.append(entry)
 return out


def merge(data_dir,base_dir,baseline_commit,log=print):
 city=json.loads((data_dir/'city.json').read_text());provenance=json.loads((data_dir/'provenance.json').read_text())
 if 'northExtensionMerge' in provenance:
  report=provenance['northExtensionMerge']
  assert report['baselineCommit']==baseline_commit and report['baselineCitySHA256']==sha(base_dir/'city.json'),'Cannot re-merge against a different baseline; regenerate first'
  return report
 base=json.loads((base_dir/'city.json').read_text());base_provenance=json.loads((base_dir/'provenance.json').read_text())
 merged=copy.deepcopy(base);merged_provenance=copy.deepcopy(base_provenance)
 grid=city['elevation'];bg=base['elevation']
 for key in ['width','cellSize','originX','scale']:assert grid[key]==bg[key],f'Baseline terrain lattice differs: {key}'
 north_rows=round((bg['originZ']-grid['originZ'])/grid['cellSize'])
 assert north_rows>0 and grid['originZ']+north_rows*grid['cellSize']==bg['originZ'] and grid['height']==bg['height']+north_rows,'Fresh terrain must extend the baseline lattice north only'
 raw=np.frombuffer(gzip.decompress((data_dir/'elevation-source.bin').read_bytes()),dtype='<i2').reshape(grid['height'],grid['width'])
 base_raw=np.frombuffer(gzip.decompress((base_dir/'elevation-source.bin').read_bytes()),dtype='<i2').reshape(bg['height'],bg['width'])
 assert np.array_equal(raw[north_rows:],base_raw),'The fresh raw USGS grid must repeat the baseline rows exactly'
 towns={n['name']:n for n in city['neighborhoods']};assert all(t in towns for t in NORTH),'Fresh build lacks the northern towns'
 north=unary_union([Polygon(ring) for t in NORTH for ring in towns[t]['rings']]).buffer(0);north18=north.buffer(18,join_style=2);inside=prep(north18)
 # ---- roads: the fresh pieces inside the towns (and their 18 m margin)
 by_id=defaultdict(list)
 for i,r in enumerate(merged['roads']):by_id[r['id']].append(i)
 def same(i,line):
  b=merged['roads'][i];return any(LineString(p).hausdorff_distance(line)<2 for p in [b['points'],b.get('sourcePoints') or b['points']])
 new_roads=[];replaced=set();skipped=0
 for r in city['roads']:
  line=LineString(r['points'])
  if not north18.intersects(line):continue
  if any(same(i,line) for i in by_id.get(r['id'],[])):continue
  longer=[i for i in by_id.get(r['id'],[]) if line.buffer(1.5).contains(LineString(merged['roads'][i]['points'])) and LineString(merged['roads'][i]['points']).length<line.length-1]
  if longer:replaced.update(longer);new_roads.append(r);continue
  if inside.contains(midpoint(r['points'])):new_roads.append(r)
  else:skipped+=1
 replaced_roads=[merged['roads'][i] for i in sorted(replaced)]
 merged['roads']=[r for i,r in enumerate(merged['roads']) if i not in replaced]+copy.deepcopy(new_roads)
 assert len(new_roads)>3000,'Northern street extract is incomplete'
 log('New roads',len(new_roads),'baseline roads extended',len(replaced),[r['id'] for r in replaced_roads],'unmatched fresh roads outside the towns',skipped,flush=True)
 # ---- districts, coverage, places, parks, water, signals, sources
 merged['neighborhoods']=copy.deepcopy(base['neighborhoods'])+[copy.deepcopy(towns[t]) for t in NORTH]
 coverage=union_all([set_precision(Polygon(r),.001) for r in base['coverage']]+[set_precision(north18.simplify(.5,preserve_topology=True),.001)],grid_size=.001).normalize()
 parts=list(coverage.geoms) if coverage.geom_type=='MultiPolygon' else [coverage]
 merged['coverage']=[[[round(x,3),round(z,3)] for x,z in p.exterior.coords[:-1]] for p in parts];merged['bounds']=copy.deepcopy(city['bounds'])
 places={p['id'] for p in base['landmarks']};merged['landmarks']+=[p for p in city['landmarks'] if p['id'] not in places and inside.contains(Point(p['position']))]
 park_key=lambda p:(p['id'],tuple(p['rings'][0][0]))
 old_parks={park_key(p) for p in base['parks']};new_parks=[p for p in city['parks'] if park_key(p) not in old_parks and north18.intersects(Polygon(p['rings'][0],p['rings'][1:]).buffer(0))];merged['parks']+=new_parks
 outside=box(*north18.union(old_envelope(base_provenance)).buffer(5000).bounds).difference(old_envelope(base_provenance))
 fresh_heights=np.frombuffer(gzip.decompress((data_dir/'elevation.bin').read_bytes()),dtype='<i2').reshape(grid['height'],grid['width'])*grid['scale']
 water=new_water(base,city,north18.union(outside),grid,fresh_heights);merged['water']+=water
 for w in sorted(water,key=lambda w:-Polygon(w['rings'][0]).area)[:12]:log(' water',w['id'],w['name'],round(Polygon(w['rings'][0],w['rings'][1:]).area),[round(v) for v in Polygon(w['rings'][0]).bounds],[s['level'] for s in w.get('surfaces',[])],flush=True)
 old_signals={tuple(p) for p in base['signals']};new_signals=[p for p in city['signals'] if tuple(p) not in old_signals and north.covers(Point(p))];merged['signals']+=new_signals
 fresh_sources={s['name']:s for s in city['sources']};old_osm='OpenStreetMap streets, buildings, parks, water and paths for Cambridge, Somerville, Brookline and Chelsea'
 osm=next(s for s in city['sources'] if s['name'].startswith('OpenStreetMap streets') and 'Melrose' in s['name'])
 merged['sources']=[copy.deepcopy(osm) if s['name']==old_osm else s for s in merged['sources']]
 known={s['name'] for s in merged['sources']};merged['sources']+=[s for name,s in fresh_sources.items() if name not in known]
 log('Parks',len(new_parks),'water parts',len(water),'with basin surfaces',sum('surfaces' in w for w in water),'signals',len(new_signals),flush=True)
 # ---- terrain
 graded=np.frombuffer(gzip.decompress((data_dir/'elevation.bin').read_bytes()),dtype='<i2').reshape(grid['height'],grid['width'])
 base_graded=np.frombuffer(gzip.decompress((base_dir/bg['file']).read_bytes()),dtype='<i2').reshape(bg['height'],bg['width'])
 baseline=graded.astype(np.float64).copy();baseline[north_rows:]=base_graded
 weights=road_weights(grid,[r for r in new_roads])
 rows=np.arange(grid['height'])[:,None];u=np.clip((north_rows+SEAM-rows)/SEAM,0,1);weights=np.maximum(weights,(u*u*(3-2*u)).astype(np.float32))
 result=np.rint(baseline+(graded.astype(np.float64)-baseline)*weights).astype('<i2')
 untouched=weights[north_rows:]==0;assert np.array_equal(result[north_rows:][untouched],base_graded[untouched]),'Terrain escaped the extension mask'
 write_gzip(data_dir/grid['file'],result.tobytes())
 delta=result.astype(np.int32)-raw.astype(np.int32);scale=grid['scale']
 merged['elevation']={**copy.deepcopy(grid),'grading':{'roads':sum(not r.get('elevations') for r in merged['roads']),'changedVertices':int(np.count_nonzero(delta)),'maxCut':round(float(-delta.min()*scale),4),'maxFill':round(float(delta.max()*scale),4),
  'method':'Versioned metro terrain extended north: new rows and new northern street corridors (pavement edge +30 m full influence, smoothstep to the unchanged baseline at +90 m) take the fresh grading, faded over 90 m below the old north edge.'}}
 changed_old=int(np.count_nonzero(result[north_rows:]!=base_graded))
 log('Terrain: new rows',north_rows,'baseline cells regraded',changed_old,flush=True)
 # ---- tiles and far city
 size=base['tiles']['size'];tile_dir=data_dir/'tiles';base_tiles=base_dir/'tiles'
 base_headers={};base_payloads={}
 for key in base['tiles']['keys']:base_headers[key],base_payloads[key]=unpack(base_tiles/f't_{key}.bin')
 fresh_headers={};fresh_payloads={}
 for key in city['tiles']['keys']:fresh_headers[key],fresh_payloads[key]=unpack(tile_dir/f't_{key}.bin')
 from reviewed_road_inputs import restore_street_sources
 restore_street_sources(base_headers)
 removed,missing=strip_town_curbs(base_headers,base,size);assert missing==0,f'{missing} baseline town curb pieces not found; the baseline was not installed by build-street-surfaces.py'
 log('Baseline town curb pieces removed',removed,flush=True)
 base_ids={b['id'] for h in base_headers.values() for b in h['buildings']}
 _,base_far=read_far(gzip.decompress((base_dir/base['tiles']['far']).read_bytes()));_,fresh_far=read_far(gzip.decompress((data_dir/city['tiles']['far']).read_bytes()))
 for old in tile_dir.glob('*.bin'):old.unlink()
 far={};added=Counter();already=0;foreign=0;policies=Counter();keys=[]
 for key in sorted(set(base_headers)|set(fresh_headers),key=lambda k:tuple(map(int,k.split('_')))):
  fresh=fresh_headers.get(key);picks=[]
  if fresh:
   assert len(fresh_far.get(key,[]))==len(fresh['buildings']),f'{key}: fresh far records do not follow the tile buildings'
   for i,b in enumerate(fresh['buildings']):
    if b['id'] in base_ids:already+=b['district'] in NORTH;continue
    if b['district'] in NORTH:picks.append(i)
    else:foreign+=1
  header=base_headers.get(key);tx,tz=map(int,key.split('_'))
  if header is None:header={'tx':tx,'tz':tz,'size':size,'buildings':[],'curbs':[],'parkPaths':[],'roads':[]};geometry=[]
  else:geometry=records(header,base_payloads[key])
  old_paths={p['id'] for p in header['parkPaths']}
  paths=[p for p in (fresh or {}).get('parkPaths',[]) if p['id'] not in old_paths and north18.intersects(LineString(p['points']))]
  if fresh and picks:
   fresh_records=records(fresh,fresh_payloads[key])
   header['buildings']=header['buildings']+[fresh['buildings'][i] for i in picks];geometry=geometry+[fresh_records[i] for i in picks]
   for i in picks:added[fresh['buildings'][i]['district']]+=1;policies[fresh['buildings'][i]['norm']['policy']]+=1
  header['parkPaths']=header['parkPaths']+paths
  if not header['buildings'] and not header['parkPaths'] and not header['curbs'] and not header['roads']:continue
  if key in base_headers and not picks:write_header(tile_dir/f't_{key}.bin',header,base_payloads[key])
  else:tileformat.write_tile(tile_dir/f't_{key}.bin',header,geometry)
  keys.append(key)
  entries=list(base_far.get(key,[]))+[fresh_far[key][i] for i in picks]
  if entries:far[key]=entries
 log('Buildings added',dict(added),'northern buildings already in the baseline',already,'fresh non-northern buildings not in the baseline',foreign,flush=True)
 body=bytearray();directory=[]
 for key in sorted(far,key=lambda k:tuple(map(int,k.split('_')))):
  directory.append({'key':key,'offset':len(body),'count':len(far[key])})
  for record in far[key]:body+=record
 head=json.dumps({'size':size,'tiles':directory},separators=(',',':')).encode();raw_far=b'DBF2'+struct.pack('<I',len(head))+head;raw_far+=b'\0'*((-len(raw_far))%4)+bytes(body)
 write_gzip(data_dir/merged['tiles']['far'],raw_far)
 merged['tiles']['keys']=keys;merged['tiles']['buildingCount']=base['tiles']['buildingCount']+sum(added.values())
 # Road ownership: the new pieces, the baseline roads they extend, and any baseline road sharing an id with them.
 ids={r['id'] for r in new_roads};sharing=[r for r in merged['roads'] if r['id'] in ids]
 refresh_road_tiles(data_dir,merged,sharing,removed_ids=[r['id'] for r in replaced_roads])
 landmark_ids={b['id'] for b in base['landmarkBuildings']};new_ids={b['id'] for h in fresh_headers.values() for b in h['buildings'] if b['district'] in NORTH and b['id'] not in base_ids}
 merged['landmarkBuildings']+=[b for b in city['landmarkBuildings'] if b['id'] in new_ids and b['id'] not in landmark_ids]
 # ---- sidecars and provenance
 for path in sorted(base_dir.iterdir()):
  if path.is_file() and path.name not in GENERATED:shutil.copyfile(path,data_dir/path.name)
 p=merged_provenance;fresh_p=provenance
 for key in ['bbox','districts','terrain','townSourceExtracts']:p[key]=copy.deepcopy(fresh_p[key])
 p['packagingDate']='2026-11-06';p['generatedFrom']='Boston and Cambridge public OBJ/GIS sources, OpenStreetMap for Somerville, Brookline, Chelsea, Everett, Medford, Malden and Melrose, MassGIS assessor parcels for the northern house forms, USGS 3DEP bare-earth DEM'
 p['coverageAreaSquareMeters']=round(sum(Polygon(c).area for c in merged['coverage']));p['coveragePolygons']=len(merged['coverage']);p['tiles']['count']=len(merged['tiles']['keys']);p['farLodBytes']=len(raw_far)
 p['buildingSources']={k:p['buildingSources'].get(k,0)+policies.get(k,0) for k in sorted(set(p['buildingSources'])|set(policies))}
 p['roads']['towns']['count']+=sum(r['id'].startswith('osm-') for r in new_roads)-sum(r['id'].startswith('osm-') for r in replaced_roads)
 report={'baselineCommit':baseline_commit,'baselineCitySHA256':sha(base_dir/'city.json'),'baselineTerrainSHA256':sha(base_dir/bg['file']),'baselineProvenanceSHA256':sha(base_dir/'provenance.json'),
  'towns':list(NORTH),'newRoads':len(new_roads),'extendedBaselineRoads':[r['id'] for r in replaced_roads],'preservedRoads':len(base['roads'])-len(replaced_roads),'buildingsAdded':dict(added),'buildingPolicies':dict(policies),
  'newParks':len(new_parks),'newWaterParts':len(water),'newSignals':len(new_signals),'baselineTownCurbPiecesRemoved':removed,'terrain':{'newRows':north_rows,'baselineCellsRegraded':changed_old,'seamFadeMeters':SEAM*grid['cellSize'],'fullInfluenceBeyondPavementMeters':30,'zeroInfluenceBeyondPavementMeters':90}}
 p['northExtensionMerge']=report
 (data_dir/'city.json').write_text(json.dumps(merged,separators=(',',':'))+'\n');(data_dir/'provenance.json').write_text(json.dumps(p,separators=(',',':'))+'\n')
 return report


def main():
 a=argparse.ArgumentParser(description=__doc__);a.add_argument('--data-dir',type=pathlib.Path,required=True);a.add_argument('--base-data',type=pathlib.Path,required=True);a.add_argument('--baseline-commit',required=True);args=a.parse_args()
 print(json.dumps(merge(args.data_dir,args.base_data,args.baseline_commit),indent=1))


if __name__=='__main__':main()
