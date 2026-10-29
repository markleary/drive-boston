"""Continuous Chelsea Creek crossings between Boston GIS and OSM streets.

The municipal outlines stop in the creek, so clipping both source networks
leaves gaps in both bridges. Keep the complete OSM crossing alignment between
the existing Boston street landing and its exact Chelsea street node. Profiles
are deliberately modest game estimates, not navigation-clearance surveys.
"""
import math
from pyproj import Transformer
from shapely.geometry import LineString,Point,Polygon
from shapely.ops import substring
from shapely import set_precision,union_all
from road_connections import resample,stations

TO_FEET=Transformer.from_crs(4326,2249,always_xy=True)
FT=1200/3937
SPECS=[
 {'id':'chelsea-mcardle','name':'Andrew P McArdle Bridge','ways':[93278101,8617292,821595656],'boston':['10384-0-0','9795-0-0'],'landing':'8407-0-0','width':13},
 {'id':'chelsea-street-bridge','name':'Chelsea Street Bridge','ways':[426639544,195779437,821600786,821600788,821600787,821600785],'boston':['10386-0-0','9338-0-0'],'landing':'7652-0-0','width':14},
]


def xy(p):
 x,y=TO_FEET.transform(p['lon'],p['lat'])
 return [round((x-771100)*FT,3),round(-(y-2952900)*FT,3)]


def repair_chelsea(city,source,ground):
 by_id={r['id']:r for r in city['roads']};ways={e['id']:e for e in source['elements']};added=[];removed=set()
 for spec in SPECS:
  # The chosen Boston landing is on dry land, before its old clipped deck.
  landing=by_id[spec['landing']];start=landing['points'][-1]
  original=[]
  for identifier in spec['ways']:
   points=[xy(p) for p in ways[identifier]['geometry']]
   if original:
    assert math.dist(original[-1],points[0])<.002,f'Broken OSM crossing chain {identifier}'
    points=points[1:]
   original.extend(points)
  line=LineString(original)
  # Chelsea Street's OSM way starts slightly behind the retained GIS landing.
  # Trim that overlap before snapping instead of folding the road back on itself.
  start_distance=line.project(Point(start))
  if start_distance>1:original=[list(p) for p in substring(line,start_distance,line.length).coords]
  if math.dist(start,original[0])<3:original[0]=start
  else:original=[start,*original]
  points=resample(original);distance=stations(points);length=distance[-1]
  a,b=ground(start),ground(points[-1]);crest=max(a,b)+4.8
  def height(d):
   t=d/length
   # Forty percent of the bridge is level; cubic approaches avoid a sharp crest.
   if t<.3:u=t/.3;return a+(crest-a)*u*u*(3-2*u)
   if t>.7:u=(1-t)/.3;return b+(crest-b)*u*u*(3-2*u)
   return crest
  widths=[round(spec['width']+(landing['width']-spec['width'])*max(0,1-d/35),4) for d in distance]
  road={'id':spec['id'],'name':spec['name'],'points':points,'width':spec['width'],'deckWidths':widths,'oneway':0,'elevations':[round(height(d),4) for d in distance],
   'startLevel':0,'endLevel':0,'deckTangents':{'start':[round(start[k]-landing['points'][-2][k],6) for k in (0,1)]},
   'bridge':{'id':spec['id'],'kind':'chelsea-creek-crossing','thickness':.65,'clearanceEstimated':True,'sourceLayer':1}}
  prefixes=tuple(f'osm-{identifier}-' for identifier in spec['ways'])
  for r in city['roads']:
   if r['id'] in spec['boston'] or r['id'].startswith(prefixes) or r['id']==spec['id']:removed.add(r['id'])
  # The north end must remain a source road junction, not a shoreline dead end.
  neighbors=[r for r in city['roads'] if r['id'] not in removed and r['id']!=spec['id'] and any(math.dist(points[-1],p)<.01 for p in r['points'])]
  assert neighbors,f'Missing Chelsea street continuation for {spec["id"]}'
  added.append(road)
 city['roads']=[r for r in city['roads'] if r['id'] not in removed]+added
 corridors=[LineString(r['points']).buffer(r['width']/2+3,cap_style=1) for r in added]
 coverage=union_all([set_precision(p,.001) for p in [*[Polygon(p) for p in city['coverage']],*corridors]],grid_size=.001).normalize()
 parts=list(coverage.geoms) if coverage.geom_type=='MultiPolygon' else [coverage]
 city['coverage']=[[[round(x,3),round(z,3)] for x,z in p.exterior.coords[:-1]] for p in parts]
 for landmark in city['landmarks']:
  if landmark['id'] in ['maverick-square','logan-airport']:
   landmark.pop('detached',None)
   landmark['description']={'maverick-square':'East Boston · Maverick Square, connected to Chelsea over Chelsea Creek','logan-airport':'East Boston · airport terminal road loop, reachable through Chelsea'}[landmark['id']]
 return {'roads':[r['id'] for r in added],'sourceWays':[identifier for spec in SPECS for identifier in spec['ways']],
  'method':'Complete OSM creek alignments between retained Boston street landings and exact Chelsea street nodes; remove duplicate clipped source pieces, add traffic coverage and estimated smooth bridge deck profiles.'}


def validate_chelsea(city,ground):
 by_id={r['id']:r for r in city['roads']}
 for spec in SPECS:
  road=by_id[spec['id']]
  assert road['points'][0]==by_id[spec['landing']]['points'][-1],f'Boston landing gap: {road["id"]}'
  for index in (0,-1):assert abs(road['elevations'][index]-ground(road['points'][index]))<.0002,f'Bridge leaves ground landing: {road["id"]}'
  assert any(r['id']!=road['id'] and any(math.dist(road['points'][-1],p)<.01 for p in r['points']) for r in city['roads']),f'Chelsea landing gap: {road["id"]}'
  for a,b,ya,yb in zip(road['points'],road['points'][1:],road['elevations'],road['elevations'][1:]):assert abs(yb-ya)<=math.dist(a,b)*.13+.0002,f'Excessive creek bridge grade: {road["id"]}'
  removed=set(spec['boston']);prefixes=tuple(f'osm-{identifier}-' for identifier in spec['ways'])
  assert not any(r['id'] in removed or r['id'].startswith(prefixes) for r in city['roads']),'Duplicate crossing source roads remain'
