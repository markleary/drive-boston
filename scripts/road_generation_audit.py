#!/usr/bin/env python3
"""Audit generated road surfaces and every elevated roadway, without a fixed map extent.

Writes a deterministic, coordinate-bearing report. --strict fails on remaining
profile problems and fixed-landing constraint conflicts, including those that
need source/approach design rather than an automatic repair. Run after the
complete generation chain, before shipping an extension. Ordinary data
validation also validates compiled surface polygons.
"""
import argparse,gzip,json,math,pathlib
from collections import defaultdict
import numpy as np
from shapely.geometry import Polygon,LineString,Point,box
from shapely.ops import unary_union
from shapely.strtree import STRtree
from deck_contacts import deck_sections
from street_surfaces import unpack
from water_crossings import grid_sampler,owned


def validate_surfaces(headers):
 surfaces={};parts=0
 for key,tile in headers.items():
  assert all(k in tile for k in ('streetPavement','streetSidewalks','deckPavement')),f'{key}: run build-street-surfaces.py to compile street polygons'
  size=tile['size'];x=tile['tx']*size;z=tile['tz']*size;area=box(x,z,x+size,z+size)
  for field in ('sidewalks','islands','driveways'):
   for item in tile.get(field,[]):
    rings=item['rings'] if field=='sidewalks' else item;polygon=Polygon(rings[0],rings[1:])
    assert polygon.is_valid and polygon.area>0,f'{key}: invalid {field} rings after serialization'
  layers={}
  for field in ('streetPavement','streetSidewalks','deckPavement'):
   polygons=[Polygon(r[0],r[1:]) for r in tile[field]]
   assert all(p.is_valid and p.area>0 and area.buffer(.002).covers(p) for p in polygons),f'{key}: invalid or out-of-tile {field}'
   joined=unary_union(polygons);assert sum(p.area for p in polygons)-joined.area<.01,f'{key}: overlapping {field}'
   layers[field]=joined;parts+=len(polygons)
  # Millimetre serialization can move a new intersection vertex off the long
  # edge it split. Ignore that sub-2 mm fringe, not an overlapping walkway.
  assert layers['streetPavement'].buffer(-.002).intersection(layers['streetSidewalks'].buffer(-.002)).area<.01,f'{key}: fallback sidewalk crosses asphalt'
  surfaces[key]=layers
 seams=0
 for key,tile in headers.items():
  tx,tz=tile['tx'],tile['tz'];size=tile['size']
  for dx,dz in ((1,0),(0,1)):
   other=f'{tx+dx}_{tz+dz}'
   if other not in surfaces:continue
   boundary=LineString([[(tx+1)*size,tz*size],[(tx+1)*size,(tz+1)*size]]) if dx else LineString([[tx*size,(tz+1)*size],[(tx+1)*size,(tz+1)*size]])
   for field in ('streetPavement','deckPavement'):
    a=surfaces[key][field].intersection(boundary);b=surfaces[other][field].intersection(boundary)
    assert a.symmetric_difference(b).length<.05,f'{key}/{other}: {field} tile seam differs by {a.symmetric_difference(b).length:.3f} m'
   seams+=1
 return {'tiles':len(headers),'polygonParts':parts,'tileSeams':seams}


def profile_issues(roads,ground,contacts=()):
 contact_tree=STRtree(contacts)
 issues=[];stations=0
 for r in roads:
  ys=r.get('elevations')
  if not ys or r.get('tunnel'):continue
  pts=r['points'];edges=deck_sections(r)
  worst={'depth':0};unpaved={'depth':0};grade=0;grade_point=None
  for i,(a,b) in enumerate(zip(pts,pts[1:])):
   length=math.dist(a,b);segment_grade=abs(ys[i+1]-ys[i])/max(.001,length)
   if segment_grade>grade:grade=segment_grade;grade_point=[round((a[k]+b[k])/2,3) for k in (0,1)]
   count=max(1,math.ceil(length/2))
   for j in range(count+1):
    t=j/count
    for side in (0,.25,.5,.75,1):
     # Sample the whole deck footprint, including its edge elevations. This is
     # a diagnostic, not a clearance certificate for every triangle/vehicle.
     values=[(1-t)*((1-side)*edges[i][0][k]+side*edges[i][1][k])+t*((1-side)*edges[i+1][0][k]+side*edges[i+1][1][k]) for k in (0,1,2)]
     x,z,y=values;depth=ground(x,z)-y;stations+=1
     if depth>worst['depth']:worst={'depth':round(depth,3),'point':[round(x,3),round(z,3)]}
     if depth>.15 and depth>unpaved['depth'] and not len(contact_tree.query(Point(x,z).buffer(.003),predicate='intersects')):unpaved={'depth':round(depth,3),'point':[round(x,3),round(z,3)]}
  if unpaved['depth']>.15 or grade>.1802:
   issues.append({'road':r['id'],'name':r['name'],'maxGrade':round(grade,4),'gradePoint':grade_point,'terrainAboveDeck':worst,'unpavedTerrainIntrusion':unpaved,'dedicatedBuilder':owned(r)})
 return issues,stations


def regressions(report,baseline):
 """An explicit known-issues report permits no new or worsened defect.

 Keep --strict for clean-map/extension acceptance. This gate lets existing
 issues remain visible while preventing unrelated work from adding to them.
 """
 # A town way clipped at a town line keeps one id on both sides, so an issue
 # matches any reviewed record of its id (or road set) that it does not exceed.
 known=defaultdict(list);failures=[]
 for i in baseline['remainingProfiles']:known[i['road']].append(i)
 def worse(issue,old):
  out=[]
  if issue['maxGrade']>old['maxGrade']+.0001:out.append(f"steeper profile: {issue['road']}")
  if issue['gradePoint']!=old['gradePoint']:out.append(f"changed steep location: {issue['road']}")
  if issue['unpavedTerrainIntrusion']['depth']>old['unpavedTerrainIntrusion']['depth']+.001:out.append(f"new terrain intrusion: {issue['road']}")
  return out
 for issue in report['remainingProfiles']:
  if not known[issue['road']]:failures.append(f"new profile issue: {issue['road']}");continue
  results=[worse(issue,old) for old in known[issue['road']]]
  if all(results):failures.extend(min(results,key=len))
 conflicts=defaultdict(list)
 for c in baseline.get('fixedConstraintConflicts',[]):conflicts[tuple(c['roads'])].append(c)
 for c in report.get('fixedConstraintConflicts',[]):
  if not any(c['excess']<=old['excess']+.001 for old in conflicts[tuple(c['roads'])]):failures.append(f"new or worsened constraint conflict: {', '.join(c['roads'])}")
 return failures


def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data-dir',type=pathlib.Path,default=pathlib.Path('public/data'));p.add_argument('--output',type=pathlib.Path);p.add_argument('--strict',action='store_true');p.add_argument('--baseline',type=pathlib.Path,help='fail on new/worsened issues relative to a reviewed report');a=p.parse_args()
 baseline=json.loads(a.baseline.read_text()) if a.baseline else None
 city=json.loads((a.data_dir/'city.json').read_text());headers={key:unpack(a.data_dir/'tiles'/f't_{key}.bin')[0] for key in city['tiles']['keys']}
 summary=validate_surfaces(headers);grid=city['elevation'];ground=grid_sampler(grid,np.frombuffer(gzip.decompress((a.data_dir/grid['file']).read_bytes()),dtype='<i2')*grid.get('scale',.01))
 contacts=[Polygon(r[0],r[1:]) for tile in headers.values() for r in tile['deckPavement']]
 issues,count=profile_issues(city['roads'],ground,contacts)
 provenance=json.loads((a.data_dir/'provenance.json').read_text())
 protected={r:chain['reason'] for chain in provenance.get('waterCrossingDecks',{}).get('skipped',[]) for r in chain['roads']}
 for issue in issues:
  if issue['road'] in protected:issue['waterChainPolicy']=protected[issue['road']]
 report={'roads':len(city['roads']),**summary,'profileSamples':count,'remainingProfiles':issues,'fixedConstraintConflicts':provenance.get('landApproaches',{}).get('unresolvedProfiles',[])}
 if a.output:a.output.write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({**summary,'roads':len(city['roads']),'profileSamples':count,'remainingProfiles':len(issues),'fixedConstraintConflicts':len(report['fixedConstraintConflicts'])},indent=2))
 if baseline is not None:
  failures=regressions(report,baseline)
  if failures:raise SystemExit('\n'.join(failures))
 if a.strict and (issues or report['fixedConstraintConflicts']):raise SystemExit('Road profile or constraint review required; see --output report for road IDs and coordinates.')

if __name__=='__main__':main()
