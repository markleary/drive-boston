#!/usr/bin/env python3
"""Recompile source-boundary road links in an installed package before street surfaces."""
import argparse,gzip,importlib.util,json,pathlib
import numpy as np
from shapely.geometry import LineString
from source_seams import connect_source_seams
from road_tiles import refresh_road_tiles
from water_crossings import grid_sampler

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data-dir',type=pathlib.Path,default=pathlib.Path('public/data'));p.add_argument('--source-dir',type=pathlib.Path,default=pathlib.Path('data-source-cache'));a=p.parse_args()
 spec=importlib.util.spec_from_file_location('metro',pathlib.Path(__file__).with_name('build-metro.py'));metro=importlib.util.module_from_spec(spec);spec.loader.exec_module(metro)
 sources={}
 for path in sorted(a.source_dir.glob('osm-*-roads.json')):
  for e in json.loads(path.read_text())['elements']:
   points=[metro.xy(p['lon'],p['lat']) for p in e.get('geometry',[])]
   if len(points)>1:sources[str(e['id'])]=LineString(points)
 if not sources:raise SystemExit(f'No original OSM road geometry in {a.source_dir}; no package changes made.')
 path=a.data_dir/'city.json';city=json.loads(path.read_text());grid=city['elevation'];ground=grid_sampler(grid,np.frombuffer(gzip.decompress((a.data_dir/grid['file']).read_bytes()),dtype='<i2')*grid.get('scale',.01))
 removed=[r['id'] for r in city['roads'] if r.get('sourceSeam')];city['roads']=[r for r in city['roads'] if not r.get('sourceSeam')]
 links=connect_source_seams(city['roads'],sources,ground);refresh_road_tiles(a.data_dir,city,links,removed)
 path.write_text(json.dumps(city,separators=(',',':'))+'\n')
 print(json.dumps([{'id':r['id'],**r['sourceSeam']} for r in links],indent=2))

if __name__=='__main__':main()
