#!/usr/bin/env python3
"""Apply verified building passages and road-overlap collision metadata.

Used by build-metro.py and, without redownloading the surveys, on existing DBT2
packages. Unknown overlaps are audited, never automatically carved or lifted.
"""
import argparse, gzip, json, pathlib, struct
import numpy as np
import tileformat
from building_clearance import RoadClearanceIndex
from building_collision_policy import KEY_BUILDING_IDS,exact_far_collision
from building_passages import PASSAGES,PASSAGE_VERSION,passage_digest,apply_building_passages,apply_passage_identity
from building_outline import rings,roof_outline


def _order_generated_fields(entry):
 # Recomputing metadata must neither reorder JSON on successive runs nor put
 # generated fields after tile dimensions only in the packaged-data path.
 fields=('collision','roadOverlaps','highwayOverlaps','buildingPassage','v','f','r','scale')
 values={key:entry.pop(key) for key in fields if key in entry}
 entry.update(values)


def independent_collision(entry):
 """Exact collision requested independently of the generated road cuts."""
 # The entrance stairs at the Melrose schools enter an open courtyard inside the convex hull.
 if entry['id']=='osm-way-135425346':return True
 prior=entry.get('buildingPassage') or {}
 return bool(entry.get('collision')=='mesh' and (entry.get('structure') or entry['id'] in KEY_BUILDING_IDS or
             prior.get('sourceCollision')=='mesh' or (not prior and 'roadOverlaps' not in entry and 'highwayOverlaps' not in entry)))


def prepare_buildings(buildings, geometry, roads):
 """Mutate metadata and aligned quantized records before writing a package."""
 independent={b['id'] for b in buildings if independent_collision(b)}
 summary=RoadClearanceIndex(roads).mark(buildings);corrected=[]
 for i,(entry,record) in enumerate(zip(buildings,geometry)):
  if entry['id'] not in PASSAGES:continue
  apply_passage_identity(entry)
  positions,facade,roof,scale=record
  vertices=positions.astype(np.float64)*scale+np.asarray(entry['anchor'])
  vertices,faces,metadata=apply_building_passages(entry,vertices,np.concatenate([facade,roof]))
  if metadata is None:continue
  if entry['id'] in independent:metadata['sourceCollision']='mesh'
  entry['buildingPassage']=metadata;entry['collision']='mesh'
  geometry[i]=tileformat.mesh_record(vertices,faces,entry['anchor'],entry['baseElevation'])
  if geometry[i] is None:raise ValueError(f"Passage removed building {entry['id']}")
  corrected.append(entry['id'])
 for entry in buildings:
  if entry.get('buildingPassage') or entry['id'] in independent:entry['collision']='mesh'
  _order_generated_fields(entry)
 return {**summary,'correctedPassages':corrected}


def highway_buildings(data_dir):
 """What build-boston-highways.py recorded for the buildings over its roads: ({building id: its record ids} for the
 buildings whose convex proxy would stand in a roadway, {building id: the passages to carve under it})."""
 path=data_dir/'provenance.json';over=(json.loads(path.read_text()).get('bostonHighways') or {}).get('buildings',{}) if path.exists() else {}
 passages={}
 for q in over.get('passages',[]):passages.setdefault(q['building'],[]).append({k:q[k] for k in ('road','start','end','left','right','ceiling','ceilingEnd')})
 return {m['id']:m['roads'] for m in over.get('mesh',[])},passages


def mark_highway_overlaps(buildings,mesh):
 """Exact collision for the buildings a highway record passes under or beside within their convex footprint (the
 highway decks and tunnel roads are not the surface streets RoadClearanceIndex looks at). A rerun drops the flag it set."""
 for b in buildings:
  if 'highwayOverlaps' in b:
   b.pop('highwayOverlaps')
   if b.get('collision')=='mesh' and 'roadOverlaps' not in b and not b.get('buildingPassage'):b.pop('collision')
  if b['id'] in mesh:b['collision']='mesh';b['highwayOverlaps']=mesh[b['id']]


def passage_sources(data_dir,city,generated,source_dir):
 """Preflight every changed or retired cut before writing any package files."""
 from building_sources import SurveyBuildingSources
 sources=None;restored={}
 for key in city['tiles']['keys']:
  header,_=tileformat.read_tile(data_dir/city['tiles']['directory']/f't_{key}.bin')
  for entry in header['buildings']:
   prior=entry.get('buildingPassage') or {}
   if not prior.get('highway'):continue
   expected=passage_digest(generated[entry['id']]) if entry['id'] in generated else None
   if prior.get('version')==PASSAGE_VERSION and prior.get('digest')==expected:continue
   if sources is None:sources=SurveyBuildingSources(source_dir)
   restored[entry['id']]=sources.restore(entry)
 return restored


def prepare_package(data_dir,source_dir=None):
 city_path=data_dir/'city.json';city=json.loads(city_path.read_text())
 index=RoadClearanceIndex(city['roads']);by_tile={};changed=[];marked=0;corrected=[];metadata_by_id={};mesh,generated=highway_buildings(data_dir)
 restored=passage_sources(data_dir,city,generated,source_dir or pathlib.Path(__file__).resolve().parents[1]/'data-source-cache')
 for key in city['tiles']['keys']:
  path=data_dir/city['tiles']['directory']/f't_{key}.bin';header,entries=tileformat.read_tile(path)
  before=json.dumps(header,separators=(',',':'));records=[];geometry_changed=False
  independent={b['id'] for b in header['buildings'] if independent_collision(b)}
  outlines={b['id']:b['buildingPassage']['outline'] for b in header['buildings'] if b['id'] in restored and (b.get('buildingPassage') or {}).get('outline')}
  for entry in header['buildings']:
   if entry['id'] in restored:
    entry.pop('buildingPassage',None)
    if entry.get('collision')=='mesh':entry.pop('collision')
  index.mark(header['buildings']);mark_highway_overlaps(header['buildings'],mesh)
  for entry,b in zip(header['buildings'],entries):
   apply_passage_identity(entry)
   scale=entry.get('scale',tileformat.SCALE)
   if entry['id'] in restored:
    positions,facade,roof,scale=restored[entry['id']]
    b={**b,'positions':positions.astype(float)*scale+np.asarray(entry['anchor']),'facade':facade,'roof':roof}
    geometry_changed=True
   metadata=None
   if entry['id'] in PASSAGES or entry['id'] in generated:
    kept=outlines.get(entry['id']) or (rings(roof_outline(b['positions'],b['roof'])) if entry['id'] in generated and not entry.get('buildingPassage') else None)
    vertices,faces,metadata=apply_building_passages(entry,b['positions'],np.concatenate([b['facade'],b['roof']]),generated.get(entry['id'],()),kept)
   if metadata is not None:
    if entry['id'] in independent:metadata['sourceCollision']='mesh'
    entry['buildingPassage']=metadata;entry['collision']='mesh';geometry_changed=True;corrected.append(entry['id'])
    record=tileformat.mesh_record(vertices,faces,entry['anchor'],entry['baseElevation'])
    if record is None:raise ValueError(f"Passage removed building {entry['id']}")
   else:record=(np.rint((b['positions']-np.asarray(entry['anchor']))/scale).astype(np.int16),b['facade'],b['roof'],scale)
   records.append(record)
   if entry.get('buildingPassage') or entry['id'] in independent:entry['collision']='mesh'
   _order_generated_fields(entry)
   if entry.get('collision')=='mesh':marked+=1
   metadata_by_id[entry['id']]=entry
  by_tile[key]=header['buildings']
  if geometry_changed or before!=json.dumps(header,separators=(',',':')):
   tileformat.write_tile(path,header,records);changed.append(key)
 # Preserve the existing far massing fragments and ordering; update only the
 # exact-mesh flag, shared by flight clearance and saved-position validation.
 far_path=data_dir/city['tiles']['far'];raw=bytearray(gzip.decompress(far_path.read_bytes()))
 length=struct.unpack_from('<I',raw,4)[0];far=json.loads(raw[8:8+length]);body=8+length;body+=(-body)%4;far_changed=False
 for tile in far['tiles']:
  offset=body+tile['offset'];ordinal=-1;exact=False
  for _ in range(tile['count']):
   points=struct.unpack_from('<H',raw,offset)[0];flags=raw[offset+6]
   if not flags&8:
    ordinal+=1;exact=exact_far_collision(by_tile[tile['key']][ordinal])
   desired=(flags&~2)|(2 if exact else 0)
   if desired!=flags:raw[offset+6]=desired;far_changed=True
   offset+=8+points*4
  assert ordinal+1==len(by_tile[tile['key']])
 if far_changed:tileformat.write_gzip(far_path,raw)
 city_changed=False
 for landmark in city['landmarkBuildings']:
  entry=metadata_by_id[landmark['id']]
  for field in ('collision','buildingPassage'):
   if field in entry and landmark.get(field)!=entry[field]:landmark[field]=entry[field];city_changed=True
   elif field not in entry and field in landmark:del landmark[field];city_changed=True
 if city_changed:city_path.write_text(json.dumps(city,separators=(',',':'))+'\n')
 return {'meshBuildings':marked,'correctedPassages':corrected,'restoredPassages':list(restored),'changedTiles':changed,'farChanged':far_changed}


if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--data-dir',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parents[1]/'public/data')
 parser.add_argument('--source-dir',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parents[1]/'data-source-cache',help='Retained offline survey archives for changed or removed passages')
 args=parser.parse_args();print(json.dumps(prepare_package(args.data_dir,args.source_dir),indent=2))
