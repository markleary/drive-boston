"""Write the static Orange Line and Haverhill Line track file, rail.json, into a package.

Reads city.json (coverage, roads, water), the graded elevation grid and the raw
DEM it was graded from (elevation-source.bin) from --data-dir, and the
OpenStreetMap railway extract from --source-dir (osm-metro-railways.json, from
fetch-metro-sources.py). Run after the road and terrain stages, since the
profiles clear the streets and the graded terrain they find. Deterministic:
the same inputs write the same bytes, and rail.json records a digest of the
package inputs (rail_tracks.package_digest) that validate-city.py compares, so
a stale file fails validation without the extract. See rail_tracks.py for the method.
"""
import argparse,gzip,hashlib,json,pathlib,sys
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from rail_tracks import build_rail,package_digest


def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');p.add_argument('--source-dir',type=pathlib.Path,default=ROOT/'data-source-cache')
 p.add_argument('--output',type=pathlib.Path,help='write here instead of <data-dir>/rail.json')
 p.add_argument('--check',action='store_true',help='report whether rail.json is current without writing');p.add_argument('--report',action='store_true',help='print the per-track constraint report')
 a=p.parse_args()
 city=json.loads((a.data_dir/'city.json').read_text());grid=city['elevation']
 graded=gzip.decompress((a.data_dir/grid['file']).read_bytes());raw=gzip.decompress((a.data_dir/grid.get('source','elevation-source.bin')).read_bytes())
 extract=(a.source_dir/'osm-metro-railways.json').read_bytes()
 report={};doc=build_rail(city,*(np.frombuffer(b,dtype='<i2')*grid.get('scale',.01) for b in (graded,raw)),json.loads(extract),report)
 doc['inputs']={'package':package_digest(city,graded,raw),'railways':hashlib.sha256(extract).hexdigest()}
 text=json.dumps(doc,sort_keys=True,separators=(',',':'))+'\n';target=a.output or a.data_dir/'rail.json'
 if a.report:print(json.dumps(report,indent=1,sort_keys=True,default=str))
 points=sum(len(t['points']) for t in doc['tracks']);km=sum(r['length'] for r in report['tracks'].values())/1000
 print(f"{len(doc['tracks'])} tracks ({km:.1f} km, {points} points), {sum(len(t['bridges']) for t in doc['tracks'])} bridge spans, {len(doc['platforms'])} platforms, {len(doc['portals'])} portals, {len(doc['crossings'])} level crossings, {len(doc['bumpers'])} bumpers, {len(text)/1e3:.0f} kB")
 if a.check:
  current=target.exists() and target.read_text()==text;print('rail.json is current' if current else 'rail.json would change');sys.exit(0 if current else 1)
 target.write_text(text);print('wrote',target)


if __name__=='__main__':main()
