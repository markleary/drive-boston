#!/usr/bin/env python3
"""Complete the two Chelsea Creek road bridges after road/terrain grading."""
import argparse,gzip,hashlib,json,pathlib
import numpy as np
from chelsea_connections import repair_chelsea,validate_chelsea,SPECS
from harvard_terrain import sample_grid
from road_tiles import refresh_road_tiles
from shapely.geometry import Polygon

ROOT=pathlib.Path(__file__).resolve().parents[1]


def main():
 parser=argparse.ArgumentParser();parser.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');parser.add_argument('--source-file',type=pathlib.Path,default=ROOT/'public/data/chelsea-bridges-source.json');args=parser.parse_args()
 city_path=args.data_dir/'city.json';city=json.loads(city_path.read_text());grid=city['elevation']
 heights=np.frombuffer(gzip.decompress((args.data_dir/grid['file']).read_bytes()),dtype='<i2')*grid.get('scale',.01)
 ground=lambda p:sample_grid(grid,heights,p)
 source=json.loads(args.source_file.read_text());old_roads=city['roads'];report=repair_chelsea(city,source,ground);validate_chelsea(city,ground)
 new_ids={r['id'] for r in city['roads']};removed_ids={r['id'] for r in old_roads if r['id'] not in new_ids}
 owned={s['id'] for s in SPECS};refresh_road_tiles(args.data_dir,city,[r for r in city['roads'] if r['id'] in owned],removed_ids)
 record={'name':source['source'],'url':source['url'],'license':source['license']}
 if not any(s['name']==record['name'] for s in city['sources']):city['sources'].append(record)
 city_path.write_text(json.dumps(city,separators=(',',':'))+'\n')
 path=args.data_dir/'provenance.json';provenance=json.loads(path.read_text());provenance['coveragePolygons']=len(city['coverage']);provenance['coverageAreaSquareMeters']=round(sum(Polygon(p).area for p in city['coverage']));provenance['tiles']['count']=len(city['tiles']['keys'])
 provenance['roads']['boston']['count']=sum(not r['id'].startswith(('osm-','chelsea-','tobin-','leverett-')) for r in city['roads'])
 provenance['roads']['towns']['count']=sum(r['id'].startswith('osm-') for r in city['roads'])
 provenance['roads']['chelseaCreek']={'source':source['source'],'count':len(report['roads'])}
 provenance['chelseaCreekConnections']={**report,'sourceSHA256':hashlib.sha256(args.source_file.read_bytes()).hexdigest(),'heightAccuracy':'Estimated game profile with a 4.8 m rise above the higher street landing; not surveyed clearance or movable bridge operation.'}
 path.write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 print('Prepared Chelsea Creek crossings:',', '.join(report['roads']))


if __name__=='__main__':main()
