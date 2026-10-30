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

def surface_landings(city,points,width,route):
 """Keep the whole ramp ribbon outside the adjoining street's driving lanes.

 GIS endpoints are intersection centerlines, not the start of a retaining cut.
 Include the ramp half-width and concrete thickness when finding the first
 clear section; rounded street ends also protect the junction between ways.
 """
 line=LineString(points);length=line.length;intervals=[];streets=[]
 for index,flag in [(0,'surfaceStart'),(-1,'surfaceEnd')]:
  if not route.get(flag):continue
  endpoint=Point(points[index]);extent=0.
  for road in city['roads']:
   if road.get('elevations'):continue
   radius=(road['width']+width)/2+.4
   # Avoid constructing buffers for the rest of the metropolitan road graph.
   xs=[p[0] for p in road['points']];zs=[p[1] for p in road['points']];x,z=points[index]
   if x<min(xs)-radius or x>max(xs)+radius or z<min(zs)-radius or z>max(zs)+radius:continue
   street=LineString(road['points'])
   if street.distance(endpoint)>radius:continue
   overlap=line.intersection(street.buffer(radius))
   for part in getattr(overlap,'geoms',[overlap]):
    if part.geom_type!='LineString' or part.is_empty:continue
    ss=[line.project(Point(p)) for p in part.coords];lo,hi=min(ss),max(ss)
    if (lo<.001 if index==0 else hi>length-.001):
     extent=max(extent,hi if index==0 else length-lo);streets.append(road['id'])
  # Land on a real profile vertex so the slab, opening and walls meet exactly.
  ss=stations(points)
  if index==0:intervals.append([0,next(s for s in ss if s>=extent)])
  else:intervals.append([next(s for s in reversed(ss) if s<=length-extent),length])
 return intervals,sorted(set(streets))

def clear_surface_crossings(city,points,ss,width,ys,landings,ground):
 """Keep full street ribbons clear above buried bores or below viaducts."""
 line=LineString(points);crossings=[];intervals=[]
 for street in city['roads']:
  if street.get('elevations'):continue
  other=LineString(street['points']);radius=(street['width']+width)/2+.4
  if line.distance(other)>radius:continue
  overlap=line.intersection(other.buffer(radius))
  for part in getattr(overlap,'geoms',[overlap]):
   if part.geom_type!='LineString' or part.is_empty:continue
   lo,hi=sorted([line.project(Point(part.coords[0])),line.project(Point(part.coords[-1]))])
   if any(a-.001<=lo and hi<=b+.001 for a,b in landings):continue
   intervals.append((lo,hi,street,other))
 # A continuous overlap cannot change from a tunnel below a street to a
 # viaduct above it halfway through that street. Preserve the elevated Zakim
 # approach over the entire connected crossing, then descend beyond it.
 groups=[]
 for item in sorted(intervals,key=lambda v:v[0]):
  if groups and item[0]<=max(v[1] for v in groups[-1])+12:groups[-1].append(item)
  else:groups.append([item])
 lower=[-math.inf]*len(points);upper=[math.inf]*len(points)
 for group in groups:
  above=any(ys[i]>ground(p)+5.2 for lo,hi,_,_ in group for i,(p,s) in enumerate(zip(points,ss)) if lo<=s<=hi)
  for lo,hi,street,other in group:
   crossings.append(street['id'])
   for i,(p,s) in enumerate(zip(points,ss)):
    if not lo-6<=s<=hi+6:continue
    q=other.interpolate(other.project(Point(p)))
    if above:lower[i]=max(lower[i],ground([q.x,q.y])+5.2)
    else:upper[i]=min(upper[i],ground(p)-6.2,ground([q.x,q.y])-6.2)
 fixed={0,len(points)-1}|{i for i,s in enumerate(ss) if any(a-.001<=s<=b+.001 for a,b in landings)}
 for i in fixed:lower[i]=max(lower[i],ys[i]);upper[i]=min(upper[i],ys[i])
 # Propagate clearance bounds at a playable grade before choosing a profile.
 # This also detects an impossible source plan instead of moving its joins.
 for indexes in [range(1,len(points)),range(len(points)-2,-1,-1)]:
  for i in indexes:
   j=i-1 if indexes.step>0 else i+1;rise=.115*abs(ss[i]-ss[j])
   lower[i]=max(lower[i],lower[j]-rise);upper[i]=min(upper[i],upper[j]+rise)
 for i in range(len(points)):
  if lower[i]>upper[i]+.001:raise ValueError(f"Surface clearance cannot meet fixed junction at {points[i]}")
 result=[max(lo,min(hi,y)) for lo,hi,y in zip(lower,upper,ys)]
 for indexes in [range(1,len(points)),range(len(points)-2,-1,-1)]:
  for i in indexes:
   j=i-1 if indexes.step>0 else i+1;rise=.115*abs(ss[i]-ss[j])
   result[i]=max(lower[i],min(upper[i],max(result[j]-rise,min(result[j]+rise,result[i]))))
 return result,sorted(set(crossings))

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
  if route.get('surfaceRoadFit'):
   fit=route['surfaceRoadFit'];original=[list(p) for p in points]
   for i,(p,s) in enumerate(zip(original,ss)):
    d=ss[-1]-s
    if not fit['startMetersFromNorth']<d<fit['endMetersFromNorth']:continue
    f=min(1,(d-fit['startMetersFromNorth'])/(fit['fullMetersFromNorth']-fit['startMetersFromNorth']),(fit['endMetersFromNorth']-d)/(fit['endMetersFromNorth']-fit['releaseMetersFromNorth']))
    f=f*f*(3-2*f);a,b=original[max(0,i-1)],original[min(len(original)-1,i+1)];dx,dz=b[0]-a[0],b[1]-a[1];norm=math.hypot(dx,dz)
    points[i]=[round(p[0]+dz/norm*fit['lateralMeters']*f,4),round(p[1]-dx/norm*fit['lateralMeters']*f,4)]
  ss=stations(points);length=ss[-1]
  is_main=route['role']=='mainline';joins=[]
  landings,landing_streets=surface_landings(city,points,route['width'],route)
  if is_main:
   ys=[]
   for s in ss:
    edge=length-s if route['direction']=='north' else s
    # The south bore also needs lining separation below the Government Center
    # exit after that ramp is fitted beneath North Street's through lanes.
    floor=-24 if route['direction']=='north' else -12.6
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
   # The surface intersection remains at terrain grade. Start the estimated
   # descent only after both sides of the ramp have cleared the through lanes.
   for p,s in zip(points,ss):
    if any(a-.001<=s<=b+.001 for a,b in landings):controls.append([s,ground(p)])
   controls=sorted(dict(controls).items());ys=[interpolate(controls,s) for s in ss]
  ys,surface_crossings=clear_surface_crossings(city,points,ss,route['width'],ys,landings,ground)
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
  if landings:tunnel['surfaceLandings']=[[round(a,4),round(b,4)] for a,b in landings]
  for flag in ['capStart','capEnd']:
   if route.get(flag):tunnel[flag]=True
  road={'id':route['id'],'name':route['name'],'kind':'motorway' if is_main else 'motorway_link','points':points,'width':route['width'],'oneway':1,'traffic':False,'elevations':ys,'startLevel':0 if route.get('surfaceStart') else -1,'endLevel':0 if route.get('surfaceEnd') else -1,'tunnel':tunnel}
  roads.append(road)
  for p,y in zip(points,ys):known[tuple(p)]=(y,road['id'])
  max_grade=max(abs(a-b)/max(.001,math.dist(p,q)) for p,q,a,b in zip(points,points[1:],ys,ys[1:]))
  if max_grade>.13:raise ValueError(f"{road['id']} grade {max_grade:.1%}")
  records.append({'id':road['id'],'sourceFeatureIds':route['featureIds'],'role':route['role'],'lengthMeters':round(length,3),'maxGrade':round(max_grade,4),'joins':joins,'crossedSurfaceStreetIds':surface_crossings,**({'surfaceStreetIds':landing_streets} if landings else {}),**({'surveyJoin':route['surveyJoin']} if 'surveyJoin' in route else {})})
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
