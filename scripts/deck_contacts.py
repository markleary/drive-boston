"""Pavement where a retained embankment intersects an elevated road's deck.

Intersect the actual deck triangles with the DEM triangles, then clip by their
height difference. The ground collider already supports the vehicle here; this
gives that surface pavement without painting the ground beneath a bridge.
"""
import gzip,math
import numpy as np
from shapely.geometry import Polygon
from shapely.ops import unary_union


def deck_sections(road):
 points=road['points'];out=[]
 for i,p in enumerate(points):
  a=points[max(0,i-1)];b=points[min(len(points)-1,i+1)]
  tangent=road.get('deckTangents',{}).get('start' if i==0 else 'end' if i==len(points)-1 else '') or [b[0]-a[0],b[1]-a[1]]
  length=math.hypot(*tangent) or 1;width=(road.get('deckWidths') or [road['width']]*len(points))[i]
  ys=(road.get('deckEdgeElevations') or [[y,y] for y in road['elevations']])[i]
  out.append([[p[0]-tangent[1]/length*width/2*side,p[1]+tangent[0]/length*width/2*side,ys[j]] for j,side in enumerate((-1,1))])
 return out


def plane(points):
 a,b,c=np.asarray(points);dx=b[0]-a[0];dz=b[1]-a[1];ex=c[0]-a[0];ez=c[1]-a[1];det=dx*ez-ex*dz
 if abs(det)<1e-9:return None
 gx=((b[2]-a[2])*ez-(c[2]-a[2])*dz)/det;gz=(dx*(c[2]-a[2])-ex*(b[2]-a[2]))/det
 return lambda x,z:float(a[2]+gx*(x-a[0])+gz*(z-a[1]))


def contact_polygons(roads,grid,heights):
 width=grid['width'];height=grid['height'];cell=grid['cellSize'];ox=grid['originX'];oz=grid['originZ'];out=[];ids=[]
 for road in roads:
  if not road.get('elevations') or road.get('tunnel'):continue
  sections=deck_sections(road);pieces=[]
  for first,second in zip(sections,sections[1:]):
   corners=first+second
   for indices in ((0,1,2),(1,3,2)):
    triangle=[corners[k] for k in indices];deck=plane(triangle)
    if deck is None:continue
    footprint=Polygon([p[:2] for p in triangle]);x0,z0,x1,z1=footprint.bounds
    for iz in range(max(0,math.floor((z0-oz)/cell)),min(height-2,math.floor((z1-oz)/cell))+1):
     for ix in range(max(0,math.floor((x0-ox)/cell)),min(width-2,math.floor((x1-ox)/cell))+1):
      x=ox+ix*cell;z=oz+iz*cell;k=iz*width+ix
      dem=[[x,z,heights[k]],[x+cell,z,heights[k+1]],[x,z+cell,heights[k+width]],[x+cell,z+cell,heights[k+width+1]]]
      if max(p[2] for p in dem)<min(p[2] for p in triangle)-.005:continue
      for face in ((0,1,2),(1,3,2)):
       terrain=[dem[j] for j in face];ground=plane(terrain);hit=footprint.intersection(Polygon([p[:2] for p in terrain]))
       if hit.geom_type!='Polygon' or hit.area<1e-8:continue
       # At the contact boundary ground+.03 sits above deck+.025. A 5 mm
       # overlap closes rounding cracks without an asphalt skirt below decks.
       points=list(hit.exterior.coords)[:-1];clipped=[];a=points[-1];da=ground(*a)-deck(*a)+.005
       for b in points:
        db=ground(*b)-deck(*b)+.005
        if (da>=0)!=(db>=0):
         t=da/(da-db);clipped.append([a[j]+(b[j]-a[j])*t for j in (0,1)])
        if db>=0:clipped.append(b)
        a=b;da=db
       if len(clipped)>=3:
        polygon=Polygon(clipped)
        if polygon.area>1e-6:pieces.append(polygon)
  if pieces:out.append(unary_union(pieces));ids.append(road['id'])
 return out,ids


def packaged_contacts(city,data_dir):
 if not any(r.get('elevations') and not r.get('tunnel') for r in city['roads']):return [],[]
 grid=city['elevation'];heights=np.frombuffer(gzip.decompress((data_dir/grid['file']).read_bytes()),dtype='<i2')*grid.get('scale',.01)
 return contact_polygons(city['roads'],grid,heights)
