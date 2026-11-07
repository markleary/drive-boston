"""Generated house shells for the northern towns (Everett, Medford, Malden, Melrose).

OpenStreetMap carries the footprint of nearly every house there but almost never
its height or roof. The MassGIS assessor parcel the footprint stands on records
the house style, year built and storeys, so a footprint keeps its own walls up to
an eave set by the storeys, and the roof is built over the footprint's
rectilinear parts: the largest rectangle on the grid of the footprint's own wall
lines (in its main axis frame) and up to three wings joined to it. Each part gets
the roof form of its style (cross gables, hips, gambrels, mansards) with eave
and rake overhangs, soffits and fascia; a Victorian's polygonal corner bay rises
as a turret under a conical roof. This is an interpretive typology from the
assessor style, not a survey of any individual house.
"""
from __future__ import annotations
import math, re
import numpy as np
import shapely
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

# Assessor STYLE vocabularies differ by town; every entry maps to one typology.
STYLE_TYPOLOGY = [
 (r'^VICTORIAN$', 'victorian'), (r'^(SPLIT )?MANSARD$', 'mansard'), (r'^(SPLIT )?GAMB', 'gambrel'),
 (r'^(OLD STYLE|ANTIQUE|MIXED OLD|BOARDING HSE|MULTI-CONV(ER)?|CONCONV|CONVENT/CONVER)$', 'old-style'),
 (r'^(MULTI 2 FAM|2 FAMILY|FAMILY DUPLEX|DUPLEX|CONDO CONV 2 - 3 FAM)$', 'two-family'),
 (r'^(MULTI 3 FAM|3 DECKER|3 FAMILY)$', 'three-decker'),
 (r'^(COLONIAL|GARRISON|COL/GARR/TUDOR|CONVENT`NL)$', 'colonial'), (r'^TUDOR$', 'tudor'),
 (r'^((SPLIT )?CAPE|CAPE COD)$', 'cape'), (r'^BUNGALOW$', 'bungalow'),
 (r'^(RANCH|RAISED RANCH|SPLIT ENT|SPLIT LEVL|SPLIT LEVEL)$', 'ranch'),
 (r'^(CONTEMP`RY|CONTEMPORY|MODERN/CONTEMP)$', 'contemporary'),
 (r'^(ROW HOUSE|CONDO-TNHS|MULTI-TNHS|CONDO TOWNHOUSE)$', 'row-house'),
]
# Typology -> roof form, pitch (degrees), storey height and eave overhang (metres).
FORMS = {
 'victorian': ('cross-gable', 50, 3.15, .45), 'mansard': ('mansard', 72, 3.1, .35), 'old-style': ('gable', 46, 3.0, .35),
 'two-family': ('gable', 40, 2.95, .35), 'three-decker': ('flat', 0, 2.95, .4), 'colonial': ('gable', 38, 2.85, .3),
 'tudor': ('cross-gable', 55, 2.9, .25), 'cape': ('gable', 45, 2.7, .25), 'gambrel': ('gambrel', 62, 2.8, .3),
 'bungalow': ('gable', 30, 2.8, .55), 'ranch': ('hip', 22, 2.7, .45), 'contemporary': ('gable', 20, 2.8, .4),
 'row-house': ('gable', 30, 2.9, .25), 'garage': ('gable', 28, 2.6, .2),
}
# Typologies that are nineteenth-century wood houses when built before 1916: the
# renderer gives them the Victorian palette, trim and porches.
PERIOD = {'victorian', 'mansard', 'old-style', 'two-family'}

def typology(style, year=None, use_code=None):
 """Canonical house typology for an assessor record, or None (not a house)."""
 text = (style or '').strip().upper()
 for pattern, name in STYLE_TYPOLOGY:
  if re.match(pattern, text): return name
 code = str(use_code or '')[:3]
 if code == '101': return 'old-style' if year and year < 1916 else 'colonial'
 if code in ('104', '105'): return 'two-family' if code == '104' else 'three-decker'
 return None

def parse_stories(value):
 """(full storeys, half storey under the roof) from '2', '2.5', '2A', '1H', '2T'."""
 if value in (None, ''): return None, False
 m = re.match(r'\s*(\d+(?:\.\d+)?)\s*([AHT]?)', str(value).upper())
 if not m: return None, False
 number = float(m.group(1)); suffix = m.group(2)
 if number <= 0: return None, False
 return float(int(number)), bool(suffix) or number - int(number) >= .2

def victorian_era(kind, year):
 return kind in ('victorian', 'mansard') or (kind in PERIOD and year is not None and 1840 <= year < 1916)

class Mesh:
 def __init__(self):
  self.vertices = []; self.faces = []; self.roof = []; self.index = {}
 def v(self, x, y, z):
  key = (round(x, 4), round(y, 4), round(z, 4))
  if key not in self.index: self.index[key] = len(self.vertices); self.vertices.append([x, y, z])
  return self.index[key]
 def tri(self, a, b, c, outward, roof):
  if a == b or b == c or a == c: return
  (ax, ay, az), (bx, by, bz), (cx, cy, cz) = self.vertices[a], self.vertices[b], self.vertices[c]
  nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay); ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az); nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  self.faces.append([a, b, c] if nx * outward[0] + ny * outward[1] + nz * outward[2] >= 0 else [a, c, b]); self.roof.append(roof)
 def quad(self, a, b, c, d, outward, roof):
  self.tri(a, b, c, outward, roof); self.tri(a, c, d, outward, roof)

def cluster(values, tol=.35):
 out = []
 for value in sorted(values):
  if out and value - out[-1][-1] <= tol: out[-1].append(value)
  else: out.append([value])
 return np.array([sum(g) / len(g) for g in out])

def largest(ok, us, vs, min_side, min_area):
 """Largest all-ok rectangle of grid cells: (i0, i1, j0, j1) in line indices, or None."""
 n, m = ok.shape
 if n == 0 or m == 0: return None
 prefix = np.zeros((n + 1, m + 1), dtype=np.int32); prefix[1:, 1:] = np.cumsum(np.cumsum(ok, 0), 1)
 i0, i1 = np.triu_indices(n + 1, 1); j0, j1 = np.triu_indices(m + 1, 1)
 count = prefix[i1][:, j1] - prefix[i0][:, j1] - prefix[i1][:, j0] + prefix[i0][:, j0]
 cells = (i1 - i0)[:, None] * (j1 - j0)[None, :]
 du = (us[i1] - us[i0])[:, None]; dv = (vs[j1] - vs[j0])[None, :]
 area = np.where((count == cells) & (np.minimum(du, dv) >= min_side), du * dv, 0)
 k = int(np.argmax(area)); a, b = divmod(k, len(j0))
 if area[a, b] < min_area: return None
 return int(i0[a]), int(i1[a]), int(j0[b]), int(j1[b])

def decompose(local):
 """Main rectangle and wings of a footprint in its axis frame: [(u0, u1, v0, v1, parent)]."""
 ring = np.asarray(local.exterior.coords)
 us = cluster(ring[:, 0]); vs = cluster(ring[:, 1])
 if len(us) < 2 or len(vs) < 2 or len(us) > 26 or len(vs) > 26: return None
 cu = (us[:-1] + us[1:]) / 2; cv = (vs[:-1] + vs[1:]) / 2; wu = np.diff(us); wv = np.diff(vs)
 inside = np.zeros((len(cu), len(cv)))
 for fu, fv in ((0, 0), (-.25, -.25), (.25, -.25), (-.25, .25), (.25, .25)):
  X = (cu + fu * wu)[:, None] + 0 * cv[None, :]; Y = 0 * cu[:, None] + (cv + fv * wv)[None, :]
  inside += shapely.contains_xy(local, X, Y)
 ok = inside >= 3
 main = largest(ok, us, vs, 2.6, 12)
 if main is None: return None
 rects = [main]; parents = [None]; covered = np.zeros_like(ok)
 covered[main[0]:main[1], main[2]:main[3]] = True
 for _ in range(6):
  if len(rects) >= 4: break
  wing = largest(ok & ~covered, us, vs, 2.2, 6)
  if wing is None: break
  covered[wing[0]:wing[1], wing[2]:wing[3]] = True
  parent = None
  for k, (a0, a1, b0, b1) in enumerate(rects):
   touch_u = (wing[1] == a0 or wing[0] == a1) and min(vs[wing[3]], vs[b1]) - max(vs[wing[2]], vs[b0]) >= 1.5
   touch_v = (wing[3] == b0 or wing[2] == b1) and min(us[wing[1]], us[a1]) - max(us[wing[0]], us[a0]) >= 1.5
   if touch_u or touch_v: parent = k; break
  if parent is not None: rects.append(wing); parents.append(parent)
 return [[float(us[a0]), float(us[a1]), float(vs[b0]), float(vs[b1]), parent] for (a0, a1, b0, b1), parent in zip(rects, parents)]

class Part:
 """One roofed rectangle in the local frame: ridge along `axis` ('u' or 'v')."""
 def __init__(self, u0, u1, v0, v1, form, pitch, eave):
  self.u0, self.u1, self.v0, self.v1 = u0, u1, v0, v1; self.form = form; self.pitch = pitch; self.eave = eave
  self.axis = 'u' if u1 - u0 >= v1 - v0 else 'v'
 @property
 def length(self): return (self.u1 - self.u0) if self.axis == 'u' else (self.v1 - self.v0)
 @property
 def width(self): return (self.v1 - self.v0) if self.axis == 'u' else (self.u1 - self.u0)
 def across(self, u, v):
  """Distance from the nearer long eave and along-ridge distance from the nearer end."""
  if self.axis == 'u': return min(v - self.v0, self.v1 - v), min(u - self.u0, self.u1 - u)
  return min(u - self.u0, self.u1 - u), min(v - self.v0, self.v1 - v)
 def height(self, u, v):
  """Roof surface height over a point inside the rectangle."""
  if not (self.u0 - 1e-6 <= u <= self.u1 + 1e-6 and self.v0 - 1e-6 <= v <= self.v1 + 1e-6): return -math.inf
  side, end = self.across(u, v); t = math.tan(math.radians(self.pitch))
  if self.form in ('gable', 'cross-gable'): return self.eave + side * t
  if self.form == 'hip': return self.eave + min(side, end) * t
  if self.form == 'gambrel':
   knee = self.width * .25; upper = math.tan(math.radians(26))
   return self.eave + (side * t if side <= knee else knee * t + (side - knee) * upper)
  if self.form == 'mansard':
   inset = min(self.width * .22, 1.25); d = min(side, end)
   return self.eave + min(d, inset) * t
  return self.eave
 def ridge(self):
  t = math.tan(math.radians(self.pitch)); half = self.width / 2
  if self.form == 'gambrel':
   knee = self.width * .25; return self.eave + knee * t + (half - knee) * math.tan(math.radians(26))
  if self.form == 'mansard': return self.eave + min(self.width * .22, 1.25) * t
  if self.form == 'flat': return self.eave
  return self.eave + half * t

def to_world(theta, cx, cz):
 c, s = math.cos(theta), math.sin(theta)
 return lambda u, v: (cx + u * c - v * s, cz + u * s + v * c)

def roof_part(mesh, part, world, overhang, rake, skip_inner=None):
 """Roof planes, gable ends, soffits and fascia of one part.
 `skip_inner` names the end ('start' or 'end' along the ridge) buried in a parent roof."""
 E = part.eave; t = math.tan(math.radians(part.pitch)); W = part.width; L = part.length
 # Local ridge frame: s along the ridge, w across, both centred.
 if part.axis == 'u': s0, s1, w0, w1 = part.u0, part.u1, part.v0, part.v1
 else: s0, s1, w0, w1 = part.v0, part.v1, part.u0, part.u1
 wc = (w0 + w1) / 2
 def P(s, w, y):
  u, v = (s, w) if part.axis == 'u' else (w, s)
  x, z = world(u, v); return mesh.v(x, y, z)
 def out_dir(ds, dw):
  # A horizontal outward direction in world space for a local (ds, dw) direction.
  u, v = (ds, dw) if part.axis == 'u' else (dw, ds)
  x0, z0 = world(0, 0); x1, z1 = world(u, v); return [x1 - x0, 0, z1 - z0]
 o = overhang; r = rake
 start_rake = 0 if skip_inner == 'start' else r; end_rake = 0 if skip_inner == 'end' else r
 sa, sb = s0 - start_rake, s1 + end_rake
 drop = o * t  # eave edge sits this far below the wall top
 if part.form in ('gable', 'cross-gable'):
  H = E + W / 2 * t
  ang = math.atan(t)
  for side, w_wall, w_edge in ((-1, w0, w0 - o), (1, w1, w1 + o)):
   d = out_dir(0, side); n = [d[0] * math.sin(ang), math.cos(ang), d[2] * math.sin(ang)]
   a = P(sa, w_edge, E - drop); b = P(sb, w_edge, E - drop); c = P(sb, wc, H); d = P(sa, wc, H)
   mesh.quad(a, b, c, d, n, True)
   # Soffit: the overhang strip seen from below.
   if o > 0:
    e = P(sa, w_wall, E); f = P(sb, w_wall, E)
    mesh.quad(a, b, f, e, [0, -1, 0], True)
    # Fascia board along the eave edge.
    g = P(sa, w_edge, E - drop - .16); h = P(sb, w_edge, E - drop - .16)
    mesh.quad(g, h, b, a, out_dir(0, side), True)
  for end, s_wall, s_edge, rk in (('start', s0, sa, start_rake), ('end', s1, sb, end_rake)):
   if skip_inner == end: continue
   dirn = out_dir(-1 if end == 'start' else 1, 0)
   mesh.tri(P(s_wall, w0, E), P(s_wall, w1, E), P(s_wall, wc, H), dirn, False)
   if rk > 0:
    # Rake soffits: the undersides of the roof planes beyond the gable wall.
    for w_e in (w0 - o, w1 + o):
     mesh.quad(P(s_wall, w_e, E - drop), P(s_edge, w_e, E - drop), P(s_edge, wc, H), P(s_wall, wc, H), [0, -1, 0], True)
 elif part.form == 'hip':
  H = E + min(W, L) / 2 * t; half = W / 2
  ra = s0 + min(half, L / 2); rb = s1 - min(half, L / 2)
  ea, eb, fa, fb = s0 - o, s1 + o, w0 - o, w1 + o
  c00 = P(ea, fa, E - drop); c10 = P(eb, fa, E - drop); c11 = P(eb, fb, E - drop); c01 = P(ea, fb, E - drop)
  ra_v = P(ra, wc, H); rb_v = P(rb, wc, H)
  tilt = math.sin(math.atan(t)), math.cos(math.atan(t))
  def n(ds, dw): d = out_dir(ds, dw); return [d[0] * tilt[0], tilt[1], d[2] * tilt[0]]
  mesh.quad(c00, c10, rb_v, ra_v, n(0, -1), True); mesh.quad(c01, c11, rb_v, ra_v, n(0, 1), True)
  mesh.tri(c00, c01, ra_v, n(-1, 0), True); mesh.tri(c10, c11, rb_v, n(1, 0), True)
  if o > 0:
   w00 = P(s0, w0, E); w10 = P(s1, w0, E); w11 = P(s1, w1, E); w01 = P(s0, w1, E)
   for a, b, c, d in ((c00, c10, w10, w00), (c10, c11, w11, w10), (c11, c01, w01, w11), (c01, c00, w00, w01)): mesh.quad(a, b, c, d, [0, -1, 0], True)
 elif part.form == 'gambrel':
  knee = W * .25; up = math.tan(math.radians(26)); K = E + knee * t; H = K + (W / 2 - knee) * up
  lower = math.atan(t); upper = math.atan(up)
  for side, w_wall, w_edge, w_knee in ((-1, w0, w0 - o, w0 + knee), (1, w1, w1 + o, w1 - knee)):
   d = out_dir(0, side)
   nl = [d[0] * math.sin(lower), math.cos(lower), d[2] * math.sin(lower)]; nu = [d[0] * math.sin(upper), math.cos(upper), d[2] * math.sin(upper)]
   a = P(sa, w_edge, E - drop); b = P(sb, w_edge, E - drop); c = P(sb, w_knee, K); dd = P(sa, w_knee, K)
   mesh.quad(a, b, c, dd, nl, True); mesh.quad(dd, c, P(sb, wc, H), P(sa, wc, H), nu, True)
   if o > 0: mesh.quad(a, b, P(sb, w_wall, E), P(sa, w_wall, E), [0, -1, 0], True)
  for end, s_wall in (('start', s0), ('end', s1)):
   if skip_inner == end: continue
   dirn = out_dir(-1 if end == 'start' else 1, 0)
   ids = [P(s_wall, w0, E), P(s_wall, w0 + knee, K), P(s_wall, wc, H), P(s_wall, w1 - knee, K), P(s_wall, w1, E)]
   for k in range(1, 4): mesh.tri(ids[0], ids[k], ids[k + 1], dirn, False)
 elif part.form == 'mansard':
  inset = min(W * .22, 1.25); D = E + inset * t; ang = math.atan(t)
  outer = [(s0 - o, w0 - o), (s1 + o, w0 - o), (s1 + o, w1 + o), (s0 - o, w1 + o)]
  inner = [(s0 + inset, w0 + inset), (s1 - inset, w0 + inset), (s1 - inset, w1 - inset), (s0 + inset, w1 - inset)]
  dirs = [(0, -1), (1, 0), (0, 1), (-1, 0)]
  for k in range(4):
   a, b = outer[k], outer[(k + 1) % 4]; c, d = inner[(k + 1) % 4], inner[k]; dd = out_dir(*dirs[k])
   mesh.quad(P(*a, E - drop), P(*b, E - drop), P(*c, D), P(*d, D), [dd[0] * math.sin(ang), math.cos(ang), dd[2] * math.sin(ang)], True)
  mesh.quad(*(P(*p, D) for p in inner), [0, 1, 0], True)
  # A thin cresting band at the deck edge.
  if o > 0:
   walls = [(s0, w0), (s1, w0), (s1, w1), (s0, w1)]
   for k in range(4): mesh.quad(P(*outer[k], E - drop), P(*outer[(k + 1) % 4], E - drop), P(*walls[(k + 1) % 4], E), P(*walls[k], E), [0, -1, 0], True)

def turret(mesh, piece, top_above, world_poly, eave):
 """A turret over a polygonal corner bay: walls up one half storey, then a cone."""
 ring = list(piece.exterior.coords)[:-1]
 if len(ring) < 3: return False
 T = eave + top_above; c = piece.centroid; r = math.sqrt(piece.area / math.pi)
 apex = mesh.v(c.x, T + max(2.4, 2.3 * r), c.y)
 shell = shapely.orient_polygons(piece)
 pts = list(shell.exterior.coords)[:-1]
 for a, b in zip(pts, pts[1:] + pts[:1]):
  out = [b[1] - a[1], 0, a[0] - b[0]]
  mesh.quad(mesh.v(a[0], eave, a[1]), mesh.v(b[0], eave, b[1]), mesh.v(b[0], T, b[1]), mesh.v(a[0], T, a[1]), out, False)
 flare = shell.buffer(.28, join_style=2)
 if flare.geom_type != 'Polygon': flare = shell
 fp = list(shapely.orient_polygons(flare).exterior.coords)[:-1]
 for a, b in zip(fp, fp[1:] + fp[:1]):
  mx, mz = (a[0] + b[0]) / 2 - c.x, (a[1] + b[1]) / 2 - c.y
  mesh.tri(mesh.v(a[0], T - .12, a[1]), mesh.v(b[0], T - .12, b[1]), apex, [mx, r * .6, mz], True)
 # Close the flare's underside.
 for tri in shapely.constrained_delaunay_triangles(flare).geoms:
  q = list(tri.exterior.coords)[:-1]; mesh.tri(*(mesh.v(p[0], T - .12, p[1]) for p in q), [0, -1, 0], True)
 return True

def house_mesh(poly, base, eave_above, kind, seed=0, stories=None, attic=False, turrets=True):
 """Walls to the eave and a typology roof. Returns (vertices, faces, roof_mask, meta) or None.
 `turrets=False` leaves a Victorian's polygonal corner bay under the main roof."""
 form, pitch, floor, overhang = FORMS[kind]
 poly = shapely.orient_polygons(poly.buffer(0))
 if poly.geom_type != 'Polygon' or poly.area < 12: return None
 E = base + eave_above
 rect = poly.minimum_rotated_rectangle; corners = list(rect.exterior.coords)[:-1]
 if len(corners) != 4: return None
 e0 = math.dist(corners[0], corners[1]); e1 = math.dist(corners[1], corners[2])
 a, b = (corners[0], corners[1]) if e0 >= e1 else (corners[1], corners[2])
 theta = math.atan2(b[1] - a[1], b[0] - a[0]); cx, cz = poly.centroid.x, poly.centroid.y
 world = to_world(theta, cx, cz)
 c, s = math.cos(theta), math.sin(theta)
 local = Polygon([((x - cx) * c + (z - cz) * s, -(x - cx) * s + (z - cz) * c) for x, z in poly.exterior.coords],
                 [[((x - cx) * c + (z - cz) * s, -(x - cx) * s + (z - cz) * c) for x, z in ring.coords] for ring in poly.interiors]).buffer(0)
 if local.geom_type != 'Polygon': return None
 mesh = Mesh()
 rings = [list(poly.exterior.coords)[:-1]] + [list(r.coords)[:-1] for r in poly.interiors]
 for ring in rings:
  for p, q in zip(ring, ring[1:] + ring[:1]):
   out = [q[1] - p[1], 0, p[0] - q[0]]
   mesh.quad(mesh.v(p[0], base, p[1]), mesh.v(q[0], base, q[1]), mesh.v(q[0], E, q[1]), mesh.v(p[0], E, p[1]), out, False)
 for tri in shapely.constrained_delaunay_triangles(poly).geoms:
  q = list(tri.exterior.coords)[:-1]; mesh.tri(*(mesh.v(p[0], E, p[1]) for p in q), [0, 1, 0], True)
 meta = {'roof': form, 'pitch': pitch, 'parts': 0, 'turrets': 0}
 if form == 'flat':
  return mesh.vertices, mesh.faces, mesh.roof, {**meta, 'ridge': round(E - base, 2)}
 rects = None
 if poly.area >= .9 * rect.area:
  minx, miny, maxx, maxy = local.bounds; rects = [[minx, maxx, miny, maxy, None]]
 else: rects = decompose(local)
 if not rects:
  minx, miny, maxx, maxy = local.bounds
  if poly.area < .72 * rect.area: return mesh.vertices, mesh.faces, mesh.roof, {**meta, 'roof': 'flat', 'ridge': round(E - base, 2)}
  rects = [[minx, maxx, miny, maxy, None]]
 parts = []
 main_form = form
 if form == 'cross-gable':
  u0, u1, v0, v1, _ = rects[0]
  main_form = 'hip' if max(u1 - u0, v1 - v0) / max(.1, min(u1 - u0, v1 - v0)) < 1.3 and kind == 'victorian' else 'gable'
 for k, (u0, u1, v0, v1, parent) in enumerate(rects):
  part_form = main_form if k == 0 else ('gable' if form in ('cross-gable', 'hip', 'gable') else form)
  if form == 'hip' and k > 0: part_form = 'hip'
  part = Part(u0, u1, v0, v1, part_form, pitch, E); skip = None
  if parent is not None:
   host = parts[parent]
   # The wing projects away from its parent: its ridge runs across the shared wall.
   if abs(u1 - host.u0) < 1e-6 or abs(u0 - host.u1) < 1e-6:
    part.axis = 'u'; direction = 1 if abs(u0 - host.u1) < 1e-6 else -1
   else:
    part.axis = 'v'; direction = 1 if abs(v0 - host.v1) < 1e-6 else -1
   if part.ridge() > host.ridge() - .25:
    # A wing wider than its parent: flatten it below the parent's ridge.
    room = host.ridge() - .3 - E
    part.pitch = max(12.0, math.degrees(math.atan(room / max(.5, part.width / 2)))) if room > .3 else 12.0
   # Run the wing into the parent until its ridge is buried under the parent's roof.
   ridge = part.ridge(); extend = 0.0; step = .15
   centre_u = (u0 + u1) / 2; centre_v = (v0 + v1) / 2
   limit = (host.u1 - host.u0) if part.axis == 'u' else (host.v1 - host.v0)
   while extend < limit:
    if part.axis == 'u': pu, pv = (host.u1 - extend if direction == 1 else host.u0 + extend), centre_v
    else: pu, pv = centre_u, (host.v1 - extend if direction == 1 else host.v0 + extend)
    if host.height(pu, pv) >= ridge + .05: break
    extend += step
   extend = min(limit, extend + .3)
   if part.axis == 'u':
    if direction == 1: part.u0 = host.u1 - extend
    else: part.u1 = host.u0 + extend
   else:
    if direction == 1: part.v0 = host.v1 - extend
    else: part.v1 = host.v0 + extend
   skip = 'start' if direction == 1 else 'end'
  part.skip = skip; parts.append(part)
 for part in parts: roof_part(mesh, part, world, overhang, overhang * .55 if part.form != 'mansard' else 0, part.skip)
 meta['parts'] = len(parts)
 # Victorian corner bays outside the rectangles rise as turrets.
 if kind == 'victorian' and turrets:
  covered = unary_union([box(p.u0, p.v0, p.u1, p.v1) for p in parts])
  rest = local.difference(covered.buffer(.05, join_style=2))
  pieces = [g for g in getattr(rest, 'geoms', [rest]) if g.geom_type == 'Polygon' and 3 <= g.area <= 18]
  for piece in pieces:
   ring = np.asarray(piece.exterior.coords)
   angles = [math.degrees(math.atan2(q[1] - p[1], q[0] - p[0])) % 90 for p, q in zip(ring, ring[1:])]
   oblique = sum(1 for a in angles if 15 < a < 75)
   mrr = piece.minimum_rotated_rectangle
   if oblique < 2 or piece.area < .55 * mrr.area: continue
   corner = min(math.dist((piece.centroid.x, piece.centroid.y), (u, v)) for p in parts for u in (p.u0, p.u1) for v in (p.v0, p.v1))
   if corner > 3.2: continue
   world_piece = Polygon([world(u, v) for u, v in piece.exterior.coords])
   if turret(mesh, world_piece.buffer(0), 1.7, poly, E): meta['turrets'] += 1
   if meta['turrets'] >= 1: break
 meta['ridge'] = round(max(v[1] for v in mesh.vertices) - base, 2)
 return mesh.vertices, mesh.faces, mesh.roof, meta

def eave_height(kind, stories, attic):
 """Wall height above the footing: a 0.6 m foundation plus the full storeys."""
 form, pitch, floor, _ = FORMS[kind]
 defaults = {'victorian': 2, 'mansard': 2, 'old-style': 2, 'two-family': 2, 'three-decker': 3, 'colonial': 2, 'tudor': 2,
             'cape': 1, 'gambrel': 1, 'bungalow': 1, 'ranch': 1, 'contemporary': 2, 'row-house': 2, 'garage': 1}
 n = stories if stories else defaults[kind]
 n = max(1, min(4, n))
 if kind in ('gambrel', 'mansard'): n = max(1, n - 1) if stories and stories >= 2 and kind == 'gambrel' else n
 return round(.6 + n * floor, 2)
