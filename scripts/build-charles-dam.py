#!/usr/bin/env python3
"""Make Charles River Dam Road one graded street on the dam.

Run right after connect-source-seams.py and before level-water-crossings.py,
which then finds no water crossing here, and before build-street-surfaces.py,
which measures the streets this makes between their surveyed curbs.
Idempotent: a rerun restores the recorded roads and grid vertices and redoes
the same work, writing the same package and provenance. See charles_dam.py.
"""
import argparse,json,pathlib,sys
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from charles_dam import NOTE,applies,build,check,load_grid,restore
from road_tiles import refresh_road_tiles
from tileformat import write_gzip
from water_crossings import water_inputs


def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');p.add_argument('--check',action='store_true',help='report without writing');a=p.parse_args()
 city=json.loads((a.data_dir/'city.json').read_text());grid=city['elevation'];provenance_path=a.data_dir/'provenance.json';provenance=json.loads(provenance_path.read_text())
 if not applies(city['roads']):print('No Charles River Dam road in this package');return
 heights=load_grid(a.data_dir/grid['file']);restore(city['roads'],heights,provenance.get('charlesRiverDam'))
 record,result,roads=build(city['roads'],grid,heights,water_inputs(city)[0]);counts=check(roads,grid,result,record)
 print(f"Charles River Dam Road: {counts['pieces']} pieces over {counts['meters']} m are one surface street ({len(record['roads']['sources'])} records changed, {sum('elevations' in r for r in record['roads']['sources'])} of them decks); "
  f"crest {counts['crest'][0]} to {counts['crest'][1]} m, steepest {counts['steepest']*100:.1f}%, lock bridged at {len(record['profile']['openings'])} stations; "
  f"{counts['vertices']} grid vertices changed ({record['terrain']['streetVertices']} raised with a neighbouring street), cut up to {record['maxCutMeters']} m, filled up to {record['maxFillMeters']} m; "
  f"level within {counts['offLevel']} m at {counts['stations']} points across the crest")
 if a.check:return
 touched={r['id'] for r in record['roads']['sources']};city['roads']=roads
 refresh_road_tiles(a.data_dir,city,[r for r in roads if r['id'] in touched])
 write_gzip(a.data_dir/grid['file'],result.astype('<i2').tobytes())
 delta=result.astype(np.int32)-load_grid(a.data_dir/grid['source']).astype(np.int32);scale=grid.get('scale',.01);grading=grid['grading']
 grading.update(changedVertices=int(np.count_nonzero(delta)),maxCut=round(float(-delta.min()*scale),4),maxFill=round(float(delta.max()*scale),4))
 if NOTE not in grading['method']:grading['method']+=NOTE
 (a.data_dir/'city.json').write_text(json.dumps(city,separators=(',',':'))+'\n')
 provenance['charlesRiverDam']=record;provenance_path.write_text(json.dumps(provenance,separators=(',',':'))+'\n')


if __name__=='__main__':main()
