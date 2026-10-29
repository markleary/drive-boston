import unittest
from road_structure_clearance import clearance_issues,validate_bridge_clearance


def roads(height=5,layer=1):
 return [
  {'id':'upper','points':[[-10,0],[10,0]],'elevations':[height,height],'bridge':{'sourceLayer':layer,'thickness':.75}},
  {'id':'lower','points':[[0,-10],[0,10]]},
 ]


class RoadStructureClearanceTests(unittest.TestCase):
 def test_bare_earth_bridge_collapsed_onto_lower_road_is_rejected(self):
  with self.assertRaisesRegex(ValueError,'upper above lower.*-0.75 m'):validate_bridge_clearance(roads(0),lambda x,z:0)

 def test_slab_underside_not_only_driving_surface_must_clear_lower_road(self):
  with self.assertRaisesRegex(ValueError,'2.25 m'):validate_bridge_clearance(roads(3),lambda x,z:0)
  self.assertEqual(validate_bridge_clearance(roads(3.25),lambda x,z:0),1)

 def test_lower_ground_height_and_ramp_interpolation_are_used(self):
  r=roads();r[0]['elevations']=[2,8]
  self.assertEqual(validate_bridge_clearance(r,lambda x,z:1),1)
  issues,checked=clearance_issues(r,lambda x,z:2)
  self.assertEqual(checked,1);self.assertEqual(issues[0]['clearance'],2.25)

 def test_upper_source_layer_is_retained_without_treating_it_as_metres(self):
  self.assertEqual(validate_bridge_clearance(roads(5,2),lambda x,z:0),1)
  r=roads(0);r[0]['bridge'].pop('sourceLayer')
  self.assertEqual(validate_bridge_clearance(r,lambda x,z:0),0)

 def test_connected_source_junction_does_not_need_overpass_clearance(self):
  r=roads(0);r[0]['points']=[[-10,0],[0,0],[10,0]];r[0]['elevations']=[0,0,0];r[1]['points']=[[0,-10],[0,0]]
  self.assertEqual(validate_bridge_clearance(r,lambda x,z:0),0)

 def test_bridge_continuation_on_same_layer_is_not_a_lower_street(self):
  r=roads(0);r[1]['bridge']={'sourceLayer':1};r[1]['elevations']=[0,0]
  self.assertEqual(validate_bridge_clearance(r,lambda x,z:0),0)

 def test_tagged_bridge_cannot_silently_lose_its_profile(self):
  r=roads();r[0].pop('elevations')
  with self.assertRaisesRegex(ValueError,'no deck profile'):validate_bridge_clearance(r,lambda x,z:0)


if __name__=='__main__':unittest.main()
