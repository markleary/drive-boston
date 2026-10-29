#!/usr/bin/env python3
"""Merge generated Chelsea into a versioned, validated metro baseline.

Full regeneration currently exposes unrelated estimated overpasses documented
in DATA_SOURCES.md. This extension preserves the committed core roads, their
profiles and repairs, and its graded terrain. Only new Chelsea street corridors
receive newly graded heights, smoothly blended back to the immutable baseline.
Run after build-metro.py and grade-terrain.mjs, before the new bridge builders.
"""
import argparse,copy,gzip,hashlib,json,math,pathlib,struct
import numpy as np
from shapely.geometry import LineString,Point,Polygon
from shapely.ops import unary_union
from shapely import set_precision,union_all
from tileformat import write_gzip
from road_tiles import refresh_road_tiles

ROOT=pathlib.Path(__file__).resolve().parents[1]


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def unpack(path):
 raw=gzip.decompress(path.read_bytes());length=struct.unpack_from('<I',raw,4)[0]
 return json.loads(raw[8:8+length]),raw[(8+length+3)//4*4:]


def write_header(path,header,payload):
 encoded=json.dumps(header,separators=(',',':')).encode();raw=b'DBT2'+struct.pack('<I',len(encoded))+encoded
 write_gzip(path,raw+b'\0'*((-len(raw))%4)+payload)


def blend_extension(grid,baseline,generated,roads,inner=30,outer=90):
 """Blend only near new ground roads; exterior baseline cells are exact.

 The full street corridor plus 30 m uses the newly graded grid. A smoothstep
 fades its influence to zero over the next 60 m. Distances are to the pavement
 edge, so wide streets retain the same grading and transition allowance.
 """
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
   u=np.clip((outer-distance)/(outer-inner),0,1);influence=u*u*(3-2*u)
   window=weights[j0:j1+1,i0:i1+1];np.maximum(window,influence,out=window)
 weights=weights.reshape(-1)
 result=np.rint(baseline.astype(np.float64)+(generated.astype(np.float64)-baseline)*weights).astype('<i2')
 assert np.array_equal(result[weights==0],baseline[weights==0]),'Terrain escaped the extension mask'
 return result,weights


def merge(data_dir,base_dir,baseline_commit):
 city=json.loads((data_dir/'city.json').read_text());base=json.loads((base_dir/'city.json').read_text());provenance=json.loads((data_dir/'provenance.json').read_text());base_provenance=json.loads((base_dir/'provenance.json').read_text())
 if 'extensionMerge' in provenance:
  report=provenance['extensionMerge']
  assert report['baselineCommit']==baseline_commit and report['baselineCitySHA256']==sha(base_dir/'city.json') and report['baselineTerrainSHA256']==sha(base_dir/base['elevation']['file']),'Cannot re-merge against a different baseline; regenerate first'
  return report
 grid=city['elevation'];bg=base['elevation']
 for key in ['width','height','cellSize','originX','originZ','scale']:assert grid[key]==bg[key],f'Baseline terrain lattice differs: {key}'
 assert sha(data_dir/'elevation-source.bin')==sha(base_dir/'elevation-source.bin'),'Extension must use the same raw USGS grid as its baseline'
 chelsea=next(n for n in city['neighborhoods'] if n['name']=='Chelsea');area=unary_union([Polygon(r) for r in chelsea['rings']]).buffer(18)
 old_ids={r['id'] for r in base['roads']}
 new_roads=[r for r in city['roads'] if r['id'] not in old_ids and r['id'].startswith('osm-') and area.intersects(LineString(r['points']))]
 assert len(new_roads)>400,'Chelsea street extract is incomplete'
 city['roads']=copy.deepcopy(base['roads'])+new_roads;city['spawn']=copy.deepcopy(base['spawn'])
 old_places={p['id'] for p in base['landmarks']}
 city['landmarks']=copy.deepcopy(base['landmarks'])+[p for p in city['landmarks'] if p['id'] not in old_places and area.covers(Point(p['position']))]
 base_landmarks={b['id'] for b in base['landmarkBuildings']}
 city['landmarkBuildings']=copy.deepcopy(base['landmarkBuildings'])+[b for b in city['landmarkBuildings'] if b['id'] not in base_landmarks]
 city['neighborhoods']=copy.deepcopy(base['neighborhoods'])+[chelsea]
 coverage=union_all([set_precision(Polygon(r),.001) for r in base['coverage']]+[set_precision(area,.001)],grid_size=.001).normalize()
 parts=list(coverage.geoms) if coverage.geom_type=='MultiPolygon' else [coverage]
 city['coverage']=[[[round(x,3),round(z,3)] for x,z in p.exterior.coords[:-1]] for p in parts]
 # Existing park/path source IDs and the basin-specific water planes stay fixed.
 old_parks={p['id'] for p in base['parks']};city['parks']=copy.deepcopy(base['parks'])+[p for p in city['parks'] if p['id'] not in old_parks and area.intersects(Polygon(p['rings'][0],p['rings'][1:]))]
 old_water=unary_union([Polygon(p['rings'][0],p['rings'][1:]) for p in base['water']]);new_water=unary_union([Polygon(p['rings'][0],p['rings'][1:]) for p in city['water']]).difference(old_water).intersection(area)
 city['water']=copy.deepcopy(base['water']);water_parts=[new_water] if new_water.geom_type=='Polygon' else list(new_water.geoms) if hasattr(new_water,'geoms') else []
 for i,p in enumerate(water_parts):
  if p.geom_type=='Polygon' and p.area>15:city['water'].append({'id':f'chelsea-water-{i}','name':'Chelsea water','rings':[[[round(x,3),round(z,3)] for x,z in ring.coords[:-1]] for ring in [p.exterior,*p.interiors]]})
 base_signals={tuple(p) for p in base['signals']};city['signals']=copy.deepcopy(base['signals'])+[p for p in city['signals'] if tuple(p) not in base_signals and area.covers(Point(p))]
 source_names={s['name'] for s in city['sources']};city['sources'].extend(s for s in base['sources'] if s['name'] not in source_names)
 raw=np.frombuffer(gzip.decompress((data_dir/'elevation-source.bin').read_bytes()),dtype='<i2');old=np.frombuffer(gzip.decompress((base_dir/bg['file']).read_bytes()),dtype='<i2');fresh=np.frombuffer(gzip.decompress((data_dir/grid['file']).read_bytes()),dtype='<i2')
 merged,weights=blend_extension(grid,old,fresh,new_roads);write_gzip(data_dir/grid['file'],merged.tobytes())
 delta=merged.astype(np.int32)-raw.astype(np.int32);scale=grid['scale'];grid['grading']={'roads':sum(not r.get('elevations') for r in city['roads']),'changedVertices':int(np.count_nonzero(delta)),'maxCut':round(float(-delta.min()*scale),4),'maxFill':round(float(delta.max()*scale),4),'method':'Versioned metro terrain plus new Chelsea street grading; pavement edge +30 m full influence, smoothstep to unchanged baseline at +90 m.'}
 # Unchanged existing model records are a hard prerequisite. Mixed edge tiles
 # retain generated Chelsea buildings while preserving old curbs/path records.
 for key in set(city['tiles']['keys'])-set(base['tiles']['keys']):
  header,_=unpack(data_dir/'tiles'/f't_{key}.bin')
  assert all(b['district']=='Chelsea' for b in header['buildings']),f'Extension generated non-Chelsea buildings in new tile {key}; retain the pinned baseline source extracts'
 preserved=0;mixed=0
 for key in base['tiles']['keys']:
  filename=f't_{key}.bin';old_path=base_dir/'tiles'/filename;path=data_dir/'tiles'/filename
  before,_=unpack(old_path);after,payload=unpack(path);old_buildings={b['id']:b for b in before['buildings']};new_buildings={b['id']:b for b in after['buildings']}
  assert all(new_buildings.get(id)==b for id,b in old_buildings.items()),f'Existing building changed in tile {key}'
  new_building_ids=set(new_buildings)-set(old_buildings)
  assert all(new_buildings[id]['district']=='Chelsea' for id in new_building_ids),f'Extension generated new non-Chelsea buildings in baseline tile {key}; retain the pinned baseline source extracts'
  near=area.intersects(Polygon([(before['tx']*1000,before['tz']*1000),((before['tx']+1)*1000,before['tz']*1000),((before['tx']+1)*1000,(before['tz']+1)*1000),(before['tx']*1000,(before['tz']+1)*1000)]))
  if not near and not new_building_ids:path.write_bytes(old_path.read_bytes());preserved+=1;continue
  old_curbs={json.dumps(p,separators=(',',':')) for p in before['curbs']}
  after['curbs']=before['curbs']+[p for p in after['curbs'] if json.dumps(p,separators=(',',':')) not in old_curbs and area.covers(Point(p[len(p)//2]))]
  old_paths={p['id'] for p in before['parkPaths']};after['parkPaths']=before['parkPaths']+[p for p in after['parkPaths'] if p['id'] not in old_paths and area.intersects(LineString(p['points']))]
  after['roads']=before['roads'];write_header(path,after,payload);mixed+=1
 refresh_road_tiles(data_dir,city,new_roads)
 # Retain the baseline's documented core repairs; replace only generation
 # counts and the extension-specific source/coverage records.
 for key in ['restoredWaterCrossings','roadConnections','roadStructures','waterSurfaces']:
  if key in base_provenance:provenance[key]=copy.deepcopy(base_provenance[key])
 provenance['roads']=copy.deepcopy(base_provenance['roads']);provenance['roads']['towns']['count']+=len(new_roads)
 provenance['coverageAreaSquareMeters']=round(sum(Polygon(p).area for p in city['coverage']));provenance['coveragePolygons']=len(city['coverage']);provenance['tiles']['count']=len(city['tiles']['keys'])
 report={'baselineCommit':baseline_commit,'baselineCitySHA256':sha(base_dir/'city.json'),'baselineTerrainSHA256':sha(base_dir/bg['file']),'baselineProvenanceSHA256':sha(base_dir/'provenance.json'),
  'town':'Chelsea','newRoads':len(new_roads),'preservedCoreRoads':len(base['roads']),'preservedCoreTiles':preserved,'mixedBoundaryTiles':mixed,'terrainInfluencedVertices':int(np.count_nonzero(weights)),'terrainChangedFromBaseline':int(np.count_nonzero(merged!=old)),'terrainBlend':{'fullInfluenceBeyondPavementMeters':30,'zeroInfluenceBeyondPavementMeters':90,'shape':'smoothstep'},'outsideTerrainUnchanged':True}
 provenance['extensionMerge']=report
 (data_dir/'city.json').write_text(json.dumps(city,separators=(',',':'))+'\n');(data_dir/'provenance.json').write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 return report


def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data-dir',type=pathlib.Path,required=True);p.add_argument('--base-data',type=pathlib.Path,required=True);p.add_argument('--baseline-commit',required=True);a=p.parse_args();print(json.dumps(merge(a.data_dir,a.base_data,a.baseline_commit),indent=2))


if __name__=='__main__':main()
