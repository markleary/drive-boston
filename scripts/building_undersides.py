"""Close missing soffits at horizontal lower boundaries of surveyed buildings.

Use existing vertices only. A closed lower wall loop above the building datum,
with an upward roof covering its whole footprint, supplies the missing floor.
Ground floors, upper wall edges, partial boundaries and open structures are not
inferred as solids. Oppositely wound inner loops retain courtyard openings.
"""
from collections import defaultdict
import numpy as np
import shapely
from shapely.geometry import Polygon
from shapely.strtree import STRtree


def close_undersides(vertices, faces, base):
 p=np.asarray(vertices,dtype=np.float64).reshape(-1,3)
 f=np.asarray(faces,dtype=np.int64).reshape(-1,3)
 if not len(f):return f.copy(),[]
 welded,original,inverse=np.unique(np.round(p,5),axis=0,return_index=True,return_inverse=True)
 wf=inverse[f];edges=defaultdict(list)
 for i,face in enumerate(wf):
  for a,b in ((face[0],face[1]),(face[1],face[2]),(face[2],face[0])):
   if a!=b:edges[min(a,b),max(a,b)].append((i,int(a),int(b)))
 t=p[f];n=np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0]);length=np.linalg.norm(n,axis=1)
 # Reverse each boundary edge to give the cap the opposite edge direction.
 levels=defaultdict(list)
 for neighbours in edges.values():
  if len(neighbours)!=1:continue
  i,a,b=neighbours[0];y=welded[a,1]
  if y<=base+.03 or abs(y-welded[b,1])>1e-5:continue
  if abs(n[i,1])>=.3*length[i] or t[i,:,1].min()<y-1e-5 or t[i,:,1].max()<=y+.03:continue
  levels[y].append((b,a))
 if not levels:return f.copy(),[]
 # The roof must actually cover the inferred solid; a ring of open walls alone
 # is insufficient evidence, and a courtyard must stay open to the sky.
 roofs=np.flatnonzero(n[:,1]>.65*length)
 roof_polys=[Polygon(tri[:,[0,2]]) for tri in t[roofs]]
 tree=STRtree(roof_polys)
 additions=[];repairs=[]
 for y,boundary in sorted(levels.items()):
  outgoing=defaultdict(list);incoming=defaultdict(list)
  for a,b in boundary:outgoing[a].append(b);incoming[b].append(a)
  visited=set();rings=[]
  for start in sorted(outgoing):
   if start in visited:continue
   ring=[];v=start
   while v not in visited and len(outgoing[v])==1 and len(incoming[v])==1:
    visited.add(v);ring.append(v);v=outgoing[v][0]
   if v!=start or len(ring)<3:continue
   poly=Polygon(welded[ring][:,[0,2]])
   if not poly.is_valid or poly.area<.01:continue
   rings.append((ring,poly))
  outers=[(ring,poly) for ring,poly in rings if poly.exterior.is_ccw]
  holes=[(ring,poly) for ring,poly in rings if not poly.exterior.is_ccw]
  for ring,outer in outers:
   # Assign an inner ring to its smallest enclosing exterior, so separate
   # shells at the same height and nested islands keep their own topology.
   inner=[h for h,hp in holes if outer.contains(hp) and not any(other.area<outer.area and other.contains(hp) for _,other in outers)]
   poly=Polygon(welded[ring][:,[0,2]],[welded[h][:,[0,2]] for h in inner])
   if not poly.is_valid:continue
   cover=[roof_polys[j] for j in tree.query(poly) if t[roofs[j],:,1].min()>y+.03]
   if not cover or poly.difference(shapely.union_all(cover)).area>max(1e-6,poly.area*1e-6):continue
   lookup={tuple(welded[v,[0,2]]):original[v] for loop in [ring,*inner] for v in loop}
   cap=[]
   for triangle in shapely.get_parts(shapely.constrained_delaunay_triangles(poly)):
    ids=[lookup[tuple(xz)] for xz in list(triangle.exterior.coords)[:3]]
    a,b,c=p[ids]
    if np.cross(b-a,c-a)[1]>0:ids[1],ids[2]=ids[2],ids[1]
    cap.append(ids)
   additions.extend(cap);repairs.append({'height':round(float(y),5),'area':round(poly.area,3),'triangles':len(cap)})
 return (np.concatenate([f,np.asarray(additions,dtype=np.int64)]) if additions else f.copy()),repairs
