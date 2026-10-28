"""Shared, reviewable building identity and religious-use rules (no imagery inference)."""
import json,math,pathlib,re

RULES=json.loads((pathlib.Path(__file__).resolve().parents[1]/'src/data/building-identities.json').read_text())

def apply_building_identity(building):
 identity=RULES['overrides'].get(building['id'])
 if identity:
  building.setdefault('sourceName',building['name'])
  building.update(identity)
 return building

def is_religious_building(building):
 kind=RULES['overrides'].get(building['id'],{}).get('kind',building.get('kind'))
 if building.get('amenity')=='place_of_worship' or kind in RULES['religiousKinds']:return True
 name=building.get('name','')
 return bool(re.search(RULES['religiousNamePattern'],name,re.I) and not re.search(RULES['nonReligiousNamePattern'],name,re.I))

def js_hash(text):
 """Same 32-bit string hash as src/render/materials.ts, so far-distance colours
 match the facade family the detailed tile will show."""
 n=0
 for c in text:n=(n*31+ord(c))&0xFFFFFFFF
 if n>=2**31:n-=2**32
 return abs(n)
WOOD_DISTRICTS={'Mission Hill','Jamaica Plain','Roxbury','Dorchester','Mattapan','South Boston','Charlestown','East Boston','Allston','Brighton','Somerville','Cambridge','Brookline'}
NOT_HOUSE_KINDS={'retail','commercial','industrial','office','garage','garages','church','school','university','college','hospital','warehouse','public','civic','dormitory','hotel','shed','roof','carport','parking','service','train_station','transportation','kindergarten','religious','government','supermarket'}
_footprints=None
def index_footprints(buildings):
 """Index every building once so wood_frame can reject attached row houses the
 way prepareNeighborhoodArchitecture does: a neighbour at least 6 m tall whose
 centre lies within 34 m, neither centre inside the other, and two or more of
 the house's corners within 0.55 m of the neighbour's walls. The runtime reads
 its neighbours from the far index, whose entries are convex hulls centred on
 the mean of their vertices, so the same hulls are indexed here."""
 global _footprints
 from shapely.geometry import Polygon
 from shapely.strtree import STRtree
 hulls=[];centers=[]
 for b in buildings:
  hull=Polygon(b['footprint']).convex_hull
  ring=list(hull.exterior.coords)[:-1] if hull.geom_type=='Polygon' else list(hull.coords)
  # far.bin stores hull vertices in decimetres, so the runtime measures against the quantized hull.
  ring=[(round(x,1),round(z,1)) for x,z in ring]
  hull=Polygon(ring) if len(ring)>=3 else hull
  hulls.append(hull);centers.append((sum(x for x,_ in ring)/max(1,len(ring)),sum(z for _,z in ring)/max(1,len(ring))))
 _footprints=(buildings,hulls,centers,STRtree(hulls))
def attached(b,polygon):
 if _footprints is None:return False
 from shapely.geometry import Point,box
 buildings,hulls,centers,tree=_footprints;cx,cz=b['center'];centre=Point(cx,cz)
 for k in tree.query(box(cx-34,cz-34,cx+34,cz+34)):
  other=buildings[k];hull=hulls[k];ox,oz=centers[k]
  if other is b or other['id']==b['id'] or other['height']<6 or hull.geom_type!='Polygon' or math.hypot(ox-cx,oz-cz)>34:continue
  if hull.contains(centre) or polygon.contains(Point(ox,oz)):continue
  if sum(1 for v in b['footprint'] if hull.exterior.distance(Point(v))<.55)>=2:return True
 return False
def wood_frame(b,area):
 """Detached-scale houses of the wood-frame districts. The runtime typology in
 src/render/neighborhood-profiles.ts paints these clapboard, so their far boxes
 carry the same family. OpenStreetMap records a material for almost none of
 the town buildings; size, district and the building tag stand in for it, and
 adjoining row-house masses keep their masonry family at both distances."""
 if b.get('landmark') or b.get('district') not in WOOD_DISTRICTS or b.get('kind','yes') in NOT_HOUSE_KINDS:return False
 if re.search(r'school|hospital|college',b['name'],re.I):return False
 if not (8.3<=b['height']<=14.4 and 65<=area<=245):return False
 from shapely.geometry import Polygon
 return not attached(b,Polygon(b['footprint']))
def facade_style(b):
 if is_religious_building(b):return 10
 p=b['footprint'];area=abs(sum(p[i][0]*p[(i+1)%len(p)][1]-p[(i+1)%len(p)][0]*p[i][1] for i in range(len(p))))/2;n=js_hash(b['id']);h=b['height']
 if wood_frame(b,area):return 11+n%5
 if h>65:return [7,8,9][n%3]
 if h>36:return [3,4,7,8,7][n%5]
 if area>1500:return [0,3,4,5,6,7][n%6]
 if h<12:return [0,1,2,6][n%4]
 return [0,0,1,2,3,5][n%6]

