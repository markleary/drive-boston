#!/usr/bin/env python3
"""Download the public sources for the Greater Boston build: official Boston
neighborhood and surrounding-town polygons, Boston GIS streets/curbs/signals,
regional hydro and park polygons, Boston and Cambridge OBJ model tiles, OSM
extracts for Cambridge, Somerville, Brookline, Chelsea, Everett, Medford, Malden
and Melrose, metro-wide OSM paths, water, landmarks, service roads, parking lots
and railways, MassGIS assessor parcels for the northern towns, and the USGS 3DEP
terrain. Everything lands in the ignored source
cache; nothing is fetched at runtime.

The northern towns (Everett, Medford, Malden, Melrose) were added after the rest
of the cache was downloaded. Boston GIS layers, basemap layers, model tiles and
the metro-wide OSM extracts keep their original core envelope, so the cached
files stay valid and are never fetched again; the northern strip gets its own
`north-*` extracts and terrain rows anchored to the existing grid.
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
TOWNS=['CAMBRIDGE','SOMERVILLE','BROOKLINE','CHELSEA','EVERETT','MEDFORD','MALDEN','MELROSE']
# Towns whose extracts predate full multipolygon geometry (Overpass `tags` verbosity).
LEGACY_TOWNS={'CAMBRIDGE','SOMERVILLE','BROOKLINE'}
# The final extension north of the Mystic: everything else keeps the core envelope.
NORTH_TOWNS=['EVERETT','MEDFORD','MALDEN','MELROSE']
EXCLUDED_NEIGHBORHOODS=['Roslindale','West Roxbury','Hyde Park','Harbor Islands']
# The original metro terrain lattice (originX, originZ, width, height in cells), exported 28 October 2026.
TERRAIN_ANCHOR=(-8946,-8046,2774,3039)
# MassGIS standardized assessor parcels (Level 3): the northern towns have no open
# building models, so each OSM footprint takes its house style, year built and
# storeys from the parcel it stands on. TOWN_ID is the MassGIS town number.
PARCELS='https://services1.arcgis.com/hGdibHYSPO59RG1h/ArcGIS/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0/query'
PARCEL_TOWNS={'EVERETT':93,'MALDEN':165,'MEDFORD':176,'MELROSE':178}
PARCEL_FIELDS='OBJECTID,MAP_PAR_ID,LOC_ID,USE_CODE,STYLE,YEAR_BUILT,STORIES,BLD_AREA,RES_AREA,UNITS,NUM_ROOMS,LOT_SIZE,LOT_UNITS,SITE_ADDR,ADDR_NUM,FULL_STR'
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
 """Official polygons: Boston neighborhoods (basemap 16) and towns (basemap 17).
 Polygons already cached are kept exactly; only towns missing from the cache are
 requested, so adding a town never moves an existing boundary."""
 path=cache/'metro-boundaries.json'
 cached=json.loads(path.read_text()) if path.exists() else None
 have={f['properties']['TOWN']:f for f in cached['towns']['features']} if cached else {}
 if cached and set(have)==set(TOWNS):return cached
 params={'f':'geojson','where':'1=1','outFields':'*','outSR':4326,'returnGeometry':'true'}
 neighborhoods=cached['neighborhoods'] if cached else query(f'{BASEMAP}/16/query',params)
 missing=[t for t in TOWNS if t not in have]
 fetched=query(f'{BASEMAP}/17/query',{**params,'where':"TOWN IN ('"+"','".join(missing)+"')"})
 got={f['properties']['TOWN']:f for f in fetched['features']}
 if set(got)!=set(missing):raise RuntimeError('Surrounding town polygons missing: '+', '.join(sorted(set(missing)-set(got))))
 towns={**(cached['towns'] if cached else {k:v for k,v in fetched.items() if k!='features'}),'features':[have.get(t) or got[t] for t in TOWNS]}
 result={'neighborhoods':neighborhoods,'towns':towns,'excludedNeighborhoods':EXCLUDED_NEIGHBORHOODS}
 path.write_text(json.dumps(result,separators=(',',':'))+'\n');return result

def coverage_geometry(bounds,towns=None):
 polygons=[shape(f['geometry']).buffer(0) for f in bounds['neighborhoods']['features'] if f['properties']['name'] not in EXCLUDED_NEIGHBORHOODS]
 polygons+=[shape(f['geometry']).buffer(0) for f in bounds['towns']['features'] if towns is None or f['properties']['TOWN'] in towns]
 return unary_union(polygons)

def envelope(bounds,margin=.004,towns=None):
 minx,miny,maxx,maxy=coverage_geometry(bounds,towns).bounds
 return [round(minx-margin,4),round(miny-margin,4),round(maxx+margin,4),round(maxy+margin,4)]

def core_envelope(bounds):
 """The envelope before the northern towns: Boston GIS, basemap and metro-wide OSM queries use it."""
 return envelope(bounds,towns=[t for t in TOWNS if t not in NORTH_TOWNS])

def north_envelope(bounds,margin=.004):
 """The northern towns alone, for their metro-wide extracts (paths, water, driveways, landmarks)."""
 minx,miny,maxx,maxy=unary_union([shape(f['geometry']).buffer(0) for f in bounds['towns']['features'] if f['properties']['TOWN'] in NORTH_TOWNS]).bounds
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

def basemap_layer(cache,number,bbox,suffix=''):
 path=cache/f'basemap-{number}{suffix}.json'
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

def town_parcels(cache,town):
 """Assessor parcels for one northern town, paged by object id (2,000 a request)."""
 path=cache/f'parcels-{town.lower()}.json'
 if path.exists():return
 features=[];offset=0
 while True:
  params={'where':f'TOWN_ID={PARCEL_TOWNS[town]}','outFields':PARCEL_FIELDS,'returnGeometry':'true','outSR':4326,'f':'geojson','resultOffset':offset,'resultRecordCount':2000,'orderByFields':'OBJECTID'}
  data=None
  for attempt in range(5):
   try:
    req=urllib.request.Request(PARCELS,data=urllib.parse.urlencode(params).encode(),headers=UA)
    with urllib.request.urlopen(req,timeout=180) as r:data=json.load(r)
    if 'error' in data:raise RuntimeError(data['error'])
    break
   except Exception as e:
    if attempt==4:raise
    print('Parcel retry',town,offset,str(e)[:100],flush=True);time.sleep(10)
  batch=data.get('features',[]);features.extend(batch)
  if len(batch)<2000:break
  offset+=2000
 path.write_text(json.dumps({'source':PARCELS,'townId':PARCEL_TOWNS[town],'fields':PARCEL_FIELDS,'downloaded':time.strftime('%Y-%m-%d'),'features':features},separators=(',',':'))+'\n')
 print('Downloaded',len(features),'parcels for',town,flush=True)

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
 # and buildings even with `geom`. Chelsea, the northern towns and the newer
 # extracts retain full topology; the legacy towns and metro-wide extracts keep
 # their baseline extract semantics until separately rebuilt.
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

# Extracts downloaded before full relation geometry was requested. Everything
# else (Chelsea, the northern towns, north-* and railway extracts) uses `body`.
LEGACY_EXTRACTS={'metro-water','metro-paths','metro-landmarks','metro-driveways'}
def full_geometry(name):return name not in LEGACY_EXTRACTS and name.split('-')[0].upper() not in LEGACY_TOWNS

def overpass(cache,name,statements,bbox):
 """Fetch one extract; public mirrors time out on broad regex queries, so fall
 back to one statement per request and then to bbox quadrants before giving up."""
 path=cache/f'osm-{name}.json'
 if path.exists():
  cached=json.loads(path.read_text())
  incomplete=full_geometry(name) and any(e['type']=='relation' and (not e.get('members') or any(m['type']=='way' and not m.get('geometry') for m in e['members'])) for e in cached['elements'])
  if not incomplete:return
 relation_geometry=full_geometry(name)
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
 core=core_envelope(bounds);north=north_envelope(bounds)
 # Park paths, water detail, bridges and signals for the whole study area. The
 # central build already uses these OSM classes; the metro build keeps them.
 # The core extracts keep the envelope they were downloaded with; the northern
 # towns get the same classes in separate north-* extracts.
 for name,box in [('metro',core),('north',north)]:
  jobs.append((name+'-water',['way["natural"="water"]({bbox});','relation["natural"="water"]({bbox});','way["natural"="coastline"]({bbox});'],box))
  jobs.append((name+'-paths',['way["highway"~"^(footway|path|pedestrian|steps|cycleway)$"]({bbox});'],box))
  jobs.append((name+'-landmarks',['node["historic"="monument"]({bbox});','node["tourism"="attraction"]({bbox});','way["tourism"="attraction"]({bbox});','node["man_made"="obelisk"]({bbox});'],box))
  # Driveways, parking aisles and lots: the surveyed curbs enclose them but
  # neither Boston Segments nor the town road classes carry them, so
  # build-street-surfaces.py uses this extract to pave the curb faces they cross.
  jobs.append((name+'-driveways',['way["highway"="service"]({bbox});','way["amenity"="parking"]({bbox});'],box))
 # Railways for the static track beds (Orange Line, commuter rail and their
 # bridges, platforms and crossings) over the whole envelope, with the train and
 # subway route relations that say which line each track belongs to.
 jobs.append(('metro-railways',['way["railway"~"^(rail|subway|light_rail|platform|disused|abandoned|construction|turntable)$"]({bbox});','node["railway"~"^(level_crossing|crossing|station|halt|stop|buffer_stop|switch|railway_crossing)$"]({bbox});','way["public_transport"="platform"]({bbox});','way["building"="train_station"]({bbox});','relation["route"~"^(train|subway|light_rail|railway|tracks)$"]({bbox});'],envelope(bounds)))
 for job in jobs:overpass(cache,*job)

def main():
 p=argparse.ArgumentParser();p.add_argument('--source-dir',type=pathlib.Path,required=True);p.add_argument('--skip-models',action='store_true');p.add_argument('--skip-osm',action='store_true');p.add_argument('--skip-gis',action='store_true');p.add_argument('--skip-terrain',action='store_true');args=p.parse_args()
 cache=args.source_dir;cache.mkdir(parents=True,exist_ok=True)
 bounds=boundaries(cache);bbox=envelope(bounds);core=core_envelope(bounds)
 (cache/'metro-envelope.json').write_text(json.dumps({'bbox':bbox,'core':core,'north':north_envelope(bounds),'towns':TOWNS,'excludedNeighborhoods':EXCLUDED_NEIGHBORHOODS})+'\n')
 print('Study envelope',bbox,'core',core,flush=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  futures=[]
  if not args.skip_gis:
   # Boston's own layers end at the city line: the core envelope covers them.
   futures+=[pool.submit(gis_layer,cache,n,core) for n in [8,12,6,0]]
   futures+=[pool.submit(basemap_layer,cache,n,core) for n in [12,14]]
   # Hydro polygons north of the core (the Mystic Lakes, Spot Pond, the Malden
   # River); the parks layer has no features there, OpenStreetMap supplies them.
   futures.append(pool.submit(basemap_layer,cache,12,north_envelope(bounds),'-north'))
  if not args.skip_models:
   futures.append(pool.submit(boston_tiles,cache,bounds));futures.append(pool.submit(cambridge_tiles,cache))
  if not args.skip_osm:futures.append(pool.submit(osm_extracts,cache,bounds))
  if not args.skip_gis:futures+=[pool.submit(town_parcels,cache,t) for t in PARCEL_TOWNS]
  for f in futures:f.result()
 if not args.skip_terrain:
  import subprocess
  # Rows are added north of the original 28 October grid with its 800-pixel
  # export blocks anchored where they were, so every cached block request is
  # reused byte for byte and only the new strip is requested.
  subprocess.run([sys.executable,str(pathlib.Path(__file__).with_name('fetch-terrain.py')),'--output',str(cache),'--bbox',*map(str,bbox),'--tiled','--anchor',*map(str,TERRAIN_ANCHOR)],check=True)
 print('Metro source cache ready',flush=True)

if __name__=='__main__':main()
