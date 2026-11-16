"""Retire the duplicate lower Leverett roadwork embedded in the Zakim mesh.

The active connectors are generated from source street alignments. The imported mesh
also contains two disconnected copies of its lower loop, including a constant
16.374 m slab over the Science Park underpass and clipped ramp mouths. Those
copies have incompatible heights and widths. Remove complete bounded mesh
components, including their rails; never cut upper I-93 triangles by XY alone.
"""
import numpy as np

VERSION=1
# Triangle counts and complete 3D bounds measured from the reviewed source.
# The survey also has upper-I93 cross-struts and small objects inside the same
# XY box: an envelope or height threshold alone would remove those as well.
REVIEWED=[
 (1008,[600.789,12.124,-2231.227],[963.039,32.524,-1792.627]),
 (1208,[649.989,12.724,-2268.027],[978.189,32.524,-1755.027]),
 (72,[742.639,12.124,-1814.477],[848.539,16.374,-1780.027]),
 (12,[616.439,15.774,-1851.127],[617.489,17.324,-1840.377]),
 (60,[616.839,12.724,-1851.127],[704.939,17.324,-1830.227]),
 (60,[616.439,12.724,-1841.277],[702.639,17.324,-1820.827]),
 (12,[835.339,15.774,-1791.527],[836.689,17.324,-1780.177]),
 (60,[753.389,12.724,-1795.127],[836.489,17.324,-1780.027]),
 (60,[769.339,12.724,-1805.927],[835.739,17.324,-1790.477]),
 (52,[748.739,15.774,-1828.627],[792.439,23.374,-1813.427]),
 (52,[745.739,15.774,-1819.377],[790.389,23.374,-1807.477]),
]


def duplicate_components(vertices,faces,reviewed=REVIEWED,label='Leverett'):
 """Return the reviewed connected components, or fail if the survey changed."""
 parent=list(range(len(vertices)))
 def root(i):
  while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
  return i
 for a,b,c in faces:
  for i in (b,c):parent[root(i)]=root(a)
 groups={}
 for i,f in enumerate(faces):groups.setdefault(root(f[0]),[]).append(i)
 removed=np.zeros(len(faces),bool);components=[];matched=set()
 for indices in groups.values():
  points=vertices[faces[indices]];low=points.min((0,1));high=points.max((0,1))
  signature=next((i for i,(count,a,b) in enumerate(reviewed) if len(indices)==count and np.max(np.abs(low-a))<.06 and np.max(np.abs(high-b))<.06),None)
  if signature is None:continue
  assert signature not in matched,f'Duplicate {label} component signature: review the updated survey'
  matched.add(signature);removed[indices]=True
  components.append({'triangles':len(indices),'min':low.round(3).tolist(),'max':high.round(3).tolist()})
 assert len(matched)==len(reviewed),f'{label} survey edition changed: found {len(matched)}/{len(reviewed)} reviewed components; rebuild/review before removing any geometry'
 return removed,components


def retire_duplicate_loops(mesh):
 entry=mesh.header['buildings'][mesh.k]
 if mark:=entry.get('leverettSourceReplacement'):
  assert mark['version']==VERSION,'Rebuild Zakim survey from its upstream source'
  assert mark['removedTriangles']==sum(row[0] for row in REVIEWED) and len(mark['components'])==len(REVIEWED),'Rebuild the survey: its recorded cut is not the reviewed lower-loop replacement'
  return mark
 b=mesh.buildings[mesh.k];faces=np.concatenate([b['facade'],b['roof']]);roof=np.arange(len(faces))>=len(b['facade'])
 removed,components=duplicate_components(b['positions'],faces)
 assert components,'Missing Leverett survey components without their replacement marker'
 mark={'version':VERSION,'stage':'build-i93-north.py','components':components,'removedTriangles':int(removed.sum()),
  'replacementRoutes':['leverett-connector-north','leverett-connector-south','storrow-leverett-east','storrow-leverett-west']}
 entry['leverettSourceReplacement']=mark
 mesh.replace(b['positions'],faces[~removed],roof[~removed])
 return mark
