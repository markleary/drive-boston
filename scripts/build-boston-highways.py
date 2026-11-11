#!/usr/bin/env python3
"""Add the Massachusetts Turnpike (Interstate 90) from the Newton line to Route 1A
in East Boston, Storrow Drive between the Boston University Bridge and David G.
Mugar Way, and the ramps joining the Turnpike to the Central Artery tunnel.

Run after build-i93-north.py, before building_clearance_package.py and
build-street-surfaces.py, which measure and drape the streets this changes.
Idempotent: a rerun drops the roads it added, restores the recorded grid
vertices and streets and redoes the same build, writing the same package,
sidecar and provenance (validate-city.py replays it). See boston_highways.py
for the method.

  --extract   rebuild the source sidecar from the cached Boston GIS layer 8
              (data-source-cache/layer-8.json) and the cached Brookline and
              Cambridge OpenStreetMap extracts
"""
import argparse,hashlib,json,pathlib,shutil,sys
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import boston_highways as H
from north_overpasses import load_grid
from road_tiles import refresh_road_tiles
from tileformat import write_gzip

NOTE=' Graded fill under the streets crossing the Massachusetts Turnpike cut removed afterwards by build-boston-highways.py.'


def main():
 p=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
 p.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');p.add_argument('--source-file',type=pathlib.Path)
 p.add_argument('--extract',action='store_true');p.add_argument('--source-dir',type=pathlib.Path,default=ROOT/'data-source-cache');p.add_argument('--check',action='store_true',help='report without writing');a=p.parse_args()
 source_file=a.source_file or a.data_dir/H.SOURCE_NAME
 if a.extract:
  fresh=H.extract(a.source_dir);source_file.write_text(json.dumps(fresh,separators=(',',':'))+'\n');print(f"{source_file}: {len(fresh['features'])} layer 8 segments, {len(fresh['ways'])} OpenStreetMap ways")
 raw=source_file.read_bytes();source=json.loads(raw)
 city=json.loads((a.data_dir/'city.json').read_text());grid=city['elevation'];provenance_path=a.data_dir/'provenance.json';provenance=json.loads(provenance_path.read_text())
 heights=load_grid(a.data_dir/grid['file']);ungraded=load_grid(a.data_dir/grid['source']);before={r['id'] for r in city['roads']}
 H.restore(city['roads'],heights,provenance.get('bostonHighways'))
 tunnels=H.central_artery(a.data_dir,city)
 previous=(provenance.get('bostonHighways') or {}).get('buildings',{}).get('removed',[])
 record,roads,tunnel_records,result,plans=H.install(city,source,heights,ungraded,H.tile_buildings(a.data_dir,city),tunnels,removed=previous)
 record={'source':{'file':H.SOURCE_NAME,'sha256':hashlib.sha256(raw).hexdigest(),'features':len(source['features']),'ways':len(source['ways'])},**record}
 for name,c in record['routes'].items():
  if c['lengthMeters']>1500:print(f"{name}: {c['lengthMeters']:.0f} m in {c['records']} records, {c['tunnelMeters']:.0f} m below ground ({c['coveredMeters']:.0f} m covered), {min(c['lanes'])} to {max(c['lanes'])} lanes")
 print(f"{len(record['routes'])} routes: {record['deckMeters']:.0f} m of deck in {len(record['roads']['added'])} records, {record['tunnelMeters']:.0f} m of tunnel in {len(record['roads']['tunnels'])} records")
 print(f"{len(record['crossings'])} crossings with existing roads, {len(record['newCrossings'])} between new roads; closed ends {', '.join(c['road']+' '+c['end'] for c in record['closed'])}")
 print(f"{len(record['terrain']['vertices'])} grid vertices changed (cut up to {record['terrain']['maxCutMeters']} m, filled up to {record['terrain']['maxFillMeters']} m); {len(record['approachPieces'])} street approach pieces")
 print(f"{len(record['overpasses'])} bridges levelled over the cut ({sum(len(c['changed']) for c in record['overpasses'])} deck pieces)")
 for c in record['overpasses']:print(f"  {', '.join(c['names'])}: deck {c['deck'][0]} to {c['deck'][1]} m between landings at {c['landings']}")
 seams=record['bridgeSeams'];print(f"{len(seams['changed'])} records changed where a bridge stopped over the cut ({', '.join(sorted({c['name'] for c in seams['changed']})) or 'none'}); ramp pieces added: {', '.join(seams['pieces']) or 'none'}")
 for i in record['infeasible']:print(f"  tight: {i['road']} {i['at']} by {i['worst']} m")
 for u in record['unresolved']:print(f"  unresolved crossing: {u['road']} and {u['other']} at {u['point']}")
 for g in record['atGrade']:print(f"  at grade: {g['road']} crosses {g['other']} {g['name']} at {g['point']}")
 for n in record['notCarried']:print(f"  street not carried: {n['road']} {n['name']}: {n['reason']}")
 print(f"{len(record['signs'])} Storrow Drive warning signs ({sum(g['kind']=='clearance' for g in record['signs'])} low clearance)")
 over=record['buildings'];print(f"buildings over the roads: {len(over['removed'])} structures removed, {len(over['passages'])} passages to carve, {len(over['mesh'])} with exact collision")
 for r in over['removed']:print(f"  removed: {r['id']} {r['name']} (tile {r['tile']}) over {', '.join(r['roads'])}")
 for q in over['passages']:print(f"  passage: {q['building']} {q['name']} for {q['road']}, ceiling {q['ceiling']} to {q['ceilingEnd']} m")
 if a.check:return
 city['roads']=roads;by_id={r['id']:r for r in roads}
 touched=set(record['roads']['added'])|{r['id'] for r in record['roads']['sources']}
 refresh_road_tiles(a.data_dir,city,[r for r in roads if r['id'] in touched],before-set(by_id))
 write_gzip(a.data_dir/grid['file'],result.astype('<i2').tobytes())
 delta=result.astype(np.int32)-ungraded.astype(np.int32);scale=grid.get('scale',.01);grading=grid['grading']
 grading.update(changedVertices=int(np.count_nonzero(delta)),maxCut=round(float(-delta.min()*scale),4),maxFill=round(float(delta.max()*scale),4))
 if record['terrain']['vertices'] and NOTE not in grading['method']:grading['method']+=NOTE
 H.write_sidecar(a.data_dir,city,source,tunnel_records,record['signs'])
 # The structures standing in the roadway leave the package (the tiles of an earlier run no longer hold them).
 gone={r['id'] for r in previous};excluded={}
 for r in over['removed']:
  if r['id'] in gone:continue
  header=H.tile_header(a.data_dir,city,r['tile']);ordinal=next(i for i,b in enumerate(header['buildings']) if b['id']==r['id']);excluded.setdefault(r['tile'],{})[ordinal]={'id':r['id'],'roads':r['roads']}
 if excluded:
  from roadway_buildings import remove_buildings
  remove_buildings(a.data_dir,city,excluded,provenance)
 (a.data_dir/'city.json').write_text(json.dumps(city,separators=(',',':'))+'\n')
 provenance['roads']['bostonHighways']={'source':'Boston GIS layer 8 segments of the Massachusetts Turnpike, Storrow Drive and their ramps','count':sum(r['id'].startswith(H.PREFIXES) for r in roads),'tunnels':len(tunnel_records)}
 provenance['bostonHighways']=record;provenance_path.write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 target=a.data_dir/H.SOURCE_NAME
 if target.resolve()!=source_file.resolve():shutil.copyfile(source_file,target)


if __name__=='__main__':main()
