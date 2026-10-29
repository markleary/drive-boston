"""Find convex building proxies that cross streets, and audit their source shells.

A 2D overlap is enough to select exact collision, but is NOT evidence that a
building is elevated. The independent 3D audit sweeps car- and bus-height strips
along the street, including lateral probes, so vertical walls cannot disappear
between point/raycast samples. Unknown source obstructions are reported, never
carved or raised automatically.
"""
from __future__ import annotations
import argparse, gzip, json, math, pathlib
from collections import Counter
import numpy as np
from shapely.geometry import LineString, MultiPoint, Polygon
from shapely.strtree import STRtree

# One metre of genuine interior overlap catches narrow links while excluding
# numerical boundary contacts between a facade and its street centerline.
MIN_OVERLAP = 1.0
CAR_HEIGHT = 1.8
BUS_HEIGHT = 4.3


class RoadClearanceIndex:
 def __init__(self, roads):
  self.roads = [r for r in roads if not r.get('elevations') and len(r['points']) >= 2]
  self.lines = [LineString(r['points']) for r in self.roads]
  self.tree = STRtree(self.lines)

 def overlaps(self, building):
  if building.get('structure') or len(building.get('footprint', [])) < 3:return []
  polygon = Polygon(building['footprint']).buffer(0).buffer(-.05)
  if polygon.is_empty:return []
  return sorted((self.roads[int(i)] for i in self.tree.query(polygon, predicate='intersects')
                 if self.lines[int(i)].intersection(polygon).length >= MIN_OVERLAP), key=lambda r:r['id'])

 def mark(self, buildings):
  selected = pairs = 0
  for building in buildings:
   # Re-running after a road edit must not retain an obsolete generated flag.
   if 'roadOverlaps' in building:
    building.pop('roadOverlaps')
    if building.get('collision') == 'mesh':building.pop('collision')
   roads = self.overlaps(building)
   if not roads:continue
   building['collision'] = 'mesh'
   building['roadOverlaps'] = [r['id'] for r in roads]
   selected += 1;pairs += len(roads)
  return {'buildings': selected, 'roadOverlaps': pairs}


def mark_road_overlaps(buildings, roads):
 """Mutate only collision metadata; source geometry and footprints are preserved."""
 return RoadClearanceIndex(roads).mark(buildings)


def _clip_height(vertices, height, keep_above):
 """Clip a 3D polygon to a horizontal half-space, preserving vertical faces."""
 out=[]
 if not len(vertices):return out
 previous=vertices[-1];previous_inside=(previous[1]>=height) if keep_above else (previous[1]<=height)
 for current in vertices:
  inside=(current[1]>=height) if keep_above else (current[1]<=height)
  if inside != previous_inside:
   t=(height-previous[1])/(current[1]-previous[1]);out.append(previous+(current-previous)*t)
  if inside:out.append(current)
  previous=current;previous_inside=inside
 return out


def _projection(vertices):
 return MultiPoint([(float(p[0]),float(p[2])) for p in vertices]).convex_hull


def audit_building_clearance(building, positions, faces, roads, elevation):
 """Audit source triangles against continuous sweeps over the overlapping roads.

 `elevation(x,z)` must sample the SAME graded surface as the runtime. Results are
 detection candidates, not a claim that every street is surveyed accurately.
 This does not include decorative objects, generated footings, or moving actors.
 """
 positions=np.asarray(positions,dtype=float);faces=np.asarray(faces,dtype=int).reshape(-1,3)
 triangles=positions[faces]
 projections=[_projection(t) for t in triangles]
 tree=STRtree(projections)
 minimum=triangles[:,:,1].min(axis=1);maximum=triangles[:,:,1].max(axis=1)
 footprint=Polygon(building['footprint']).buffer(0)
 results=[]
 for road in sorted(roads,key=lambda r:r['id']):
  if road.get('elevations'):continue
  width=road['width'];half=max(0,width/2-.8)
  # Adjacent 1.6 m strips cover the pavement with no unsampled lateral gap.
  offsets=np.linspace(-half,half,max(1,math.ceil(2*half/1.6)+1))
  car=bus=checked=0;projected=False;examples=[]
  for a,b in zip(road['points'],road['points'][1:]):
   a=np.asarray(a,dtype=float);b=np.asarray(b,dtype=float);delta=b-a;length=float(np.linalg.norm(delta))
   if length<.01:continue
   normal=np.array([-delta[1],delta[0]])/length
   count=max(1,math.ceil(length/3))
   for step in range(count):
    start=a+delta*(step/count);end=a+delta*((step+1)/count)
    if not LineString([start,end]).buffer(width/2).intersects(footprint):continue
    for offset in offsets:
     p=start+normal*offset;q=end+normal*offset
     strip=LineString([p,q]).buffer(.8,cap_style=2)
     candidates=tree.query(strip,predicate='intersects')
     ground0=elevation(float(p[0]),float(p[1]));ground1=elevation(float(q[0]),float(q[1]))
     floor=min(ground0,ground1)+.2;car_top=max(ground0,ground1)+CAR_HEIGHT;bus_top=max(ground0,ground1)+BUS_HEIGHT
     blocked_car=blocked_bus=False;checked+=1
     for candidate in candidates:
      i=int(candidate)
      if maximum[i]<floor:continue
      projected=True
      if minimum[i]>bus_top:continue
      above=_clip_height(triangles[i],floor,True)
      for height in [car_top,bus_top]:
       clipped=_clip_height(above,height,False)
       if clipped and _projection(clipped).intersects(strip):
        if height==car_top:blocked_car=True
        else:blocked_bus=True
      if blocked_car and blocked_bus:break
     car+=blocked_car;bus+=blocked_bus
     if (blocked_car or blocked_bus) and len(examples)<8:
      mid=(p+q)/2;examples.append({'x':round(float(mid[0]),2),'z':round(float(mid[1]),2),'lateralOffset':round(float(offset),2),'car':blocked_car,'bus':blocked_bus})
  results.append({'roadId':road['id'],'name':road['name'],
                  'classification':'source-obstruction' if bus else 'overhead' if projected else 'open-hull',
                  'carBlockedSweeps':car,'busBlockedSweeps':bus,'checkedSweeps':checked,'examples':examples})
 return {'id':building['id'],'name':building.get('name',''),'district':building.get('district',''),'center':building['center'],'roads':results}


def audit_package(data_dir):
 """Read-only city-wide audit. Exact collision selection is recomputed from roads."""
 import tileformat
 data_dir=pathlib.Path(data_dir);city=json.loads((data_dir/'city.json').read_text());index=RoadClearanceIndex(city['roads']);grid=city['elevation']
 values=np.frombuffer(gzip.decompress((data_dir/grid['file']).read_bytes()),dtype='<i2').astype(float)*grid.get('scale',.01)
 def elevation(x,z):
  w,h=grid['width'],grid['height'];fx=max(0,min(w-1,(x-grid['originX'])/grid['cellSize']));fz=max(0,min(h-1,(z-grid['originZ'])/grid['cellSize']))
  i=min(w-2,int(fx));j=min(h-2,int(fz));tx=fx-i;tz=fz-j;k=j*w+i;a,b,c,d=values[k],values[k+1],values[k+w],values[k+w+1]
  return a+(b-a)*tx+(c-a)*tz if tx+tz<=1 else d+(c-d)*(1-tx)+(b-d)*(1-tz)
 findings=[];counts=Counter();total=0
 for path in sorted((data_dir/city['tiles']['directory']).glob('*.bin')):
  _,buildings=tileformat.read_tile(path)
  for building in buildings:
   total+=1;roads=index.overlaps(building)
   if not roads:continue
   report=audit_building_clearance(building,building['positions'],np.concatenate([building['facade'],building['roof']]),roads,elevation)
   findings.append(report)
   counts.update(r['classification'] for r in report['roads'])
 return {'buildingCount':total,'selectedBuildings':len(findings),'roadClassifications':dict(sorted(counts.items())),
         'method':{'minimumInteriorOverlap':MIN_OVERLAP,'carHeight':CAR_HEIGHT,'busHeight':BUS_HEIGHT,'longitudinalStepMaximum':3,'lateralStripWidth':1.6},'findings':findings}


if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--data-dir',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parents[1]/'public/data')
 parser.add_argument('--report',type=pathlib.Path,required=True)
 args=parser.parse_args();report=audit_package(args.data_dir);args.report.write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({k:v for k,v in report.items() if k!='findings'}))
