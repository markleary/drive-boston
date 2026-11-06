import gzip, importlib.util, pathlib, struct, tempfile, unittest
import numpy as np
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from far_massing import CELL, Corridors, fragments, read_far, rewrite

ROOT = pathlib.Path(__file__).resolve().parents[1]


def cuboid(x0, z0, x1, z1, y0, y1):
 """Closed box mesh with outward faces: (vertices, faces)."""
 v = [(x, y, z) for y in (y0, y1) for z in (z0, z1) for x in (x0, x1)]
 quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
 return v, [t for a, b, c, d in quads for t in ((a, b, c), (a, c, d))]


def mesh(*parts):
 vertices, faces = [], []
 for v, f in parts:faces += [[i + len(vertices) for i in t] for t in f];vertices += v
 return vertices, faces


# A street runs north-south at x 100 (pavedWidth 20 m, so 90..110 is roadway). West of it a
# 20 m podium carries a 100 m tower; east of it stands a 40 m block. A 3 m walkway joins them
# 12 m up, and an office bridge 30 m wide spans the street from 6 m up.
ROAD = {'id': 'r', 'points': [[100, -200], [100, 400]], 'width': 10, 'pavedWidth': 20}
COMPLEX = mesh(cuboid(0, 0, 80, 120, 0, 20), cuboid(20, 20, 50, 60, 0, 100), cuboid(120, 0, 200, 80, 0, 40),
               cuboid(80, 100, 120, 103, 10, 14), cuboid(80, 20, 120, 50, 6, 30))


class FarMassingTest(unittest.TestCase):
 def setUp(self):
  self.parts = fragments(*COMPLEX, 0, 100, Corridors([ROAD]))
  self.boxes = [(Polygon(p['footprint']), p['height']) for p in self.parts]

 def test_fragments_are_rectangles(self):
  self.assertTrue(self.parts)
  for poly, _ in self.boxes:
   self.assertEqual(len(poly.exterior.coords), 5);self.assertAlmostEqual(poly.area, poly.minimum_rotated_rectangle.area, delta=poly.area * 1e-4)

 def test_street_stays_open_where_a_wing_bridges_it(self):
  # Cells straddling the curb may reach half a cell into the roadway, never further.
  street = box(90 + CELL / 2 + .01, -200, 110 - CELL / 2 - .01, 400)
  self.assertEqual(sum(poly.intersection(street).area for poly, _ in self.boxes), 0)

 def test_walkway_is_dropped(self):
  for poly, _ in self.boxes:
   self.assertFalse(poly.intersects(box(82, 99, 88, 104)) or poly.intersects(box(112, 99, 118, 104)))

 def test_terraces_follow_the_wings(self):
  def covered(region, height):
   return unary_union([poly for poly, h in self.boxes if abs(h - height) < .01]).intersection(region).area / region.area
  self.assertGreater(covered(box(0, 0, 80, 120), 20), .85)
  self.assertGreater(covered(box(20, 20, 50, 60), 100), .85)
  self.assertGreater(covered(box(120, 0, 200, 80), 40), .85)
  tower = [poly for poly, h in self.boxes if h > 50]
  self.assertTrue(tower and all(box(20 - CELL, 20 - CELL, 50 + CELL, 60 + CELL).contains(poly) for poly in tower))
  self.assertEqual(max(h for _, h in self.boxes), 100)

 def test_deterministic(self):
  self.assertEqual(fragments(*COMPLEX, 0, 100, Corridors([ROAD])), self.parts)


def far_bytes(records, key='0_0', size=1000):
 import json
 body = b''.join(records);head = json.dumps({'size': size, 'tiles': [{'key': key, 'offset': 0, 'count': len(records)}]}, separators=(',', ':')).encode()
 out = b'DBF2' + struct.pack('<I', len(head)) + head
 return out + b'\0' * ((-len(out)) % 4) + body


def record(points, height, base, flags, style):
 return struct.pack('<HHhBB', len(points), height, base, flags, style) + b''.join(struct.pack('<hh', x, z) for x, z in points)


class RewriteTest(unittest.TestCase):
 def test_hidden_primaries_get_fresh_fragments(self):
  square = [(0, 0), (100, 0), (100, 100), (0, 100)]
  plain, complex_, stale, structure = record(square, 900, 120, 0, 3), record(square, 9000, 250, 6, 7), record(square, 3000, 250, 14, 7), record(square, 5000, 0, 4, 1)
  parts = {1: [{'footprint': [[1, 2], [11, 2], [11, 32.04], [1, 32.04]], 'height': 30.004}, {'footprint': [[5, 5], [8, 5], [8, 9], [5, 9]], 'height': 90}], 2: []}
  raw = rewrite(far_bytes([plain, complex_, stale, structure], '1_-2'), lambda key, ordinal: parts[ordinal])
  header, records = read_far(raw)
  self.assertEqual(header['tiles'], [{'key': '1_-2', 'offset': 0, 'count': 5}])
  self.assertEqual(records['1_-2'][:2], [plain, complex_]);self.assertEqual(records['1_-2'][4], structure)
  fragments_ = records['1_-2'][2:4];self.assertNotIn(stale, fragments_)
  points, height, base, flags, style = struct.unpack_from('<HHhBB', fragments_[0])
  self.assertEqual((points, height, base, flags, style), (4, 3000, 250, 14, 7))
  # Decimetres from the tile origin (1000, -2000).
  self.assertEqual(struct.unpack_from('<8h', fragments_[0], 8), (-9990, 20020, -9890, 20020, -9890, 20320, -9990, 20320))
  self.assertEqual(rewrite(raw, lambda key, ordinal: parts[ordinal]), raw)


class WriteFarTest(unittest.TestCase):
 def test_build_metro_hides_complexes_without_fragments(self):
  spec = importlib.util.spec_from_file_location('metro', ROOT / 'scripts/build-metro.py');metro = importlib.util.module_from_spec(spec);spec.loader.exec_module(metro)
  def building(i, x, height):
   return {'id': f'BOS-TEST{i}', 'name': 'Test building', 'district': 'Back Bay', 'center': [x + 10, 10], 'footprint': [[x, 0], [x + 20, 0], [x + 20, 20], [x, 20]], 'height': height, 'baseElevation': 1.5}
  buildings = [building(0, 0, 12), building(1, 100, 120), building(2, 200, 60)]
  metro.MASSING_IDS.clear();metro.MASSING_IDS.add('BOS-TEST1')
  with tempfile.TemporaryDirectory() as tmp:
   out = pathlib.Path(tmp);metro.write_far(out, buildings);header, records = read_far(gzip.decompress((out / 'far.bin').read_bytes()))
  metro.MASSING_IDS.clear()
  self.assertEqual(header['tiles'][0]['count'], 3)
  self.assertEqual([r[6] & 12 for r in records['0_0']], [0, 4, 0])


if __name__ == '__main__':unittest.main()
