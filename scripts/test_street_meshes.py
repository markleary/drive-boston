import copy,unittest
import numpy as np
from shapely.geometry import Polygon,box,Point,LineString
from shapely.ops import unary_union
from street_meshes import strip,install_surfaces,weld_records,normalize_overlays
from street_surfaces import road_key


class CompiledSurfaces(unittest.TestCase):
 def test_serialized_bow_tie_overlays_are_valid_before_triangulation(self):
  headers={'tile':{'sidewalks':[{'rings':[[[0,0],[4,4],[0,4],[4,0]]],'material':'brick'}],'islands':[],'driveways':[]}}
  normalize_overlays(headers);walks=headers['tile']['sidewalks']
  self.assertEqual(len(walks),2);self.assertTrue(all(w['material']=='brick' and Polygon(w['rings'][0],w['rings'][1:]).is_valid for w in walks))
  snapshot=copy.deepcopy(headers);normalize_overlays(headers);self.assertEqual(snapshot,headers)

 def test_continuation_ends_weld_without_snapping_a_narrow_branch(self):
  roads=[{'id':'a','name':'Street','points':[[-20,0],[0,0]],'width':16},{'id':'b','name':'Street','points':[[0,0],[20,0]],'width':16},{'id':'c','name':'Street','points':[[0,0],[0,20]],'width':8}]
  records={road_key(roads[0]):{'left':np.array([[-20,10],[-4,10],[0,10]],float),'right':np.array([[-20,-10],[-4,-10],[0,-10]],float)},road_key(roads[1]):{'left':np.array([[0,8],[4,8],[20,8]],float),'right':np.array([[0,-8],[4,-8],[20,-8]],float)},road_key(roads[2]):{'left':np.array([[-4,0],[-4,20]],float),'right':np.array([[4,0],[4,20]],float)}}
  branch=copy.deepcopy(records[road_key(roads[2])]);self.assertEqual(weld_records(roads,records,road_key),1)
  for side in ('left','right'):
   np.testing.assert_array_equal(records[road_key(roads[0])][side][-1],records[road_key(roads[1])][side][0])
   np.testing.assert_array_equal(records[road_key(roads[2])][side],branch[side])
  self.assertEqual(weld_records(roads,records,road_key),0,'repeated compilation keeps the same endpoints')

 def test_folded_offset_sweep_is_valid_and_keeps_both_sides(self):
  left=np.array([[0,5],[10,5],[5,10]],float);right=np.array([[0,-5],[10,-5],[15,10]],float)
  shape=strip(left,right)
  self.assertTrue(shape.is_valid)
  self.assertTrue(shape.covers(Point(9,7)))
  self.assertGreater(shape.area,100)

 def test_junction_closes_and_tile_seams_share_the_same_polygon_boundary(self):
  roads=[{'id':'a','name':'a','points':[[-20,0],[0,0]],'width':8},{'id':'b','name':'b','points':[[0,0],[15,15]],'width':8}]
  records={road_key(roads[0]):{'left':np.array([[-20,4],[0,4]]),'right':np.array([[-20,-4],[0,-4]])},road_key(roads[1]):{'left':np.array([[-3,3],[12,18]]),'right':np.array([[3,-3],[18,12]])}}
  headers={f'{x}_{z}':{'tx':x,'tz':z,'size':10} for x in range(-3,3) for z in range(-1,3)}
  source=copy.deepcopy(headers);stats=install_surfaces(headers,roads,records,road_key)
  self.assertGreater(stats['junctionParts'],0)
  def shape(tile,field):return unary_union([Polygon(r[0],r[1:]) for r in tile[field]])
  for tile in headers.values():
   asphalt=shape(tile,'streetPavement');walk=shape(tile,'streetSidewalks')
   self.assertTrue(asphalt.is_valid);self.assertTrue(walk.is_valid)
   self.assertLess(asphalt.intersection(walk).area,1e-8)
  boundary=LineString([[0,-10],[0,10]])
  self.assertLess(shape(headers['-1_0'],'streetPavement').intersection(boundary).symmetric_difference(shape(headers['0_0'],'streetPavement').intersection(boundary)).length,.005)
  install_surfaces(source,list(reversed(roads)),records,road_key)
  self.assertEqual(headers,source,'road order must not change serialized polygon rings')

 def test_junction_fill_respects_a_sidewalk_island(self):
  roads=[{'id':'a','name':'a','points':[[-20,0],[0,0]],'width':8},{'id':'b','name':'b','points':[[0,0],[0,20]],'width':8}]
  records={road_key(roads[0]):{'left':np.array([[-20,4],[0,4]]),'right':np.array([[-20,-4],[0,-4]])},road_key(roads[1]):{'left':np.array([[-4,0],[-4,20]]),'right':np.array([[4,0],[4,20]])}}
  tile={'0':{'tx':-1,'tz':-1,'size':100}}
  install_surfaces(tile,roads,records,road_key,[box(-5,-5,-4,-4)])
  self.assertFalse(unary_union([Polygon(r[0],r[1:]) for r in tile['0']['streetPavement']]).contains(Point(-4.5,-4.5)))

if __name__=='__main__':unittest.main()
