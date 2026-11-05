"""Compile measured road strips into valid, tile-clipped surface polygons.

Offset curves can fold inside tight bends. They are useful measurement records,
but are not a triangulation: drawing every station pair as a quad loses faces
to back-face culling and lets independently capped road ends leave wedges.
Union their swept triangles, close only shared surface-road junctions, and
subtract the resulting asphalt from fallback sidewalks before tiling. The
runtime drapes these polygons on the exact terrain triangles.
"""
from collections import defaultdict
import numpy as np
import shapely
from shapely.geometry import Polygon, Point, box
from shapely.ops import unary_union
from shapely.strtree import STRtree

WALK = 2.9
PRECISION = .001


def weld_records(roads,records,road_key):
 """Give aligned pieces of one street a common measured end cross-section.

 Independent curb measurements can disagree at a source split, including when
 a traffic junction was inserted into a continuous street. Narrow branches and
 corners retain their own mouths. Blend the correction over at most 8 metres.
 """
 nodes=defaultdict(list);joined=0
 for r in roads:
  for i in (0,-1):nodes[tuple(r['points'][i])].append((r,i))
 for ends in nodes.values():
  best={}
  for j,(a,ai) in enumerate(ends):
   p=a['points'][ai];q=a['points'][1 if ai==0 else -2];v=np.array(q)-p
   for k,(b,bi) in enumerate(ends):
    if a is b or a['name']!=b['name'] or min(a['width'],b['width'])/max(a['width'],b['width'])<.9:continue
    w=np.array(b['points'][1 if bi==0 else -2])-p;cos=-float(np.dot(v,w))/(np.linalg.norm(v)*np.linalg.norm(w) or 1)
    if cos>=.98 and (j not in best or (cos,k)>best[j]):best[j]=(cos,k)
  for j,(_,k) in sorted(best.items()):
   if j>=k or best.get(k,(0,None))[1]!=j:continue
   a,ai=ends[j];b,bi=ends[k];ar=records[road_key(a)];br=records[road_key(b)]
   changed=False
   for side,other in (('left','left' if ai!=bi else 'right'),('right','right' if ai!=bi else 'left')):
    target=np.round((ar[side][ai]+br[other][bi])/2,2)
    for record,index,field in ((ar,ai,side),(br,bi,other)):
     edge=record[field];delta=target-edge[index]
     if np.linalg.norm(delta)<1e-7:continue
     changed=True;distance=np.r_[0,np.cumsum(np.linalg.norm(np.diff(edge,axis=0),axis=1))]
     if index==-1:distance=distance[-1]-distance
     reach=min(8,max(distance)/2) or 1;weight=np.maximum(0,1-distance/reach)
     record[field]=edge+weight[:,None]*delta
   joined+=int(changed)
 return joined


def parts(shape):
 if shape.geom_type == 'Polygon':
  if shape.area > .0001:yield shape
 elif hasattr(shape, 'geoms'):
  for child in shape.geoms:yield from parts(child)


def encoded_polygons(shape):
 return [[[[round(x,3),round(z,3)] for x,z in ring.coords[:-1]] for ring in [p.exterior,*p.interiors]] for p in parts(shapely.normalize(shapely.set_precision(shape,PRECISION)))]


def normalize_overlays(headers):
 """Centimetre serialization can collapse thin sidewalk/driveway rings.

 Repair those rings before Earcut sees them; retain every polygonal component
 and discard only collapsed lines/points. Valid survey polygons stay intact.
 """
 for tile in headers.values():
  for field in ('sidewalks','islands','driveways'):
   out=[]
   for item in tile[field]:
    rings=item['rings'] if field=='sidewalks' else item;shape=Polygon(rings[0],rings[1:])
    if shape.is_valid and shape.area>0:out.append(item);continue
    repaired=shapely.make_valid(shape,method='structure',keep_collapsed=False)
    for rings in encoded_polygons(repaired):out.append({**item,'rings':rings} if field=='sidewalks' else rings)
   tile[field]=out


def strip(left, right):
 """The union of swept triangles, including folds, with no invalid bow-ties."""
 triangles=[]
 for a,b,c,d in zip(left,left[1:],right,right[1:]):
  for points in ((a,c,b),(c,d,b)):
   triangle=Polygon(points)
   if triangle.area > 1e-8:triangles.append(triangle)
 return shapely.set_precision(unary_union(triangles),PRECISION)


def compile_surfaces(roads, records, road_key, obstacles=()):
 asphalt=[];walks=[];nodes=defaultdict(list);folded=0
 for road in roads:
  rec=records[road_key(road)];left=np.asarray(rec['left']);right=np.asarray(rec['right'])
  surface=strip(left,right);index=len(asphalt);asphalt.append(surface)
  # Count records whose strips fold, for the generation report.
  def cross(a,b):return a[:,0]*b[:,1]-a[:,1]*b[:,0]
  folded+=int(np.any(cross(left[:-1]-right[:-1],right[1:]-right[:-1])>1e-4) or np.any(cross(left[:-1]-right[1:],left[1:]-right[1:])>1e-4))
  delta=left-right;length=np.maximum(1e-9,np.linalg.norm(delta,axis=1));normal=delta/length[:,None]
  flags=rec.get('walk',[0,0])
  if not flags[0]:walks.append(strip(left+normal*WALK,left))
  if not flags[1]:walks.append(strip(right,right-normal*WALK))
  # Interior source vertices are real T junctions too. Deduplicate per road.
  for p in {tuple(p) for p in road['points']}:
   nodes[(round(p[0],2),round(p[1],2))].append(index)
 blockers=STRtree(list(obstacles));junctions=[]
 for p,indices in sorted(nodes.items()):
  indices=sorted(set(indices))
  if len(indices)<2:continue
  reach=min(12,max(4,max(roads[i].get('pavedWidth',roads[i]['width']) for i in indices)/2))
  area=Point(p).buffer(reach,quad_segs=8)
  near=unary_union([asphalt[i].intersection(area) for i in indices])
  patch=near.convex_hull.difference(near)
  if patch.is_empty:continue
  hits=blockers.query(patch,predicate='intersects')
  if len(hits):patch=patch.difference(unary_union(blockers.geometries[hits]))
  junctions.extend(parts(shapely.set_precision(patch,PRECISION)))
 return asphalt+junctions,walks,{'foldedStrips':folded,'junctionParts':len(junctions)}


def install_surfaces(headers, roads, records, road_key, obstacles=(), contacts=()):
 """One global solve, then exact tile clipping; no tile-local endpoint guesses."""
 asphalt,walks,stats=compile_surfaces(roads,records,road_key,obstacles)
 asphalt_tree=STRtree(asphalt);walk_tree=STRtree(walks);contact_tree=STRtree(contacts)
 for key,tile in headers.items():
  size=tile['size'];x=tile['tx']*size;z=tile['tz']*size;area=box(x,z,x+size,z+size)
  road_ids=asphalt_tree.query(area,predicate='intersects');walk_ids=walk_tree.query(area,predicate='intersects')
  road=unary_union(asphalt_tree.geometries[road_ids]).intersection(area)
  walk=unary_union(walk_tree.geometries[walk_ids]).intersection(area).difference(road)
  tile['streetPavement']=encoded_polygons(road);tile['streetSidewalks']=encoded_polygons(walk)
  contact_ids=contact_tree.query(area,predicate='intersects')
  tile['deckPavement']=encoded_polygons(unary_union(contact_tree.geometries[contact_ids]).intersection(area))
 stats['pavementParts']=sum(len(t['streetPavement']) for t in headers.values())
 stats['fallbackSidewalkParts']=sum(len(t['streetSidewalks']) for t in headers.values())
 stats['deckContactParts']=sum(len(t['deckPavement']) for t in headers.values())
 return stats


def compile_headers(headers,roads,contacts=()):
 """Use the serialized measurement precision for fresh builds and rebuilds."""
 from street_surfaces import road_key
 from reviewed_road_inputs import reviewed_pavement,reviewed_streets,reviewed_parking_edges,restore_street_sources,source_hash
 restore_street_sources(headers)
 normalize_overlays(headers)
 reviewed_street_tiles=reviewed_streets(headers,roads)
 reviewed_tiles=reviewed_pavement(headers)
 by=defaultdict(list)
 for r in roads:
  if not r.get('elevations') and not r.get('tunnel'):by[r['id']].append(r)
 records={};surface=[];obstacles=[]
 for tile in headers.values():
  origin=np.array([tile['tx'],tile['tz']])*tile['size']
  for rec in tile['pavements']:
   e=np.asarray(rec['edges']).reshape(-1,4)/100;left=e[:,:2]+origin;right=e[:,2:]+origin
   road=min(by[rec['road']],key=lambda r:np.linalg.norm((left[0]+right[0])/2-r['points'][0]))
   records[road_key(road)]={'left':left,'right':right,'walk':rec.get('walk',[0,0])};surface.append(road)
  for walk in tile['sidewalks']:obstacles.append(Polygon(walk['rings'][0],walk['rings'][1:]).buffer(0))
  for rings in tile['islands']:obstacles.append(Polygon(rings[0],rings[1:]).buffer(0))
  for building in tile['buildings']:
   if not building.get('structure'):obstacles.append(Polygon(building['footprint']).buffer(0))
 surface.sort(key=road_key)
 stats=install_surfaces(headers,surface,records,road_key,obstacles,contacts)
 parking_tiles=reviewed_parking_edges(headers)
 stats['fallbackSidewalkParts']=sum(len(t['streetSidewalks']) for t in headers.values())
 return {**stats,'reviewedPavementTiles':reviewed_tiles,'reviewedStreetTiles':reviewed_street_tiles,'reviewedParkingTiles':parking_tiles,'reviewedSourceSHA256':source_hash()}
