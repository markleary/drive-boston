#!/usr/bin/env python3
"""Level the broken land approaches of an installed metro package.

Run right after level-water-crossings.py (whose chains are left alone here)
and before the dedicated bridge builders and build-street-surfaces.py, which
measures the roads this script turns into surface streets. Idempotent: a
second run restores the recorded source profiles and redoes the same
repairs, writing the same package and provenance. See land_approaches.py
for the method.
"""
import argparse,gzip,json,pathlib,sys
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from land_approaches import AT_GRADE,CONTINUATION,SINK,SNAP,TOWN_LINKS,level_land_approaches,restore_sources,water_chain_ids
from water_crossings import RAMP_RISE,TERRAIN_RISE,grid_sampler,level_water_crossings,water_inputs


def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');p.add_argument('--check',action='store_true',help='report without writing');a=p.parse_args()
 city=json.loads((a.data_dir/'city.json').read_text());grid=city['elevation'];provenance_path=a.data_dir/'provenance.json';provenance=json.loads(provenance_path.read_text())
 restore_sources(city['roads'],provenance.get('landApproaches',{}))
 heights=np.frombuffer(gzip.decompress((a.data_dir/grid['file']).read_bytes()),dtype='<i2')*grid.get('scale',.01);ground=grid_sampler(grid,heights)
 polygons,water_level=water_inputs(city);water=level_water_crossings(city['roads'],polygons,ground,water_level,apply=False)
 assert not water['changedRoads'],'run level-water-crossings.py first'
 report=level_land_approaches(city['roads'],ground,water_chain_ids(water),apply=True)
 for seam in report['seams']:print('seam',seam['road'],seam['name'],'lowered',seam['lowered'],'to',seam['nodeHeight'],'continuing',', '.join(seam['continues']),'surface street' if seam['surface'] else 'deck kept')
 for piece in report['floored']:print('floored',piece['road'],piece['name'],'raised by',piece['raised'])
 for link in report['links']:print('linked',link['road'],link['name'],'to',link['node'],'adding',link['added'],'points')
 print(f"{len(report['changedRoads'])} roads changed: {len(report['seams'])} seam stubs, {len(report['floored'])} pieces held over the terrain, {len(report['links'])} town ramps joined")
 if a.check:return
 (a.data_dir/'city.json').write_text(json.dumps(city,separators=(',',':'))+'\n')
 provenance['landApproaches']={'method':'A single elevated piece whose lifted end is a node where a terrain road ends and continues it, with nothing crossing beneath, meets the ground there and is re-profiled as a ramp held over the terrain, or becomes a surface street when that leaves it within the at-grade margin everywhere; an elevated piece sinking more than the sink margin into the terrain between its fixed ends is held over it point by point and the held profile pulled taut (its upper concave envelope); declared clipped town ramps get their source tail back and snap to the Boston segment end it reaches',
  'continuationCosine':CONTINUATION,'atGradeMeters':AT_GRADE,'sinkMeters':SINK,'rampAboveTerrainMeters':RAMP_RISE,'deckAboveTerrainMeters':TERRAIN_RISE,'snapMeters':SNAP,'heightAccuracy':'Estimated game profiles, not surveyed structures',
  'seams':report['seams'],'floored':report['floored'],'links':[{**link,'way':next(l['way'] for l in TOWN_LINKS if l['road']==link['road'])} for link in report['links']]}
 provenance_path.write_text(json.dumps(provenance,separators=(',',':'))+'\n')


if __name__=='__main__':main()
