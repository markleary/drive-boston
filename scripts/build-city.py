#!/usr/bin/env python3
"""Compile public Boston GIS/OBJ data to the compact runtime assets. No runtime map APIs.
Requires: pip install -r scripts/requirements.txt
See DATA_SOURCES.md for reproducible download and provenance details.
"""
from __future__ import annotations
import argparse, csv, io, json, math, pathlib, struct, zipfile, hashlib, subprocess, sys
from collections import Counter
from building_semantics import apply_building_identity
from mesh_winding import orient_patches,orient_shells
from pyproj import Transformer
from shapely.geometry import Point, LineString, Polygon, box
from shapely.ops import unary_union
ROOT = pathlib.Path(__file__).resolve().parents[1]
FT = 1200 / 3937
BACKBAY_BBOX = [-71.0805, 42.348, -71.0705, 42.354]
EXPANDED_BBOX = [-71.116, 42.326, -71.0705, 42.354]
CENTRAL_BBOX = [-71.116, 42.326, -71.047, 42.3645]
NEIGHBORHOODS = ['Mission Hill','Longwood','Fenway','Back Bay','Bay Village','Leather District','Chinatown','Beacon Hill','Downtown']
MISSIONHILL_BBOX = [-71.116, 42.327, -71.093, 42.339]
BBOX = BACKBAY_BBOX
OFFSET = [731100, 2902900]
ORIGIN = [40000, 50000]
TILES = ['G_4', 'H_4', 'G_5', 'H_5']
TO_FEET = Transformer.from_crs(4326, 2249, always_xy=True)
TO_GEO = Transformer.from_crs(2249, 4326, always_xy=True)
SOURCES = [
 {'name': 'Boston Planning building models, June 2026', 'url': 'https://www.bostonplans.org/3d-data-maps/3d-smart-model/3d-data-download', 'license': 'PDDL; no photographic textures used'},
 {'name': 'Boston street centerlines, curbs and traffic signals', 'url': 'https://gisportal.boston.gov/arcgis/rest/services/Infrastructure/OpenData/MapServer', 'license': 'City of Boston open data; source attribution retained'},
 {'name': 'USGS 3DEP bare-earth terrain, offline 6m grid', 'url': 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer', 'license': 'USGS public domain; elevation relative to documented Back Bay reference'},
 {'name': 'City of Boston official neighborhood, park and water polygons', 'url': 'https://gisportal.boston.gov/arcgis/rest/services/Basemaps/Boston_Basemap_Cached_WM/MapServer', 'license': 'City of Boston open data; source attribution retained'},
]

def xy(lon, lat):
 x,y=TO_FEET.transform(lon,lat)
 return [(x-OFFSET[0]-ORIGIN[0])*FT, -(y-OFFSET[1]-ORIGIN[1])*FT]

def rounded(p): return [round(float(x),3) for x in p]

def hull(points):
 pts=sorted(set((round(x,3),round(z,3)) for x,z in points))
 if len(pts)<3:return [list(p) for p in pts]
 def cross(o,a,b):return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
 lo=[];hi=[]
 for p in pts:
  while len(lo)>=2 and cross(lo[-2],lo[-1],p)<=0:lo.pop()
  lo.append(p)
 for p in reversed(pts):
  while len(hi)>=2 and cross(hi[-2],hi[-1],p)<=0:hi.pop()
  hi.append(p)
 return [list(p) for p in lo[:-1]+hi[:-1]]

def load_layer(cache,layer,ground_dir=None):
 f=cache/f'layer-{layer}.json'
 if not f.exists() and ground_dir:f=ground_dir/f.name
 d=json.loads(f.read_text());d=d.get('response',d)
 if 'error' in d:raise RuntimeError(d['error'])
 if d.get('exceededTransferLimit'):raise RuntimeError('GIS result truncated')
 return d['features']

class GLB:
 def __init__(self):
  self.buf=bytearray();self.doc={'asset':{'version':'2.0','generator':'Drive Boston public-data compiler'},'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'meshes':[],'buffers':[{'byteLength':0}],'bufferViews':[],'accessors':[],'materials':[{'name':'facade','pbrMetallicRoughness':{'baseColorFactor':[.7,.64,.55,1],'metallicFactor':0,'roughnessFactor':.87}},{'name':'roof','pbrMetallicRoughness':{'baseColorFactor':[.25,.27,.28,1],'metallicFactor':.1,'roughnessFactor':.9}}]}
 def accessor(self,values,components,kind='f'):
  while len(self.buf)%4:self.buf.append(0)
  start=len(self.buf);flat=[x for row in values for x in row] if components>1 else values
  self.buf.extend(struct.pack('<'+kind*len(flat),*flat));view=len(self.doc['bufferViews']);self.doc['bufferViews'].append({'buffer':0,'byteOffset':start,'byteLength':len(self.buf)-start,'target':34963 if kind=='I' else 34962})
  a={'bufferView':view,'componentType':5125 if kind=='I' else 5126,'count':len(values),'type':{1:'SCALAR',2:'VEC2',3:'VEC3'}[components]}
  if components==3:a.update(min=[min(v[k] for v in values) for k in range(3)],max=[max(v[k] for v in values) for k in range(3)])
  idx=len(self.doc['accessors']);self.doc['accessors'].append(a);return idx
 def add(self,r,vertices,faces):
  faces=orient_patches(vertices,orient_shells(vertices,faces)[0])[0]
  groups=[{'p':[],'n':[],'uv':[],'idx':[],'seen':{}},{'p':[],'n':[],'uv':[],'idx':[],'seen':{}}]
  for face in faces:
   a,b,c=[vertices[i] for i in face]
   ab=[b[i]-a[i] for i in range(3)];ac=[c[i]-a[i] for i in range(3)]
   n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];length=math.sqrt(sum(x*x for x in n))
   base=r.get('_baseElevation',0)
   if length<1e-7 or max(a[1],b[1],c[1])<base+.01:continue
   n=[x/length for x in n];roof=abs(n[1])>.65;g=groups[int(roof)];hl=max(1e-8,math.hypot(n[0],n[2]))
   for p in [a,b,c]:
    uv=[p[0]/6,p[2]/6] if roof else [(p[0]*n[2]/hl-p[2]*n[0]/hl)/6,(p[1]-base)/6]
    key=tuple(round(v,5) for v in p+n+uv)
    if key not in g['seen']:
     g['seen'][key]=len(g['p']);g['p'].append(p);g['n'].append(n);g['uv'].append(uv)
    g['idx'].append(g['seen'][key])
  primitives=[]
  for material,g in enumerate(groups):
   if not g['idx']:continue
   primitives.append({'attributes':{'POSITION':self.accessor(g['p'],3),'NORMAL':self.accessor(g['n'],3),'TEXCOORD_0':self.accessor(g['uv'],2)},'indices':self.accessor(g['idx'],1,'I'),'material':material})
  mesh=len(self.doc['meshes']);self.doc['meshes'].append({'name':r['Model_ID'],'primitives':primitives})
  node=len(self.doc['nodes']);self.doc['nodes'].append({'name':r['Model_ID'],'mesh':mesh,'extras':{'buildingId':r['Model_ID'],'sourceName':r['Name']}});self.doc['scenes'][0]['nodes'].append(node)
 def save(self,path):
  self.doc['buffers'][0]['byteLength']=len(self.buf);s=json.dumps(self.doc,separators=(',',':')).encode();s+=b' '*((-len(s))%4);self.buf.extend(b'\0'*((-len(self.buf))%4))
  path.write_bytes(struct.pack('<III',0x46546C67,2,12+8+len(s)+8+len(self.buf))+struct.pack('<I4s',len(s),b'JSON')+s+struct.pack('<I4s',len(self.buf),b'BIN\0')+self.buf)

def parse_obj(r,z):
 nested=zipfile.ZipFile(io.BytesIO(z.read('objz/'+r['Model_ID']+'_OBJ.zip')));raw=nested.read(r['Model_ID']+'.obj').decode();rawv=[];faces=[]
 for l in raw.splitlines():
  s=l.split()
  if not s:continue
  if s[0]=='v':rawv.append([float(x) for x in s[1:4]])
  elif s[0]=='f':
   v=[int(x.split('/')[0]) for x in s[1:]];v=[i-1 if i>0 else len(rawv)+i for i in v]
   for k in range(1,len(v)-1):faces.append([v[0],v[k],v[k+1]])
 # OBJ coordinates are feet. Keep absolute source elevations until related
 # building parts have been identified; the catalogue's ground field is metre-
 # scale despite its historical Gnd_El_Ft name.
 vertices=[[(x-ORIGIN[0])*FT,z*FT,-(y-ORIGIN[1])*FT] for x,y,z in rawv]
 return vertices,faces

def geographic_polygon(bbox):
 w,s,e,n=bbox
 return Polygon([xy(w,s),xy(e,s),xy(e,n),xy(w,n)])

def elevation_at(grid,x,z):
 if not grid:return 0.
 fx=max(0,min(grid['width']-1,(x-grid['originX'])/grid['cellSize']));fz=max(0,min(grid['height']-1,(z-grid['originZ'])/grid['cellSize']))
 i=min(grid['width']-2,int(fx));j=min(grid['height']-2,int(fz));tx=fx-i;tz=fz-j;h=grid['heights'];offset=j*grid['width']+i
 a,b,c,d=h[offset],h[offset+1],h[offset+grid['width']],h[offset+grid['width']+1]
 return a+(b-a)*tx+(c-a)*tz if tx+tz<=1 else d+(c-d)*(1-tx)+(b-d)*(1-tz)

def clipped_lines(points,coverage):
 if len(points)<2:return []
 geometry=LineString(points).intersection(coverage)
 parts=[geometry] if geometry.geom_type=='LineString' else list(geometry.geoms) if hasattr(geometry,'geoms') else []
 return [[rounded(p) for p in part.coords] for part in parts if part.geom_type=='LineString' and part.length>=3]

def feature_polygons(feature):
 geometry=feature['geometry'];parts=[geometry['coordinates']] if geometry['type']=='Polygon' else geometry['coordinates'] if geometry['type']=='MultiPolygon' else []
 return [Polygon([xy(*v) for v in part[0]],[[xy(*v) for v in ring] for ring in part[1:]]).buffer(0) for part in parts]

def polygon_rings(polygon):
 return [[rounded(p) for p in ring.coords[:-1]] for ring in [polygon.exterior,*polygon.interiors]]

def polygon_parts(geometry):
 return [geometry] if geometry.geom_type=='Polygon' else [g for g in geometry.geoms if g.geom_type=='Polygon'] if hasattr(geometry,'geoms') else []

def context_polygons(cache,layer,field,coverage,prefix):
 result=[]
 for f in json.loads((cache/f'basemap-{layer}.json').read_text())['features']:
  for n,geometry in enumerate(feature_polygons(f)):
   for k,p in enumerate(polygon_parts(geometry.intersection(coverage).simplify(.2,preserve_topology=True))):
    if p.area<15:continue
    props=f['properties'];entry={'id':f"{prefix}-{props['OBJECTID']}-{n}-{k}",'name':props.get(field) or prefix.title(),'rings':polygon_rings(p)}
    if props.get('TypeLong'):entry['kind']=props['TypeLong']
    result.append(entry)
 return result

def safe_arrival(target,roads,buildings):
 candidates=[]
 for road in roads:
  if road['width']<7:continue
  for a,b in zip(road['points'],road['points'][1:]):
   dx,dz=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dz)
   if length<6:continue
   t=max(.15,min(.85,((target[0]-a[0])*dx+(target[1]-a[1])*dz)/(length*length)))
   direction=-1 if road['oneway']==-1 else 1;ux,uz=direction*dx/length,direction*dz/length
   point=[a[0]+t*dx-uz*1.3,a[1]+t*dz+ux*1.3]
   candidates.append((math.dist(target,point),point,math.atan2(ux,uz),road))
 for _,point,yaw,road in sorted(candidates,key=lambda item:item[0]):
  if all(Polygon(b['footprint']).distance(Point(point))>3 for b in buildings if math.dist(b['center'],point)<500):
   return {'x':round(point[0],6),'z':round(point[1],6),'yaw':round(yaw,9)}
 raise RuntimeError('No safe road arrival near destination')

def selected_coverage(region,road_features,neighborhoods=()):
 corners=[xy(lon,lat) for lon in [BACKBAY_BBOX[0],BACKBAY_BBOX[2]] for lat in [BACKBAY_BBOX[1],BACKBAY_BBOX[3]]]
 # Retain the exact original rectangular Back Bay envelope.
 original=box(min(p[0] for p in corners),min(p[1] for p in corners),max(p[0] for p in corners),max(p[1] for p in corners))
 if region=='backbay':return original,original,None
 lines=[LineString([xy(*v) for v in path]) for f in road_features if f['attributes'].get('ST_NAME')=='Huntington' for path in f['geometry']['paths']]
 corridor=unary_union(lines).buffer(180,quad_segs=4)
 mission=geographic_polygon(MISSIONHILL_BBOX)
 legacy=unary_union([original,corridor,mission]).intersection(geographic_polygon(EXPANDED_BBOX))
 if region=='central':
  official=[p for f in neighborhoods if f['properties']['name'] in NEIGHBORHOODS for p in feature_polygons(f)]
  if len(official)!=len(NEIGHBORHOODS):raise RuntimeError('Official requested neighborhoods missing')
  # City boundaries run along street centres. A small outer margin retains
  # entire edge junctions and source buildings; no internal district seams.
  return unary_union([legacy,*official]).buffer(18,join_style=2).intersection(geographic_polygon(CENTRAL_BBOX)).simplify(.5,preserve_topology=True),original,mission
 return legacy.simplify(.5,preserve_topology=True),original,mission

def building_base(grid,footprint,center):
 if not grid:return 0.
 samples=[elevation_at(grid,*center)]
 for a,b in zip(footprint,footprint[1:]+footprint[:1]):
  count=max(1,math.ceil(math.dist(a,b)/6))
  samples.extend(elevation_at(grid,a[0]+(b[0]-a[0])*i/count,a[1]+(b[1]-a[1])*i/count) for i in range(count+1))
 return round(max(samples)-.1,3)

def visible_floor(vertices,faces,anchor):
 # A few source files contain unused datum vertices or collapsed underground
 # triangles. Such helpers must not leave the visible building floating.
 lowest=math.inf
 for face in faces:
  a,b,c=[[v[0],max(0,v[1]-anchor),v[2]] for v in [vertices[i] for i in face]]
  ab=[b[i]-a[i] for i in range(3)];ac=[c[i]-a[i] for i in range(3)]
  cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]]
  if sum(v*v for v in cross)<1e-14 or max(a[1],b[1],c[1])<.01:continue
  lowest=min(lowest,a[1],b[1],c[1])
 return lowest if math.isfinite(lowest) else 0

def main():
 global BBOX
 p=argparse.ArgumentParser();p.add_argument('--source-dir',type=pathlib.Path,default=ROOT/'data-source-cache');p.add_argument('--ground-dir',type=pathlib.Path);p.add_argument('--download',action='store_true');p.add_argument('--region',choices=['backbay','missionhill','central'],default='central');p.add_argument('--output-dir',type=pathlib.Path,default=ROOT/'public/data');args=p.parse_args()
 BBOX=CENTRAL_BBOX if args.region=='central' else EXPANDED_BBOX if args.region=='missionhill' else BACKBAY_BBOX
 if args.download:
  subprocess.run([sys.executable,str(ROOT/'scripts/fetch-city-sources.py'),'--source-dir',str(args.source_dir),'--bbox',*map(str,BBOX)],check=True)
  if args.region!='backbay':subprocess.run([sys.executable,str(ROOT/'scripts/fetch-terrain.py'),'--output',str(args.source_dir),'--bbox',*map(str,BBOX)],check=True)
  if args.region=='central':subprocess.run([sys.executable,str(ROOT/'scripts/fetch-park-sources.py'),'--output',str(args.source_dir),'--osm-api'],check=True)
 road_features=load_layer(args.source_dir,8,args.ground_dir)
 neighborhoods=json.loads((args.source_dir/'basemap-16.json').read_text())['features'] if args.region=='central' else []
 district_polygons=[(f['properties']['name'],p) for f in neighborhoods if f['properties']['name'] in NEIGHBORHOODS for p in feature_polygons(f)]
 coverage,original,mission=selected_coverage(args.region,road_features,neighborhoods)
 grid=json.loads((args.source_dir/'elevation.json').read_text()) if args.region!='backbay' else None
 terrain_provenance=json.loads((args.source_dir/'terrain-provenance.json').read_text()) if grid else None
 corners=[xy(x,y) for x in [BBOX[0],BBOX[2]] for y in [BBOX[1],BBOX[3]]]
 bounds=dict(minX=min(p[0] for p in corners),maxX=max(p[0] for p in corners),minZ=min(p[1] for p in corners),maxZ=max(p[1] for p in corners));bounds={k:round(v,3) for k,v in bounds.items()}
 tile_file=args.source_dir/'tiles.json'
 tiles=[f['attributes']['tile_id'].replace('BOS_','') for f in json.loads(tile_file.read_text())['features']] if tile_file.exists() else TILES
 glb=GLB();buildings=[];manifest=[];seen=set();seen_ids=set();used_tiles=set();candidates=[]
 for tile in tiles:
  z=zipfile.ZipFile(args.source_dir/f'{tile.replace("_","")}-models.zip')
  for r in csv.DictReader(io.StringIO(z.read('catalog.csv').decode('utf-8-sig'))):
   if r['Status'] not in ['Current','Complete','Approved Demo']:continue
   if r.get('StructType') not in ['Building','Structure','']:continue
   if r['Model_ID'] in seen_ids:continue
   try:lon,lat=float(r['Centr_Lon']),float(r['Centr_Lat'])
   except ValueError:continue
   center=rounded(xy(lon,lat));point=Point(center)
   if not coverage.covers(point):continue
   vertices,faces=parse_obj(r,z)
   if len(vertices)<3:continue
   sig=hashlib.sha256(json.dumps(vertices,separators=(',',':')).encode()).hexdigest()
   if sig in seen:continue
   seen.add(sig);seen_ids.add(r['Model_ID']);used_tiles.add(tile)
   footprint=hull([(v[0],v[2]) for v in vertices]);legacy=original.covers(point)
   district=next((name for name,polygon in district_polygons if polygon.covers(point)),None) or ('Back Bay' if legacy else 'Mission Hill' if mission and mission.covers(point) else 'Huntington Avenue')
   candidates.append({'r':r,'vertices':vertices,'faces':faces,'center':center,'footprint':footprint,'polygon':Polygon(footprint),'legacy':legacy,'district':district,'sourceMin':min(v[1] for v in vertices),'sourceMax':max(v[1] for v in vertices)})
  print('Read tile',tile,'running total',len(candidates),'source meshes',flush=True)
 # Preserve actual upper components. A source part needs geometric evidence:
 # same parcel/name, at least 90% footprint support, and a lower model reaching
 # its source floor. The relation is acyclic because source floors descend.
 groups={};by_id={c['r']['Model_ID']:c for c in candidates}
 for c in candidates:
  r=c['r'];key=r.get('Parcel_ID') or r.get('Name') or r['Model_ID'];groups.setdefault(key,[]).append(c)
 for group in groups.values():
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
 roots_with_parts=set()
 for c in candidates:
  root=c
  while 'parent' in root:root=root['parent']
  c['root']=root
  if root is not c:roots_with_parts.add(root['r']['Model_ID'])
 for c in candidates:
  r=c['r'];root=c['root'];rr=root['r'];catalog=float(rr.get('Gnd_El_Ft') or 0)
  # Keep the original flat-core interpretation stable for its authored landmark
  # surfaces. Everywhere newly added, ground numbers are treated as metres.
  # A primary source floor above that estimate is seated directly; supported
  # upper parts share the root's translation rather than being dropped down.
  anchor=catalog*FT if root['legacy'] else max(catalog,root['sourceMin']) if rr.get('Gnd_El_Ft') else root['sourceMin']
  if not root['legacy']:
   if '_visibleFloorOffset' not in root:root['_visibleFloorOffset']=visible_floor(root['vertices'],root['faces'],anchor)
   anchor+=root['_visibleFloorOffset']
  policy='legacy-backbay-feet' if root['legacy'] else 'catalog-metres-and-source-floor' if rr.get('Gnd_El_Ft') else 'source-floor-no-catalog-ground'
  base=building_base(grid,root['footprint'],root['center']);height=round(max(0,c['sourceMax']-anchor),2)
  if height<1.5 and r['Model_ID'] not in roots_with_parts and root is c:continue
  vertices=[[x,base+max(0,y-anchor),z] for x,y,z in c['vertices']]
  offset=round(min(v[1] for v in vertices)-base,6)
  r['_baseElevation']=base;glb.add(r,vertices,c['faces'])
  landmark=None
  if r['Name']=='Trinity Church':landmark='trinity'
  elif r['Name']=='Boston Public Library':landmark='library'
  elif r['Name'].startswith('John Hancock Tower'):landmark='hancock'
  entry={'id':r['Model_ID'],'name':r['Name'] or c['district']+' building','center':c['center'],'height':height,'footprint':c['footprint'],'baseElevation':base,'district':c['district']}
  apply_building_identity(entry)
  if landmark:entry['landmark']=landmark
  if 'parent' in c:entry['partOf']=c['parent']['r']['Model_ID'];entry['sourceBaseOffset']=offset
  buildings.append(entry)
  source={k:r[k] for k in ['Model_ID','Name','Status','Model_LOD','Survey_Dt','Survey_Src','Tile_ID']}
  source.update(baseElevation=base,sourceMinimumMeters=round(c['sourceMin'],6),sourceMaximumMeters=round(c['sourceMax'],6),catalogGroundValue=r.get('Gnd_El_Ft'),normalizationGroundMeters=round(anchor,6),normalizationPolicy=policy,groundContactOffsetMeters=offset)
  if 'parent' in c:source['partOf']=entry['partOf'];source['normalizationRoot']=root['r']['Model_ID']
  manifest.append(source)
 roads=[]
 widthdefaults={'Boylston':13,'Newbury':10,'Commonwealth':9,'Marlborough':9,'Beacon':12,'Dartmouth':11,'Clarendon':11,'Berkeley':12,'Exeter':10,'Huntington':15,'Saint James':12,'Stuart':13,'Arlington':14,'Columbus':12,'Tremont':12,'Parker':9,'Parker Hill':8,'Francis':12,'Longwood':12,'Calumet':8,'Fisher':8,'Hillside':8,'Saint Alphonsus':9}
 omitted_grade=[]
 for f in road_features:
  a=f['attributes'];name=a.get('ST_NAME')
  if not name or name=='James J Storrow Memorial' or name.startswith('Interstate ') or 'Turnpike' in name or 'Expressway' in name:continue
  if a.get('F_ZLEV',0) not in [None,0] or a.get('T_ZLEV',0) not in [None,0]:
   omitted_grade.append(a['OBJECTID']);continue
  if str(a.get('CFCC','')).strip() in ['A71','A72'] or str(a.get('CFCC','')).strip().startswith('A1'):continue
  width=widthdefaults.get(name,4.2 if 'Alley' in name else 7)
  suffix={'ST':'Street','AVE':'Avenue','AV':'Avenue','PL':'Place','RD':'Road','CT':'Court','TER':'Terrace','CIR':'Circle','WAY':'Way','PKWY':'Parkway'}.get(a.get('ST_TYPE'),'')
  prefix={'S':'South','N':'North','E':'East','W':'West'}.get(a.get('PRE_DIR'),'')
  label=' '.join(v for v in [prefix,name,suffix] if v)
  for j,path in enumerate(f['geometry']['paths']):
   for k,pts in enumerate(clipped_lines([xy(*v) for v in path],coverage)):
    roads.append({'id':f"{a['OBJECTID']}-{j}-{k}",'name':label,'points':pts,'width':width,'oneway':1 if a.get('ONEWAY')=='FT' else -1 if a.get('ONEWAY')=='TF' else 0})
 curbs=[]
 for f in load_layer(args.source_dir,6,args.ground_dir):
  for path in f['geometry']['paths']:curbs.extend(clipped_lines([xy(*v) for v in path],coverage))
 signals=[]
 for f in load_layer(args.source_dir,12,args.ground_dir):
  g=f['geometry'];v=xy(g['x'],g['y'])
  if coverage.covers(Point(v)):signals.append(rounded(v))
 descriptions={'trinity':'Richardsonian Romanesque landmark on Copley Square','library':'Boston Public Library · McKim and Johnson buildings','hancock':'200 Clarendon · the Back Bay skyline'}
 landmarks=[{'id':b['landmark'],'name':{'trinity':'Trinity Church','library':'Boston Public Library','hancock':'200 Clarendon'}[b['landmark']],'position':b['center'],'description':descriptions[b['landmark']]} for b in buildings if 'landmark' in b]
 if grid:
  parker=[]
  for road in roads:
   if road['name']!='Parker Hill Avenue':continue
   for a,b in zip(road['points'],road['points'][1:]):
    for i in range(max(2,math.ceil(math.dist(a,b)/5))):
     t=i/max(1,math.ceil(math.dist(a,b)/5));point=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];parker.append((elevation_at(grid,*point),point))
  if not parker:raise RuntimeError('Mission Hill coverage lacks Parker Hill Avenue')
  peak=max(parker,key=lambda p:p[0])
  landmarks.extend([{'id':'brigham-circle','name':'Brigham Circle','position':rounded(xy(-71.10475,42.3342)),'description':'Huntington Avenue at the heart of Mission Hill'}, {'id':'mission-hill','name':'Mission Hill · Parker Hill','position':rounded(peak[1]),'driveStart':{'x':-2856.597333,'z':2034.765611,'yaw':-.006376513},'description':f'Parker Hill Avenue · {peak[0]:.0f}m above the Back Bay starting datum'}])
 if args.region=='central':
  places=[
   ('huntington-mfa','Huntington · Museum of Fine Arts',-71.09550693,42.33770361,'Green Line E and Route 39 · surface transit beside the Museum of Fine Arts'),
   ('fenway-park','Fenway Park',-71.0972,42.3467,'Fenway · historic ballpark at Lansdowne Street'),
   ('kenmore-square','Kenmore Square',-71.0953,42.3489,'Fenway · Beacon Street meets Commonwealth Avenue'),
   ('state-house','Massachusetts State House',-71.0638351,42.358597,'Beacon Hill · gold dome above Boston Common'),
   ('downtown-crossing','Downtown Crossing',-71.0604,42.3555,'Downtown · Washington and Summer streets'),
   ('chinatown-gate','Chinatown Gate',-71.0597,42.3512,'Chinatown · Beach Street and Hudson Street'),
   ('boston-common','Boston Common',-71.0657,42.3553,'Historic central park · Tremont Street arrival'),
   ('public-garden','Public Garden',-71.0699,42.3541,'Lagoon, winding paths and formal gardens'),
  ]
  for identifier,name,longitude,latitude,description in places:
   position=rounded(xy(longitude,latitude))
   arrival_roads=[r for r in roads if r['name']=='Huntington Avenue'] if identifier=='huntington-mfa' else roads
   landmarks.append({'id':identifier,'name':name,'position':position,'driveStart':safe_arrival(position,arrival_roads,buildings),'description':description})
 spawn={'x':-291.674,'z':36.660,'yaw':1.924943916}
 lon,lat=TO_GEO.transform(ORIGIN[0]+OFFSET[0],ORIGIN[1]+OFFSET[1])
 polygons=[coverage] if coverage.geom_type=='Polygon' else list(coverage.geoms)
 outlines=[[rounded(v) for v in polygon.exterior.coords[:-1]] for polygon in polygons]
 data={'origin':{'xFeet':40000,'yFeet':50000,'longitude':lon,'latitude':lat},'bounds':bounds,'coverage':outlines,'buildings':buildings,'roads':roads,'curbs':curbs,'signals':signals,'landmarks':landmarks,'spawn':spawn,'sources':SOURCES if grid else SOURCES[:2]}
 if grid:data['elevation']=grid
 if args.region=='central':
  data['neighborhoods']=[{'id':name.lower().replace(' ','-'),'name':name,'rings':polygon_rings(p)} for name,p in district_polygons]
  data['parks']=context_polygons(args.source_dir,14,'SITE_NAME',coverage,'park')
  data['water']=context_polygons(args.source_dir,12,'NAME',geographic_polygon(BBOX),'water')
  parks_cache=args.source_dir/'parks-runtime.json'
  if not parks_cache.exists():raise RuntimeError('Central region needs park paths: run scripts/fetch-park-sources.py --osm-api --output SOURCE_DIR')
  if parks_cache.exists():
   park_extra=json.loads(parks_cache.read_text());park_area=unary_union([Polygon(p['rings'][0],p['rings'][1:]) for p in data['parks']]).buffer(1).intersection(coverage)
   data['parkPaths']=[]
   for path in park_extra.get('parkPaths',[]):
    for k,points in enumerate(clipped_lines(path['points'],park_area)):
     data['parkPaths'].append({**path,'id':path['id']+f'-{k}','points':points})
   # Merge overlapping official/OSM water outlines before rendering so the
   # same lagoon is never drawn twice with competing transparent surfaces.
   water_records=[(p,Polygon(p['rings'][0],p['rings'][1:]).buffer(0)) for p in [*data['water'],*park_extra.get('water',[])]]
   merged=unary_union([p for _,p in water_records]).intersection(geographic_polygon(BBOX));data['water']=[]
   for k,p in enumerate(polygon_parts(merged)):
    names=[(p.intersection(shape).area,record['name']) for record,shape in water_records if record['name'] not in ['Water','water','Hydro'] and p.intersects(shape)]
    data['water'].append({'id':f'water-merged-{k}','name':max(names)[1] if names else 'Water','rings':polygon_rings(p)})
   data['sources'].append({'name':'OpenStreetMap park paths and water detail','url':'https://www.openstreetmap.org/copyright','license':'© OpenStreetMap contributors; ODbL 1.0'})
 out=args.output_dir;out.mkdir(exist_ok=True,parents=True);glb.save(out/'city.glb');(out/'city.json').write_text(json.dumps(data,separators=(',',':'))+'\n')
 provenance={'bbox':BBOX,'region':args.region,'packagingDate':'2026-10-27','generatedFrom':'Boston public OBJ/GIS sources and USGS 3DEP bare-earth DEM','flattenedGround':not bool(grid),'buildingPlacement':'Original Back Bay normalization retained. Outside core, catalogue ground values interpreted as metres and primary source floors seated to DEM; geometrically supported upper parts share parent translation. Full per-model normalization audit retained.','coverageAreaSquareMeters':round(coverage.area),'coveragePolygons':outlines,'tilesUsed':sorted(used_tiles),'widths':'Prototype assumptions by street name, not authoritative lane inventory','omittedGradeSeparatedRoadIds':omitted_grade,'models':manifest}
 if args.region=='central':
  provenance['neighborhoodPolicy']='Union of official Boston basemap neighborhood polygons, retained Mission Hill study fringe, and 18m exterior margin for boundary streets; no internal neighborhood seams.';provenance['neighborhoods']=NEIGHBORHOODS
  if parks_cache.exists():provenance['parkDetail']=park_extra.get('provenance',{})
 provenance['legacyCoreBounds']=list(original.bounds)
 if terrain_provenance:provenance['terrain']=terrain_provenance
 (out/'provenance.json').write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 if args.region=='central':
  subprocess.run([sys.executable,str(ROOT/'scripts/build-road-structures.py'),'--data-dir',str(out)],check=True)
  data=json.loads((out/'city.json').read_text());roads=data['roads'];landmarks=data['landmarks']
 print(json.dumps({'buildings':len(buildings),'districts':dict(Counter(b['district'] for b in buildings)),'roads':len(roads),'curbs':len(curbs),'signals':len(signals),'landmarks':landmarks,'spawn':spawn,'bounds':bounds,'coverageAreaSquareMeters':round(coverage.area),'glbBytes':(out/'city.glb').stat().st_size,'cityJsonBytes':(out/'city.json').stat().st_size},indent=2))

if __name__=='__main__':main()
