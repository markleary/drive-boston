import unittest
import numpy as np
from building_clearance import RoadClearanceIndex, audit_building_clearance


def building():
 return {'id':'test','name':'test','center':[0,0],'footprint':[[-10,-10],[10,-10],[10,10],[-10,10]]}


def road(points=None,**kwargs):
 return {'id':'street','name':'Street','width':8,'points':points or [[-15,0],[15,0]],**kwargs}


def audit(vertices,faces=None):
 vertices=np.array(vertices,dtype=float)
 if faces is None:faces=np.array([[0,1,2],[0,2,3]])
 return audit_building_clearance(building(),vertices,faces,[road()],lambda x,z:0)['roads'][0]


class BuildingClearanceTests(unittest.TestCase):
 def test_road_crossing_selects_exact_mesh_and_records_stable_ids(self):
  b=building();roads=[road(id='b'),road([[0,-15],[0,15]],id='a')]
  result=RoadClearanceIndex(roads).mark([b])
  self.assertEqual(result,{'buildings':1,'roadOverlaps':2});self.assertEqual(b['collision'],'mesh');self.assertEqual(b['roadOverlaps'],['a','b'])
  self.assertEqual(RoadClearanceIndex(roads).mark([b]),result)

 def test_recomputed_metadata_drops_removed_road_but_keeps_explicit_mesh_choice(self):
  b=building();RoadClearanceIndex([road()]).mark([b]);RoadClearanceIndex([]).mark([b])
  self.assertNotIn('collision',b);self.assertNotIn('roadOverlaps',b)
  b['collision']='mesh';RoadClearanceIndex([]).mark([b]);self.assertEqual(b['collision'],'mesh')

 def test_boundary_touch_elevated_road_and_structure_are_not_ground_crossings(self):
  b=building()
  self.assertEqual(RoadClearanceIndex([road([[-15,10],[15,10]])]).overlaps(b),[])
  self.assertEqual(RoadClearanceIndex([road(elevations=[15,15])]).overlaps(b),[])
  b['structure']=True;self.assertEqual(RoadClearanceIndex([road()]).overlaps(b),[])

 def test_open_courtyard_and_overhead_link_are_distinguished(self):
  empty=audit([[-4,0,8],[4,0,8],[4,9,8],[-4,9,8]])
  self.assertEqual(empty['classification'],'open-hull');self.assertEqual(empty['carBlockedSweeps'],0)
  overhead=audit([[-4,6,-8],[4,6,-8],[4,6,8],[-4,6,8]])
  self.assertEqual(overhead['classification'],'overhead');self.assertEqual(overhead['busBlockedSweeps'],0)

 def test_vertical_wall_between_samples_is_detected(self):
  wall=audit([[.137,0,-8],[.137,0,8],[.137,9,8],[.137,9,-8]])
  self.assertEqual(wall['classification'],'source-obstruction');self.assertGreater(wall['carBlockedSweeps'],0)

 def test_lateral_obstruction_and_bus_only_low_soffit_are_detected(self):
  wall=audit([[.137,0,2],[.137,0,3.8],[.137,9,3.8],[.137,9,2]])
  self.assertGreater(wall['carBlockedSweeps'],0,'a clear centerline cannot hide a blocked lane')
  soffit=audit([[-4,3,-8],[4,3,-8],[4,3,8],[-4,3,8]])
  self.assertEqual(soffit['carBlockedSweeps'],0);self.assertGreater(soffit['busBlockedSweeps'],0)

 def test_buried_foundation_is_not_an_obstruction(self):
  report=audit([[-4,-1,-8],[4,-1,-8],[4,-1,8],[-4,-1,8]])
  self.assertEqual(report['classification'],'open-hull')


if __name__=='__main__':unittest.main()
