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


def _section(vertices, faces, height):
 """Solid horizontal source section; close only sub-quantization survey seams."""
 lines = []
 for triangle in vertices[faces]:
  points = []
  for a, b in zip(triangle, np.roll(triangle, -1, axis=0)):
   if (a[1] < height) != (b[1] < height):
    p = a+(b-a)*(height-a[1])/(b[1]-a[1])
    points.append((round(float(p[0]), 6), round(float(p[2]), 6)))
  if len(points) == 2 and points[0] != points[1]:lines.append(LineString(points))
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


def apply_building_passages(entry, vertices, faces):
 """Return (absolute vertices, triangle faces, correction metadata or None).

 The input arrays and metadata are never modified. ``buildingPassage.version``
 makes a packaged-data repair idempotent; a fresh source build has no marker.
 The ceiling is an estimated clearance, not a measured construction dimension.
 """
 vertices = np.asarray(vertices, dtype=np.float64).reshape(-1, 3)
 faces = np.asarray(faces, dtype=np.int64).reshape(-1, 3)
 spec = PASSAGES.get(entry['id'])
 if spec is None:return vertices, faces, None
 prior = entry.get('buildingPassage')
 if prior and prior.get('version') == PASSAGE_VERSION:return vertices, faces, None
 start, end = np.asarray(spec['start']), np.asarray(spec['end'])
 along = (end-start)/np.linalg.norm(end-start);across = np.array([along[1], -along[0]])
 corners = [start+across*spec['left'], end+across*spec['left'], end+across*spec['right'], start+across*spec['right']]
 corridor = Polygon(corners);ceiling = spec['ceiling'];base = entry.get('baseElevation', 0.)
 cap = _section(vertices, faces, ceiling).intersection(corridor)
 if cap.is_empty or cap.area < 1:raise ValueError(f"{entry['id']}: verified passage no longer intersects a closed source section")
 axis = np.array([along[0], 0., along[1]]);side = np.array([across[0], 0., across[1]])
 planes = [(axis, np.dot(along, start)), (-axis, -np.dot(along, end)),
           (side, np.dot(across, start)+spec['left']), (-side, -np.dot(across, start)-spec['right']),
           (np.array([0., -1., 0.]), -ceiling)]
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
  for tri in shapely.constrained_delaunay_triangles(polygon).geoms:
   emit([[x, ceiling, z] for x, z in list(tri.exterior.coords)[:-1]], np.array([0., -1., 0.]))
  for ring in [polygon.exterior, *polygon.interiors]:
   for a, b in zip(list(ring.coords), list(ring.coords)[1:]):
    a, b = np.asarray(a), np.asarray(b)
    for boundary, inward in [(spec['left'], across), (spec['right'], -across)]:
     if max(abs(np.dot(across, p-start)-boundary) for p in [a, b]) > .001:continue
     emit([[a[0], base, a[1]], [b[0], base, b[1]], [b[0], ceiling, b[1]], [a[0], ceiling, a[1]]], np.array([inward[0], 0., inward[1]]))
 metadata = {'version': PASSAGE_VERSION, 'roads': spec['roads'], 'ceiling': ceiling,
             'polygon': [[round(float(v), 6) for v in p] for p in corners],
             'clearanceEstimated': spec['clearanceEstimated'], 'evidence': spec['evidence'],
             'cutSourceTriangles': removed, 'soffitArea': round(cap.area, 3)}
 return np.asarray(out_vertices), np.asarray(out_faces, dtype=np.int64), metadata
