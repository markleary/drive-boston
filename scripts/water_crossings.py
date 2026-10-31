"""Level estimated water-crossing decks on their own at-grade junctions.

`build-metro.py` profiles each Boston GIS segment on its own: a node with a
positive source level, or inside mapped water, sits 6.4 m above the raw DEM
there. On a bridge over water that lifts the bank nodes 6.4 m above the quay
and the water nodes 6.4 m above the water surface, so the Summer Street and
Congress Street bridges over Fort Point Channel dropped 4.4 m from each bank to
the channel and climbed the same again inside the 10 m junction stub beside
Dorchester Avenue. Nothing passes under a bank node; its level only records
that the segment is a bridge, and the source level does not say how high.

A water crossing here is the chain of elevated pieces joined through lifted
nodes that reaches mapped water, with every lifted land node within 60 m of
the water. The chain gets one flat deck: the water-based estimate (basin level
plus 6.4 m) limited to the range of the chain's own at-grade junction heights,
then raised where the graded terrain under the deck or a road crossing beneath
needs it. Ramp pieces keep their unchanged ground landing, which the terrain
grader pinned, and smoothstep to the deck as `deck_profile()` does. Chains with
a dedicated builder (Harvard, Longfellow, Bowker, Tobin, Chelsea Creek,
Leverett, source-connection approaches) and chains reaching inland viaducts
are reported, never changed. Estimated game profiles, not surveyed decks.
"""
import math
from collections import defaultdict
from shapely.geometry import LineString,Point,Polygon
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely.strtree import STRtree
from road_structure_clearance import road_height

DECK=6.4
WATER_REACH=60
MIN_RISE=1.5
TERRAIN_RISE=.3
ALLOWED_KINDS={'elevated','water-crossing','restored-water-span'}
ALLOWED_IDS=('structure-','water-link-')
OWNED_NAMES={'Longfellow Bridge'}


def grid_sampler(grid,heights):
 """Bilinear ground(x,z) over a packaged elevation grid."""
 width=grid['width'];cell=grid['cellSize']
 def ground(x,z):
  fx=(x-grid['originX'])/cell;fz=(z-grid['originZ'])/cell;i=int(fx);j=int(fz);tx=fx-i;tz=fz-j
  a,b,c,d=[heights[k] for k in [j*width+i,j*width+i+1,(j+1)*width+i,(j+1)*width+i+1]]
  return float(a+(b-a)*tx+(c-a)*tz if tx+tz<=1 else d+(c-d)*(1-tx)+(b-d)*(1-tz))
 return ground


def water_inputs(city):
 """Mapped water polygons and a basin-level lookup from the water surfaces."""
 polygons=[Polygon(w['rings'][0],w['rings'][1:]).buffer(0) for w in city['water']]
 surfaces=[(prep(Polygon(s['rings'][0],s['rings'][1:]).buffer(0)),s['level']) for w in city['water'] for s in w.get('surfaces',[])]
 def water_level(x,z):
  p=Point(x,z)
  for shape,level in surfaces:
   if shape.covers(p):return level
  return None
 return polygons,water_level


def smooth(t):t=max(0,min(1,t));return t*t*(3-2*t)


def node_key(p):return (round(p[0],1),round(p[1],1))


def lifted(road,index):return road.get('startLevel' if index==0 else 'endLevel')==1


def stations(points):
 result=[0]
 for a,b in zip(points,points[1:]):result.append(result[-1]+math.dist(a,b))
 return result


def water_chains(roads):
 """Elevated pieces joined through lifted nodes, in a stable order."""
 elevated=[r for r in roads if r.get('elevations') and not r.get('tunnel')];ends=defaultdict(list)
 for road in elevated:
  for index in (0,-1):ends[node_key(road['points'][index])].append((road,index))
 parent={r['id']:r['id'] for r in elevated}
 def find(a):
  while parent[a]!=a:parent[a]=parent[parent[a]];a=parent[a]
  return a
 for shared in ends.values():
  joined=[road for road,index in shared if lifted(road,index)]
  for road in joined[1:]:parent[find(road['id'])]=find(joined[0]['id'])
 chains=defaultdict(list)
 for road in elevated:chains[find(road['id'])].append(road)
 return sorted(chains.values(),key=lambda chain:min(r['id'] for r in chain))


def owned(road):
 bridge=road.get('bridge',{})
 return road['name'] in OWNED_NAMES or bridge.get('kind','elevated') not in ALLOWED_KINDS or not str(bridge.get('id','')).startswith(ALLOWED_IDS)


def level_water_crossings(roads,water_polygons,ground,water_level=None,deck=DECK,reach=WATER_REACH,apply=True):
 """Give every qualifying water chain one flat deck. `ground(x,z)` is the graded
 terrain; `water_level(x,z)` returns a basin plane or None. Returns a report;
 with apply=False the roads are left as they are and only the report says what
 would change."""
 water=unary_union(water_polygons);wet=prep(water);deep=prep(water.buffer(-8))
 others=[r for r in roads if not r.get('tunnel')];lines=[LineString(r['points']) for r in others];tree=STRtree(lines)
 def water_node(p):return deep.covers(Point(p))
 def crossing_length(line):return line.intersection(water).length if wet.intersects(line) else 0
 report={'chains':[],'skipped':[],'changedRoads':[]}
 for chain in water_chains(roads):
  ids={r['id'] for r in chain};names=sorted({r['name'] for r in chain});entry={'names':names,'roads':sorted(ids)}
  wet_nodes=set();wet_roads=[];lifted_land=[];junctions=[]
  for road in chain:
   line=LineString(road['points'])
   if crossing_length(line)>12:wet_roads.append((road,line))
   for index in (0,-1):
    p=road['points'][index]
    if water_node(p):wet_nodes.add(node_key(p))
    elif lifted(road,index):lifted_land.append(p)
    else:junctions.append(road['elevations'][index])
  if not wet_nodes and not wet_roads:continue
  if not wet_nodes and not lifted_land:continue
  if any(owned(r) for r in chain):report['skipped'].append({**entry,'reason':'dedicated builder'});continue
  far=max((water.distance(Point(p)) for p in lifted_land),default=0)
  if far>reach:report['skipped'].append({**entry,'reason':'inland viaduct','farthestLiftedNodeMeters':round(far,1)});continue
  samples=[]
  for key in sorted(wet_nodes):samples.append((water_level and water_level(*key)) or ground(*key))
  for road,line in wet_roads:
   mid=line.intersection(water).centroid
   if not mid.is_empty:samples.append((water_level and water_level(mid.x,mid.y)) or ground(mid.x,mid.y))
  level=max(samples);estimate=level+deck
  base=min(max(estimate,min(junctions)),max(junctions)) if junctions else estimate
  base=max(base,level+MIN_RISE)
  terrain=max((ground(*p) for road in chain if lifted(road,0) and lifted(road,-1) for p in road['points']),default=-math.inf)
  base=max(base,terrain+TERRAIN_RISE)
  beneath=[];above=[]
  for road in chain:
   line=LineString(road['points'])
   for j in tree.query(line,predicate='intersects'):
    other=others[j]
    if other['id'] in ids:continue
    hit=line.intersection(lines[j]);points=[hit] if hit.geom_type=='Point' else [g for g in getattr(hit,'geoms',[]) if g.geom_type=='Point']
    for q in points:
     p=[q.x,q.y]
     if any(math.dist(p,v)<.05 for v in road['points']) and any(math.dist(p,v)<.05 for v in other['points']):continue
     height=road_height(other,p,ground)
     if height<road_height(road,p,ground):beneath.append(height)
     else:above.append(other['id'])
  if above:report['skipped'].append({**entry,'reason':'crossed above','by':sorted(set(above))});continue
  base=round(max([base]+[h+deck for h in beneath]),4)
  changed=[]
  for road in chain:
   lifted_ends=[lifted(road,0),lifted(road,-1)];old=road['elevations']
   if all(lifted_ends):new=[base]*len(road['points'])
   else:
    along=stations(road['points']);total=along[-1] or 1
    ha,hb=(old[0],base) if lifted_ends[1] else (base,old[-1])
    new=[round(ha+(hb-ha)*smooth(d/total),4) for d in along]
   if any(abs(a-b)>.0001 for a,b in zip(old,new)):
    changed.append(road['id'])
    if apply:road['elevations']=new
  report['chains'].append({**entry,'deck':base,'waterLevel':round(level,4),'junctions':sorted(round(v,4) for v in junctions),'changed':sorted(changed)})
  report['changedRoads'].extend(changed)
 report['changedRoads'].sort()
 return report


def chain_grades(roads,ids):
 """Steepest grade of a set of roads, for audits and tests."""
 worst=0
 for road in roads:
  if road['id'] not in ids or not road.get('elevations'):continue
  for a,b,ya,yb in zip(road['points'],road['points'][1:],road['elevations'],road['elevations'][1:]):
   length=math.dist(a,b)
   if length>.01:worst=max(worst,abs(yb-ya)/length)
 return worst
