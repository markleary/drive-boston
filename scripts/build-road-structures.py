#!/usr/bin/env python3
"""Restore selected source-mapped Bowker bridges without changing city coverage.

GIS supplies horizontal alignments and level topology, not surveyed deck heights.
The documented 6.4m local-datum deck/0.75m slab is an explicit game estimate.
"""
from __future__ import annotations
import argparse, hashlib, importlib.util, json, math, pathlib, urllib.parse, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
SERVICE='https://gisportal.boston.gov/arcgis/rest/services/Infrastructure/OpenData/MapServer/8'
SOURCE=ROOT/'public/data/road-structures-source.json'
BOYLSTON={23820,23433,23166,20010,21017,23116,19480,19411,19934,20704}
LOWER={14147,14678}
DECK=6.4
THICKNESS=.75

def main():
 p=argparse.ArgumentParser();p.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');p.add_argument('--source-file',type=pathlib.Path,default=SOURCE);p.add_argument('--cache',type=pathlib.Path);a=p.parse_args()
 spec=importlib.util.spec_from_file_location('city_compiler',ROOT/'scripts/build-city.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 if a.source_file.exists():
  source=json.loads(a.source_file.read_text())
  if a.cache and not LOWER<={f['attributes']['SEGMENT_ID']for f in source['features']}:
   raw=json.loads(a.cache.read_text());source['features'].extend(f for f in raw['features']if f['attributes']['SEGMENT_ID']in LOWER);a.source_file.write_text(json.dumps(source,separators=(',',':'))+'\n')
 else:
  if a.cache:raw=json.loads(a.cache.read_text())
  else:
   params={'f':'json','where':"(ST_NAME='Charlesgate' AND SUF_DIR IS NULL) OR (ST_NAME='Boylston' AND (F_ZLEV<>0 OR T_ZLEV<>0)) OR SEGMENT_ID IN (14147,14678)",'outFields':'*','outSR':4326,'returnGeometry':'true'}
   with urllib.request.urlopen(SERVICE+'/query?'+urllib.parse.urlencode(params),timeout=60)as response:raw=json.load(response)
  selected=[f for f in raw['features'] if (f['attributes']['ST_NAME']=='Charlesgate' and not f['attributes']['SUF_DIR'])or f['attributes']['SEGMENT_ID']in BOYLSTON|LOWER]
  source={'source':SERVICE,'retrieved':'2026-10-27','authority':'Boston street centerlines and level topology; MassDOT Bowker Overpass project confirms crossings','reference':'https://www.mass.gov/bowker-overpass-project','features':selected}
  a.source_file.parent.mkdir(parents=True,exist_ok=True);a.source_file.write_text(json.dumps(source,separators=(',',':'))+'\n')
 city_path=a.data_dir/'city.json';city=json.loads(city_path.read_text());grid=city['elevation'];new=[]
 if 'heights' not in grid:
  # Metro builds store the grid as gzip int16 centimetres in a sidecar file.
  import gzip;import numpy as np
  heights=np.frombuffer(gzip.decompress((a.data_dir/grid['file']).read_bytes()),dtype='<i2').astype(np.float64)*grid.get('scale',.01)
  grid=dict(grid,heights=heights)
 ids={str(f['attributes']['OBJECTID'])for f in source['features']}
 # Idempotent replacement only for selected source roads; bounds/models unchanged.
 city['roads']=[r for r in city['roads'] if r['id'].split('-')[0]not in ids and r.get('bridge',{}).get('id')not in ('bowker','muddy-river')]
 for f in source['features']:
  attr=f['attributes'];seg=attr['SEGMENT_ID'];start=attr.get('F_ZLEV')or 0;end=attr.get('T_ZLEV')or 0
  for k,path in enumerate(f['geometry']['paths']):
   points=[module.xy(*p)for p in path];total=sum(math.dist(x,y)for x,y in zip(points,points[1:]));result=[];elevations=[];along=0
   low_start=module.elevation_at(grid,*points[0]);low_end=module.elevation_at(grid,*points[-1])
   for i,(v,w)in enumerate(zip(points,points[1:])):
    length=math.dist(v,w);n=max(1,math.ceil(length/3))
    for j in range(n):
     t=j/n;s=(along+t*length)/total;pos=[v[0]+(w[0]-v[0])*t,v[1]+(w[1]-v[1])*t]
     if seg in LOWER:h=low_start+(low_end-low_start)*s
     elif start==end==1:h=DECK
     elif start==0 and end==1:h=low_start+(DECK-low_start)*(s*s*(3-2*s))
     elif start==1 and end==0:h=DECK+(low_end-DECK)*(s*s*(3-2*s))
     else:h=module.elevation_at(grid,*pos)
     result.append([round(x,3)for x in pos]);elevations.append(round(h,4))
    along+=length
   result.append([round(x,3)for x in points[-1]]);elevations.append(round(DECK if end else low_end,4))
   width=9 if seg in LOWER else 8.2 if attr['CFCC']=='A35'else 7.0
   new.append({'id':f'{seg}-{k}-bridge','name':'Commonwealth Avenue'if seg in LOWER else'Bowker Overpass'if attr['ST_NAME']=='Charlesgate'else'Boylston Street','points':result,'width':width,'oneway':1 if attr['ONEWAY']=='FT'else -1 if attr['ONEWAY']=='TF'else 0,'elevations':elevations,'startLevel':start,'endLevel':end,'bridge':{'id':'muddy-river'if seg in LOWER else'bowker','thickness':.45 if seg in LOWER else THICKNESS,'clearanceEstimated':True}})
 city['roads'].extend(new)
 ramp=next(r for r in new if r['id'].startswith('21327-'));i=5;v,w=ramp['points'][i:i+2];dx=w[0]-v[0];dz=w[1]-v[1];length=math.hypot(dx,dz);yaw=math.atan2(dx,dz)
 destination={'id':'bowker-overpass','name':'Bowker Overpass','position':[-1440,110],'description':'Charlesgate · elevated roadway above Commonwealth Avenue and Ipswich Street','driveStart':{'x':round(v[0]-dz/length*1.5,4),'z':round(v[1]+dx/length*1.5,4),'yaw':yaw,'roadId':ramp['id']}}
 city['landmarks']=[l for l in city['landmarks'] if l['id']!='bowker-overpass']+[destination]
 source_record={'name':'Boston GIS Bowker road structure alignments; estimated deck profile','url':'https://www.mass.gov/bowker-overpass-project','license':'City road alignments PDDL; original estimated deck geometry'}
 if not any(s['name']==source_record['name']for s in city['sources']):city['sources'].append(source_record)
 city_path.write_text(json.dumps(city,separators=(',',':'))+'\n')
 provenance_path=a.data_dir/'provenance.json';provenance=json.loads(provenance_path.read_text());provenance['roadStructures']={'source':source['source'],'reference':source['reference'],'alignments':'Retained official GIS source alignment, not a representation of current construction staging or future replacement geometry','deckHeightMeters':DECK,'slabThicknessMeters':THICKNESS,'heightAccuracy':'Estimated local-datum profile; smooth source-ground ramps, not surveyed bridge engineering','roads':[r['id']for r in new],'sourceSHA256':hashlib.sha256(a.source_file.read_bytes()).hexdigest()};provenance_path.write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 print(f'Prepared {len(new)} Bowker bridge/ramp segments; {len(city["roads"])} total roads; coverage/building data unchanged.')
if __name__=='__main__':main()
