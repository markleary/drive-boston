#!/usr/bin/env python3
"""Retain horizontal basin/reach surfaces inside the merged metro hydro outline.

Run after grade-terrain.mjs and restore-water-crossings.py. Requires the same
cached Boston GIS layer 12 and Python dependencies as build-metro.py. Only
city.json changes; surveyed outlines, terrain, roads and tiles are preserved.
Levels are robust DEM estimates, not surveyed water gauges or dam elevations.
"""
from __future__ import annotations
import argparse, gzip, heapq, importlib.util, json, math, pathlib
from collections import defaultdict
import numpy as np
import shapely
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('city_compiler',ROOT/'scripts/build-city.py')
city_compiler=importlib.util.module_from_spec(spec);spec.loader.exec_module(city_compiler)
parts=city_compiler.polygon_parts

def samples(poly,grid,heights,inset=6):
    inner=poly.buffer(-inset)
    if inner.is_empty:inner=poly
    x0,z0,x1,z1=inner.bounds;step=max(6,math.sqrt(max(1,inner.area)/16000))
    xs,zs=np.meshgrid(np.arange(x0+step/2,x1,step),np.arange(z0+step/2,z1,step))
    mask=shapely.contains_xy(inner,xs,zs);xs=xs[mask];zs=zs[mask]
    if not len(xs):
        p=poly.representative_point();xs=np.array([p.x]);zs=np.array([p.y])
    ix=np.clip(np.rint((xs-grid['originX'])/grid['cellSize']).astype(int),0,grid['width']-1)
    iz=np.clip(np.rint((zs-grid['originZ'])/grid['cellSize']).astype(int),0,grid['height']-1)
    return heights[iz,ix]

def level(poly,grid,heights,inset=6):
    return round(float(np.quantile(samples(poly,grid,heights,inset),.85)),3)

def river_pools(poly,grid,heights):
    """Broad river pools seed a flood through the mapped channel's narrow necks.

    The upper Neponset source feature includes several pools at different
    heights. Eroding its banks by 12 m separates those pools at constrictions;
    channel-distance propagation assigns the narrow connecting reaches without
    splitting at arbitrary world tiles or drawing sloping water triangles.
    """
    seeds=sorted([(level(p,grid,heights,0),p) for p in parts(poly.buffer(-12)) if p.area>=500],key=lambda p:p[0])
    groups=[]
    for height,seed in seeds:
        if groups and height-groups[-1][0][0]<=.75:groups[-1].append((height,seed))
        else:groups.append([(height,seed)])
    if len(groups)<2:return [(poly,level(poly,grid,heights))]
    levels=[max(h for h,_ in group) for group in groups]
    regions=[unary_union([p for _,p in group]) for group in groups]
    cell=6;x0,z0,x1,z1=poly.bounds;x0=math.floor(x0/cell)*cell;z0=math.floor(z0/cell)*cell
    width=math.ceil((x1-x0)/cell);height=math.ceil((z1-z0)/cell)
    xs,zs=np.meshgrid(x0+np.arange(width)*cell,z0+np.arange(height)*cell)
    cells=shapely.box(xs,zs,xs+cell,zs+cell)
    wet=shapely.intersects(poly,cells);labels=np.full(wet.shape,-1,dtype=np.int16);distance=np.full(wet.shape,np.inf);queue=[]
    for label,seed in enumerate(regions):
        for z,x in np.argwhere(wet&shapely.contains_xy(seed,xs+cell/2,zs+cell/2)):
            labels[z,x]=label;distance[z,x]=0;heapq.heappush(queue,(0,label,int(z),int(x)))
    while queue:
        d,label,z,x=heapq.heappop(queue)
        if d!=distance[z,x] or label!=labels[z,x]:continue
        for dx,dz in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]:
            nx=x+dx;nz=z+dz
            if nx<0 or nx>=width or nz<0 or nz>=height or not wet[nz,nx]:continue
            nd=d+math.hypot(dx,dz)
            if nd<distance[nz,nx]:
                labels[nz,nx]=label;distance[nz,nx]=nd;heapq.heappush(queue,(nd,label,nz,nx))
    result=[]
    for label,height in enumerate(levels):
        region=unary_union(cells[labels==label]).intersection(poly)
        result.extend((p,height) for p in parts(region) if p.area>.01)
    # Tiny disconnected source fragments have no broad seed; retain a plane.
    remainder=poly.difference(unary_union([p for p,_ in result]))
    result.extend((p,level(p,grid,heights)) for p in parts(remainder) if p.area>.01)
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source-dir',type=pathlib.Path,default=ROOT/'data-source-cache');parser.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');args=parser.parse_args()
    file=args.data_dir/'city.json';city=json.loads(file.read_text());grid=city['elevation']
    heights=np.frombuffer(gzip.decompress((args.data_dir/grid['file']).read_bytes()),dtype='<i2').reshape(grid['height'],grid['width'])*(grid.get('scale',.01))
    # This union is intentionally kept for map/road/vegetation coverage. Recover
    # only its level boundaries, using the original named Boston hydro features.
    water=max(city['water'],key=lambda w:Polygon(w['rings'][0],w['rings'][1:]).area)
    whole=shapely.set_precision(Polygon(water['rings'][0],water['rings'][1:]),.001);remaining=whole;basins=[]
    records=city_compiler.context_polygons(args.source_dir,12,'NAME',whole.envelope,'water')
    for source in records:
        name=source['name'].strip()
        if not name or name in ['Water','Hydro']:continue
        polygon=shapely.set_precision(Polygon(source['rings'][0],source['rings'][1:]),.001).intersection(remaining)
        if polygon.is_empty or polygon.area<100:continue
        for part in parts(polygon):
            pools=river_pools(part,grid,heights) if source['id']=='water-23087-0-0' else [(part,level(part,grid,heights))]
            for pool,height in pools:basins.append((source['id'],name,height,shapely.set_precision(pool,.001)))
        remaining=remaining.difference(polygon)
    harbour_level=level(remaining,grid,heights)
    grouped=defaultdict(list)
    for source,name,height,polygon in basins:grouped[(source,name,height)].append(polygon)
    for part in parts(remaining):
        if part.area<=.01:continue
        # The union contains additions from other hydro sources. Small leftover
        # strips along an inland river belong to that river, not sea level.
        # Shared shoreline length identifies the adjoining source basin; the
        # large connected coastal remainder alone retains the harbour plane.
        adjacent=max(basins,key=lambda basin:part.boundary.intersection(basin[3].boundary.buffer(.002)).length) if part.area<1e6 else None
        if adjacent and part.boundary.intersection(adjacent[3].boundary.buffer(.002)).length>1:
            grouped[adjacent[:3]].append(part)
        else:grouped[(water['id'],'Tidal harbour',harbour_level)].append(part)
    surfaces=[]
    for (source,name,height),polygons in grouped.items():
        # Precision reduction must happen on complete geometries: rounding
        # independent rings can create crossings and invalid shoreline holes.
        for part in parts(shapely.set_precision(unary_union(polygons),.001)):
            if part.area>.01:surfaces.append({'source':source,'name':name,'level':height,'rings':city_compiler.polygon_rings(part)})
    exported=[Polygon(s['rings'][0],s['rings'][1:]) for s in surfaces]
    assert all(p.is_valid for p in exported),'invalid exported water polygon'
    joined=unary_union(exported)
    assert joined.symmetric_difference(whole).area<max(1,whole.area*1e-6),'surface partition changed hydro coverage'
    assert abs(sum(p.area for p in exported)-joined.area)<1,'overlapping water surfaces'
    water['surfaces']=surfaces
    file.write_text(json.dumps(city,separators=(',',':'))+'\n')
    print(json.dumps({'water':water['id'],'surfaces':len(surfaces),'harbourLevel':harbour_level,'levels':sorted(set(s['level'] for s in surfaces)),'neponset':[(s['level'],len(s['rings'][0])) for s in surfaces if s['source']=='water-23087-0-0']},indent=2))

if __name__=='__main__':main()
