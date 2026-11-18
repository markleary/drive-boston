"""Project the park's OSM detail into game metres. See DATA_SOURCES.md."""
import json
import math
import pathlib
import sys
import xml.etree.ElementTree as ET

from pyproj import Transformer
from shapely import LineString, Polygon, union_all, set_precision

from parking_lots import tile_polygons
from street_surfaces import polygon_parts, polygon_rings, unpack

ROOT = pathlib.Path(__file__).resolve().parents[1]
data_dir = ROOT / 'public/data'
city = json.loads((data_dir / 'city.json').read_text())
origin = city['origin']
project = Transformer.from_crs(4326, 2249, always_xy=True)
osm = ET.parse(sys.argv[1]).getroot()


def point(node):
    x, y = project.transform(float(node.get('lon')), float(node.get('lat')))
    return [round((x - 731100 - origin['xFeet']) * 1200 / 3937, 2),
            round(-(y - 2902900 - origin['yFeet']) * 1200 / 3937, 2)]


nodes = {int(n.get('id')): point(n) for n in osm.findall('node')}
ways = {int(w.get('id')): [nodes[int(n.get('ref'))] for n in w.findall('nd')]
        for w in osm.findall('way')}
park = Polygon(ways[29860809])
woods = []
for way in [413919808, 416071659]:
    patch = Polygon(ways[way]).intersection(park).simplify(1.0)
    for poly in getattr(patch, 'geoms', [patch]):
        if poly.area > 75:
            woods.append([[[round(x, 2), round(z, 2)] for x, z in list(ring.coords)[:-1]]
                          for ring in [poly.exterior, *poly.interiors]])

# Use the finished curb/sidewalk faces, including the faces on the other side
# of the tile seam. A park boundary often extends all the way into the street.
areas = {a['id']: Polygon(a['rings'][0], a['rings'][1:]) for a in city['parks']
         if a['name'] in ('Fellsmere Park', 'Sylvester Baxter Delta')}
site = union_all(list(areas.values()))
size = city['tiles']['size']
x0, z0, x1, z1 = [math.floor(v / size) for v in site.bounds]
tiles = {(x, z): unpack(data_dir / city['tiles']['directory'] / f't_{x}_{z}.bin')[0]
         for x in range(x0, x1 + 1) for z in range(z0, z1 + 1)}
street_faces = [poly for field in ('streetSidewalks', 'streetPavement', 'islands', 'driveways')
                for poly in tile_polygons(tiles, field) if poly.intersects(site)]
street_faces += [Polygon(w['rings'][0], w['rings'][1:]) for tile in tiles.values()
                 for w in tile.get('sidewalks', [])]
# The two modeled terraces and their approach meet the same lawn edges.
upper_wall = ways[585996042]
first, last = upper_wall[0], upper_wall[-1]
dx, dz = last[0] - first[0], last[1] - first[1]
length = math.hypot(dx, dz)
upper_back = [[round(x + 3.8 * dz / length, 3), round(z - 3.8 * dx / length, 3)]
              for x, z in (first, last)]
lower_apron = []
for i in range(23):
    angle = math.pi * i / 22
    u, v = 5.1 * math.cos(angle), 5.6 * math.sin(angle)
    lower_apron.append([round(-855.2 + u * .72 - v * .694, 3),
                        round(-8757.8 + u * .694 + v * .72, 3)])
paved_edges = union_all([*street_faces, Polygon(upper_wall + upper_back[::-1]),
                         Polygon(lower_apron)], grid_size=.001)
asphalt_ways = {w.get('id') for w in osm.findall('way')
                if w.find("tag[@k='surface'][@v='asphalt']") is not None}

# Dissolve the full-width walks at bends, forks and tile seams before draping
# them. The exact same edges cut the turf and meet the concrete at the streets.
walk_ids = []
asphalt, paving = [], []
for tile in tiles.values():
    for path in tile['parkPaths']:
        if path.get('bridge'):
            continue
        line = LineString(path['points'])
        footprint = line.buffer(path['width'] / 2, quad_segs=4)
        if not footprint.intersects(site):
            continue
        walk_ids.append(path['id'])
        finish = asphalt if path['id'].split('-')[2] in asphalt_ways else paving
        finish.append(footprint)
asphalt = union_all(asphalt, grid_size=.001).difference(paved_edges)
paving = union_all(paving, grid_size=.001).difference(paved_edges).difference(asphalt)
# Millimetre output and world-space Float32 vertices round independently.
# Two millimetres of clearance keep rounded lawn edges off every paving face.
lawn_cut = union_all([paved_edges, asphalt, paving], grid_size=.001).buffer(.002, join_style='mitre')


def faces(shape):
    return [polygon_rings(p, digits=3) for p in polygon_parts(set_precision(shape, .001))]


features = dict(fountains=[nodes[i] for i in [3998261284, 3998261285]],
                flagpoles=[nodes[i] for i in [3998261287, 5599485870, 5599485871]],
                upperWall=upper_wall, upperBack=upper_back, lowerApron=lower_apron,
                pathWalls=[ways[585996041], ways[585996040]],
                woods=woods, lawns={key: faces(area.difference(lawn_cut)) for key, area in areas.items()},
                walks=dict(ids=sorted(walk_ids), asphalt=faces(asphalt), paving=faces(paving)))
(ROOT / 'src/data/fellsmere.json').write_text('{\n' + ',\n'.join(
    '  ' + json.dumps(k) + ': ' + json.dumps(v, separators=(',', ':')) for k, v in features.items()) + '\n}\n')
