#!/usr/bin/env python3
"""Validate generated waterfront topology against the shipped hydro survey.

Run with .venv-data/bin/python scripts/validate-waterfront.py.
The 2 mm spatial tolerance permits the generator's millimetre quantization;
it does not permit approximated shorelines, overlapping lawns or missing paving.
"""
import json
import math
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union


ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT / 'src/data/waterfront.json').read_text())
city = json.loads((ROOT / 'public/data/city.json').read_text())
errors = []


def check(condition, message):
    if not condition:
        errors.append(message)


def polygon(rings, label):
    shape = Polygon(rings[0], rings[1:])
    check(shape.is_valid and not shape.is_empty, f'{label}: invalid polygon')
    return shape


water = unary_union([Polygon(item['rings'][0], item['rings'][1:]).buffer(0)
                     for item in city['water']])
water_interior = water.buffer(-.002)
water_envelope = water.buffer(.002)
shore_envelope = water.boundary.buffer(.01)
quay_count = 0
sites = []
ids = set()
for site in data['sites']:
    name = site['id']
    check(name not in ids, f'{name}: duplicate site id')
    ids.add(name)
    land = polygon(site['rings'], name)
    lawn_parts = [polygon(rings, f'{name} lawn {i}')
                  for i, rings in enumerate(site.get('lawns', []))]
    paved_parts = [polygon(rings, f'{name} paving {i}')
                   for i, rings in enumerate(site['paving'])]
    if not land.is_valid or any(not part.is_valid for part in lawn_parts + paved_parts):
        continue
    lawns = unary_union(lawn_parts)
    paving = unary_union(paved_parts)
    check(lawns.intersection(paving).area < .001,
          f'{name}: overlapping lawn and pavement')
    check(land.symmetric_difference(lawns.union(paving)).area < .001,
          f'{name}: lawns and paving do not partition the full site')
    check(land.intersection(water_interior).area < .001,
          f'{name}: surface extends into surveyed water')
    for previous_name, previous in sites:
        check(land.intersection(previous.buffer(-.002)).area < .001,
              f'{name}: overlaps {previous_name}')
    sites.append((name, land))
    for quay in site['quays']:
        quay_count += 1
        line = LineString(quay)
        check(line.difference(shore_envelope).length < .001,
              f'{name}: quay follows an artificial site edge')
        for a, b in zip(quay, quay[1:]):
            length = math.dist(a, b)
            check(length > 0, f'{name}: zero-length quay edge')
            if length == 0:
                continue
            mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            nx, nz = -(b[1] - a[1]) * .3 / length, (b[0] - a[0]) * .3 / length
            check(land.contains(Point(mx + nx, mz + nz)) or
                  land.contains(Point(mx - nx, mz - nz)),
                  f'{name}: quay has no landward side for its wall/furniture')

# Pier 1's outer hardstand was formerly cut off by the Navy Yard selector,
# leaving an unpaved grass wedge and no quay at the true tip.
navy_parts = [shape for name, shape in sites if name.startswith('charlestown-navy-yard')]
check(unary_union(navy_parts).contains(Point(1660, -2430)),
      'Navy Yard Pier 1: outer hardstand is missing')
navy_quays = unary_union([LineString(quay) for site in data['sites']
                         if site['id'].startswith('charlestown-navy-yard')
                         for quay in site['quays']])
check(navy_quays.distance(Point(1661.907, -2418.4305)) < .01,
      'Navy Yard Pier 1: tip lacks its source-aligned quay')
shipyard_park = next((site for site in data['sites']
                     if site['id'] == 'charlestown-shipyard-park'), None)
check(shipyard_park is not None and shipyard_park['kind'] == 'park',
      'Shipyard Park: real landscape was absorbed by naval hardstand')
if shipyard_park:
    check(sum(Polygon(rings[0], rings[1:]).area
              for rings in shipyard_park.get('lawns', [])) > 10000,
          'Shipyard Park: mapped park must retain substantial interior lawns')

for dock in data['dryDocks']:
    basin = polygon(dock['rings'], dock['id'])
    check(LineString(dock['mouth']).difference(basin.boundary.buffer(.01)).length < .001,
          f"{dock['id']}: mouth is not on basin boundary")

for i, rings in enumerate(data['waterCuts']):
    cut = polygon(rings, f'water cut {i}')
    if cut.is_valid:
        check(cut.difference(water_envelope).area < .001,
              f'water cut {i}: terrain subtraction extends onto surveyed land')

if errors:
    raise SystemExit('\n'.join(errors))
print(f"Waterfront geometry valid: {len(sites)} surface parts, {quay_count} quays, "
      f"{len(data['dryDocks'])} dry docks, {len(data['waterCuts'])} water cuts; "
      'paving/lawns partition each site without overlap.')
