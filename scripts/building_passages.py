"""Verified corrections for survey shells that omit a real road underpass.

Do not infer a hole from footprint overlap alone: a road can be underground,
misaligned, or below an already accurate source mesh. These explicit corrections
are applied to the shared source geometry, so rendering and collision agree.
"""
import numpy as np
import shapely
from shapely.geometry import LineString, Polygon
from shapely.ops import linemerge, polygonize, polygonize_full, unary_union


PASSAGE_VERSION = 1
BMC_ID = 'BOS-HO11N-VJBYE-3RDXF'
CHELSEA_LIFT_ID = 'osm-way-196751230'
PASSAGES = {
 BMC_ID: {
  'start': [-19.699, 1685.902], 'end': [120.412, 1839.278],
  # Both Massachusetts Avenue carriageways, plus the adjacent sidewalks.
  'left': -8., 'right': 18., 'ceiling': 5.5,
  'roads': ['15696-0-0', '15699-0-0'],
  'evidence': 'User-provided Massachusetts Avenue Street View, October 29, 2026',
  'clearanceEstimated': True,
 },
 CHELSEA_LIFT_ID: {
  'start': [4260., -4065.], 'end': [4220., -4152.],
  # OSM marks the lift frame as a closed building footprint. Its over-road
  # machinery cannot be extruded down through both bridge travel lanes.
  'left': -8.5, 'right': 8.5, 'ceiling': 8.5,
  'roads': ['chelsea-street-bridge'],
  'evidence': 'Chelsea Street vertical-lift bridge towers and overhead machinery: https://www.lusas.com/case/bridge/chelsea_street_bridge.html; OSM way 196751230',
  'clearanceEstimated': True,
  'identity': {'name': 'Chelsea Street Bridge north lift frame', 'kind': 'transportation'},
 },
}


def apply_passage_identity(entry):
 identity=PASSAGES.get(entry['id'],{}).get('identity')
 if identity:
  entry.setdefault('sourceName',entry['name']);entry.update(identity)


def _split(poly, normal, offset):
 """Split a convex 3D polygon at dot(normal, point) >= offset."""
 inside, outside = [], []
 if not poly:return inside, outside
 for a, b in zip(poly, poly[1:]+poly[:1]):
  da, db = float(np.dot(normal, a)-offset), float(np.dot(normal, b)-offset)
  ina, inb = da >= -1e-9, db >= -1e-9
  (inside if ina else outside).append(a)
  if ina != inb:
   point = a+(b-a)*(da/(da-db))
   inside.append(point);outside.append(point)
 return inside, outside


def _section(vertices, faces, height, slope=None):
 """Solid source section on the passage ceiling; close only sub-quantization survey seams.

 The ceiling is the horizontal plane at ``height``, or with ``slope`` =
 (along, origin, rise per metre, length) the plane climbing from it along the
 corridor and level beyond its two ends.
 """
 lines = []
 for triangle in vertices[faces]:
  points = []
  for a, b in zip(triangle, np.roll(triangle, -1, axis=0)):
   if slope is None:
    if (a[1] < height) != (b[1] < height):
     p = a+(b-a)*(height-a[1])/(b[1]-a[1])
     points.append((round(float(p[0]), 6), round(float(p[2]), 6)))
   else:
    # Beyond the corridor's ends the ceiling carries on level, so the section stays a closed outline of the
    # shell there; an edge crossing an end is cut at it first, and each part meets its own plane.
    along, origin, rise, length = slope
    sa = along[0]*a[0]+along[1]*a[2]-origin;sb = along[0]*b[0]+along[1]*b[2]-origin
    cuts = sorted({0., 1., *(t for t in ((0.-sa)/(sb-sa), (length-sa)/(sb-sa)) if 0 < t < 1)} if sb != sa else {0., 1.})
    for t0, t1 in zip(cuts, cuts[1:]):
     p0, p1 = a+(b-a)*t0, a+(b-a)*t1
     f0 = p0[1]-height-rise*min(max(sa+(sb-sa)*t0, 0.), length);f1 = p1[1]-height-rise*min(max(sa+(sb-sa)*t1, 0.), length)
     if (f0 < 0) != (f1 < 0):
      p = p0+(p1-p0)*f0/(f0-f1)
      points.append((round(float(p[0]), 6), round(float(p[2]), 6)))
  if len(points) == 2 and points[0] != points[1]:lines.append(LineString(points))
  elif slope is not None and len(points) > 2:
   # A triangle the bent ceiling crosses twice: join the crossings in order along the corridor.
   points = sorted(set(points), key=lambda q:slope[0][0]*q[0]+slope[0][1]*q[1]);lines += [LineString([q, r]) for q, r in zip(points, points[1:])]
 if not lines:return Polygon()
 _, _, dangles, _ = polygonize_full(unary_union(lines))
 if not dangles.is_empty:
  merged = linemerge(dangles)
  for line in getattr(merged, 'geoms', [merged]):
   a, b = np.asarray(line.coords[0]), np.asarray(line.coords[-1])
   if 0 < np.linalg.norm(a-b) < .03:lines.append(LineString([a, b]))
 # polygonize returns a face for each enclosed region. Keeping faces with an
 # odd ring nesting count preserves courtyard holes in disconnected shells.
 polygons = list(polygonize(unary_union(lines)))
 return unary_union([p for p in polygons if sum(Polygon(q.exterior).covers(p.representative_point()) for q in polygons) % 2])


def _carve(vertices, faces, base, spec):
 """Cut one corridor out of a shell under its ceiling: (vertices, faces, corner
 polygon, cut triangle count, soffit polygon), the soffit empty when no closed
 source section lies in the corridor (nothing is cut then).

 ``ceilingEnd`` makes the ceiling climb (or fall) from ``ceiling`` at the
 start to that height at the end, for a ramp passing under the building."""
 start, end = np.asarray(spec['start'], dtype=np.float64), np.asarray(spec['end'], dtype=np.float64);ceiling = spec['ceiling']
 if 'ceilingEnd' in spec and min(ceiling, spec['ceilingEnd']) < base+.05 < max(ceiling, spec['ceilingEnd']):
  # The ceiling meets the building's base inside the corridor: the passage ends there, under the base.
  t = (base+.05-ceiling)/(spec['ceilingEnd']-ceiling)
  if ceiling < spec['ceilingEnd']:start, ceiling = start+(end-start)*t, base+.05
  else:end, spec = start+(end-start)*t, {**spec, 'ceilingEnd': base+.05}
 along = (end-start)/np.linalg.norm(end-start);across = np.array([along[1], -along[0]])
 corners = [start+across*spec['left'], end+across*spec['left'], end+across*spec['right'], start+across*spec['right']]
 corridor = Polygon(corners);length = float(np.linalg.norm(end-start))
 rise = (spec['ceilingEnd']-ceiling)/length if 'ceilingEnd' in spec else 0.
 origin = float(np.dot(along, start));slope = (along, origin, rise, length) if rise else None
 def top(x, z):return ceiling+rise*(along[0]*x+along[1]*z-origin) if rise else ceiling
 cap = _section(vertices, faces, ceiling, slope).intersection(corridor)
 if cap.is_empty or cap.area < 1:return vertices, faces, corners, 0, cap
 axis = np.array([along[0], 0., along[1]]);side = np.array([across[0], 0., across[1]])
 planes = [(axis, np.dot(along, start)), (-axis, -np.dot(along, end)),
           (side, np.dot(across, start)+spec['left']), (-side, -np.dot(across, start)-spec['right']),
           (np.array([rise*along[0], -1., rise*along[1]]), rise*origin-ceiling) if rise else (np.array([0., -1., 0.]), -ceiling)]
 out_vertices = [];out_faces = [];lookup = {};removed = 0
 def emit(poly, normal=None):
  if len(poly) < 3:return
  for i in range(1, len(poly)-1):
   tri = [np.asarray(p) for p in [poly[0], poly[i], poly[i+1]]]
   cross = np.cross(tri[1]-tri[0], tri[2]-tri[0])
   if np.dot(cross, cross) < 1e-14:continue
   if normal is not None and np.dot(cross, normal) < 0:tri[1], tri[2] = tri[2], tri[1]
   ids = []
   for p in tri:
    key = tuple(round(float(v), 8) for v in p)
    if key not in lookup:lookup[key] = len(out_vertices);out_vertices.append(p)
    ids.append(lookup[key])
   out_faces.append(ids)
 for triangle in vertices[faces]:
  remaining = list(triangle);outside = []
  for normal, offset in planes:
   remaining, rejected = _split(remaining, normal, offset)
   if rejected:outside.append(rejected)
   if not remaining:break
  if remaining:removed += 1
  for poly in outside:emit(poly)
 # The underside closes the cut source volume. Side reveals meet real source
 # walls at their boundaries; the front and rear faces remain open to traffic.
 polygons = list(cap.geoms) if hasattr(cap, 'geoms') else [cap]
 for polygon in polygons:
  if polygon.geom_type != 'Polygon':continue
  for tri in shapely.constrained_delaunay_triangles(polygon).geoms:
   emit([[x, top(x, z), z] for x, z in list(tri.exterior.coords)[:-1]], np.array([0., -1., 0.]))
  for ring in [polygon.exterior, *polygon.interiors]:
   for a, b in zip(list(ring.coords), list(ring.coords)[1:]):
    a, b = np.asarray(a), np.asarray(b)
    for boundary, inward in [(spec['left'], across), (spec['right'], -across)]:
     if max(abs(np.dot(across, p-start)-boundary) for p in [a, b]) > .001:continue
     emit([[a[0], base, a[1]], [b[0], base, b[1]], [b[0], top(b[0], b[1]), b[1]], [a[0], top(a[0], a[1]), a[1]]], np.array([inward[0], 0., inward[1]]))
 return np.asarray(out_vertices), np.asarray(out_faces, dtype=np.int64), corners, removed, cap


def passage_digest(specs):
 """Identity of a building's generated passages, kept in its metadata: a carved shell cannot be carved again for other ones."""
 import hashlib, json
 return hashlib.sha256(json.dumps(specs, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:16]


def apply_building_passages(entry, vertices, faces, generated=(), outline=None):
 """Return (absolute vertices, triangle faces, correction metadata or None).

 The input arrays and metadata are never modified. ``buildingPassage.version``
 makes a packaged-data repair idempotent; a fresh source build has no marker.
 The ceiling is an estimated clearance, not a measured construction dimension.

 ``generated`` are the passages a road stage asks for under this building (the
 ramps of boston_highways.py's ``buildings.passages``): each is cut after the
 verified one, and the metadata lists them with their digest and ``outline``,
 the plan the uncut shell covered (building_outline.rings), which that stage
 reads again on a rerun.
 """
 vertices = np.asarray(vertices, dtype=np.float64).reshape(-1, 3)
 faces = np.asarray(faces, dtype=np.int64).reshape(-1, 3)
 spec = PASSAGES.get(entry['id']);generated = list(generated)
 if spec is None and not generated:return vertices, faces, None
 prior = entry.get('buildingPassage')
 if prior and prior.get('version') == PASSAGE_VERSION:
  if prior.get('digest') != (passage_digest(generated) if generated else None):
   raise ValueError(f"{entry['id']}: its shell was carved for other passages; rebuild the package from the baseline")
  return vertices, faces, None
 base = entry.get('baseElevation', 0.);metadata = {'version': PASSAGE_VERSION}
 if spec is not None:
  vertices, faces, corners, removed, cap = _carve(vertices, faces, base, spec)
  if cap.is_empty or cap.area < 1:raise ValueError(f"{entry['id']}: verified passage no longer intersects a closed source section")
  metadata.update({'roads': spec['roads'], 'ceiling': spec['ceiling'],
                   'polygon': [[round(float(v), 6) for v in p] for p in corners],
                   'clearanceEstimated': spec['clearanceEstimated'], 'evidence': spec['evidence'],
                   'cutSourceTriangles': removed, 'soffitArea': round(cap.area, 3)})
 if generated:
  cut = []
  for passage in generated:
   vertices, faces, corners, removed, cap = _carve(vertices, faces, base, passage)
   cut.append({'road': passage['road'], 'ceiling': passage['ceiling'], 'ceilingEnd': passage['ceilingEnd'],
               'polygon': [[round(float(v), 6) for v in p] for p in corners],
               'cutSourceTriangles': removed, 'soffitArea': round(cap.area, 3) if removed else 0})
  if spec is None and not any(c['cutSourceTriangles'] for c in cut):return vertices, faces, None
  metadata.update({'highway': cut, 'digest': passage_digest(generated), 'clearanceEstimated': True})
  if outline is not None:metadata['outline'] = outline
  if spec is None:metadata['roads'] = sorted({c['road'] for c in cut})
 return vertices, faces, metadata
