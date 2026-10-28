#!/usr/bin/env python3
"""Compile the Greater Boston runtime data set: every Boston neighborhood except
Roslindale, West Roxbury, Hyde Park and the Harbor Islands, plus Cambridge,
Somerville and Brookline. Same methods as build-city.py (official centerlines
with name and class based widths, surveyed OBJ building models seated on the
USGS DEM), extended with Cambridge's OBJ models, OpenStreetMap buildings and
streets for the towns without open 3D models, generic bridge decks derived from
source level topology and water crossings, and streamed world tiles.
Requires: pip install -r scripts/requirements.txt (see DATA_SOURCES.md).
"""
from __future__ import annotations
import argparse, csv, gzip, hashlib, importlib.util, io, json, math, pathlib, re, struct, subprocess, sys, time, zipfile
from collections import Counter, defaultdict
import numpy as np
import shapely
from shapely.geometry import Point, LineString, Polygon, MultiPolygon, box
from shapely.ops import unary_union, polygonize
from shapely.prepared import prep
from shapely.strtree import STRtree
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import tileformat
from building_semantics import apply_building_identity,facade_style,index_footprints
spec=importlib.util.spec_from_file_location('city_compiler',ROOT/'scripts/build-city.py');central=importlib.util.module_from_spec(spec);spec.loader.exec_module(central)
xy,rounded,hull,load_layer,feature_polygons,polygon_rings,polygon_parts,context_polygons,visible_floor,geographic_polygon=central.xy,central.rounded,central.hull,central.load_layer,central.feature_polygons,central.polygon_rings,central.polygon_parts,central.context_polygons,central.visible_floor,central.geographic_polygon
FT=central.FT;ORIGIN=central.ORIGIN;TO_GEO=central.TO_GEO
TILE=1000
DECK=6.4
EXCLUDED=['Roslindale','West Roxbury','Hyde Park','Harbor Islands']
TOWNS={'CAMBRIDGE':'Cambridge','SOMERVILLE':'Somerville','BROOKLINE':'Brookline'}
SOURCES=[
 *central.SOURCES,
 {'name':'City of Boston official surrounding town polygons','url':'https://gisportal.boston.gov/arcgis/rest/services/Basemaps/Boston_Basemap_Cached_WM/MapServer/17','license':'City of Boston open data; source attribution retained'},
 {'name':'Cambridge GIS 3D building models (OBJ), 2023 edition','url':'https://www.cambridgema.gov/GIS/3D/3ddata','license':'City of Cambridge open data; no textures used'},
 {'name':'OpenStreetMap streets, buildings, parks, water and paths for Cambridge, Somerville and Brookline','url':'https://www.openstreetmap.org/copyright','license':'© OpenStreetMap contributors; ODbL 1.0'},
]
NAME_WIDTHS={'Boylston':13,'Newbury':10,'Commonwealth':9,'Marlborough':9,'Beacon':12,'Dartmouth':11,'Clarendon':11,'Berkeley':12,'Exeter':10,'Huntington':15,'Saint James':12,'Stuart':13,'Arlington':14,'Columbus':12,'Tremont':12,'Parker':9,'Parker Hill':8,'Francis':12,'Longwood':12,'Calumet':8,'Fisher':8,'Hillside':8,'Saint Alphonsus':9}
CLASS_WIDTHS={'A15':14,'A21':12,'A25':12,'A31':10,'A35':10,'A41':7,'A45':7,'A40':7,'A30':10}
OSM_WIDTHS={'trunk':14,'trunk_link':8,'primary':13,'primary_link':8,'secondary':11,'secondary_link':7,'tertiary':9,'tertiary_link':7,'residential':7,'unclassified':7,'living_street':6}
OSM_LEVELS={'house':2.5,'detached':2.5,'semidetached_house':2.5,'bungalow':1.5,'terrace':3,'residential':3,'apartments':4,'dormitory':4,'hotel':5,'garage':1,'garages':1,'shed':1,'roof':1,'carport':1,'hut':1,'commercial':3,'retail':2,'office':4,'industrial':2,'warehouse':2,'church':4,'chapel':3,'synagogue':3,'temple':3,'school':3,'kindergarten':2,'university':4,'college':4,'hospital':5,'civic':3,'public':3,'government':3,'fire_station':2,'train_station':2,'transportation':2,'service':1,'greenhouse':1,'yes':2.5}
GABLED={'house','detached','semidetached_house','bungalow','terrace'}

def log(*args):print(time.strftime('%H:%M:%S'),*args,flush=True)

class Grid:
 """Vectorised bilinear sampling of the DEM (same interpolation as the runtime)."""
 def __init__(self,data):
  self.width=data['width'];self.height=data['height'];self.cell=data['cellSize'];self.ox=data['originX'];self.oz=data['originZ']
  self.heights=np.asarray(data['heights'],dtype=np.float64).reshape(self.height,self.width)
 def sample(self,xs,zs):
  fx=np.clip((np.asarray(xs,dtype=np.float64)-self.ox)/self.cell,0,self.width-1);fz=np.clip((np.asarray(zs,dtype=np.float64)-self.oz)/self.cell,0,self.height-1)
  i=np.minimum(self.width-2,np.floor(fx).astype(np.int64));j=np.minimum(self.height-2,np.floor(fz).astype(np.int64));tx=fx-i;tz=fz-j;h=self.heights
  a=h[j,i];b=h[j,i+1];c=h[j+1,i];d=h[j+1,i+1]
  return np.where(tx+tz<=1,a+(b-a)*tx+(c-a)*tz,d+(c-d)*(1-tx)+(b-d)*(1-tz))
 def at(self,x,z):return float(self.sample([x],[z])[0])
 def header(self):return {'width':self.width,'height':self.height,'cellSize':self.cell,'originX':self.ox,'originZ':self.oz}

def building_base(grid,footprint,center):
 xs=[center[0]];zs=[center[1]]
 for a,b in zip(footprint,footprint[1:]+footprint[:1]):
  count=max(1,math.ceil(math.dist(a,b)/6))
  for i in range(count+1):xs.append(a[0]+(b[0]-a[0])*i/count);zs.append(a[1]+(b[1]-a[1])*i/count)
 return round(float(grid.sample(xs,zs).max())-.1,3)

def parse_obj_text(raw):
 rawv=[];faces=[]
 for l in raw.splitlines():
  s=l.split()
  if not s:continue
  if s[0]=='v':rawv.append([float(x) for x in s[1:4]])
  elif s[0]=='f':
   v=[int(x.split('/')[0]) for x in s[1:]];v=[i-1 if i>0 else len(rawv)+i for i in v]
   for k in range(1,len(v)-1):faces.append([v[0],v[k],v[k+1]])
 return [[(x-ORIGIN[0])*FT,z*FT,-(y-ORIGIN[1])*FT] for x,y,z in rawv],faces

def resolve_parts(candidates):
 """Same support rule as the central build: an upper part needs a lower model in
 its parcel/name group reaching its floor with at least 90% footprint support."""
 groups=defaultdict(list)
 for c in candidates:groups[c['group']].append(c)
 for group in groups.values():
  if len(group)<2:continue
  for c in group:
   if c['legacy']:continue
   supports=[]
   for other in group:
    if other is c or other['legacy']:continue
    gap=c['sourceMin']-other['sourceMin']
    if gap<.15 or other['sourceMax']<c['sourceMin']-.25:continue
    if gap<2 and c['sourceMin']<other['sourceMax']-.25:continue
    overlap=c['polygon'].intersection(other['polygon']).area/max(.01,c['polygon'].area)
    if overlap>=.9:supports.append((other['sourceMin'],overlap,other))
   if supports:c['parent']=max(supports,key=lambda v:(v[0],v[1]))[2]
 roots=set()
 for c in candidates:
  root=c
  while 'parent' in root:root=root['parent']
  c['root']=root
  if root is not c:roots.add(root['id'])
 return roots

class Districts:
 def __init__(self,bounds):
  self.polygons=[];self.names=[]
  for f in bounds['neighborhoods']['features']:
   name=f['properties']['name']
   if name in EXCLUDED:continue
   for p in feature_polygons(f):self.polygons.append(p);self.names.append(name)
  for f in bounds['towns']['features']:
   for p in feature_polygons(f):self.polygons.append(p);self.names.append(TOWNS[f['properties']['TOWN']])
  self.tree=STRtree(self.polygons);self.prepared=[prep(p) for p in self.polygons]
  self.excluded=prep(unary_union([p for f in bounds['neighborhoods']['features'] if f['properties']['name'] in EXCLUDED for p in feature_polygons(f)]))
  self.boston=unary_union([p for p,n in zip(self.polygons,self.names) if n not in TOWNS.values()])
  self.town={name:unary_union([p for p,n in zip(self.polygons,self.names) if n==name]) for name in TOWNS.values()}
 def lookup(self,point):
  for i in self.tree.query(point):
   if self.prepared[i].covers(point):return self.names[i]
  return None
 def nearest(self,point):return self.names[self.tree.nearest(point)]

def main():
 p=argparse.ArgumentParser();p.add_argument('--source-dir',type=pathlib.Path,default=ROOT/'data-source-cache');p.add_argument('--output-dir',type=pathlib.Path,default=ROOT/'public/data');p.add_argument('--limit-tiles',type=int,default=0,help='Debug: read only the first N Boston source tiles');args=p.parse_args()
 cache=args.source_dir;out=args.output_dir;began=time.time()
 bounds=json.loads((cache/'metro-boundaries.json').read_text());envelope=json.loads((cache/'metro-envelope.json').read_text())['bbox']
 districts=Districts(bounds)
 # City boundaries run along street centres; the 18 m margin retains whole
 # junctions and edge buildings exactly as the central build did.
 coverage=unary_union(districts.polygons).buffer(18,join_style=2).simplify(.5,preserve_topology=True);covered=prep(coverage)
 legacy_corners=[xy(lon,lat) for lon in [central.BACKBAY_BBOX[0],central.BACKBAY_BBOX[2]] for lat in [central.BACKBAY_BBOX[1],central.BACKBAY_BBOX[3]]]
 original=box(min(p[0] for p in legacy_corners),min(p[1] for p in legacy_corners),max(p[0] for p in legacy_corners),max(p[1] for p in legacy_corners));legacy=prep(original)
 log('Coverage',round(coverage.area/1e6,1),'km2 across',len(set(districts.names)),'districts')
 grid=Grid(json.loads((cache/'elevation.json').read_text()));terrain_provenance=json.loads((cache/'terrain-provenance.json').read_text())
 log('Terrain grid',grid.width,'x',grid.height)
 # ---- water and parks (needed before roads so crossings can become bridges)
 parks=context_polygons(cache,14,'SITE_NAME',coverage,'park')
 water_records=[(w,Polygon(w['rings'][0],w['rings'][1:]).buffer(0)) for w in context_polygons(cache,12,'NAME',geographic_polygon(envelope),'water')]
 osm_parks,osm_water,osm_paths,osm_signals,osm_buildings,osm_roads=load_osm(cache,districts,coverage)
 for name,polygon in osm_water:water_records.append(({'name':name},polygon))
 water_union=unary_union([p for _,p in water_records]).intersection(geographic_polygon(envelope));water=[]
 for k,part in enumerate(polygon_parts(water_union)):
  names=[(part.intersection(shape).area,record['name']) for record,shape in water_records if record['name'] not in ['Water','water','Hydro',None] and part.intersects(shape)]
  water.append({'id':f'water-merged-{k}','name':max(names)[1] if names else 'Water','rings':polygon_rings(part.simplify(.5,preserve_topology=True))})
 parks.extend(osm_parks);park_area=unary_union([Polygon(p['rings'][0],p['rings'][1:]).buffer(0) for p in parks]).buffer(1)
 wet=prep(water_union);deep=prep(water_union.buffer(-8))
 log('Water bodies',len(water),'parks',len(parks))
 # ---- roads
 roads,omitted,road_sources=build_roads(cache,coverage,districts,grid,wet,deep,water_union,osm_roads)
 log('Roads',len(roads),'bridge decks',sum(1 for r in roads if r.get('elevations')),'omitted tunnels',len(omitted),'degenerate stubs',road_sources['droppedDegenerate'])
 # ---- buildings
 buildings,geometry,manifest_stats,landmark_hits=build_buildings(cache,args,coverage,covered,legacy,districts,grid,osm_buildings)
 log('Buildings',len(buildings))
 # ---- curbs and signals
 curbs=[]
 for f in load_layer(cache,6):
  for path in f['geometry']['paths']:curbs.extend(central.clipped_lines([xy(*v) for v in path],coverage))
 curbs.extend(synthetic_curbs(roads,districts))
 signals=[]
 for f in load_layer(cache,12):
  g=f['geometry'];v=xy(g['x'],g['y'])
  if covered.covers(Point(v)):signals.append(rounded(v))
 signals.extend(osm_signals)
 log('Curbs',len(curbs),'signals',len(signals))
 # ---- park paths
 park_paths=[]
 for path in osm_paths:
  for k,points in enumerate(central.clipped_lines(path['points'],park_area)):park_paths.append({**path,'id':path['id']+f'-{k}','points':points})
 log('Park paths',len(park_paths))
 # ---- landmarks
 landmarks=build_landmarks(roads,buildings,grid,landmark_hits)
 spawn={'x':-291.674,'z':36.660,'yaw':1.924943916}
 # ---- output
 out.mkdir(parents=True,exist_ok=True);tiles_dir=out/'tiles'
 if tiles_dir.exists():
  for old in tiles_dir.glob('*.bin'):old.unlink()
 tile_keys=write_tiles(out,buildings,geometry,curbs,park_paths,roads)
 far_bytes=write_far(out,buildings)
 heights=np.rint(grid.heights.reshape(-1)*100).astype('<i2')
 with gzip.open(out/'elevation.bin','wb',compresslevel=9) as f:f.write(heights.tobytes())
 lon,lat=TO_GEO.transform(ORIGIN[0]+central.OFFSET[0],ORIGIN[1]+central.OFFSET[1])
 polygons=polygon_parts(coverage);outlines=[[rounded(v) for v in polygon.exterior.coords[:-1]] for polygon in polygons]
 corners=[xy(x,y) for x in [envelope[0],envelope[2]] for y in [envelope[1],envelope[3]]]
 world_bounds={'minX':round(min(p[0] for p in corners),3),'maxX':round(max(p[0] for p in corners),3),'minZ':round(min(p[1] for p in corners),3),'maxZ':round(max(p[1] for p in corners),3)}
 neighborhoods=[]
 for name in dict.fromkeys(districts.names):
  area=unary_union([p for p,n in zip(districts.polygons,districts.names) if n==name]).simplify(1,preserve_topology=True)
  neighborhoods.append({'id':name.lower().replace(' ','-'),'name':name,'rings':[ring for part in polygon_parts(area) for ring in polygon_rings(part)],'town':name in TOWNS.values()})
 data={'origin':{'xFeet':40000,'yFeet':50000,'longitude':lon,'latitude':lat},'bounds':world_bounds,'coverage':outlines,'spawn':spawn,'sources':SOURCES,
  'elevation':{**grid.header(),'file':'elevation.bin','scale':.01,'encoding':'int16-gzip'},
  'tiles':{'size':TILE,'directory':'tiles','keys':tile_keys,'far':'far.bin','buildingCount':len(buildings)},
  'landmarkBuildings':[{k:v for k,v in b.items() if k in LANDMARK_FIELDS} for b in buildings if b.get('landmark') or b['id'] in KEY_BUILDING_IDS],
  'roads':roads,'signals':signals,'landmarks':landmarks,'neighborhoods':neighborhoods,'parks':[{**p,'rings':[[rounded(v) for v in ring] for ring in p['rings']]} for p in parks],'water':water}
 (out/'city.json').write_text(json.dumps(data,separators=(',',':'))+'\n')
 for stale in ['city.glb']:
  if (out/stale).exists():(out/stale).unlink()
 provenance={'bbox':envelope,'region':'metro','packagingDate':'2026-10-28','generatedFrom':'Boston and Cambridge public OBJ/GIS sources, OpenStreetMap for Somerville and Brookline, USGS 3DEP bare-earth DEM',
  'districts':list(dict.fromkeys(districts.names)),'excludedNeighborhoods':EXCLUDED,'coverageAreaSquareMeters':round(coverage.area),'coveragePolygons':len(outlines),
  'buildingPlacement':'Original Back Bay normalization retained. Boston catalogue ground values interpreted as metres and Cambridge ground values as feet; primary source floors seated to DEM; geometrically supported upper parts share parent translation. OpenStreetMap footprints extruded by tagged height or levels with type defaults. Per-building normalization audit stored in each tile header (norm field).',
  'buildingSources':manifest_stats,'tiles':{'size':TILE,'count':len(tile_keys),'format':'DBT2 gzip; int16 centimetre positions per building anchor'},'farLodBytes':far_bytes,
  'roads':road_sources,'widths':'Prototype assumptions by street name and functional class, not authoritative lane inventory','omittedGradeSeparatedRoadIds':omitted,
  'roadStructures':{'deckHeightMeters':DECK,'policy':'Generic: nodes with positive source level or inside mapped water sit 6.4 m per level above the DEM; ramps use smoothstep to ground ends; water crossings between ground ends keep a linear thin slab','heightAccuracy':'Estimated local-datum profiles, not surveyed bridge engineering'},
  'legacyCoreBounds':list(original.bounds),'terrain':terrain_provenance,'neighborhoodPolicy':'Union of official Boston basemap neighborhood polygons (minus the excluded southern neighborhoods and Harbor Islands) and official surrounding town polygons, 18 m exterior margin for boundary streets.'}
 (out/'provenance.json').write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 log('Running Bowker road structures')
 subprocess.run([sys.executable,str(ROOT/'scripts/build-road-structures.py'),'--data-dir',str(out)],check=True)
 size=sum(f.stat().st_size for f in tiles_dir.glob('*.bin'))
 print(json.dumps({'buildings':len(buildings),'districts':dict(Counter(b['district'] for b in buildings)),'roads':len(roads),'curbs':len(curbs),'signals':len(signals),'landmarks':len(landmarks),'parks':len(parks),'water':len(water),'parkPaths':len(park_paths),'tiles':len(tile_keys),'tileBytes':size,'farBytes':far_bytes,'elevationBytes':(out/'elevation.bin').stat().st_size,'cityJsonBytes':(out/'city.json').stat().st_size,'coverageAreaSquareMeters':round(coverage.area),'minutes':round((time.time()-began)/60,1)},indent=1))

# ---------------------------------------------------------------- OpenStreetMap
def osm_elements(cache,name):
 path=cache/f'osm-{name}.json'
 return json.loads(path.read_text())['elements'] if path.exists() else []

def osm_polygons(element):
 """Polygons for a closed way or an assembled multipolygon relation."""
 if element['type']=='way':
  pts=[xy(p['lon'],p['lat']) for p in element.get('geometry') or []]
  if len(pts)<4 or pts[0]!=pts[-1]:return []
  return polygon_parts(Polygon(pts).buffer(0))
 if element['type']=='relation':
  outers=[];inners=[]
  for m in element.get('members',[]):
   if m['type']!='way' or not m.get('geometry'):continue
   pts=[xy(p['lon'],p['lat']) for p in m['geometry']]
   if len(pts)<2:continue
   (inners if m.get('role')=='inner' else outers).append(LineString(pts))
  if not outers:return []
  try:
   outer=unary_union(list(polygonize(unary_union(outers))))
   if inners:outer=outer.difference(unary_union(list(polygonize(unary_union(inners)))))
   return polygon_parts(outer.buffer(0))
  except Exception:return []
 return []

def parse_height(tags):
 h=tags.get('height') or tags.get('building:height')
 if h:
  m=re.match(r'\s*([\d.]+)\s*(m|ft|\'|feet)?',h)
  if m:
   value=float(m.group(1));unit=m.group(2)
   return value*.3048 if unit in ['ft',"'",'feet'] else value,'osm-height-tag'
 levels=tags.get('building:levels')
 if levels:
  try:return max(2.8,float(re.match(r'[\d.]+',levels).group(0))*3.3+.6),'osm-levels'
  except (ValueError,AttributeError):pass
 kind=tags.get('building','yes');return OSM_LEVELS.get(kind,2.5)*3.3+.6,'osm-type-default'

def load_osm(cache,districts,coverage):
 """Context polygons, park paths, signals, building footprints and streets from
 the OSM extracts. Cambridge keeps its official OBJ models, so only its roads,
 context and paths are taken from OSM; Somerville and Brookline use OSM buildings."""
 parks=[];water=[];paths=[];signals=[];buildings=[];roads=[]
 town_prepared={name:prep(poly) for name,poly in districts.town.items()}
 boston=prep(districts.boston)
 for key,name in [('cambridge','Cambridge'),('somerville','Somerville'),('brookline','Brookline')]:
  area=districts.town[name];inside=town_prepared[name]
  for e in osm_elements(cache,key+'-context'):
   tags=e.get('tags',{})
   for n,poly in enumerate(osm_polygons(e)):
    if not inside.intersects(poly):continue
    clipped=poly.intersection(area)
    for k,part in enumerate(polygon_parts(clipped)):
     if part.area<15:continue
     if tags.get('natural')=='water' or tags.get('waterway'):water.append((tags.get('name'),part))
     else:parks.append({'id':f"park-osm-{e['type']}-{e['id']}-{n}-{k}",'name':tags.get('name') or 'Park','rings':polygon_rings(part.simplify(.3,preserve_topology=True)),'kind':tags.get('leisure') or tags.get('landuse') or 'park'})
  for e in osm_elements(cache,key+'-roads'):
   tags=e.get('tags',{})
   if e['type']=='node':
    if tags.get('highway')=='traffic_signals':
     pt=xy(e['lon'],e['lat'])
     if inside.covers(Point(pt)) and not boston.covers(Point(pt)):signals.append(rounded(pt))
    continue
   if e['type']!='way' or tags.get('highway') not in OSM_WIDTHS or tags.get('area')=='yes':continue
   roads.append((name,e,tags))
  if name=='Cambridge':continue
  for e in osm_elements(cache,key+'-buildings'):
   tags=e.get('tags',{})
   if tags.get('building') in [None,'no'] or tags.get('location')=='underground':continue
   for n,poly in enumerate(osm_polygons(e)):
    if poly.area<8:continue
    centroid=poly.representative_point()
    if not inside.covers(centroid) or boston.covers(centroid):continue
    buildings.append((name,e,tags,poly,n))
 for e in osm_elements(cache,'metro-water'):
  tags=e.get('tags',{})
  if tags.get('natural')!='water':continue
  for poly in osm_polygons(e):
   if poly.area>=15:water.append((tags.get('name'),poly))
 covered=prep(coverage)
 for e in osm_elements(cache,'metro-paths'):
  tags=e.get('tags',{});pts=[xy(p['lon'],p['lat']) for p in e.get('geometry') or []]
  if e['type']!='way' or len(pts)<2 or tags.get('area')=='yes' or tags.get('highway') not in ['footway','path','pedestrian','steps','cycleway']:continue
  if not covered.intersects(LineString(pts)):continue
  try:width=float(re.match(r'[\d.]+',tags.get('width','')).group(0))
  except (ValueError,AttributeError):width=3.5 if tags['highway']=='pedestrian' else 3 if tags['highway']=='cycleway' else 2.6
  paths.append({'id':f"osm-way-{e['id']}",'points':pts,'width':max(1,min(width,8)),'bridge':tags.get('bridge','no')!='no','name':tags.get('name',''),'kind':tags['highway']})
 return parks,water,paths,signals,buildings,roads

# ---------------------------------------------------------------------- roads
def smooth(t):t=max(0,min(1,t));return t*t*(3-2*t)

def clean_points(pts,minimum=.5):
 """Drop vertices within half a metre of their neighbour (a source tail that
 short makes the ribbon builder wind a pavement backwards) and cut a polyline
 where it doubles back on itself (OSM out-and-back stubs). Returns None for a
 closed loop too short to be a real street."""
 out=[pts[0]]
 for p in pts[1:-1]:
  if math.dist(p,out[-1])>=minimum and math.dist(p,pts[-1])>=minimum:out.append(p)
 out.append(pts[-1])
 for i in range(1,len(out)-1):
  a=(out[i][0]-out[i-1][0],out[i][1]-out[i-1][1]);b=(out[i+1][0]-out[i][0],out[i+1][1]-out[i][1])
  if (a[0]*b[0]+a[1]*b[1])/(math.hypot(*a)*math.hypot(*b))<-.95:
   out=out[:i+1]
   if sum(math.dist(v,w) for v,w in zip(out,out[1:]))<20:return None
   break
 length=sum(math.dist(v,w) for v,w in zip(out,out[1:]))
 if len(out)<2 or length<3 or (math.dist(out[0],out[-1])<1 and length<60):return None
 return out

def deck_profile(points,grid,start_level,end_level,water_nodes,crosses_water,bridge_tag,source_id):
 """Resample a road every 3 m with a deck profile when any end is elevated or
 the alignment crosses water. Returns (points,elevations,bridge) or None."""
 lifted=[start_level>0 or water_nodes[0],end_level>0 or water_nodes[1]]
 if not (lifted[0] or lifted[1] or crosses_water or bridge_tag):return None
 ends=grid.sample([points[0][0],points[-1][0]],[points[0][1],points[-1][1]])
 ha=float(ends[0])+(DECK*max(1,start_level) if lifted[0] else 0);hb=float(ends[1])+(DECK*max(1,end_level) if lifted[1] else 0)
 total=sum(math.dist(a,b) for a,b in zip(points,points[1:]))
 if total<1:return None
 result=[];elevations=[];along=0
 for v,w in zip(points,points[1:]):
  length=math.dist(v,w);n=max(1,math.ceil(length/3))
  for j in range(n):
   t=j/n;s=(along+t*length)/total
   if lifted[0]!=lifted[1]:blend=smooth(s) if lifted[1] else 1-smooth(1-s)
   else:blend=s
   result.append([round(v[0]+(w[0]-v[0])*t,3),round(v[1]+(w[1]-v[1])*t,3)]);elevations.append(round(ha+(hb-ha)*blend,4))
  along+=length
 result.append([round(points[-1][0],3),round(points[-1][1],3)]);elevations.append(round(hb,4))
 thin=not (lifted[0] or lifted[1]) and not bridge_tag
 return result,elevations,{'id':f'structure-{source_id}','thickness':.45 if thin else .75,'clearanceEstimated':True,'kind':'water-crossing' if thin else 'elevated'}

def build_roads(cache,coverage,districts,grid,wet,deep,water_union,osm_roads):
 roads=[];omitted=[];dropped=0;features=load_layer(cache,8);boston_ends=defaultdict(list)
 def water_node(pt):return deep.covers(Point(pt))
 def crossing(line):return wet.intersects(line) and line.intersection(water_union).length>12
 for f in features:
  a=f['attributes'];name=a.get('ST_NAME')
  if not name or name=='James J Storrow Memorial' or name.startswith('Interstate ') or 'Turnpike' in name or 'Expressway' in name:continue
  cfcc=str(a.get('CFCC','')).strip()
  if cfcc in ['A71','A72'] or cfcc.startswith('A1'):continue
  start=a.get('F_ZLEV') or 0;end=a.get('T_ZLEV') or 0
  if start<0 or end<0:omitted.append(a['OBJECTID']);continue
  width=NAME_WIDTHS.get(name,4.2 if 'Alley' in name else CLASS_WIDTHS.get(cfcc,7))
  suffix={'ST':'Street','AVE':'Avenue','AV':'Avenue','PL':'Place','RD':'Road','CT':'Court','TER':'Terrace','CIR':'Circle','WAY':'Way','PKWY':'Parkway','DR':'Drive','BLVD':'Boulevard','SQ':'Square','HWY':'Highway','LN':'Lane','PK':'Park','ROW':'Row','WHARF':'Wharf','BRG':'Bridge'}.get(a.get('ST_TYPE'),'')
  prefix={'S':'South','N':'North','E':'East','W':'West'}.get(a.get('PRE_DIR'),'')
  label=' '.join(v for v in [prefix,name,suffix] if v)
  oneway=1 if a.get('ONEWAY')=='FT' else -1 if a.get('ONEWAY')=='TF' else 0
  for j,path in enumerate(f['geometry']['paths']):
   for k,pts in enumerate(central.clipped_lines([xy(*v) for v in path],coverage)):
    pts=clean_points(pts)
    if pts is None:dropped+=1;continue
    road={'id':f"{a['OBJECTID']}-{j}-{k}",'name':label,'points':pts,'width':width,'oneway':oneway}
    line=LineString(pts);deck=(pts,start,end,[water_node(pts[0]),water_node(pts[-1])],crossing(line),False);profile=deck_profile(deck[0],grid,*deck[1:],road['id'])
    if profile:road['points'],road['elevations'],road['bridge']=profile;road['_deck']=deck;road['startLevel']=1 if (start>0 or deck[3][0]) else 0;road['endLevel']=1 if (end>0 or deck[3][1]) else 0
    roads.append(road)
    for endpoint in [pts[0],pts[-1]]:boston_ends[(round(endpoint[0]/20),round(endpoint[1]/20))].append(endpoint)
 boston_count=len(roads)
 # Town streets come from OpenStreetMap, clipped to the town polygons minus a
 # narrow strip inside Boston so boundary streets are drawn once, then snapped
 # to the official Boston segment ends they continue.
 strip=districts.boston.buffer(4)
 areas={name:prep(poly.difference(strip)) for name,poly in districts.town.items()};areas_raw={name:poly.difference(strip) for name,poly in districts.town.items()}
 def snap(pt):
  cx,cz=round(pt[0]/20),round(pt[1]/20);best=None
  for dx in (-1,0,1):
   for dz in (-1,0,1):
    for candidate in boston_ends.get((cx+dx,cz+dz),[]):
     d=math.dist(pt,candidate)
     if d<10 and (best is None or d<best[0]):best=(d,candidate)
  return list(best[1]) if best else pt
 snapped=0
 for town,e,tags in osm_roads:
  if tags.get('tunnel') not in [None,'no'] or (tags.get('layer') or '0').lstrip('-').isdigit() and int(tags.get('layer') or 0)<0:continue
  pts=[xy(p['lon'],p['lat']) for p in e.get('geometry') or []]
  if len(pts)<2:continue
  line=LineString(pts)
  if not areas[town].intersects(line):continue
  pieces=[line] if areas[town].contains(line) else [g for g in polygon_parts_lines(line.intersection(areas_raw[town])) if g.length>=3]
  kind=tags['highway']
  try:width=max(5,min(16,float(re.match(r'[\d.]+',tags.get('width','')).group(0))))
  except (ValueError,AttributeError):
   try:width=max(5,min(16,float(re.match(r'[\d.]+',tags.get('lanes','')).group(0))*3.3+1))
   except (ValueError,AttributeError):width=OSM_WIDTHS[kind]
  oneway=1 if tags.get('oneway') in ['yes','true','1'] else -1 if tags.get('oneway')=='-1' else 0
  label=tags.get('name') or ('Unnamed lane' if kind=='living_street' else f"Unnamed {kind.replace('_link',' ramp').replace('_',' ')}")
  bridge_tag=tags.get('bridge') not in [None,'no'] or ((tags.get('layer') or '0').lstrip('-').isdigit() and int(tags.get('layer') or 0)>0)
  for k,piece in enumerate(pieces):
   coords=[rounded(p) for p in piece.coords]
   for index in (0,-1):
    moved=snap(coords[index])
    if moved is not coords[index]:coords[index]=rounded(moved);snapped+=1
   coords=clean_points(coords)
   if coords is None:dropped+=1;continue
   road={'id':f"osm-{e['id']}-{k}",'name':label,'points':coords,'width':round(width,2),'oneway':oneway,'kind':kind}
   deck=(coords,0,0,[water_node(coords[0]),water_node(coords[-1])],crossing(LineString(coords)),bridge_tag);profile=deck_profile(deck[0],grid,*deck[1:],road['id'])
   if profile:road['points'],road['elevations'],road['bridge']=profile;road['_deck']=deck;road['startLevel']=1 if deck[3][0] else 0;road['endLevel']=1 if deck[3][1] else 0
   roads.append(road)
 log('OSM town roads',len(roads)-boston_count,'snapped ends',snapped)
 log('Deck ends lowered to reach island streets',rescue_islands(roads,grid,(-291.674,36.660)))
 return roads,omitted,{'boston':{'source':'Boston GIS street centerlines (layer 8)','count':boston_count},'towns':{'source':'OpenStreetMap highway ways (trunk to living_street); service, pedestrian and motorway classes omitted','count':len(roads)-boston_count,'snappedEnds':snapped},'droppedDegenerate':dropped}

def rescue_islands(roads,grid,spawn):
 """A street whose only junction with the network is the end of a lifted deck
 (a dam or causeway drawn inside mapped water, or a source level the lower
 street does not share) would be an unreachable island, as the Museum of
 Science driveway was off the Charles River Dam. Ramp such deck ends down to
 grade so the junction meets, repeating while new islands connect."""
 def key(p,y):return (round(p[0]*2),round(p[1]*2),round(y*2))
 def seg(p,a,b):
  dx,dz=b[0]-a[0],b[1]-a[1];u=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz or 1)));return math.hypot(p[0]-a[0]-u*dx,p[1]-a[1]-u*dz)
 lowered=0
 for _ in range(4):
  graph=defaultdict(set);first={}
  for road in roads:
   ys=road.get('elevations');ks=[key(p,ys[i] if ys else grid.at(*p)) for i,p in enumerate(road['points'])];first[road['id']]=ks[0]
   for a,b in zip(ks,ks[1:]):graph[a].add(b);graph[b].add(a)
  comp={};n=0
  for start in graph:
   if start in comp:continue
   n+=1;comp[start]=n;stack=[start]
   while stack:
    a=stack.pop()
    for b in graph[a]:
     if b not in comp:comp[b]=n;stack.append(b)
  start_road=min(roads,key=lambda r:min(seg(spawn,a,b) for a,b in zip(r['points'],r['points'][1:])));main=comp[first[start_road['id']]]
  ends=defaultdict(list)
  for road in roads:
   for i in (0,-1):p=road['points'][i];ends[(round(p[0],1),round(p[1],1))].append((road,i))
  changed=0
  for shared in ends.values():
   groups={comp[first[r['id']]] for r,_ in shared}
   if len(groups)<2 or main not in groups:continue
   decks=[(r,i) for r,i in shared if r.get('_deck') and comp[first[r['id']]]==main]
   if not decks or not any(not r.get('elevations') and comp[first[r['id']]]!=main for r,_ in shared):continue
   for r,i in decks:
    pts,start,end,water,crosses,tag=r['_deck']
    if i==0:start=0;water=[False,water[1]]
    else:end=0;water=[water[0],False]
    deck=(pts,start,end,water,crosses,tag);profile=deck_profile(deck[0],grid,*deck[1:],r['id']);r['_deck']=deck;changed+=1
    if profile:r['points'],r['elevations'],r['bridge']=profile
    else:r['points']=pts;r.pop('elevations',None);r.pop('bridge',None)
    r['startLevel']=1 if (start>0 or water[0]) else 0;r['endLevel']=1 if (end>0 or water[1]) else 0
  lowered+=changed
  if not changed:break
 for road in roads:road.pop('_deck',None)
 return lowered

def polygon_parts_lines(geometry):
 if geometry.geom_type=='LineString':return [geometry]
 if hasattr(geometry,'geoms'):return [g for g in geometry.geoms if g.geom_type=='LineString']
 return []

def synthetic_curbs(roads,districts):
 """Towns have no open curb layer: derive curb lines from the boundary of the
 union of their ground-level street pavements."""
 result=[]
 for name,area in districts.town.items():
  inside=prep(area);pavements=[]
  for r in roads:
   if not r['id'].startswith('osm-') or r.get('elevations'):continue
   if inside.intersects(LineString(r['points'])):pavements.append(LineString(r['points']).buffer(r['width']/2+.35,cap_style=2,join_style=2))
  if not pavements:continue
  boundary=unary_union(pavements).boundary
  for part in polygon_parts_lines(boundary) if boundary.geom_type!='LineString' else [boundary]:
   pts=[rounded(p) for p in part.simplify(.15).coords]
   for i in range(0,len(pts)-1,40):result.append(pts[i:i+41])
  log('Synthetic curbs for',name,len(result))
 return result

# ------------------------------------------------------------------ buildings
LANDMARK_IDS={'BOS-SVW9N-993CZ-MQI3K':'trinity','BOS-UKVLD-7CM74-Y9HBL':'library','BOS-6T6GA-7AUWF-K9HHY':'hancock','BOS-86B4E-VWXL2-YYYRR':'faneuil-hall','BOS-7NJX5-W2Y9P-OV9A0':'quincy-market','BOS-MFQR8-QVJIQ-WA52G':'custom-house','BOS-E9LMV-HNBSR-HE90Q':'old-north-church','BOS-VOQKB-AY4S3-7DNA0':'old-state-house','BOS-6JW0O-0UKVU-EA9CP':'city-hall','BOS-QXHWT-FEULR-NC03U':'museum-of-science','BOS-DIPUS-MOOL6-PJ4EY':'south-station','BOS-09YGL-4EWS8-OPPGI':'park-street-church','BOS-JBDU8-VZH4R-WXY1R':'kings-chapel','BOS-HM5AG-P0OP7-66YYQ':'old-south-meeting-house','BOS-168OQ-MKVVL-3QJXL':'millennium-tower','BOS-VE8WA-2KF3I-D31M4':'convention-center','BOS-2E9SM-83L3W-UVT08':'zakim-bridge','CAM_PX4ND-TBOZP-3FRN5':'mit-dome','CAM_20TZA-X87UC-ZWCKG':'widener-library','CAM_EXP00-RH2O7-V8A8B':'stata-center','CAM_OOY5L-PGU0F-QF3FN':'cambridge-city-hall','CAM_Y9GRZ-C4SE0-FGVNN':'massachusetts-hall'}
LANDMARK_POINTS=[('bunker-hill-monument',-71.06078,42.37627),('td-garden',-71.06218,42.36626),('jfk-library',-71.03432,42.31652),('harvard-stadium',-71.12640,42.36668),('memorial-hall',-71.11440,42.37625),('dorchester-heights-monument',-71.04670,42.33310),('fort-independence',-71.01069,42.33857),('prospect-hill-tower',-71.09576,42.38109),('logan-terminal',-71.01650,42.36690)]

def build_buildings(cache,args,coverage,covered,legacy,districts,grid,osm_buildings):
 buildings=[];geometry=[];seen_sig=set();seen_ids=set();stats=Counter();landmark_hits={}
 point_targets=[(key,Point(xy(lon,lat))) for key,lon,lat in LANDMARK_POINTS]
 def emit(entry,record,audit):
  apply_building_identity(entry)
  entry['norm']=audit;buildings.append(entry);geometry.append(record)
  poly=Polygon(entry['footprint'])
  for key,pt in point_targets:
   if key not in landmark_hits and poly.covers(pt) and entry['height']>4:landmark_hits[key]=entry['id'];entry['landmark']=key
 def process_catalog(candidates,source_key,policy_name,feet_ground):
  roots=resolve_parts(candidates)
  for c in candidates:
   root=c['root'];ground=root['ground'];r=c['row']
   if root['legacy']:anchor=ground*FT;policy='legacy-backbay-feet'
   elif ground is not None:anchor=max(ground*FT if feet_ground else ground,root['sourceMin']);policy=policy_name
   else:anchor=root['sourceMin'];policy='source-floor-no-catalog-ground'
   if not root['legacy']:
    if '_floor' not in root:root['_floor']=visible_floor(root['vertices'],root['faces'],anchor)
    anchor+=root['_floor']
   base=building_base(grid,root['footprint'],root['center']);height=round(max(0,c['sourceMax']-anchor),2)
   if height<1.5 and c['id'] not in roots and root is c:continue
   vertices=[[x,base+max(0,y-anchor),z] for x,y,z in c['vertices']]
   # Quantized positions are relative to the geometry's own bounding-box centre,
   # which keeps every vertex inside the int16 range regardless of catalog centroids.
   xs=[v[0] for v in vertices];zs=[v[2] for v in vertices];ax=round((min(xs)+max(xs))/2,3);az=round((min(zs)+max(zs))/2,3)
   if max(max(xs)-ax,max(zs)-az)>3200:stats['oversized-skipped']+=1;log('Skipping oversized model',c['id'],round(max(xs)-min(xs)),'x',round(max(zs)-min(zs)),'m');continue
   record=tileformat.mesh_record(vertices,c['faces'],[ax,base,az],base,repair_winding=c['id'] not in STRUCTURE_IDS)
   if record is None:continue
   offset=round(min(v[1] for v in vertices)-base,6)
   entry={'id':c['id'],'name':c['name'] or c['district']+' building','center':c['center'],'height':height,'footprint':c['footprint'],'baseElevation':base,'district':c['district'],'anchor':[ax,base,az],'source':source_key}
   landmark=LANDMARK_IDS.get(c['id']) or c.get('landmark')
   if landmark:entry['landmark']=landmark;landmark_hits[landmark]=c['id']
   if 'parent' in c:entry['partOf']=c['parent']['id'];entry['sourceBaseOffset']=offset
   if c['id'] in STRUCTURE_IDS:cx,cz=c['center'];entry['footprint']=[[round(cx+dx,3),round(cz+dz,3)] for dx,dz in ((-3,-3),(3,-3),(3,3),(-3,3))];entry['structure']=True
   elif (height>60 and c['polygon'].area>15000) or c['polygon'].area>100000:FAR_FRAGMENTS[c['id']]=far_fragments(vertices,base,height)
   audit={'min':round(c['sourceMin'],4),'max':round(c['sourceMax'],4),'ground':round(anchor,4),'policy':policy,'offset':offset,'catalogGround':ground}
   if 'parent' in c:audit['root']=root['id']
   emit(entry,record,audit);stats[policy]+=1
 # Boston tiles
 tiles=sorted(p for p in cache.glob('*-models.zip') if re.match(r'^[A-O]\d+-models\.zip$',p.name))
 if args.limit_tiles:tiles=tiles[:args.limit_tiles]
 town_names=set(TOWNS.values())
 for path in tiles:
  z=zipfile.ZipFile(path);candidates=[]
  for r in csv.DictReader(io.StringIO(z.read('catalog.csv').decode('utf-8-sig'))):
   if r['Status'] not in ['Current','Complete','Approved Demo']:continue
   keep_bridge=r['Model_ID'] in LANDMARK_IDS
   if r.get('StructType') not in ['Building','Structure',''] and not keep_bridge:continue
   if r['Model_ID'] in seen_ids:continue
   try:lon,lat=float(r['Centr_Lon']),float(r['Centr_Lat'])
   except ValueError:continue
   center=rounded(xy(lon,lat));point=Point(center)
   if not covered.covers(point) or districts.excluded.covers(point):continue
   district=districts.lookup(point) or districts.nearest(point)
   if district in town_names:continue
   try:vertices,faces=central.parse_obj(r,z)
   except KeyError:continue
   if len(vertices)<3 or not faces:continue
   sig=hashlib.sha256(np.round(np.asarray(vertices),3).tobytes()).hexdigest()
   if sig in seen_sig:continue
   seen_sig.add(sig);seen_ids.add(r['Model_ID'])
   footprint=hull([(v[0],v[2]) for v in vertices])
   if len(footprint)<3:continue
   try:ground=float(r['Gnd_El_Ft']) if r.get('Gnd_El_Ft') not in [None,''] else None
   except ValueError:ground=None
   candidate={'id':r['Model_ID'],'row':r,'name':(r.get('Name') or '').strip(),'vertices':vertices,'faces':faces,'center':center,'footprint':footprint,'polygon':Polygon(footprint),'legacy':legacy.covers(point),'district':district,'sourceMin':min(v[1] for v in vertices),'sourceMax':max(v[1] for v in vertices),'ground':ground,'group':r.get('Parcel_ID') or r.get('Name') or r['Model_ID']}
   # Same name rule as the central build for the three original Copley Square landmarks.
   if candidate['legacy']:
    if candidate['name']=='Trinity Church':candidate['landmark']='trinity'
    elif candidate['name']=='Boston Public Library':candidate['landmark']='library'
    elif candidate['name'].startswith('John Hancock Tower'):candidate['landmark']='hancock'
   candidates.append(candidate)
  process_catalog(candidates,'boston-obj','catalog-metres-and-source-floor',False)
  log('Boston tile',path.name,'candidates',len(candidates),'total buildings',len(buildings))
 # Cambridge tiles
 for path in sorted(cache.glob('CAMB*-models.zip')):
  z=zipfile.ZipFile(path);names=set(z.namelist());candidates=[]
  for r in csv.DictReader(io.StringIO(z.read('catalog/catalog.csv').decode('utf-8-sig'))):
   poi=(r.get('POI_Type') or '').strip()
   if poi in ['Wall','River Bridge','Rail Bridge','Overpass','Footbridge','Tunnel','Ped/Bike Bridge'] and r['Model_ID'] not in LANDMARK_IDS:continue
   if r['Model_ID'] in seen_ids:continue
   try:lon,lat=float(r['Center_Long']),float(r['Center_Lat'])
   except ValueError:continue
   center=rounded(xy(lon,lat));point=Point(center)
   if not covered.covers(point):continue
   district=districts.lookup(point) or districts.nearest(point)
   if district!='Cambridge':continue
   member=f"models/{r['Model_ID']}_OBJ/{r['Model_ID']}_OBJ.obj"
   if member not in names:continue
   vertices,faces=parse_obj_text(z.read(member).decode('utf-8','replace'))
   if len(vertices)<3 or not faces:continue
   sig=hashlib.sha256(np.round(np.asarray(vertices),3).tobytes()).hexdigest()
   if sig in seen_sig:continue
   seen_sig.add(sig);seen_ids.add(r['Model_ID'])
   footprint=hull([(v[0],v[2]) for v in vertices])
   if len(footprint)<3:continue
   try:ground=float(r['Ground_Elev_Ft']) if r.get('Ground_Elev_Ft') not in [None,''] else None
   except ValueError:ground=None
   candidates.append({'id':r['Model_ID'],'row':r,'name':(r.get('Name') or '').strip(),'vertices':vertices,'faces':faces,'center':center,'footprint':footprint,'polygon':Polygon(footprint),'legacy':False,'district':district,'sourceMin':min(v[1] for v in vertices),'sourceMax':max(v[1] for v in vertices),'ground':ground,'group':r.get('Building_ID') or r.get('Name') or r['Model_ID']})
  process_catalog(candidates,'cambridge-obj','cambridge-catalog-feet-and-source-floor',True)
  log('Cambridge tile',path.name,'candidates',len(candidates),'total buildings',len(buildings))
 # OpenStreetMap extrusions for Somerville and Brookline
 for town,e,tags,poly,n in osm_buildings:
  identifier=f"osm-{e['type']}-{e['id']}"+(f'-{n}' if n else '')
  if identifier in seen_ids:continue
  seen_ids.add(identifier)
  height,policy=parse_height(tags);height=round(max(2.5,min(140,height)),2)
  footprint=hull(list(poly.exterior.coords))
  if len(footprint)<3:continue
  center=rounded([poly.centroid.x,poly.centroid.y]);base=building_base(grid,footprint,center)
  vertices,faces=extrude(poly,base,height,tags)
  if not faces:continue
  xs=[v[0] for v in vertices];zs=[v[2] for v in vertices];ax=round((min(xs)+max(xs))/2,3);az=round((min(zs)+max(zs))/2,3)
  if max(max(xs)-ax,max(zs)-az)>3200:stats['oversized-skipped']+=1;continue
  record=tileformat.mesh_record(vertices,faces,[ax,base,az],base)
  if record is None:continue
  name=tags.get('name') or ' '.join(v for v in [tags.get('addr:housenumber'),tags.get('addr:street')] if v) or f'{town} building'
  entry={'id':identifier,'name':name,'center':center,'height':round(max(v[1] for v in vertices)-base,2),'eaveHeight':height,'footprint':footprint,'baseElevation':base,'district':town,'anchor':[ax,base,az],'source':'osm-extrusion','kind':tags.get('building','yes')}
  if tags.get('amenity'):entry['amenity']=tags['amenity']
  emit(entry,record,{'min':base,'max':round(base+height,4),'ground':base,'policy':policy,'offset':0});stats[policy]+=1
 log('OSM buildings',sum(1 for b in buildings if b['source']=='osm-extrusion'))
 return buildings,geometry,dict(stats),landmark_hits

def extrude(poly,base,height,tags):
 """Walls plus a constrained-Delaunay flat roof; small houses get a simple
 gable along the long axis of their bounding rectangle."""
 # Ring direction supplies the actual outside, including concave walls and
 # courtyards; a vector from the centroid does not work for those shapes.
 poly=shapely.orient_polygons(poly)
 vertices=[];faces=[];index={}
 def vertex(x,y,z):
  key=(round(x,4),round(y,4),round(z,4))
  if key not in index:index[key]=len(vertices);vertices.append([x,y,z])
  return index[key]
 def triangle(a,b,c,outward):
  (ax,ay,az),(bx,by,bz),(cx,cy,cz)=vertices[a],vertices[b],vertices[c]
  nx=(by-ay)*(cz-az)-(bz-az)*(cy-ay);ny=(bz-az)*(cx-ax)-(bx-ax)*(cz-az);nz=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax)
  faces.append([a,b,c] if nx*outward[0]+ny*outward[1]+nz*outward[2]>=0 else [a,c,b])
 kind=tags.get('building','yes');roof_shape=tags.get('roof:shape')
 rect=poly.minimum_rotated_rectangle;corners=list(rect.exterior.coords)[:-1] if rect.geom_type=='Polygon' else []
 gable=len(corners)==4 and (roof_shape in ['gabled','hipped'] or (roof_shape is None and (kind in GABLED or kind in ['yes','residential'] and poly.area<220))) and poly.area>=.8*rect.area and rect.area<420
 eave=base+height;cx,cz=poly.centroid.x,poly.centroid.y
 rings=[list(poly.exterior.coords)[:-1]]+[list(r.coords)[:-1] for r in poly.interiors]
 for ring in rings:
  for a,b in zip(ring,ring[1:]+ring[:1]):
   outward=[b[1]-a[1],0,a[0]-b[0]]
   b0=vertex(a[0],base,a[1]);b1=vertex(b[0],base,b[1]);t0=vertex(a[0],eave,a[1]);t1=vertex(b[0],eave,b[1])
   triangle(b0,b1,t1,outward);triangle(b0,t1,t0,outward)
 if gable:
  e0=math.dist(corners[0],corners[1]);e1=math.dist(corners[1],corners[2])
  if e0>=e1:short=[(corners[1],corners[2]),(corners[3],corners[0])]
  else:short=[(corners[0],corners[1]),(corners[2],corners[3])]
  rise=min(3.2,.38*min(e0,e1));ridge=eave+rise
  r0=vertex((short[0][0][0]+short[0][1][0])/2,ridge,(short[0][0][1]+short[0][1][1])/2);r1=vertex((short[1][0][0]+short[1][1][0])/2,ridge,(short[1][0][1]+short[1][1][1])/2)
  c=[vertex(p[0],eave,p[1]) for p in corners]
  # Close the footprint at eave level below the rectangular roof.
  for tri in shapely.constrained_delaunay_triangles(poly).geoms:
   pts=list(tri.exterior.coords)[:-1];ids=[vertex(p[0],eave,p[1]) for p in pts];triangle(ids[0],ids[1],ids[2],[0,1,0])
  # Gable ends are vertical, so an upward orientation test has zero (or
  # floating-point noise) dot product and can leave one end facing inward.
  for (a,b),r in zip(short,[r0,r1]):
   outward=[(a[0]+b[0])/2-cx,0,(a[1]+b[1])/2-cz]
   triangle(vertex(a[0],eave,a[1]),vertex(b[0],eave,b[1]),r,outward)
  if e0>=e1:
   triangle(c[0],c[1],r0,[0,1,0]);triangle(c[0],r0,r1,[0,1,0]);triangle(c[2],c[3],r1,[0,1,0]);triangle(c[2],r1,r0,[0,1,0])
  else:
   triangle(c[1],c[2],r1,[0,1,0]);triangle(c[1],r1,r0,[0,1,0]);triangle(c[3],c[0],r0,[0,1,0]);triangle(c[3],r0,r1,[0,1,0])
 else:
  for tri in shapely.constrained_delaunay_triangles(poly).geoms:
   pts=list(tri.exterior.coords)[:-1];ids=[vertex(p[0],eave,p[1]) for p in pts];triangle(ids[0],ids[1],ids[2],[0,1,0])
 return vertices,faces

# ------------------------------------------------------------------ landmarks
PLACES=[
 ('huntington-mfa','Huntington · Museum of Fine Arts',-71.09550693,42.33770361,'Green Line E and Route 39 · surface transit beside the Museum of Fine Arts'),
 ('fenway-park','Fenway Park',-71.0972,42.3467,'Fenway · historic ballpark at Lansdowne Street'),
 ('kenmore-square','Kenmore Square',-71.0953,42.3489,'Fenway · Beacon Street meets Commonwealth Avenue'),
 ('state-house','Massachusetts State House',-71.0638351,42.358597,'Beacon Hill · gold dome above Boston Common'),
 ('downtown-crossing','Downtown Crossing',-71.0604,42.3555,'Downtown · Washington and Summer streets'),
 ('chinatown-gate','Chinatown Gate',-71.0597,42.3512,'Chinatown · Beach Street and Hudson Street'),
 ('boston-common','Boston Common',-71.0657,42.3553,'Historic central park · Tremont Street arrival'),
 ('public-garden','Public Garden',-71.0699,42.3541,'Lagoon, winding paths and formal gardens'),
 ('faneuil-hall','Faneuil Hall · Quincy Market',-71.0567,42.3601,'Downtown · the 1742 meeting hall and the granite market halls'),
 ('old-north-church','Old North Church',-71.0544,42.3663,'North End · lanterns in the steeple, 1775'),
 ('custom-house','Custom House Tower',-71.0535,42.3590,'Downtown · 1915 clock tower above the waterfront'),
 ('city-hall-plaza','City Hall Plaza',-71.0580,42.3603,'Government Center · brutalist City Hall above the brick plaza'),
 ('td-garden','TD Garden · North Station',-71.0622,42.3663,'West End · Bruins and Celtics arena beside the Zakim Bridge'),
 ('museum-of-science','Museum of Science',-71.0710,42.3677,'Charles River Dam · the science museum between Boston and Cambridge'),
 ('longfellow-bridge','Longfellow Bridge',-71.0730,42.3617,'Salt-and-pepper towers over the Charles toward Kendall Square'),
 ('seaport-ica','Seaport · ICA',-71.0431,42.3529,'South Boston Waterfront · Institute of Contemporary Art on the harbor'),
 ('castle-island','Castle Island · Fort Independence',-71.0105,42.3375,'South Boston · granite fort at the harbor mouth'),
 ('dorchester-heights','Dorchester Heights',-71.0468,42.3331,'South Boston · 1776 evacuation monument on Telegraph Hill'),
 ('jfk-library','JFK Presidential Library',-71.0343,42.3165,'Columbia Point · I. M. Pei pavilion over Dorchester Bay'),
 ('nubian-square','Nubian Square',-71.0843,42.3287,'Roxbury · Washington Street and Dudley Street'),
 ('franklin-park-zoo','Franklin Park Zoo',-71.0877,42.3025,'Franklin Park · the Emerald Necklace country park'),
 ('jamaica-pond','Jamaica Pond',-71.1206,42.3193,'Jamaica Plain · kettle pond on the Jamaicaway'),
 ('arnold-arboretum','Arnold Arboretum',-71.1211,42.2983,'Jamaica Plain · Harvard tree collection at the Hunnewell gate'),
 ('mattapan-square','Mattapan Square',-71.0920,42.2678,'Mattapan · Blue Hill Avenue at River Street'),
 ('bunker-hill-monument','Bunker Hill Monument',-71.0608,42.3763,'Charlestown · granite obelisk on Breed’s Hill'),
 ('charlestown-navy-yard','Charlestown Navy Yard',-71.0547,42.3734,'Charlestown · USS Constitution piers and dry docks'),
 ('maverick-square','Maverick Square',-71.0395,42.3690,'East Boston · harbor tunnels are not modeled; arrive by air'),
 ('logan-airport','Logan Airport',-71.0165,42.3669,'East Boston · terminal road loop; harbor tunnels are not modeled, arrive by air'),
 ('harvard-stadium','Harvard Stadium',-71.1264,42.3667,'Allston · 1903 concrete horseshoe on Soldiers Field'),
 ('chestnut-hill-reservoir','Chestnut Hill Reservoir',-71.1561,42.3359,'Brighton · reservoir loop beside Boston College'),
 ('harvard-square','Harvard Square',-71.1190,42.3732,'Cambridge · the Yard, the Coop and Massachusetts Avenue'),
 ('harvard-yard','Harvard Yard · Widener',-71.1169,42.3744,'Cambridge · Widener Library and Memorial Hall'),
 ('mit-great-dome','MIT Great Dome',-71.0921,42.3598,'Cambridge · Killian Court and the Maclaurin buildings'),
 ('kendall-square','Kendall Square',-71.0862,42.3625,'Cambridge · Stata Center and the biotech blocks'),
 ('porter-square','Porter Square',-71.1193,42.3884,'Cambridge · Massachusetts Avenue at Somerville Avenue'),
 ('fresh-pond','Fresh Pond',-71.1468,42.3843,'Cambridge · reservoir parkway loop'),
 ('davis-square','Davis Square',-71.1223,42.3967,'Somerville · Holland Street and Elm Street'),
 ('union-square','Union Square',-71.0947,42.3796,'Somerville · Prospect Street and Somerville Avenue'),
 ('prospect-hill','Prospect Hill Tower',-71.0958,42.3811,'Somerville · castle tower where the Grand Union Flag flew'),
 ('assembly-row','Assembly Row',-71.0790,42.3925,'Somerville · Mystic riverfront district'),
 ('coolidge-corner','Coolidge Corner',-71.1212,42.3421,'Brookline · Beacon Street and Harvard Street'),
 ('brookline-village','Brookline Village',-71.1165,42.3325,'Brookline · Washington Street and Route 9'),
 ('larz-anderson-park','Larz Anderson Park',-71.1382,42.3178,'Brookline · hilltop lawns and the auto museum'),
]
DETACHED={'maverick-square':'Harbor tunnels are not modeled; reach East Boston by helicopter or teleport','logan-airport':'Harbor tunnels are not modeled; reach East Boston by helicopter or teleport'}

def build_landmarks(roads,buildings,grid,landmark_hits):
 names={'trinity':'Trinity Church','library':'Boston Public Library','hancock':'200 Clarendon'}
 descriptions={'trinity':'Richardsonian Romanesque landmark on Copley Square','library':'Boston Public Library · McKim and Johnson buildings','hancock':'200 Clarendon · the Back Bay skyline'}
 by_id={b['id']:b for b in buildings}
 landmarks=[{'id':key,'name':names[key],'position':by_id[identifier]['center'],'description':descriptions[key]} for key,identifier in landmark_hits.items() if key in names]
 parker=[]
 for road in roads:
  if road['name']!='Parker Hill Avenue':continue
  for a,b in zip(road['points'],road['points'][1:]):
   n=max(2,math.ceil(math.dist(a,b)/5))
   for i in range(n):
    t=i/n;point=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];parker.append((grid.at(*point),point))
 if not parker:raise RuntimeError('Coverage lacks Parker Hill Avenue')
 peak=max(parker,key=lambda p:p[0])
 landmarks.extend([{'id':'brigham-circle','name':'Brigham Circle','position':rounded(xy(-71.10475,42.3342)),'description':'Huntington Avenue at the heart of Mission Hill'},{'id':'mission-hill','name':'Mission Hill · Parker Hill','position':rounded(peak[1]),'driveStart':{'x':-2856.597333,'z':2034.765611,'yaw':-.006376513},'description':f'Parker Hill Avenue · {peak[0]:.0f}m above the Back Bay starting datum'}])
 centers=np.asarray([b['center'] for b in buildings]);ids=[b['id'] for b in buildings]
 for identifier,name,longitude,latitude,description in PLACES:
  position=rounded(xy(longitude,latitude))
  near=np.flatnonzero(np.hypot(centers[:,0]-position[0],centers[:,1]-position[1])<600)
  local_buildings=[buildings[i] for i in near]
  arrival_roads=[r for r in roads if r['name']=='Huntington Avenue'] if identifier=='huntington-mfa' else [r for r in roads if any(abs(p[0]-position[0])<700 and abs(p[1]-position[1])<700 for p in r['points'][::max(1,len(r['points'])//4)])]
  if identifier=='longfellow-bridge':arrival_roads=[r for r in arrival_roads if r['name'].startswith('Longfellow') and r.get('elevations')] or arrival_roads
  try:arrival=central.safe_arrival(position,arrival_roads,local_buildings)
  except RuntimeError:log('No arrival for',identifier);arrival=None
  entry={'id':identifier,'name':name,'position':position,'description':description}
  if arrival:
   entry['driveStart']=arrival
   road=nearest_road(arrival_roads,[arrival['x'],arrival['z']])
   if road and road.get('elevations'):entry['driveStart']['roadId']=road['id']
  if identifier in DETACHED:entry['detached']=DETACHED[identifier]
  for key,building_id in landmark_hits.items():
   if key==identifier or key.replace('-monument','')==identifier.replace('-monument',''):entry['buildingId']=building_id
  landmarks.append(entry)
 return landmarks

def nearest_road(roads,point):
 best=None
 for r in roads:
  for a,b in zip(r['points'],r['points'][1:]):
   dx,dz=b[0]-a[0],b[1]-a[1];u=max(0,min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dz)/(dx*dx+dz*dz or 1)));d=math.hypot(point[0]-a[0]-u*dx,point[1]-a[1]-u*dz)
   if best is None or d<best[0]:best=(d,r)
 return best[1] if best else None

# --------------------------------------------------------------------- tiles
def clip_to_tile(points,tx,tz):
 boxg=box(tx*TILE,tz*TILE,(tx+1)*TILE,(tz+1)*TILE)
 return [[rounded(p) for p in part.coords] for part in polygon_parts_lines(LineString(points).intersection(boxg)) if part.length>=.5]

def write_tiles(out,buildings,geometry,curbs,park_paths,roads):
 tiles=defaultdict(lambda:{'buildings':[],'geometry':[],'curbs':[],'parkPaths':[],'roads':set()})
 for entry,record in zip(buildings,geometry):
  tx,tz=tileformat.tile_of(entry['center'][0],entry['center'][1],TILE);tiles[(tx,tz)]['buildings'].append(entry);tiles[(tx,tz)]['geometry'].append(record)
 def spread(points,callback):
  xs=[p[0] for p in points];zs=[p[1] for p in points]
  for tx in range(math.floor(min(xs)/TILE),math.floor(max(xs)/TILE)+1):
   for tz in range(math.floor(min(zs)/TILE),math.floor(max(zs)/TILE)+1):callback(tx,tz)
 for curb in curbs:
  if len(curb)<2:continue
  spread(curb,lambda tx,tz:tiles[(tx,tz)]['curbs'].extend(clip_to_tile(curb,tx,tz)))
 for path in park_paths:
  spread(path['points'],lambda tx,tz:tiles[(tx,tz)]['parkPaths'].extend({**path,'id':path['id']+f'-{tx}_{tz}_{n}','points':pts} for n,pts in enumerate(clip_to_tile(path['points'],tx,tz))))
 for road in roads:
  spread(road['points'],lambda tx,tz:tiles[(tx,tz)]['roads'].add(road['id']) if box(tx*TILE,tz*TILE,(tx+1)*TILE,(tz+1)*TILE).buffer(road['width']+2).intersects(LineString(road['points'])) else None)
 keys=[]
 for (tx,tz),tile in sorted(tiles.items()):
  if not tile['buildings'] and not tile['curbs'] and not tile['parkPaths'] and not tile['roads']:continue
  header={'tx':tx,'tz':tz,'size':TILE,'buildings':tile['buildings'],'curbs':tile['curbs'],'parkPaths':tile['parkPaths'],'roads':sorted(tile['roads'])}
  tileformat.write_tile(out/'tiles'/tileformat.tile_name(tx,tz),header,tile['geometry']);keys.append(f'{tx}_{tz}')
 log('Wrote',len(keys),'tiles')
 return keys

# Buildings the runtime addresses by identity before their tile streams in:
# the State House dome, Prudential complex, 145 Dartmouth and the four Fenway
# Park shells (see src/render/*.ts and src/simulation/building-collisions.ts).
KEY_BUILDING_IDS={'BOS-1WKHX-X382F-V5VL1','BOS-KBIA4-2XA04-WNETP','BOS-Q6TUK-T7ZG3-2SJKK','BOS-73AP7-T4BL0-O4QDM','BOS-DA4MQ-LLJZX-89MF5','BOS-2ZJZB-IWPEJ-JUBMC','BOS-0HKZL-2YJWH-V1GAU','BOS-2E9SM-83L3W-UVT08','BOS-4WO5X-6OJI5-G5S26'}
# Survey meshes of structures rather than buildings (the Zakim Bridge with its
# Charlestown viaduct): exact-mesh collision, no foundation skirt, no far box and
# a token footprint so a 2 km convex hull never blocks streets, sidewalks or the
# helicopter. Both structures and the Logan terminal complex are KEY (exact-mesh) ids.
STRUCTURE_IDS={'BOS-2E9SM-83L3W-UVT08'}
FAR_FRAGMENTS={}
def far_fragments(vertices,base,height,cell=20):
 """Stepped far massing for a sprawling complex: the convex hull of a podium with
 towers would draw as one slab, so connected 20 m cells reaching 10/25/50/75% of
 the height become terraced hulls, each capped at the next band. The primary far
 entry is then hidden (flag bit 2) and the terraces follow it as fragments (bit 3)."""
 cells=defaultdict(float);points=defaultdict(list)
 for x,y,z in vertices:k=(math.floor(x/cell),math.floor(z/cell));cells[k]=max(cells[k],y-base);points[k].append((x,z))
 bands=(.1,.25,.5,.75);out=[]
 for n,band in enumerate(bands):
  cap=bands[n+1]*height if n+1<len(bands) else height;todo={k for k,h in cells.items() if h>=band*height}
  while todo:
   seed=todo.pop();group=[seed];stack=[seed]
   while stack:
    i,j=stack.pop()
    for near in ((i+1,j),(i-1,j),(i,j+1),(i,j-1)):
     if near in todo:todo.discard(near);group.append(near);stack.append(near)
   poly=hull([p for k in group for p in points[k]])
   if len(poly)>=3:out.append({'footprint':[rounded(p) for p in poly],'height':round(min(cap,max(cells[k] for k in group)),2)})
 return out
LANDMARK_FIELDS={'id','name','center','height','footprint','baseElevation','district','landmark','anchor','kind','amenity','sourceName'}

def write_far(out,buildings):
 """Coarse far-distance representation: convex footprints with height, base
 and facade family per tile, decimetre precision, for the whole metro in one
 small file (DBF2). Flags: bit 0 landmark, bit 1 exact-mesh complex, bit 2 no
 far box (structures and complexes drawn by their fragments), bit 3 massing
 fragment of a complex (not a building of its own: tile counts exclude them)."""
 by_tile=defaultdict(list);index_footprints(buildings)
 for b in buildings:by_tile[tileformat.tile_of(b['center'][0],b['center'][1],TILE)].append(b)
 body=bytearray();directory=[]
 for (tx,tz),entries in sorted(by_tile.items()):
  directory.append({'key':f'{tx}_{tz}','offset':len(body),'count':sum(1+len(FAR_FRAGMENTS.get(b['id'],())) for b in entries)});ox,oz=tx*TILE,tz*TILE
  for b in entries:
   fragments=FAR_FRAGMENTS.get(b['id'],());flags=(1 if b.get('landmark') else 0)|(2 if b['id'] in KEY_BUILDING_IDS else 0)|(4 if b.get('structure') or fragments else 0)
   for part,extra in [(b,0)]+[(f,8) for f in fragments]:
    pts=part['footprint'][:60];body.extend(struct.pack('<HHhBB',len(pts),min(65535,int(round(part['height']*100))),int(round(b['baseElevation']*100)),flags|extra,facade_style(b)))
    for x,z in pts:body.extend(struct.pack('<hh',int(round((x-ox)*10)),int(round((z-oz)*10))))
 header=json.dumps({'size':TILE,'tiles':directory},separators=(',',':')).encode()
 raw=b'DBF2'+struct.pack('<I',len(header))+header
 raw+=b'\0'*((-len(raw))%4)+bytes(body)
 with gzip.open(out/'far.bin','wb',compresslevel=9) as f:f.write(raw)
 return len(raw)

if __name__=='__main__':main()
