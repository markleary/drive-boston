#!/usr/bin/env python3
"""Fetch an offline USGS bare-earth DEM aligned with Drive Boston's world axes.

The image service resamples authoritative elevation in metres into State Plane
pixel centres. Nothing is requested by players at runtime. See DATA_SOURCES.md.
"""
from __future__ import annotations
import argparse, hashlib, io, json, math, pathlib, urllib.parse, urllib.request
from PIL import Image
from pyproj import Transformer

FT=1200/3937
EAST=731100+40000
NORTH=2902900+50000
SERVICE='https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer'
DEFAULT_BBOX=[-71.116,42.326,-71.0705,42.354]

def request(url):
 req=urllib.request.Request(url,headers={'User-Agent':'DriveBostonTerrainPreparation/0.2'})
 with urllib.request.urlopen(req,timeout=180) as response:return response.read()

def sample(values,width,height,x,z):
 x=max(0,min(width-1,x));z=max(0,min(height-1,z));ix=min(width-2,int(x));iz=min(height-2,int(z));fx=x-ix;fz=z-iz
 return (values[iz*width+ix]*(1-fx)+values[iz*width+ix+1]*fx)*(1-fz)+(values[(iz+1)*width+ix]*(1-fx)+values[(iz+1)*width+ix+1]*fx)*fz

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--output',type=pathlib.Path,required=True);parser.add_argument('--cell-size',type=float,default=6);parser.add_argument('--bbox',nargs=4,type=float,default=DEFAULT_BBOX);args=parser.parse_args()
 args.output.mkdir(parents=True,exist_ok=True);tofeet=Transformer.from_crs(4326,2249,always_xy=True)
 corners=[tofeet.transform(lon,lat) for lon in [args.bbox[0],args.bbox[2]] for lat in [args.bbox[1],args.bbox[3]]]
 xs=[(x-EAST)*FT for x,y in corners];zs=[-(y-NORTH)*FT for x,y in corners];cell=args.cell_size
 # Include a complete cell outside the geographic extent on each side.
 ox=math.floor(min(xs)/cell)*cell-cell;oz=math.floor(min(zs)/cell)*cell-cell
 width=math.ceil((max(xs)-ox)/cell)+2;height=math.ceil((max(zs)-oz)/cell)+2
 xmin=EAST+(ox-cell/2)/FT;xmax=EAST+(ox+(width-.5)*cell)/FT
 ymax=NORTH-(oz-cell/2)/FT;ymin=NORTH-(oz+(height-.5)*cell)/FT
 query={'f':'json','bbox':','.join(map(str,[xmin,ymin,xmax,ymax])),'bboxSR':2249,'imageSR':2249,'size':f'{width},{height}','format':'tiff','pixelType':'F32','interpolation':'RSP_BilinearInterpolation','renderingRule':json.dumps({'rasterFunction':'None'}),'adjustAspectRatio':'false','noData':-9999}
 url=SERVICE+'/exportImage?'+urllib.parse.urlencode(query)
 metadata_path=args.output/'terrain-export.json';tiff_path=args.output/'terrain.tif'
 if metadata_path.exists() and tiff_path.exists() and json.loads(metadata_path.read_text()).get('request')==query:meta=json.loads(metadata_path.read_text())
 else:
  print('Requesting USGS float32 terrain',width,height,'at',cell,'m',flush=True)
  response=json.loads(request(url))
  if 'error' in response:raise RuntimeError(response['error'])
  meta={'service':SERVICE,'request':query,'response':response,'url':url};metadata_path.write_text(json.dumps(meta,indent=2)+'\n')
  tiff_path.write_bytes(request(response['href']))
 image=Image.open(io.BytesIO(tiff_path.read_bytes()))
 if image.size!=(width,height) or image.mode!='F':raise RuntimeError(f'Expected {width}x{height} Float32 DEM; got {image.size}/{image.mode}')
 raw=list(image.get_flattened_data());invalid=sum(not math.isfinite(v) or v<-100 or v>500 for v in raw)
 if invalid:raise RuntimeError(f'{invalid} invalid terrain samples; refusing fabricated terrain')
 # Gentle 3x3 separable smoothing suppresses kerb/retaining-wall aliasing while
 # retaining Mission Hill's actual broad grades. All values remain source-derived.
 weights=[1,2,1];values=[]
 for row in range(height):
  for col in range(width):
   values.append(sum(raw[max(0,min(height-1,row+dz))*width+max(0,min(width-1,col+dx))]*weights[dz+1]*weights[dx+1] for dz in [-1,0,1] for dx in [-1,0,1])/16)
 reference={'x':-291.674,'z':36.660,'name':'Original Boylston Street spawn'}
 datum=sample(values,width,height,(reference['x']-ox)/cell,(reference['z']-oz)/cell)
 relative=[round(v-datum,3) for v in values]
 grid={'width':width,'height':height,'cellSize':cell,'originX':ox,'originZ':oz,'heights':relative}
 (args.output/'elevation.json').write_text(json.dumps(grid,separators=(',',':'))+'\n')
 provenance={'source':SERVICE,'license':'USGS public domain','verticalUnit':'metres','referenceAbsoluteMeters':datum,'referencePoint':reference,'grid':{k:v for k,v in grid.items() if k!='heights'},'bbox':args.bbox,'method':'USGS float32 bare-earth DEM; bilinear image resampling; 3x3 [1,2,1] separable smoothing; fixed Back Bay datum subtraction','tiffSHA256':hashlib.sha256(tiff_path.read_bytes()).hexdigest(),'rangeMeters':[min(relative),max(relative)],'rawAbsoluteRangeMeters':[min(raw),max(raw)],'request':meta}
 (args.output/'terrain-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
 print(json.dumps({k:v for k,v in provenance.items() if k!='request'},indent=2))

if __name__=='__main__':main()
