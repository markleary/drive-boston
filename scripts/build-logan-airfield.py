#!/usr/bin/env python3
"""Write Logan International Airport's airfield (see logan_airfield.py): airfield.json, and an empty tile wherever
the airfield reaches a 1 km square the package has no tile for.

Run on the finished package, before validate-city.py: the stage reads the city's tile list and water outlines and
changes no road, grid cell or existing tile. Idempotent (validate-city.py replays it).

  --extract   rebuild the source sidecar from the cached Overpass response
              (data-source-cache/osm-logan-aeroways.json, fetched by fetch-metro-sources.py)

The source sidecar is read from the checked-in package (--source-file) and copied beside the data it was built into.
"""
import argparse,hashlib,json,pathlib,shutil,sys
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import logan_airfield as A


def main():
 p=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
 p.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');p.add_argument('--source-file',type=pathlib.Path,default=ROOT/'public/data'/A.SOURCE_NAME)
 p.add_argument('--extract',action='store_true');p.add_argument('--source-dir',type=pathlib.Path,default=ROOT/'data-source-cache');p.add_argument('--check',action='store_true',help='report without writing');a=p.parse_args()
 source_file=a.source_file
 if a.extract:
  fresh=A.extract(a.source_dir);source_file.write_text(json.dumps(fresh,separators=(',',':'))+'\n')
  print(f"{source_file}: {len(fresh['ways'])} ways, {len(fresh['relations'])} relations, {len(fresh['nodes'])} nodes, {len(fresh['buildings'])} building outlines")
 raw=source_file.read_bytes();source=json.loads(raw);record,changed=A.install(a.data_dir,source,a.check)
 record={'source':{'file':A.SOURCE_NAME,'sha256':hashlib.sha256(raw).hexdigest(),'extract':source.get('extract'),'license':source.get('source')},**record}
 print(f"{record['runways']} runways ({record['runwayMetres']} m), pavement m2 {record['area']}, {len(record['tiles'])} tiles ({', '.join(record['addedTiles']) or 'none'} added)")
 print(f"{record['taxiLines']} taxi lines, {record['standLines']} stand lines, {record['holds']} holding positions, aircraft {record['aircraft']}, {record['jetBridges']} jet bridges ({record['dockedBridges']} docked)")
 print(f"{'would change' if a.check else 'changed'}: {', '.join(changed) or 'nothing'}")
 if a.check:return
 path=a.data_dir/'provenance.json';provenance=json.loads(path.read_text());provenance['loganAirfield']=record
 if isinstance(provenance.get('tiles'),dict) and 'count' in provenance['tiles']:provenance['tiles']['count']=len(json.loads((a.data_dir/'city.json').read_text())['tiles']['keys'])
 path.write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 target=a.data_dir/A.SOURCE_NAME
 if target.resolve()!=source_file.resolve():shutil.copyfile(source_file,target)


if __name__=='__main__':main()
