"""Driveways beside the houses of the northern towns, laid out from the assessor parcels.

Melrose, Malden, Medford and Everett houses mostly keep one asphalt lane in the
wider side yard, from the sidewalk to a detached garage behind the house or to
the back corner of the house; OpenStreetMap maps few of them. Each generated
house (a footprint build-metro.py shaped from its parcel's style) takes the
street nearest its footprint; the side yard with more room wins and holds a lane
2.6 to 3.2 m wide, 0.6 m off the wall, starting behind the 2.9 m sidewalk band
and staying on its parcel and clear of every other building. A garage on the
parcel gets the lane run up to its door, with a pad behind the house when it
stands behind it. Parcels an OpenStreetMap service road already reaches are
left alone. Returns the lane polygons and, per lane, the curb stretch to cut so
the sidewalk meets a dropped curb.
"""
import json,math
import numpy as np
from shapely.geometry import LineString,Point,Polygon,box
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely.strtree import STRtree

NORTH=('Everett','Malden','Medford','Melrose')
GAP=.6;WIDEST=3.2;NARROWEST=2.6;WALK=2.9;REACH=40;FLARE=.75;CLEAR=.25


def parcel_polygons(source_dir,xy):
 """One polygon per assessor parcel (condominium unit records repeat their parcel)."""
 out=[]
 for town in NORTH:
  path=source_dir/f'parcels-{town.lower()}.json'
  if not path.exists():continue
  seen=set()
  for f in json.loads(path.read_text())['features']:
   g=f.get('geometry');p=f['properties'];key=p.get('LOC_ID') or p.get('MAP_PAR_ID') or str(p['OBJECTID'])
   if not g or key in seen or g['type'] not in ('Polygon','MultiPolygon'):continue
   seen.add(key)
   for rings in ([g['coordinates']] if g['type']=='Polygon' else g['coordinates']):
    poly=Polygon([xy(*c[:2]) for c in rings[0]],[[xy(*c[:2]) for c in r] for r in rings[1:]]).buffer(0)
    if poly.geom_type=='Polygon' and poly.area>=40:out.append(poly)
 return out


class Frame:
 """Street frame at a house: u along the street, v away from it."""
 def __init__(self,q,t,n):self.q=np.asarray(q,float);self.t=np.asarray(t,float);self.n=np.asarray(n,float)
 def local(self,geom):
  pts=np.asarray(geom.exterior.coords if hasattr(geom,'exterior') else geom.coords)-self.q
  return np.column_stack([pts@self.t,pts@self.n])
 def poly(self,geom):return Polygon(self.local(geom)).buffer(0)
 def world(self,poly):
  pts=np.asarray(poly.exterior.coords);return Polygon(self.q+pts[:,:1]*self.t+pts[:,1:2]*self.n)


def street_frame(center,segments,tree,roads,records,road_key):
 """Nearest street segment to the house: the frame there and the pavement edge offset on the house side.

 Where the nearest point is a vertex two segments share, both are exactly as near (711 of the 36,014 houses with a
 street in reach, 666 of them at a bend of one road). The tree's order must not choose between them: it shifts with
 every road added or removed anywhere in the metro, and taking two streets out of Brookline turned the frames of ten
 houses from Medford to Melrose. Of equally near segments the one with the lowest centre z is taken, then the lowest
 centre x (the sums of the end coordinates), then the earlier in the list."""
 c=Point(center);best=None
 for i in tree.query(c.buffer(REACH)):
  line=segments[i][0];d=line.distance(c)
  if d>REACH:continue
  (ax,az),(bx,bz)=line.coords;key=(d,az+bz,ax+bx,int(i))
  if best is None or key<best:best=key
 if best is None:return None
 line,ri=segments[best[3]];(ax,az),(bx,bz)=line.coords;t=np.array([bx-ax,bz-az]);length=np.linalg.norm(t)
 if length<.5:return None
 t/=length;s=max(0,min(length,(center[0]-ax)*t[0]+(center[1]-az)*t[1]));q=np.array([ax,az])+t*s;n=np.array([-t[1],t[0]])
 if (center[0]-q[0])*n[0]+(center[1]-q[1])*n[1]<0:n=-n
 road=roads[ri];edge=road['width']/2;rec=records.get(road_key(road))
 if rec is not None and len(rec['left']):
  left=np.asarray(rec['left']);right=np.asarray(rec['right']);mid=(left+right)/2;k=int(np.argmin(np.hypot(*(mid-q).T)))
  if np.hypot(*(mid[k]-q))<4:edge=max(float((left[k]-q)@n),float((right[k]-q)@n),1.5)
 return Frame(q,t,n),edge,ri


def house_driveways(buildings,parcels,roads,records,road_key,service_lines=()):
 """Lane polygons (world) and curb-cut polygons for the generated northern houses."""
 houses=[b for b in buildings if b.get('district') in NORTH and b.get('houseStyle') and b['houseStyle']!='garage' and len(b.get('footprint',()))>=3]
 if not houses:return [],[]
 parcel_tree=STRtree(parcels);service_tree=STRtree(list(service_lines)) if service_lines else None
 shapes=[(b,Polygon(b['footprint']).buffer(0)) for b in buildings if len(b.get('footprint',()))>=3];shape_tree=STRtree([s for _,s in shapes])
 segments=[];kinds=('motorway','motorway_link')
 for ri,r in enumerate(roads):
  if r.get('kind') in kinds:continue
  for a,b in zip(r['points'],r['points'][1:]):segments.append((LineString([a,b]),ri))
 segment_tree=STRtree([s for s,_ in segments]);pavement_tree=STRtree([LineString(r['points']).buffer(r['width']/2) for r in roads])
 lanes=[];cuts=[];taken=[]
 for house in sorted(houses,key=lambda b:b['id']):
  footprint=Polygon(house['footprint']).buffer(0);center=footprint.representative_point()
  hits=[i for i in parcel_tree.query(center) if parcels[i].covers(center)]
  if not hits:continue
  parcel=min((parcels[i] for i in hits),key=lambda p:p.area)
  if service_tree is not None and len(service_tree.query(parcel,predicate='intersects')):continue
  found=street_frame((center.x,center.y),segments,segment_tree,roads,records,road_key)
  if found is None:continue
  frame,edge,ri=found;h=frame.local(footprint);hu0,hu1=h[:,0].min(),h[:,0].max();hv0,hv1=h[:,1].min(),h[:,1].max()
  if hv0>REACH or hv1<edge+WALK+2:continue
  lot=frame.poly(parcel).buffer(.4,join_style=2);start=edge+WALK
  near=[shapes[i] for i in shape_tree.query(parcel.buffer(8))]
  others=[frame.poly(s).buffer(CLEAR,join_style=2) for b,s in near if b is not house and b.get('houseStyle')!='garage' or (b.get('houseStyle')=='garage' and not parcel.covers(s.representative_point()))]
  garages=sorted([frame.poly(s) for b,s in near if b.get('houseStyle')=='garage' and parcel.covers(s.representative_point())],key=lambda g:g.bounds[1])
  garage=next((g for g in garages if g.bounds[1]>=hv0),None)
  streets=[frame.poly(pavement_tree.geometries[i]) for i in pavement_tree.query(parcel.buffer(WALK+4)) if i!=ri]
  blocked=unary_union(others+streets+[frame.poly(t) for t in taken if t.distance(parcel)<4]) if others or streets or taken else None
  def fits(shape,part):
   if shape.is_empty or part.difference(lot).area>.5:return False
   return blocked is None or shape.intersection(blocked).area<.05
  edges=unary_union([lot.exterior]+([blocked.boundary] if blocked is not None else []))
  def room(side):
   """Clear distance beside the wall: the least of three rays across the side yard (front, middle, back), capped at 8 m."""
   wall=hu0 if side<0 else hu1;out=8.0
   for v in (hv0+.5,(hv0+hv1)/2,hv1-.5):
    hit=LineString([(wall,v),(wall+8*side,v)]).intersection(edges)
    for p in getattr(hit,'geoms',[hit]):
     if not p.is_empty:out=min(out,abs(p.coords[0][0]-wall))
   return out
  best=None
  for side in (-1,1):
   wall=hu0-GAP if side<0 else hu1+GAP;space=room(side)
   if space<GAP+NARROWEST:continue
   if garage is not None:
    g0,g1=garage.bounds[0],garage.bounds[2];end=garage.bounds[1]-.2
   else:end=hv1+1.5
   for width in np.arange(WIDEST,NARROWEST-.01,-.2):
    u0,u1=(wall-width,wall) if side<0 else (wall,wall+width)
    shape=box(u0,start,u1,end);front=max(start,lot.bounds[1]);part=box(u0,front,u1,end)
    pad=None
    if garage is not None and min(u1,g1)-max(u0,g0)<2.2 and end-hv1>2.5:
     pad=box(min(u0,g0),hv1+.3,max(u1,g1),end).difference(frame.poly(footprint).buffer(.3,join_style=2))
     shape=shape.union(pad);part=part.union(pad)
    if not fits(shape,part):
     if garage is None:continue
     shape=box(u0,start,u1,hv1+1.5);part=box(u0,front,u1,hv1+1.5)
     if not fits(shape,part):continue
    depth=part.bounds[3]-front
    if depth<5:continue
    score=(garage is not None and shape.intersects(garage.buffer(.5)),round(space,1),round(width,1),side)
    if best is None or score>best[0]:best=(score,shape,u0,u1)
    break
  if best is None:continue
  _,shape,u0,u1=best;lane=frame.world(shape.buffer(0) if shape.geom_type=='Polygon' else max(shape.geoms,key=lambda g:g.area))
  lanes.append(lane);taken.append(lane);cuts.append(frame.world(box(u0-FLARE,edge-1.2,u1+FLARE,edge+1.2)))
 return lanes,cuts


def cut_curbs(curbs,cuts,tree=None):
 """Curb polylines with the driveway mouths removed (pieces under .5 m dropped)."""
 if not cuts:return curbs
 tree=tree or STRtree(cuts);out=[]
 for c in curbs:
  line=LineString(c);hit=tree.query(line,predicate='intersects')
  if not len(hit):out.append(c);continue
  rest=line.difference(unary_union([tree.geometries[i] for i in hit]))
  for part in getattr(rest,'geoms',[rest]):
   if part.geom_type=='LineString' and part.length>=.5:out.append([[round(x,3),round(z,3)] for x,z in part.coords])
 return out
