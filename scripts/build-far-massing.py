#!/usr/bin/env python3
"""Write the far massing of sprawling complexes into far.bin (see far_massing.py).

build-metro.py hides the far entry of each sprawling complex; this step, run
after build-street-surfaces.py so the measured roadway widths are known, follows
each hidden entry with rectangular fragments cut from the complex's tile shell
around the streets. A rerun from the same package writes the same bytes, and
validate-city.py fails when a rerun would change them.

  .venv-data/bin/python scripts/build-far-massing.py --data-dir /tmp/boston-staging
"""
import argparse, gzip, json, pathlib
import tileformat
from far_massing import CELL, FLOOR, MIN_AREA, NARROW, BANDS, Corridors, rewrite, shell_massing


def build(data_dir):
 city=json.loads((data_dir/'city.json').read_text());tiles=city['tiles'];corridors=Corridors(city['roads']);shells={};counts=[]
 def buildings(key):
  if key not in shells:shells[key]=tileformat.read_tile(data_dir/tiles['directory']/f't_{key}.bin')[1]
  return shells[key]
 def massing(key,ordinal):
  parts=shell_massing(buildings(key)[ordinal],corridors)
  if parts:counts.append(len(parts))
  return parts
 # The northern-extension merge takes Fenway's original hulls from the archived
 # central package. Promote both here so their far boxes leave the field open.
 bowl_ids={'BOS-73AP7-T4BL0-O4QDM','BOS-2ZJZB-IWPEJ-JUBMC'}
 bowl_tiles={tileformat.tile_of(*b['center'],tiles['size']) for b in city['landmarkBuildings'] if b['id'] in bowl_ids}
 bowl_keys={f'{tx}_{tz}' for tx,tz in bowl_tiles}
 bowls={(key,n) for key in bowl_keys for n,b in enumerate(buildings(key)) if b['id'] in bowl_ids}
 far_path=data_dir/tiles['far'];before=far_path.read_bytes();raw=rewrite(gzip.decompress(before),massing,bowls)
 tileformat.write_gzip(far_path,raw)
 provenance_path=data_dir/'provenance.json';provenance=json.loads(provenance_path.read_text());provenance['farLodBytes']=len(raw)
 provenance['farMassing']={'method':'Each hidden sprawling complex (not a structure) is followed in far.bin by rectangular fragments: road corridors (pavedWidth or class width) are cut from its ground plan, parts narrower than twice the narrow margin dropped, and each wing\'s roof height field, sampled on a grid aligned with its dominant wall direction, is covered band by band with greedy largest rectangles',
  'cellMeters':CELL,'floorMeters':FLOOR,'minAreaSquareMeters':MIN_AREA,'narrowMeters':NARROW,'bands':list(BANDS),'complexes':len(counts),'fragments':sum(counts)}
 provenance_path.write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 return {'complexes':len(counts),'fragments':sum(counts),'farBytes':len(raw),'changed':far_path.read_bytes()!=before}


if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter);parser.add_argument('--data-dir',type=pathlib.Path,default=pathlib.Path('public/data'))
 print(json.dumps(build(parser.parse_args().data_dir)))
