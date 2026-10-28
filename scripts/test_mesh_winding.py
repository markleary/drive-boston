import unittest
import numpy as np
from mesh_winding import orient_shells
import tileformat


def cube(origin=(0,0,0),size=10,open_bottom=False):
 p=np.array([[0,0,0],[10,0,0],[10,0,10],[0,0,10],[0,10,0],[10,10,0],[10,10,10],[0,10,10]],dtype=float)*size/10+origin
 f=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]]
 # In X/Y-up/Z coordinates these initial faces point inwards.
 f=np.array(f)[:,[0,2,1]]
 return p,f[2:] if open_bottom else f


class WindingTests(unittest.TestCase):
 def test_outward_closed_and_open_bottom_shells_stay_unchanged(self):
  for opened in [False,True]:
   p,f=cube(open_bottom=opened);out,repairs=orient_shells(p,f)
   np.testing.assert_array_equal(out,f);self.assertEqual(repairs,[])

 def test_inverted_shells_repair_without_changing_positions_or_topology(self):
  for opened in [False,True]:
   p,f=cube(origin=(-1272,6.7,8984),open_bottom=opened);before=p.copy();inverted=f[:,[0,2,1]]
   out,repairs=orient_shells(p,inverted)
   np.testing.assert_array_equal(out,f);np.testing.assert_array_equal(p,before)
   self.assertEqual(len(repairs),1)
   self.assertEqual(orient_shells(p,out)[1],[],'repair is idempotent')

 def test_material_seams_and_separate_outward_parts(self):
  p,f=cube();q,g=cube((20,12,0),2)
  positions=np.concatenate([p[f[:,[0,2,1]]].reshape(-1,3),q[g].reshape(-1,3)])
  faces=np.arange(len(positions)).reshape(-1,3);out,repairs=orient_shells(positions,faces)
  self.assertEqual(len(repairs),1)
  np.testing.assert_array_equal(out[len(f):],faces[len(f):])

 def test_cavity_and_correct_downward_soffits_are_preserved(self):
  p,f=cube();q,g=cube((2,2,2),6)
  combined=np.concatenate([p,q]);faces=np.concatenate([f,g[:,[0,2,1]]+len(p)])
  out,repairs=orient_shells(combined,faces)
  np.testing.assert_array_equal(out,faces);self.assertEqual(repairs,[])
  # An open overhead sheet is not an occupied building volume.
  out,repairs=orient_shells(p,f[:2]);np.testing.assert_array_equal(out,f[:2]);self.assertEqual(repairs,[])

 def test_inconsistent_nonmanifold_mesh_is_not_guessed(self):
  p,f=cube();f=f[:,[0,2,1]];f[2]=f[2,[0,2,1]]
  out,repairs=orient_shells(p,f);np.testing.assert_array_equal(out,f);self.assertEqual(repairs,[])

 def test_tile_packer_repairs_imported_shells_and_can_preserve_open_structures(self):
  p,f=cube(open_bottom=True);inverted=f[:,[0,2,1]]
  q,walls,roofs,scale=tileformat.mesh_record(p,inverted,[0,0,0],0)
  self.assertEqual(orient_shells(q*scale,np.concatenate([walls,roofs]))[1],[])
  t=q.astype(float)[roofs]*scale
  self.assertTrue(np.all(np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0])[:,1]>0))
  q,walls,roofs,scale=tileformat.mesh_record(p,inverted,[0,0,0],0,repair_winding=False)
  self.assertEqual(len(orient_shells(q*scale,np.concatenate([walls,roofs]))[1]),1)


if __name__=='__main__':unittest.main()
