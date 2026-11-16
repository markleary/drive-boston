"""Replace the disconnected upper southbound shell at Sullivan Square.

The Boston survey has a second 500 m carriageway beside northbound I-93,
continuing into an incorrectly aligned Leverett ramp. Neither end joins the
generated southbound network. Its 32.224 m pavement also incorrectly holds the
real southbound approach underneath it before the actual stacked section.

Remove its complete connected component, including the old barriers, before
solving road heights. The OSM southbound mainline and Exit 18 replace it. The
northbound deck and its Leverett entrance are a separate component and stay.
"""
import numpy as np
from museum_survey import duplicate_components

VERSION=1
REVIEWED=[(980,[-317.911,16.374,-4092.727],[363.739,33.124,-2568.727])]


def retire_southbound_shell(mesh):
 entry=mesh.header['buildings'][mesh.k]
 if mark:=entry.get('charlestownSourceReplacement'):
  assert mark['version']==VERSION and mark['removedTriangles']==980 and len(mark['components'])==1,'Rebuild/review the Charlestown survey replacement'
  return mark
 b=mesh.buildings[mesh.k];faces=np.concatenate([b['facade'],b['roof']]);roof=np.arange(len(faces))>=len(b['facade'])
 removed,components=duplicate_components(b['positions'],faces,REVIEWED,'Charlestown')
 mark={'version':VERSION,'stage':'build-i93-north.py','components':components,'removedTriangles':int(removed.sum()),
  'replacementRoutes':['i93-sb','i93-sb-exit-18']}
 entry['charlestownSourceReplacement']=mark
 mesh.replace(b['positions'],faces[~removed],roof[~removed])
 return mark
