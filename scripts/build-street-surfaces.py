#!/usr/bin/env python3
"""Measure curb-bounded roadway edges, install Boston sidewalk inventory
polygons and concrete curb islands into the DBT2 tiles of an installed metro
package, and regenerate the town curbs with filleted corners. Runs after
build-chelsea-places.py; needs data-source-cache/layer-0.json from
fetch-metro-sources.py. See scripts/street_surfaces.py.

  .venv-data/bin/python scripts/build-street-surfaces.py --data-dir public/data --source-dir data-source-cache
"""
import argparse,importlib.util,json,pathlib,sys,time
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import street_surfaces
spec=importlib.util.spec_from_file_location('metro',ROOT/'scripts/build-metro.py');metro=importlib.util.module_from_spec(spec);spec.loader.exec_module(metro)

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
 parser.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');parser.add_argument('--source-dir',type=pathlib.Path,default=ROOT/'data-source-cache');a=parser.parse_args()
 began=time.time();result=street_surfaces.install(a.data_dir,a.source_dir,metro.xy);print(json.dumps({**result,'minutes':round((time.time()-began)/60,1)},indent=1))
