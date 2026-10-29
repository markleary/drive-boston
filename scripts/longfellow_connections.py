"""Keep the Memorial Drive U-turn on its two source-mapped carriageways.

OSM way 8616106 starts on First Street way 89785707 and ends at an interior
vertex of Memorial Drive way 8615862 (42.3610847, -71.0788016). The water
polygon used to lift only that last point by 6.4 m, while the island rescue
considered endpoint-to-endpoint joins only. Source topology, including an
interior vertex, takes precedence over water-based height inference.
"""
import math
from road_connections import resample,stations
from road_structure_clearance import road_height

RAMP='osm-8616106-0'
PARENTS=['osm-89785707-0','osm-8615862-0']


def junctions(roads):
 by_id={r['id']:r for r in roads};ramp=by_id[RAMP]
 for index,id in zip((0,-1),PARENTS):
  parent=by_id[id];p=ramp['points'][index]
  assert any(math.dist(p,q)<.002 for q in parent['points']),f'Missing source U-turn junction: {id}'
  yield index,parent,p


def repair_longfellow_connections(roads,ground):
 ramp=next(r for r in roads if r['id']==RAMP)
 heights=[road_height(parent,p,lambda x,z:ground([x,z])) for _,parent,p in junctions(roads)]
 points=resample(ramp['points']);distances=stations(points);total=distances[-1]
 ramp['points']=points
 ramp['elevations']=[round(heights[0]+(heights[1]-heights[0])*(d/total),4) for d in distances]
 # The first junction reaches terrain; the second joins an existing deck
 # above the water, not a bare-earth landing despite its modest height.
 ramp['startLevel']=0;ramp['endLevel']=1
 ramp['bridge'].update({'kind':'connected-junction','sourceLayer':1})
 return {'road':RAMP,'parents':PARENTS,'method':'Source endpoint and interior-vertex junctions share their parent deck heights; water classification cannot lift the junction independently.'}


def validate_longfellow_connections(roads,ground):
 ramp=next(r for r in roads if r['id']==RAMP)
 for index,parent,p in junctions(roads):
  expected=road_height(parent,p,lambda x,z:ground([x,z]))
  assert abs(ramp['elevations'][index]-expected)<.0002,f'Longfellow U-turn leaves {parent["id"]}'
 for a,b,ya,yb in zip(ramp['points'],ramp['points'][1:],ramp['elevations'],ramp['elevations'][1:]):
  assert abs(yb-ya)<math.dist(a,b)*.04+.0002,'Longfellow U-turn has excessive grade'
