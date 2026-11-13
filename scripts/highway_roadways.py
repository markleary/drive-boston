"""The surveyed roadway of the Massachusetts Turnpike, Storrow Drive and their ramps.

boston_highways.py sizes a road from its lane count and narrows it beside its twin, a building or a street: a guess
on Boston's centre lines, which are not drawn down the middle of their roadways either. Boston's curb survey (GIS
layer 6, the edge of pavement the street surfaces are measured to) holds the roadway itself wherever the road
runs in the open, so the guess left Storrow Drive a 6 m ribbon in a 12 m roadway at Arlington Street, its tunnel
ramps 5 m slots in 9 m cuts with the surveyed curbs drawn on the grass beside them, and the Turnpike's
carriageways up to 5 m off their own pavement. This module measures every solved road against the survey and
corrects it, after the profiles are solved and the records classified, so that no height, record boundary or id
changes:

- Measuring (measure): stations every STEP metres, a ray across the road to each side. The first curb is the
  roadway's edge on that side when it lies within NEAR of the lanes' own pavement. A farther one is the edge of
  a deck's roadway (never of a cut's, whose walls stand at its own kerbs)
  unless another road's pavement begins within BEHIND of it (the curb is that road's, hit from outside across a
  verge whose own curb the survey lacks) or its ground stands LEVEL over the road or LEVEL+DEEP under it (the top
  of a cut, the foot of a bank). Another road running along this one at its height before any curb shares the
  roadway: each takes it to the line half way between them. A curb that crosses the centre line is the edge of
  something over the road (a bridge, a tunnel's roof slab) or a junction's: nothing is measured within CROSSING
  of it, between two such crossings less than BRIDGE apart, or between one and a roofed stretch within PORTAL
  (the survey shows the tunnel's real portal, which the stage's roof may stop short of). A tunnel alongside
  whose roof this road's floor does not clear (within ROOF_OVER of its height) bounds the roadway at its own wall:
  the trench of a ramp that joins a tunnel is surveyed out over that tunnel's roof. Two curbs the lanes do
  not fit between (FIT) are a divider's or a barrier's faces, not the roadway's edges. Short excursions (a stray
  piece) are dropped as street_surfaces.clean_side drops them, and a side the survey does not show is carried
  between its measured neighbours instead of falling back to the lane-count width: a roadway does not change
  width where the survey shows no reason. Only stations in the open at their own ground are measured
  (station_state): a roofed stretch and a viaduct have other roads' curbs over or under them, a street stretch
  lies on its street, and a station under or beside a building stays as the stage solved it against that building.
- A road whose pavement the runtime walls or rails (a tunnel record's open stretch, a Turnpike carriageway on the
  ground: `span`) moves only as far as its curbs need for its pavement to lie between them, onto the middle where
  they stand closer together than it is wide, and narrows to them, never to less than SHY beside its lanes:
  those roads were sized with their shoulders, so the survey can show them misplaced or too wide, not too narrow.
  Storrow Drive's cuts were sized to their lanes alone (`widen`): they move onto the middle of their roadway and
  take it whole, up to SHOULDER beside the lanes.
- A deck of Storrow Drive or of a ramp on the ground (`flush`) keeps its lanes, moved the same least distance, and
  the rest of the surveyed roadway is paved beside them: its edges are handed to build-street-surfaces.py
  (aprons), which compiles them into the street pavement, and the graded grid is set DROP under the deck across
  every cell the roadway passes over (grade), as the grader levels a street's corridor, so the deck no longer
  stands TERRAIN_RISE over a shelf with rails along it and a street that merges into the road shares its
  surface. The surveyed roadway is the deck's ground even where a street's class width reaches across it (the
  street's own pavement ends at its curb, whatever its class says), and where a street shares the roadway (no
  curb between the two: the lane to Beacon Street beside Storrow Drive West at Mugar Way, whose graded corridor
  had left the deck 0.7 m proud of its own pavement, railed on both sides) the shared pavement is one surface,
  raised to fall CROSSFALL from the deck's edge to that street's far curb. settle then lowers the set vertices
  where the ground between them would still reach a pavement (a grid set vertex by vertex bows up to a road
  that sags). A deck inside its street landing (`landing`) is paved the same way but not moved, and its ground is
  only raised to DROP under it, never lowered: the ground there is the street's. Of two roads side by side each
  keeps its own ground across its own roadway (a vertex takes the level of the road whose roadway it lies in
  before that of a strip that only passes over its cell), and once the ground is laid trim() keeps the paving
  beside a deck's lanes only where the ground ends up FLUSH under it: beside a ramp that has left the ground over
  the road it crosses, or a lane from a road at another level, a strip of asphalt a step below the deck is not its roadway.
  The records carry those edges (`roadway`), so that the runtime plants no tree and posts no lamp in the paved roadway.
- Nothing moves at a station other roads meet (a route's ends, a gore, a street joining a deck), under a roof or
  outside the open: the move fades in at SHIFT_RATE and the width at WIDTH_RATE from there, so a cut funnels
  into its portal and no width steps. A measured edge beyond the lanes' own pavement keeps CLEAR from every
  building (building_caps).
- The stage then cuts its ground again for the roads as they lie and holds a station where it was solved
  wherever ground still stands in its pavement (a street's corridor or a building keeps its ground there),
  with the stations of every road within HOLD_NEAR (boston_highways.install).
- check() is the stage's own test of the result, run by validate: no width changes faster than WIDTH_RATE along
  a route, and every paved roadway is a surface of an installed route.

The curbs come from the stage's source sidecar (extract_curbs, cut from the cached survey by --extract), so the
stage still reads only its sidecar and the package, and validate-city.py can replay it without the cache."""
import math
import numpy as np
import shapely
from shapely.geometry import LineString,Polygon
from shapely.strtree import STRtree
import i93_north as I
from road_connections import stations

STEP=1.0          # measuring stations along a road
REACH=9.0         # a curb this far beyond the lanes' pavement still bounds the roadway
NEAR=2.5          # one this close to the lanes' pavement is the road's own without question
BEHIND=1.5        # a farther one with another road's pavement beginning this close behind it is that road's
LEVEL=.9          # and one whose ground stands this far over the road, or LEVEL+DEEP under it, is no edge of it
DEEP=.7
PARALLEL=.6       # cosine between two roads that run along each other
SAME=1.2          # and share a roadway when their surfaces differ by no more than this
ROOF_OVER=4.0     # a road under its roof alongside, no further than this under or over, bounds the roadway at its own wall: the floor of a cut does not clear that roof
OVERLAP=.2        # two roads sharing a roadway each take it this far past the line half way between them
GROUNDED=.9       # a deck this close over its ground rides it
TONGUE=7.0        # an excursion shorter than this
LIFT=1.5          # of this much from the local median is not the roadway's edge
WINDOW=4
SHIFT_RATE=1/12   # a centre line moves sideways no faster than this
WIDTH_RATE=1/8    # and a pavement edge turns in or out no faster than this
SHOULDER=3.5      # a cut sized to its lanes alone takes no more than this beside them from the survey
SHY=.6            # and no road narrows to less than this beside its lanes
FIT=.85           # two curbs closer together than this share of the lanes' width are not the roadway's edges (a divider, a barrier's two faces)
APRON_RATE=1.0    # the edge of the paving beside a deck turns out or in no faster than this
CROSSING=3.0      # a curb crossing the centre line is the edge of something over the road: no measuring this close to it,
BRIDGE=45         # between two such crossings this close together (a bridge, a roof slab)
PORTAL=30         # or between one and a roofed stretch this close (the tunnel's roof runs on past the portal the stage found)
DROP=.06          # the graded ground under a deck that rides it
CROSSFALL=.04     # a roadway shared with a street falls no faster than this from the deck's lanes to that street's far edge
FLUSH=.45         # paving beside a deck's lanes is kept where the graded ground ends up this close under the deck (a step the runtime still rails at 0.35 m)
TRIM_REACH=3.0    # and a place where it does not pulls the paving in for this far along the road either way, so the edge left is a line and not the grid's teeth
CLEAR=.4          # room kept between a moved pavement and a building
CURB_ZONE=40      # the survey is kept this far from every route
MIN_RUN=6.0       # shortest stretch paved beside a deck
STEP_SLACK=.05    # (check) a width step may pass WIDTH_RATE by this
HOLD_NEAR=15      # a road is held where it was solved this close to a station whose surveyed place the ground does not leave free
METHOD=('Every road in the open at its own ground measured to the curb survey of the source sidecar every 1 m (the first curb each way; a far one kept unless another road begins behind it or its ground stands off the road; a road alongside at the same height shares the roadway half way; short excursions dropped, gaps carried between measured neighbours); '
 'cuts and the Turnpike carriageways on the ground moved onto the middle of their roadway and sized to it, the decks only narrowed; Storrow Drive and ramp decks on the ground moved only as far as the curbs need, '
 'the roadway beside their lanes handed to build-street-surfaces.py as aprons and the graded grid set under them across every cell it passes over (the surveyed roadway whatever street class width reaches across it, each of two roads side by side its own; a pavement shared with a street raised to fall 4% from the deck to that street\'s far curb; a deck in its street landing only raised to), the aprons then kept only where the ground lies within 0.45 m under the deck; nothing moved where other roads meet, under a roof or a building; moves and widths rate-limited')


def extract_curbs(features,project,lines):
 """The curb survey within CURB_ZONE of the routes' source lines: polylines in world metres, centimetres kept."""
 zone=shapely.union_all([LineString(l).buffer(CURB_ZONE) for l in lines if len(l)>=2]);shapely.prepare(zone);out=[]
 for f in features:
  for path in f['geometry'].get('paths',[]):
   if len(path)<2:continue
   line=LineString([project(*v) for v in path])
   if not zone.intersects(line):continue
   part=line.intersection(zone)
   for g in getattr(part,'geoms',[part]):
    if g.geom_type=='LineString' and g.length>=.5:out.append([[round(x,2),round(z,2)] for x,z in g.coords])
 return out


def fine_stations(plan):
 """Stations every STEP metres with the plan's own kept: points, left normals, the plan segment and the fraction
 along it of each, and the index of each plan station among them."""
 p=np.asarray(plan.points,float);t=np.asarray(plan.tangents,float);n=len(p);pts=[];seg=[];frac=[];at=[]
 for i in range(n-1):
  m=max(1,math.ceil(float(np.hypot(*(p[i+1]-p[i])))/STEP-1e-9));at.append(len(pts))
  for j in range(m):pts.append(p[i]+(p[i+1]-p[i])*j/m);seg.append(i);frac.append(j/m)
 at.append(len(pts));pts.append(p[-1]);seg.append(n-2);frac.append(1.0)
 seg=np.asarray(seg);frac=np.asarray(frac);tan=t[seg]*(1-frac)[:,None]+t[np.minimum(seg+1,n-1)]*frac[:,None];tan/=np.maximum(np.hypot(tan[:,0],tan[:,1]),1e-9)[:,None]
 return np.asarray(pts),np.stack([-tan[:,1],tan[:,0]],1),seg,frac,np.asarray(at)


def station_state(plan,least):
 """Per plan station: `open` (measured: in the open at its own ground, off a street landing, no building over its
 pavement there or at the station beside it), `flush` (a deck that keeps its lanes and is paved and graded beside
 them), `span` (a road whose pavement the runtime walls or rails, which is held to its surveyed roadway), `widen` (a
 span sized to its lanes alone, Storrow Drive's cuts: it takes the roadway whole), `frozen` (a station under or
 beside a building: the stage has measured the building against its pavement, which stays as solved) and `landing`
 (a deck inside its street landing: measured and paved beside its lanes, not moved)."""
 n=len(plan.points);parkway=plan.spec['bridge']=='storrow';open_=[];flush=[];span=[];widen=[];landing=[];frozen=[any(plan.built[j] for j in (i-1,i,i+1) if 0<=j<n) for i in range(n)]
 for i in range(n):
  cut=plan.tunnel[i] and not plan.covered[i];deck=not plan.tunnel[i] and plan.y[i]-plan.high[i]<=GROUNDED
  # (a cut is walled to the street it comes up to; a deck inside its street landing lies on that street's ground: `landing`)
  o=(cut or deck) and not plan.street[i] and (cut or plan.allowance[i]>.999) and not frozen[i]
  open_.append(o);flush.append(o and deck and (parkway or not plan.main));span.append(o and not (deck and (parkway or not plan.main)));widen.append(o and cut and parkway)
  # a deck coming down onto its street: measured and paved beside its lanes like a flush one, but neither moved nor graded (its ground is the street's)
  landing.append(deck and not o and not plan.street[i] and plan.allowance[i]<=.999 and not frozen[i] and (parkway or not plan.main))
 return open_,flush,span,frozen,widen,landing


def first_hits(origins,ends,tree,geoms):
 """Distance from each origin to the nearest crossing of its ray with `geoms`, and that point (NaN where none)."""
 m=len(origins);d=np.full(m,np.nan);q=np.full((m,2),np.nan)
 if not len(geoms) or not m:return d,q
 rays=shapely.linestrings(np.stack([origins,ends],1));ri,gi=tree.query(rays,predicate='intersects')
 if not len(ri):return d,q
 coords,idx=shapely.get_coordinates(shapely.intersection(rays[ri],geoms[gi]),return_index=True);k=ri[idx];dist=np.hypot(coords[:,0]-origins[k,0],coords[:,1]-origins[k,1])
 order=np.lexsort((dist,k));k=k[order];first=np.r_[True,k[1:]!=k[:-1]];d[k[first]]=dist[order][first];q[k[first]]=coords[order][first]
 return d,q


class Other:
 """A road beside the one being measured: its line, half width and surface along it."""
 def __init__(self,id,line,half,height,roofed=None,plan=None,street=None):self.id=id;self.line=line;self.half=half;self.height=height;self.roofed=roofed or (lambda s:False);self.plan=plan;self.street=street


def neighbours(plans,streets,ground):
 """Every road a roadway may be shared with: the other plans at their solved heights and the surface streets on the ground."""
 out=[]
 for plan in plans:
  along=np.asarray(plan.along,float);y=np.asarray(plan.y,float);w=np.asarray(plan.widths,float);cov=np.asarray(plan.covered,bool)
  out.append(Other(plan.id,plan.line,(lambda s,along=along,w=w:float(np.interp(s,along,w))/2),(lambda s,q,along=along,y=y:float(np.interp(s,along,y))),
   (lambda s,along=along,cov=cov:bool(cov[min(len(cov)-1,max(0,int(np.searchsorted(along,s))-1))] and cov[min(len(cov)-1,int(np.searchsorted(along,s)))])),plan))
 # (a street as its source drew it: build-street-surfaces.py, which follows this stage, moves a few centre lines and keeps the source in `sourcePoints`)
 for r in streets:out.append(Other(r['id'],LineString(r.get('sourcePoints') or r['points']),(lambda s,h=r['width']/2:h),(lambda s,q:ground(float(q[0]),float(q[1]))),street=r))
 return out


def clean(d,along):
 """Drop short excursions from the local median, carry a side across its gaps between measured neighbours and hold it at the ends."""
 d=d.copy();n=len(d);valid=~np.isnan(d)
 if valid.sum()>=3:
  padded=np.concatenate([np.full(WINDOW,np.nan),d,np.full(WINDOW,np.nan)])
  with np.errstate(all='ignore'):
   import warnings
   with warnings.catch_warnings():warnings.simplefilter('ignore');base=np.nanmedian(np.lib.stride_tricks.sliding_window_view(padded,2*WINDOW+1),axis=1)
  off=valid&(np.abs(d-base)>LIFT);edge=np.diff(np.concatenate([[0],off.astype(np.int8),[0]]))
  for s,e in zip(np.flatnonzero(edge==1),np.flatnonzero(edge==-1)):
   if along[e-1]-along[s]+STEP<TONGUE:d[s:e]=np.nan
 valid=~np.isnan(d)
 if valid.any() and not valid.all():d=np.interp(along,along[valid],d[valid])
 return d


def runs(mask):
 """[start, end] index pairs of the True runs of a boolean sequence."""
 out=[];start=None
 for i,v in enumerate(mask):
  if v and start is None:start=i
  if not v and start is not None:out.append([start,i-1]);start=None
 if start is not None:out.append([start,len(mask)-1])
 return out


def measure(plans,curbs,streets,ground,raw,least):
 """The surveyed roadway of every plan: {plan id: {'pts','nrm','at','along','open','L','R'}} with the distance from
 the centre line to the roadway's edge on the left and the right of every fine station (NaN: not shown by the
 survey), `open` marking the measured ones."""
 lines=np.asarray([LineString(c) for c in curbs if len(c)>=2],dtype=object);tree=STRtree(lines) if len(lines) else None
 others=neighbours(plans,streets,ground);olines=np.asarray([o.line for o in others],dtype=object);otree=STRtree(olines);out={}
 for plan in plans:
  pts,nrm,seg,frac,at=fine_stations(plan);m=len(pts);n=len(plan.points);state=station_state(plan,least);open_=np.asarray(state[0],bool)|np.asarray(state[5],bool)
  roofed=np.asarray([plan.tunnel[i] and plan.tunnel[i+1] and plan.covered[i] and plan.covered[i+1] for i in range(n-1)],bool)
  fo=open_[seg]&open_[np.minimum(seg+1,n-1)]&~roofed[seg];fo[at]=open_;walled=np.asarray(plan.tunnel,bool)[seg]&np.asarray(plan.tunnel,bool)[np.minimum(seg+1,n-1)]
  y=np.asarray(plan.y,float);w=np.asarray(plan.widths,float);fy=y[seg]*(1-frac)+y[np.minimum(seg+1,n-1)]*frac;h0=(w[seg]*(1-frac)+w[np.minimum(seg+1,n-1)]*frac)/2
  along=np.asarray(plan.along,float);fa=along[seg]*(1-frac)+along[np.minimum(seg+1,n-1)]*frac;tan=np.stack([nrm[:,1],-nrm[:,0]],1);sides={}
  # A curb crossing the centre line is the edge of something over the road (a bridge, a roof slab) or a junction's: the survey there shows that, not the roadway.
  under=np.zeros(m,bool)
  if tree is not None and fo.any():
   marks=sorted({round(float(plan.line.project(shapely.Point(x,z))),2) for j in tree.query(plan.line,predicate='intersects').tolist() for x,z in shapely.get_coordinates(plan.line.intersection(lines[j]))})
   shut=[(fa[a],fa[b]) for a,b in runs(~fo)]
   for k,c in enumerate(marks):
    under|=np.abs(fa-c)<=CROSSING
    if k+1<len(marks) and marks[k+1]-c<=BRIDGE:under|=(fa>=c)&(fa<=marks[k+1])
    for a,b in shut:
     if 0<=a-c<=PORTAL:under|=(fa>=c)&(fa<=a)
     if 0<=c-b<=PORTAL:under|=(fa>=b)&(fa<=c)
  far={}
  for name,sign in (('L',1.),('R',-1.)):
   d=np.full(m,np.nan);rows=np.flatnonzero(fo&~under);beyond=np.full(m,np.nan);who=[None]*m
   if len(rows):
    o=pts[rows];e=o+nrm[rows]*(sign*(h0[rows]+REACH))[:,None];dc,qc=first_hits(o,e,tree,lines) if tree is not None else (np.full(len(rows),np.nan),np.full((len(rows),2),np.nan))
    # other roads the ray crosses before any curb, running along this one at its height: the roadway is shared
    rays=shapely.linestrings(np.stack([o,e],1));ri,gi=otree.query(rays,predicate='intersects');dn=np.full(len(rows),np.nan);by=[None]*len(rows);wall=np.full(len(rows),np.nan)
    if len(ri):
     coords,idx=shapely.get_coordinates(shapely.intersection(rays[ri],olines[gi]),return_index=True)
     for (x,z),k in zip(coords,idx):
      r=int(ri[k]);other=others[int(gi[k])]
      if other.plan is plan:continue
      dist=math.hypot(x-o[r,0],z-o[r,1])
      if dist<.3:continue
      s=float(other.line.project(shapely.Point(x,z)));a=other.line.interpolate(max(0,s-1));b=other.line.interpolate(min(other.line.length,s+1));tx,tz=b.x-a.x,b.y-a.y;l=math.hypot(tx,tz) or 1
      along_it=abs(tx*tan[rows[r],0]+tz*tan[rows[r],1])/l>=PARALLEL
      # (a tunnel alongside, whose roof this road's floor does not clear: the roadway ends at that tunnel's wall whatever curb lies beyond it.
      # The Berkeley Street entrance's trench is surveyed 7 m wide beside the eastbound tunnel it joins, and a cut that wide opened the tunnel's roof over a lane)
      if along_it and other.roofed(s) and abs(other.height(s,(x,z))-fy[rows[r]])<ROOF_OVER:
       edge=dist-other.half(s);wall[r]=edge if math.isnan(wall[r]) else min(wall[r],edge)
      if (not math.isnan(dn[r]) and dist>=dn[r]) or (not math.isnan(dc[r]) and dist>=dc[r]):continue
      if not along_it or other.roofed(s) or abs(other.height(s,(x,z))-fy[rows[r]])>SAME+(0 if other.plan else .4):continue
      dn[r]=dist;by[r]=other
    for r,i in enumerate(rows):
     if not math.isnan(wall[r]) and (math.isnan(dc[r]) or dc[r]>wall[r]) and (math.isnan(dn[r]) or dn[r]/2+OVERLAP>wall[r]):d[i]=max(h0[i],wall[r]);continue
     if not math.isnan(dn[r]):
      d[i]=max(h0[i],dn[r]/2+OVERLAP)
      # (a street's share of the roadway runs on to the next curb, or to its class width: grade lays the two on one surface)
      if by[r].street is not None:beyond[i]=dc[r] if not math.isnan(dc[r]) else dn[r]+by[r].half(0);who[i]=by[r].street
      continue
     if math.isnan(dc[r]):continue
     if dc[r]>h0[i]+NEAR:
      # (a cut's walls stand at its lanes' own kerbs: a far curb beside a cut is another road's, or the far edge of a slab over it)
      if walled[i]:continue
      over=raw(float(qc[r,0]),float(qc[r,1]))-fy[i]
      if over>LEVEL or over<-(LEVEL+DEEP):continue
      q=shapely.Point(qc[r]);foreign=False
      for j in otree.query(q,predicate='dwithin',distance=12+BEHIND).tolist():
       other=others[j]
       if other.plan is plan:continue
       s=float(other.line.project(q));gap=other.line.distance(q)
       if gap<=other.half(s)+BEHIND and not other.roofed(s) and abs(other.height(s,qc[r])-fy[i])<=SAME+(0 if other.plan else .4):foreign=True;break
      if foreign:continue
     d[i]=dc[r]
   sides[name]=d;far[name]=(beyond,who)
  # two curbs the lanes do not fit between are not this roadway's edges
  lanes=np.asarray(plan.lanes,float)[seg];tight=~np.isnan(sides['L'])&~np.isnan(sides['R'])&(sides['L']+sides['R']<FIT*lanes*I.LANE)
  for name in ('L','R'):
   d=sides[name];d[tight]=np.nan
   for a,b in runs(fo):
    if fa[b]-fa[a]>=STEP:d[a:b+1]=clean(d[a:b+1],fa[a:b+1])
  out[plan.id]={'pts':pts,'nrm':nrm,'at':at,'along':fa,'open':fo,'under':under,'h0':h0,'L':sides['L'],'R':sides['R'],'state':state,'far':far}
 return out


def lipschitz(values,along,rate,lower=False,upper=False):
 """`values` held to a slope of `rate` per metre: the nearest such sequence from below (`lower`), from above (`upper`) or by clipping each to its neighbour."""
 v=list(values);n=len(v)
 for order in (range(1,n),range(n-2,-1,-1)):
  for i in order:
   j=i-1 if order.start==1 else i+1;room=rate*abs(float(along[i]-along[j]))
   v[i]=min(v[i],v[j]+room) if lower else max(v[i],v[j]-room) if upper else min(max(v[i],v[j]-room),v[j]+room)
 return v


def building_caps(plan,m,buildings):
 """Hold a measured roadway clear of the buildings beside it: an edge beyond the lanes' own pavement keeps CLEAR from every building's hull."""
 x0,z0,x1,z1=plan.line.bounds;reach=max(plan.widths)/2+REACH+2;hulls=[b['hull'] for b in buildings((x0-reach,z0-reach,x1+reach,z1+reach))]
 if not hulls:return 0
 tree=STRtree(hulls);arr=np.asarray(hulls,dtype=object);pts,nrm,h0=m['pts'],m['nrm'],m['h0'];count=0
 for name,sign in (('L',1.),('R',-1.)):
  d=m[name];rows=np.flatnonzero(~np.isnan(d)&(d>h0+.01))
  if not len(rows):continue
  o=pts[rows]+nrm[rows]*(sign*h0[rows])[:,None];e=pts[rows]+nrm[rows]*(sign*(d[rows]+CLEAR))[:,None];hit,_=first_hits(o,e,tree,arr)
  for r,i in enumerate(rows):
   if not math.isnan(hit[r]):d[i]=max(h0[i],h0[i]+hit[r]-CLEAR);count+=1
 return count


def restore(plan):
 """Put a corrected plan back on its source line at the widths it was solved with."""
 if not hasattr(plan,'solved_widths'):return
 plan.points=[list(q) for q in plan.solved_points];plan.widths=list(plan.solved_widths);plan.along=np.asarray(stations(plan.points));plan.tangents=I.tangents(plan.points);plan.line=LineString(plan.points)
 del plan.solved_widths,plan.solved_points,plan.shift


def correct(plan,m,joints,least,hold=()):
 """Move and resize a solved plan to its measured roadway (see the module text): plan.points and plan.widths are
 replaced, plan.solved_points and plan.solved_widths keep what the stage solved with, plan.shift the move of every station. The stations
 in `hold` stay as they were solved. Returns (stations moved, stations resized)."""
 restore(plan)
 n=len(plan.points);open_,flush,span,frozen,widen,_=m['state'];at=m['at'];along=np.asarray(plan.along,float);h0=np.asarray(plan.widths,float)/2;L=m['L'][at];R=m['R'][at]
 known=lambda v:not math.isnan(v);anchor=[(not open_[i]) or i in (0,n-1) or i in joints or i in hold for i in range(n)];target=[0.]*n
 for i in range(n):
  if anchor[i]:continue
  if widen[i]:target[i]=((L[i] if known(L[i]) else h0[i])-(R[i] if known(R[i]) else h0[i]))/2
  else:
   # as far as the curbs need for the pavement to lie between them, and onto the middle where it is wider than they leave
   lo=h0[i]-R[i] if known(R[i]) else -math.inf;hi=L[i]-h0[i] if known(L[i]) else math.inf
   target[i]=min(max(0.,lo),hi) if lo<=hi else (L[i]-R[i])/2
 marks=np.flatnonzero(anchor);room=[SHIFT_RATE*float(np.min(np.abs(along[marks]-along[i]))) for i in range(n)]
 shift=lipschitz([min(max(t,-r),r) for t,r in zip(target,room)],along,SHIFT_RATE);half=[]
 for i in range(n):
  floor=min(float(h0[i]),max(least(plan,i)/2,plan.lanes[i]*I.LANE/2+SHY))
  # (a station other roads meet is not moved, but its pavement still ends at its curbs; one held, under a roof or outside the open stays as solved)
  if i in hold or not (span[i] or flush[i]):half.append(float(h0[i]));continue
  le=L[i] if known(L[i]) else (h0[i] if widen[i] else math.inf);re=R[i] if known(R[i]) else (h0[i] if widen[i] else math.inf);fit=min(le-shift[i],re+shift[i])
  # Only a cut sized to its lanes alone widens, to its curbs and no more than a shoulder beside its lanes; every other road was sized with its shoulders and only narrows.
  half.append(max(floor,min(fit,plan.lanes[i]*I.LANE/2+SHOULDER) if widen[i] else min(fit,float(h0[i]))))
 half=lipschitz(half,along,WIDTH_RATE,lower=True);half=[float(h0[i]) if frozen[i] else max(min(float(h0[i]),max(least(plan,i)/2,plan.lanes[i]*I.LANE/2+SHY)),v) for i,v in enumerate(half)]
 # (a station that stays as solved, and the room its lanes need, hold the pavement out beside them: no step is left)
 half=lipschitz(half,along,WIDTH_RATE,upper=True)
 p=np.asarray(plan.points,float);t=np.asarray(plan.tangents,float);normal=np.stack([-t[:,1],t[:,0]],1);moved=sum(abs(s)>.005 for s in shift);sized=sum(abs(2*h-w)>.005 for h,w in zip(half,plan.widths))
 plan.solved_widths=list(plan.widths);plan.solved_points=[list(q) for q in plan.points];plan.shift=[round(float(s),3) for s in shift]
 plan.points=[[round(float(q[0]+nx*s),3),round(float(q[1]+nz*s),3)] for q,(nx,nz),s in zip(p,normal,plan.shift)];plan.widths=[round(2*float(h),3) for h in half]
 plan.along=np.asarray(stations(plan.points));plan.tangents=I.tangents(plan.points);plan.line=LineString(plan.points)
 return moved,sized


def compress(left,right,tol=.03):
 """Station indices to keep so both edges stay within `tol` of the chords between kept stations."""
 n=len(left);keep=[0];i=0
 def within(P,i,j):
  a,b=P[i],P[j];ab=b-a;l=math.hypot(*ab);q=P[i+1:j]
  dev=np.hypot(*(q-a).T) if l<1e-9 else np.abs(ab[0]*(q[:,1]-a[1])-ab[1]*(q[:,0]-a[0]))/l
  return bool((dev<=tol).all())
 while i<n-1:
  j=i+2
  while j<n and within(left,i,j) and within(right,i,j):j+=1
  keep.append(j-1);i=j-1
 return keep


def aprons(plan,m):
 """The roadway beside the lanes of a deck on the ground, as strips: [{'road','a','b','graded','left','right'}],
 stations a..b of the plan, the edges every STEP metres (thinned), each never inside the deck's own pavement. A strip
 is `graded` where the deck is flush (grade sets the ground under it) and not inside a street landing. plan.roadway
 holds the same edges at the plan's stations, as (left, right) metres from its moved centre line (None where it has none)."""
 flush,landing=m['state'][1],m['state'][5];n=len(plan.points);at=m['at'];pts,nrm,fa=m['pts'],m['nrm'],m['along'];out=[];plan.roadway=[None]*n
 shift=np.asarray(plan.shift,float);half=np.asarray(plan.widths,float)/2;along0=np.asarray(stations(plan.solved_points))
 for a0,b0 in runs([f or l for f,l in zip(flush,landing)]):
  if b0<=a0 or along0[b0]-along0[a0]<MIN_RUN:continue
  i0,i1=int(at[a0]),int(at[b0]);f=fa[i0:i1+1];s=np.interp(f,along0,shift);h=np.interp(f,along0,half);L=m['L'][i0:i1+1];R=m['R'][i0:i1+1]
  if np.isnan(L).all() and np.isnan(R).all():continue
  left=np.where(np.isnan(L),s+h,np.maximum(L,s+h));right=np.where(np.isnan(R),h-s,np.maximum(R,h-s))
  # (no spike where one station's ray passes an island's nose: the edge turns no faster than APRON_RATE, never inside the deck)
  left=np.maximum(np.asarray(lipschitz(left,f,APRON_RATE,lower=True)),s+h);right=np.maximum(np.asarray(lipschitz(right,f,APRON_RATE,lower=True)),h-s)
  lp=pts[i0:i1+1]+nrm[i0:i1+1]*left[:,None];rp=pts[i0:i1+1]-nrm[i0:i1+1]*right[:,None]
  # (the same edges from the moved centre line, for the records: what stands or grows beside the road keeps off the whole roadway)
  for i in range(a0,b0+1):j=int(at[i])-i0;plan.roadway[i]=(round(float(left[j]-shift[i]),2),round(float(right[j]+shift[i]),2))
  # one strip per stretch that is graded or not, each ending on the station the next begins on
  kinds=[bool(flush[i]) for i in range(a0,b0+1)];start=0
  for k in range(1,len(kinds)+1):
   if k<len(kinds) and kinds[k]==kinds[start]:continue
   a,b=a0+start,min(b0,a0+k) if k<len(kinds) else b0;start=k
   if b<=a:continue
   j0,j1=int(at[a])-i0,int(at[b])-i0;keep=[j0+q for q in compress(lp[j0:j1+1],rp[j0:j1+1])];cut=slice(i0+j0,i0+j1+1);far=m.get('far')
   # (`fine`, for grade alone: every station of the strip with its edges and, where a street shares the roadway, that street and its far edge)
   fine={'pts':pts[cut],'nrm':nrm[cut],'left':left[j0:j1+1].copy(),'right':right[j0:j1+1].copy(),'far':tuple(far[s][0][cut] if far else np.full(j1-j0+1,np.nan) for s in 'LR'),'who':tuple(far[s][1][cut] if far else [None]*(j1-j0+1) for s in 'LR'),
    'deck':((s+h)[j0:j1+1],(h-s)[j0:j1+1]),'y':np.interp(f[j0:j1+1],along0,np.asarray(plan.y,float)),'at':[int(at[i])-(i0+j0) for i in range(a,b+1)]}
   out.append({'road':plan.id,'a':a,'b':b,'graded':kinds[a-a0],'left':[[round(float(x),2),round(float(z),2)] for x,z in lp[keep]],'right':[[round(float(x),2),round(float(z),2)] for x,z in rp[keep]],'fine':fine})
 return out


def strip(apron):
 """An apron's surface: the union of the quads between its stations (an edge that turns back on itself folds one)."""
 l=apron['left'];r=apron['right'];parts=[]
 for k in range(len(l)-1):
  for tri in ((l[k],r[k],l[k+1]),(r[k],r[k+1],l[k+1])):
   poly=Polygon(tri)
   if poly.area>1e-8:parts.append(poly)
 return shapely.union_all(parts) if parts else Polygon()


def pavement_samples(plan,lip):
 """The points of a plan's deck pavement that boston_highways.standing_ground tests, with the height the ground may reach at each:
 nine across every deck station (and the tunnel station a deck starts on), and across the thirds between two deck stations."""
 n=len(plan.points);p=np.asarray(plan.points,float);t=np.asarray(plan.tangents,float);w=np.asarray(plan.widths,float);y=np.asarray(plan.y,float);off=np.linspace(-1,1,9);xs=[];zs=[];top=[]
 def add(q,d,half,limit):xs.append(q[0]-d[1]*off*half);zs.append(q[1]+d[0]*off*half);top.append(np.full(9,limit))
 for i in range(n):
  deck=not plan.tunnel[i]
  if not deck and not any(0<=j<n and not plan.tunnel[j] for j in (i-1,i+1)):continue
  add(p[i],t[i],w[i]/2-.3,y[i]+(lip+.02 if plan.allowance[i]<=.999 else -.02))
  if deck and i+1<n and not plan.tunnel[i+1] and plan.allowance[i]>.999 and plan.allowance[i+1]>.999:
   for f in (1/3,2/3):add(p[i]+(p[i+1]-p[i])*f,t[i],(w[i]+(w[i+1]-w[i])*f)/2-.3,y[i]+(y[i+1]-y[i])*f-.02)
 return (np.concatenate(xs),np.concatenate(zs),np.concatenate(top)) if xs else (np.zeros(0),np.zeros(0),np.zeros(0))


def settle(plans,grid,result,free,lip,rounds=12):
 """Lower the vertices in `free` (flat indices) until the ground lies a centimetre under every pavement sample
 it reaches: a grid set under a deck vertex by vertex still bows up to it between them where the road sags or turns."""
 if not len(free):return result
 scale=grid.get('scale',.01);W=grid['width'];C=grid['cellSize'];ox,oz=grid['originX'],grid['originZ'];mutable=np.zeros(result.size,bool);mutable[free]=True
 parts=[pavement_samples(plan,lip) for plan in plans];x=np.concatenate([q[0] for q in parts]);z=np.concatenate([q[1] for q in parts]);top=np.concatenate([q[2] for q in parts])
 fx=(x-ox)/C;fz=(z-oz)/C;i=np.clip(np.floor(fx).astype(np.int64),0,W-2);j=np.clip(np.floor(fz).astype(np.int64),0,grid['height']-2);u=fx-i;v=fz-j
 corners=np.stack([j*W+i,j*W+i+1,(j+1)*W+i,(j+1)*W+i+1],1);near=mutable[corners].any(1);corners=corners[near];u=u[near];v=v[near];top=top[near]
 # (the ground of a cell is its two triangles, split as water_crossings.grid_sampler and the runtime split it)
 lower=u+v<=1;weights=np.where(lower[:,None],np.stack([1-u-v,u,v,np.zeros_like(u)],1),np.stack([np.zeros_like(u),1-v,1-u,u+v-1],1))
 for _ in range(rounds):
  ground=(result[corners]*scale*weights).sum(1);over=ground-(top-.01);rows=np.flatnonzero(over>1e-9)
  if not len(rows):break
  # (the free corners of a cell take up what its fixed ones cannot: each drops by the excess over their share of the sample)
  share=(weights[rows]*mutable[corners[rows]]).sum(1);need=np.where(share>.02,over[rows]/np.maximum(share,.02),0.)
  drop=np.zeros(result.size);hit=corners[rows];np.maximum.at(drop,hit.ravel(),np.repeat(need,4));drop[~mutable]=0
  if not drop.any():break
  marks=np.flatnonzero(drop);result[marks]=np.floor(result[marks]-drop[marks]/scale-1e-6).astype(result.dtype)
 return result


def half_width_max(roads):
 """The widest corridor half width among `roads` (north_overpasses.half_width), 0 for none."""
 from north_overpasses import half_width
 return max((half_width(r) for r in roads),default=0.)


def shared_roadway(fine):
 """The part of a roadway that a street shares with a strip's deck, beyond the strip's own edge: quads from that edge
 to the street's far edge (measure) between the strip's stations."""
 P,N=fine['pts'],fine['nrm'];out=[]
 for side,(sign,edge) in enumerate(((1.,fine['left']),(-1.,fine['right']))):
  far=fine['far'][side]
  for k in range(len(P)-1):
   if math.isnan(far[k]) or math.isnan(far[k+1]) or (far[k]<=edge[k] and far[k+1]<=edge[k+1]):continue
   poly=Polygon([P[k]+N[k]*sign*edge[k],P[k]+N[k]*sign*max(edge[k],far[k]),P[k+1]+N[k+1]*sign*max(edge[k+1],far[k+1]),P[k+1]+N[k+1]*sign*edge[k+1]])
   if poly.is_valid and poly.area>1e-6:out.append(poly)
 return out


def grade(plans,strips,grid,heights,streets,joined,footprints,water,decks,existing,lip):
 """Lay the graded grid under each deck that rides its ground, across every cell its roadway passes over
 (`strips`: (plan, apron) pairs), as the grader levels a street corridor: DROP under the deck. Under a deck inside
 its street landing (an apron that is not `graded`) the ground is only raised to that, never lowered: it is the street's.
 A vertex keeps its height in the corridor of a surface street that does not join the road, under a building, in
 mapped water and under a road of another stage, with two exceptions the survey decides:

 - the deck's own surveyed roadway (a vertex within its paved edges) is the deck's ground whatever street's class
   width reaches across it, and
 - where a street shares the roadway (no curb between the two: `fine` of the apron), the shared pavement is one
   surface as far as that street's far edge, whatever class width reaches across it: its ground is raised to fall
   CROSSFALL from the deck's edge, and never lowered, and
 - a street's corridor does not reach across a flush deck: a vertex with the deck's lanes between it and the
   street's line is not that street's ground (its class width, 12 m for a lane 6 m wide, had kept a ditch on the
   far side of Storrow Drive West).

 A vertex under another of the stage's decks stays under that deck too, and the set vertices are lowered where the
 ground between them would still reach a pavement (settle; `lip` is the stage's LANDING_LIP). Returns the new int16 grid."""
 from north_overpasses import Window,covered,half_width
 scale=grid.get('scale',.01);W=grid['width'];C=grid['cellSize'];ox,oz=grid['originX'],grid['originZ'];result=heights.copy();wanted={}
 beside=[r for r in streets if id(r) not in joined];blines=np.asarray([LineString(r['points']) for r in beside],dtype=object);btree=STRtree(blines) if len(blines) else None
 for plan,apron in strips:
  region=strip(apron);fine=apron.get('fine')
  if region.is_empty:continue
  if fine is not None:
   more=shared_roadway(fine)
   if more:region=shapely.union_all([region,*more])
  elif not apron['graded']:continue
  x0,z0,x1,z1=region.bounds;i0,i1=int((x0-ox)//C),int((x1-ox)//C);j0,j1=int((z0-oz)//C),int((z1-oz)//C)
  gi,gj=np.meshgrid(np.arange(i0,i1+1),np.arange(j0,j1+1));gi=gi.ravel();gj=gj.ravel()
  cells=shapely.box(ox+gi*C,oz+gj*C,ox+(gi+1)*C,oz+(gj+1)*C);hit=shapely.intersects(region,cells)
  if not hit.any():continue
  v=np.unique(np.concatenate([(gj[hit]+b)*W+gi[hit]+a for a in (0,1) for b in (0,1)]));x=ox+(v%W)*C;z=oz+(v//W)*C;points=shapely.points(x,z)
  along=np.asarray(plan.along,float);y=np.asarray(plan.y,float);d=np.clip(shapely.line_locate_point(plan.line,points),float(along[apron['a']]),float(along[apron['b']]))
  low=np.interp(d,along,y)-DROP;own=np.zeros(len(v),bool);only_up=np.full(len(v),not apron['graded']);across=[()]*len(v)
  if fine is not None and len(fine['pts'])>=2:
   # where each vertex lies across the roadway at its nearest station: inside the paved edges, in a street's share, or beyond both
   P,N=fine['pts'],fine['nrm'];cum=np.concatenate([[0.],np.cumsum(np.hypot(*np.diff(P,axis=0).T))]);s=shapely.line_locate_point(LineString(P),points)
   k=np.clip(np.rint(np.interp(s,cum,np.arange(len(P)))).astype(np.int64),0,len(P)-1);off=(x-P[k,0])*N[k,0]+(z-P[k,1])*N[k,1];right=off<0;dist=np.abs(off)
   edge=np.where(right,np.asarray(fine['right'])[k],np.asarray(fine['left'])[k]);far=np.where(right,np.asarray(fine['far'][1])[k],np.asarray(fine['far'][0])[k])
   own=dist<=edge+.5;share=~own&~np.isnan(far)&(dist<=far+.5);low=np.where(share,low-CROSSFALL*np.maximum(dist-edge,0.),low);only_up|=share;own|=share
   # A street's class width does not reach across the deck: a vertex with the deck's lanes between it and the street's line is not that street's ground.
   if apron['graded'] and btree is not None:
    rest=np.flatnonzero(~own)
    for j in sorted(btree.query(region.buffer(half_width_max(beside)+C)).tolist()) if len(rest) else ():
     foot=shapely.get_coordinates(shapely.line_interpolate_point(blines[j],shapely.line_locate_point(blines[j],points[rest])));there=(foot[:,0]-P[k[rest],0])*N[k[rest],0]+(foot[:,1]-P[k[rest],1])*N[k[rest],1]
     for q in rest[(there*off[rest]<0)&(np.abs(there)>.5)&(dist[rest]>.5)].tolist():across[q]=(*across[q],j)
  cur=result[v]*scale
  for q in range(len(v)):
   if only_up[q] and low[q]<=cur[q]+scale/2:continue
   # (a vertex in a strip's own roadway takes that road's level before any strip that merely passes over its cell: of two roads side by side each keeps its own ground)
   key=int(v[q]);claim=(not bool(own[q]),float(low[q]))
   if key not in wanted or claim<wanted[key][0]:wanted[key]=(claim,bool(own[q]),bool(only_up[q]),across[q])
 if not wanted:return result
 vs=np.asarray(sorted(wanted),dtype=np.int64);gx=ox+(vs%W)*C;gz=oz+(vs//W)*C;pts=shapely.points(gx,gz);entries=[wanted[v] for v in vs.tolist()]
 target=np.asarray([e[0][1] for e in entries]);roadway=np.asarray([e[1] for e in entries],bool);only_up=np.asarray([e[2] for e in entries],bool);keep=np.zeros(len(vs),bool)
 win=Window(grid,(float(gx.min())-C,float(gz.min())-C,float(gx.max())+C,float(gz.max())+C));area=shapely.box(*win.bounds)
 near=[j for j,r in enumerate(beside) if blines[j].buffer(half_width(r)+C).intersects(area)];shielded={}
 for q,e in enumerate(entries):
  for j in e[3]:shielded.setdefault(j,[]).append(q)
 plain=[beside[j] for j in near if j not in shielded]
 if plain:keep|=np.isin(vs,win.index[covered(grid,win,plain)])
 for j in near:
  if j in shielded:
   mask=np.isin(vs,win.index[covered(grid,win,[beside[j]])]);mask[shielded[j]]=False;keep|=mask
 # the deck's own pavement, its surveyed roadway and the pavement a street shares with it win over a street corridor reaching across them
 own=roadway.copy()
 for deck in decks:
  d=shapely.line_locate_point(deck.line,pts);e=shapely.distance(deck.line,pts);half=np.interp(d,deck.along,deck.widths)/2;under=e<=half+.5
  # (every vertex of a cell a deck's pavement reaches into stays under that deck, so no ground slopes up into it; one in another road's
  # own roadway keeps that road's level, and settle lowers it only as far as this deck's pavement needs)
  own|=under;yd=np.interp(d,deck.along,deck.y);target=np.where(under|((e<=half+C*1.5)&~roadway),np.minimum(target,yd-DROP),target)
 keep&=~own
 # (the cell a route lands in on its street keeps its four corners: the landing is the street's ground to the centimetre, whatever roadway reaches it)
 pinned=set()
 for plan in plans:
  for e,kind in enumerate(getattr(plan,'ends',None) or ()):
   if kind and kind[0]=='street':
    q=(getattr(plan,'solved_points',None) or plan.points)[0 if e==0 else -1];i=int((q[0]-ox)//C);j=int((q[1]-oz)//C);pinned|={(j+b)*W+i+a for a in (0,1) for b in (0,1)}
 if pinned:keep|=np.isin(vs,np.fromiter(sorted(pinned),dtype=np.int64))
 houses=[Polygon(f).buffer(I.BUILDING) for f in footprints(win.bounds) if len(f)>=3]
 if houses:
  for k,_ in zip(*STRtree(houses).query(pts,predicate='within')):keep[k]=True
 wet=[poly for poly in water if poly.intersects(area)]
 if wet:
  for k,_ in zip(*STRtree([poly.buffer(2) for poly in wet]).query(pts,predicate='within')):keep[k]=True
 other=[LineString(r['points']).buffer(r['width']/2+1) for r in existing if LineString(r['points']).intersects(area)]
 if other:
  for k,_ in zip(*STRtree(other).query(pts,predicate='within')):keep[k]=True
 new=np.floor(target/scale+1e-6).astype(np.int64);change=~keep&(new!=result[vs])&(~only_up|(new>result[vs]))
 result[vs[change]]=new[change].astype(result.dtype)
 return settle(plans,grid,result,vs[~keep],lip)


def trim(plans,pairs,ground,step=.5):
 """Keep the paving beside each deck's lanes only where the ground lies FLUSH under the deck: outward from the
 deck's own edge on each side as far as it does without a break, turning in no faster than APRON_RATE. The ground
 cannot follow a deck everywhere (another road's level a lane away, a building, a ramp that has left the ground
 over the road it crosses), and a strip of asphalt lying a step below its deck is no part of that road. `ground`
 is the graded ground after grade. The aprons' edges and each plan's `roadway` are replaced; returns the metres of edge pulled in."""
 pulled=0.
 for plan,apron in pairs:
  fine=apron.get('fine')
  if fine is None:continue
  P,N,y=fine['pts'],fine['nrm'],fine['y'];f=np.concatenate([[0.],np.cumsum(np.hypot(*np.diff(P,axis=0).T))]) if len(P)>1 else np.zeros(1);edges=[]
  for sign,edge,deck in ((1.,fine['left'],fine['deck'][0]),(-1.,fine['right'],fine['deck'][1])):
   out=np.asarray(deck,float).copy()
   for k in range(len(P)):
    reach=float(edge[k]-deck[k])
    if reach<=.01:continue
    # (the deck's own edge first: a deck that stands off its ground there has no paving beside it)
    o=float(deck[k])-.3;q=P[k]+N[k]*sign*o
    if y[k]-ground(float(q[0]),float(q[1]))>FLUSH:continue
    got=0.
    for j in range(1,int(math.ceil(reach/step-1e-9))+1):
     o=min(float(edge[k]),float(deck[k])+j*step);q=P[k]+N[k]*sign*(o-.05)
     if y[k]-ground(float(q[0]),float(q[1]))>FLUSH:break
     got=o-float(deck[k])
    out[k]=deck[k]+got
   # (the ground crosses FLUSH cell by cell: the least extent within TRIM_REACH along the road, then turned in and out at half APRON_RATE)
   lo=np.searchsorted(f,f-TRIM_REACH,side='left');hi=np.searchsorted(f,f+TRIM_REACH,side='right');out=np.asarray([out[a:b].min() for a,b in zip(lo.tolist(),hi.tolist())])
   out=np.maximum(np.asarray(lipschitz(out,f,APRON_RATE/2,lower=True)),np.asarray(deck,float));pulled+=float(np.sum(np.asarray(edge,float)-out))*STEP;edges.append(out)
  fine['left'],fine['right']=edges;lp=P+N*edges[0][:,None];rp=P-N*edges[1][:,None];keep=compress(lp,rp)
  apron['left']=[[round(float(x),2),round(float(z),2)] for x,z in lp[keep]];apron['right']=[[round(float(x),2),round(float(z),2)] for x,z in rp[keep]]
  for i,j in zip(range(apron['a'],apron['b']+1),fine['at']):plan.roadway[i]=(round(float(edges[0][j]-plan.shift[i]),2),round(float(edges[1][j]+plan.shift[i]),2))
 return round(pulled,1)


def survey(plans,curbs,streets,ground,raw,buildings,least):
 """Measure every plan against the curb survey, the roadways held clear of the buildings beside them: {plan id: measurement}."""
 measured=measure(plans,curbs,streets,ground,raw,least)
 for plan in plans:measured[plan.id]['capped']=building_caps(plan,measured[plan.id],buildings)
 return measured


def apply(plans,measured,gores,least,hold):
 """Correct every plan to its measured roadway but for the stations in `hold` ({plan id: stations}). Returns (aprons with their plans, summary)."""
 pairs=[];summary={}
 for plan in plans:
  m=measured[plan.id];joints=set(gores.get(plan.id,()))|{k for k,_ in plan.junctions};held=hold.get(plan.id,())
  moved,sized=correct(plan,m,joints,least,held);own=aprons(plan,m);pairs+=[(plan,a) for a in own]
  fo=m['open'];both=fo&~np.isnan(m['L'])&~np.isnan(m['R'])
  if moved or sized or own:
   summary[plan.id]={'openMeters':round(float(fo.sum()*STEP)),'surveyedMeters':round(float(both.sum()*STEP)),'movedStations':int(moved),'resizedStations':int(sized),'maxShift':round(max(abs(s) for s in plan.shift),2),
    'widest':round(max(plan.widths),2),'narrowest':round(min(plan.widths),2),'aprons':len(own),'heldStations':len(held),'heldFromBuildings':int(m['capped'])}
 return pairs,summary


def check(routes,aprons_,decks,ground):
 """The installed result. `routes` ({route: [records in order]}) change width no faster than WIDTH_RATE allows over a
 station (STEP_SLACK for the rounding of a width and the floors beside the lanes). Every apron ({'road','left','right'},
 `road` the route) is a surface. Returns counts: the stations compared and the aprons."""
 steps=0
 for name,chain in routes.items():
  w=[];s=[];base=0.
  for r in chain:
   along=stations(r['points']);k=1 if w else 0;w+=list(r['deckWidths'][k:]);s+=[base+a for a in along[k:]];base+=along[-1]
  for i in range(1,len(w)):
   steps+=1;assert abs(w[i]-w[i-1])/2<=WIDTH_RATE*max(.5,s[i]-s[i-1])+STEP_SLACK,f'the pavement of {name} steps from {w[i-1]} to {w[i]} m, {s[i]:.0f} m along it'
 for a in aprons_:
  assert a['road'] in routes and len(a['left'])==len(a['right'])>=2 and strip(a).area>1,f"the paved roadway beside {a['road']} is no surface"
 return {'widthStations':steps,'aprons':len(aprons_)}
