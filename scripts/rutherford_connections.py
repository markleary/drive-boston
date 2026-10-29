"""Restore the short, source-mapped Austin Street/Rutherford underpass.

The regional importer excludes every negative-level segment. At Rutherford
that removed the open approach ramps as well as the short road beneath Austin.
This explicit exception retains Boston's paths and level topology. Estimated
profiles, a local terrain cut, and preserved upper street decks share one datum.
The surveyed Zakim/I-93 mesh is deliberately outside this repair.
"""
import math
from copy import deepcopy
from harvard_terrain import sample_grid
from road_connections import resample,stations,share_deck_section

LOWER_KIND='rutherford-underpass'
UPPER_KIND='rutherford-retained-surface'
CHARLESTOWN_MAIN='osm-94668374-0'
CHARLESTOWN_FORKS=[('osm-8614837-0','14587-0-0'),('osm-59009759-0','14588-0-0')]
DEPTH=6.4


def smooth(t):return t*t*(3-2*t)


def lower_roads(source):
 result=[]
 for feature in source['rutherfordUnderpass']:
  attr=feature['attributes'];start=attr['F_ZLEV'];end=attr['T_ZLEV']
  for i,original in enumerate(feature['paths']):
   points=resample(original);distances=stations(points);total=distances[-1]
   ground=feature['groundEnds'][i];first=ground[0]+min(0,start)*DEPTH;last=ground[1]+min(0,end)*DEPTH
   heights=[round(first+(last-first)*(smooth(d/total) if start!=end else d/total),4) for d in distances]
   result.append({'id':f"{attr['OBJECTID']}-{i}-0",'name':'New Rutherford Avenue','points':points,'width':10,'oneway':1 if attr['ONEWAY']=='FT' else -1 if attr['ONEWAY']=='TF' else 0,'elevations':heights,'startLevel':start,'endLevel':end,'bridge':{'id':f"rutherford-{attr['OBJECTID']}",'kind':LOWER_KIND,'thickness':.35,'clearanceEstimated':True}})
 return result


def projection(road,p):
 best=None
 for i,(a,b) in enumerate(zip(road['points'],road['points'][1:])):
  dx=b[0]-a[0];dz=b[1]-a[1];t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz or 1)))
  distance=math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz)
  if best is None or distance<best[0]:best=(distance,road['elevations'][i]+t*(road['elevations'][i+1]-road['elevations'][i]))
 return best


def terrain_cut(city,heights,roads):
 """Clamp only the lower corridors, including their supporting grid triangles.

 The clamp target is fixed by the checked-in pre-repair ground anchors, so a
 second run cannot excavate the same bank again. A steep shoulder reaches the
 untouched terrain; upper source streets receive their original deck profiles.
 """
 grid=city['elevation'];cell=grid['cellSize'];width=grid['width'];scale=grid.get('scale',.01);targets={}
 for road in roads:
  # A pavement edge can sit diagonally opposite a grid node in its terrain
  # triangle. Clear that complete triangle rather than leave grass in the lane.
  flat=road['width']/2+cell*math.sqrt(2);radius=flat+5
  for a,b,ya,yb in zip(road['points'],road['points'][1:],road['elevations'],road['elevations'][1:]):
   i0=max(1,math.floor((min(a[0],b[0])-radius-grid['originX'])/cell));i1=min(width-2,math.ceil((max(a[0],b[0])+radius-grid['originX'])/cell))
   j0=max(1,math.floor((min(a[1],b[1])-radius-grid['originZ'])/cell));j1=min(grid['height']-2,math.ceil((max(a[1],b[1])+radius-grid['originZ'])/cell))
   dx=b[0]-a[0];dz=b[1]-a[1];length2=dx*dx+dz*dz
   for j in range(j0,j1+1):
    for i in range(i0,i1+1):
     x=grid['originX']+i*cell;z=grid['originZ']+j*cell;t=max(0,min(1,((x-a[0])*dx+(z-a[1])*dz)/(length2 or 1)))
     distance=math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)
     if distance>radius:continue
     # Extend the local plane beyond a segment end; otherwise the adjacent
     # sample's lower endpoint makes a small stair at every resampling vertex.
     along=((x-a[0])*dx+(z-a[1])*dz)/(length2 or 1)
     y=ya+(yb-ya)*along-.12+max(0,distance-flat)**2*.6
     k=j*width+i;targets[k]=min(targets.get(k,float('inf')),round(y/scale)*scale)
 changed=0;maximum=0
 for k,y in targets.items():
  delta=float(heights[k])-y
  if delta>1e-8:heights[k]=y;changed+=1;maximum=max(maximum,delta)
 return {'method':'Source negative-level profiles with fixed ground anchors; local terrain clamp and preserved upper street decks','roads':[r['id'] for r in roads],'depthMeters':DEPTH,'vertices':len(targets),'changedVertices':changed,'maxChangeMeters':round(maximum,4)}


def repair_charlestown(roads,ground):
 """Carry Boston's Austin bridge level across the three OSM approach ways."""
 by_id={r['id']:r for r in roads};main=by_id[CHARLESTOWN_MAIN]
 # The common OSM fork is still on the same bridge, not a ground landing.
 # Relative source layer 1 is retained across the municipal source boundary.
 fork=ground(main['points'][-1])+DEPTH;first=ground(main['points'][0]);points=resample(main['points']);distances=stations(points)
 main['points']=points;main['elevations']=[round(first+(fork-first)*smooth(d/distances[-1]),4) for d in distances];main['startLevel']=0;main['endLevel']=1
 main['bridge'].update({'kind':'charlestown-source-connection'})
 for identifier,boston_id in CHARLESTOWN_FORKS:
  road=by_id[identifier];boston=by_id[boston_id];points=resample(road['points']);distances=stations(points)
  shared=next((i,j) for i in (0,-1) for j in (0,-1) if math.dist(points[i],boston['points'][j])<.01);i,j=shared
  high=boston['elevations'][j];a,b=(high,fork) if i==0 else (fork,high)
  road['points']=points;road['elevations']=[round(a+(b-a)*d/distances[-1],4) for d in distances];road['startLevel']=1;road['endLevel']=1;road['bridge'].update({'kind':'charlestown-source-connection'})
  share_deck_section(boston,j,road,i)
  # Two divided carriageways meet the full four-lane bridge here. Carry its
  # complete cross-section into each fork mouth so their side rails cannot
  # intrude across the outside through lanes at the shared centerline node.
  common=-1 if i==0 else 0;total=distances[-1];boston_width=boston.get('deckWidths',[boston['width']]*len(boston['points']))[j]
  road['deckWidths']=[round(road['width']+(boston_width-road['width'])*max(0,1-(d if i==0 else total-d)/18)+(main['width']-road['width'])*max(0,1-(d if common==0 else total-d)/18),5) for d in distances]
  tangent=[main['points'][-1][k]-main['points'][-2][k] for k in (0,1)]
  main.setdefault('deckTangents',{})['end']=tangent
  road.setdefault('deckTangents',{})['start' if common==0 else 'end']=[v*(1 if common==0 else -1) for v in tangent]
 return [CHARLESTOWN_MAIN,*[p[0] for p in CHARLESTOWN_FORKS]]


def repair_rutherford(city,source,heights):
 """Mutate the manifest and shared terrain; repeat calls are byte-stable."""
 lower=lower_roads(source);ids={r['id'] for r in lower};by_id={r['id']:r for r in city['roads']}
 for preserved in source['retainedSurfaceProfiles']:
  road=by_id.get(preserved['id'])
  if road is None:raise ValueError(f"Missing Rutherford upper street {preserved['id']}")
  road['points']=deepcopy(preserved['points']);road['elevations']=list(preserved['elevations']);road['startLevel']=0;road['endLevel']=0
  road['bridge']={'id':f"rutherford-surface-{road['id']}",'kind':UPPER_KIND,'thickness':.35,'clearanceEstimated':True}
 city['roads']=[r for r in city['roads'] if r['id'] not in ids]+lower
 terrain=terrain_cut(city,heights,lower)
 for preserved in source['retainedSurfaceProfiles']:
  road=by_id[preserved['id']]
  for index,key in [(0,'startLevel'),(-1,'endLevel')]:
   road[key]=1 if road['elevations'][index]-sample_grid(city['elevation'],heights,road['points'][index])>.05 else 0
 charlestown=repair_charlestown(city['roads'],lambda p:sample_grid(city['elevation'],heights,p))
 return {'underpassRoads':[r['id'] for r in lower],'retainedSurfaceRoads':[r['id'] for r in source['retainedSurfaceProfiles']],'charlestownRoads':charlestown,'terrain':terrain}


def validate_rutherford(city,source,heights):
 """Gate source continuity, separate crossing levels and shared physics terrain."""
 by_id={r['id']:r for r in city['roads']}
 for expected in lower_roads(source):
  road=by_id.get(expected['id']);assert road is not None,f"Missing Rutherford underpass {expected['id']}"
  assert road['points']==expected['points'] and road['elevations']==expected['elevations'],f"Changed Rutherford source profile {road['id']}"
  for p,q,a,b in zip(road['points'],road['points'][1:],road['elevations'],road['elevations'][1:]):
   assert abs(b-a)<=math.dist(p,q)*.1+.0002,f"Steep Rutherford ramp {road['id']}"
  for i,p in enumerate(road['points']):
   a=road['points'][max(0,i-1)];b=road['points'][min(len(road['points'])-1,i+1)];dx=b[0]-a[0];dz=b[1]-a[1];length=math.hypot(dx,dz)
   for side in (-1,0,1):
    q=[p[0]-dz/length*road['width']/2*side,p[1]+dx/length*road['width']/2*side]
    assert sample_grid(city['elevation'],heights,q)<road['elevations'][i]-.05,f"Terrain obstructs Rutherford underpass {road['id']}"
 for expected in source['retainedSurfaceProfiles']:
  road=by_id[expected['id']]
  assert road['points']==expected['points'] and road['elevations']==expected['elevations'],f"Upper street changed at Rutherford {road['id']}"
 for chain in [('17657-0-0','17669-0-0','17662-0-0'),('17719-0-0','17675-0-0','17668-0-0','17663-0-0','17677-0-0')]:
  for first,last in zip(chain,chain[1:]):
   a=by_id[first];b=by_id[last]
   assert a['points'][-1]==b['points'][0] and abs(a['elevations'][-1]-b['elevations'][0])<.001,f"Rutherford route step {first}/{last}"
 # The northbound underpass and the upper Austin street deliberately share
 # plan coordinates, but never a support level or a traffic graph junction.
 lower=by_id['17668-0-0'];upper=by_id['17665-0-0']
 assert lower['points'][-1]==upper['points'][-1]
 assert upper['elevations'][-1]-upper['bridge']['thickness']-lower['elevations'][-1]>5.8,'Austin underpass headroom lost'
 main=by_id[CHARLESTOWN_MAIN]
 assert abs(main['elevations'][0]-sample_grid(city['elevation'],heights,main['points'][0]))<.001,'Charlestown south landing detached'
 for identifier,boston_id in CHARLESTOWN_FORKS:
  road=by_id[identifier];boston=by_id[boston_id]
  for a,b in [(road,boston),(road,main)]:
   shared=[(i,j) for i in (0,-1) for j in (0,-1) if math.dist(a['points'][i],b['points'][j])<.01]
   assert len(shared)==1,f"Lost Charlestown source connection {a['id']}/{b['id']}"
   i,j=shared[0];assert abs(a['elevations'][i]-b['elevations'][j])<.001,f"Charlestown bridge step {a['id']}/{b['id']}"
