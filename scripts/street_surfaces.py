"""Curb-bounded street surfaces for the tiled metro package.

The street centerlines carry prototype widths (name and class guesses), while
the curbs are a survey (Boston GIS layer 6) or, in the towns, a synthetic line
derived from those same widths. Wherever the two disagree (wider parkways,
corner radii, bump-outs, pull-off bays, medians) a constant-width asphalt ribbon
leaves asphalt outside the curb or grass inside it. This module measures the
roadway between the curbs at one-metre stations along every surface road,
cleans the measurement (driveway tongues, short gaps, unmeasured stretches fall
back to the nominal width with ramps), and writes per-tile records:

  pavements  the left and right roadway edges of each road the tile owns
             (centimetres relative to the tile origin), the sidewalk-inventory
             presence per side and the measured paved width
  sidewalks  Boston Sidewalk Inventory (layer 0) polygons clipped to the tile,
             brick ones flagged
  islands    closed curb faces without a street centerline, a building or a
             park (traffic islands, lane dividers, transit platforms) that get
             a concrete fill
  driveways  asphalt that no street centerline carries: OpenStreetMap service
             roads (driveways, parking aisles, alleys) measured to the
             surveyed curbs on each side like the streets (their tagged or
             class width where no curb is near), surface parking lots as
             fills, and closed curb faces a service road enters or a lot
             covers (the survey curbed a turnaround but nothing paved it),
             dissolved per tile and cut around inventory sidewalks
  curbs      survey curbs kept; town curbs regenerated with filleted corners
             from the union of their street pavements

`city.json` roads gain `pavedWidth` where at least five stations were measured
on both sides. Everything is deterministic: a rerun on an installed package
rewrites identical bytes.
"""
import gzip,json,math,struct,warnings
import numpy as np,shapely
from shapely.geometry import LineString,LinearRing,Polygon,Point,box
from shapely.ops import unary_union,polygonize
from shapely.prepared import prep
from shapely.strtree import STRtree
from tileformat import write_gzip

STEP=1.0
"""Station spacing along each road in metres."""
CAP_EXTRA=12.0
"""Rays reach half the nominal width plus this far on each side."""
FILLET=3.0
"""Corner radius of the regenerated town curbs (metres)."""
LIP=.09
"""Town curbs sit this far outside the nominal pavement edge."""
WALK_FALLBACK=2.9
"""Sidewalk band drawn on sides without an inventory polygon (road-grading WALK)."""
ISLAND_AREA=400.0
"""Bare curb faces up to this area (or thinner than ISLAND_WIDTH) are concrete islands."""
ISLAND_WIDTH=3.5
FACE_AREA=2500.0
"""Larger closed curb faces are blocks or planted medians, never islands."""
DRIVEWAY_AREA=6000.0
"""Curb faces up to this area are paved when a service road or parking area explains them."""
DRIVEWAY_INSET=.5
"""A service road must reach this far inside a face to pave it, not just graze its curb."""
OUTLINE_DIAMETER=12.0
"""An inventory polygon lying in parkland that holds a disc this wide (and wider than four declared sidewalk widths) outlines a whole island or mall, not its pavement."""
STALE_LENGTH=8.0
"""A Boston curb stretch at least this long that lies in parkland beyond the measuring reach of every street, service road and lot is the remnant of a removed roadway."""
STALE_WALK=5.0
"""An inventory sidewalk part beyond that reach, in parkland and mostly within this distance of such a stretch, was the removed roadway's sidewalk."""
PARK_EDGE=3.0
"""A centerline station inside a park with a curb this close that lies on the park boundary runs inside a curbed park edge; it keeps the nominal width."""
SERVICE_WIDTHS={'parking_aisle':5.5,'driveway':4.0,'alley':4.5,'drive-through':4.0,'emergency_access':4.0}
"""Ribbon widths in metres by OSM `service` value when the way carries no `width`."""
SERVICE_WIDTH=4.5
DRIVEWAY_REACH=6.0
"""Service-road rays reach half the class width plus this far: a parallel street's curb stays out of reach."""
DRIVEWAY_FLOOR=.1
"""An OSM service line drawn along a curb keeps its asphalt on the other side, so no 1.2 m floor past the curb."""
DRIVEWAY_TOUCH=.3
"""A curb hit closer than this means the line runs along that curb, inside or just outside the driveway."""
UNDRAWN_PARKING={'underground','multi-storey','rooftop','garage_boxes','carports','sheds'}
SIDEWALK_TUCK=.35
"""Inventory polygons grow this much so they tuck under the asphalt edge."""


def unpack(path):
 raw=gzip.decompress(path.read_bytes());length=struct.unpack_from('<I',raw,4)[0]
 return json.loads(raw[8:8+length]),raw[(8+length+3)//4*4:]


def write_header(path,header,payload):
 encoded=json.dumps(header,separators=(',',':')).encode();raw=b'DBT2'+struct.pack('<I',len(encoded))+encoded;write_gzip(path,raw+b'\0'*((-len(raw))%4)+payload)


def rounded(p,digits=3):return [round(float(v),digits) for v in p]


def line_parts(geometry):
 if geometry.geom_type=='LineString':return [geometry]
 return [g for g in geometry.geoms if g.geom_type=='LineString'] if hasattr(geometry,'geoms') else []


def polygon_parts(geometry):
 if geometry.geom_type=='Polygon':return [geometry] if geometry.area>0 else []
 return [g for g in geometry.geoms if g.geom_type=='Polygon' and g.area>0] if hasattr(geometry,'geoms') else []


def clip_line(points,area):
 """Same chunks build-metro.py writes: millimetre vertices, parts of at least half a metre."""
 return [[rounded(p) for p in part.coords] for part in line_parts(LineString(points).intersection(area)) if part.length>=.5]


def polygon_rings(polygon,digits=2):
 return [[rounded(p,digits) for p in ring.coords[:-1]] for ring in [polygon.exterior,*polygon.interiors]]


def road_key(road):return (road['id'],round(road['points'][0][0],2),round(road['points'][0][1],2))


def road_midpoint(points):
 """The half-length point the tile builder owns a road by (road-tile-coverage.ts)."""
 steps=[0.0]
 for a,b in zip(points,points[1:]):steps.append(steps[-1]+math.hypot(b[0]-a[0],b[1]-a[1]))
 half=steps[-1]/2;i=1
 while i<len(steps)-1 and steps[i]<half:i+=1
 a,b=points[i-1],points[i];span=steps[i]-steps[i-1] or 1;t=(half-steps[i-1])/span
 return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]


def road_stations(points,step=STEP):
 """Points every `step` m (vertices kept) with left unit normals, bisected at vertices, and the distance along."""
 pts=np.asarray(points,dtype=float);seg=np.diff(pts,axis=0);length=np.hypot(seg[:,0],seg[:,1]);keep=length>1e-6
 if not keep.any():return pts[:1],np.array([[0.0,1.0]]),np.zeros(1)
 dirs=seg[keep]/length[keep][:,None];P=np.vstack([pts[:-1][keep],pts[-1:]]);L=length[keep]
 out,normals,along=[],[],[];s=0.0
 for i in range(len(L)):
  a,b=P[i],P[i+1];d=dirs[i];n=max(1,math.ceil(L[i]/step))
  prev=dirs[i-1] if i>0 else d;bis=prev+d;bl=np.hypot(*bis);bis=bis/bl if bl>1e-9 else d
  t=np.arange(n)/n;out.append(a+(b-a)*t[:,None]);normals.append(np.vstack([bis,np.repeat(d[None],n-1,axis=0)]));along.append(s+L[i]*t);s+=L[i]
 out.append(P[-1:]);normals.append(dirs[-1:]);along.append([s])
 tangent=np.vstack(normals);return np.vstack(out),np.stack([-tangent[:,1],tangent[:,0]],axis=1),np.concatenate(along)


def cast_edges(roads,curb_lines,cap_extra=CAP_EXTRA):
 """Per road key: (stations, normals, along, left hit, right hit, second left hit,
 second right hit), distances to the nearest and next curb each way, NaN where
 none lies within reach."""
 tree=STRtree(curb_lines);curbs=np.array(curb_lines,dtype=object);rays,meta,per_road=[],[],{}
 for r in roads:
  cap=r['width']/2+cap_extra;pts,nrm,along=road_stations(r['points']);key=road_key(r);per_road[key]=(pts,nrm,along)
  for k in range(len(pts)):
   for side,sign in ((0,1),(1,-1)):rays.append(LineString([pts[k],pts[k]+nrm[k]*cap*sign]));meta.append((key,k,side))
 rays=np.array(rays,dtype=object);ri,ci=tree.query(rays,predicate='intersects')
 coords,idx=shapely.get_coordinates(shapely.intersection(rays[ri],curbs[ci]),return_index=True)
 origins=np.array([per_road[meta[i][0]][0][meta[i][1]] for i in ri[idx]]).reshape(-1,2)
 dist=np.hypot(coords[:,0]-origins[:,0],coords[:,1]-origins[:,1]);best={}
 for d,i in zip(dist,ri[idx]):
  key=meta[i];pair=best.get(key)
  if pair is None:best[key]=[d,np.nan]
  elif d<pair[0]:
   if d<pair[0]-1e-6:pair[1]=pair[0]
   pair[0]=d
  elif d>pair[0]+1e-6 and (np.isnan(pair[1]) or d<pair[1]):pair[1]=d
 edges={}
 for r in roads:
  key=road_key(r);pts,nrm,along=per_road[key];n=len(pts);hits=np.full((4,n),np.nan)
  for k in range(n):
   for side in (0,1):
    pair=best.get((key,k,side))
    if pair:hits[side,k]=pair[0];hits[2+side,k]=pair[1]
  edges[key]=(pts,nrm,along,*hits)
 return edges


def runs(mask):
 """(start, end) index runs where mask holds, end exclusive."""
 if not len(mask):return []
 edge=np.diff(np.concatenate([[0],mask.astype(np.int8),[0]]));return list(zip(np.flatnonzero(edge==1),np.flatnonzero(edge==-1)))


def clean_side(d,along,half,tongue=7.0,gap=40.0,ramp=6.0,lift=1.5,window=4,floor=1.2):
 """Suppress short excursions from the local median (driveway tongues outward,
 a median curb crossed at a junction inward), interpolate gaps up to `gap` m,
 and ramp long unmeasured stretches to the nominal half width. Never narrower
 than `floor` m from the centerline."""
 d=d.copy();n=len(d);valid=~np.isnan(d)
 if valid.sum()>=3:
  padded=np.concatenate([np.full(window,np.nan),d,np.full(window,np.nan)])
  with warnings.catch_warnings():warnings.simplefilter('ignore');base=np.nanmedian(np.lib.stride_tricks.sliding_window_view(padded,2*window+1),axis=1)
  for s,e in runs(valid&(np.abs(d-base)>lift)):
   if along[e-1]-along[s]+STEP<tongue:d[s:e]=np.nan
 valid=~np.isnan(d)
 if not valid.any():return np.full(n,half)
 for s,e in runs(~valid):
  a=s-1;b=e
  if a>=0 and b<n and along[e-1]-along[s]+STEP<=gap:d[s:e]=np.interp(along[s:e],[along[a],along[b]],[d[a],d[b]]);continue
  k=np.arange(s,e);v=np.full(e-s,half)
  if a>=0:t=np.minimum(1,(along[k]-along[a])/ramp);v=d[a]+(half-d[a])*t
  if b<n:
   t2=np.minimum(1,(along[b]-along[k])/ramp);v2=d[b]+(half-d[b])*t2
   v=v2 if a<0 else np.where(t2<t,v2,v)
  d[s:e]=v
 return np.maximum(d,floor)


def compress(Lp,Rp,tol=.03):
 """Station indices to keep so both edges stay within `tol` of the chords between kept stations."""
 n=len(Lp);keep=[0];i=0
 def within(P,i,j):
  a,b=P[i],P[j];ab=b-a;l=math.hypot(*ab);q=P[i+1:j]
  dev=np.hypot(*(q-a).T) if l<1e-9 else np.abs(ab[0]*(q[:,1]-a[1])-ab[1]*(q[:,0]-a[0]))/l
  return bool((dev<=tol).all())
 while i<n-1:
  j=i+2
  while j<n and within(Lp,i,j) and within(Rp,i,j):j+=1
  keep.append(j-1);i=j-1
 return keep


def pavement_records(roads,edges,walks_tree=None):
 """Per road key: cleaned edge points (station pairs), measured width and sidewalk presence per side."""
 records={}
 for r in roads:
  pts,nrm,along,L,R=edges[road_key(r)][:5];half=r['width']/2
  Lp=pts+nrm*clean_side(L,along,half)[:,None];Rp=pts-nrm*clean_side(R,along,half)[:,None];keep=compress(Lp,Rp)
  rec={'left':Lp[keep],'right':Rp[keep]};measured=~np.isnan(L)&~np.isnan(R)
  if measured.sum()>=5:rec['pavedWidth']=round(float(np.median(L[measured])+np.median(R[measured])),2)
  if walks_tree is not None:
   flags=[]
   for P,sign in ((Lp,1),(Rp,-1)):
    probe=np.array([Point(P[k]+nrm[k]*sign) for k in range(0,len(P),5)],dtype=object);near=walks_tree.query(probe,predicate='intersects')[0]
    flags.append(1 if len(probe) and len(set(near.tolist()))/len(probe)>=.5 else 0)
   rec['walk']=flags
  records[road_key(r)]=rec
 return records


def town_pavements(roads,area,lip):
 inside=prep(area);out=[]
 for r in roads:
  if not r['id'].startswith('osm-') or r.get('elevations') or r.get('tunnel'):continue
  line=LineString(r['points'])
  if inside.intersects(line):out.append(line.buffer(r['width']/2+lip,cap_style=2,join_style=2))
 return out


def chunked(boundary,simplify):
 out=[]
 for part in line_parts(boundary):
  pts=[rounded(p) for p in part.simplify(simplify).coords]
  for i in range(0,len(pts)-1,40):out.append(pts[i:i+41])
 return out


def legacy_town_curbs(roads,towns):
 """The mitred curbs build-metro.py synthesises (synthetic_curbs), for exact removal."""
 out=[]
 for area in towns.values():
  pavements=[p for p in town_pavements(roads,area,.35) if True]
  if pavements:out+=chunked(unary_union(pavements).boundary,.15)
 return out


def town_curbs(roads,towns,fillet=FILLET,lip=LIP):
 """Town curbs with rounded corners: the pavement union closed by a disc of radius `fillet`."""
 out=[]
 for area in towns.values():
  pavements=town_pavements(roads,area,lip)
  if pavements:out+=chunked(unary_union(pavements).buffer(fillet,join_style=1).buffer(-fillet,join_style=1).boundary,.03)
 return out


def osm_width(tags,fallback):
 """`width` in metres (feet when quoted with ' or ft), clamped to 2.5..12, else the fallback."""
 raw=str(tags.get('width','')).strip().lower()
 try:value=float(raw.replace('m','').replace('ft','').replace("'",'').strip())
 except ValueError:return fallback
 if "'" in raw or 'ft' in raw:value*=.3048
 return min(12.0,max(2.5,value))


def driveway_features(elements,xy):
 """Surface service roads (lines with widths) and surface parking lots
 (polygons) from an Overpass extract (`way["highway"="service"]`,
 `way["amenity"="parking"]`) in world metres. Tunnels, covered ways, anything
 on a negative layer, and structured or rooftop parking are left out."""
 lines=[];widths=[];lots=[]
 for e in elements:
  if e.get('type')!='way' or len(e.get('geometry') or [])<2:continue
  tags=e.get('tags',{})
  try:layer=int(str(tags.get('layer','0')).split(';')[0])
  except ValueError:layer=0
  if layer<0 or tags.get('tunnel') not in (None,'no') or tags.get('covered')=='yes' or tags.get('location')=='underground':continue
  pts=[xy(g['lon'],g['lat']) for g in e['geometry']];closed=len(pts)>=4 and pts[0]==pts[-1]
  if tags.get('amenity')=='parking':
   if tags.get('parking') in UNDRAWN_PARKING or 'building' in tags or not closed:continue
   polygon=Polygon(pts).buffer(0)
   if not polygon.is_empty:lots.append(polygon)
  elif tags.get('highway')=='service':
   if tags.get('area')=='yes' and closed:
    polygon=Polygon(pts).buffer(0)
    if not polygon.is_empty:lots.append(polygon)
   else:lines.append(LineString(pts));widths.append(osm_width(tags,SERVICE_WIDTHS.get(tags.get('service',''),SERVICE_WIDTH)))
 return lines,widths,lots


def driveway_edges(lines,widths,curb_lines,reach=DRIVEWAY_REACH,floor=DRIVEWAY_FLOOR,touch=DRIVEWAY_TOUCH):
 """Left and right edge points per service line, measured to the surveyed
 curbs within reach. An OSM line is not a centerline: it wanders across the
 driveway and may run along one curb, inside or just outside it. Where it
 touches a curb on one side and finds nothing on the other, the next curb
 beyond the touched one decides: at about the line's median curb-to-curb width
 (its class width when fewer than five stations measured both sides) the
 asphalt lies across the touched curb; otherwise the open side is completed to
 that width. Then the usual cleaning."""
 roads=[{'id':f'service-{i}','points':list(l.coords),'width':w} for i,(l,w) in enumerate(zip(lines,widths))]
 edges=cast_edges(roads,curb_lines,cap_extra=reach) if curb_lines else {};out=[]
 for r in roads:
  if road_key(r) not in edges:out.append(None);continue
  pts,nrm,along,L,R,L2,R2=edges[road_key(r)];half=r['width']/2;both=~np.isnan(L)&~np.isnan(R)
  total=float(np.median(L[both]+R[both])) if both.sum()>=5 else r['width']
  for near,far,beyond in ((L,R,L2),(R,L,R2)):
   outside=(near<touch)&np.isnan(far)&(np.abs(beyond-total)<=np.maximum(1.5,.4*total))
   near[outside]=beyond[outside];far[outside]=floor
  only_l=~np.isnan(L)&np.isnan(R);only_r=np.isnan(L)&~np.isnan(R)
  R[only_l]=np.maximum(floor,total-L[only_l]);L[only_r]=np.maximum(floor,total-R[only_r])
  out.append((pts+nrm*clean_side(L,along,half,floor=floor)[:,None],pts-nrm*clean_side(R,along,half,floor=floor)[:,None]))
 return out


def driveway_surfaces(lines,widths,lots,faces,coverage,walks_tree=None,curb_lines=None):
 """Dissolve the service-road strips (between the surveyed curbs where there
 are any, else ribbons of the class width), the lots and the paved curb faces
 into one asphalt set inside the coverage, cut around inventory sidewalks (a
 driveway apron keeps its concrete). Returns polygon parts."""
 ribbons=[]
 for (l,w),edge in zip(zip(lines,widths),driveway_edges(lines,widths,curb_lines or [])):
  if edge is None:ribbons.append(l.buffer(w/2,cap_style=2,join_style=1))
  else:left,right=edge;ribbons+=polygon_parts(Polygon(np.vstack([left,right[::-1]])).buffer(0))
 merged=unary_union(ribbons+list(lots)+list(faces)).intersection(coverage);out=[]
 for part in polygon_parts(merged):
  if walks_tree is not None:
   hit=walks_tree.query(part,predicate='intersects')
   if len(hit):part=part.difference(unary_union([walks_tree.geometries[i] for i in hit]))
  out+=[p for p in polygon_parts(part.simplify(.03)) if p.area>=.5]
 return out


def curb_islands(curb_lines,roads,parks,building_centers,walks_tree=None,driveways=None,face_area=FACE_AREA,island_area=ISLAND_AREA,island_width=ISLAND_WIDTH,driveway_area=DRIVEWAY_AREA):
 """Closed curb faces that hold no street centerline or building. A face a
 service road (`driveways`: lines, lots) enters or a lot mostly covers is paved
 whole; otherwise small or thin faces outside parks are concrete islands, and
 faces an inventory sidewalk already covers in part are left to that sidewalk.
 Returns (islands, paved faces, statistics)."""
 faces=list(polygonize(unary_union(curb_lines)))
 road_tree=STRtree([LineString(r['points']) for r in roads]);building_tree=STRtree([Point(c) for c in building_centers])
 park_union=unary_union([Polygon(p['rings'][0],p['rings'][1:]).buffer(0) for p in parks]);park_tree=STRtree(polygon_parts(park_union))
 service_tree=STRtree(driveways[0]) if driveways else None;parking_tree=STRtree(driveways[1]) if driveways else None
 out=[];drives=[];stats={'faces':len(faces),'candidates':0,'road':0,'building':0,'driveways':0,'park':0,'sidewalk':0,'large':0,'islands':0}
 for f in faces:
  if f.area>max(face_area,driveway_area) or f.area<1.0:continue
  stats['candidates']+=1
  if len(road_tree.query(f,predicate='intersects')):stats['road']+=1;continue
  if len(building_tree.query(f,predicate='intersects')):stats['building']+=1;continue
  if service_tree is not None and f.area<=driveway_area:
   inner=f.buffer(-DRIVEWAY_INSET);lot=parking_tree.query(f,predicate='intersects')
   if (not inner.is_empty and len(service_tree.query(inner,predicate='intersects'))) or (len(lot) and sum(f.intersection(parking_tree.geometries[i]).area for i in lot)>.5*f.area):
    stats['driveways']+=1;drives.append(f);continue
  if f.area>face_area:continue
  hit=park_tree.query(f,predicate='intersects')
  if len(hit) and sum(f.intersection(park_tree.geometries[i]).area for i in hit)>.5*f.area:stats['park']+=1;continue
  if walks_tree is not None and len(walks_tree.query(f,predicate='intersects')):stats['sidewalk']+=1;continue
  if f.area>island_area and 2*f.area/f.length>island_width:stats['large']+=1;continue
  stats['islands']+=1;out.append(f)
 return out,drives,stats


def explained_region(roads,lines,lots):
 """Spatial index of everything a curb can belong to: each street within its
 measuring reach (half the nominal width plus CAP_EXTRA), OpenStreetMap service
 roads within 8 m and surface lots within 4 m."""
 return STRtree([LineString(r['points']).buffer(r.get('width',10)/2+CAP_EXTRA) for r in roads if len(r['points'])>=2]+[l.buffer(8) for l in lines]+[l.buffer(4) for l in lots])


def survey_lines(features,xy,coverage):
 """Boston curb survey polylines (GIS layer 6) in world metres, clipped to the
 package coverage the way build-metro.py installs them."""
 out=[]
 for f in features:
  for path in f['geometry'].get('paths',[]):out+=[LineString(c) for c in clip_line([xy(*v) for v in path],coverage)]
 return out


def stale_stretches(curbs,explained,park_tree,window):
 """Stretches of `curbs` (LineStrings) that are remnants of removed roadways.
 The Boston curb layer and the 2011 sidewalk inventory still trace roadways that
 have since been removed (the Brookline Avenue island at Park Drive before the
 Muddy River restoration, the Central Artery ramps at North End Park, the Casey
 Overpass approaches): a stretch of STALE_LENGTH or more that no street, service
 road or lot could have produced, lying in parkland (parks grown 3 m), is one.
 `window` bounds the explained region consulted. The install runs this on the
 raw survey rather than the installed curbs, so a rerun finds the same stretches."""
 if park_tree is None:return []
 region=unary_union([explained.geometries[i] for i in explained.query(window,predicate='intersects')]);out=[]
 for line in curbs:
  beyond=line.difference(region)
  for part in (beyond.geoms if beyond.geom_type=='MultiLineString' else [beyond]):
   if part.is_empty or part.length<STALE_LENGTH:continue
   hit=park_tree.query(part,predicate='intersects')
   if len(hit) and sum(part.intersection(park_tree.geometries[i]).length for i in hit)>=.8*part.length:out.append(part)
 return out


def cut_stale_curbs(curbs,stale_tree,keep=lambda piece:True):
 """Curb polylines with the stale stretches cut out, in their original order.
 A remnant must satisfy `keep` (the install passes the Boston-side test the next
 run applies to survey curbs, so a piece whose midpoint now lies across the town
 line goes now rather than on the rerun). Returns (curbs, polylines cut)."""
 out=[];count=0
 for c in curbs:
  line=LineString(c);near=stale_tree.query(line.buffer(.02),predicate='intersects')
  if not len(near):out.append(c);continue
  kept=line.difference(unary_union([stale_tree.geometries[i].buffer(.02) for i in near]))
  if kept.length>line.length-.5:out.append(c);continue
  count+=1
  for part in (kept.geoms if kept.geom_type=='MultiLineString' else [kept]):
   piece=[[round(x,3),round(z,3)] for x,z in part.coords]
   if not part.is_empty and part.length>=1 and keep(piece):out.append(piece)
 return out,count


def cut_stale_sidewalk(shell,explained,park_tree,stale_tree):
 """`shell` without the parts that lie beyond every street's measuring reach,
 in parkland (80 % of the part, parks grown 3 m) and mostly within STALE_WALK of
 a stale curb stretch: the sidewalk of the roadway the stretch belonged to.
 Returns (polygon, parts cut)."""
 near=stale_tree.query(shell.buffer(STALE_WALK),predicate='intersects')
 if not len(near):return shell,0
 hit=explained.query(shell,predicate='intersects');beyond=shell.difference(unary_union([explained.geometries[i] for i in hit])) if len(hit) else shell
 along=unary_union([stale_tree.geometries[i] for i in near]).buffer(STALE_WALK);cut=[]
 for part in polygon_parts(beyond):
  if part.area<10:continue
  parks=park_tree.query(part,predicate='intersects')
  if not len(parks) or sum(part.intersection(park_tree.geometries[i]).area for i in parks)<.8*part.area:continue
  if part.intersection(along).area>=.5*part.area:cut.append(part)
 if not cut:return shell,0
 return shell.difference(unary_union(cut).buffer(.01)),len(cut)


def mask_park_edges(edges,roads,parks,reach=PARK_EDGE,tolerance=1.0):
 """Unmeasure the stations of centerlines that run inside a curbed park edge.
 Boston Segments draws a few one-way carriageways through the parkland beside
 them (Riverway northbound at Longwood runs 1.5 m inside the splitter island,
 Arborway segments inside the median), so the nearest curb on one side is the
 park's own edge and the measurement on the other side crosses the park to the
 far carriageway. A station inside a park polygon whose curb within `reach` lies
 on that park's boundary (within `tolerance`) loses both hits and keeps the
 nominal width; a narrow street a park polygon merely covers (Carleton Street
 along the Southwest Corridor) has its curbs well inside the park and stays
 measured. Returns the number of stations masked."""
 parts=polygon_parts(unary_union([Polygon(p['rings'][0],p['rings'][1:]).buffer(0) for p in parks])) if parks else []
 if not parts:return 0
 tree=STRtree(parts);masked=0
 for r in roads:
  key=road_key(r)
  if key not in edges or not len(tree.query(LineString(r['points']),predicate='intersects')):continue
  pts,nrm,along,*hits=edges[key];hits=np.array(hits)
  for k in range(len(pts)):
   inside=tree.query(Point(pts[k]),predicate='within')
   if not len(inside):continue
   boundary=parts[inside[0]].boundary
   for side,sign in ((0,1),(1,-1)):
    d=hits[side,k]
    if np.isnan(d) or d>reach or boundary.distance(Point(pts[k]+nrm[k]*d*sign))>tolerance:continue
    hits[:,k]=np.nan;masked+=1;break
  edges[key]=(pts,nrm,along,*hits)
 return masked


def declared_width(attributes):
 """`SWK_WIDTH` in metres (the inventory records feet); 0 when blank or unreadable."""
 try:return max(0.0,float(attributes.get('SWK_WIDTH') or 0))*.3048
 except (TypeError,ValueError):return 0.0


def outline_strip(shell,width,park_tree):
 """The inventory draws some parkway islands and malls (the Brookline Avenue
 island at Park Drive, the Columbia Road mall, the Arborway) as one polygon
 around the entire parcel while recording a sidewalk a few feet wide. Such a
 polygon, mostly in parkland and holding a disc OUTLINE_DIAMETER across (wider
 than four declared widths), keeps only the declared width (WALK_FALLBACK when
 blank) along its boundary; the lawn inside stays lawn. Returns (polygon, reduced)."""
 if park_tree is None or shell.area<=150:return shell,False
 largest=max(polygon_parts(shell),key=lambda p:p.area);disc=2*shapely.maximum_inscribed_circle(largest,.5).length
 if disc<OUTLINE_DIAMETER or (width and disc<=4*width):return shell,False
 hit=park_tree.query(shell,predicate='intersects')
 if not len(hit) or sum(shell.intersection(park_tree.geometries[i]).area for i in hit)<=.5*shell.area:return shell,False
 return shell.difference(shell.buffer(-(width or WALK_FALLBACK))),True


def sidewalk_polygons(features,xy,coverage,parks=(),stats=None,stale=None):
 """Boston Sidewalk Inventory polygons in world metres, clipped to the package
 coverage: (polygon, material) with 'brick' for brick (BR) and 'concrete' otherwise.
 Esri rings run clockwise for exteriors and counter-clockwise for holes. With the
 park polygons, whole-island outlines are reduced to their sidewalk strip
 (`outline_strip`); `stats['outlines']` counts them. `stale` (explained region,
 grown park tree, stale curb tree) cuts the sidewalks of removed roadways
 (`cut_stale_sidewalk`); `stats['stale']` counts the parts cut."""
 covered=prep(coverage);out=[];outlines=0;cut=0
 park_tree=STRtree(polygon_parts(unary_union([Polygon(p['rings'][0],p['rings'][1:]).buffer(0) for p in parks]))) if parks else None
 for f in features:
  rings=[r for r in f['geometry'].get('rings',[]) if len(r)>=4];
  if not rings:continue
  exterior=[r for r in rings if not LinearRing(r).is_ccw] or rings;holes=[r for r in rings if LinearRing(r).is_ccw and r not in exterior]
  shell=unary_union([Polygon([xy(*v) for v in r]).buffer(0) for r in exterior])
  if holes:shell=shell.difference(unary_union([Polygon([xy(*v) for v in r]).buffer(0) for r in holes]))
  if shell.is_empty or not covered.intersects(shell):continue
  shell,reduced=outline_strip(shell.intersection(coverage),declared_width(f['attributes']),park_tree);outlines+=reduced
  if stale is not None:shell,parts=cut_stale_sidewalk(shell,*stale);cut+=parts
  material='brick' if (f['attributes'].get('MATERIAL') or '').strip()=='BR' else 'concrete'
  for part in polygon_parts(shell):out.append((part,material))
 if stats is not None:stats['outlines']=outlines;stats['stale']=cut
 return out


def tile_key(tx,tz):return f'{tx}_{tz}'


def tiles_touching(geometry,size):
 minx,minz,maxx,maxz=geometry.bounds
 for tx in range(math.floor(minx/size),math.floor(maxx/size)+1):
  for tz in range(math.floor(minz/size),math.floor(maxz/size)+1):yield tx,tz


def encode_edges(left,right,tx,tz,size):
 """Flat [lx, lz, rx, rz, ...] in centimetres relative to the tile origin."""
 ox,oz=tx*size,tz*size;out=[]
 for l,r in zip(left,right):out+=[int(round((l[0]-ox)*100)),int(round((l[1]-oz)*100)),int(round((r[0]-ox)*100)),int(round((r[1]-oz)*100))]
 return out


def install(data_dir,source_dir,xy,log=print):
 city_path=data_dir/'city.json';city=json.loads(city_path.read_text());size=city['tiles']['size'];tile_dir=data_dir/city['tiles']['directory']
 headers={};payloads={}
 for key in city['tiles']['keys']:headers[key],payloads[key]=unpack(tile_dir/f't_{key}.bin')
 surface=[r for r in city['roads'] if not r.get('elevations') and not r.get('tunnel')]
 towns={n['name']:unary_union([Polygon(ring) for ring in n['rings']]) for n in city['neighborhoods'] if n.get('town')};town_union=unary_union(list(towns.values()));town_prep=prep(town_union)
 coverage=unary_union([Polygon(p) for p in city['coverage']])
 # Survey curbs stay; every town curb (the mitred legacy chunks, an earlier run
 # of this script, or any curb inside a town) is regenerated with fillets from
 # the same street pavements, so a rerun appends the same chunks in the same order.
 fillets={}
 for curb in town_curbs(surface,towns):
  for tx,tz in tiles_touching(LineString(curb),size):
   if tile_key(tx,tz) in headers:fillets.setdefault(tile_key(tx,tz),[]).extend(clip_line(curb,box(tx*size,tz*size,(tx+1)*size,(tz+1)*size)))
 legacy={json.dumps(c) for c in legacy_town_curbs(surface,towns)}|{json.dumps(c) for parts in fillets.values() for c in parts}
 survey=added=0
 for key,tile in headers.items():
  kept=[c for c in tile['curbs'] if len(c)>=2 and json.dumps(c) not in legacy and not town_prep.contains(Point(c[len(c)//2]))];survey+=len(kept);added+=len(fillets.get(key,[]))
  tile['curbs']=kept+fillets.get(key,[])
 lines,widths,lots=driveway_features(json.loads((source_dir/'osm-metro-driveways.json').read_text())['elements'],xy);log('Driveway features: service roads',len(lines),'parking lots',len(lots),flush=True)
 explained=explained_region(city['roads'],lines,lots);park_tree=STRtree(polygon_parts(unary_union([Polygon(p['rings'][0],p['rings'][1:]).buffer(0) for p in city['parks']]).buffer(3))) if city['parks'] else None
 # Stale stretches are found on the raw survey clipped per tile as build-metro.py installs it (the installed curbs no longer carry them after the first run), then cut from each tile's survey prefix; the fillets after it stay.
 survey_tree=STRtree(survey_lines(json.loads((source_dir/'layer-6.json').read_text())['features'],xy,coverage));boston_side=lambda piece:not town_prep.contains(Point(piece[len(piece)//2]))
 stale=[]
 for key,tile in headers.items():
  tx,tz=tile['tx'],tile['tz'];area=box(tx*size,tz*size,(tx+1)*size,(tz+1)*size)
  pieces=[LineString(c) for i in survey_tree.query(area,predicate='intersects') for c in clip_line(survey_tree.geometries[i].coords,area) if boston_side(c)]
  stale+=stale_stretches(pieces,explained,park_tree,area.buffer(30,join_style=2))
 stale_tree=STRtree(stale);cut=0
 for key,tile in headers.items():
  n=len(tile['curbs'])-len(fillets.get(key,[]))
  if n<=0 or not len(stale):continue
  pruned,count=cut_stale_curbs(tile['curbs'][:n],stale_tree,boston_side)
  if count:tile['curbs']=pruned+tile['curbs'][n:];cut+=count
 survey=sum(len(tile['curbs'])-len(fillets.get(key,[])) for key,tile in headers.items());stale_length=sum(l.length for l in stale)
 log('Curbs: survey',survey,'town fillets',added,'stale stretches',len(stale),f'({stale_length:.0f} m), polylines cut this run',cut,flush=True)
 curb_lines=[LineString(c) for t in headers.values() for c in t['curbs'] if len(c)>=2]
 walk_stats={};walks=sidewalk_polygons(json.loads((source_dir/'layer-0.json').read_text())['features'],xy,coverage,city['parks'],walk_stats,(explained,park_tree,stale_tree) if len(stale) else None);walks_tree=STRtree([w for w,_ in walks])
 log('Sidewalk inventory polygons',len(walks),'island outlines reduced to strips',walk_stats['outlines'],'removed-roadway parts cut',walk_stats['stale'],flush=True)
 edges=cast_edges(surface,curb_lines);masked=mask_park_edges(edges,surface,city['parks']);log('Cast',len(edges),'roads; stations inside curbed park edges left nominal',masked,flush=True)
 records=pavement_records(surface,edges,walks_tree);log('Pavement records',len(records),flush=True)
 islands,faces,stats=curb_islands(curb_lines,surface,city['parks'],[b['center'] for t in headers.values() for b in t['buildings']],walks_tree,(lines,lots));log('Islands',stats,flush=True)
 drives=driveway_surfaces(lines,widths,lots,faces,coverage,walks_tree,curb_lines);log('Driveway surfaces',len(drives),flush=True)
 for tile in headers.values():tile['pavements']=[];tile['sidewalks']=[];tile['islands']=[];tile['driveways']=[]
 measured=0
 for r in surface:
  rec=records[road_key(r)];m=road_midpoint(r['points']);tx,tz=math.floor(m[0]/size),math.floor(m[1]/size);tile=headers.get(tile_key(tx,tz))
  if 'pavedWidth' in rec:r['pavedWidth']=rec['pavedWidth'];measured+=1
  elif 'pavedWidth' in r:del r['pavedWidth']
  if tile is None:continue
  entry={'road':r['id'],'edges':encode_edges(rec['left'],rec['right'],tx,tz,size)}
  if rec.get('walk'):entry['walk']=rec['walk']
  tile['pavements'].append(entry)
 for polygon,material in walks:
  grown=polygon.buffer(SIDEWALK_TUCK,join_style=2).simplify(.03)
  for tx,tz in tiles_touching(grown,size):
   tile=headers.get(tile_key(tx,tz))
   if tile is None:continue
   for part in polygon_parts(grown.intersection(box(tx*size,tz*size,(tx+1)*size,(tz+1)*size))):
    entry={'rings':polygon_rings(part)}
    if material!='concrete':entry['material']=material
    tile['sidewalks'].append(entry)
 for field,polygons in [('islands',islands),('driveways',drives)]:
  for polygon in polygons:
   for tx,tz in tiles_touching(polygon,size):
    tile=headers.get(tile_key(tx,tz))
    if tile is None:continue
    for part in polygon_parts(polygon.simplify(.03).intersection(box(tx*size,tz*size,(tx+1)*size,(tz+1)*size))):tile[field].append(polygon_rings(part))
 changed=[]
 for key in city['tiles']['keys']:
  header,payload=unpack(tile_dir/f't_{key}.bin')
  if json.dumps(header,separators=(',',':'))!=json.dumps(headers[key],separators=(',',':')):write_header(tile_dir/f't_{key}.bin',headers[key],payload);changed.append(key)
 source={'name':'Boston Sidewalk Inventory','url':'https://gisportal.boston.gov/arcgis/rest/services/Infrastructure/OpenData/MapServer/0','license':'City of Boston open data; source attribution retained'}
 osm={'name':'OpenStreetMap service roads and parking areas (driveway fills)','url':'https://www.openstreetmap.org/copyright','license':'ODbL 1.0'}
 for entry in [source,osm]:
  if entry not in city['sources']:city['sources'].append(entry)
 city_path.write_text(json.dumps(city,separators=(',',':'))+'\n')
 summary={'surveyCurbs':survey,'townCurbs':added,'staleCurbs':len(stale),'staleCurbMetres':round(stale_length),'parkEdgeStations':masked,'sidewalkPolygons':len(walks),'outlineStrips':walk_stats['outlines'],'staleSidewalks':walk_stats['stale'],'sidewalkParts':sum(len(t['sidewalks']) for t in headers.values()),'pavements':sum(len(t['pavements']) for t in headers.values()),'measuredRoads':measured,'islands':stats['islands'],'islandParts':sum(len(t['islands']) for t in headers.values()),'driveways':len(drives),'pavedFaces':stats['driveways'],'drivewayParts':sum(len(t['driveways']) for t in headers.values()),'faces':stats}
 pp=data_dir/'provenance.json';provenance=json.loads(pp.read_text())
 provenance['streetSurfaces']={**summary,'source':source['url'],'method':f'Roadway edges measured every {STEP:g} m from each surface centerline to the nearest curb within half the nominal width plus {CAP_EXTRA:g} m, driveway tongues under 7 m suppressed, gaps to 40 m interpolated, unmeasured stretches ramped to the nominal width; sidewalk inventory polygons grown {SIDEWALK_TUCK} m and clipped to tiles, a polygon mostly in parkland that holds a disc {OUTLINE_DIAMETER:g} m across (wider than four declared widths) reduced to its declared width ({WALK_FALLBACK} m when blank) along the boundary; OpenStreetMap service roads measured to the surveyed curbs within half their tagged or class width ({SERVICE_WIDTH:g} m default) plus {DRIVEWAY_REACH:g} m, an unmeasured side completed to the median curb-to-curb width of that line, with surface parking lots and the closed curb faces a service road enters or a lot covers (up to {DRIVEWAY_AREA:g} m2), dissolved and cut around inventory sidewalks; other closed curb faces without a centerline or building filled with concrete when outside parks and inventory sidewalks and under {ISLAND_AREA:g} m2 or {ISLAND_WIDTH} m wide; town curbs regenerated from the pavement union with {FILLET:g} m fillets; Boston curb stretches of {STALE_LENGTH:g} m or more lying in parkland (parks grown 3 m) beyond the measuring reach of every street, service road (8 m) and lot (4 m) dropped as remnants of removed roadways, with the inventory sidewalk parts beyond that reach, in parkland and mostly within {STALE_WALK:g} m of such a stretch; a centerline station inside a park with a curb within {PARK_EDGE:g} m on the park boundary left unmeasured at the nominal width.'}
 pp.write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 return {**summary,'changedTiles':len(changed)}
