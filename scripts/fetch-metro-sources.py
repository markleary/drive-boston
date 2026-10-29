#!/usr/bin/env python3
"""Download the public sources for the Greater Boston build: official Boston
neighborhood and surrounding-town polygons, Boston GIS streets/curbs/signals,
regional hydro and park polygons, Boston and Cambridge OBJ model tiles, OSM
extracts for Cambridge, Somerville, Brookline and Chelsea, and the USGS 3DEP terrain.
Everything lands in the ignored source cache; nothing is fetched at runtime.
"""
from __future__ import annotations
import argparse, concurrent.futures, json, math, pathlib, sys, time, urllib.parse, urllib.request
from shapely.geometry import shape, Polygon
from shapely.ops import unary_union
from pyproj import Transformer

TILE_SERVICE='https://services.arcgis.com/sFnw0xNflSi8J0uh/arcgis/rest/services/Bos3D_TileGrid_PopUps_20260624/FeatureServer/70'
GIS='https://gisportal.boston.gov/arcgis/rest/services/Infrastructure/OpenData/MapServer'
MODEL_BASE='https://maps.bostonplans.org/3d/Bos3d_BldgModels_20260624_OBJ/'
BASEMAP='https://gisportal.boston.gov/arcgis/rest/services/Basemaps/Boston_Basemap_Cached_WM/MapServer'
CAMBRIDGE_BASE='https://cambmagisdata.blob.core.windows.net/camb3d/'
CAMBRIDGE_TILES=['C-1','C-2','C-3','D-1','D-2','D-3','E-1','E-2','E-3','E-4','F-2','F-3','F-4','G-3','G-4','H-3']
OVERPASS=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter']
TOWNS=['CAMBRIDGE','SOMERVILLE','BROOKLINE','CHELSEA']
EXCLUDED_NEIGHBORHOODS=['Roslindale','West Roxbury','Hyde Park','Harbor Islands']
UA={'User-Agent':'DriveBostonDataPreparation/0.3','Referer':'https://www.bostonplans.org/'}
FT=1200/3937

def fetch(url,data=None,timeout=300):
 req=urllib.request.Request(url,data=data,headers=UA)
 with urllib.request.urlopen(req,timeout=timeout) as response:return response.read()

def query(url,params):
 data=json.loads(fetch(url+'?'+urllib.parse.urlencode(params)))
 if 'error' in data:raise RuntimeError(data['error'])
 return data

def boundaries(cache):
 """Official polygons: Boston neighborhoods (basemap 16) and towns (basemap 17)."""
 path=cache/'metro-boundaries.json'
 if path.exists():
  cached=json.loads(path.read_text())
  if {f['properties']['TOWN'] for f in cached['towns']['features']}==set(TOWNS):return cached
 params={'f':'geojson','where':'1=1','outFields':'*','outSR':4326,'returnGeometry':'true'}
 neighborhoods=query(f'{BASEMAP}/16/query',params)
 towns=query(f'{BASEMAP}/17/query',{**params,'where':"TOWN IN ('"+"','".join(TOWNS)+"')"})
 if len(towns['features'])!=len(TOWNS):raise RuntimeError('Surrounding town polygons missing')
 result={'neighborhoods':neighborhoods,'towns':towns,'excludedNeighborhoods':EXCLUDED_NEIGHBORHOODS}
 path.write_text(json.dumps(result,separators=(',',':'))+'\n');return result

def coverage_geometry(bounds):
 polygons=[shape(f['geometry']).buffer(0) for f in bounds['neighborhoods']['features'] if f['properties']['name'] not in EXCLUDED_NEIGHBORHOODS]
 polygons+=[shape(f['geometry']).buffer(0) for f in bounds['towns']['features']]
 return unary_union(polygons)

def envelope(bounds,margin=.004):
 minx,miny,maxx,maxy=coverage_geometry(bounds).bounds
 return [round(minx-margin,4),round(miny-margin,4),round(maxx+margin,4),round(maxy+margin,4)]

def gis_layer(cache,number,bbox):
 path=cache/f'layer-{number}.json'
 spatial={'f':'json','where':'1=1','geometry':','.join(map(str,bbox)),'geometryType':'esriGeometryEnvelope','inSR':4326,'spatialRel':'esriSpatialRelIntersects'}
 if path.exists() and json.loads(path.read_text()).get('query',{}).get('geometry')==spatial['geometry']:return
 ids=query(f'{GIS}/{number}/query',{**spatial,'returnIdsOnly':'true'})['objectIds'];features=[]
 for i in range(0,len(ids),400):
  for attempt in range(4):
   try:
    result=query(f'{GIS}/{number}/query',{'f':'json','objectIds':','.join(map(str,ids[i:i+400])),'outFields':'*','returnGeometry':'true','outSR':4326,'resultRecordCount':400});break
   except Exception as e:
    if attempt==3:raise
    time.sleep(5)
  if result.get('exceededTransferLimit'):raise RuntimeError('GIS pagination unexpectedly truncated')
  features.extend(result['features'])
  if i%4000==0:print(f'  layer {number}: {len(features)}/{len(ids)}',flush=True)
 if len(features)!=len(ids):raise RuntimeError(f'Layer {number}: {len(features)} features for {len(ids)} IDs')
 path.write_text(json.dumps({'source':f'{GIS}/{number}','query':spatial,'spatialReference':{'wkid':4326},'features':features},separators=(',',':'))+'\n')
 print('Downloaded layer',number,'with',len(features),'records',flush=True)

def basemap_layer(cache,number,bbox):
 path=cache/f'basemap-{number}.json'
 spatial={'f':'geojson','where':'1=1','geometry':','.join(map(str,bbox)),'geometryType':'esriGeometryEnvelope','inSR':4326,'spatialRel':'esriSpatialRelIntersects','outFields':'*','outSR':4326,'returnGeometry':'true'}
 if path.exists() and json.loads(path.read_text()).get('query')==spatial['geometry']:return
 ids=query(f'{BASEMAP}/{number}/query',{**spatial,'f':'json','returnIdsOnly':'true'})['objectIds'];features=[]
 for i in range(0,len(ids),200):
  result=query(f'{BASEMAP}/{number}/query',{'f':'geojson','objectIds':','.join(map(str,ids[i:i+200])),'outFields':'*','returnGeometry':'true','outSR':4326})
  features.extend(result['features'])
 path.write_text(json.dumps({'type':'FeatureCollection','query':spatial['geometry'],'features':features},separators=(',',':'))+'\n')
 print('Downloaded basemap',number,'with',len(features),'records',flush=True)

def boston_tiles(cache,bounds):
 coverage=coverage_geometry(bounds).buffer(.002)
 tiles=query(TILE_SERVICE+'/query',{'f':'json','where':'1=1','outFields':'*','returnGeometry':'true','outSR':4326})
 (cache/'tiles-metro.json').write_text(json.dumps(tiles,separators=(',',':'))+'\n')
 wanted=[]
 for feature in tiles['features']:
  ring=feature['geometry']['rings'][0]
  if Polygon(ring).intersects(coverage):wanted.append(feature['attributes']['tile_id'])
 def download(tile):
  dest=cache/(tile.replace('BOS_','').replace('_','')+'-models.zip')
  if dest.exists():return
  payload=fetch(MODEL_BASE+tile+'_BldgModels_OBJ.zip',timeout=600)
  if not payload.startswith(b'PK'):raise RuntimeError(f'Expected ZIP for {tile}')
  temp=dest.with_suffix('.download');temp.write_bytes(payload);temp.replace(dest);print('Downloaded',dest.name,round(len(payload)/1e6,1),'MB',flush=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(download,wanted))
 return sorted(wanted)

def cambridge_tiles(cache):
 def download(tile):
  dest=cache/f'CAMB{tile.replace("-","")}-models.zip'
  if dest.exists():return
  payload=fetch(f'{CAMBRIDGE_BASE}Camb3D_{tile}_2023_Bulding_Models_OBJ.zip',timeout=600)
  if not payload.startswith(b'PK'):raise RuntimeError(f'Expected ZIP for Cambridge {tile}')
  temp=dest.with_suffix('.download');temp.write_bytes(payload);temp.replace(dest);print('Downloaded',dest.name,round(len(payload)/1e6,1),'MB',flush=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(download,CAMBRIDGE_TILES))

def overpass_query(statements,bbox,timeout=600,relation_geometry=False):
 south,west,north,east=bbox[1],bbox[0],bbox[3],bbox[2]
 # `tags` verbosity omits relation members, silently losing multipolygon parks
 # and buildings even with `geom`. New Chelsea extracts retain full topology;
 # legacy towns retain their baseline extract semantics until separately rebuilt.
 verbosity='body' if relation_geometry else 'tags'
 body=f'[out:json][timeout:{timeout}][maxsize:268435456];('+''.join(s.replace('{bbox}',f'{south},{west},{north},{east}') for s in statements)+f');out {verbosity} geom;'
 last=None
 for endpoint in OVERPASS:
  for attempt in range(2):
   try:
    data=json.loads(fetch(endpoint,data=urllib.parse.urlencode({'data':body}).encode(),timeout=timeout+120))
    if 'elements' not in data:raise RuntimeError(str(data)[:300])
    return data
   except Exception as e:
    last=e;print('OSM retry',endpoint,str(e)[:120],flush=True);time.sleep(20)
 raise RuntimeError(f'Overpass failed: {last}')

def overpass(cache,name,statements,bbox):
 """Fetch one extract; public mirrors time out on broad regex queries, so fall
 back to one statement per request and then to bbox quadrants before giving up."""
 path=cache/f'osm-{name}.json'
 if path.exists():
  cached=json.loads(path.read_text())
  incomplete=name.startswith('chelsea-') and any(e['type']=='relation' and (not e.get('members') or any(m['type']=='way' and not m.get('geometry') for m in e['members'])) for e in cached['elements'])
  if not incomplete:return
 relation_geometry=name.startswith('chelsea-')
 try:data=overpass_query(statements,bbox,relation_geometry=relation_geometry)
 except RuntimeError:
  elements={};meta=None
  for statement in statements:
   try:part=overpass_query([statement],bbox,300,relation_geometry=relation_geometry)
   except RuntimeError:
    midx=(bbox[0]+bbox[2])/2;midz=(bbox[1]+bbox[3])/2;part={'elements':[]}
    for quadrant in [[bbox[0],bbox[1],midx,midz],[midx,bbox[1],bbox[2],midz],[bbox[0],midz,midx,bbox[3]],[midx,midz,bbox[2],bbox[3]]]:
     piece=overpass_query([statement],quadrant,300,relation_geometry=relation_geometry);part['elements'].extend(piece['elements']);meta=meta or piece
   meta=meta or part
   for element in part['elements']:elements[(element['type'],element['id'])]=element
  data={**{k:v for k,v in meta.items() if k!='elements'},'elements':list(elements.values()),'assembled':'per-statement fallback'}
 path.write_text(json.dumps(data,separators=(',',':')));print('Downloaded OSM',name,len(data['elements']),'elements',flush=True)

def osm_extracts(cache,bounds):
 towns={f['properties']['TOWN']:shape(f['geometry']).bounds for f in bounds['towns']['features']}
 jobs=[]
 for town,bbox in towns.items():
  key=town.lower()
  jobs.append((key+'-buildings',['way["building"]({bbox});','relation["building"]({bbox});'],bbox))
  jobs.append((key+'-roads',['way["highway"]({bbox});','node["highway"="traffic_signals"]({bbox});'],bbox))
  jobs.append((key+'-context',['way["leisure"~"^(park|garden|playground|pitch|golf_course|nature_reserve|common)$"]({bbox});','relation["leisure"~"^(park|garden|nature_reserve|common)$"]({bbox});','way["landuse"~"^(cemetery|grass|recreation_ground)$"]({bbox});','way["natural"="water"]({bbox});','relation["natural"="water"]({bbox});','way["waterway"="riverbank"]({bbox});'],bbox))
 full=envelope(bounds)
 # Park paths, water detail, bridges and signals for the whole study area. The
 # central build already uses these OSM classes; the metro build keeps them.
 jobs.append(('metro-water',['way["natural"="water"]({bbox});','relation["natural"="water"]({bbox});','way["natural"="coastline"]({bbox});'],full))
 jobs.append(('metro-paths',['way["highway"~"^(footway|path|pedestrian|steps|cycleway)$"]({bbox});'],full))
 jobs.append(('metro-landmarks',['node["historic"="monument"]({bbox});','node["tourism"="attraction"]({bbox});','way["tourism"="attraction"]({bbox});','node["man_made"="obelisk"]({bbox});'],full))
 for job in jobs:overpass(cache,*job)

def main():
 p=argparse.ArgumentParser();p.add_argument('--source-dir',type=pathlib.Path,required=True);p.add_argument('--skip-models',action='store_true');p.add_argument('--skip-osm',action='store_true');p.add_argument('--skip-gis',action='store_true');p.add_argument('--skip-terrain',action='store_true');args=p.parse_args()
 cache=args.source_dir;cache.mkdir(parents=True,exist_ok=True)
 bounds=boundaries(cache);bbox=envelope(bounds)
 (cache/'metro-envelope.json').write_text(json.dumps({'bbox':bbox,'towns':TOWNS,'excludedNeighborhoods':EXCLUDED_NEIGHBORHOODS})+'\n')
 print('Study envelope',bbox,flush=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  futures=[]
  if not args.skip_gis:
   futures+=[pool.submit(gis_layer,cache,n,bbox) for n in [8,12,6]]
   futures+=[pool.submit(basemap_layer,cache,n,bbox) for n in [12,14]]
  if not args.skip_models:
   futures.append(pool.submit(boston_tiles,cache,bounds));futures.append(pool.submit(cambridge_tiles,cache))
  if not args.skip_osm:futures.append(pool.submit(osm_extracts,cache,bounds))
  for f in futures:f.result()
 if not args.skip_terrain:
  import subprocess
  subprocess.run([sys.executable,str(pathlib.Path(__file__).with_name('fetch-terrain.py')),'--output',str(cache),'--bbox',*map(str,bbox),'--tiled'],check=True)
 print('Metro source cache ready',flush=True)

if __name__=='__main__':main()
