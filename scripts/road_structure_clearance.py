"""Reject source-tagged overpasses whose estimated decks close a lower road.

OSM layer numbers describe relative crossing order, not metres above the DEM.
In particular a bare-earth DEM can measure the lower road at both ends of a
short bridge. Connectivity alone cannot detect the resulting collapsed deck.
This check intentionally fails instead of inventing high, disconnected ramps.
The 2.5 m minimum is a conservative game obstruction check, not a surveyed or
legal vehicle clearance; a verified local profile can provide greater clearance.
"""
import math
from shapely.geometry import LineString
from shapely.strtree import STRtree

MIN_CLEARANCE=2.5


def road_height(road,point,ground):
 elevations=road.get('elevations')
 if not elevations:return ground(*point)
 closest=None
 for i,(a,b) in enumerate(zip(road['points'],road['points'][1:])):
  dx,dz=b[0]-a[0],b[1]-a[1];length=dx*dx+dz*dz
  t=max(0,min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dz)/(length or 1)))
  distance=math.hypot(point[0]-a[0]-dx*t,point[1]-a[1]-dz*t)
  if closest is None or distance<closest[0]:closest=(distance,elevations[i]+(elevations[i+1]-elevations[i])*t)
 return closest[1]


def crossing_points(shape):
 if shape.geom_type=='Point':return [shape]
 if shape.geom_type in ('MultiPoint','GeometryCollection'):return [p for g in shape.geoms for p in crossing_points(g)]
 return []


def clearance_issues(roads,ground,minimum=MIN_CLEARANCE):
 lines=[LineString(r['points']) for r in roads];tree=STRtree(lines);issues=[];checked=0
 for i,upper in enumerate(roads):
  layer=upper.get('bridge',{}).get('sourceLayer',0)
  if layer<=0:continue
  if not upper.get('elevations'):raise ValueError(f"Source-tagged bridge {upper['id']} has no deck profile")
  for j in sorted(tree.query(lines[i],predicate='intersects')):
   lower=roads[j]
   if j==i:continue
   other_layer=lower.get('bridge',{}).get('sourceLayer',max(lower.get('startLevel',0),lower.get('endLevel',0)))
   if other_layer>=layer:continue
   for crossing in crossing_points(lines[i].intersection(lines[j])):
    p=[crossing.x,crossing.y]
    # Shared source vertices are connected junctions. Only independent
    # crossings require clearance; resampling retains those source vertices.
    if any(math.dist(p,q)<.05 for q in upper['points']) and any(math.dist(p,q)<.05 for q in lower['points']):continue
    checked+=1
    clearance=road_height(upper,p,ground)-upper['bridge'].get('thickness',.75)-road_height(lower,p,ground)
    if clearance<minimum-.01:issues.append({'upper':upper['id'],'lower':lower['id'],'point':[round(v,3) for v in p],'clearance':round(clearance,3)})
 return issues,checked


def validate_bridge_clearance(roads,ground,minimum=MIN_CLEARANCE):
 issues,checked=clearance_issues(roads,ground,minimum)
 if issues:
  details='; '.join(f"{v['upper']} above {v['lower']} at {v['point']}: {v['clearance']:.2f} m" for v in issues)
  raise ValueError(f'Source bridge clearance below {minimum:g} m. Provide a connected deck/approach profile before shipping: {details}')
 return checked
