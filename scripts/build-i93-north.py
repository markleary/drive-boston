#!/usr/bin/env python3
"""Add Interstate 93 north of the Charlestown viaduct: both carriageways and the
interchange ramps from the Zakim survey mouths to the Medford/Stoneham line,
closed with concrete barriers at the northern end, the southbound lower deck
beneath the surveyed Charlestown viaduct (cutting the City Square ramp pieces it
replaces out of the Zakim survey mesh) and the survey traces that join the
Central Artery tunnel to both.

Run after build-tobin-bridge.py, before building_clearance_package.py and
build-street-surfaces.py, which measure and drape the streets this changes.
Idempotent: a rerun drops the roads it added, restores the recorded grid
vertices and streets and redoes the same build, writing the same package and
provenance (validate-city.py replays it); the survey tile keeps its recorded
cut. See i93_north.py for the method.

  --extract   rebuild the source sidecar from the cached town extracts
              (data-source-cache/osm-<town>-roads.json), keeping its traced
              survey stations
"""
import argparse,hashlib,json,pathlib,shutil,sys
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import i93_north as I
from north_overpasses import load_grid,tile_footprints
from road_tiles import refresh_road_tiles
from tileformat import write_gzip

NOTE=' Interstate 93 cut beneath the Roosevelt Circle and Fellsway West bridges afterwards by build-i93-north.py.'


def main():
 p=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
 p.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');p.add_argument('--source-file',type=pathlib.Path,default=ROOT/'public/data'/I.SOURCE_NAME)
 p.add_argument('--extract',action='store_true');p.add_argument('--source-dir',type=pathlib.Path,default=ROOT/'data-source-cache');p.add_argument('--check',action='store_true',help='report without writing');a=p.parse_args()
 if a.extract:
  old=json.loads(a.source_file.read_text());fresh=I.extract(a.source_dir,{k:v for k,v in old['survey'].items() if k!='building'})
  a.source_file.write_text(json.dumps(fresh,separators=(',',':'))+'\n');print(f"{a.source_file}: {len(fresh['ways'])} source ways")
 raw=a.source_file.read_bytes();source=json.loads(raw)
 city=json.loads((a.data_dir/'city.json').read_text());grid=city['elevation'];provenance_path=a.data_dir/'provenance.json';provenance=json.loads(provenance_path.read_text())
 heights=load_grid(a.data_dir/grid['file']);ungraded=load_grid(a.data_dir/grid['source']);before={r['id'] for r in city['roads']}
 I.restore(city['roads'],heights,provenance.get('i93North'))
 mesh=I.SurveyMesh(a.data_dir,city);joins=I.tunnel_joins(a.data_dir,city)
 record,roads,result=I.install(city,source,heights,tile_footprints(a.data_dir,city),mesh,joins)
 record={'source':{'file':I.SOURCE_NAME,'sha256':hashlib.sha256(raw).hexdigest(),'ways':len(source['ways'])},**record}
 for name,c in record['carriageways'].items():print(f"{name}: {c['lengthMeters']:.0f} m in {c['pieces']} pieces, {min(c['lanes'])} to {max(c['lanes'])} lanes")
 print(f"{record['ramps']} ramps; {len(record['crossings'])} crossings with existing roads, {len(record['newCrossings'])} between new roads; closed ends {', '.join(c['road']+' '+c['end'] for c in record['closed'])}")
 print(f"{len(record['terrain']['vertices'])} grid vertices changed (cut up to {record['terrain']['maxCutMeters']} m, {record['terrain']['volumeCubicMeters']} m3; filled up to {record['terrain']['maxFillMeters']} m, {record['terrain']['fillCubicMeters']} m3); {len(record['approachPieces'])} street approach pieces; {len(record['roads']['added'])} roads added")
 for pair in record['twins']['pairs']:
  one,other=pair['roads'];lift=pair['lifted'];print(f"{one} and {other} share one height along {pair['alongsideMeters']:.0f} m: {one} lifted over {lift[one]['meters']:.0f} m (up to {lift[one]['max']:.2f} m), {other} over {lift[other]['meters']:.0f} m (up to {lift[other]['max']:.2f} m); {len(pair['apart'])} stretches left apart (up to {max((e['by'] for e in pair['apart']),default=0):.2f} m)")
 if record['twins']['ramps']:print(f"  ramps solved again with them: {', '.join(record['twins']['ramps'])}")
 lower=record['lowerDeck'];cut=record['surveyCut']
 if lower:print(f"southbound lower deck: {lower['heldMeters']} m beneath the survey (at least {lower['minClearanceMeters']} m under its slab), {lower['curveMeters']} m curve to City Square, {lower['joinOverlapMeters']} m onto survey carriageway #30")
 if cut:print(f"survey cut {cut['sha256'][:12]}: {cut['droppedTriangles']} triangles dropped, {cut['splitTriangles']} split, {cut['areaSquareMeters']} m2")
 print(f"{len(record['traces'])} survey traces, {sum(t['lengthMeters'] for t in record['traces']):.0f} m")
 for i in record['infeasible']:print(f"  tight: {i['road']} {i['at']} by {i['worst']} m")
 for n in record['notCarried']:print(f"  street not carried: {n['road']} {n['name']}: {n['reason']}")
 if a.check:return
 mesh.write()  # before the road lists are refreshed, which rewrite tile headers read back from disk
 city['roads']=roads;by_id={r['id']:r for r in roads}
 touched=set(record['roads']['added'])|{r['id'] for r in record['roads']['sources']}
 refresh_road_tiles(a.data_dir,city,[r for r in roads if r['id'] in touched],before-set(by_id))
 write_gzip(a.data_dir/grid['file'],result.astype('<i2').tobytes())
 delta=result.astype(np.int32)-ungraded.astype(np.int32);scale=grid.get('scale',.01);grading=grid['grading']
 grading.update(changedVertices=int(np.count_nonzero(delta)),maxCut=round(float(-delta.min()*scale),4),maxFill=round(float(delta.max()*scale),4))
 if NOTE not in grading['method']:grading['method']+=NOTE
 (a.data_dir/'city.json').write_text(json.dumps(city,separators=(',',':'))+'\n')
 provenance['roads']['towns']['count']=sum(r['id'].startswith('osm-') for r in roads)
 provenance['roads']['i93North']={'source':'OpenStreetMap I 93 ways and the Zakim survey mesh','count':sum(r['id'].startswith(I.PREFIX) for r in roads)}
 provenance['i93North']=record;provenance_path.write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 target=a.data_dir/I.SOURCE_NAME
 if target.resolve()!=a.source_file.resolve():shutil.copyfile(a.source_file,target)


if __name__=='__main__':main()
