#!/usr/bin/env python3
"""Compile sourced Central Artery roads into a standalone runtime sidecar.

Run with the existing scripts/requirements.txt data environment. No network or
city/tile rewrites are needed; city.json's tunnels.file loads this sidecar.
"""
from __future__ import annotations
import argparse,gzip,hashlib,json,math,pathlib,sys
import numpy as np
from pyproj import Transformer
from harvard_terrain import sample_grid

ROOT=pathlib.Path(__file__).resolve().parents[1]
PROJECT=Transformer.from_crs(4326,2249,always_xy=True)
FT=1200/3937

def xy(p):
 x,y=PROJECT.transform(*p)
 return [round((x-771100)*FT,3),round(-(y-2952900)*FT,3)]

def stations(points):
 out=[0.]
 for a,b in zip(points,points[1:]):out.append(out[-1]+math.dist(a,b))
 return out

def interpolate(controls,d):
 for (a,y),(b,z) in zip(controls,controls[1:]):
  if d<=b:return y+(z-y)*max(0,min(1,(d-a)/max(.001,b-a)))
 return controls[-1][1]

def projected_profile(road,point):
 best=(math.inf,0.)
 for a,b,ya,yb in zip(road['points'],road['points'][1:],road['elevations'],road['elevations'][1:]):
  dx,dz=b[0]-a[0],b[1]-a[1];t=max(0,min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dz)/max(.000001,dx*dx+dz*dz)))
  distance=math.hypot(point[0]-a[0]-dx*t,point[1]-a[1]-dz*t)
  if distance<best[0]:best=(distance,ya+(yb-ya)*t)
 return best

def profile_points(features):
 points=[];ground_nodes=[];anchors=set()
 for feature in features:
  a=feature['attributes'];p=[xy(v) for v in feature['geometry']['paths'][0]]
  anchors.update([tuple(p[0]),tuple(p[-1])])
  if points and math.dist(points[-1],p[0])>.02:raise ValueError(f"Disconnected source segment {a['OBJECTID']}")
  if not points:points.append(p[0])
  if a['F_ZLEV']==0:ground_nodes.append(tuple(p[0]))
  if a['T_ZLEV']==0:ground_nodes.append(tuple(p[-1]))
  for start,end in zip(p,p[1:]):
   n=max(1,math.ceil(math.dist(start,end)/6))
   points.extend([[round(start[k]+(end[k]-start[k])*i/n,4) for k in (0,1)] for i in range(1,n+1)])
 # Survey polylines contain centimetre-long tangency fragments. Drop only
 # non-junction interior vertices that would fold a full-width road ribbon.
 changed=True
 while changed:
  changed=False
  for i in range(1,len(points)-1):
   if tuple(points[i]) not in anchors and min(math.dist(points[i-1],points[i]),math.dist(points[i],points[i+1]))<1.2:
    points.pop(i);changed=True;break
 return points,set(ground_nodes)

def build(city,source,heights):
 by_id={f['attributes']['OBJECTID']:f for f in source['features']};known={};roads=[];records=[]
 ground=lambda p:float(sample_grid(city['elevation'],heights,p))
 for route in source['routes']:
  points,ground_nodes=profile_points([by_id[i] for i in route['featureIds']]);ss=stations(points)
  # The GIS axis cuts the retained survey parapet at the southern bridge lip.
  # Fit just this 80m transition into the observed lane; the city alignment
  # and every underground/surface-ramp graph anchor remain source-exact.
  if route.get('surveyLateralFit'):
   original=[list(p) for p in points]
   for i,(point,station) in enumerate(zip(original,ss)):
    distance=ss[-1]-station if route.get('direction')=='north' else station
    if distance>=80:continue
    a,b=original[max(0,i-1)],original[min(len(original)-1,i+1)];dx,dz=b[0]-a[0],b[1]-a[1];norm=math.hypot(dx,dz)
    f=1-distance/80;offset=route['surveyLateralFit']*f*f*(3-2*f)
    points[i]=[round(point[0]+dz/norm*offset,4),round(point[1]-dx/norm*offset,4)]
  ss=stations(points);length=ss[-1]
  is_main=route['role']=='mainline';joins=[]
  if is_main:
   ys=[]
   for s in ss:
    edge=length-s if route['direction']=='north' else s
    floor=-24 if route['direction']=='north' else -12
    # Match the measured 6.1% survey deck grade across its full overlap,
    # then a Hermite transition reaches the underground bore with zero grade.
    if edge<=50:y=route['northDeck']-.061*edge
    elif edge>=480:y=floor
    else:
     t=(edge-50)/430;start=route['northDeck']-.061*50
     y=(2*t**3-3*t*t+1)*start+(t**3-2*t*t+t)*430*-.061+(-2*t**3+3*t*t)*floor
    ys.append(y)
  else:
   controls=[]
   for index in [0,len(points)-1]:
    p=points[index];key=tuple(p);surface=route.get('surfaceStart' if index==0 else 'surfaceEnd')
    if surface:y=ground(p)
    elif index==len(points)-1 and 'northDeck' in route:y=route['northDeck']
    elif key in known:
     y,parent=known[key];joins.append({'pointIndex':index,'roadId':parent,'point':p,'elevation':round(y,4)})
    else:raise ValueError(f"No parent support for {route['id']} endpoint {index}: {p}")
    controls.append([ss[index],y])
   for i,p in enumerate(points):
    if tuple(p) in ground_nodes and i not in [0,len(points)-1]:controls.append([ss[i],ground(p)])
   if route.get('dip'):controls.append([min(140,length*.3),-8])
   if route.get('mergeFlatMeters'):controls.append([length-route['mergeFlatMeters'],next(y for s,y in controls if abs(s-length)<.001)])
   for feature_id,height in route.get('depthControls',[]):
    node=xy(by_id[feature_id]['geometry']['paths'][0][-1]);i=points.index(node);controls.append([ss[i],height])
   controls.extend(route.get('stationControls',[]))
   if route.get('matchParentPavement'):
    for join in joins:
     parent=next(r for r in roads if r['id']==join['roadId']);threshold=(route['width']+parent['width'])/2+.5
     indexes=range(len(points)) if join['pointIndex']==0 else range(len(points)-1,-1,-1)
     for i in indexes:
      distance,height=projected_profile(parent,points[i]);controls.append([ss[i],height])
      # Include the first outside station: the linear slab section touching
      # the parent lane must remain coplanar across its entire width.
      if distance>threshold or abs(ss[i]-ss[join['pointIndex']])>route.get('mergeMatchLimit',math.inf):break
   controls=sorted(dict(controls).items());ys=[interpolate(controls,s) for s in ss]
  ys=[round(y,4) for y in ys]
  # A real underground roof begins only after its complete soffit and slab
  # fit under the intact city surface. Open portions become retaining cuts.
  covered=[];inside=False;start=0
  for i,(p,y,s) in enumerate(zip(points,ys,ss)):
   ok=y+6.0<=ground(p)
   if ok and not inside:start=s;inside=True
   if inside and (not ok or i==len(points)-1):
    end=ss[max(0,i-1)] if not ok else s
    if end-start>=6:covered.append([round(start,4),round(end,4)])
    inside=False
  tunnel={'clearance':5.2,'covered':covered}
  for flag in ['capStart','capEnd']:
   if route.get(flag):tunnel[flag]=True
  road={'id':route['id'],'name':route['name'],'kind':'motorway' if is_main else 'motorway_link','points':points,'width':route['width'],'oneway':1,'traffic':False,'elevations':ys,'startLevel':0 if route.get('surfaceStart') else -1,'endLevel':0 if route.get('surfaceEnd') else -1,'tunnel':tunnel}
  roads.append(road)
  for p,y in zip(points,ys):known[tuple(p)]=(y,road['id'])
  max_grade=max(abs(a-b)/max(.001,math.dist(p,q)) for p,q,a,b in zip(points,points[1:],ys,ys[1:]))
  if max_grade>.13:raise ValueError(f"{road['id']} grade {max_grade:.1%}")
  records.append({'id':road['id'],'sourceFeatureIds':route['featureIds'],'role':route['role'],'lengthMeters':round(length,3),'maxGrade':round(max_grade,4),'joins':joins,**({'surveyJoin':route['surveyJoin']} if 'surveyJoin' in route else {})})
 landmarks=[]
 for id,name,description in [
  ('central-artery-new-chardon-south-on','Big Dig · I-93 South entrance','New Chardon Street · descend beneath the Greenway toward South Station'),
  ('central-artery-cross-street-north-on','Big Dig · I-93 North entrance','Cross / Sudbury Street · underground approach to the Zakim Bridge'),
  ('central-artery-essex-north-on','Big Dig · South Station entrance','Essex / Lincoln Street · I-93 North beneath the Rose Kennedy Greenway'),
 ]:
  r=next(r for r in roads if r['id']==id);p,q=r['points'][:2]
  landmarks.append({'id':id,'name':name,'position':p,'description':description,'driveStart':{'x':p[0],'z':p[1],'yaw':math.atan2(q[0]-p[0],q[1]-p[1]),'roadId':id}})
 return {'version':1,'roads':roads,'landmarks':landmarks,'sources':[{'name':'Boston GIS Central Artery and tunnel ramp centerlines; estimated underground profiles','url':source['url'],'license':source['license']},{'name':'CTPS Central Artery ramp connectivity reference','url':source['reference'],'license':'Boston Region MPO / CTPS public transportation reference'}],'provenance':{'sourceSHA256':hashlib.sha256(json.dumps(source,sort_keys=True).encode()).hexdigest(),'profiles':'Original estimated road elevations; 5.2m playable clearance, no civil-engineering vertical survey claim','routes':records}}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');p.add_argument('--source-file',type=pathlib.Path);args=p.parse_args()
 source=json.loads((args.source_file or args.data_dir/'central-artery-source.json').read_text());city=json.loads((args.data_dir/'city.json').read_text());grid=city['elevation'];heights=np.frombuffer(gzip.decompress((args.data_dir/grid['file']).read_bytes()),dtype='<i2')*grid.get('scale',.01)
 result=build(city,source,heights);(args.data_dir/'central-artery.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
 for record in result['provenance']['routes']:print(record['id'],record['lengthMeters'],f"grade {record['maxGrade']:.1%}")
 print('city.json must contain "tunnels":{"file":"central-artery.json"}')
if __name__=='__main__':main()
