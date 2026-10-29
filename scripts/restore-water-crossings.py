#!/usr/bin/env python3
"""Restore source-road intervals accidentally clipped out with district water holes.

The checked-in sidecar records original Boston GIS alignments. Existing road
pieces and their graded landings are retained; only bounded wet gaps are added.
Run after grading and build-road-structures.py. No freeway/tunnel is introduced.
"""
import argparse, gzip, hashlib, importlib.util, json, math, pathlib, sys
import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely import union_all, set_precision
from shapely.ops import unary_union, substring
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from harvard_bridge import harmonize_harvard
from harvard_cambridge import repair_cambridge,UPPER_IDS,SLIP_IDS,CONNECTOR_ID
from harvard_terrain import repair_memorial_terrain
from tileformat import write_gzip

def restore(city,source,heights):
 grid=city['elevation'];width=grid['width'];cell=grid['cellSize']
 def ground(p):
  fx=(p[0]-grid['originX'])/cell;fz=(p[1]-grid['originZ'])/cell;i=int(fx);j=int(fz);tx=fx-i;tz=fz-j
  a,b,c,d=[heights[k] for k in [j*width+i,j*width+i+1,(j+1)*width+i,(j+1)*width+i+1]]
  return float(a+(b-a)*tx+(c-a)*tz if tx+tz<=1 else d+(c-d)*(1-tx)+(b-d)*(1-tz))
 roads=[r for r in city['roads'] if not r['id'].startswith('water-link-')];ends={}
 for r in roads:
  for i in [0,-1]:
   p=r['points'][i];ends.setdefault((round(p[0],1),round(p[1],1)),[]).append((r,i))
 added=[]
 for span in source['spans']:
  points=span['points'];matches=[]
  for p in [points[0],points[-1]]:
   candidates=[]
   for dx in [-.1,0,.1]:
    for dz in [-.1,0,.1]:candidates.extend(ends.get((round(p[0]+dx,1),round(p[1]+dz,1)),[]))
   candidates=[(r,i) for r,i in candidates if math.dist(r['points'][i],p)<.12]
   preferred=[v for v in candidates if v[0]['id'].startswith(span['sourcePath']+'-')]
   if not candidates:raise ValueError(f"Unconnected source span {span['id']} at {p}")
   matches.append((preferred or candidates)[0])
  # Use the actual retained endpoints, including centimetre rounding and grade.
  points=[matches[0][0]['points'][matches[0][1]],*points[1:-1],matches[1][0]['points'][matches[1][1]]]
  levels=[r['elevations'][i] if r.get('elevations') else ground(r['points'][i]) for r,i in matches]
  lengths=[math.dist(a,b) for a,b in zip(points,points[1:])];total=sum(lengths);result=[];ys=[];along=0
  for a,b,length in zip(points,points[1:],lengths):
   for j in range(max(1,math.ceil(length/3))):
    t=j/max(1,math.ceil(length/3));result.append([round(a[k]+(b[k]-a[k])*t,3) for k in [0,1]]);ys.append(round(levels[0]+(levels[1]-levels[0])*(along+t*length)/total,4))
   along+=length
  result.append(points[-1]);ys.append(round(levels[1],4));r=matches[0][0]
  added.append({'id':span['id'],'name':r['name'],'points':result,'width':r['width'],'oneway':r['oneway'],'elevations':ys,'startLevel':1 if matches[0][0].get('elevations') else 0,'endLevel':1 if matches[1][0].get('elevations') else 0,'bridge':{'id':span['id'],'thickness':.75,'clearanceEstimated':True,'kind':'restored-water-span'}})
 city['roads']=roads+added
 # The OSM 30.5 m width describes the whole Longfellow bridge, not its
 # single-lane carriageway. Keep a central reservation for the Red Line.
 for r in city['roads']:
  if r['id'].startswith(('14614-','14615-','water-link-14614-','water-link-14615-')) or r['name']=='Longfellow Bridge':r['width']=7;r['name']='Longfellow Bridge'
 repair_cambridge(city['roads'],ground)
 harmonize_harvard(city['roads'])
 # Traffic coverage includes each bridge ribbon; district and building bounds stay fixed.
 base=[Polygon(p) for p in city['coverage']]
 corridors=[LineString(r['points']).buffer(r['width']/2+3,cap_style=1) for r in added]
 # Snap before union: repeatedly rounding fresh intersections can otherwise
 # grow millimetre slivers every time this postprocessor is rerun.
 coverage=union_all([set_precision(p,.001) for p in base+corridors],grid_size=.001).normalize()
 parts=list(coverage.geoms) if coverage.geom_type=='MultiPolygon' else [coverage]
 city['coverage']=[[[round(x,3),round(z,3)] for x,z in p.exterior.coords[:-1]] for p in parts]
 return added

def extract(city,cache):
 spec=importlib.util.spec_from_file_location('metro',ROOT/'scripts/build-metro.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 wet=unary_union([Polygon(w['rings'][0],w['rings'][1:]) for w in city['water']]).buffer(2)
 endpoints=unary_union([Point(r['points'][i]) for r in city['roads'] for i in [0,-1]])
 by_path={}
 for r in city['roads']:
  if not r['id'].startswith(('osm-','water-link-')):by_path.setdefault('-'.join(r['id'].split('-')[:2]),[]).append(r)
 spans=[]
 for f in m.load_layer(cache,8):
  a=f['attributes'];name=a.get('ST_NAME') or '';cfcc=str(a.get('CFCC','')).strip()
  if not name or name=='James J Storrow Memorial' or name.startswith('Interstate ') or 'Turnpike' in name or 'Expressway' in name or cfcc in ['A71','A72'] or cfcc.startswith('A1') or (a.get('F_ZLEV') or 0)<0 or (a.get('T_ZLEV') or 0)<0:continue
  for j,path in enumerate(f['geometry']['paths']):
   line=LineString([m.xy(*v) for v in path])
   prefix=f"{a['OBJECTID']}-{j}-"
   intervals=sorted([sorted([line.project(Point(r['points'][0])),line.project(Point(r['points'][-1]))]) for r in by_path.get(prefix[:-1],[])])
   gaps=[];cursor=0
   for low,high in intervals:
    if low-cursor>1:gaps.append(substring(line,cursor,low))
    cursor=max(cursor,high)
   if line.length-cursor>1:gaps.append(substring(line,cursor,line.length))
   for k,gap in enumerate(gaps):
    if gap.length<3 or gap.difference(wet).length>max(2,gap.length*.15):continue
    points=list(gap.coords)
    if any(endpoints.distance(Point(p))>.12 for p in [points[0],points[-1]]):continue
    spans.append({'id':f"water-link-{a['OBJECTID']}-{j}-{k}",'sourcePath':f"{a['OBJECTID']}-{j}",'name':name,'points':[[round(x,3),round(z,3)] for x,z in points]})
 return {'source':'City of Boston GIS street centerlines, layer 8','url':'https://gisportal.boston.gov/arcgis/rest/services/Infrastructure/OpenData/MapServer/8','license':'PDDL','method':'Original source path intervals missing from packaged roads, predominantly within mapped water with shoreline tolerance, bounded by retained road endpoints; freeway and tunnel exclusions retained','spans':spans}

def main():
 p=argparse.ArgumentParser();p.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');p.add_argument('--source-file',type=pathlib.Path,default=ROOT/'public/data/bridge-spans-source.json');p.add_argument('--extract-source',type=pathlib.Path);a=p.parse_args()
 city=json.loads((a.data_dir/'city.json').read_text())
 if a.extract_source:a.source_file.write_text(json.dumps(extract(city,a.extract_source),separators=(',',':'))+'\n')
 source=json.loads(a.source_file.read_text());grid=city['elevation'];heights=np.frombuffer(gzip.decompress((a.data_dir/grid['file']).read_bytes()),dtype='<i2')*grid.get('scale',.01)
 terrain=repair_memorial_terrain(city,heights)
 write_gzip(a.data_dir/grid['file'],np.rint(heights/grid.get('scale',.01)).astype('<i2').tobytes())
 added=restore(city,source,heights);(a.data_dir/'city.json').write_text(json.dumps(city,separators=(',',':'))+'\n')
 provenance=json.loads((a.data_dir/'provenance.json').read_text());provenance['coveragePolygons']=len(city['coverage']);provenance['roads']['boston']['count']=sum(not r['id'].startswith('osm-') for r in city['roads']);provenance['restoredWaterCrossings']={'source':source['source'],'method':source['method'],'sourceSHA256':hashlib.sha256(a.source_file.read_bytes()).hexdigest(),'roads':[r['id'] for r in added],'harvardDeck':'16 m basin pavement with a 10 m Boston street landing, per-point tapered widths, shared endpoint tangents; one linear Boston approach across the three shore pieces, retaining the graded street landing and basin deck','cambridgeApproach':{'roads':UPPER_IDS+SLIP_IDS+[CONNECTOR_ID],'method':'Retained OSM horizontal alignments; extend the basin deck above Memorial Drive and grade connected approaches to unchanged outer terrain landings. One-lane slips use 5 m pavement with flared junction mouths; divided Massachusetts Avenue forks widen through overlapping full-width junction mouths. Estimated game profile, not surveyed elevations.'}}
 provenance['restoredWaterCrossings']['cambridgeTerrain']={k:v for k,v in terrain.items() if k not in ('changedVertices','maxChangeMeters')}
 (a.data_dir/'provenance.json').write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 print(f'Restored {len(added)} source water spans; {len(city["roads"])} total roads. Leveled {terrain["changedVertices"]} Memorial underpass terrain vertices.')
 for r in added:print(r['id'],r['name'],round(LineString(r['points']).length))
if __name__=='__main__':main()
