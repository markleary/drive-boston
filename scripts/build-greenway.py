#!/usr/bin/env python3
"""Build the Greenway's static landscape overlay (pyproj + Shapely).

Inputs are cached public OSM map XML and the Conservancy's interactive map HTML.
No runtime map calls. Re-running with identical inputs produces identical JSON.
See DATA_SOURCES.md for URLs, attribution, and interpretation limits.
"""
import argparse, gzip, json, math, pathlib, re, struct, xml.etree.ElementTree as ET
from pyproj import Transformer
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union
from shapely import make_valid, set_precision

ROOT = pathlib.Path(__file__).resolve().parents[1]
PARKS = [
    ('395062915', 'North Meadow', 'meadow'),
    ('94482763', 'North End Parks', 'paving'),
    ('776291660', 'Armenian Heritage Park', 'paving'),
    ('188301033', 'Wharf District Parks', 'paving'),
    ('94482773', 'Urban Arboretum', 'lawn'),
    ('94482756', 'Fort Point Channel Parks', 'lawn'),
    ('94482774', 'Dewey Square', 'paving'),
    ('830838640', 'Chinatown and Mary Soo Hoo Parks', 'paving'),
]
# A bounded interpretation of the Parcel 6 landscaped interior, following the
# surrounding survey curb/street edges. Active road surfaces are subtracted below.
RAMP = [[1339,-1597],[1366,-1588],[1378,-1555],[1449,-1451],[1449,-1441],[1423,-1421],
        [1402,-1425],[1334,-1500],[1332,-1540]]
REPLACED = ['park-308-', 'park-309-', 'park-311-', 'park-315-', 'park-316-']

def polygons(g):
    # Snap topology before serializing, rather than rounding individual vertices
    # into crossing rings at narrow path/bed intersections.
    g=set_precision(make_valid(g),.001)
    if g.is_empty: return []
    if g.geom_type == 'Polygon': return [g]
    if hasattr(g, 'geoms'): return [p for c in g.geoms for p in polygons(c)]
    return []

def rings(p):
    return [[[round(x,3),round(z,3)] for x,z in r.coords[:-1]] for r in [p.exterior,*p.interiors]]

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--osm',type=pathlib.Path,default=ROOT/'data-source-cache/osm-greenway.osm')
    ap.add_argument('--map',type=pathlib.Path,default=ROOT/'data-source-cache/greenway-map.html')
    ap.add_argument('--output',type=pathlib.Path,default=ROOT/'src/data/greenway-detail.json')
    args=ap.parse_args(); city=json.loads((ROOT/'public/data/city.json').read_text())
    transform=Transformer.from_crs(4326,2249,always_xy=True)
    def xy(lon,lat):
        x,y=transform.transform(float(lon),float(lat))
        return [(x-731100-city['origin']['xFeet'])*1200/3937,-(y-2902900-city['origin']['yFeet'])*1200/3937]
    root=ET.parse(args.osm).getroot(); nodes={}; ways={}
    tags=lambda e:{t.attrib['k']:t.attrib['v'] for t in e.findall('tag')}
    for n in root.findall('node'): nodes[n.attrib['id']]={'point':xy(n.attrib['lon'],n.attrib['lat']),'tags':tags(n)}
    for w in root.findall('way'):
        ways[w.attrib['id']]={'points':[nodes[n.attrib['ref']]['point'] for n in w.findall('nd')], 'tags':tags(w),'version':w.attrib.get('version')}
    # Use the installed curb-to-curb pavement, not a nominal road-width buffer.
    paved=[]; measured=set(); buildings=[]; frontages=[]
    # The Cross Street frontage is a brick living street through two brick
    # plaza polygons. Nominal asphalt road ribbons must not bury those faces.
    frontage_way='538645519';frontage_line=LineString(ways[frontage_way]['points'])
    for key in ['1_-2','1_-1','1_0','2_-2','2_-1','2_0']:
        data=gzip.decompress((ROOT/f'public/data/tiles/t_{key}.bin').read_bytes())
        h=json.loads(data[8:8+struct.unpack_from('<I',data,4)[0]]);ox=h['tx']*h['size'];oz=h['tz']*h['size']
        for p in h.get('pavements',[]):
            e=p['edges'];left=[(ox+e[i]/100,oz+e[i+1]/100) for i in range(0,len(e)-3,4)];right=[(ox+e[i+2]/100,oz+e[i+3]/100) for i in range(0,len(e)-3,4)]
            if len(left)>1: paved.append(make_valid(Polygon(left+right[::-1])));measured.add(p['road'])
        buildings.extend(Polygon(b['footprint']) for b in h['buildings'] if len(b['footprint'])>=3 and not b.get('structure'))
        for i,w in enumerate(h.get('sidewalks',[])):
            shape=Polygon(w['rings'][0],w['rings'][1:])
            if w.get('material')=='brick' and shape.intersection(frontage_line).length>4:
                frontages.append({'id':f'cross-street-frontage-{key}-{i}','kind':'brick','tile':key,'rings':w['rings']})
    for r in city['roads']:
        if not r.get('elevations') and r['id'] not in measured and any(1200<x<2050 and -1800<z<100 for x,z in r['points']):
            paved.append(LineString(r['points']).buffer(r['width']/2))
    streets=unary_union(paved).buffer(.65); obstruction=unary_union([streets,*[make_valid(b) for b in buildings]])
    parcels=[];areas=[];used={frontage_way};paths=[];objects=[];walk_lines=[]
    def add_area(id,kind,geometry):
        for i,p in enumerate(polygons(make_valid(geometry))):
            if p.area>.15: areas.append({'id':f'{id}-{i}','kind':kind,'rings':rings(p)})
    for id,name,kind in PARKS:
        used.add(id);shape=make_valid(Polygon(ways[id]['points']))
        # Include the municipal outline where it extends past OSM's older edge.
        ids={'94482763':['park-315-'],'776291660':['park-309-'],'188301033':['park-316-'],
             '94482756':['park-311-0-','park-311-2-'],'94482774':['park-311-1-'],'830838640':['park-308-']}.get(id,[])
        municipal=[Polygon(p['rings'][0],p['rings'][1:]) for p in city['parks'] if any(p['id'].startswith(v) for v in ids)]
        shape=unary_union([shape,*municipal]).difference(obstruction)
        for i,p in enumerate(polygons(shape)):
            if p.area>8: parcels.append({'id':f'{id}-{i}','name':name,'kind':kind,'rings':rings(p)})
    for i,p in enumerate(polygons(Polygon(RAMP).difference(obstruction))):
        if p.area>10: parcels.append({'id':f'parcel-6-{i}','name':'Parcel 6 ramp landscape','kind':'lawn','rings':rings(p)})
    park=unary_union([Polygon(p['rings'][0],p['rings'][1:]) for p in parcels])
    # Paths are clipped polygons so they have exactly one owner at tile seams.
    for id,w in ways.items():
        t=w['tags'];pts=w['points']
        if t.get('highway') not in ['footway','path','pedestrian'] or t.get('footway')=='crossing' or t.get('tunnel') or float(t.get('layer','0'))<0: continue
        line=LineString(pts)
        if line.intersection(park).length<1: continue
        try: width=float(t.get('width','2.6'))
        except ValueError: width=2.6
        width=max(1.2,min(6,width));kind='boardwalk' if t.get('surface')=='wood' else 'path'
        geometry=line.buffer(width/2,cap_style='flat',join_style='round').intersection(park)
        add_area(f'osm-way-{id}',kind,geometry);paths.append(id);used.add(id);walk_lines.append(line)
    path_area=unary_union([Polygon(a['rings'][0],a['rings'][1:]) for a in areas])
    for id,w in ways.items():
        t=w['tags'];pts=w['points']
        if len(pts)<4 or pts[0]!=pts[-1] or id in {p[0] for p in PARKS}:continue
        kind='lawn' if t.get('landuse')=='grass' else 'garden' if t.get('leisure')=='garden' or t.get('landuse')=='flowerbed' else None
        if not kind:continue
        shape=make_valid(Polygon(pts)).intersection(park).difference(path_area)
        if shape.area<1:continue
        add_area(f'osm-way-{id}',kind,shape);used.add(id)
    # The north lawn's surrounding beds are missing from OSM. These approximate
    # bands follow the Conservancy's P8 plan; keep all mapped walking routes.
    for i,pts in enumerate([
        [[1446,-1411],[1452,-1407],[1498,-1370],[1495,-1362],[1442,-1405]],
        [[1453,-1417],[1469,-1433],[1466,-1437],[1449,-1421]],
    ]):add_area(f'interpretation-north-garden-{i}','garden',Polygon(pts).intersection(park).difference(path_area.buffer(.5)))
    # Chinatown's narrow planted islands flank the mapped paths. The visitor
    # plan supplies the landscape character; their precise outlines are estimated.
    for p in parcels:
        if p['name'].startswith('Chinatown'):
            shape=Polygon(p['rings'][0],p['rings'][1:]).buffer(-3).difference(path_area.buffer(1.8))
            for i,bed in enumerate(polygons(shape)):
                if bed.area>30:add_area(f"interpretation-chin-garden-{p['id']}-{i}",'garden',bed)
    # Cut underlying layers away instead of stacking near-coplanar sheets.
    # Paving otherwise bleeds through lawn triangles at shallow camera angles.
    gardens=unary_union([Polygon(a['rings'][0],a['rings'][1:]) for a in areas if a['kind']=='garden'])
    lawns=[a for a in areas if a['kind']=='lawn'];areas=[a for a in areas if a['kind']!='lawn']
    for a in lawns:add_area(a['id'],'lawn',Polygon(a['rings'][0],a['rings'][1:]).difference(gardens))
    details=unary_union([Polygon(a['rings'][0],a['rings'][1:]) for a in areas]);bases=[]
    for parcel in parcels:
        for i,p in enumerate(polygons(Polygon(parcel['rings'][0],parcel['rings'][1:]).difference(details))):
            if p.area>.15:bases.append({'id':f"base-{parcel['id']}-{i}",'kind':parcel['kind'],'rings':rings(p)})
    # Mapped trees and benches, with source locations retained and no random
    # tree scatter in open lawns, fountains, or the labyrinth.
    for id,n in nodes.items():
        t=n['tags'];kind='tree' if t.get('natural')=='tree' else 'bench' if t.get('amenity')=='bench' else None
        if kind and park.contains(Point(n['point'])) and streets.distance(Point(n['point']))>1:
            try: yaw=math.radians(float(t['direction']))
            except KeyError:
                line=min(walk_lines,key=lambda l:l.distance(Point(n['point'])));station=line.project(Point(n['point']))
                a=line.interpolate(max(0,station-.5));b=line.interpolate(min(line.length,station+.5));yaw=math.atan2(-(b.y-a.y),b.x-a.x)
            except ValueError:yaw=0
            objects.append({'id':f'osm-node-{id}','kind':kind,'point':[round(v,3) for v in n['point']],'yaw':round(yaw,4)})
    # Footprints from OSM: these override smaller surface/planting polygons.
    for id,kind in [('832422130','labyrinth'),('1099346360','rings'),('484942338','carousel')]:
        w=ways[id];p=make_valid(Polygon(w['points']));used.add(id)
        objects.append({'id':f'osm-way-{id}','kind':kind,'point':[round(v,3) for v in p.centroid.coords[0]],'rings':rings(p),'radius':round(math.sqrt(p.area/math.pi),3)})
    # Sparse tree rows from the North End plan supplement unmapped tree nodes.
    # Positions are original approximations, identified separately from OSM.
    for row,(a,b) in enumerate([([1481,-1438],[1532,-1397]),([1554,-1377],[1611,-1337]),([1441,-1403],[1490,-1363]),([1532,-1346],[1599,-1304])]):
        length=math.dist(a,b);count=round(length/10)
        for i in range(count+1):
            pos=[a[k]+(b[k]-a[k])*i/count for k in [0,1]]
            if park.contains(Point(pos)) and streets.distance(Point(pos))>2 and all(math.dist(pos,o['point'])>6 for o in objects if o['kind']=='tree'):
                objects.append({'id':f'interpretation-north-tree-{row}-{i}','kind':'tree','point':pos})
    official=json.loads(re.search(r'var oum_all_locations = (\[.*?\]);',args.map.read_text()).group(1))
    highlights={'North Canal Fountain':'canal','South Canal Fountain':'canal','Chinatown Stream':'stream','Armenian Heritage Park: Abstract Sculpture':'sculpture','Harbor Fog by Ross Miller':'fog'}
    for f in official:
        if f['title'] in highlights:
            kind=highlights[f['title']];point=nodes['7243054677']['point'] if kind=='sculpture' else xy(f['lng'],f['lat'])
            obj={'id':f"greenway-map-{f['post_id']}",'kind':kind,'name':f['title'],'point':[round(v,3) for v in point]}
            if kind=='canal':
                north=f['title'].startswith('North');obj['points']=[[1474,-1432],[1520,-1385]] if north else [[1552,-1357],[1599,-1328]]
                obj['pergola']=[[1480,-1437],[1532,-1396]] if north else [[1555,-1376],[1612,-1335]]
            objects.append(obj)
    # Erase only the interior decorative survey curbs. Live road edges have a
    # separate protected collar; the tunnel renderer still owns ramps and walls.
    exclusions=park.buffer(-1).difference(streets.buffer(1.5))
    output={'source':{'osm':'https://api.openstreetmap.org/api/0.6/map?bbox=-71.0628,42.3492,-71.0503,42.3666',
        'attribution':'© OpenStreetMap contributors; ODbL 1.0','license':'https://www.openstreetmap.org/copyright',
        'officialMap':'https://www.rosekennedygreenway.org/map/','accessed':'2026-11-03',
        'osmWays':{id:ways[id]['version'] for id in sorted(used,key=int)},
        'accuracy':'Mapped outlines, paths, tree and bench positions; approximate path widths, Parcel 6 interior, planting, pergolas and landmark models. No source imagery bundled.'},
        'replacedParkPrefixes':REPLACED,'parcels':parcels,'bases':bases,'surfaces':areas,'objects':objects,'frontages':frontages,
        'curbExclusions':[rings(p) for p in polygons(exclusions)],'pathWays':paths}
    args.output.write_text(json.dumps(output,separators=(',',':'))+'\n')
    print(f'{len(parcels)} parcels, {len(areas)} surfaces, {len(objects)} objects; {args.output.stat().st_size:,} bytes')

if __name__=='__main__':main()
