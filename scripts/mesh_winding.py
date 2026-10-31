"""Conservative orientation repair for independently authored survey shells.

Keep all measured positions and topology. `orient_shells` flips a consistently
wound connected shell only when its elevated roof faces and signed enclosed
volume both point inwards. Downward floors/soffits in an outward shell remain
downward. `orient_patches` then judges the parts of an inconsistently wound
shell one consistent patch at a time, since such a shell has no component
orientation to flip.
"""
from collections import defaultdict
import numpy as np
import shapely
from shapely.geometry import Polygon
from shapely.strtree import STRtree


def orient_shells(vertices,faces):
 p=np.asarray(vertices,dtype=np.float64).reshape(-1,3)
 f=np.asarray(faces,dtype=np.int64).reshape(-1,3)
 if not len(f):return f.copy(),[]
 # OBJ material seams may duplicate coordinates. Weld for adjacency only.
 welded_positions,inverse=np.unique(np.round(p,5),axis=0,return_inverse=True)
 welded=inverse[f];parent=list(range(len(f)));edges={};bad=set()
 def root(i):
  while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
  return i
 for i,t in enumerate(welded):
  for a,b in [(t[0],t[1]),(t[1],t[2]),(t[2],t[0])]:
   if a==b:continue
   key=(min(a,b),max(a,b));previous=edges.get(key)
   if previous is None:edges[key]=(i,a<b,1);continue
   j,direction,count=previous
   parent[root(i)]=root(j)
   if direction==(a<b) or count>1:bad.add(i);bad.add(j)
   edges[key]=(j,direction,count+1)
 groups=defaultdict(list)
 for i in range(len(f)):groups[root(i)].append(i)
 boundaries=defaultdict(list)
 for edge,(i,_,count) in edges.items():
  if count==1:boundaries[root(i)].append(edge)
 bounds={key:(p[f[indices]].min(axis=(0,1)),p[f[indices]].max(axis=(0,1))) for key,indices in groups.items()}
 bad_roots={root(i) for i in bad};out=f.copy();repairs=[]
 for key,indices in groups.items():
  if key in bad_roots or len(indices)<6:continue
  ids=np.asarray(indices);t=p[f[ids]];n=np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0]);length=np.linalg.norm(n,axis=1)
  low=t[:,:,1].min();high=t[:,:,1].max();span=high-low
  if span<.5 or not np.any((np.abs(n[:,1])<length*.25)&(length>.1)):continue
  # Vertical divergence volume also works for the common open-bottom shells:
  # their missing floor lies on the zero-height reference plane.
  centers=t.mean(axis=1);volume=np.sum((centers[:,1]-low)*n[:,1])/2
  roof=(np.abs(n[:,1])>length*.65)&(centers[:,1]>low+.2)
  if not roof.any() or volume>=-.1:continue
  # Judge the upper roof, not the underside of a correctly wound overhang.
  top=roof&(centers[:,1]>=centers[roof,1].max()-max(.1,span*.05))
  up=np.maximum(n[top,1],0).sum();down=np.maximum(-n[top,1],0).sum()
  if down<1 or down<.95*(up+down):continue
  # Do not reinterpret an interior cavity as a separate solid, or infer a
  # volume from arbitrary open undersides. Open building shells generally
  # omit their floor; almost all open edge length must be at that floor.
  lo,hi=bounds[key]
  if any(other!=key and np.all(lo>=a-.001) and np.all(hi<=b+.001) and np.any(hi-lo<b-a-.01) for other,(a,b) in bounds.items()):continue
  boundary=boundaries[key];base_fraction=1.
  if boundary:
   bp=welded_positions[np.asarray(boundary)];lengths=np.linalg.norm(bp[:,1]-bp[:,0],axis=1)
   base_fraction=float(lengths[np.max(bp[:,:,1],axis=1)<=low+.03].sum()/max(lengths.sum(),1e-9))
   if base_fraction<.7:continue
  out[ids]=f[ids][:,[0,2,1]]
  repairs.append({'triangles':len(ids),'volume':round(float(volume),3),'topArea':round(float(down/2),3),'closed':not bool(boundary),'baseBoundaryFraction':round(base_fraction,3)})
 return out,repairs


def orient_patches(vertices,faces,probe=.3,minimum=1.,layer=.5):
 """Reverse consistently wound patches whose walls face into the building.

 Survey shells are assembled from parts whose winding can disagree: the roof of
 100 Hood Park Drive faces the sky while every wall of its main body faces the
 interior, so the single-sided facade material culls the near walls and the far
 walls show from inside. Such a shell has no component orientation to flip, so
 each patch of mutually consistent triangles (neighbours sharing an edge in
 opposite directions; a seam wound alike or shared by three faces separates
 patches) is judged on its own. A near-vertical wall is probed `probe` metres
 to either side at its centre height: it votes against its patch when only the
 side its normal points to lies under a covering face of the same building, and
 for it when only the other side does. A horizontal face with nothing above it
 votes by whether it faces up, unless an upward face lies within `layer` metres
 beneath it: a down-facing membrane or parapet tray resting on a roof that
 already shows reveals nothing when reversed and would turn its rim inwards. A
 wall under an eave, an interior partition, a soffit, a floor and a parapet see
 both sides alike and abstain. A patch with at least `minimum` square metres of
 inverted votes and twice as much inverted as confirmed area is reversed whole.
 Returns (faces, repairs) like orient_shells; positions, topology and the
 facade/roof split are unchanged."""
 p=np.asarray(vertices,dtype=np.float64).reshape(-1,3);f=np.asarray(faces,dtype=np.int64).reshape(-1,3)
 if not len(f):return f.copy(),[]
 _,inverse=np.unique(np.round(p,5),axis=0,return_inverse=True);welded=inverse.reshape(-1)[f];edges={}
 for i,t in enumerate(welded):
  for a,b in ((t[0],t[1]),(t[1],t[2]),(t[2],t[0])):
   if a!=b:edges.setdefault((min(a,b),max(a,b)),[]).append((i,a<b))
 parent=np.arange(len(f))
 def root(i):
  while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
  return i
 for pair in edges.values():
  if len(pair)==2 and pair[0][1]!=pair[1][1]:parent[root(pair[0][0])]=root(pair[1][0])
 patch=np.fromiter((root(i) for i in range(len(f))),dtype=np.int64,count=len(f))
 a,b,c=p[f[:,0]],p[f[:,1]],p[f[:,2]];n=np.cross(b-a,c-a);length=np.linalg.norm(n,axis=1);centers=(a+b+c)/3;ok=length>1e-9
 cover=np.nonzero(ok&(np.abs(n[:,1])>.2*length))[0]
 tree=STRtree([Polygon([(a[i,0],a[i,2]),(b[i,0],b[i,2]),(c[i,0],c[i,2])]) for i in cover]) if len(cover) else None
 def covered(points,heights,own,below=None):
  """Whether a covering face other than `own` passes above each (x, z) point at its height,
  or, with `below`, whether an upward face passes within that distance beneath it."""
  out=np.zeros(len(points),dtype=bool)
  if tree is None or not len(points):return out
  k,j=tree.query(shapely.points(points),predicate='intersects')
  if not len(k):return out
  i=cover[j];ni=n[i];y=centers[i,1]-(ni[:,0]*(points[k,0]-centers[i,0])+ni[:,2]*(points[k,1]-centers[i,2]))/ni[:,1]
  hit=(i!=own[k])&((y>heights[k]+.01) if below is None else (ni[:,1]>0)&(y<=heights[k]+.01)&(y>=heights[k]-below));out[k[hit]]=True
  return out
 inverted=np.zeros(len(f));confirmed=np.zeros(len(f));wall_votes=np.zeros(len(f))
 walls=np.nonzero(ok&(np.abs(n[:,1])<.3*length))[0]
 if len(walls):
  h=np.hypot(n[walls,0],n[walls,2]);step=np.stack([n[walls,0]/h,n[walls,2]/h],1)*probe;xz=centers[walls][:,[0,2]]
  front=covered(xz+step,centers[walls,1],walls);back=covered(xz-step,centers[walls,1],walls);area=length[walls]/2
  inverted[walls[front&~back]]=area[front&~back];confirmed[walls[back&~front]]=area[back&~front];wall_votes[walls[front!=back]]=area[front!=back]
 tops=np.nonzero(ok&(np.abs(n[:,1])>.65*length))[0]
 if len(tops):
  xz=centers[tops][:,[0,2]];exposed=tops[~covered(xz,centers[tops,1],tops)];down=n[exposed,1]<0
  resting=covered(centers[exposed][:,[0,2]],centers[exposed,1],exposed,below=layer)
  inverted[exposed[down&~resting]]=length[exposed[down&~resting]]/2;confirmed[exposed[~down]]=length[exposed[~down]]/2
 out=f.copy();repairs=[]
 for key in np.unique(patch):
  ids=np.nonzero(patch==key)[0];bad=inverted[ids].sum();good=confirmed[ids].sum()
  if bad<minimum or bad<=2*good:continue
  out[ids]=f[ids][:,[0,2,1]]
  repairs.append({'triangles':int(len(ids)),'area':round(float(length[ids].sum()/2),3),'inverted':round(float(bad),3),'confirmed':round(float(good),3),'wallVotes':round(float(wall_votes[ids].sum()),3)})
 return out,repairs
