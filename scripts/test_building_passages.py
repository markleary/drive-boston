"""Geometry regressions for verified road passages, independent of city cache."""
import unittest
from unittest.mock import patch
import numpy as np
from building_passages import PASSAGES, apply_building_passages, passage_digest
from mesh_winding import orient_shells


def box():
 vertices = np.array([[-10, 0, -20], [10, 0, -20], [10, 0, 20], [-10, 0, 20],
                      [-10, 12, -20], [10, 12, -20], [10, 12, 20], [-10, 12, 20]], dtype=float)
 faces = np.array([[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
                   [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2],
                   [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]])
 return vertices, faces


def hits(vertices, faces, origin, direction):
 """Two-sided ray intersections, including the visible shell and its underside."""
 tri = vertices[faces];a = tri[:, 0];e1 = tri[:, 1]-a;e2 = tri[:, 2]-a
 direction = np.asarray(direction);h = np.cross(direction, e2);det = np.sum(e1*h, axis=1)
 valid = np.abs(det) > 1e-9;inv = np.zeros_like(det);inv[valid] = 1/det[valid]
 s = np.asarray(origin)-a;u = inv*np.sum(s*h, axis=1);q = np.cross(s, e1)
 v = inv*np.sum(direction*q, axis=1);distance = inv*np.sum(e2*q, axis=1)
 return sorted(distance[valid & (u >= -1e-8) & (v >= -1e-8) & (u+v <= 1+1e-8) & (distance > 1e-8)])


class BuildingPassagesTest(unittest.TestCase):
 def setUp(self):
  self.entry = {'id': 'test-passage', 'baseElevation': 0}
  self.spec = {'start': [0, -25], 'end': [0, 25], 'left': -2., 'right': 2.,
               'ceiling': 6., 'roads': ['test-road'], 'evidence': 'test fixture', 'clearanceEstimated': True}

 def corrected(self):
  vertices, faces = box()
  with patch.dict(PASSAGES, {self.entry['id']: self.spec}):
   return apply_building_passages(self.entry, vertices, faces)

 def test_open_passage_preserves_wings_upper_building_and_solid_soffit(self):
  vertices, faces, metadata = self.corrected()
  self.assertAlmostEqual(metadata['soffitArea'], 160.)
  # Exercise winding repair too: the compiler runs it after applying corrections.
  faces, _ = orient_shells(vertices, faces)
  for x in [-1.9, 0, 1.9]:
   for y in [.1, 3., 5.9]:
    for z, direction in [(-30, 1), (30, -1)]:
     self.assertEqual(hits(vertices, faces, [x, y, z], [0, 0, direction]), [])
  self.assertAlmostEqual(hits(vertices, faces, [0, 1, 0], [0, 1, 0])[0], 5.)
  self.assertAlmostEqual(hits(vertices, faces, [0, 7, -30], [0, 0, 1])[0], 10.)
  self.assertAlmostEqual(hits(vertices, faces, [5, 3, -30], [0, 0, 1])[0], 10.)
  self.assertAlmostEqual(hits(vertices, faces, [0, 3, 0], [1, 0, 0])[0], 2.)
  cap = vertices[faces]
  cap = cap[np.max(abs(cap[:, :, 1]-6), axis=1) < 1e-8]
  normals = np.cross(cap[:, 1]-cap[:, 0], cap[:, 2]-cap[:, 0])
  self.assertTrue(np.all(normals[:, 1] < 0), 'the exposed underside faces down after winding repair')

 def test_input_untouched_and_second_application_is_noop(self):
  vertices, faces = box();before_v = vertices.copy();before_f = faces.copy()
  with patch.dict(PASSAGES, {self.entry['id']: self.spec}):
   v, f, metadata = apply_building_passages(self.entry, vertices, faces)
   np.testing.assert_array_equal(vertices, before_v);np.testing.assert_array_equal(faces, before_f)
   again_v, again_f, again_meta = apply_building_passages({**self.entry, 'buildingPassage': metadata}, v, f)
  np.testing.assert_array_equal(v, again_v);np.testing.assert_array_equal(f, again_f)
  self.assertIsNone(again_meta)

 def test_unverified_building_is_never_carved(self):
  vertices, faces = box()
  v, f, metadata = apply_building_passages({'id': 'unverified-overlap'}, vertices, faces)
  np.testing.assert_array_equal(v, vertices);np.testing.assert_array_equal(f, faces)
  self.assertIsNone(metadata)

 def test_a_generated_passage_follows_a_ramp_down_and_ends_where_its_ceiling_meets_the_base(self):
  # A ramp diving under the building along z: 9 m of headroom at its mouth, the ceiling under the base 30 m in.
  vertices, faces = box();ramp = {'road': 'ramp', 'start': [0., -22.], 'end': [0., 22.], 'left': -4., 'right': 4., 'ceiling': 9., 'ceilingEnd': -3.}
  kept = [[[[-10., -20.], [10., -20.], [10., 20.], [-10., 20.], [-10., -20.]]]]
  v, f, metadata = apply_building_passages({'id': 'over-a-ramp', 'baseElevation': 0}, vertices, faces, [ramp], kept)
  self.assertEqual(metadata['roads'], ['ramp']);self.assertEqual(metadata['outline'], kept, 'the plan the uncut shell covered is kept for the stage that asked for the passage')
  cut = metadata['highway'][0];self.assertGreater(cut['cutSourceTriangles'], 0);self.assertEqual(metadata['digest'], passage_digest([ramp]))
  along = sorted({round(float(p[1]), 3) for p in cut['polygon']});self.assertAlmostEqual(along[-1], -22+44*(9-.05)/12, places=2, msg='the corridor stops where the ceiling comes down to the base')
  self.assertAlmostEqual(cut['soffitArea'], 8*(along[-1]+20), delta=.5)
  # Over the ramp the shell is open up to the falling ceiling, then closed by its soffit; beyond the passage and beside it the walls stand.
  for z in (-15., -5., 5.):
   ceiling = 9-12*(z+22)/44;up = hits(v, f, [0, .05, z], [0, 1, 0])
   self.assertAlmostEqual(up[0], ceiling-.05, places=3, msg='a ray up from the ramp meets the soffit at the ceiling')
  inside = hits(v, f, [0, 1, -30], [0, 0, 1]);beside = hits(v, f, [7, 1, -30], [0, 0, 1])
  self.assertAlmostEqual(inside[0], 8+44*(9-1)/12, places=3, msg='the mouth is open: a ray into it first meets the falling soffit')
  self.assertAlmostEqual(beside[0], 10, places=3, msg='beside the passage the front wall stands');self.assertEqual(len(beside), 2)
  again = apply_building_passages({'id': 'over-a-ramp', 'baseElevation': 0, 'buildingPassage': metadata}, v, f, [ramp])
  self.assertIsNone(again[2], 'a shell carved for these passages is left as it is')
  with self.assertRaises(ValueError):apply_building_passages({'id': 'over-a-ramp', 'baseElevation': 0, 'buildingPassage': metadata}, v, f, [{**ramp, 'ceiling': 8.}])

 def test_a_generated_passage_that_meets_no_solid_is_no_passage(self):
  vertices, faces = box()
  v, f, metadata = apply_building_passages({'id': 'beside-a-ramp', 'baseElevation': 0}, vertices, faces, [{'road': 'ramp', 'start': [40., -22.], 'end': [40., 22.], 'left': -4., 'right': 4., 'ceiling': 9., 'ceilingEnd': 6.}])
  self.assertIsNone(metadata);np.testing.assert_array_equal(v, vertices);np.testing.assert_array_equal(f, faces)


if __name__ == '__main__':unittest.main()
