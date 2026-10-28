"""Conservative orientation repair for independently authored survey shells.

Keep all measured positions and topology. Flip a consistently wound connected
shell only when its elevated roof faces and signed enclosed volume both point
inwards. Downward floors/soffits in an outward shell remain downward.
"""
from collections import defaultdict
import numpy as np


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
