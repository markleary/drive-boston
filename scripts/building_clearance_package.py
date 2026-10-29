#!/usr/bin/env python3
"""Apply verified building passages and road-overlap collision metadata.

Used by build-metro.py and, without redownloading the surveys, on existing DBT2
packages. Unknown overlaps are audited, never automatically carved or lifted.
"""
import argparse, gzip, json, pathlib, struct
import numpy as np
import tileformat
from building_clearance import RoadClearanceIndex
from building_collision_policy import exact_far_collision
from building_passages import PASSAGES,apply_building_passages


def _order_generated_fields(entry):
 # Recomputing metadata must neither reorder JSON on successive runs nor put
 # generated fields after tile dimensions only in the packaged-data path.
 fields=('collision','roadOverlaps','buildingPassage','v','f','r','scale')
 values={key:entry.pop(key) for key in fields if key in entry}
 entry.update(values)


def prepare_buildings(buildings, geometry, roads):
 """Mutate metadata and aligned quantized records before writing a package."""
 summary=RoadClearanceIndex(roads).mark(buildings);corrected=[]
 for i,(entry,record) in enumerate(zip(buildings,geometry)):
  if entry['id'] not in PASSAGES:continue
  positions,facade,roof,scale=record
  vertices=positions.astype(np.float64)*scale+np.asarray(entry['anchor'])
  vertices,faces,metadata=apply_building_passages(entry,vertices,np.concatenate([facade,roof]))
  if metadata is None:continue
  entry['buildingPassage']=metadata;entry['collision']='mesh'
  geometry[i]=tileformat.mesh_record(vertices,faces,entry['anchor'],entry['baseElevation'])
  if geometry[i] is None:raise ValueError(f"Passage removed building {entry['id']}")
  corrected.append(entry['id'])
 for entry in buildings:
  if entry.get('buildingPassage'):entry['collision']='mesh'
  _order_generated_fields(entry)
 return {**summary,'correctedPassages':corrected}


def prepare_package(data_dir):
 city_path=data_dir/'city.json';city=json.loads(city_path.read_text())
 index=RoadClearanceIndex(city['roads']);by_tile={};changed=[];marked=0;corrected=[];metadata_by_id={}
 for key in city['tiles']['keys']:
  path=data_dir/city['tiles']['directory']/f't_{key}.bin';header,entries=tileformat.read_tile(path)
  before=json.dumps(header,separators=(',',':'));index.mark(header['buildings']);records=[];geometry_changed=False
  for entry,b in zip(header['buildings'],entries):
   scale=entry.get('scale',tileformat.SCALE)
   metadata=None
   if entry['id'] in PASSAGES:vertices,faces,metadata=apply_building_passages(entry,b['positions'],np.concatenate([b['facade'],b['roof']]))
   if metadata is not None:
    entry['buildingPassage']=metadata;entry['collision']='mesh';geometry_changed=True;corrected.append(entry['id'])
    record=tileformat.mesh_record(vertices,faces,entry['anchor'],entry['baseElevation'])
    if record is None:raise ValueError(f"Passage removed building {entry['id']}")
   else:record=(np.rint((b['positions']-np.asarray(entry['anchor']))/scale).astype(np.int16),b['facade'],b['roof'],scale)
   records.append(record)
   if entry.get('buildingPassage'):entry['collision']='mesh'
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
 return {'meshBuildings':marked,'correctedPassages':corrected,'changedTiles':changed,'farChanged':far_changed}


if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--data-dir',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parents[1]/'public/data')
 args=parser.parse_args();print(json.dumps(prepare_package(args.data_dir),indent=2))
