#!/usr/bin/env python3
"""Restore complete, source-backed water crossings and their short stair joins.

The original park-area clip omitted spans outside park polygons and discarded
connections shorter than 3 m. Keep the original OSM ways (including their IDs),
and give unbranched connected bridge ways a single bank-to-bank arch profile.
The curated source contains existing generic water crossings that do not cross
road decks; surveyed highway footbridges retain their separate stored profiles.
"""
import argparse
import json
import re
from collections import defaultdict
from pathlib import Path
from pyproj import Transformer

ROOT=Path(__file__).resolve().parents[1]

def compile_paths(source,origin):
    transform=Transformer.from_crs(4326,2249,always_xy=True)
    paths=[]
    for way in source['ways']:
        points=[]
        for p in way['geometry']:
            x,y=transform.transform(p['lon'],p['lat'])
            points.append([round((x-731100-origin['xFeet'])*1200/3937,3),round((2902900+origin['yFeet']-y)*1200/3937,3)])
        tags=way['tags']
        paths.append(dict(id=f"osm-way-{way['id']}-0",points=points,width=max(1,min(8,float(re.match(r'[\d.]+',str(tags.get('width',2.6))).group(0)))),bridge=True,kind=tags['highway'],name=tags.get('name','')))
    ends=defaultdict(list)
    for i,p in enumerate(paths):
        for end in (p['points'][0],p['points'][-1]):ends[tuple(end)].append(i)
    visited=set()
    for i in range(len(paths)):
        if i in visited:continue
        component=set();pending=[i]
        while pending:
            j=pending.pop()
            if j in component:continue
            component.add(j)
            for end in (paths[j]['points'][0],paths[j]['points'][-1]):pending.extend(ends[tuple(end)])
        visited.update(component)
        endpoints={tuple(end) for j in component for end in (paths[j]['points'][0],paths[j]['points'][-1])}
        terminals=sorted(p for p in endpoints if len(ends[p])==1)
        # Never choose a route through a fork or turn a loop into an arch.
        if len(terminals)!=2 or any(len(ends[p])>2 for p in endpoints):continue
        current=terminals[0];used=set();profile=[]
        while len(used)<len(component):
            j=next(j for j in ends[current] if j not in used);used.add(j)
            points=paths[j]['points']
            if tuple(points[0])!=current:points=list(reversed(points))
            profile.extend(points if not profile else points[1:]);current=tuple(points[-1])
        for j in component:paths[j]['bridgePoints']=profile
    return {'paths':paths}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');args=parser.parse_args()
    source=json.loads((ROOT/'public/data/water-paths-source.json').read_text());city=json.loads((ROOT/'public/data/city.json').read_text())
    result=compile_paths(source,city['origin']);encoded=json.dumps(result,separators=(',',':'))+'\n';out=ROOT/'src/data/water-paths.json'
    if args.check:
        if out.read_text()!=encoded:raise SystemExit('Water crossing profiles need regeneration')
    else:out.write_text(encoded)
    print(f"{len(result['paths'])} complete source ways with shared crossing profiles")
if __name__=='__main__':main()
