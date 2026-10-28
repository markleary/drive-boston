"""Shared, reviewable building identity and religious-use rules (no imagery inference)."""
import json,pathlib,re

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
def facade_style(b):
 if is_religious_building(b):return 10
 p=b['footprint'];area=abs(sum(p[i][0]*p[(i+1)%len(p)][1]-p[(i+1)%len(p)][0]*p[i][1] for i in range(len(p))))/2;n=js_hash(b['id']);h=b['height']
 if h>65:return [7,8,9][n%3]
 if h>36:return [3,4,7,8,7][n%5]
 if area>1500:return [0,3,4,5,6,7][n%6]
 if h<12:return [0,1,2,6][n%4]
 return [0,0,1,2,3,5][n%6]

