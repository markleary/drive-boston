"""Close the exposed underside where a generated pitched roof spans a recessed wall.

Both the assessor-shaped and simple OSM roofs fit rectangular roof parts to the
actual wall outline. At the eave, the flat deck covers that outline, while the
painted soffits cover the roof's small eave and rake overhangs. A setback can
leave a patch between the two through which the sky is visible from the street.
"""
import argparse
import pathlib

import numpy as np
import shapely

import tileformat


def close_roof_soffits(record, eave):
 """Add only missing downward faces to a packed mesh. Eave is relative to its anchor, in metres."""
 positions, facade, roof, scale = record
 level = round(eave / scale)
 if not len(roof) or positions[:, 1].max() <= level:
  return record
 triangles = positions[roof].astype(np.int64)
 heights = triangles[:, :, 1]
 xz = triangles[:, :, (0, 2)]
 ab, ac = xz[:, 1] - xz[:, 0], xz[:, 2] - xz[:, 0]
 up = ab[:, 1] * ac[:, 0] - ab[:, 0] * ac[:, 1]
 pitches = (up > 0) & (heights.max(axis=1) > level)
 deck = (up > 0) & (heights == level).all(axis=1)
 if not pitches.any() or not deck.any():
  return record
 # Use the same integer lattice as the shipped vertices. Roof parts can
 # overlap and the floor can be concave or have holes, so use actual triangles.
 def projection(mask):
  return shapely.union_all(shapely.polygons(xz[mask]), grid_size=1)
 existing_caps = (up < 0) & (heights == level).all(axis=1)
 cover = projection(pitches)
 exposed = shapely.difference(cover, projection(deck | ((up < 0) & ~existing_caps)), grid_size=1)
 patches = [p for p in shapely.get_parts(exposed) if p.geom_type == 'Polygon' and not p.buffer(-.5).is_empty]
 if not patches:
  return record
 # Long diagonal edges snap independently at their ends. Overlap the adjacent
 # wall or sloping trim by two quantization steps so their join has no
 # pinholes. The clip keeps the underside within the actual roof perimeter.
 grown = [p.buffer(2, join_style='mitre', mitre_limit=2) for p in patches]
 exposed = shapely.intersection(shapely.union_all(grown, grid_size=1), cover, grid_size=1)
 new_positions, new_faces = [], []
 lookup = {tuple(p): i for i, p in enumerate(positions)}
 present = {tuple(sorted(f)) for f in roof[existing_caps]}
 for part in shapely.get_parts(exposed):
  if part.geom_type != 'Polygon':
   continue
  for triangle in shapely.constrained_delaunay_triangles(part).geoms:
   ring = shapely.orient_polygons(triangle).exterior  # CCW in XZ faces down.
   face = []
   for x, z in list(ring.coords)[:3]:
    vertex = (int(x), level, int(z))
    if vertex not in lookup:
     lookup[vertex] = len(positions) + len(new_positions)
     new_positions.append(vertex)
    face.append(lookup[vertex])
   if tuple(sorted(face)) not in present:
    new_faces.append(face)
 if not new_faces:
  return record
 if new_positions:
  positions = np.concatenate([positions, np.asarray(new_positions, dtype=positions.dtype)])
 return positions, facade, np.concatenate([roof, np.asarray(new_faces, dtype=roof.dtype)]), scale


def repair_tile(path):
 header, buildings = tileformat.read_tile(path)
 records, repaired, triangles = [], 0, 0
 for b in buildings:
  scale = b.get('scale', tileformat.SCALE)
  anchor = np.asarray(b['anchor'])
  positions = np.rint((b['positions'] - anchor) / scale).astype(np.int16)
  record = (positions, b['facade'], b['roof'], scale)
  if b.get('source') == 'osm-extrusion' and 'eaveHeight' in b:
   record = close_roof_soffits(record, b['baseElevation'] + b['eaveHeight'] - anchor[1])
   added = len(record[2]) - len(b['roof'])
   repaired += int(added > 0)
   triangles += added
  records.append(record)
 if repaired:
  tileformat.write_tile(path, header, records)
 return repaired, triangles


if __name__ == '__main__':
 parser = argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--data-dir', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1] / 'public/data')
 args = parser.parse_args()
 houses = faces = tiles = 0
 for path in sorted((args.data_dir / 'tiles').glob('*.bin')):
  repaired, added = repair_tile(path)
  houses += repaired
  faces += added
  tiles += int(repaired > 0)
 print(f'{houses} roofs closed with {faces} soffit triangles in {tiles} tiles')
