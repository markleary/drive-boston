import unittest
import importlib.util
import pathlib
import tempfile
import numpy as np
import shapely
from shapely.geometry import Polygon
from building_undersides import close_undersides
from test_mesh_winding import cube
import tileformat


class UndersideTests(unittest.TestCase):
 def test_elevated_bottom_is_closed_downward_without_moving_any_vertex(self):
  p,f=cube(origin=(0,12,0),open_bottom=True);before=p.copy()
  out,repairs=close_undersides(p,f,0)
  self.assertEqual(len(repairs),1);self.assertEqual(repairs[0]['area'],100)
  np.testing.assert_array_equal(out[:len(f)],f);np.testing.assert_array_equal(p,before)
  cap=p[out[len(f):]];self.assertTrue(np.all(np.cross(cap[:,1]-cap[:,0],cap[:,2]-cap[:,0])[:,1]<0))
  self.assertTrue(np.all(cap[:,:,1]==12));self.assertEqual(close_undersides(p,out,0)[1],[])

 def test_ground_floor_complete_shell_upper_edge_and_open_walls_are_untouched(self):
  for origin,opened,base in [((0,0,0),True,0),((0,12,0),False,0),((0,12,0),True,12)]:
   p,f=cube(origin=origin,open_bottom=opened);out,repairs=close_undersides(p,f,base)
   np.testing.assert_array_equal(out,f);self.assertEqual(repairs,[])
  p,f=cube(origin=(0,12,0))
  for faces in [f[4:],f[:2],f[2:4],np.delete(f[2:],2,axis=0)]:
   out,repairs=close_undersides(p,faces,0)
   np.testing.assert_array_equal(out,faces);self.assertEqual(repairs,[])
  # One roof triangle covers only half the loop and cannot justify a floor.
  out,repairs=close_undersides(p,np.concatenate([f[2:3],f[4:]]),0)
  self.assertEqual(repairs,[])

 def test_material_seams_and_two_separate_parts_at_the_same_height(self):
  p,f=cube(origin=(0,12,0),open_bottom=True);q,g=cube(origin=(20,12,0),size=4,open_bottom=True)
  # Duplicate every vertex at material seams; adjacency is by position.
  positions=np.concatenate([p[f].reshape(-1,3),q[g].reshape(-1,3)])
  faces=np.arange(len(positions)).reshape(-1,3)
  out,repairs=close_undersides(positions,faces,0)
  self.assertEqual(len(repairs),2);self.assertEqual(sum(r['area'] for r in repairs),116)
  self.assertEqual(close_undersides(positions,out,0)[1],[])

 def test_courtyard_ring_is_not_filled(self):
  # A roof annulus and its outward exterior / inward courtyard walls.
  outer=[(0,0),(10,0),(10,10),(0,10)];hole=[(3,3),(3,7),(7,7),(7,3)]
  poly=Polygon(outer,[hole]);p=[];f=[]
  def emit(tri):
   f.append(list(range(len(p),len(p)+3)));p.extend(tri)
  for tri in shapely.get_parts(shapely.constrained_delaunay_triangles(poly)):
   points=[(x,22,z) for x,z in list(tri.exterior.coords)[:3]]
   if np.cross(np.array(points[1])-points[0],np.array(points[2])-points[0])[1]<0:points.reverse()
   emit(points)
  for ring in [outer,hole]:
   for (x,z),(xx,zz) in zip(ring,ring[1:]+ring[:1]):
    emit([(x,12,z),(xx,22,zz),(xx,12,zz)])
    emit([(x,12,z),(x,22,z),(xx,22,zz)])
  p=np.array(p);f=np.array(f);out,repairs=close_undersides(p,f,0)
  self.assertEqual(len(repairs),1);self.assertEqual(repairs[0]['area'],84)
  for tri in p[out[len(f):]]:
   self.assertTrue(poly.covers(Polygon(tri[:,[0,2]])))
  self.assertEqual(close_undersides(p,out,0)[1],[])

 def test_tile_packer_adds_roof_material_caps_and_preserves_structure_opt_out(self):
  p,f=cube(origin=(0,12,0),open_bottom=True)
  q,walls,roofs,scale=tileformat.mesh_record(p,f,[0,0,0],0)
  self.assertEqual(len(walls),8);self.assertEqual(len(roofs),4)
  self.assertEqual(close_undersides(q*scale,np.concatenate([walls,roofs]),0)[1],[])
  _,walls,roofs,_=tileformat.mesh_record(p,f,[0,0,0],0,repair_winding=False)
  self.assertEqual(len(walls),8);self.assertEqual(len(roofs),2)

 def test_packaged_repair_is_targeted_and_byte_idempotent(self):
  spec=importlib.util.spec_from_file_location('audit_shells',pathlib.Path(__file__).with_name('audit-building-shells.py'))
  audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
  p,f=cube(origin=(0,12,0),open_bottom=True)
  entries=[{'id':name,'anchor':[0,0,0],'baseElevation':0,'district':'test','center':[5,5]} for name in ['target','other']]
  record=tileformat.mesh_record(p,f,[0,0,0],0,repair_winding=False)
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);path=root/'tiles/t_0_0.bin'
   tileformat.write_tile(path,{'buildings':entries},[record,record])
   report=audit.run(root,repair=True,building_ids={'target'})
   self.assertEqual(report['missingUndersides'],1);self.assertEqual(report['changedTiles'],1)
   _,buildings=tileformat.read_tile(path)
   self.assertEqual([len(b['roof']) for b in buildings],[4,2])
   before=path.read_bytes();report=audit.run(root,repair=True,building_ids={'target'})
   self.assertEqual(report['changedTiles'],0);self.assertEqual(before,path.read_bytes())


if __name__=='__main__':unittest.main()
