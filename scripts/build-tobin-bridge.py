#!/usr/bin/env python3
"""Build the source-mapped Tobin double deck and connected access roads.

Run after offline road grading, restored water crossings and water surfaces.
The source sidecar records every imported OSM way and the estimated profile.
Existing Boston streets, building survey and bridge geometry are preserved.
"""
from __future__ import annotations
import argparse,gzip,hashlib,json,math,pathlib,sys
import numpy as np
from shapely.geometry import LineString,Point,Polygon
from shapely import union_all,set_precision
from harvard_terrain import sample_grid
from road_connections import resample,stations
from road_structure_clearance import crossing_points,road_height
from road_tiles import refresh_road_tiles

ROOT=pathlib.Path(__file__).resolve().parents[1]


def interpolate(controls,s):
 for (a,y),(b,z) in zip(controls,controls[1:]):
  if s<=b:return y+(z-y)*max(0,min(1,(s-a)/(b-a)))
 return controls[-1][1]


def landing(city,point,spec):
 """Use a real graph endpoint rather than a visual-only interior-road join."""
 name=spec['name'];candidates=[(math.dist(point,p),r,p,i) for r in city['roads'] if r['name']==name and not r['id'].startswith('tobin-') and not r.get('elevations') for i,p in [(0,r['points'][0]),(-1,r['points'][-1])]
   if 'roadId' not in spec or (r['id']==spec['roadId'] and i==spec['indexOnStreet'])]
 if not candidates:raise ValueError(f'Missing Tobin street landing: {name}')
 distance,parent,p,index=min(candidates,key=lambda c:c[0])
 if distance>65:raise ValueError(f'Tobin landing too far from {name}: {distance:.1f}m')
 return list(p),parent['id'],round(distance,3)


def road(id,name,points,ys,width,oneway,core=False):
 return {'id':id,'name':name,'kind':'motorway' if core else 'motorway_link','points':points,'width':width,'oneway':oneway,'elevations':ys,'startLevel':1,'endLevel':1,'bridge':{'id':'tobin' if core else 'tobin-approach','thickness':.65,'clearanceEstimated':True,'sourceLayer':2 if id=='tobin-lower' else 3 if id=='tobin-upper' else 1}}


def build(city,source,heights):
 city['roads']=[r for r in city['roads'] if not r['id'].startswith('tobin-')]
 spec=source['core'];points=resample(spec['points']);ss=stations(points);total=ss[-1]
 controls=[[0,spec['lowerStart']],[spec['mainSpan'][0],spec['lowerMain']],[total,spec['lowerMain']]]
 low=[round(interpolate(controls,s),4) for s in ss];upper=[round(y+spec['deckSeparation'],4) for y in low]
 lower=road('tobin-lower','Tobin Bridge · US 1 North',points,low,spec['width'],1,True)
 upper=road('tobin-upper','Tobin Bridge · US 1 South',points,upper,spec['width'],-1,True)
 roads=[lower,upper];core={r['id']:r for r in roads};landings=[]
 for route in source['routes']:
  p=[list(v) for v in route['points']];landing_index=route['landing']['index'];join=route['joins'];parent=core[join['id']]
  p[landing_index],parent_id,distance=landing(city,p[landing_index],route['landing'])
  p[join['index']]=list(parent['points'][join['parentIndex']]);p=resample(p);ds=stations(p);length=ds[-1]
  ground=sample_grid(city['elevation'],heights,p[landing_index]);deck=parent['elevations'][join['parentIndex']]
  y0,y1=(ground,deck) if landing_index==0 else (deck,ground)
  ys=[y0+(y1-y0)*d/length for d in ds]
  # Keep the mapped Boston tunnel alignment playable as an open access deck.
  # The elevated road follows a bounded grade above its shared terrain, rather
  # than silently opening the otherwise omitted deep tunnel system.
  for i,(position,d) in enumerate(zip(p,ds)):
   edge=min(d,length-d);allowance=min(1,edge/25)*.2
   a,b=p[max(0,i-1)],p[min(len(p)-1,i+1)];dx,dz=b[0]-a[0],b[1]-a[1];norm=math.hypot(dx,dz) or 1
   width=parent['width']+(route['width']-parent['width'])*min(1,(d if join['index']==0 else length-d)/80)
   cross_ground=max(sample_grid(city['elevation'],heights,[position[0]-dz/norm*width/2*side,position[1]+dx/norm*width/2*side]) for side in (-1,0,1))
   # The endpoint is a hard existing street datum; its first/last 12 metres
   # inherit that graded landing while the outer deck clears the bare DEM.
   blend=min(1,edge/12)
   ground_center=sample_grid(city['elevation'],heights,position)
   ys[i]=max(ys[i],ground_center+(cross_ground-ground_center)*blend+allowance)
  line=LineString(p)
  for other in city['roads']:
   other_line=LineString(other['points'])
   if not line.intersects(other_line):continue
   for crossing in crossing_points(line.intersection(other_line)):
    d=line.project(crossing)
    if (d if landing_index==0 else length-d)<65:continue
    i=min(range(len(ds)),key=lambda i:abs(ds[i]-d))
    # Retain 5 m under the slab at transverse streets, including buses.
    required=road_height(other,[crossing.x,crossing.y],lambda x,z:sample_grid(city['elevation'],heights,[x,z]))+5.7
    ys[i]=max(ys[i],required)
  for zone in route.get('clearanceZones',[]):
   area=Polygon(zone['footprint']).buffer(parent['width']/2+.6)
   for i,position in enumerate(p):
    if area.covers(Point(position)):ys[i]=max(ys[i],zone['minimumDeckElevation'])
  # A Lipschitz upper envelope smooths DEM noise and bounds each approach grade.
  grade=.06
  for i in range(1,len(ys)):ys[i]=max(ys[i],ys[i-1]-grade*(ds[i]-ds[i-1]))
  for i in range(len(ys)-2,-1,-1):ys[i]=max(ys[i],ys[i+1]-grade*(ds[i+1]-ds[i]))
  # Landings remain exact hard constraints, never a quiet floating connection.
  if abs(ys[0]-y0)>.03 or abs(ys[-1]-y1)>.03:raise ValueError(f"Terrain prevents smooth Tobin approach {route['id']}: endpoints {ys[0]-y0:.3f}, {ys[-1]-y1:.3f}")
  # The centimetre-quantized graded grid may lift that envelope a few
  # millimetres at a hard street anchor. Clip the same slope cone against the
  # exact anchors, instead of resetting only one vertex into a tiny crest.
  ys=[min(y,y0+grade*d,y1+grade*(length-d)) for y,d in zip(ys,ds)]
  ys[0]=y0;ys[-1]=y1
  result=road(route['id'],route['name'],p,[round(y,4) for y in ys],route['width'],1)
  result['startLevel' if landing_index==0 else 'endLevel']=0
  result['deckWidths']=[round(parent['width']+(route['width']-parent['width'])*min(1,(d if join['index']==0 else length-d)/80),5) for d in ds]
  # Use exactly the core's endpoint tangent for a watertight full-width join.
  pi=join['parentIndex'];a,b=(parent['points'][0],parent['points'][1]) if pi==0 else (parent['points'][-2],parent['points'][-1])
  tangent=[b[k]-a[k] for k in (0,1)]
  if (pi==0)==(join['index']==0):tangent=[-v for v in tangent]
  result['deckTangents']={'start' if join['index']==0 else 'end':tangent}
  roads.append(result);landings.append({'road':result['id'],'parentRoad':parent_id,'point':p[landing_index],'sourceSnapMeters':distance})
 city['roads'].extend(roads)
 # The river gap and bridge ramps become valid travel coverage; retain every
 # existing coverage polygon and use a deterministic precision union.
 base=[Polygon(p) for p in city['coverage']]
 corridors=[LineString(r['points']).buffer(r['width']/2+3,cap_style=1) for r in roads]
 coverage=union_all([set_precision(p,.001) for p in base+corridors],grid_size=.001).normalize()
 parts=list(coverage.geoms) if coverage.geom_type=='MultiPolygon' else [coverage]
 city['coverage']=[[[round(x,3),round(z,3)] for x,z in p.exterior.coords[:-1]] for p in parts]
 city['tobinBridge']={'lowerRoadId':lower['id'],'upperRoadId':upper['id'],'mainSpan':spec['mainSpan'],'mainPiers':spec['mainPiers'],'littleSpan':spec['littleSpan']}
 city['landmarks']=[l for l in city['landmarks'] if l['id'] not in ['tobin-bridge','tobin-bridge-southbound']]
 for id,name,r,index in [('tobin-bridge','Tobin Bridge · to Chelsea',lower,12),('tobin-bridge-southbound','Tobin Bridge · to Boston',upper,len(upper['points'])-13)]:
  point=r['points'][index];next=r['points'][index+(1 if r['oneway']==1 else -1)]
  city['landmarks'].append({'id':id,'name':name,'position':list(point),'description':'Green double-deck cantilever bridge over the Mystic River · US 1 '+('North to Chelsea' if r['oneway']==1 else 'South to Charlestown'),'driveStart':{'x':point[0],'z':point[1],'yaw':math.atan2(next[0]-point[0],next[1]-point[1]),'roadId':r['id']}})
 record={'name':'Tobin Bridge OSM alignments and original estimated double-deck profile','url':source['url'],'license':source['license']}
 if not any(s['name']==record['name'] for s in city['sources']):city['sources'].append(record)
 return {'roads':[r['id'] for r in roads],'landings':landings,'coreLengthMeters':round(total,3),'mainSpanMeters':464.82,'navigationSpanMeters':243.84,'littleMysticSpanMeters':133.81,'lowerDeckMeters':spec['lowerMain'],'deckSeparationMeters':spec['deckSeparation'],'sourceWays':[w['id'] for w in source['ways']],'method':source['method']}


def validate(city,source,heights):
 by_id={r['id']:r for r in city['roads']};lower=by_id['tobin-lower'];upper=by_id['tobin-upper']
 assert lower['points']==upper['points'],'Double deck axes diverge'
 assert all(abs(b-a-source['core']['deckSeparation'])<.0002 for a,b in zip(lower['elevations'],upper['elevations'])),'Double deck clearance lost'
 for r in [r for r in city['roads'] if r['id'].startswith('tobin-')]:
  for p,q,a,b in zip(r['points'],r['points'][1:],r['elevations'],r['elevations'][1:]):
   assert abs(b-a)<=math.dist(p,q)*.0601+.0002,f"Tobin grade exceeds 6%: {r['id']}"
  for index in [0,-1]:
   if r['startLevel' if index==0 else 'endLevel']==0:
    assert abs(r['elevations'][index]-sample_grid(city['elevation'],heights,r['points'][index]))<.001,'Tobin street landing floats'
 for route in source['routes']:
  r=by_id[route['id']];j=route['joins'];p=by_id[j['id']]
  assert r['points'][j['index']]==p['points'][j['parentIndex']]
  assert r['elevations'][j['index']]==p['elevations'][j['parentIndex']]


def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');parser.add_argument('--source-file',type=pathlib.Path,default=ROOT/'public/data/tobin-bridge-source.json');args=parser.parse_args()
 path=args.data_dir/'city.json';city=json.loads(path.read_text());source=json.loads(args.source_file.read_text());grid=city['elevation']
 heights=np.frombuffer(gzip.decompress((args.data_dir/grid['file']).read_bytes()),dtype='<i2')*grid.get('scale',.01)
 result=build(city,source,heights);validate(city,source,heights)
 refresh_road_tiles(args.data_dir,city,[r for r in city['roads'] if r['id'].startswith('tobin-')])
 path.write_text(json.dumps(city,separators=(',',':'))+'\n')
 pp=args.data_dir/'provenance.json';provenance=json.loads(pp.read_text());provenance['tobinBridge']={**result,'sourceSHA256':hashlib.sha256(args.source_file.read_bytes()).hexdigest()};provenance['coveragePolygons']=len(city['coverage']);provenance['coverageAreaSquareMeters']=round(sum(Polygon(p).area for p in city['coverage']));provenance['tiles']['count']=len(city['tiles']['keys']);provenance['roads']['tobinBridge']={'source':source['source'],'count':len(result['roads'])};pp.write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 print(json.dumps(result,indent=2))

if __name__=='__main__':main()
