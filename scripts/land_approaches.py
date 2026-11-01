"""Level the land approaches that the per-segment deck profile leaves broken.

`build-metro.py` profiles each Boston GIS segment on its own: a node with a
positive source level sits 6.4 m above the raw DEM there, whatever stands at
that node. `scripts/water_crossings.py` repairs the chains that reach mapped
water; this module repairs three things on land, after it:

- **Seam stubs.** A single elevated piece whose lifted end is a node where a
  terrain-following road ends and continues the piece's bearing (the Brookline
  OSM ramps meeting the Boston GIS at the town line, Blue Hill Avenue's own
  continuation): the source level marks a culvert or a short span, not a 6.4 m
  structure, and the continuing street arrives at the graded ground, so the
  lifted node is brought to the ground there. The piece is re-profiled as a
  ramp from its pinned landing to that height, held just over the terrain
  between them (a Muddy River culvert keeps a small deck over the gully, Blue
  Hill Avenue keeps a level deck over its cut). A piece that then lies within
  `AT_GRADE` of the terrain everywhere was never a structure: it becomes a
  surface road (Huntington Avenue's first 15 m inside Boston, which climbed
  6.2 m to meet Washington Street arriving at 0.8 m). A terrain road passing
  through the node, two terrain roads continuing each other through it (a
  crossing the GIS split at the node) or any road crossing beneath the piece
  mark a real overpass, which is left alone.
- **Sunk approaches.** A ramp piece (one lifted end) whose straight profile
  runs more than `SINK` below the DEM embankment it climbs (the Jamaicaway
  carriageways sit up to 0.7 m under their own approach lawn) is held point by
  point over the terrain as `water_crossings` holds its ramps, keeping its
  landing and its deck junction; a deck piece (both ends lifted) is held
  `TERRAIN_RISE` over the terrain between its ends. The held profile is then
  pulled taut (`taut`: its upper concave envelope between the fixed ends), so
  the deck rises over an embankment and comes down once instead of copying
  every 3 m step of the DEM, and never dips toward either end.
- **A clipped town ramp.** Town ways end 4 m inside Boston (`build-metro.py`
  clips them to the town polygon minus a strip) and snap to a Boston segment
  end only within 10 m of the clipped point, so OSM way 48918271 ("Ramp-rt 9
  To Jamaicaway", two-way between Pond Avenue and the Jamaicaway) lost its
  last vertex, 6.9 m from the apex of the Boston loop ramp, and ended 24 m
  short of any road. `TOWN_LINKS` restores that vertex and snaps the end to
  the loop's shared node.

Water-crossing chains (levelled or skipped by `water_crossings`), pieces with
a dedicated builder and tunnels are never touched. The terrain is not changed:
the grader never grades under an elevated piece, so the corridor under a piece
that becomes a surface road keeps its DEM, which this module only accepts
within `AT_GRADE` of the piece. Estimated game profiles, not surveyed decks.
"""
import math
from collections import defaultdict
from shapely.geometry import LineString
from shapely.strtree import STRtree
from water_crossings import RAMP_RISE,RAMP_TAPER,TERRAIN_RISE,lifted,node_key,owned,ramp,smooth,stations,water_chains

CONTINUATION=.9
AT_GRADE=.2
SINK=.05
SNAP=10
TOWN_LINKS=[{'road':'osm-48918271-0','way':48918271,'tail':[[-3173.46,2145.56]],'join':'8686-0-0'}]


def cosine(p,a,b):
 """Cosine between the directions p->a and p->b (-1: b continues a straight through p)."""
 ax,az=a[0]-p[0],a[1]-p[1];bx,bz=b[0]-p[0],b[1]-p[1];n=math.hypot(ax,az)*math.hypot(bx,bz)
 return (ax*bx+az*bz)/n if n else 0


def crossed_beneath(road,others,lines,tree):
 """Any other road meeting the piece away from a vertex both share: something passes under it."""
 line=LineString(road['points'])
 for j in tree.query(line,predicate='intersects'):
  other=others[j]
  if other['id']==road['id']:continue
  hit=line.intersection(lines[j]);points=[hit] if hit.geom_type=='Point' else [g for g in getattr(hit,'geoms',[]) if g.geom_type=='Point']
  for q in points:
   p=[q.x,q.y]
   if any(math.dist(p,v)<.05 for v in road['points']) and any(math.dist(p,v)<.05 for v in other['points']):continue
   return True
 return False


def seam_stubs(roads,excluded=()):
 """Single-piece chains with one lifted end at which a terrain road ends and continues the piece, with nothing crossing beneath: (road, lifted index, continuing road ids)."""
 others=[r for r in roads if not r.get('tunnel')];lines=[LineString(r['points']) for r in others];tree=STRtree(lines);at=defaultdict(list)
 for r in others:
  if r.get('elevations'):continue
  for i,p in enumerate(r['points']):at[node_key(p)].append((r,i))
 found=[]
 for chain in water_chains(roads):
  if len(chain)!=1:continue
  road=chain[0];ends=[lifted(road,0),lifted(road,-1)]
  if road['id'] in excluded or owned(road) or ends[0]==ends[1]:continue
  index=0 if ends[0] else -1;p=road['points'][index];near=at.get(node_key(p))
  if not near or any(i not in (0,len(t['points'])-1) for t,i in near):continue
  leaving=[(t,t['points'][1 if i==0 else -2]) for t,i in near];inward=road['points'][1 if index==0 else -2]
  continuing=[t['id'] for t,q in leaving if cosine(p,inward,q)<=-CONTINUATION]
  if not continuing:continue
  if any(cosine(p,a,b)<=-CONTINUATION for k,(_,a) in enumerate(leaving) for _,b in leaving[k+1:]):continue
  if crossed_beneath(road,others,lines,tree):continue
  found.append((road,index,continuing))
 return found


def taut(along,ys):
 """The upper concave envelope of a profile between its fixed ends: the string stretched over the floored points, so a deck held over a rough embankment rises and falls once instead of copying every 3 m step of the DEM, and never dips."""
 hull=[]
 for i,(d,y) in enumerate(zip(along,ys)):
  while len(hull)>=2:
   a,b=hull[-2],hull[-1]
   if (along[b]-along[a])*(y-ys[a])-(ys[b]-ys[a])*(d-along[a])>=0:hull.pop()
   else:break
  hull.append(i)
 out=list(ys)
 for a,b in zip(hull,hull[1:]):
  for i in range(a+1,b):t=(along[i]-along[a])/((along[b]-along[a]) or 1);out[i]=max(ys[i],ys[a]+(ys[b]-ys[a])*t)
 return out


def grade_profile(road,ground,landing,low,top):
 """Smoothstep from the pinned landing at `low` to `top` at the other end, held over the terrain between them with the margin fading in from both ends, then pulled taut."""
 along=stations(road['points']);total=along[-1] or 1;other=len(along)-1 if landing==0 else 0;new=[]
 for i,(p,d) in enumerate(zip(road['points'],along)):
  share=smooth(abs(d-along[landing])/total);taper=min(1,abs(d-along[landing])/RAMP_TAPER,abs(d-along[other])/RAMP_TAPER);y=low+(top-low)*share
  if i not in (landing,other):y=max(y,ground(*p)+RAMP_RISE*taper)
  new.append(y)
 return [round(v,4) for v in taut(along,new)]


def floor_pieces(roads,ground,excluded=()):
 """Elevated pieces whose profile sinks more than `SINK` into the terrain between their fixed ends: (road, raised profile). A piece that never sinks keeps its profile, so a centimetre of DEM noise under a deck changes nothing."""
 changes=[]
 for road in roads:
  old=road.get('elevations');ends=[lifted(road,0),lifted(road,-1)]
  if not old or road.get('tunnel') or road['id'] in excluded or owned(road) or not any(ends):continue
  points=road['points'];last=len(points)-1
  if all(y-ground(*p)>=-SINK for i,(p,y) in enumerate(zip(points,old)) if i not in (0,last)):continue
  if all(ends):new=[y if i in (0,last) else max(y,ground(*p)+TERRAIN_RISE) for i,(p,y) in enumerate(zip(points,old))]
  else:
   landing,low,shares,taper=ramp(road);top_index=last if landing==0 else 0
   new=[y if i in (landing,top_index) else max(y,ground(*p)+RAMP_RISE*t) for i,(p,y,t) in enumerate(zip(points,old,taper))]
  new=[round(v,4) for v in taut(stations(points),new)]
  if any(abs(a-b)>.0001 for a,b in zip(old,new)):changes.append((road,new))
 return changes


def restore_links(roads,links=TOWN_LINKS):
 """Clipped town ramps whose declared tail reaches a Boston segment end: (road, end index, points to add, joined node)."""
 by={r['id']:r for r in roads};changes=[]
 for link in links:
  road=by.get(link['road']);join=by.get(link['join'])
  if road is None or join is None:raise ValueError(f"town link {link['road']} -> {link['join']}: road missing from the package")
  if road.get('elevations'):raise ValueError(f"town link {link['road']} must be a terrain road")
  tail=[list(p) for p in link['tail']];node=min((join['points'][0],join['points'][-1]),key=lambda q:math.dist(q,tail[-1]))
  if math.dist(node,tail[-1])>SNAP:raise ValueError(f"town link {link['road']}: tail ends {math.dist(node,tail[-1]):.1f} m from {link['join']}, beyond the {SNAP} m snap")
  if any(math.dist(road['points'][i],node)<.01 for i in (0,-1)):continue
  index=0 if math.dist(road['points'][0],tail[0])<=math.dist(road['points'][-1],tail[0]) else -1
  changes.append((road,index,[list(node)]+tail[::-1] if index==0 else tail+[list(node)],list(node)))
 return changes


def level_land_approaches(roads,ground,excluded=(),links=TOWN_LINKS,apply=True):
 """Repair the seam stubs, sunk approaches and clipped town ramps among `roads`. `ground(x,z)` is the graded terrain; `excluded` holds the water-crossing chain ids. Returns a report; with apply=False nothing is changed."""
 report={'seams':[],'floored':[],'links':[],'changedRoads':[]};excluded=set(excluded)
 for road,index,continuing in seam_stubs(roads,excluded):
  landing=-1 if index==0 else 0;low=road['elevations'][landing];top=ground(*road['points'][index])
  new=grade_profile(road,ground,landing,low,top);surface=all(abs(y-ground(*p))<=AT_GRADE for p,y in zip(road['points'],new))
  report['seams'].append({'road':road['id'],'name':road['name'],'continues':sorted(continuing),'nodeHeight':round(top,4),'lowered':round(road['elevations'][index]-top,4),'surface':surface});report['changedRoads'].append(road['id']);excluded.add(road['id'])
  if not apply:continue
  if surface:
   for key in ('elevations','bridge','startLevel','endLevel'):road.pop(key,None)
  else:road['elevations']=new;road['startLevel' if index==0 else 'endLevel']=0
 for road,new in floor_pieces(roads,ground,excluded):
  report['floored'].append({'road':road['id'],'name':road['name'],'raised':round(max(b-a for a,b in zip(road['elevations'],new)),4)});report['changedRoads'].append(road['id'])
  if apply:road['elevations']=new
 for road,index,addition,node in restore_links(roads,links):
  report['links'].append({'road':road['id'],'name':road['name'],'node':node,'added':len(addition)});report['changedRoads'].append(road['id'])
  if apply:road['points']=addition+road['points'] if index==0 else road['points']+addition
 report['changedRoads']=sorted(set(report['changedRoads']))
 return report


def water_chain_ids(report):
 """Road ids of every chain the water-crossing step levelled or deliberately skipped."""
 return {id for chain in report['chains']+report['skipped'] for id in chain['roads']}
