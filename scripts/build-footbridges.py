#!/usr/bin/env python3
"""Install the footbridges over the Massachusetts Turnpike and Storrow Drive whole,
with a deck over the road and ramps from the ground (see footbridges.py).

Run after build-boston-highways.py, whose roads the decks clear; nothing later
in the chain reads park paths, so it is the last step before validate-city.py.
Idempotent: a rerun replaces the bridges it wrote and writes the same tiles and
provenance (validate-city.py replays it).

  --extract   rebuild the source sidecar from the cached OpenStreetMap path
              extract (data-source-cache/osm-metro-paths.json)

The source sidecar is read from the checked-in package (--source-file) and
copied beside the data it was built into.
"""
import argparse,hashlib,json,pathlib,shutil,sys
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import footbridges as F


def main():
 p=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
 p.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');p.add_argument('--source-file',type=pathlib.Path,default=ROOT/'public/data'/F.SOURCE_NAME)
 p.add_argument('--extract',action='store_true');p.add_argument('--source-dir',type=pathlib.Path,default=ROOT/'data-source-cache');p.add_argument('--check',action='store_true',help='report without writing');a=p.parse_args()
 source_file=a.source_file
 if a.extract:
  fresh=F.extract(a.source_dir);source_file.write_text(json.dumps(fresh,separators=(',',':'))+'\n');print(f"{source_file}: {len(fresh['bridges'])} bridges, {sum(len(b['ways']) for b in fresh['bridges'])} OpenStreetMap ways")
 raw=source_file.read_bytes();source=json.loads(raw);provenance_path=a.data_dir/'provenance.json';provenance=json.loads(provenance_path.read_text())
 record,changed=F.install(a.data_dir,source,provenance.get('footbridges'),a.check)
 record={'source':{'file':F.SOURCE_NAME,'sha256':hashlib.sha256(raw).hexdigest(),'extract':source.get('extract'),'bridges':len(source['bridges']),'ways':sum(len(b['ways']) for b in source['bridges'])},**record}
 for b in record['bridges']:
  print(f"{b['id']} ({b['name'] or 'unnamed'}): {b['length']:.0f} m in {len(b['ways'])} ways, deck {b['deck']} m between landings at {b['landings']}, steepest {b['grade']*100:.1f}%")
  for c in b['crossings']:print(f"  over {c['road']} {c['name']}: {b['deck']-F.SLAB-c['surface']:.2f} m under the slab (asks {c['room']})")
 print(f"{len(record['replaced'])} clipped pieces replaced; {'would change' if a.check else 'changed'}: {', '.join(changed) or 'nothing'}")
 if a.check:return
 provenance['footbridges']=record;provenance_path.write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 target=a.data_dir/F.SOURCE_NAME
 if target.resolve()!=source_file.resolve():shutil.copyfile(source_file,target)


if __name__=='__main__':main()
