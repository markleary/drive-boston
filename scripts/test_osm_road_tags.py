import unittest
from osm_road_tags import bridge_source_layer,road_width,source_layer,width_metres


class OsmRoadTagsTests(unittest.TestCase):
 def test_memorial_single_lane_slip_road_does_not_inherit_whole_corridor_width(self):
  tags={'highway':'trunk_link','width':'30.5','lanes':'1'}
  self.assertEqual(road_width(tags,8),5)

 def test_link_lane_check_preserves_credible_shoulders_and_multiple_lanes(self):
  self.assertEqual(road_width({'highway':'primary_link','width':'6','lanes':'1'},8),6)
  self.assertEqual(road_width({'highway':'primary_link','width':'10','lanes':'2'},8),10)
  self.assertEqual(road_width({'highway':'primary_link','width':'30.5','lanes':'2'},8),7.6)

 def test_other_road_classes_keep_explicit_widths_and_existing_defaults(self):
  self.assertEqual(road_width({'highway':'primary','width':'16.1','lanes':'3'},13),16)
  self.assertEqual(road_width({'highway':'trunk_link','width':'12.2'},8),12.2)
  self.assertEqual(road_width({'highway':'trunk_link'},8),8)
  self.assertEqual(road_width({'highway':'primary','lanes':'2'},13),7.6)

 def test_width_units_are_not_discarded(self):
  self.assertAlmostEqual(width_metres('27\'0"'),8.2296)
  self.assertAlmostEqual(width_metres('12\'6"'),3.81)
  self.assertAlmostEqual(width_metres('27 ft'),8.2296)
  self.assertEqual(width_metres('6.5 m'),6.5)
  for value in ('unknown','6;8','6 lanes','0','-3',None):self.assertIsNone(width_metres(value))

 def test_invalid_dimension_falls_back_to_lanes_then_class(self):
  self.assertEqual(road_width({'highway':'primary_link','width':'unknown','lanes':'2'},8),7.6)
  self.assertEqual(road_width({'highway':'primary_link','width':'6;8','lanes':'1;2'},8),8)

 def test_layer_is_retained_as_topology_without_becoming_a_ground_endpoint_height(self):
  self.assertEqual(source_layer({'bridge':'yes','layer':'1'}),1)
  self.assertEqual(source_layer({'layer':'-1'}),-1)
  self.assertEqual(source_layer({'layer':'+2'}),2)
  self.assertEqual(source_layer({'layer':'unknown'}),0)
  self.assertEqual(source_layer({}),0)

 def test_bridge_without_explicit_layer_keeps_crossing_order_for_clearance_audit(self):
  self.assertEqual(bridge_source_layer({'bridge':'yes'}),1)
  self.assertEqual(bridge_source_layer({'bridge':'yes','layer':'0'}),0)
  self.assertEqual(bridge_source_layer({'layer':'2'}),2)
  self.assertIsNone(bridge_source_layer({'bridge':'no'}))
  self.assertIsNone(bridge_source_layer({}))


if __name__=='__main__':unittest.main()
