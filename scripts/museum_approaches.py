"""Source-aligned approaches to the three clipped Leverett survey mouths.

Retain the established survey datum and its downstream connections. Each
approach reaches a street or another approach, shares the survey's measured
cross-section for 16 m, and uses an explicit estimated continuous profile.
"""
import math
from shapely.geometry import LineString,Point
from shapely.ops import substring
from road_connections import resample,stations
from harvard_terrain import sample_grid
from road_structure_clearance import road_height

KIND='museum-survey-approach'


def assemble(features,ids,start):
 points=[start]
 for id in ids:
  path=features[id]['paths'][0]
  if math.dist(points[-1],path[-1])<math.dist(points[-1],path[0]):path=list(reversed(path))
  assert math.dist(points[-1],path[0])<.02,f'Unconnected source feature {id}'
  points.extend(path[1:])
 return points


def build_approaches(city,source,heights):
 features={f['attributes']['OBJECTID']:f for f in source['features']};roads={r['id']:r for r in city['roads']};out=[]
 ground=lambda p:sample_grid(city['elevation'],heights,p)
 for route in source['routes']:
  mouth=route['mouth'];lip=[mouth[0]['x'],mouth[0]['z']]
  if 'parent' in route:
   parent=next(r for r in out if r['id']==route['parent']);start=route['join'];height=road_height(parent,start,lambda x,z:ground([x,z]))
   raw=features[route['featureIds'][0]]['paths'][0]
   points=route['mergePoints']+raw[2:]
  else:
   start=roads[route['landingRoad']]['points'][route['landingIndex']];height=ground(start)
   points=assemble(features,route['featureIds'],start)
  line=LineString(points);line=substring(line,0,line.project(Point(lip)))
  points=resample([list(p) for p in line.coords]);ss=stations(points);total=ss[-1]
  if fit:=route.get('separationFit'):
   original=[list(p) for p in points]
   for i,(p,s) in enumerate(zip(original,ss)):
    d=total-s;weight=max(0,min(1,(fit['outerMeters']-d)/(fit['outerMeters']-fit['fullMeters']),(d-fit['innerMeters'])/(fit['releaseMeters']-fit['innerMeters'])))
    weight=weight*weight*(3-2*weight);a=original[max(0,i-1)];b=original[min(len(points)-1,i+1)];dx=b[0]-a[0];dz=b[1]-a[1];length=math.hypot(dx,dz)
    points[i]=[p[0]-dz/length*fit['offsetMeters']*weight,p[1]+dx/length*fit['offsetMeters']*weight]
  offset=[lip[k]-points[-1][k] for k in (0,1)]
  # Blend the old centreline to the independently measured survey axis.
  for p,s in zip(points,ss):
   weight=max(0,1-(total-s)/45);weight=weight*weight*(3-2*weight)
   for k in (0,1):p[k]=round(p[k]+offset[k]*weight,4)
  points[-1]=[round(v,4) for v in lip];ss=stations(points);total=ss[-1]
  # Leave the first 12 m of the street junction level; the approach rises
  # only after its mouth has left the through street. Parent merges match
  # the parent's ribbon until the two roadbeds have separated.
  landing=12 if 'parent' not in route else 0
  ys=[height+(mouth[0]['y']+.025-height)*max(0,(s-landing)/(total-landing)) for s in ss]
  if 'sharedStreet' in route:
   street=roads[route['sharedStreet']];line=LineString(street['points']);shared=0
   for i,p in enumerate(points):
    if ss[i]>12 and line.distance(Point(p))>(street['width']+route['width'])/2+1:break
    shared=i
   assert shared<len(points)-1,'Approach must leave its shared street before rising'
   landing=ss[shared];height=ground(points[shared])
   ys=[ground(p) if i<=shared else height+(mouth[0]['y']+.025-height)*(s-landing)/(total-landing) for i,(p,s) in enumerate(zip(points,ss))]
   if control:=route.get('riseControl'):
    station=LineString(points).project(Point(control['point']));level=control['height']
    assert landing<station<total
    for i,s in enumerate(ss):
     if s>landing:ys[i]=height+(level-height)*(s-landing)/(station-landing) if s<=station else level+(mouth[0]['y']+.025-level)*(s-station)/(total-station)
  if 'parent' in route:
   # Match the branch floor to its parent through the shared pavement;
   # the later independent section rises to the retained survey.
   shared=0
   for i,p in enumerate(points):
    if LineString(parent['points']).distance(Point(p))>(parent['width']+route['width'])/2:break
    shared=i
   join_height=road_height(parent,points[shared],lambda x,z:ground([x,z]))
   assert shared<len(points)-1,'Branch must leave the parent before its survey mouth'
   for i,s in enumerate(ss):
    ys[i]=road_height(parent,points[i],lambda x,z:ground([x,z])) if i<=shared else join_height+(mouth[0]['y']+.025-join_height)*(s-ss[shared])/(total-ss[shared])
  widths=[route['width']]*len(points);edges=[[y,y] for y in ys]
  for s in mouth[1:]:
   points.append([round(s['x'],4),round(s['z'],4)]);ys.append(s['y']+.025);widths.append(min(route['width'],2*s['half']-.35));edges.append([s['yRight']+.025,s['yLeft']+.025])
  # Keep every overlap safely inside the measured barriers.
  widths[-len(mouth)]=min(route['width'],2*mouth[0]['half']-.35)
  edges[-len(mouth)]=[mouth[0]['yRight']+.025,mouth[0]['yLeft']+.025]
  road={'id':route['id'],'name':route['name'],'kind':'motorway_link','traffic':False,'oneway':1,'points':points,'width':route['width'],'elevations':[round(y,4) for y in ys],'deckWidths':widths,'deckEdgeElevations':[[round(y,4) for y in pair] for pair in edges],'startLevel':1 if 'parent' in route else 0,'endLevel':1,'bridge':{'id':route['id'],'kind':KIND,'thickness':.5,'clearanceEstimated':True}}
  if route.get('reverse'):
   for key in ['points','elevations','deckWidths','deckEdgeElevations']:road[key].reverse()
   road['deckEdgeElevations']=[list(reversed(e)) for e in road['deckEdgeElevations']];road['startLevel'],road['endLevel']=road['endLevel'],road['startLevel']
  out.append(road)
 return out


def repair_approaches(city,source,heights):
 roads=build_approaches(city,source,heights);ids={r['id'] for r in roads}
 city['roads']=[r for r in city['roads'] if r['id'] not in ids]+roads
 return roads


def validate_approaches(city,source,heights):
 """Replay the retained sources and reject detached or obstructed profiles."""
 from road_structure_clearance import crossing_points
 by_id={r['id']:r for r in city['roads']};ground=lambda x,z:sample_grid(city['elevation'],heights,[x,z])
 expected=build_approaches(city,source,heights)
 for road in expected:
  assert by_id.get(road['id'])==road,f"Rebuild Museum approach {road['id']} from its retained source"
  for a,b,ya,yb in zip(road['points'],road['points'][1:],road['elevations'],road['elevations'][1:]):
   assert abs(yb-ya)<=math.dist(a,b)*.13+.0002,f"Museum approach exceeds 13% grade: {road['id']}"
  line=LineString(road['points'])
  for other in city['roads']:
   if road['id']==other['id']:continue
   path=LineString(other['points'])
   if not line.intersects(path):continue
   for p in crossing_points(line.intersection(path)):
    point=[p.x,p.y];delta=road_height(road,point,ground)-road_height(other,point,ground)
    if abs(delta)<.3:continue # level street/parent merges
    thickness=(road if delta>0 else other).get('bridge',{}).get('thickness',.5)
    assert abs(delta)-thickness>=2.5,f"Museum approach obstructs {other['id']} at {point}: {delta:.2f} m"
