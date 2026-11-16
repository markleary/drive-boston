#!/usr/bin/env python3
"""Recover Castle Island detail from the shipped survey, without network inputs.

Run after build-water-surfaces.py. Keeps hydro coverage, roads and tiles intact;
partitions the enclosed Pleasure Bay water level and writes the detail sidecar.
Heights/detail treatments are visual interpretations; see docs/castle-island.md.
"""
import argparse
import gzip
import json
from pathlib import Path
import numpy as np
from shapely.geometry import Polygon, box, LineString
from shapely import set_precision
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from tileformat import read_tile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--data-dir', type=Path, default=ROOT/'public/data')
parser.add_argument('--output', type=Path, default=ROOT/'src/data/castle-island.json', help='Detail sidecar destination')
args = parser.parse_args()
FILE = args.data_dir / 'city.json'
city = json.loads(FILE.read_text())

def parts(geometry, kind='Polygon'):
    if geometry.is_empty: return []
    if geometry.geom_type == kind: return [geometry]
    return [p for g in getattr(geometry, 'geoms', []) for p in parts(g, kind)]

def ring(coords): return [[round(x, 3), round(z, 3)] for x, z in list(coords)[:-1]]
def rings(p):
    p = orient(p, 1)
    return [ring(p.exterior.coords), *[ring(h.coords) for h in p.interiors]]

park = next(p for p in city['parks'] if p['id'] == 'park-235-0-0')
land = Polygon(park['rings'][0], park['rings'][1:])
water = next(w for w in city['water'] if w['id'] == 'water-merged-55')
hydro = Polygon(water['rings'][0], water['rings'][1:])
# The open-space survey retains the closed lagoon even though the hydro union
# merged it into the harbor through the causeway's narrow water-control openings.
bay = set_precision(Polygon(park['rings'][1]).intersection(hydro), .001)
grid = city['elevation']
heights = np.frombuffer(gzip.decompress((args.data_dir/grid['file']).read_bytes()), dtype='<i2').reshape(grid['height'],grid['width']) * grid.get('scale', .01)
# Broad interior, away from beaches and causeway interpolation: the modal DEM
# plateau is the enclosed basin's level, not the lower tidal harbor's plane.
values = []
for x in range(4550, 4951, 30):
    for z in range(1450, 1951, 30):
        i = round((x-grid['originX'])/grid['cellSize']); j = round((z-grid['originZ'])/grid['cellSize'])
        values.append(heights[j,i])
level = round(float(np.median(values)), 3)
old = water['surfaces']; surfaces = []
for surface in old:
    p = set_precision(Polygon(surface['rings'][0], surface['rings'][1:]), .001)
    if surface.get('source') == 'castle-island-pleasure-bay': continue
    if p.intersection(bay).area < .0001: surfaces.append(surface); continue
    surfaces.extend({**surface, 'rings': rings(q)} for q in parts(p.difference(bay)) if q.area > .001)
surfaces.extend({'source':'castle-island-pleasure-bay','name':'Pleasure Bay','level':level,'rings':rings(p)} for p in parts(bay))
assert unary_union([Polygon(s['rings'][0],s['rings'][1:]) for s in surfaces]).symmetric_difference(hydro).area < 1
water['surfaces'] = surfaces

_, buildings = read_tile(args.data_dir/'tiles/t_5_1.bin')
fort = next(b for b in buildings if b.get('landmark') == 'fort-independence')
v = fort['positions']
footprint = unary_union([Polygon([(v[k][0],v[k][2]) for k in face]) for face in fort['roof']]).simplify(.06, preserve_topology=True)
assert footprint.geom_type == 'Polygon' and len(footprint.interiors) == 1
# Trim inconsequential sub-metre survey notches on the inner casemate facade.
court = Polygon(footprint.interiors[0]).simplify(1.6, preserve_topology=True)
wall = Polygon(footprint.exterior.coords, [court.exterior.coords])
# Sand follows the lagoon's mapped north/west bank. Walking paths and roads
# retain their own higher draped layers; no sand crosses onto the carriageway.
beach = bay.buffer(21).difference(bay).intersection(land).intersection(box(4250,1250,5005,1910))
# Low stone sea defenses on the harbor face and Head Island causeway.
coast = hydro.boundary.intersection(land.buffer(30)).intersection(box(4900,1150,5420,2170))
coast_lines = [l for l in parts(coast,'LineString') if l.length > 8]
# Only remove the water's interior terrain, retaining a 4 m sloping bank.
# The bay plane now lies above the remaining DEM plateau, so no grass survives.
shore_water = hydro.intersection(land.buffer(35)).intersection(box(4900,1150,5440,2170)).difference(bay)
cuts = [rings(p) for p in parts(unary_union([bay.buffer(-4), shore_water]))]
data = {'source':'Boston GIS Castle Island park/hydro and DBT2 fort survey; see docs/castle-island.md',
        'fort':{'id':fort['id'],'tile':'5_1','first':fort['footprint'][0], 'rings':rings(wall),'court':rings(court)[0]},
        'bay':{'level':level,'rings':[rings(p) for p in parts(bay)]},'waterCuts':cuts,
        'beach':[rings(p) for p in parts(beach)],
        'coast':[[[round(x,3),round(z,3)] for x,z in line.coords] for line in coast_lines]}
FILE.write_text(json.dumps(city,separators=(',',':'))+'\n')
args.output.write_text(json.dumps(data,separators=(',',':'))+'\n')
print(json.dumps({'bayArea':round(bay.area),'bayLevel':level,'fortArea':round(wall.area),'courtArea':round(court.area),'coastSegments':len(coast_lines),'beachArea':round(beach.area)},indent=2))
