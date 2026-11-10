#!/usr/bin/env python3
"""Compile the Boston Common tree inventory and Frog Pond's mapped perimeter."""
import argparse
import json
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import Point, Polygon
from shapely.geometry.polygon import orient

ROOT = Path(__file__).resolve().parents[1]
projection = Transformer.from_crs(4326, 2249, always_xy=True)


def silhouette(species):
    words = set(species.lower().replace(',', '').split())
    for names, model in [
        (('elm', 'zelkova'), 'elm'),
        (('oak',), 'red oak'),
        (('locust', 'pagoda'), 'honey locust'),
        (('ginkgo',), 'ginkgo'),
        (('pine', 'cedar', 'spruce', 'fir'), 'white pine'),
    ]:
        if words.intersection(names):
            return model
    return 'maple'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('trees', type=Path, help='BPRD Trees query results in GeoJSON')
    parser.add_argument('paths', type=Path, help='Cached osm-metro-paths.json')
    args = parser.parse_args()
    city = json.loads((ROOT / 'public/data/city.json').read_text())

    def xy(lon, lat):
        x, y = projection.transform(lon, lat)
        origin = city['origin']
        return (
            round((x - 731100 - origin['xFeet']) * 1200 / 3937, 3),
            round((2902900 + origin['yFeet'] - y) * 1200 / 3937, 3),
        )

    common = next(park for park in city['parks'] if park['name'] == 'Boston Common')
    park = Polygon(common['rings'][0], common['rings'][1:])
    features = json.loads(args.trees.read_text())['features']
    trees = []
    for feature in sorted(features, key=lambda item: item['properties']['id']):
        props = feature['properties']
        if props['park'] != 'Boston Common' or not feature['geometry']:
            continue
        x, z = xy(*feature['geometry']['coordinates'])
        dbh = float(props['dbh'] or 0)
        if dbh > 0 and park.contains(Point(x, z)):
            scale = round(.53 + .47 * min(1, dbh / 34), 2)
            trees.append([x, z, silhouette(props['spp_com'] or ''), scale])

    ways = json.loads(args.paths.read_text())['elements']
    path = next(way for way in ways if way['type'] == 'way' and way['id'] == 23787089)
    perimeter = Polygon([xy(point['lon'], point['lat']) for point in path['geometry']])

    def inset_ring(distance):
        inset = perimeter.buffer(-distance).simplify(.12, preserve_topology=True)
        return [[round(x, 3), round(z, 3)] for x, z in orient(inset, sign=-1).exterior.coords[:-1]]

    # Overlap the inside of the 2 m walkway slightly to close small edge gaps.
    data = {'trees': trees, 'basin': inset_ring(3), 'apron': inset_ring(.75)}
    encoded = ',\n'.join(
        f'  "{key}": [\n' + ',\n'.join('    ' + json.dumps(row) for row in rows) + '\n  ]'
        for key, rows in data.items()
    )
    (ROOT / 'src/data/boston-common.json').write_text('{\n' + encoded + '\n}\n')


if __name__ == '__main__':
    main()
