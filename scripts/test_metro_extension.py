"""Terrain continuity and reproducibility for the additive Chelsea package."""
import gzip,importlib.util,pathlib,tempfile,unittest
import numpy as np

ROOT=pathlib.Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location('metro_extension',ROOT/'merge-metro-extension.py')
extension=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(extension)


class ExtensionTerrainTest(unittest.TestCase):
 def setUp(self):
  self.grid={'width':81,'height':61,'cellSize':5,'originX':-200,'originZ':-150}
  z,x=np.indices((61,81));self.base=(x*3-z*2-1700).astype('<i2').reshape(-1)
  self.fresh=(self.base.astype(np.int32)+800).astype('<i2')
  self.road={'id':'new-chelsea-street','points':[[-80,0],[80,0]],'width':10}

 def index(self,x,z):return int((z+150)/5)*81+int((x+200)/5)

 def test_outer_terrain_is_exact_and_the_whole_pavement_corridor_is_graded(self):
  merged,weights=extension.blend_extension(self.grid,self.base,self.fresh,[self.road])
  self.assertTrue(np.any(weights==0));self.assertTrue(np.any(weights==1))
  np.testing.assert_array_equal(merged[weights==0],self.base[weights==0])
  np.testing.assert_array_equal(merged[weights==1],self.fresh[weights==1])
  # The 30/90 m distances start at the pavement edge, not its centerline.
  self.assertEqual(weights[self.index(0,35)],1)
  self.assertEqual(weights[self.index(0,95)],0)
  self.assertEqual(merged[self.index(0,95)],self.base[self.index(0,95)])
  self.assertTrue(np.all(merged>=self.base));self.assertTrue(np.all(merged<=self.fresh))

 def test_transition_is_symmetric_monotone_and_eases_into_both_fixed_grids(self):
  _,weights=extension.blend_extension(self.grid,self.base,self.fresh,[self.road])
  cross=np.array([weights[self.index(0,z)] for z in range(35,96,5)])
  self.assertTrue(np.all(np.diff(cross)<=0))
  for z in range(0,151,5):self.assertEqual(weights[self.index(0,z)],weights[self.index(0,-z)])
  slope=-np.diff(cross)
  self.assertLess(slope[0],slope[5]/3)
  self.assertLess(slope[-1],slope[5]/3)
  # Finite segment ends receive the same radial transition as the side edges.
  self.assertEqual(weights[self.index(115,0)],1)
  self.assertEqual(weights[self.index(175,0)],0)

 def test_overlaps_and_road_order_are_deterministic(self):
  second={'id':'cross-street','points':[[30,-100],[30,100]],'width':18}
  first,weights=extension.blend_extension(self.grid,self.base,self.fresh,[self.road,second])
  again,reversed_weights=extension.blend_extension(self.grid,self.base,self.fresh,[second,self.road])
  np.testing.assert_array_equal(first,again);np.testing.assert_array_equal(weights,reversed_weights)
  _,one=extension.blend_extension(self.grid,self.base,self.fresh,[self.road])
  self.assertTrue(np.all(weights>=one))
  self.assertTrue(np.all((weights>=0)&(weights<=1)))

 def test_elevated_roads_do_not_regrade_the_ground(self):
  bridge={**self.road,'elevations':[25,25]}
  merged,weights=extension.blend_extension(self.grid,self.base,self.fresh,[bridge])
  np.testing.assert_array_equal(merged,self.base);self.assertEqual(np.count_nonzero(weights),0)

 def test_int16_grid_round_trip_and_compressed_bytes_are_reproducible(self):
  first,_=extension.blend_extension(self.grid,self.base,self.fresh,[self.road])
  second,_=extension.blend_extension(self.grid,self.base,self.fresh,[self.road])
  with tempfile.TemporaryDirectory() as directory:
   a=pathlib.Path(directory)/'first.bin';b=pathlib.Path(directory)/'second.bin'
   extension.write_gzip(a,first.tobytes());extension.write_gzip(b,second.tobytes())
   self.assertEqual(a.read_bytes(),b.read_bytes())
   np.testing.assert_array_equal(np.frombuffer(gzip.decompress(a.read_bytes()),dtype='<i2'),first)


if __name__=='__main__':unittest.main()
