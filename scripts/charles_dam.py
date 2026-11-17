"""Charles River Dam Road as one graded street on the dam.

Between Leverett Circle and the Cambridge line the road runs on the crest of
the 1910 Charles River Dam, an earth dam: two carriageways between surveyed
curbs and sidewalks, the Museum of Science on the upstream side, the Lechmere
Viaduct on the downstream side, and one short bridge, the Craigie Drawbridge,
over the old lock. Boston's segments give most of it a positive level, and
`build-metro.py` reads a level as a structure: five of the eight pieces became
decks of their class width, each profiled on its own over the bare-earth
survey. The survey has the dam's crest as ground and the lock as a 20 m gap,
so the water stage then held those decks point by point 5 cm over ground that
no street corridor had graded. What stood there was a patchwork: west of the
Museum's driveway the Cambridge-bound deck lay on the other carriageway's
measured asphalt, up to 0.58 m proud of it at its edges; east of it both
carriageways were 10 m decks, 0.4 m apart in height, with the raw survey
between and beside them; and the deck from Leverett Circle began with 0.46 m
of rise in 3 m.

A dam is not a bridge. The stage makes every piece a surface street and gives
the crest one ground:

* **One profile.** Stations every 3 m along the Cambridge-bound line, from
  Leverett Circle to the vertex in Cambridge where the two carriageways have
  become one street. The ground at a station is the higher of the graded
  ground under the two lines (the crest, not the bank the outer line runs
  along). A station more than `GAP` under the highest ground within `REACH`
  on both sides is no crest but an opening in it (the lock) and takes the line
  between its neighbours. The profile is that ground smoothed (`PASSES`
  binomial passes, its two ends held), so the road carries no step of the
  6 m survey lattice.
* **One cross-section.** Every grid vertex of every cell the crest passes
  over takes the profile's height at its own station: the two roadways, the
  median and both sidewalks lie on one level across the road (`ROADSIDE`
  about the Boston-bound line, `DOWNSTREAM` about the other, whose sidewalk
  is the narrower). The change fades in over `TAPER` from each end, where
  the streets beyond keep their ground. The lock is filled under the road,
  as the drawbridge's deck covers it. Nothing is filled under the Lechmere
  Viaduct downstream of the road: a first version raised that strip too,
  and from the river the arches stood half buried in a lawn 10 to 15 m wide.
* **A shoulder on land.** Beyond those cells (a grid cell from the crest) the
  ground comes back to what it was over `SHOULDER`, and not at all in mapped
  water, where the crest ends in a wall. A street beside the crest is raised a whole cross-section at a
  time: each of its vertices takes the share and the station of the nearest
  point of its own centre line, so the Museum's drive rises to the junction
  level across and is not tilted toward the dam. Ground beyond the crest's
  own cells is only raised, never cut: the Museum's lawn keeps its height.
* **Streets.** The deck pieces lose their profile, structure, levels and deck
  widths, so the street-surface stage measures them between the surveyed
  curbs like any street, and their lines lose the stations a deck profile
  added every 3 m (`source_vertices`: the ends, every vertex another road
  shares and the bends stay), since lane paint, traffic and crosswalks read a
  street by its segments. Boston's segments name the road "Charles River"
  east of the Museum's driveway and "Monsignor O'Brien Highway" west of it,
  and the Museum's access "Science" (the type words "Dam" and "Park" are
  dropped upstream); the road is Charles River Dam Road from Leverett Circle
  to the Cambridge line, where OpenStreetMap carries the name on, and the
  access is Science Park.

Run before `level-water-crossings.py`, which then no longer finds a water
crossing here. Estimated game ground, not a survey of the dam. What the stage
decides about each road (name, line, deck fields) and every grid vertex are
recorded as they stood, and a rerun restores them first; fields a later stage
added to a road, such as its measured width, are left on it.
"""
import copy,gzip,math
import numpy as np
from shapely.geometry import LineString,Point,Polygon,box
from shapely.ops import unary_union
from shapely.prepared import prep
from water_crossings import grid_sampler

# Both carriageways in travel order, and the two-way piece that carries them on in Cambridge.
NORTHBOUND=['10963-0-0','7515-0-0','10965-0-0','14555-0-0']
SOUTHBOUND=['14556-0-0','10964-0-0','10961-0-0','10962-0-0']
CONTINUATION='museum-dam-north-connection'
LINK='museum-dam-south-connection'
NAME='Charles River Dam Road'
NAMES={'Science':'Science Park'}
RENAMED=['8427-0-0','8477-0-0','14681-0-0']
OWN=set(NORTHBOUND+SOUTHBOUND+[CONTINUATION,LINK])
DECK_FIELDS=('elevations','bridge','startLevel','endLevel','deckWidths','deckTangents')
STEP=3.0
GAP=.75
REACH=30.0
PASSES=24
TAPER=18.0
STRAIGHT=.03
ROADSIDE=12.0
DOWNSTREAM=10.5
SHOULDER=12.0
WALK=2.9
GRADE=.06
BEND=.012
LEVEL=.05
OWNED=('name','points')+DECK_FIELDS
NOTE=' Charles River Dam crest levelled under its road by build-charles-dam.py.'
METHOD=('The dam road is a surface street on one graded crest: stations every 3 m along the Cambridge-bound line take the higher graded ground of the two carriageway lines, '
 'an opening more than 0.75 m under the crest within 30 m on both sides (the lock) takes the line between its neighbours, and the result is smoothed with its ends held; '
 'every grid vertex of every cell under the roadways, the median and the sidewalks takes the profile height at its station, fading in over 18 m from each end, '
 'with a 12 m shoulder on land in which a neighbouring street is raised level across, and none in mapped water. '
 'The five deck pieces lose their profiles and structures. Estimated game ground, not surveyed.')


def smooth(t):t=max(0.,min(1.,t));return t*t*(3-2*t)


def applies(roads):
 """Whether a package carries the dam road (the legacy central package does not)."""
 ids={r['id'] for r in roads};return all(i in ids for i in NORTHBOUND+SOUTHBOUND+[CONTINUATION])


def chain(by_id,ids):
 """One polyline through the pieces, which must meet end to end."""
 points=[]
 for road_id in ids:
  piece=by_id[road_id]['points']
  assert not points or math.dist(points[-1],piece[0])<.01,f'{road_id} does not carry the dam road on'
  points+=piece if not points else piece[1:]
 return points


def lines(roads):
 by_id={}
 for road in roads:
  if road['id'] in NORTHBOUND+SOUTHBOUND+[CONTINUATION]:assert road['id'] not in by_id,f"two records share {road['id']}";by_id[road['id']]=road
 north=chain(by_id,NORTHBOUND+[CONTINUATION]);south=chain(by_id,SOUTHBOUND)
 return LineString(north),LineString(south),LineString(chain(by_id,NORTHBOUND))


def crest_profile(axis,twin,ground,twin_reach):
 """Heights every STEP along `axis`: the crest's ground with its openings bridged, smoothed between held ends.
 Beyond `twin_reach` the axis is the only line."""
 count=max(2,math.ceil(axis.length/STEP));stations=[axis.length*i/count for i in range(count+1)];raw=[]
 for s in stations:
  p=axis.interpolate(s);height=ground(p.x,p.y)
  if s<=twin_reach:q=twin.interpolate(twin.project(p));height=max(height,ground(q.x,q.y))
  raw.append(height)
 window=max(1,round(REACH/(axis.length/count)));filled=list(raw);opening=[]
 for i,height in enumerate(raw):
  before=max(raw[max(0,i-window):i+1]);after=max(raw[i:i+window+1]);opening.append(height<min(before,after)-GAP)
 i=0
 while i<len(raw):
  if not opening[i]:i+=1;continue
  j=i
  while j<len(raw) and opening[j]:j+=1
  a,b=i-1,j
  for k in range(i,j):filled[k]=raw[a]+(raw[b]-raw[a])*(k-a)/(b-a)
  i=j
 heights=list(filled)
 for _ in range(PASSES):heights=[heights[0]]+[(heights[k-1]+2*heights[k]+heights[k+1])/4 for k in range(1,len(heights)-1)]+[heights[-1]]
 return stations,heights,[stations[k] for k in range(len(raw)) if opening[k]]


def height_at(stations,heights,s):
 step=stations[1]-stations[0];k=min(len(stations)-2,max(0,int(s/step)));t=min(1.,max(0.,(s-stations[k])/step))
 return heights[k]+(heights[k+1]-heights[k])*t


def crest_area(north,south):
 """The ground the dam carries: both roadways, the median and both sidewalks. Travel on the first line is toward
 Cambridge and z runs south, so its downstream side (north-east) is its right; the second line runs the other way."""
 return unary_union([north.buffer(DOWNSTREAM,cap_style='flat'),south.buffer(ROADSIDE,cap_style='flat')])


def neighbours(roads,area,cell):
 """Surface streets beside the crest, not the dam road's own: (line, reach). The reach takes in every vertex of the cells
 the street and its sidewalk pass over, so the whole cross-section moves together."""
 reach=area.buffer(SHOULDER+2*WALK+20);out=[]
 for road in roads:
  if road['id'] in OWN or road.get('elevations') or road.get('tunnel'):continue
  line=LineString(road['points'])
  if line.intersects(reach):out.append((line,road['width']/2+WALK+cell))
 return out


def vertex(p):return (round(p[0]*100),round(p[1]*100))


def source_vertices(points,shared=(),tolerance=STRAIGHT):
 """The line without the stations a deck profile added: its ends, every vertex another road has too, and the bends
 (a vertex further than `tolerance` from the chord between the two kept on either side of it)."""
 keep={0,len(points)-1}|{i for i,p in enumerate(points) if vertex(p) in shared}
 def bends(a,b):
  if b-a<2:return
  chord=LineString([points[a],points[b]]);far=max(range(a+1,b),key=lambda i:chord.distance(Point(points[i])))
  if chord.distance(Point(points[far]))>tolerance:keep.add(far);bends(a,far);bends(far,b)
 marks=sorted(keep)
 for a,b in zip(marks,marks[1:]):bends(a,b)
 return [points[i] for i in sorted(keep)]


def owned(road):
 """What this stage decides about a road, as it stood before: its name, its line and whatever made it a deck."""
 return {'id':road['id'],**{f:copy.deepcopy(road[f]) for f in OWNED if f in road}}


def restore(roads,heights,record):
 """Put back what a previous run changed: the stage's own fields of each road (`roads` is edited in place) and the grid
 vertices. A field a later stage added, such as the width the surface stage measured, stays on the road: a rerun on a
 finished package must not strip it."""
 if not record:return
 sources={r['id']:r for r in record['roads']['sources']}
 for road in roads:
  source=sources.get(road['id'])
  if not source:continue
  for f in OWNED:
   if f in source:road[f]=copy.deepcopy(source[f])
   else:road.pop(f,None)
 terrain=record['terrain']
 if terrain['vertices']:heights[np.asarray(terrain['vertices'],dtype=np.int64)]=np.asarray(terrain['heights'],dtype=heights.dtype)


def build(roads,grid,heights,water=()):
 """Return (record, graded int16 grid, roads). `heights` is the int16 graded grid, `water` the mapped water polygons; `roads` are not edited."""
 scale=grid.get('scale',.01);cell=grid['cellSize'];width=grid['width'];ground=grid_sampler(grid,heights*scale)
 north,south,carriageway=lines(roads);stations,profile,openings=crest_profile(north,south,ground,carriageway.length)
 area=crest_area(north,south);inside=prep(area);reach=area.buffer(SHOULDER+cell*1.5);x0,z0,x1,z1=reach.bounds;ring=set();candidates=set()
 wet=prep(unary_union([w for w in water if w.intersects(reach)]));streets=neighbours(roads,area,cell)
 for j in range(math.floor((z0-grid['originZ'])/cell),math.floor((z1-grid['originZ'])/cell)+1):
  for i in range(math.floor((x0-grid['originX'])/cell),math.floor((x1-grid['originX'])/cell)+1):
   x=grid['originX']+i*cell;z=grid['originZ']+j*cell;corners=(j*width+i,j*width+i+1,(j+1)*width+i,(j+1)*width+i+1);candidates.update(corners)
   if inside.intersects(box(x,z,x+cell,z+cell)):ring.update(corners)
 result=heights.copy();vertices=[];originals=[];cut=fill=0.;raised=0
 for index in sorted(candidates):
  point=Point(grid['originX']+(index%width)*cell,grid['originZ']+(index//width)*cell);ref=point;lateral=1.
  if index not in ring:
   # A street beside the crest is raised a whole cross-section at a time: each of its vertices takes
   # the share and the station of the nearest point of its centre line, so it stays level across.
   beside=min(((line.distance(point),k) for k,(line,half) in enumerate(streets) if line.distance(point)<=half),default=None)
   if beside:line=streets[beside[1]][0];ref=line.interpolate(line.project(point))
   lateral=0. if not beside and wet.covers(point) else smooth(1-max(0.,area.distance(ref)-cell)/SHOULDER)
   raised+=bool(beside and lateral)
  s=north.project(ref);weight=lateral*smooth(min(s,north.length-s)/TAPER)
  old=float(heights[index])*scale;new=int(round((old+(height_at(stations,profile,s)-old)*weight)/scale))
  # Beyond the crest's own cells the ground is only ever raised to it: a lawn or a forecourt standing over the road keeps its height.
  if new==int(heights[index]) or (index not in ring and new<int(heights[index])):continue
  vertices.append(int(index));originals.append(int(heights[index]));result[index]=new
  cut=max(cut,old-new*scale);fill=max(fill,new*scale-old)
 touched=set(NORTHBOUND+SOUTHBOUND+RENAMED);sources=[];out=[]
 shared={vertex(p) for road in roads if road['id'] not in touched and LineString(road['points']).intersects(reach) for p in road['points']}
 for road in roads:
  if road['id'] not in touched:out.append(road);continue
  changed={k:v for k,v in road.items() if k not in DECK_FIELDS} if road['id'] not in RENAMED else dict(road)
  changed['name']=NAME if road['id'] not in RENAMED else NAMES.get(road['name'],road['name'])
  # A deck's line carries a station every 3 m for its profile. A street's has its source vertices: lane paint, traffic and crosswalks read segments.
  if 'elevations' in road:changed['points']=source_vertices(road['points'],shared)
  if changed!=road:sources.append(owned(road))
  out.append(changed)
 step=stations[1]-stations[0];grades=[abs(b-a)/step for a,b in zip(profile,profile[1:])]
 record={'method':METHOD,'roads':{'northbound':NORTHBOUND,'southbound':SOUTHBOUND,'continuation':CONTINUATION,'sources':sources},
  'profile':{'stepMeters':round(step,4),'heights':[round(h,4) for h in profile],'openings':[round(s,2) for s in openings]},
  'terrain':{'vertices':vertices,'heights':originals,'streetVertices':raised},'lengthMeters':round(north.length,2),'crestMeters':[round(min(profile),4),round(max(profile),4)],
  'steepestGrade':round(max(grades),4),'maxCutMeters':round(cut,4),'maxFillMeters':round(fill,4),'heightAccuracy':'Estimated game ground, not a survey of the dam'}
 return record,result,out


def load_grid(path):return np.frombuffer(gzip.decompress(path.read_bytes()),dtype='<i2').copy()


def check(roads,grid,heights,record):
 """What must hold on a package this stage built: every piece a surface street, a gentle profile, and one level across the crest."""
 by_id={r['id']:r for r in roads};scale=grid.get('scale',.01);ground=grid_sampler(grid,np.asarray(heights)*scale)
 for road_id in NORTHBOUND+SOUTHBOUND:
  road=by_id[road_id];assert not any(k in road for k in DECK_FIELDS),f'{road_id} still carries a deck on the dam'
 north,south,carriageway=lines(roads);step=record['profile']['stepMeters'];profile=record['profile']['heights'];along=[step*i for i in range(len(profile))]
 steepest=max(abs(b-a)/step for a,b in zip(profile,profile[1:]));assert steepest<=GRADE,f'the dam road climbs at {steepest*100:.1f}%'
 bend=max(abs(a-2*b+c)/step for a,b,c in zip(profile,profile[1:],profile[2:]));assert bend<=BEND,f'the dam road changes grade by {bend*100:.2f}% in {step:g} m'
 worst=0.;count=0;s=TAPER
 while s<=north.length-TAPER:
  p=north.interpolate(s);a=north.interpolate(s-.5);b=north.interpolate(s+.5);nx,nz=-(b.y-a.y),b.x-a.x;twin=s<=carriageway.length
  offset=-(ROADSIDE-1)-p.distance(south) if twin else -(DOWNSTREAM-1);end=DOWNSTREAM-1
  while offset<=end:
   # Held against the profile at the point's own station: the profile's change along a skewed section is no step across the road.
   q=(p.x+nx*offset,p.y+nz*offset);worst=max(worst,abs(ground(*q)-height_at(along,profile,north.project(Point(q)))));count+=1;offset+=1.5
  s+=step
 assert worst<=LEVEL,f'the dam crest is {worst:.2f} m off its profile across the road'
 return {'pieces':len(NORTHBOUND+SOUTHBOUND),'meters':record['lengthMeters'],'stations':count,'steepest':round(steepest,4),'crest':record['crestMeters'],'vertices':len(record['terrain']['vertices']),'offLevel':round(worst,3)}


def replay(roads,grid,heights,record,water=()):
 """Rerun the stage from its recorded originals; True when it rewrites the roads, grid and record it was given.
 Later stages add fields to a street (its measured width), so the roads are compared by what this stage decides."""
 again_roads=copy.deepcopy(roads);again_heights=np.asarray(heights).copy();restore(again_roads,again_heights,record)
 again,result,out=build(again_roads,grid,again_heights,water);touched=set(NORTHBOUND+SOUTHBOUND+RENAMED)
 same=[r['id'] for r in out]==[r['id'] for r in roads] and all(a.get(f)==b.get(f) for a,b in zip(out,roads) if a['id'] in touched for f in OWNED)
 return same and np.array_equal(result,heights) and all(again[k]==record.get(k) for k in again)
