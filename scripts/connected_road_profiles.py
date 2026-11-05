"""Solve generic land decks as connected profiles, with pinned street landings.

Segment-local smoothsteps create cliffs at source splits. A distance envelope
over the connected deck graph bounds grades while retaining existing heights
where feasible. Terrain and roads passing beneath are lower bounds; actual
street landings and dedicated structures are fixed. Infeasible chains are
reported rather than moving a landing or cutting a road through another level.
"""
import heapq,math
from collections import defaultdict
from shapely.geometry import LineString,Point
from shapely.strtree import STRtree
from water_crossings import owned,stations
from road_structure_clearance import crossing_points,road_height

MAX_GRADE=.18


def crossing_floors(a,b,t,length,required,base,upper,floor):
 """Bound both ends so their interpolation at t is at least required.

 Pick a slope within the fixed-landing grade envelope, preferring the source
 slope. The weighted endpoint bounds equal the crossing height regardless of
 vertex spacing. If no slope fits, the ordinary floor/upper conflict check
 rejects the component instead of silently lowering the crossing.
 """
 if t<=1e-9:floor[a]=max(floor[a],required);return
 if t>=1-1e-9:floor[b]=max(floor[b],required);return
 before,after=t*length,(1-t)*length
 low=max(-MAX_GRADE,(required-upper[a])/before);high=min(MAX_GRADE,(upper[b]-required)/after)
 slope=max(-MAX_GRADE,min(MAX_GRADE,(base[b]-base[a])/length))
 if low<=high:slope=max(low,min(high,slope))
 floor[a]=max(floor[a],required-slope*before);floor[b]=max(floor[b],required+slope*after)


def connected_profiles(roads,ground,excluded=()):
 excluded=set(excluded)
 eligible=[r for r in roads if r.get('elevations') and not r.get('tunnel') and r['id'] not in excluded and not owned(r)]
 ids={id(r) for r in eligible};fixed_xy=set();nodes={};points=[];base=[];floor=[];graph=[];refs=defaultdict(list)
 xy=lambda p:(round(p[0],3),round(p[1],3))
 for r in roads:
  if id(r) not in ids:
   for p in r['points']:fixed_xy.add(xy(p))
 for r in eligible:
  along=stations(r['points']);total=along[-1];indices=[]
  for i,(p,y,d) in enumerate(zip(r['points'],r['elevations'],along)):
   # A shared plan coordinate at a different height is an over/underpass.
   key=(*xy(p),round(y,2));n=nodes.get(key)
   if n is None:
    n=nodes[key]=len(points);points.append(p);base.append(y);floor.append(-math.inf);graph.append([])
   indices.append(n);refs[n].append((r,i))
   taper=min(1,d/8,(total-d)/8)
   floor[n]=max(floor[n],ground(*p)+.05*taper)
  for a,b in zip(indices,indices[1:]):
   distance=math.dist(points[a],points[b]);graph[a].append((b,distance));graph[b].append((a,distance))
 pins={n for n,p in enumerate(points) if xy(p) in fixed_xy or len(graph[n])==1}
 for r in eligible:
  for i,level in ((0,'startLevel'),(-1,'endLevel')):
   if r.get(level)==0 and abs(r['elevations'][i]-ground(*r['points'][i]))<.01:
    pins.add(nodes[(*xy(r['points'][i]),round(r['elevations'][i],2))])
 # An existing ramp may land inside a parent segment rather than on one of
 # its resampled vertices. Pin that segment's two ends to retain the exact
 # interpolated join height (including connections to dedicated builders).
 deck_lines=[LineString(r['points']) for r in eligible];deck_tree=STRtree(deck_lines)
 for other in roads:
  if other.get('tunnel'):continue
  for oi in (0,-1):
   p=other['points'][oi];point=Point(p)
   for j in deck_tree.query(point.buffer(.01),predicate='intersects'):
    r=eligible[j]
    if r is other or abs(road_height(r,p,ground)-road_height(other,p,ground))>.02:continue
    for i,(a,b) in enumerate(zip(r['points'],r['points'][1:])):
     if LineString([a,b]).distance(point)>.01:continue
     if min(math.dist(p,a),math.dist(p,b))<.01:continue
     for k in (i,i+1):pins.add(nodes[(*xy(r['points'][k]),round(r['elevations'][k],2))])
 for n in pins:floor[n]=base[n]
 # Preserve clearance at independently crossing streets, even when a source
 # stub's estimated height is reduced to fit the approach distance available.
 others=[r for r in roads if not r.get('tunnel')];lines=[LineString(r['points']) for r in others];tree=STRtree(lines);crossings=[]
 for r in eligible:
  line=LineString(r['points'])
  for j in tree.query(line,predicate='intersects'):
   other=others[j]
   if other is r:continue
   for hit in crossing_points(line.intersection(lines[j])):
    p=[hit.x,hit.y]
    if any(math.dist(p,q)<.05 for q in r['points']) and any(math.dist(p,q)<.05 for q in other['points']):continue
    lower=road_height(other,p,ground);old=road_height(r,p,ground);thickness=r['bridge'].get('thickness',.75)
    if old-lower-thickness<2.5:continue
    required=lower+thickness+min(4.5,old-lower-thickness)
    for i,(a,b) in enumerate(zip(r['points'],r['points'][1:])):
     length=math.dist(a,b)
     if length<1e-9 or LineString([a,b]).distance(hit)>1e-7:continue
     t=max(0,min(1,sum((p[k]-a[k])*(b[k]-a[k]) for k in (0,1))/length**2))
     na=nodes[(*xy(a),round(r['elevations'][i],2))];nb=nodes[(*xy(b),round(r['elevations'][i+1],2))]
     crossings.append((na,nb,t,length,required))
 upper=[math.inf]*len(points);queue=[]
 for n in pins:upper[n]=base[n];heapq.heappush(queue,(base[n],n))
 while queue:
  value,n=heapq.heappop(queue)
  if value!=upper[n]:continue
  for other,distance in graph[n]:
   candidate=value+MAX_GRADE*distance
   if candidate<upper[other]:upper[other]=candidate;heapq.heappush(queue,(candidate,other))
 for a,b,t,length,required in crossings:crossing_floors(a,b,t,length,required,base,upper,floor)
 seen=set();changes=[];unresolved=[]
 for seed in range(len(points)):
  if seed in seen:continue
  component=[];todo=[seed];seen.add(seed)
  while todo:
   n=todo.pop();component.append(n)
   for other,_ in graph[n]:
    if other not in seen:seen.add(other);todo.append(other)
  members={r['id']:r for n in component for r,_ in refs[n]}
  buried=any(base[n]<ground(*points[n])-.05 for n in component)
  steep=any(abs(base[n]-base[other])>MAX_GRADE*distance+.002 for n in component for other,distance in graph[n])
  if not buried and not steep:continue
  bad=[n for n in component if floor[n]>upper[n]+.002]
  if bad:
   unresolved.append({'roads':sorted(members),'reason':'terrain/clearance exceeds the grade envelope from fixed landings','excess':round(max(floor[n]-upper[n] for n in bad),3)})
   continue
  values={n:max(floor[n],min(base[n],upper[n])) for n in component};queue=[(-y,n) for n,y in values.items()];heapq.heapify(queue)
  while queue:
   negative,n=heapq.heappop(queue);value=-negative
   if value!=values[n]:continue
   for other,distance in graph[n]:
    candidate=value-MAX_GRADE*distance
    if candidate>values[other]+1e-9:values[other]=candidate;heapq.heappush(queue,(-candidate,other))
  for r in members.values():
   new=[round(values[nodes[(*xy(p),round(y,2))]],4) for p,y in zip(r['points'],r['elevations'])]
   # Keep the existing taut-envelope guarantee within a piece. This cannot
   # steepen a Lipschitz profile and leaves its shared endpoint heights fixed.
   if all(nodes[(*xy(p),round(y,2))] not in pins and len(refs[nodes[(*xy(p),round(y,2))]])==1 for p,y in zip(r['points'][1:-1],r['elevations'][1:-1])):
    from land_approaches import taut
    new=[round(y,4) for y in taut(stations(r['points']),new)]
   if any(abs(a-b)>.001 for a,b in zip(new,r['elevations'])):changes.append((r,new))
 return sorted(changes,key=lambda v:v[0]['id']),unresolved
