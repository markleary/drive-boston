#!/usr/bin/env python3
"""Install PLACES destinations from build-metro.py into an installed metro package.

A full rebuild writes the same entries; this patches city.json in place so a new
destination (and the facade building record it needs in landmarkBuildings) lands
without regenerating tiles, far.bin or the elevation grids, which stay untouched.
Landmark entries keep PLACES order and building records keep tile order, as the
rebuild would write them."""
import argparse,gzip,importlib.util,json,pathlib,struct

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('metro',ROOT/'scripts/build-metro.py');metro=importlib.util.module_from_spec(spec);spec.loader.exec_module(metro)


def header(path):
 raw=gzip.decompress(path.read_bytes());length=struct.unpack_from('<I',raw,4)[0];return json.loads(raw[8:8+length])


def install(data_dir,identifiers):
 city_path=data_dir/'city.json';city=json.loads(city_path.read_text());keys=city['tiles']['keys']
 tiles={key:header(data_dir/'tiles'/f't_{key}.bin')['buildings'] for key in keys};buildings=[b for key in keys for b in tiles[key]]
 places=[p for p in metro.PLACES if p[0] in identifiers];missing=set(identifiers)-{p[0] for p in places};assert not missing,f'Not in PLACES: {sorted(missing)}'
 report={}
 for place in places:
  entry=metro.place_landmark(place,city['roads'],buildings,{});assert entry.get('driveStart'),f'No safe arrival for {place[0]}'
  landmarks=[l for l in city['landmarks'] if l['id']!=entry['id']];ids=[l['id'] for l in landmarks];order=[p[0] for p in metro.PLACES]
  predecessors=[ids.index(i) for i in order[:order.index(entry['id'])] if i in ids];at=max(predecessors)+1 if predecessors else len(ids)
  landmarks.insert(at,entry);city['landmarks']=landmarks;report[entry['id']]={'position':entry['position'],'driveStart':entry['driveStart'],'index':at}
  building_id=metro.PLACE_BUILDINGS.get(entry['id'])
  if building_id:
   key,rank=next((key,i) for key,items in tiles.items() for i,b in enumerate(items) if b['id']==building_id)
   record={k:v for k,v in next(b for b in tiles[key] if b['id']==building_id).items() if k in metro.LANDMARK_FIELDS}
   listed=[b for b in city['landmarkBuildings'] if b['id']!=building_id];ranks=[(i,[b['id'] for b in tiles[key]].index(b['id'])) for i,b in enumerate(listed) if any(t['id']==b['id'] for t in tiles[key])]
   later=[i for i,r in ranks if r>rank];at=min(later) if later else (max(i for i,_ in ranks)+1 if ranks else len(listed))
   listed.insert(at,record);city['landmarkBuildings']=listed;report[entry['id']]['buildingId']=building_id;report[entry['id']]['landmarkBuildingIndex']=at
 city_path.write_text(json.dumps(city,separators=(',',':'))+'\n')
 pp=data_dir/'provenance.json';provenance=json.loads(pp.read_text());provenance.setdefault('installedPlaces',{}).update(report);pp.write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 return report


if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');parser.add_argument('identifiers',nargs='+',help='PLACES ids to install');a=parser.parse_args()
 print(json.dumps(install(a.data_dir,a.identifiers),indent=1))
