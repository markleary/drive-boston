#!/usr/bin/env python3
"""Download official Boston model tiles and paginated GIS for the study envelope."""
from __future__ import annotations
import argparse, concurrent.futures, json, pathlib, urllib.parse, urllib.request

TILE_SERVICE='https://services.arcgis.com/sFnw0xNflSi8J0uh/arcgis/rest/services/Bos3D_TileGrid_PopUps_20260624/FeatureServer/70'
GIS='https://gisportal.boston.gov/arcgis/rest/services/Infrastructure/OpenData/MapServer'
MODEL_BASE='https://maps.bostonplans.org/3d/Bos3d_BldgModels_20260624_OBJ/'
BASEMAP='https://gisportal.boston.gov/arcgis/rest/services/Basemaps/Boston_Basemap_Cached_WM/MapServer'

def fetch(url):
 req=urllib.request.Request(url,headers={'User-Agent':'DriveBostonDataPreparation/0.2','Referer':'https://www.bostonplans.org/'})
 with urllib.request.urlopen(req,timeout=180) as response:return response.read()

def query(url,params):
 data=json.loads(fetch(url+'?'+urllib.parse.urlencode(params)))
 if 'error' in data:raise RuntimeError(data['error'])
 return data

def main():
 p=argparse.ArgumentParser();p.add_argument('--source-dir',type=pathlib.Path,required=True);p.add_argument('--reuse-dir',type=pathlib.Path);p.add_argument('--bbox',nargs=4,type=float,default=[-71.116,42.326,-71.0705,42.354]);args=p.parse_args();cache=args.source_dir;cache.mkdir(parents=True,exist_ok=True)
 spatial={'f':'json','where':'1=1','geometry':','.join(map(str,args.bbox)),'geometryType':'esriGeometryEnvelope','inSR':4326,'spatialRel':'esriSpatialRelIntersects'}
 tile_file=cache/'tiles.json'
 # --download may expand a previously smaller cache: refresh the cheap tile
 # index rather than assuming its old envelope covers the new request.
 tile_file.write_text(json.dumps(query(TILE_SERVICE+'/query',{**spatial,'outFields':'*','returnGeometry':'true','outSR':4326}),indent=2)+'\n')
 tiles=json.loads(tile_file.read_text())['features'];jobs=[]
 for feature in tiles:
  tile=feature['attributes']['tile_id'];name=tile.replace('BOS_','').replace('_','')+'-models.zip';dest=cache/name;source=MODEL_BASE+tile+'_BldgModels_OBJ.zip'
  if not dest.exists() and args.reuse_dir and (args.reuse_dir/name).exists():dest.symlink_to((args.reuse_dir/name).resolve())
  if not dest.exists():jobs.append((dest,source))
 def download(job):
  dest,url=job;payload=fetch(url)
  if not payload.startswith(b'PK'):raise RuntimeError(f'Expected ZIP: {url}')
  temp=dest.with_suffix('.download');temp.write_bytes(payload);temp.replace(dest)
  print('Downloaded',dest.name,round(len(payload)/1e6,2),'MB',flush=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(download,jobs))
 def layer(number):
  path=cache/f'layer-{number}.json'
  if path.exists() and json.loads(path.read_text()).get('query',{}).get('geometry')==spatial['geometry']:return
  ids=query(f'{GIS}/{number}/query',{**spatial,'returnIdsOnly':'true'})['objectIds'];features=[]
  for i in range(0,len(ids),400):
   result=query(f'{GIS}/{number}/query',{'f':'json','objectIds':','.join(map(str,ids[i:i+400])),'outFields':'*','returnGeometry':'true','outSR':4326,'resultRecordCount':400})
   if result.get('exceededTransferLimit'):raise RuntimeError('GIS pagination unexpectedly truncated')
   features.extend(result['features'])
  if len(features)!=len(ids):raise RuntimeError(f'Layer {number}: {len(features)} features for {len(ids)} IDs')
  path.write_text(json.dumps({'source':f'{GIS}/{number}','query':spatial,'spatialReference':{'wkid':4326},'features':features},separators=(',',':'))+'\n')
  print('Downloaded layer',number,'with',len(features),'records',flush=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(layer,[6,8,12]))
 # Official city neighborhood names and park/water footprints, kept separate
 # from infrastructure layer numbers. GeoJSON preserves polygon holes.
 def context_layer(number):
  path=cache/f'basemap-{number}.json'
  params={**spatial,'f':'geojson','outFields':'*','outSR':4326,'returnGeometry':'true'}
  result=query(f'{BASEMAP}/{number}/query',params)
  if result.get('exceededTransferLimit'):raise RuntimeError('Basemap query unexpectedly truncated')
  path.write_text(json.dumps(result,separators=(',',':'))+'\n')
  print('Downloaded basemap',number,'with',len(result['features']),'records',flush=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(context_layer,[12,14,16]))
 print('Source cache ready:',','.join(f['attributes']['tile_id'] for f in tiles),flush=True)

if __name__=='__main__':main()
