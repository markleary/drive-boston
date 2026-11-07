"""Stepped far-distance massing for sprawling complexes (far.bin fragments).

A complex such as the Prudential Center or Logan's terminals is one survey mesh
whose convex hull spans streets, plazas and aprons, so build-metro.py hides its
far.bin entry (flag bit 2) and build-far-massing.py writes these fragments right
after it (flag bit 3, the primary's other flags repeated); the far city and the
map draw them until the complex's tile streams in. The far city draws every
entry as a box from the ground to its height over the entry's minimum-area
rectangle, so each fragment is a rectangle the complex actually stands on:

- road corridors (half the roadway width each side of every centerline: the
  measured `pavedWidth`, or the class width where no curb was measured) are cut
  from the complex's ground plan first, since a box standing on the ground would
  wall the street off; a wing bridging a street (Tufts Medical Center over
  Washington Street, BUMC over Massachusetts Avenue) leaves the far massing there;
- walkways and other parts narrower than 2 * NARROW are dropped, which splits
  the plan into wings;
- each wing's roof height field is sampled on a CELL grid aligned with the wing's
  dominant wall direction;
- each height band (FLOOR, then 10/25/50/75% of the complex height, skipping a
  band within half again of the one below) is covered by greedy largest
  rectangles down to MIN_AREA, each as tall as the 75th percentile of its cells
  capped at the next band, the top band as tall as its highest cell.
"""
from __future__ import annotations
import json, math, struct
import numpy as np
import shapely
from shapely.geometry import LineString
from shapely.strtree import STRtree

CELL = 3.0
FLOOR = 3.0
MIN_AREA = 150.0
NARROW = 3.0
BANDS = (.1, .25, .5, .75)


class Corridors:
 """Road corridors to keep clear of far boxes: half the roadway width (`pavedWidth ?? width`, as the runtime's street furniture and traffic use) each side of every centerline.
 Traces over a drivable survey mesh (`surveyDeck`, the Zakim viaduct) are not roadways of their own and are left out."""
 def __init__(self, roads):
  self.shapes = [LineString([p[:2] for p in r['points']]).buffer((r.get('pavedWidth') or r['width']) / 2, cap_style='flat') for r in roads if len(r['points']) >= 2 and not r.get('surveyDeck')]
  self.tree = STRtree(self.shapes)

 def near(self, geometry):
  hits = self.tree.query(geometry)
  return shapely.union_all([self.shapes[int(i)] for i in sorted(hits)]) if len(hits) else None


def dominant_angle(polygon):
 """Wall direction, modulo 90 degrees, carrying the most outline length: the peak of a 1 degree
 histogram smoothed over 5 bins, refined to the length-weighted mean direction of the edges within 3 degrees of it."""
 d = np.concatenate([np.diff(np.asarray(ring.coords), axis=0) for ring in [polygon.exterior, *polygon.interiors]])
 angle = np.degrees(np.arctan2(d[:, 1], d[:, 0])) % 90; length = np.hypot(d[:, 0], d[:, 1]); hist = np.zeros(90)
 np.add.at(hist, np.floor(angle).astype(int) % 90, length); peak = int(np.argmax(sum(np.roll(hist, k) for k in range(-2, 3)))) + .5
 near = np.abs((angle - peak + 45) % 90 - 45) <= 3; turn = np.radians(angle[near] * 4)
 return math.atan2(float(np.sum(length[near] * np.sin(turn))), float(np.sum(length[near] * np.cos(turn)))) / 4


def opened(mask):
 """Morphological opening by a 3 x 3 square: drops parts at most two cells wide, keeps rectangles whole."""
 rows, cols = mask.shape; padded = np.pad(mask, 1); eroded = np.ones_like(mask)
 for i in range(3):
  for j in range(3):eroded &= padded[i:i + rows, j:j + cols]
 padded = np.pad(eroded, 1); grown = np.zeros_like(mask)
 for i in range(3):
  for j in range(3):grown |= padded[i:i + rows, j:j + cols]
 return grown & mask


def largest_rect(mask):
 """(cells, i0, i1, j0, j1) of the largest all-true rectangle, by the histogram stack method per row."""
 rows, cols = mask.shape; h = np.zeros(cols, dtype=np.int64); best = (0, 0, 0, 0, 0)
 for i in range(rows):
  h = (h + 1) * mask[i]
  if not h.any():continue
  stack = []
  for j, cur in enumerate([*h.tolist(), 0]):
   start = j
   while stack and stack[-1][1] >= cur:
    s, hh = stack.pop()
    if hh * (j - s) > best[0]:best = (hh * (j - s), i - hh + 1, i + 1, s, j)
    start = s
   stack.append((start, cur))
 return best


def fragments(vertices, faces, base, height, corridors=None):
 """Rectangular far boxes for a complex mesh: [{'footprint': [[x, z] x4], 'height': h}], heights above `base`."""
 v = np.asarray(vertices, dtype=np.float64).reshape(-1, 3); f = np.asarray(faces, dtype=np.int64).reshape(-1, 3); tri = v[f]
 xz = tri[:, :, [0, 2]]; e1 = xz[:, 1] - xz[:, 0]; e2 = xz[:, 2] - xz[:, 0]; cross = e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]
 keep = np.abs(cross) > .02; tri, xz, cross = tri[keep], xz[keep], cross[keep]
 if not len(tri):return []
 polygons = shapely.polygons(xz); tree = STRtree(polygons)
 levels = [FLOOR]
 for band in BANDS:
  if band * height >= 1.5 * levels[-1]:levels.append(band * height)
 # Close hairline gaps between triangles, cut the streets, then drop walkways and slivers.
 region = shapely.union_all(shapely.buffer(polygons[tri[:, :, 1].max(1) - base >= FLOOR], .5, join_style='mitre')).buffer(-.5, join_style='mitre')
 streets = corridors.near(region) if corridors is not None and not region.is_empty else None
 if streets is not None:region = region.difference(streets)
 region = region.buffer(-NARROW, join_style='mitre').buffer(NARROW, join_style='mitre')
 out = []
 for wing in getattr(region, 'geoms', [region]):
  if wing.geom_type != 'Polygon' or wing.area < MIN_AREA:continue
  a = dominant_angle(wing.simplify(1.0)); ux, uz = math.cos(a), math.sin(a)
  ring = np.asarray(wing.exterior.coords); u = ring @ [ux, uz]; w = ring @ [-uz, ux]; u0, w0 = u.min(), w.min()
  nu, nw = int(math.ceil((u.max() - u0) / CELL)), int(math.ceil((w.max() - w0) / CELL))
  gu, gw = np.meshgrid(u0 + (np.arange(nu) + .5) * CELL, w0 + (np.arange(nw) + .5) * CELL, indexing='ij')
  gx, gz = (gu * ux - gw * uz).ravel(), (gu * uz + gw * ux).ravel()
  cells = np.flatnonzero(shapely.contains_xy(wing, gx, gz))
  # Highest surface over each cell centre, interpolated on every triangle covering it.
  pi, ti = tree.query(shapely.points(gx[cells], gz[cells]), predicate='intersects')
  t = xz[ti]; d = np.stack([gx[cells][pi], gz[cells][pi]], 1) - t[:, 0]
  b1 = (d[:, 0] * (t[:, 2, 1] - t[:, 0, 1]) - d[:, 1] * (t[:, 2, 0] - t[:, 0, 0])) / cross[ti]
  b2 = (d[:, 1] * (t[:, 1, 0] - t[:, 0, 0]) - d[:, 0] * (t[:, 1, 1] - t[:, 0, 1])) / cross[ti]
  y = tri[ti, 0, 1] + b1 * (tri[ti, 1, 1] - tri[ti, 0, 1]) + b2 * (tri[ti, 2, 1] - tri[ti, 0, 1]) - base
  top = np.zeros(len(cells)); np.maximum.at(top, pi, y); grid = np.zeros(nu * nw); grid[cells] = top; grid = grid.reshape(nu, nw)
  for n, level in enumerate(levels):
   last = n + 1 == len(levels); cap = height if last else levels[n + 1]; mask = opened(grid >= level)
   while True:
    area, i0, i1, j0, j1 = largest_rect(mask)
    if area * CELL * CELL < MIN_AREA:break
    mask[i0:i1, j0:j1] = False; inside = grid[i0:i1, j0:j1]; inside = inside[inside >= level]
    h = min(height, float(inside.max())) if last else min(cap, max(level, float(np.percentile(inside, 75))))
    corners = [(u0 + i * CELL, w0 + j * CELL) for i, j in ((i0, j0), (i1, j0), (i1, j1), (i0, j1))]
    out.append({'footprint': [[round(p * ux - q * uz, 3), round(p * uz + q * ux, 3)] for p, q in corners], 'height': round(h, 2)})
 return out


def read_far(raw):
 """(header, records): DBF2 header JSON and each tile's entry records (bytes) in file order."""
 length = struct.unpack_from('<I', raw, 4)[0]; header = json.loads(raw[8:8 + length]); body = 8 + length; body += (-body) % 4; records = {}
 for entry in header['tiles']:
  offset = body + entry['offset']; out = records[entry['key']] = []
  for _ in range(entry['count']):
   end = offset + 8 + struct.unpack_from('<H', raw, offset)[0] * 4; out.append(raw[offset:end]); offset = end
 return header, records


def encode(parts, primary, ox, oz):
 """Fragment records for a hidden primary record: its base, style and flags plus bit 3, points in decimetres from the tile origin."""
 _, _, base, flags, style = struct.unpack_from('<HHhBB', primary, 0); out = bytearray()
 for part in parts:
  points = part['footprint']; out += struct.pack('<HHhBB', len(points), min(65535, int(round(part['height'] * 100))), base, flags | 8, style)
  for x, z in points:out += struct.pack('<hh', int(round((x - ox) * 10)), int(round((z - oz) * 10)))
 return bytes(out)


def rewrite(raw, massing):
 """far.bin bytes with every hidden primary followed by massing(tile key, primary ordinal) and previous fragments dropped."""
 header, records = read_far(raw); size = header['size']; body = bytearray(); directory = []
 for entry in header['tiles']:
  key = entry['key']; tx, tz = map(int, key.split('_')); start = len(body); count = 0; ordinal = -1
  for record in records[key]:
   if record[6] & 8:continue
   ordinal += 1; body += record; count += 1
   if record[6] & 4:
    parts = massing(key, ordinal); body += encode(parts, record, tx * size, tz * size); count += len(parts)
  directory.append({'key': key, 'offset': start, 'count': count})
 head = json.dumps({'size': size, 'tiles': directory}, separators=(',', ':')).encode(); out = b'DBF2' + struct.pack('<I', len(head)) + head
 return out + b'\0' * ((-len(out)) % 4) + bytes(body)


def shell_massing(building, corridors):
 """Fragments for a tile building read by tileformat.read_tile; none for a structure (the Zakim), which has no far box at all."""
 if building.get('structure'):return []
 return fragments(building['positions'], np.concatenate([building['facade'], building['roof']]), building['baseElevation'], building['height'], corridors)
