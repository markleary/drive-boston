"""Northern grade separations whose source decks close on the road beneath.

build-metro.py profiles a town bridge over a road from the DEM at its two ends:
OpenStreetMap's layer orders a crossing but gives no height, so a deck between
two at-grade landings starts and ends on the ground. Three crossings in the
northern towns come out of that with no room beneath, and
road_structure_clearance.py fails them:

- Sweetser Circle, Everett: four bridge pieces carry Broadway and the circle
  over the Revere Beach Parkway, which dips under the circle. The survey keeps
  the dip only 2 to 3 m deep (a 6 m DEM smooths a cut walled in at street
  width) and street grading then filled it back toward the circle's level.
  The bridges also land only 7 to 10 m from the parkway centerlines: each
  one-way carriageway carries the 30.2 m right-of-way MassGIS recorded for the
  whole divided road as its OSM width (16 m after the class cap), so the decks
  end inside the modelled pavement.
- Mystic Valley Parkway over Main Street, Medford: grading lifted the divided
  Main Street 3 m under the two parkway bridges.
- Florence Street over Dartmouth Street, Malden: the divided Florence Street
  crosses a 5 m valley on two bridge pieces that end on the valley slopes, so
  the decks sagged into the valley and the approaches dove after them.

Two repairs, both on the graded grid (the raw survey grid is untouched):

- trench: the lower road is cut to CLEARANCE under each deck bottom, level for
  half the deck width plus FLAT along it, then rising at RAMP along the street
  network (side streets and ramps meeting it inside the cut descend at the same
  grade) until it rejoins the graded street; beyond each lowered street's
  corridor the cut climbs at WALL. The carve is the lower envelope of those
  prisms. Every other street keeps its corridor, so a deck end whose street
  corridor would reach the trench floor is carried on: the streets meeting it
  become deck pieces (bridge kind APPROACH, at their graded heights) up to the
  first station past the floor, splitting a street there, or taking all of a
  short one and walking on from its far end.
- embankment: the upper street keeps the level of the valley rims. The highest
  surveyed point within REACH of each deck end along its approach is the rim;
  the graded heights there are joined by a straight grade, the deck takes it,
  and the approach corridors are filled to it with WALL side slopes, the fill
  running ABUTMENT metres past each deck end so the landing meets the deck.
  The decks take bridge kind DECK, so the land-approach, water-crossing and
  connected-profile stages, which run earlier and are replayed against the
  finished package, leave the profile this step set (water_crossings.owned).

The land-approach stage leaves every site's upper decks as build-metro.py and
the water stage left them (land_approaches.level_land_approaches), so a trench
is cut under the same profile the replay later sees.

Buildings, the lower road under an embankment and the other street corridors
around a trench keep their heights. Every changed grid vertex, deck profile and
street is recorded with its original, so a rerun restores them and redoes the
same repair (validate-city.py replays it). Corridors use the class width, not
the paved width build-street-surfaces.py measures later, so the replay sees
the inputs of the first run. Heights are game estimates, not surveyed
structures."""
import copy,gzip,heapq,json,math,struct
from collections import defaultdict
import numpy as np
import shapely
from shapely.geometry import LineString,Polygon
from road_connections import resample
from road_structure_clearance import MIN_CLEARANCE,crossing_points,road_height
from water_crossings import grid_sampler

CLEARANCE=4.3   # design clearance of a repaired underpass (14 ft)
RAMP=.06        # grade of a cut lower street
WALL=.7         # rise per metre of a cut or fill beyond the street corridor
WALK=2.9        # sidewalk allowance on each side of the pavement, as the grader's corridor
FLAT=4          # level trench beyond half the deck width
REACH=48        # how far along an approach an embankment looks for the valley rim
ABUTMENT=7      # fill carried past a deck end under its landing
NETWORK=260     # ground streets this close to a crossing carry the trench ramps
WINDOW=180      # vertices this close to a crossing may be cut
BUILDING=1.0    # footprint margin kept clear of cuts and fills
STEP=.5         # station spacing of the deck-extension walk
TAIL=3          # a street remainder shorter than this joins its deck piece
PIECE=4         # shortest deck piece the walk cuts from a street
EXTEND=60       # longest stretch of a street the walk may carry on a deck
APPROACH='north-overpass-approach'
DECK='north-overpass-deck'  # bridge kind of a valley deck the embankment carries at the rim grade
SITES=[
 {'id':'sweetser-circle','name':'Sweetser Circle over the Revere Beach Parkway, Everett','mode':'trench',
  'upper':['osm-9080000-0','osm-9080041-0','osm-9080044-0','osm-9080740-0'],'lower':['osm-50526412-0','osm-641810692-0']},
 {'id':'mystic-valley-parkway-main-street','name':'Mystic Valley Parkway over Main Street, Medford','mode':'trench',
  'upper':['osm-80989693-0','osm-80989702-0'],'lower':['osm-1312361207-0','osm-94328279-0']},
 {'id':'florence-street-dartmouth-street','name':'Florence Street over Dartmouth Street, Malden','mode':'embankment',
  'upper':['osm-80482630-0','osm-80482632-0'],'lower':['osm-80493578-0','osm-1263554461-0']},
]
METHOD=('Lower streets cut to the design clearance under source decks (level beneath the deck, ramping along the street network, walled beyond the corridor), '
 'other street corridors kept and deck ends carried over the trench edge on approach pieces; valley-crossing streets carried at the rim level on decks and filled approaches; '
 'buildings and lower roads under fills fixed; original vertices, deck profiles and streets recorded for replay')
FIELDS=('name','points','width','oneway','kind','elevations','startLevel','endLevel','bridge')


def half_width(road):return road['width']/2+WALK
def node(p):return (round(p[0]*100),round(p[1]*100))
def box(points,margin):
 xs=[p[0] for p in points];zs=[p[1] for p in points];return (min(xs)-margin,min(zs)-margin,max(xs)+margin,max(zs)+margin)


class Window:
 """The grid vertices of a box: flat indices and world positions."""
 def __init__(self,grid,bounds):
  cell=grid['cellSize'];ox,oz=grid['originX'],grid['originZ']
  i0=max(0,math.floor((bounds[0]-ox)/cell));i1=min(grid['width']-1,math.ceil((bounds[2]-ox)/cell))
  j0=max(0,math.floor((bounds[1]-oz)/cell));j1=min(grid['height']-1,math.ceil((bounds[3]-oz)/cell))
  I,J=np.meshgrid(np.arange(i0,i1+1),np.arange(j0,j1+1));self.bounds=bounds
  self.index=(J*grid['width']+I).ravel();self.x=(ox+I*cell).ravel().astype(np.float64);self.z=(oz+J*cell).ravel().astype(np.float64)
 def project(self,a,b):
  """Unclamped and clamped segment parameter, and distance, of every vertex from segment ab."""
  dx,dz=b[0]-a[0],b[1]-a[1];raw=((self.x-a[0])*dx+(self.z-a[1])*dz)/(dx*dx+dz*dz or 1e-12);t=np.clip(raw,0,1)
  return raw,t,np.hypot(self.x-a[0]-dx*t,self.z-a[1]-dz*t)
 def near(self,a,b,margin):
  return min(a[0],b[0])-margin<=self.bounds[2] and max(a[0],b[0])+margin>=self.bounds[0] and min(a[1],b[1])-margin<=self.bounds[3] and max(a[1],b[1])+margin>=self.bounds[1]
 def contains(self,p):return self.bounds[0]<=p[0]<=self.bounds[2] and self.bounds[1]<=p[1]<=self.bounds[3]


def corridor(win,roads):
 inside=np.zeros(win.x.shape,bool)
 for road in roads:
  half=half_width(road)
  for a,b in zip(road['points'],road['points'][1:]):
   if win.near(a,b,half):inside|=win.project(a,b)[2]<half
 return inside


def footprint_mask(win,footprints):
 inside=np.zeros(win.x.shape,bool)
 for footprint in footprints:
  shape=Polygon(footprint).buffer(BUILDING);x0,z0,x1,z1=shape.bounds
  if x1<win.bounds[0] or x0>win.bounds[2] or z1<win.bounds[1] or z0>win.bounds[3]:continue
  inside|=shapely.contains_xy(shape,win.x,win.z)
 return inside


def dijkstra(graph,seeds):
 dist=dict(seeds);heap=[(d,k) for k,d in seeds.items()];heapq.heapify(heap)
 while heap:
  d,k=heapq.heappop(heap)
  if d>dist.get(k,math.inf):continue
  for n,w in graph.get(k,()):
   if d+w<dist.get(n,math.inf):dist[n]=d+w;heapq.heappush(heap,(d+w,n))
 return dist


def section(grid,p,tangent,half):
 """Flat indices of the grid cells under a street cross-section of half-width `half` at p."""
 cell=grid['cellSize'];width=grid['width'];nx,nz=-tangent[1],tangent[0];out=set()
 for o in np.linspace(-half,half,max(2,math.ceil(2*half/(cell/3))+1)).tolist():
  i=math.floor((p[0]+nx*o-grid['originX'])/cell);j=math.floor((p[1]+nz*o-grid['originZ'])/cell)
  out.update((j+b)*width+i+a for a in (0,1) for b in (0,1))
 return out


def covered(grid,win,roads,centerline=False):
 """Window mask of every vertex of the cells the corridors (or centerlines) of `roads` pass over."""
 cells=set();step=grid['cellSize']/3
 for road in roads:
  half=0 if centerline else half_width(road)
  for a,b in zip(road['points'],road['points'][1:]):
   length=math.dist(a,b)
   if length<1e-9 or not win.near(a,b,half+grid['cellSize']):continue
   tangent=((b[0]-a[0])/length,(b[1]-a[1])/length);n=max(1,math.ceil(length/step))
   for j in range(n+1):cells|=section(grid,(a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n),tangent,half)
 return np.isin(win.index,np.fromiter(cells,dtype=np.int64,count=len(cells)))


def walk(line,grid,floor,half):
 """(station, whether the street corridor there meets the trench floor) every STEP metres along `line`, and its length."""
 out=[];total=0;tangent=(1.0,0.0)
 for a,b in zip(line,line[1:]):
  length=math.dist(a,b)
  if length<1e-9:continue
  tangent=((b[0]-a[0])/length,(b[1]-a[1])/length);n=max(1,math.ceil(length/STEP))
  for j in range(n):
   s=j/n;out.append((total+s*length,not floor.isdisjoint(section(grid,(a[0]+(b[0]-a[0])*s,a[1]+(b[1]-a[1])*s),tangent,half))))
  total+=length
 out.append((total,not floor.isdisjoint(section(grid,line[-1],tangent,half))))
 return out,total


def split_line(line,distance):
 """`line` split `distance` metres along it: (head, tail), sharing the split point."""
 total=0
 for k,(a,b) in enumerate(zip(line,line[1:])):
  length=math.dist(a,b)
  if total+length>=distance and length>0:
   t=(distance-total)/length;p=[round(a[0]+(b[0]-a[0])*t,3),round(a[1]+(b[1]-a[1])*t,3)]
   head=[list(q) for q in line[:k+1] if math.dist(q,p)>.01]+[p];tail=[p]+[list(q) for q in line[k+1:] if math.dist(q,p)>.01]
   return head,tail
  total+=length
 raise ValueError('split point beyond the street')


def deck_piece(road,points,piece_id,ground,joints):
 """A deck copy of a street stretch at its graded heights; a point shared with another deck end takes that deck's height."""
 # Resampling rounds its stations; the two ends keep the exact junction coordinates.
 line=points;points=resample(line);points[0]=list(line[0]);points[-1]=list(line[-1]);ends=[node(points[0]) in joints,node(points[-1]) in joints]
 piece={k:copy.deepcopy(v) for k,v in road.items() if k not in ('pavedWidth','deckEdgeElevations','deckWidths','deckTangents')}
 piece.update(id=piece_id,points=points,elevations=[round(joints.get(node(p),ground(*p)),4) for p in points],startLevel=int(ends[0]),endLevel=int(ends[1]),
  bridge={'id':f'north-overpass-{piece_id}','thickness':.75,'clearanceEstimated':True,'kind':APPROACH})
 return piece


def extend_decks(site,roads,grid,floor,ground,lowered):
 """Carry the site decks over the trench edge (see the module notes).
 Returns ({street id: replacement roads}, ids of the new pieces, ids of streets taken whole)."""
 by_id={r['id']:r for r in roads};ends=defaultdict(list);joints={}
 for r in roads:
  for e in (0,-1):
   ends[node(r['points'][e])].append((r['id'],e))
   if r.get('elevations'):joints.setdefault(node(r['points'][e]),r['elevations'][e])
 for deck_id in site['upper']:
  for e in (0,-1):joints[node(by_id[deck_id]['points'][e])]=by_id[deck_id]['elevations'][e]
 queue=[node(by_id[d]['points'][e]) for d in site['upper'] for e in (0,-1)];seen=set();walked=set();replaced={};added=[];whole=[]
 while queue:
  key=queue.pop(0)
  if key in seen:continue
  seen.add(key)
  for road_id,e in sorted(ends[key]):
   road=by_id[road_id]
   if road_id in walked or road.get('elevations') or road.get('tunnel'):continue
   walked.add(road_id);line=road['points'] if e==0 else road['points'][::-1];samples,total=walk(line,grid,floor,half_width(road))
   last=max((s for s,hit in samples if hit),default=None)
   if last is None:continue
   assert road_id not in lowered,f"{site['id']}: a deck lands on {road_id}, which the trench lowers"
   assert last<=EXTEND,f"{site['id']}: {road_id} still meets the trench floor {last:.0f} m from the deck end"
   assert not road.get('sourceSeam') and not road.get('sourcePoints'),f"{site['id']}: {road_id} carries source records a deck piece would lose"
   split=max(last+STEP,PIECE)
   if total-split<TAIL:
    piece=deck_piece(road,road['points'],road_id,ground,joints);replaced[road_id]=[piece];whole.append(road_id)
    if samples[-1][1]:queue.append(node(line[-1]))
   else:
    head,tail=split_line(line,split);piece_id=f'{road_id}-deck'
    piece=deck_piece(road,head if e==0 else head[::-1],piece_id,ground,joints);rest={**copy.deepcopy(road),'points':tail if e==0 else tail[::-1]}
    replaced[road_id]=[piece,rest] if e==0 else [rest,piece];added.append(piece_id)
   for k in (0,-1):joints.setdefault(node(piece['points'][k]),piece['elevations'][k])
 return replaced,added,whole


def trench(site,roads,by_id,grid,ground,footprints):
 """The cut of a site: changed vertex indices, their new heights, a report, the
 street replacements carrying its decks over the trench edge and the streets
 whose corridors it keeps (with the window they were kept in)."""
 uppers=[by_id[i] for i in site['upper']];lowers=[by_id[i] for i in site['lower']];crossings=[]
 for upper in uppers:
  for lower in lowers:
   for p in crossing_points(LineString(upper['points']).intersection(LineString(lower['points']))):
    q=[p.x,p.y];bottom=road_height(upper,q,ground)-upper['bridge'].get('thickness',.75)
    crossings.append({'upper':upper['id'],'lower':lower['id'],'point':q,'deckBottom':bottom,'floor':bottom-CLEARANCE,'flat':upper['width']/2+FLAT})
 assert crossings,f"{site['id']}: the decks no longer cross the lower streets"
 network=[r for r in roads if not r.get('elevations') and not r.get('tunnel') and any(math.dist(p,c['point'])<NETWORK for c in crossings for p in r['points'])]
 graph={}
 for road in network:
  for a,b in zip(road['points'],road['points'][1:]):w=math.dist(a,b);graph.setdefault(node(a),[]).append((node(b),w));graph.setdefault(node(b),[]).append((node(a),w))
 for c in crossings:
  points=by_id[c['lower']]['points'];best=None
  for k,(a,b) in enumerate(zip(points,points[1:])):
   dx,dz=b[0]-a[0],b[1]-a[1];t=max(0,min(1,((c['point'][0]-a[0])*dx+(c['point'][1]-a[1])*dz)/(dx*dx+dz*dz or 1e-12)));d=math.hypot(c['point'][0]-a[0]-dx*t,c['point'][1]-a[1]-dz*t)
   if best is None or d<best[0]:best=(d,k,t)
  _,k,t=best;length=math.dist(points[k],points[k+1]);c['segment']=(c['lower'],k,t);c['dist']=dijkstra(graph,{node(points[k]):t*length,node(points[k+1]):(1-t)*length})
 def target(p):return min(c['floor']+RAMP*max(0,c['dist'].get(node(p),math.inf)-c['flat']) for c in crossings)
 win=Window(grid,box([c['point'] for c in crossings],WINDOW));heights=ground.values[win.index];top=float(heights.max())
 buildings=footprint_mask(win,footprints(win.bounds));prisms={}
 def prism(road):
  """The carve one lowered street contributes: its ramp targets, walled beyond its corridor."""
  if road['id'] in prisms:return prisms[road['id']]
  half=half_width(road);envelope=np.full(win.x.shape,np.inf)
  for k,(a,b) in enumerate(zip(road['points'],road['points'][1:])):
   if not win.near(a,b,half+30):continue
   length=math.dist(a,b);reach=[]
   for c in crossings:
    da=c['dist'].get(node(a),math.inf);db=c['dist'].get(node(b),math.inf);own=c['segment'][:2]==(road['id'],k)
    if own or c['floor']+RAMP*max(0,min(da,db)-c['flat'])<top:reach.append((c,da,db,own))
   if not reach:continue
   _,t,d=win.project(a,b);goal=np.full(win.x.shape,np.inf)
   for c,da,db,own in reach:
    along=np.abs(t-c['segment'][2])*length if own else np.minimum(da+t*length,db+(1-t)*length)
    goal=np.minimum(goal,c['floor']+RAMP*np.maximum(0,along-c['flat']))
   envelope=np.minimum(envelope,goal+WALL*np.maximum(0,d-half))
  prisms[road['id']]=envelope;return envelope
 # The trench lowers the lower streets and every street whose ramp target falls beneath the ground somewhere
 # along it; a street joining a lowered one (OSM ways meet at any vertex) whose centerline crosses the trench
 # floor descends too, as a ramp running beside a lowered street into its cut.
 lowered=set(site['lower'])|{r['id'] for r in network if any(target(p)<ground(*p)-1e-6 for p in r['points'])}
 at=defaultdict(set)
 for road in network:
  for p in road['points']:at[node(p)].add(road['id'])
 while True:
  low=[r for r in network if r['id'] in lowered];envelope=np.minimum.reduce([prism(r) for r in low]);inside=corridor(win,low)
  bottom=(envelope<heights-1e-9)&inside&~buildings
  joins=[r for r in network if r['id'] not in lowered and any(at[node(p)]&lowered for p in r['points'])]
  more={r['id'] for r in joins if (covered(grid,win,[r],centerline=True)&bottom).any()}
  if not more:break
  lowered|=more
 floor=set(win.index[bottom].tolist())
 replaced,added,whole=extend_decks(site,roads,grid,floor,ground,lowered)
 after=[x for r in roads for x in replaced.get(r['id'],[r])]
 kept=[r for r in after if r['id'] not in lowered and not r.get('elevations') and not r.get('tunnel') and any(win.near(a,b,half_width(r)) for a,b in zip(r['points'],r['points'][1:]))]
 # A kept street keeps every cell its corridor passes over, so no corner of a cell beneath it drops into the wall.
 cut=(envelope<heights-1e-9)&~(buildings|(covered(grid,win,kept)&~inside))
 pieces=[next(x for x in replaced[i] if x.get('elevations')) for i in sorted(replaced)]
 report={'crossings':[{'upper':c['upper'],'lower':c['lower'],'point':[round(v,3) for v in c['point']],'deckBottom':round(c['deckBottom'],3)} for c in crossings],
  'networkRoads':len(network),'loweredRoads':sorted(lowered),
  'approachPieces':[{'road':p['id'],'from':i,'lengthMeters':round(sum(math.dist(a,b) for a,b in zip(p['points'],p['points'][1:])),2)} for i,p in zip(sorted(replaced),pieces)],
  'maxCutMeters':round(float((heights[cut]-envelope[cut]).max()),3) if cut.any() else 0}
 return win.index[cut],envelope[cut],report,replaced,added,whole,[(r,win) for r in kept]


def approach(deck,end,by_name):
 """The street continuing a deck end, walked outward up to REACH: points and road ids."""
 points=deck['points'];p=points[end];q=points[1] if end==0 else points[-2]
 heading=np.subtract(p,q);heading=heading/np.linalg.norm(heading);out=[list(p)];ids=[];seen={deck['id']};total=0
 while total<REACH-1e-9:
  best=None
  for road in by_name.get(deck['name'],()):
   if road['id'] in seen or road.get('elevations'):continue
   for e in (0,-1):
    if math.dist(road['points'][e],out[-1])<.5:
     line=road['points'] if e==0 else road['points'][::-1];d=np.subtract(line[1],line[0]);cos=float(np.dot(d/np.linalg.norm(d),heading))
     if best is None or cos>best[0]:best=(cos,road,line)
  if best is None or best[0]<.7:break
  _,road,line=best;seen.add(road['id']);ids.append(road['id'])
  for a,b in zip(line,line[1:]):
   length=math.dist(a,b)
   if total+length>=REACH:t=(REACH-total)/length;out.append([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);total=REACH;break
   out.append(list(b));total+=length
  heading=np.subtract(out[-1],out[-2]);heading=heading/np.linalg.norm(heading)
 return out,ids


def rim(points,ground,source):
 """Distance along `points` to their highest surveyed point, the graded height and the point."""
 best=None;total=0
 for a,b in zip(points,points[1:]):
  length=math.dist(a,b);n=max(1,math.ceil(length/1.5))
  for j in range(n+1):
   t=j/n;x,z=a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t;h=source(x,z)
   if best is None or h>best[0]+1e-6:best=(h,total+t*length,(x,z))
  total+=length
 return best[1],ground(*best[2]),best[2]


def embankment(site,roads,by_id,grid,ground,source,footprints):
 """Carry the upper streets across the valley: filled vertex indices, heights, deck profiles and a report.
 The carriageways of a divided street share one grade, so neither approach fill rises over the other's deck end."""
 by_name={}
 for road in roads:by_name.setdefault(road['name'],[]).append(road)
 lowers=[by_id[i] for i in site['lower']];approaches=[];rims=[]
 for deck_id in site['upper']:
  deck=by_id[deck_id];ends=[]
  for end in (0,-1):
   line,ids=approach(deck,end,by_name);assert len(line)>1,f'{deck_id} has no approach at its {"start" if end==0 else "end"}'
   distance,height,point=rim(line,ground,source);ends.append((line,ids,distance,height,point));rims.append((point,height))
  approaches.append((deck,ends))
 # The rims on each side of the valley, averaged, carry one straight grade; a point's level is that of its projection on it.
 first=by_id[site['upper'][0]]['points'];axis=np.subtract(first[-1],first[0]);axis=axis/np.linalg.norm(axis)
 middle=np.mean([p for deck,_ in approaches for p in deck['points']],axis=0);sides=([],[])
 for point,height in rims:sides[float(np.dot(np.subtract(point,middle),axis))>0].append((point,height))
 assert sides[0] and sides[1],f"{site['id']}: the rims do not fall on both sides of the valley"
 west=np.mean([p for p,_ in sides[0]],axis=0);east=np.mean([p for p,_ in sides[1]],axis=0)
 h0=float(np.mean([h for _,h in sides[0]]));h1=float(np.mean([h for _,h in sides[1]]));span=east-west;span2=float(np.dot(span,span))
 def level(x,z):return h0+(h1-h0)*np.clip(((x-west[0])*span[0]+(z-west[1])*span[1])/span2,0,1)
 profiles={};portions=[];decks=[]
 for deck,ends in approaches:
  profiles[deck['id']]=[round(float(level(*p)),4) for p in deck['points']]
  for line,ids,distance,_,_ in ends:
   total=0;pieces=[]
   for a,b in zip(line,line[1:]):
    seg=math.dist(a,b)
    if total>=distance-1e-9:break
    if total+seg>distance:t=(distance-total)/seg;b=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];seg=distance-total
    pieces.append((a,b));total+=seg
   portions.append((pieces,half_width(by_id[ids[0]])))
  decks.append({'road':deck['id'],'rims':[[round(v,3) for v in e[4]] for e in ends],'rimHeights':[round(e[3],3) for e in ends],'rimDistances':[round(e[2],2) for e in ends],'approaches':[e[1] for e in ends]})
 win=Window(grid,box([p for pieces,_ in portions for a,b in pieces for p in (a,b)],30));heights=ground.values[win.index]
 envelope=np.full(win.x.shape,-np.inf)
 for pieces,half in portions:
  for n,(a,b) in enumerate(pieces):
   # Each piece fills only beside its own span (a vertex behind a bend would take the level of the far side);
   # the first piece starts at the deck end and runs ABUTMENT metres on under the landing.
   raw,t,d=win.project(a,b);length=math.dist(a,b) or 1e-9;inside=(raw>=(-ABUTMENT if n==0 else -.5)/length)&(raw<=1+.5/length)
   rise=level(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t)-WALL*np.maximum(0,d-half)
   envelope=np.where(inside,np.maximum(envelope,rise),envelope)
 keep=footprint_mask(win,footprints(win.bounds))|corridor(win,lowers)
 fill=(envelope>heights+1e-9)&~keep
 report={'grade':{'rims':[[round(float(v),3) for v in west],[round(float(v),3) for v in east]],'heights':[round(h0,3),round(h1,3)]},'decks':decks,
  'maxFillMeters':round(float((envelope[fill]-heights[fill]).max()),3) if fill.any() else 0}
 return win.index[fill],envelope[fill],profiles,report


def restore(roads,heights,record):
 """Put back the streets, deck profiles and grid vertices a previous run changed (`roads` is edited in place).
 Records before the embankment decks were kept whole list their original profiles under `sourceProfiles`."""
 if not record:return
 changes=record.get('roads',{});added=set(changes.get('added',[]));sources={r['id']:r for r in changes.get('sources',[])}
 if added or sources:roads[:]=[copy.deepcopy(sources[r['id']]) if r['id'] in sources else r for r in roads if r['id'] not in added]
 by_id={r['id']:r for r in roads}
 for source in record.get('sourceProfiles',[]):by_id[source['road']]['elevations']=list(source['elevations'])
 terrain=record.get('terrain')
 if terrain and terrain['vertices']:heights[np.asarray(terrain['vertices'],dtype=np.int64)]=np.asarray(terrain['heights'],dtype=heights.dtype)


def stations(points,spacing=2):
 out=[]
 for a,b in zip(points,points[1:]):
  n=max(1,math.ceil(math.dist(a,b)/spacing));out+=[(a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n) for j in range(n)]
 return out+[tuple(points[-1])]


def level_north_overpasses(roads,grid,heights,source_heights,footprints):
 """Repair every site from restored inputs. `heights` and `source_heights` are the
 int16 graded and raw grids; `footprints(bounds)` lists building outlines in a box.
 Returns (record, repaired int16 grid, new deck profiles by road id, repaired
 road list); nothing is changed in place."""
 scale=grid.get('scale',.01)
 work=heights.astype(np.float64)*scale;ground=grid_sampler(grid,work);ground.values=work;source=grid_sampler(grid,source_heights.astype(np.float64)*scale)
 changed={};sites=[];profiles={};current=list(roads);sources={};added=[];kept=[]
 for site in SITES:
  by_id={r['id']:r for r in current}
  if site['mode']=='trench':
   idx,values,report,replaced,new,whole,guard=trench(site,current,by_id,grid,ground,footprints);kept+=guard;added+=new
   for road_id in replaced:sources[road_id]=copy.deepcopy(by_id[road_id])
   current=[x for r in current for x in replaced.get(r['id'],[r])]
  else:
   idx,values,new,report=embankment(site,current,by_id,grid,ground,source,footprints);profiles.update(new)
   # The decks become this step's own: their source records are kept whole for the replay.
   for road_id,elevations in new.items():sources[road_id]=copy.deepcopy(by_id[road_id])
   current=[{**r,'elevations':new[r['id']],'bridge':{**r['bridge'],'kind':DECK}} if r['id'] in new else r for r in current]
  pick=min if site['mode']=='trench' else max
  for k,v in zip(idx.tolist(),values.tolist()):q=int(round(v/scale));changed[k]=pick(changed.get(k,q),q)
  sites.append({'id':site['id'],'name':site['name'],'mode':site['mode'],'upper':site['upper'],'lower':site['lower'],**report})
 result=heights.copy();vertices=sorted(k for k,q in changed.items() if q!=int(heights[k]))
 for k in vertices:result[k]=changed[k]
 after=grid_sampler(grid,result.astype(np.float64)*scale)
 # The streets a trench keeps, the deck landings on them included, stay on their graded surface.
 for road,win in kept:
  for p in stations(road['points']):
   if win.contains(p):assert abs(after(*p)-ground(*p))<.011,f"a trench moved {road['id']} by {after(*p)-ground(*p):.2f} m at {p[0]:.1f},{p[1]:.1f}"
 by_id={r['id']:r for r in current};probe={**by_id,**{i:{**by_id[i],'elevations':e} for i,e in profiles.items()}}
 for site,entry in zip(SITES,sites):
  if site['mode']=='embankment':
   for deck_id in site['upper']:
    deck=probe[deck_id]
    for e in (0,-1):p=deck['points'][e];step=deck['elevations'][e]-after(*p);assert abs(step)<.1,f"{deck_id} ends {step:.2f} m off its filled landing"
  low=math.inf
  for upper_id in site['upper']:
   for lower_id in site['lower']:
    upper,lower=probe[upper_id],probe[lower_id]
    for p in crossing_points(LineString(upper['points']).intersection(LineString(lower['points']))):
     low=min(low,road_height(upper,[p.x,p.y],after)-upper['bridge'].get('thickness',.75)-after(p.x,p.y))
  assert low>=MIN_CLEARANCE,f"{site['id']} still leaves only {low:.2f} m beneath its decks"
  entry['minimumClearanceMeters']=round(low,3)
 record={'method':METHOD,'clearanceMeters':CLEARANCE,'rampGrade':RAMP,'wallSlope':WALL,'walkMeters':WALK,'flatMeters':FLAT,'rimReachMeters':REACH,'abutmentMeters':ABUTMENT,'networkMeters':NETWORK,'windowMeters':WINDOW,'buildingMarginMeters':BUILDING,
  'extensionStepMeters':STEP,'extensionTailMeters':TAIL,'shortestPieceMeters':PIECE,'extensionReachMeters':EXTEND,'approachKind':APPROACH,'deckKind':DECK,
  'heightAccuracy':'Estimated game profiles, not surveyed structures','sites':sites,
  'roads':{'added':added,'sources':[sources[i] for i in sorted(sources)]},
  'terrain':{'vertices':vertices,'heights':[int(heights[k]) for k in vertices]}}
 return record,result,profiles,current


def load_grid(path):return np.frombuffer(gzip.decompress(path.read_bytes()),dtype='<i2').copy()


def tile_footprints(data_dir,city):
 """footprints(bounds): building outlines of the package tiles a box touches."""
 size=city['tiles']['size'];keys=set(city['tiles']['keys']);cache={}
 def footprints(bounds):
  out=[]
  for tx in range(math.floor(bounds[0]/size),math.floor(bounds[2]/size)+1):
   for tz in range(math.floor(bounds[1]/size),math.floor(bounds[3]/size)+1):
    key=f'{tx}_{tz}'
    if key not in keys:continue
    if key not in cache:
     raw=gzip.decompress((data_dir/'tiles'/f't_{key}.bin').read_bytes());n=struct.unpack_from('<I',raw,4)[0]
     cache[key]=[b['footprint'] for b in json.loads(raw[8:8+n])['buildings'] if b.get('footprint')]
    out+=cache[key]
  return out
 return footprints


def applies(roads):
 """Whether a package carries the northern sites (the Boston-only package does not)."""
 ids={r['id'] for r in roads};return all(i in ids for site in SITES for i in site['upper']+site['lower'])


def replay(data_dir,city,record):
 """Rerun the repair from the recorded originals; True when it rewrites the installed package exactly."""
 grid=city['elevation'];roads=copy.deepcopy(city['roads']);installed=load_grid(data_dir/grid['file']);heights=installed.copy();restore(roads,heights,record)
 again,result,profiles,repaired=level_north_overpasses(roads,grid,heights,load_grid(data_dir/grid['source']),tile_footprints(data_dir,city))
 by_id={r['id']:r for r in city['roads']};by_new={r['id']:r for r in repaired}
 touched=set(again['roads']['added'])|{r['id'] for r in again['roads']['sources']}
 same=[r['id'] for r in repaired]==[r['id'] for r in city['roads']] and all(by_new[i].get(f)==by_id[i].get(f) for i in touched for f in FIELDS)
 return same and np.array_equal(result,installed) and all(by_id[i]['elevations']==e for i,e in profiles.items()) and all(again[k]==record.get(k) for k in ('terrain','roads'))
