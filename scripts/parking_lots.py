"""Parking stalls of the surface lots.

build-street-surfaces.py paves OpenStreetMap's surface parking (`amenity=parking`) as asphalt fills, which read as
blank pavement beside the streets: a lot shows what it is by the cars standing in it. This module lays the stalls
of each lot out, and the runtime parks cars in a share of those near the player (src/simulation/parking-lots.ts).

- Along its mapped aisles (`service=parking_aisle` ways, clipped to the lot): a row of stalls square to the aisle on
  each side, STALL wide and deep, the aisle AISLE wide between them. That follows the lot as it is striped: rows
  turn with the aisles, an aisle along the lot's edge has one row.
- A lot with no aisle mapped is laid out in rows along the longer side of its smallest enclosing rectangle: two
  rows back to back, an aisle, two rows, centred in the lot; one too shallow for a stall across is a row of
  kerbside bays along it (`street_side` and `lane` parking).

A stall lies inside its lot INSET from the edge, clear of every aisle and service road through the lot (their
driving width), of the buildings, of the street roadways, of the highway decks and cuts with DECK_ROOM beside them
(build-street-surfaces.py hands those in as `blocked`) and of the stalls already laid, so cars never stand in a
lane or under the low end of a ramp. Lots under MIN_STALLS stalls are left empty (a pair of bays in a yard reads as a driveway). Structured,
underground and rooftop parking has no stalls (street_surfaces.UNDRAWN_PARKING).

A stall also stands on what the tiles draw, which build-street-surfaces.py reads back from them once the surfaces
are compiled. It lies wholly on the asphalt drawn for the lots and driveways (`drawn`), and a lot is laid out as
it is drawn (drawn_pieces): an OpenStreetMap lot beyond the playable coverage has no asphalt and so no stalls
(13,047 stood on bare ground there), and one across the coverage's edge or cut around a sidewalk of the Sidewalk
Inventory is laid out part by part, its rows centred in what is paved. A stall touches no street pavement as
drawn (among `blocked`): the roadway measured between the curbs is not a ribbon of its median width about the
centre line, and where a lot lies in a wide or lopsided roadway (Newmarket Square, whose parking is mapped inside
its curbs) the stalls stood in the street, their cars fixed in the travel surface. And it touches no street
sidewalk as drawn (also among `blocked`): the band beside a street with no surveyed sidewalk lies under the asphalt
of a lot mapped out to the curb, and it is where the street's walkers pace and its trees and lamps stand (3,534
stalls stood on one). validate-city.py holds every package to all three (misplaced).

No two stalls share ground. OpenStreetMap holds a few lots twice: those are laid out once, as their union (merged),
and a lot that still overlaps another keeps off the stalls already laid there (263 stalls stood exactly on another
and 997 pairs of cars overlapped, nearly all in one lot of 3.5 hectares in Cambridge that two ways trace).
validate-city.py holds every package to that as well (crowded).

Per tile the stalls are a flat list [x, z, yaw, ...]: centimetres from the tile origin and the heading of a car
parked nose in, in hundredths of a degree from +z toward +x (the runtime's vehicle yaw). Deterministic."""
import math
import numpy as np
import shapely
from shapely.geometry import LineString,Polygon
from shapely.strtree import STRtree

STALL=(2.6,5.2)   # across and along a parked car
BAY=(2.3,6.0)     # a kerbside bay: across and along
AISLE=6.4         # driving width between two rows
LANE=5.0          # driving width kept clear along a service road through a lot
INSET=.3          # a stall keeps this far inside its lot
GAP=.02           # two stalls may touch
MIN_STALLS=4
MIN_LOT=MIN_STALLS*STALL[0]*STALL[1]*.8   # a lot, or a drawn part of one, smaller than this is not laid out
MIN_AISLE=5.0     # an aisle piece shorter than this carries no row
DECK_ROOM=1.0     # no stall this close to a highway deck or cut, on the ground or overhead: a ramp coming down through a lot has its rails, its piers and its low end there
ON_ASPHALT=.05    # the asphalt a tile draws is its outline simplified and rounded to the centimetre: a stall may reach this far beyond it
SAME_LOT=.5       # two mapped lots that share this much of the smaller one are one lot mapped twice, or a part of it mapped again
UNDRAWN={'underground','multi-storey','rooftop','garage_boxes','carports','sheds'}


def features(elements,xy):
 """Surface lots (polygons), their aisles and the other service roads (lines) from an Overpass extract, as
 street_surfaces.driveway_features reads it."""
 lots=[];aisles=[];roads=[]
 for e in elements:
  if e.get('type')!='way' or len(e.get('geometry') or [])<2:continue
  tags=e.get('tags',{})
  try:layer=int(str(tags.get('layer','0')).split(';')[0])
  except ValueError:layer=0
  if layer<0 or tags.get('tunnel') not in (None,'no') or tags.get('covered')=='yes' or tags.get('location')=='underground':continue
  pts=[xy(g['lon'],g['lat']) for g in e['geometry']];closed=len(pts)>=4 and pts[0]==pts[-1]
  if tags.get('amenity')=='parking':
   if tags.get('parking') in UNDRAWN or 'building' in tags or not closed or tags.get('access') in ('no',):continue
   polygon=Polygon(pts).buffer(0)
   if polygon.geom_type=='Polygon' and polygon.area>=MIN_LOT:lots.append(polygon)
  elif tags.get('highway')=='service' and not (tags.get('area')=='yes' and closed):
   (aisles if tags.get('service')=='parking_aisle' else roads).append(LineString(pts))
 return lots,aisles,roads


def rectangle(c,u,half_u,half_v):
 """Corners of a rectangle centred at `c` with half extents along the unit vector `u` and across it."""
 v=(-u[1],u[0]);return [(c[0]+u[0]*a*half_u+v[0]*b*half_v,c[1]+u[1]*a*half_u+v[1]*b*half_v) for a,b in ((-1,-1),(1,-1),(1,1),(-1,1))]


def heading(d):
 """Vehicle yaw (0 faces +z, a quarter turn faces +x) of the direction `d`, in hundredths of a degree."""
 return int(round(math.degrees(math.atan2(d[0],d[1]))*100))%36000


def aisle_rows(lot,pieces):
 """Candidate stalls along a lot's aisle pieces: (centre, direction the car faces, half extent along it, half extent across it)."""
 out=[]
 for line in pieces:
  if line.length<MIN_AISLE:continue
  count=int((line.length-.6)//STALL[0]);start=(line.length-count*STALL[0])/2+STALL[0]/2
  for k in range(count):
   s=start+k*STALL[0];p=line.interpolate(s);a=line.interpolate(max(0,s-.5));b=line.interpolate(min(line.length,s+.5));t=(b.x-a.x,b.y-a.y);l=math.hypot(*t) or 1;t=(t[0]/l,t[1]/l)
   for side in (1,-1):
    n=(-t[1]*side,t[0]*side);off=AISLE/2+STALL[1]/2;out.append(((p.x+n[0]*off,p.y+n[1]*off),n,STALL[1]/2,STALL[0]/2))
 return out


def directions(lot,inside=()):
 """Row directions to try in a lot, as unit vectors pointing toward +x (then +z): along its longest aisle piece, or
 along both sides of its smallest enclosing rectangle and along its longest edge."""
 def unit(dx,dz):
  l=math.hypot(dx,dz)
  if l<1e-6:return None
  u=(dx/l,dz/l);return (-u[0],-u[1]) if (round(u[0],6),round(u[1],6))<(0,0) else u
 out=[]
 if inside:
  line=max(inside,key=lambda g:g.length);c=list(line.coords);out.append(unit(c[-1][0]-c[0][0],c[-1][1]-c[0][1]))
 else:
  box=lot.minimum_rotated_rectangle
  if box.geom_type=='Polygon':
   c=list(box.exterior.coords);out+=[unit(c[1][0]-c[0][0],c[1][1]-c[0][1]),unit(c[2][0]-c[1][0],c[2][1]-c[1][1])]
  ring=list(lot.exterior.coords);k=max(range(len(ring)-1),key=lambda i:(round(math.dist(ring[i],ring[i+1]),3),-i));out.append(unit(ring[k+1][0]-ring[k][0],ring[k+1][1]-ring[k][1]))
 kept=[]
 for u in out:
  if u is not None and all(abs(u[0]*q[0]+u[1]*q[1])<.9995 for q in kept):kept.append(u)
 return kept


def block_rows(lot,u):
 """Candidate stalls in rows along the unit vector `u`, laid over the lot's extent in that frame: a row, an aisle,
 two rows back to back, an aisle, ... centred across it; one too shallow for a stall across is a row of kerbside
 bays along it."""
 v=(-u[1],u[0]);c=np.asarray(lot.exterior.coords);a=c@np.asarray(u);b=c@np.asarray(v);length=float(a.max()-a.min());depth=float(b.max()-b.min());ca=float(a.max()+a.min())/2;cb=float(b.max()+b.min())/2
 centre=(u[0]*ca+v[0]*cb,u[1]*ca+v[1]*cb);out=[]
 if depth<STALL[1]+2*INSET:
  if depth<BAY[0]+2*INSET:return []
  count=int((length-2*INSET)//BAY[1]);start=-count*BAY[1]/2+BAY[1]/2
  return [((centre[0]+u[0]*(start+k*BAY[1]),centre[1]+u[1]*(start+k*BAY[1])),u,BAY[1]/2,BAY[0]/2) for k in range(count)]
 period=2*STALL[1]+AISLE;usable=depth-2*INSET
 if usable<STALL[1]+AISLE:offsets=[(0.0,1)]                                          # one row and what is left to drive on
 elif usable<period:offsets=[(-(usable-STALL[1])/2,-1)]+([((usable-STALL[1])/2,1)] if usable>=2*STALL[1]+AISLE-.01 else [])
 else:
  # (a row along each edge with the aisles and back-to-back rows between them, as a lot is striped)
  modules=int((usable+1e-6)//period);total=modules*period;first=-total/2;offsets=[]
  for m in range(modules):offsets+=[(first+m*period+STALL[1]/2,-1),(first+m*period+STALL[1]+AISLE+STALL[1]/2,1)]
 count=int((length-2*INSET)//STALL[0]);start=-count*STALL[0]/2+STALL[0]/2
 for off,face in offsets:
  for k in range(count):
   d=start+k*STALL[0];out.append(((centre[0]+u[0]*d+v[0]*off,centre[1]+u[1]*d+v[1]*off),(v[0]*face,v[1]*face),STALL[1]/2,STALL[0]/2))
 return out


def lay(candidates,area,lanes,block_tree,taken):
 """The candidates that lie in `area`, clear of the driving lanes, of `block_tree`'s shapes and of the stalls in `taken` (a geometry or None): (accepted candidates, taken with them)."""
 if not candidates:return [],taken
 shapes=shapely.polygons([rectangle(c,d,hu-GAP,hv-GAP) for c,d,hu,hv in candidates]);ok=shapely.contains(area,shapes)
 if lanes is not None:ok&=~shapely.intersects(lanes,shapes)
 if block_tree is not None:
  hit,_=block_tree.query(shapes,predicate='intersects');ok[hit]=False
 if taken is not None:ok&=~shapely.intersects(taken,shapes)
 rows=np.flatnonzero(ok).tolist()
 if not rows:return [],taken
 # (two aisles' rows can reach the same ground: the first laid keeps it)
 kept=[];tree=None
 for k in rows:
  if kept and len(STRtree(shapes[kept]).query(shapes[k],predicate='intersects')):continue
  kept.append(k)
 return [candidates[k] for k in kept],shapely.union_all([*( [taken] if taken is not None else []),*shapes[kept]])


def polygonal(geometry):
 """The polygons of a geometry as one geometry (an intersection can hand back lines and points with them)."""
 if geometry.geom_type in ('Polygon','MultiPolygon'):return geometry
 return shapely.union_all([g for g in getattr(geometry,'geoms',[]) if g.geom_type in ('Polygon','MultiPolygon')])


def tile_polygons(headers,field):
 """The polygons the tiles draw for `field` (`streetPavement`, `driveways`: rings in world metres, an outline and its
 holes), as they are written: what the runtime drapes, to the centimetre."""
 out=[]
 for tile in headers.values():
  for rings in tile.get(field) or []:
   polygon=Polygon(rings[0],rings[1:])
   if not polygon.is_valid:polygon=polygonal(shapely.make_valid(polygon))
   out+=[g for g in getattr(polygon,'geoms',[polygon]) if g.geom_type=='Polygon' and g.area>0]
 return out


def drawn_pieces(lot,drawn,tree):
 """A lot as the tiles draw it. Where their asphalt covers the ground its stalls can take (the lot INSET from its
 edge, to within ON_ASPHALT) it is the lot itself, laid out as mapped. Otherwise it is the parts of it the asphalt
 does cover, each laid out as a lot of its own with its rows centred in it: a lot across the edge of the coverage,
 or one cut around a sidewalk. A lot with no asphalt at all (beyond the coverage) has none."""
 parts=[drawn[j] for j in sorted(tree.query(lot,predicate='intersects').tolist())] if tree is not None else []
 if not parts:return []
 asphalt=shapely.union_all(parts)
 if asphalt.buffer(ON_ASPHALT).contains(lot.buffer(-INSET)):return [lot]
 pieces=polygonal(lot.intersection(asphalt));pieces=[g for g in getattr(pieces,'geoms',[pieces]) if g.geom_type=='Polygon' and g.area>=MIN_LOT]
 return sorted(pieces,key=lambda g:(round(g.centroid.x,2),round(g.centroid.y,2),round(g.area,2)))


def merged(lots):
 """The lots, with those mapped more than once dissolved into one. OpenStreetMap holds a few lots twice (a second
 way drawn over the first, a section of a lot mapped again inside it, the two levels of a terminal's kerb): laid
 out one by one, their rows fell on each other, the same stall twice where both followed one aisle. Lots that
 share SAME_LOT of the smaller one are joined, group by group; every other lot is handed back untouched."""
 lots=list(lots)
 if len(lots)<2:return lots
 a,b=STRtree(lots).query(lots,predicate='intersects');group=list(range(len(lots)))
 def root(i):
  while group[i]!=i:group[i]=group[group[i]];i=group[i]
  return i
 for i,j in sorted(zip(a.tolist(),b.tolist())):
  if i<j and lots[i].intersection(lots[j]).area>=SAME_LOT*min(lots[i].area,lots[j].area):group[root(j)]=root(i)
 members={}
 for i in range(len(lots)):members.setdefault(root(i),[]).append(i)
 out=[]
 for same in members.values():
  if len(same)==1:out.append(lots[same[0]]);continue
  whole=polygonal(shapely.union_all([lots[i] for i in same]));out+=[g for g in getattr(whole,'geoms',[whole]) if g.geom_type=='Polygon']
 return out


def stalls(lots,aisles,roads,blocked=(),drawn=None):
 """The stalls of every lot: [(x, z, yaw)], yaw in hundredths of a degree. `blocked` are shapes no stall may touch
 (buildings, street roadways, the street pavement and the street sidewalks as drawn). `drawn`, when given, is the
 asphalt drawn for lots and driveways: a stall lies wholly on it, and a lot is laid out as it is drawn (drawn_pieces).
 A lot mapped twice is laid out once (merged), and where two lots still overlap, the one laid out second keeps off
 the stalls of the first: no two stalls share ground."""
 aisle_tree=STRtree(aisles) if aisles else None;road_tree=STRtree(roads) if roads else None;blocked=list(blocked);block_tree=STRtree(blocked) if blocked else None;out=[]
 drawn=None if drawn is None else list(drawn);drawn_tree=STRtree(drawn) if drawn else None
 lots=sorted(merged(lots),key=lambda g:(round(g.centroid.x,2),round(g.centroid.y,2),round(g.area,2)));lot_tree=STRtree(lots) if lots else None;laid={}
 for k,mapped in enumerate(lots):
  # (the stalls already laid in the lots this one overlaps)
  beside=[shape for j in sorted(lot_tree.query(mapped,predicate='intersects').tolist()) if j!=k for shape in laid.get(j,[])];others=shapely.union_all(beside) if beside else None;laid[k]=[]
  for lot in ([mapped] if drawn is None else drawn_pieces(mapped,drawn,drawn_tree)):
   area=lot.buffer(-INSET)
   if area.is_empty:continue
   inside=[]
   if aisle_tree is not None:
    for j in sorted(aisle_tree.query(lot,predicate='intersects').tolist()):
     part=aisles[j].intersection(lot);inside+=[g for g in getattr(part,'geoms',[part]) if g.geom_type=='LineString' and g.length>=MIN_AISLE]
   through=[roads[j] for j in sorted(road_tree.query(lot,predicate='intersects').tolist())] if road_tree is not None else []
   drive=[g.buffer(AISLE/2-.25,cap_style=2) for g in inside]+[g.buffer(LANE/2,cap_style=2) for g in through];lanes=shapely.union_all(drive) if drive else None
   # along the mapped aisles first, then rows over what they leave (along the longest aisle); a lot with none takes the row direction that holds the most
   kept,taken=lay(aisle_rows(lot,inside),area,lanes,block_tree,others) if inside else ([],others);best=[]
   for u in directions(lot,inside):
    more,_=lay(block_rows(lot,u),area,lanes,block_tree,taken)
    if len(more)>len(best):best=more
   kept+=best
   if len(kept)<MIN_STALLS:continue
   out+=[(round(c[0],2),round(c[1],2),heading(d)) for c,d,_,_ in kept];laid[k]+=[Polygon(rectangle(c,d,hu-GAP,hv-GAP)) for c,d,hu,hv in kept]
 return out


def ground(found):
 """The ground a stall and a kerbside bay share, for each of the stalls `found` [(x, z, yaw)] as a package holds
 them: a centimetre inside what `stalls` tested, for the rounding of the stored place."""
 slack=GAP+.01;along=min(STALL[1],BAY[1])/2-slack;across=min(STALL[0],BAY[0])/2-slack
 return shapely.polygons([rectangle((x,z),(math.sin(math.radians(yaw/100)),math.cos(math.radians(yaw/100))),along,across) for x,z,yaw in found])


def crowded(found):
 """The pairs of stalls of a package that share ground: [((x, z), (x, z))]. validate-city.py holds every package to
 none: two cars in one place are drawn through each other, collide as two bodies and count twice in the pool."""
 if len(found)<2:return []
 shapes=ground(found);a,b=STRtree(shapes).query(shapes,predicate='intersects')
 return [(tuple(found[i][:2]),tuple(found[j][:2])) for i,j in sorted(zip(a.tolist(),b.tolist())) if i<j]


def misplaced(found,pavement,drawn,walks=()):
 """Of the stalls `found` [(x, z, yaw)] as a package holds them, those that touch the street pavement or a street
 sidewalk, or do not lie wholly on the asphalt of a lot (`pavement`, `walks`, `drawn`: tile_polygons of the same
 package): [(x, z, why)], on the ground a stall and a bay share (ground). validate-city.py holds every package to an
 empty list."""
 if not found:return []
 shapes=ground(found);out={}
 for shut,why in ((list(walks),'on a street sidewalk'),(list(pavement),'in the street pavement')):
  if shut:
   for i in sorted(set(STRtree(shut).query(shapes,predicate='intersects')[0].tolist())):out[i]=why
 grown=[g.buffer(ON_ASPHALT) for g in drawn];tree=STRtree(grown) if grown else None
 on=set(tree.query(shapes,predicate='within')[0].tolist()) if tree is not None else set()
 for i in range(len(found)):
  if i in on or i in out:continue
  # (asphalt clipped at a tile border, or cut in parts, is one surface)
  parts=[grown[j] for j in sorted(tree.query(shapes[i],predicate='intersects').tolist())] if tree is not None else []
  if not parts or not shapely.union_all(parts).contains(shapes[i]):out[i]='off the asphalt of its lot'
 return [(found[i][0],found[i][1],why) for i,why in sorted(out.items())]


def in_world(headers):
 """The stalls of a package's tiles back in world metres: [(x, z, yaw)]."""
 return [(tile['tx']*tile['size']+flat[i]/100,tile['tz']*tile['size']+flat[i+1]/100,flat[i+2]) for tile in headers.values() for flat in [tile.get('parking') or []] for i in range(0,len(flat),3)]


def by_tile(found,size):
 """{(tx, tz): flat [x, z, yaw, ...]} with positions in centimetres from each tile's origin."""
 out={}
 for x,z,yaw in found:
  tx,tz=math.floor(x/size),math.floor(z/size);out.setdefault((tx,tz),[]).extend([int(round((x-tx*size)*100)),int(round((z-tz*size)*100)),yaw])
 return out
