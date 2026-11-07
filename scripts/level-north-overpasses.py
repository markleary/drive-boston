#!/usr/bin/env python3
"""Repair the northern grade separations whose source decks close on the road beneath.

Run right after level-land-approaches.py, before the dedicated bridge builders
and build-street-surfaces.py, which measure and drape the streets this changes.
Idempotent: a rerun restores the recorded grid vertices, deck profiles and
streets and redoes the same repair, writing the same package and provenance.
See north_overpasses.py for the sites and the method.
"""
import argparse,json,pathlib,sys
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from north_overpasses import applies,level_north_overpasses,load_grid,restore,tile_footprints
from road_tiles import refresh_road_tiles
from tileformat import write_gzip

NOTE=' Northern underpasses cut and one valley crossing filled afterwards by level-north-overpasses.py.'


def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');p.add_argument('--check',action='store_true',help='report without writing');a=p.parse_args()
 city=json.loads((a.data_dir/'city.json').read_text());grid=city['elevation'];provenance_path=a.data_dir/'provenance.json';provenance=json.loads(provenance_path.read_text())
 if not applies(city['roads']):print('No northern overpass sites in this package');return
 heights=load_grid(a.data_dir/grid['file']);source=load_grid(a.data_dir/grid['source']);before={r['id'] for r in city['roads']}
 restore(city['roads'],heights,provenance.get('northOverpasses'))
 record,result,profiles,roads=level_north_overpasses(city['roads'],grid,heights,source,tile_footprints(a.data_dir,city))
 for site in record['sites']:
  extent=f"cut up to {site['maxCutMeters']} m" if site['mode']=='trench' else f"filled up to {site['maxFillMeters']} m"
  count=len(site.get('approachPieces',[]));pieces=f", {count} approach piece{'s' if count>1 else ''}" if count else ''
  print(f"{site['name']}: {site['mode']}, {extent}{pieces}, minimum clearance {site['minimumClearanceMeters']} m")
 print(f"{len(record['terrain']['vertices'])} grid vertices, {len(profiles)} deck profiles and {len(record['roads']['sources'])} streets changed")
 if a.check:return
 city['roads']=roads;by_id={r['id']:r for r in roads}
 for road_id,elevations in profiles.items():by_id[road_id]['elevations']=elevations
 touched=set(record['roads']['added'])|{r['id'] for r in record['roads']['sources']}
 refresh_road_tiles(a.data_dir,city,[r for r in roads if r['id'] in touched],before-set(by_id))
 write_gzip(a.data_dir/grid['file'],result.astype('<i2').tobytes())
 delta=result.astype(np.int32)-source.astype(np.int32);scale=grid.get('scale',.01);grading=grid['grading']
 grading.update(changedVertices=int(np.count_nonzero(delta)),maxCut=round(float(-delta.min()*scale),4),maxFill=round(float(delta.max()*scale),4))
 if NOTE not in grading['method']:grading['method']+=NOTE
 (a.data_dir/'city.json').write_text(json.dumps(city,separators=(',',':'))+'\n')
 provenance['roads']['towns']['count']=sum(r['id'].startswith('osm-') for r in roads)
 provenance['northOverpasses']=record;provenance_path.write_text(json.dumps(provenance,separators=(',',':'))+'\n')


if __name__=='__main__':main()
