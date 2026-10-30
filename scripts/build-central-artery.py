#!/usr/bin/env python3
"""Compile sourced Central Artery roads into a standalone runtime sidecar.

Run with the existing scripts/requirements.txt data environment. No network or
city/tile rewrites are needed; city.json's tunnels.file loads this sidecar.
"""
from __future__ import annotations
import argparse,gzip,hashlib,json,math,pathlib,sys
import numpy as np
from pyproj import Transformer
from shapely.geometry import LineString,Point
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

def projection(road,point):
 best=(math.inf,0,0.)
 for i,(a,b) in enumerate(zip(road['points'],road['points'][1:])):
  dx,dz=b[0]-a[0],b[1]-a[1];t=max(0,min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dz)/max(.000001,dx*dx+dz*dz)))
  distance=math.hypot(point[0]-a[0]-dx*t,point[1]-a[1]-dz*t)
  if distance<best[0]:best=(distance,i,t)
 return best

def projected_profile(road,point):
 distance,i,t=projection(road,point)
 return distance,road['elevations'][i]+(road['elevations'][i+1]-road['elevations'][i])*t

def deck_sections(road):
 sections=[];ps=road['points']
 for i,p in enumerate(ps):
  a,b=ps[max(0,i-1)],ps[min(len(ps)-1,i+1)];dx,dz=b[0]-a[0],b[1]-a[1];n=math.hypot(dx,dz);half=road.get('deckWidths',[road['width']]*len(ps))[i]/2
  ys=road.get('deckEdgeElevations',[[y,y] for y in road['elevations']])[i]
  sections.append([(p[0]+dz/n*half,ys[0],p[1]-dx/n*half),(p[0]-dz/n*half,ys[1],p[1]+dx/n*half)])
 return sections

def deck_height(road,point):
 # Evaluate the exact ribbon triangle, including the parent's crossfall. The
 # closest plane is extended just outside the pavement to make a coplanar fork.
 _,index,_=projection(road,point);sections=deck_sections(road);choices=[]
 for i in range(max(0,index-1),min(len(sections)-1,index+2)):
  for a,b,c in [(sections[i][0],sections[i][1],sections[i+1][0]),(sections[i][1],sections[i+1][1],sections[i+1][0])]:
   dx1,dz1=b[0]-a[0],b[2]-a[2];dx2,dz2=c[0]-a[0],c[2]-a[2];det=dx1*dz2-dx2*dz1
   if abs(det)<1e-8:continue
   u=((point[0]-a[0])*dz2-(point[1]-a[2])*dx2)/det;v=(dx1*(point[1]-a[2])-dz1*(point[0]-a[0]))/det
   height=a[1]+(b[1]-a[1])*u+(c[1]-a[1])*v
   if min(u,v,1-u-v)>=-1e-8:return height
   choices.append((max(-u,-v,u+v-1),height))
 return min(choices)[1]

def fit_surface_underpasses(city,route,points,ys,ground):
 if not route.get('surfaceUnderpasses'):return ys,[]
 line=LineString(points);ss=stations(points);streets={r['id']:r for r in city['roads']};crossings=[]
 for road_id in route['surfaceUnderpasses']:
  street=streets[road_id];corridor=LineString(street['points']).buffer(street['width']/2+route['width']/2+1)
  intersection=line.intersection(corridor)
  if intersection.is_empty:continue
  for part in intersection.geoms if hasattr(intersection,'geoms') else [intersection]:
   if part.geom_type!='LineString':continue
   lo,hi=sorted([line.project(Point(part.coords[0])),line.project(Point(part.coords[-1]))])
   # The ramp's actual at-grade entrance/exit remains open to its parent street.
   if route.get('surfaceStart') and lo<20 or route.get('surfaceEnd') and hi>line.length-20:continue
   samples=[]
   for d in np.linspace(lo,hi,max(2,math.ceil((hi-lo)/2)+1)):
    p=line.interpolate(d);a=line.interpolate(max(0,d-.1));b=line.interpolate(min(line.length,d+.1));dx,dz=b.x-a.x,b.y-a.y;n=math.hypot(dx,dz)
    for side in [-1,0,1]:samples.append(ground([p.x+dz/n*(route['width']/2+.4)*side,p.y-dx/n*(route['width']/2+.4)*side]))
   floor=min(samples)-6.2
   crossings.append({'roadId':road_id,'street':street['name'],'start':round(lo,4),'end':round(hi,4),'floor':round(floor,4)})
 for crossing in crossings:
  lo,hi,floor=crossing['start']-8,crossing['end']+8,crossing['floor']
  for i,s in enumerate(ss):ys[i]=min(ys[i],floor+.115*max(lo-s,0,s-hi))
 # The retained survey's first50m is an observed lane; profiles may not pull it
 # down to fix a surface conflict farther into the city.
 if route.get('northDeck') is not None:
  for s,y in zip(ss,ys):
   edge=line.length-s if route.get('direction')=='north' or route.get('surfaceStart') else s
   if edge<=50 and y<route['northDeck']-.061*edge-.002:raise ValueError(f"Underpass changes surveyed bridge lip on {route['id']}")
 return ys,crossings

def fit_deck_widths(roads):
 # The source is a graph of road axes. Full-width independent ribbons can
 # overlap sideways while their centerlines never cross. Keep the modeled
 # lanes separate during the vertical transition, with gradual width tapers.
 widths={r['id']:[r['width']]*len(r['points']) for r in roads}
 for a in roads:
  for b in roads:
   if a is b:continue
   for i,(point,y) in enumerate(zip(a['points'],a['elevations'])):
    distance,j,t=projection(b,point);height=b['elevations'][j]+(b['elevations'][j+1]-b['elevations'][j])*t
    if not .18<abs(y-height)<6.5 or distance>=(a['width']+b['width'])/2+.3:continue
    wa,wb=a['width'],b['width'];minimum=lambda r:10. if r['kind']=='motorway' else 3.8
    excess=wa+wb-2*(distance-.25)
    # Single-lane ramp shoulders narrow first, preserving mainline lanes.
    order=[a,b] if a['kind']!='motorway' else [b,a]
    values={a['id']:wa,b['id']:wb}
    for r in order:
     reduce=min(max(0,excess),values[r['id']]-minimum(r));values[r['id']]-=reduce;excess-=reduce
    if excess>.15:continue # A true overlapping merge is handled by its profile.
    widths[a['id']][i]=min(widths[a['id']][i],values[a['id']])
    for k in [j,j+1]:widths[b['id']][k]=min(widths[b['id']][k],values[b['id']])
 for road in roads:
  values=widths[road['id']];ss=stations(road['points'])
  # Limit edge convergence to 1:20 (total width slope 1:10).
  for i in range(1,len(values)):values[i]=min(values[i],values[i-1]+.1*(ss[i]-ss[i-1]))
  for i in range(len(values)-2,-1,-1):values[i]=min(values[i],values[i+1]+.1*(ss[i+1]-ss[i]))
  if min(values)<road['width']-.001:road['deckWidths']=[round(v,4) for v in values]

def fit_deck_edges(roads,records,specs,ground):
 by_id={r['id']:r for r in roads}
 for road,record,spec in zip(roads,records,specs):
  sections=deck_sections(road);ss=stations(road['points']);edges=[[y,y] for y in road['elevations']]
  for join in record['joins']:
   parent=by_id[join['roadId']];indexes=list(range(len(ss)) if join['pointIndex']==0 else range(len(ss)-1,-1,-1));matched=[]
   for i in indexes:
    distance,_=projected_profile(parent,road['points'][i]);matched.append(i)
    if distance>(road['width']+parent['width'])/2+.5 or abs(ss[i]-ss[join['pointIndex']])>spec.get('mergeMatchLimit',math.inf):break
   last=matched[-1];span=abs(ss[last]-ss[join['pointIndex']])
   for i in indexes:
    beyond=abs(ss[i]-ss[join['pointIndex']])-span;weight=1 if beyond<=0 else max(0,1-beyond/24)
    if weight==0:break
    for side,p in enumerate(sections[i]):
     center=deck_height(parent,road['points'][i]);difference=deck_height(parent,(p[0],p[2]))-center
     edges[i][side]+=difference*weight
  for at_start,flag in [(True,'surfaceStart'),(False,'surfaceEnd')]:
   if not spec.get(flag):continue
   indexes=range(len(ss)) if at_start else range(len(ss)-1,-1,-1);origin=ss[0] if at_start else ss[-1]
   for i in indexes:
    weight=max(0,1-abs(ss[i]-origin)/24)
    if not weight:break
    p=road['points'][i];center=ground(p)
    for side,q in enumerate(sections[i]):edges[i][side]+=(ground([q[0],q[2]])-center)*weight
  road['deckEdgeElevations']=[[round(v,4) for v in pair] for pair in edges]

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
  for lo,hi,floor,taper in route.get('profileDips',[]):
   for i,s in enumerate(ss):
    t=min(1,max(lo-s,0,s-hi)/taper);weight=t*t*(3-2*t)
    ys[i]=min(ys[i],floor+(ys[i]-floor)*weight)
  ys,underpasses=fit_surface_underpasses(city,route,points,ys,ground)
  ys=[round(y,4) for y in ys]
  # Full-width burial is calculated after merge crossfall and width fitting.
  tunnel={'clearance':5.2,'covered':[]}
  for flag in ['capStart','capEnd']:
   if route.get(flag):tunnel[flag]=True
  road={'id':route['id'],'name':route['name'],'kind':'motorway' if is_main else 'motorway_link','points':points,'width':route['width'],'oneway':1,'traffic':False,'elevations':ys,'startLevel':0 if route.get('surfaceStart') else -1,'endLevel':0 if route.get('surfaceEnd') else -1,'tunnel':tunnel}
  roads.append(road)
  for p,y in zip(points,ys):known[tuple(p)]=(y,road['id'])
  max_grade=max(abs(a-b)/max(.001,math.dist(p,q)) for p,q,a,b in zip(points,points[1:],ys,ys[1:]))
  if max_grade>.13:raise ValueError(f"{road['id']} grade {max_grade:.1%}")
  records.append({'id':road['id'],'sourceFeatureIds':route['featureIds'],'role':route['role'],'lengthMeters':round(length,3),'maxGrade':round(max_grade,4),'joins':joins,**({'surfaceUnderpasses':underpasses} if underpasses else {}),**({'surveyJoin':route['surveyJoin']} if 'surveyJoin' in route else {})})
 fit_deck_widths(roads)
 fit_deck_edges(roads,records,source['routes'],ground)
 for road,record in zip(roads,records):
  covered=[];start=None;ss=stations(road['points'])
  for i,(point,y,section,station) in enumerate(zip(road['points'],road['elevations'],deck_sections(road),ss)):
   buried=y+6<=ground(point) and all(q[1]+6<=ground([q[0],q[2]]) for q in section)
   if buried and start is None:start=station
   if start is not None and (not buried or i==len(ss)-1):
    end=ss[max(0,i-1)] if not buried else station
    if end-start>=6:covered.append([round(start,4),round(end,4)])
    start=None
  road['tunnel']['covered']=covered
  if 'deckWidths' in road:record['modeledWidthMeters']=[round(min(road['deckWidths']),3),road['width']]
 landmarks=[]
 for id,name,description in [
  ('central-artery-new-chardon-south-on','Big Dig · I-93 South entrance','New Chardon Street · descend beneath the Greenway toward South Station'),
  ('central-artery-cross-street-north-on','Big Dig · I-93 North entrance','Cross / Sudbury Street · underground approach to the Zakim Bridge'),
  ('central-artery-essex-north-on','Big Dig · South Station entrance','Essex / Lincoln Street · I-93 North beneath the Rose Kennedy Greenway'),
 ]:
  r=next(r for r in roads if r['id']==id);p,q=r['points'][:2]
  landmarks.append({'id':id,'name':name,'position':p,'description':description,'driveStart':{'x':p[0],'z':p[1],'yaw':math.atan2(q[0]-p[0],q[1]-p[1]),'roadId':id}})
 return {'version':1,'roads':roads,'landmarks':landmarks,'sources':[{'name':'Boston GIS Central Artery and tunnel ramp centerlines; estimated underground profiles','url':source['url'],'license':source['license']},{'name':'CTPS Central Artery ramp connectivity reference','url':source['reference'],'license':'Boston Region MPO / CTPS public transportation reference'}],'provenance':{'sourceSHA256':hashlib.sha256(json.dumps(source,sort_keys=True).encode()).hexdigest(),'profiles':'Estimated elevations with coplanar merge crossfall and local lane-width tapers; 5.2m playable clearance, no civil-engineering vertical survey claim','routes':records}}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');p.add_argument('--source-file',type=pathlib.Path);args=p.parse_args()
 source=json.loads((args.source_file or args.data_dir/'central-artery-source.json').read_text());city=json.loads((args.data_dir/'city.json').read_text());grid=city['elevation'];heights=np.frombuffer(gzip.decompress((args.data_dir/grid['file']).read_bytes()),dtype='<i2')*grid.get('scale',.01)
 result=build(city,source,heights);(args.data_dir/'central-artery.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
 for record in result['provenance']['routes']:print(record['id'],record['lengthMeters'],f"grade {record['maxGrade']:.1%}")
 print('city.json must contain "tunnels":{"file":"central-artery.json"}')
if __name__=='__main__':main()
