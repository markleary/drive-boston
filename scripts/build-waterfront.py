#!/usr/bin/env python3
"""Compile waterfront finish masks against the shipped Boston hydro survey.

The hand-selected masks below identify sites, not replacement coastlines. Every
water-facing edge comes from city.json, and every surface excludes that water.
Heights, furniture and lawn subdivisions are visual approximations, not a survey.
Run with the project's .venv-data/bin/python (Shapely + pyproj).
"""
import json
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import Polygon, LineString, Point, box
from shapely.ops import unary_union, linemerge
from shapely import set_precision

ROOT = Path(__file__).resolve().parents[1]
CITY = json.loads((ROOT / 'public/data/city.json').read_text())
PROJECT = Transformer.from_crs(4326, 2249, always_xy=True)


def xy(lon, lat):
    x, y = PROJECT.transform(lon, lat)
    return ((x - 731100 - CITY['origin']['xFeet']) * 1200 / 3937,
            (2902900 + CITY['origin']['yFeet'] - y) * 1200 / 3937)


def polygons(shape):
    if shape.is_empty:
        return []
    if shape.geom_type == 'Polygon':
        return [shape]
    return [p for g in shape.geoms for p in polygons(g)] if hasattr(shape, 'geoms') else []


def lines(shape):
    if shape.is_empty:
        return []
    if shape.geom_type in ('LineString', 'LinearRing'):
        return [shape]
    return [p for g in shape.geoms for p in lines(g)] if hasattr(shape, 'geoms') else []


def ring(coords):
    return [[round(x, 3), round(z, 3)] for x, z in list(coords)[:-1]]


def rings(poly):
    return [ring(poly.exterior.coords), *[ring(r.coords) for r in poly.interiors]]


water = unary_union([Polygon(p['rings'][0], p['rings'][1:]).buffer(0) for p in CITY['water']])
boundary = water.boundary
parks = {p['name']: Polygon(p['rings'][0], p['rings'][1:]).buffer(0) for p in CITY['parks']}
specs = []


def site(id, name, kind, mask, coast_only=False):
    if coast_only:
        # Industrial selectors extend only 85 m inland from the actual quay.
        mask = mask.intersection(boundary.buffer(85))
    specs.append((id, name, kind, mask))


def mapped(id, name, kind, source):
    site(id, name, kind, parks[source])


# Downtown / North End. Landward cuts stop short of Atlantic/Commercial Street.
site('battery-wharf', 'Battery Wharf', 'promenade', Polygon([(1930,-1995),(2095,-1995),(2110,-1840),(1980,-1840),(1930,-1900)]))
site('burroughs-wharf', 'Burroughs Wharf', 'promenade', box(1965,-1840,2135,-1745))
site('union-wharf', 'Union Wharf', 'promenade', box(1955,-1745,2140,-1645))
site('sargents-wharf', "Sargent's Wharf", 'parking', Polygon([(1950,-1645),(2160,-1645),(2160,-1510),(1950,-1560)]))
site('lewis-wharf', 'Lewis Wharf', 'promenade', Polygon([(1950,-1560),(2160,-1510),(2190,-1510),(2200,-1380),(1970,-1380)]))
site('commercial-wharf', 'Commercial Wharf', 'promenade', Polygon([(1950,-1390),(2225,-1390),(2225,-1250),(1975,-1320)]))
mapped('long-wharf', 'Long Wharf', 'promenade', 'Long Wharf')
site('central-wharf', 'Central Wharf / Aquarium', 'promenade', box(1975,-1065,2200,-950))
mapped('india-wharf', 'India Wharf Harborwalk', 'promenade', 'India Wharf Harborwalk')
mapped('rowes-wharf', 'Rowes Wharf', 'promenade', "Rowe's Wharf Harborwalk")
mapped('independence-wharf', 'Independence Wharf', 'promenade', 'Independence Wharf Harborwalk')
mapped('tufts-wharf', 'Tufts Wharf', 'promenade', 'Tufts Wharf Harborwalk')
mapped('russia-wharf', 'Russia Wharf', 'promenade', 'Russia Wharf Harborwalk')
mapped('childrens-wharf', "Children's Wharf", 'promenade', "Children's Wharf Harborwalk")
site('coast-guard-base', 'Coast Guard Base Boston wharves', 'working', Polygon([(1680,-2185),(2040,-2185),(2050,-1980),(1940,-1910),(1810,-2010),(1690,-1990)]))

# Seaport. Working piers remain hardstand; only the genuine park has lawn beds.
mapped('fan-pier-park', 'Fan Pier Park', 'park', 'Fan Pier Plaza')
mapped('fan-pier-harborwalk', 'Fan Pier Harborwalk', 'promenade', 'Fan Pier Harborwalk')
mapped('ica-pier-walk', 'ICA Pier Walk', 'promenade', 'ICA Pier Walk')
site('pier-4-tip-park', 'Pier 4 waterfront park', 'park', Polygon([(2690,-382),(2735,-470),(2805,-430),(2762,-345)]))
site('pier-4', 'Pier 4', 'promenade', Polygon([(2580,-110),(2720,-480),(2820,-420),(2680,-45)]))
site('commonwealth-pier', 'Commonwealth Pier', 'promenade', Polygon([(2640,-35),(2840,-410),(3010,-320),(2810,50)]))
site('fish-pier', 'Boston Fish Pier', 'working', Polygon([(2840,75),(3050,-310),(3180,-240),(2980,145)]))
site('pier-5', 'Pier 5 / working maritime apron', 'working', Polygon([(3000,125),(3200,-125),(3395,-10),(3235,250)]))
site('black-falcon', 'Black Falcon Cruise Terminal', 'working', box(3500,530,4500,835), True)
site('boston-marine-industrial-piers', 'Raymond L. Flynn Marine Park piers', 'working', Polygon([(3260,-160),(3450,-140),(3590,50),(4020,235),(4300,330),(4460,340),(4480,700),(4050,780),(3600,820),(3280,650)]), True)
site('conley-terminal', 'Paul W. Conley Container Terminal', 'working', Polygon([(3710,905),(5010,865),(5040,1175),(3920,1190),(3710,1050)]))

# East Boston. Original Piers Park uses the survey; the 2023 phase-II shore
# rectangle is a site estimate, cropped to existing land and phase-I ownership.
site('piers-park', 'Piers Park', 'park', parks['East Boston Piers Park'].union(Polygon([(2990,-1430),(3120,-1650),(3200,-1580),(3090,-1360)])))
site('piers-park-ii', 'Piers Park II', 'park', Polygon([(2865,-1880),(3067,-1764),(3050,-1645),(2960,-1645),(2845,-1725)]).difference(parks['East Boston Piers Park']))
site('piers-park-iii-existing', 'Piers Park III site / existing pier', 'working', Polygon([(2960,-1680),(3080,-1650),(2975,-1430),(2860,-1490)]))
site('east-pier-1', 'East Boston Pier 1 / East Pier Drive hardstand', 'parking', Polygon([(2710,-1820),(2890,-1730),(2910,-1660),(2815,-1500),(2680,-1600)]))
mapped('lopresti-park', 'LoPresti Park', 'park', 'LoPresti Park')
site('clippership-wharf', 'Clippership Wharf', 'promenade', Polygon([(2440,-2150),(2640,-2130),(2670,-2050),(2560,-1885),(2460,-1945)]))
site('lewis-mall', 'Lewis Mall / East Boston Pier 1', 'promenade', Polygon([(2570,-1970),(2740,-1890),(2790,-1810),(2660,-1700),(2560,-1770)]))
site('boston-harbor-shipyard', 'Boston Harbor Shipyard and Marina', 'working', Polygon([(3190,-1590),(3510,-1570),(3560,-1370),(3500,-1150),(3340,-1150),(3190,-1280)]))
site('east-boston-industrial-wharves', 'East Boston working wharves', 'working', box(2325,-3560,2850,-2310), True)

# Charlestown Navy Yard aprons and museum piers; small landscaped grounds keep
# their survey planting. The Constitution and Cassin Young ships are not modeled.
mapped('charlestown-shipyard-park', 'Charlestown Naval Shipyard Park', 'park', 'Charlestown Naval Shipyard Park I')
naval = Polygon([(1320,-2450),(1410,-2595),(1510,-2740),(1650,-2640),(1785,-2790),(1990,-2580),(2050,-2540),(2020,-2330),(1630,-2450),(1540,-2370),(1390,-2390)])
# Pier 1's full hardstand tip projects south of the yard's diagonal selector.
# This local addition reaches the hydro corners without selecting adjacent piers.
# NPS's Pier 1 plan identifies pedestrian walks and parking, not a lawn park.
naval = naval.union(box(1600, -2470, 1705, -2390))
naval = naval.difference(unary_union([Polygon(p['rings'][0],p['rings'][1:]) for p in CITY['parks'] if p['name']=='Navy Yard Grounds']))
site('charlestown-navy-yard', 'Charlestown Navy Yard piers and dry docks', 'naval', naval)
site('constitution-wharf', 'Constitution Wharf', 'promenade', Polygon([(1160,-2390),(1325,-2460),(1470,-2380),(1280,-2290)]))
site('charlestown-pier-6', 'Charlestown Pier 6', 'promenade', Polygon([(1840,-3020),(2050,-2850),(2040,-2720),(1920,-2780)]))
site('charlestown-pier-8', 'Charlestown Pier 8', 'promenade', box(1940,-3370,2240,-3220))
site('charlestown-pier-7', 'Charlestown Pier 7 / Shipyard Quarters', 'promenade', box(1930,-3220,2260,-3005))
site('charlestown-industrial', 'Charlestown industrial wharves', 'working', box(780,-3950,2220,-3490), True)

# Chelsea has industrial bulk-terminal quays rather than landscaped lawns.
# Keep DCR's Admiral's Hill park and living/soft shoreline away from these masks.
site('chelsea-south-wharves', 'Chelsea / Marginal Street working wharves', 'working', Polygon([(2420,-4255),(4160,-4240),(4160,-3770),(3800,-3770),(3400,-3880),(2900,-3930),(2700,-3900),(2420,-3950)]), True)
site('east-boston-chelsea-creek', 'East Boston / Chelsea Creek working wharves', 'working', Polygon([(2800,-3880),(3200,-3890),(3450,-3900),(3950,-3760),(4200,-3900),(4250,-3650),(2800,-3550)]), True)
site('chelsea-creek-terminals', 'Chelsea Creek bulk terminals', 'working', Polygon([(4120,-4210),(4490,-4750),(4800,-5400),(5100,-5400),(5100,-4100),(4370,-3850)]), True)


def park_paths():
    path_file = ROOT / 'data-source-cache/osm-metro-paths.json'
    if not path_file.exists():
        return []
    interest = unary_union([mask.buffer(2) for _, _, kind, mask in specs if kind == 'park'])
    result = []
    for feature in json.loads(path_file.read_text())['elements']:
        tag = feature.get('tags', {})
        if tag.get('highway') not in ('footway', 'path', 'pedestrian', 'cycleway', 'steps') or tag.get('bridge'):
            continue
        points = [xy(p['lon'], p['lat']) for p in feature.get('geometry', [])]
        if len(points) < 2:
            continue
        path = LineString(points)
        if path.intersects(interest):
            try:
                width = float(tag.get('width', '3').split()[0])
            except ValueError:
                width = 3
            result.append(path.buffer(max(1.8, min(6, width / 2 + .8))))
    return result


path_clearance = unary_union(park_paths())
sites = []
occupied = Polygon()
for id, name, kind, mask in specs:
    # Earlier specific sites own overlaps with later broad industrial selectors.
    land = set_precision(mask.difference(water).difference(occupied).buffer(0), .001)
    for n, poly in enumerate(sorted(polygons(land), key=lambda p: -p.area)):
        if poly.area < 15:
            continue
        shoreline = boundary.intersection(poly.buffer(.005)).intersection(mask)
        if id == 'conley-terminal':
            # Berth 10's new slab supersedes the survey's old Coastal Oil indent.
            # Keep its now-internal former shoreline out of the generic seawalls.
            qx,qz=3710.48,909.17
            dx,dz=4998.557-qx,873.007-qz
            length=(dx*dx+dz*dz)**.5
            tx,tz=dx/length,dz/length
            extension=Polygon([(qx+tx*a-tz*b,qz+tz*a+tx*b) for a,b in [(0,0),(391.62,0),(391.62,78),(0,78)]])
            shoreline=shoreline.difference(extension.buffer(.5))
        if id == 'clippership-wharf':
            # The current development includes a living shoreline. The older
            # hydro outline is inadequate to identify a modern vertical quay.
            shoreline=LineString()
        quay_lines = lines(shoreline)
        if len(quay_lines) > 1:
            quay_lines = lines(linemerge(quay_lines))
        quays = []
        for line in quay_lines:
            # Rounding and neighboring selectors can produce shoreline slivers
            # thinner than a railing. Only retain segments with actual land on
            # one side, so inward normals never point into water.
            for a,b in zip(line.coords,list(line.coords)[1:]):
                dx,dz=b[0]-a[0],b[1]-a[1]
                length=(dx*dx+dz*dz)**.5
                if length<1: continue
                mx,mz=(a[0]+b[0])/2,(a[1]+b[1])/2
                nx,nz=-dz/length*.3,dx/length*.3
                if not (poly.contains(Point(mx+nx,mz+nz)) or poly.contains(Point(mx-nx,mz-nz))): continue
                quays.append([[round(x,3),round(z,3)] for x,z in (a,b)])
        if len(quays)>1:
            quays=[[[round(x,3),round(z,3)] for x,z in line.coords] for line in lines(linemerge([LineString(q) for q in quays]))]
        entry = dict(id=id if n==0 else f'{id}-{n}', name=name, kind=kind, rings=rings(poly), quays=quays)
        if kind == 'park':
            lawns = poly.buffer(-7).difference(path_clearance)
            # New phase II and unsurveyed park lawns get cross-paths so one lawn
            # never consumes the complete recreation area.
            if id in ('piers-park-ii', 'fan-pier-park'):
                cx, cz = poly.centroid.coords[0]
                lawns = lawns.difference(LineString([(cx-250,cz),(cx+250,cz)]).buffer(2.3))
            entry['lawns'] = [rings(q) for p in polygons(lawns) if p.area > 25 for q in polygons(set_precision(p.simplify(.15),.001))]
        lawn_union=unary_union([Polygon(r[0],r[1:]) for r in entry.get('lawns',[])])
        entry['paving']=[rings(p) for p in polygons(set_precision(poly.difference(lawn_union),.001)) if p.area>.1]
        sites.append(entry)
    occupied = occupied.union(land)

# Named dry-dock source geometry is retained separately for stepped basins.
dry_docks = []
for feature in json.loads((ROOT/'data-source-cache/osm-metro-water.json').read_text())['elements']:
    if feature.get('tags',{}).get('name') == 'Dry Dock 1':
        poly=Polygon([xy(p['lon'],p['lat']) for p in feature['geometry']])
        outline=rings(poly)
        dry_docks.append(dict(id='navy-dry-dock-1',name='Charlestown Navy Yard Dry Dock 1',rings=outline,mouth=outline[0][:2],source='OpenStreetMap way 226524669'))
# Dock 2 is part of the merged hydro basin. Its selector ends at the mouth and
# retains all hydro vertices inside; no ship or dock machinery is inferred.
dock2_mask=Polygon([(1590,-2730),(1665,-2770),(1800,-2555),(1745,-2510)])
for p in polygons(water.intersection(dock2_mask)):
    if p.area > 300:
        mouth=p.boundary.intersection(LineString([(1800,-2555),(1745,-2510)]).buffer(.001))
        candidates=[line for line in lines(mouth) if line.length>1]
        mouth_points=[]
        if candidates:
            edge=max(candidates,key=lambda line:line.length)
            mouth_points=[[round(x,3),round(z,3)] for x,z in [edge.coords[0],edge.coords[-1]]]
        dry_docks.append(dict(id='navy-dry-dock-2',name='Charlestown Navy Yard Dry Dock 2',rings=rings(p),mouth=mouth_points,source='Boston hydro survey; perpendicular mouth cut estimated'))

# Harbor DEM samples can stay above the water plane tens of metres offshore.
# These are wet-side cuts only: land, pier surfaces and roadway approaches stay
# intact. Match water-pavement.ts's ground-road ribbon (width + 6.1 m total).
quay_neighborhood=unary_union([LineString(q).buffer(100,quad_segs=3) for s in sites for q in s['quays']])
wet_near_quays=water.intersection(quay_neighborhood)
road_clearance=[]
for road in CITY['roads']:
    if road.get('elevations') or len(road['points'])<2:
        continue
    points=road['points']
    if not LineString(points).buffer(road['width']/2+4).intersects(wet_near_quays):
        continue
    edges=[]
    for i,p in enumerate(points):
        override=road.get('deckTangents',{}).get('start' if i==0 else 'end') if i in (0,len(points)-1) else None
        a,b=points[max(0,i-1)],points[min(len(points)-1,i+1)]
        dx,dz=override if override else (b[0]-a[0],b[1]-a[1])
        length=(dx*dx+dz*dz)**.5 or 1
        widths=road.get('deckWidths')
        half=((widths[i] if widths else road['width'])+6.1)/2
        edges.append([(p[0]-dz/length*half*side,p[1]+dx/length*half*side) for side in (-1,1)])
    road_clearance.extend(Polygon([a[0],a[1],b[1],b[0]]).buffer(0) for a,b in zip(edges,edges[1:]))
wet_near_quays=wet_near_quays.difference(unary_union(road_clearance))
water_cuts=[rings(p) for p in polygons(set_precision(wet_near_quays,.001)) if p.area>.01]

output = dict(version=1, source='Boston GIS hydro/open-space polygons in public/data/city.json; cached OSM footpaths and Dry Dock 1',
              method='Manually selected site extents clipped to the existing hydro; exact source shoreline quays. Landscape insets and site boundary cuts are visual estimates. See docs/waterfront-research.md.',
              sites=sites, dryDocks=dry_docks, waterCuts=water_cuts)
(ROOT/'src/data/waterfront.json').write_text(json.dumps(output,separators=(',',':'))+'\n')
print(f'{len(sites)} waterfront surface parts; {sum(len(s["quays"]) for s in sites)} quay lines; {len(dry_docks)} dry docks')
print(f'{len(water_cuts)} wet-only terrain cuts; {sum(len(r) for p in water_cuts for r in p)} cut vertices')
