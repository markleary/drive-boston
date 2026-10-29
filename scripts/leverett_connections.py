"""Complete the active Leverett Connector below the retained I-93 survey.

The survey ends at two land-side ramp mouths. The importer also excluded
their unnamed/freeway continuations. Current OSM paths and municipal street
landings bound this exception; the real unbuilt I-695 ramp stays untouched.
"""
import math
from road_connections import resample,stations
from harvard_terrain import sample_grid

KIND='leverett-restored-connector'


def interpolate(controls,distance):
 for a,b in zip(controls,controls[1:]):
  if distance<=b[0]:return a[1]+(b[1]-a[1])*max(0,min(1,(distance-a[0])/(b[0]-a[0])))
 return controls[-1][1]


def repair_leverett(city,source,heights):
 ids={r['id'] for r in source['routes']};city['roads']=[r for r in city['roads'] if r['id'] not in ids];result=[]
 for route in source['routes']:
  points=resample(route['points']);distances=stations(points);total=distances[-1];mouth=route['surveyMouth'];north=route['direction']=='north'
  controls=[list(p) for p in route['profileControls']];controls[-1][0]=total
  ground=sample_grid(city['elevation'],heights,route['landing']['point'])
  controls[0 if north else -1][1]=ground
  widths=[]
  for distance in distances:
   from_mouth=total-distance if north else distance
   widths.append(round(mouth['width']+(route['width']-mouth['width'])*min(1,from_mouth/25),5))
  tangent=mouth['routeDirection'];road={'id':route['id'],'name':route['name'],'kind':'motorway','traffic':False,'points':points,'width':route['width'],'oneway':1,'elevations':[round(interpolate(controls,d),4) for d in distances],'deckWidths':widths,'deckTangents':{'end' if north else 'start':tangent},'startLevel':0 if north else 1,'endLevel':1 if north else 0,'bridge':{'id':route['id'],'kind':KIND,'thickness':route['thickness'],'clearanceEstimated':True}}
  if route.get('supportExclusions'):road['bridge']['supportExclusions']=[list(p) for p in route['supportExclusions']]
  city['roads'].append(road);result.append(road['id'])
 return {'roads':result,'method':'Active OSM Leverett Connector paths from unchanged survey mouths to existing municipal street landings; estimated continuous profiles beneath the upper surveyed viaduct','surveyModel':source['surveyModel'],'sourceWays':[w['id'] for w in source['ways']]}


def validate_leverett(city,source,heights):
 by_id={r['id']:r for r in city['roads']}
 for route in source['routes']:
  road=by_id.get(route['id']);assert road is not None,f"Missing active Leverett continuation {route['id']}"
  assert road['points']==resample(route['points']),'Leverett source alignment changed'
  assert road.get('traffic') is False,'Source-survey continuation must not create an isolated ambient traffic route'
  mouth=route['surveyMouth'];i=mouth['index'];j=0 if i==-1 else -1
  assert road['points'][i]==mouth['point'] and abs(road['elevations'][i]-mouth['height'])<.001,'Leverett survey mouth detached'
  assert road['points'][j]==route['landing']['point'],'Leverett street landing moved'
  assert abs(road['elevations'][j]-sample_grid(city['elevation'],heights,road['points'][j]))<.001,'Leverett street landing detached'
  assert any(any(p==road['points'][j] for p in by_id[id]['points']) for id in route['landing']['roadIds']),'Leverett street connection lost'
  assert road['bridge'].get('supportExclusions',[])==route.get('supportExclusions',[]),'Leverett lower-road support clearance lost'
  for p,q,a,b in zip(road['points'],road['points'][1:],road['elevations'],road['elevations'][1:]):
   assert abs(b-a)<math.dist(p,q)*.06+.0002,'Leverett approach grade exceeds6%'
  for i,p in enumerate(road['points']):
   a=road['points'][max(0,i-1)];b=road['points'][min(len(road['points'])-1,i+1)];dx=b[0]-a[0];dz=b[1]-a[1];length=math.hypot(dx,dz)
   for side in (-1,0,1):
    q=[p[0]-dz/length*road['deckWidths'][i]/2*side,p[1]+dx/length*road['deckWidths'][i]/2*side]
    assert sample_grid(city['elevation'],heights,q)<road['elevations'][i]+.05,'Terrain obstructs Leverett pavement'
