import unittest
import numpy as np
from mesh_winding import orient_patches,orient_shells
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


def outward(p,f):
 """Horizontal normal direction of each face relative to the shell's centre (positive = outward)."""
 t=p[f];n=np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0]);c=t.mean(axis=1)-p.mean(axis=0)
 return n[:,0]*c[:,0]+n[:,2]*c[:,2]


class PatchTests(unittest.TestCase):
 def test_outward_shells_with_rooftop_box_eaves_partition_and_soffit_abstain(self):
  p,f=cube(open_bottom=True);q,g=cube((3,10,3),2)
  # A roof slab overhanging the walls by a metre: its underside is a correct soffit.
  r,h=cube((-1,9.5,-1),12);r[:,1]=np.where(r[:,1]>10,10.5,9.5)
  # An interior partition is covered on both sides and must not vote.
  wall=np.array([[5,0,2],[5,0,8],[5,9,8],[5,9,2]],dtype=float);w=np.array([[0,1,2],[0,2,3]])
  positions=np.concatenate([p,q,r,wall]);faces=np.concatenate([f,g+len(p),h+len(p)+len(q),w+len(p)+len(q)+len(r)])
  out,repairs=orient_patches(positions,faces);np.testing.assert_array_equal(out,faces);self.assertEqual(repairs,[])
  for opened in [False,True]:
   p,f=cube(open_bottom=opened);out,repairs=orient_patches(p,f);np.testing.assert_array_equal(out,f);self.assertEqual(repairs,[])

 def test_inverted_walls_under_a_sky_facing_roof_are_reversed_alone(self):
  p,f=cube(open_bottom=True);walls=f.copy();walls[2:]=walls[2:][:,[0,2,1]]
  self.assertTrue(np.all(outward(p,walls)[2:]<0));self.assertEqual(orient_shells(p,walls)[1],[],'the roof is right, so no component is inverted')
  out,repairs=orient_patches(p,walls)
  np.testing.assert_array_equal(out,f);self.assertEqual(len(repairs),1);self.assertEqual(repairs[0]['triangles'],8)
  self.assertEqual(orient_patches(p,out)[1],[],'repair is idempotent')

 def test_inverted_shell_with_one_inconsistent_face_is_reversed_as_patches(self):
  p,f=cube();inverted=f[:,[0,2,1]];inverted[2]=inverted[2,[0,2,1]]
  self.assertEqual(orient_shells(p,inverted)[1],[],'the component repair does not guess at inconsistent shells')
  out,repairs=orient_patches(p,inverted);np.testing.assert_array_equal(out,f);self.assertEqual(len(repairs),1)

 def test_small_slivers_and_open_canopies_are_left_alone(self):
  p,f=cube(open_bottom=True);sliver=np.array([[10,2,4],[10,2,4.8],[10,3,4.8]],dtype=float)
  positions=np.concatenate([p,sliver]);faces=np.concatenate([f,[[len(p),len(p)+1,len(p)+2]]])
  self.assertTrue(outward(positions,faces)[-1]<0,'the sliver faces inwards')
  out,repairs=orient_patches(positions,faces);np.testing.assert_array_equal(out,faces);self.assertEqual(repairs,[])
  # A lone sheet high above the ground has nothing to tell which side is the building.
  sheet=np.array([[0,8,0],[6,8,0],[6,8,6],[0,8,6]],dtype=float);down=np.array([[0,1,2],[0,2,3]])
  self.assertTrue(np.cross(sheet[1]-sheet[0],sheet[2]-sheet[0])[1]<0)
  out,repairs=orient_patches(sheet,down);self.assertEqual(len(repairs),1,'a down-facing top with nothing above it is an inverted roof')

 def test_membrane_tray_resting_on_a_visible_roof_keeps_its_rim(self):
  # A down-facing sheet 10 cm above the roof with an upturned outward rim: the roof
  # below already shows, and reversing the tray would turn the parapet rim inwards.
  p,f=cube(open_bottom=True);tray=np.array([[0,10.1,0],[10,10.1,0],[10,10.1,10],[0,10.1,10],[0,11,0],[10,11,0],[10,11,10],[0,11,10]],dtype=float)
  t=np.array([[0,1,2],[0,2,3]]);rim=[]
  for a,b in [(0,1),(1,2),(2,3),(3,0)]:rim+=[[b,a,a+4],[b,a+4,b+4]]
  rim=np.array(rim);r=tray[rim];outward_rim=np.cross(r[:,1]-r[:,0],r[:,2]-r[:,0]);c=r.mean(axis=1)-[5,10,5]
  self.assertTrue(np.all(outward_rim[:,0]*c[:,0]+outward_rim[:,2]*c[:,2]>0));self.assertTrue(np.cross(tray[1]-tray[0],tray[2]-tray[0])[1]<0)
  positions=np.concatenate([p,tray]);faces=np.concatenate([f,t+len(p),rim+len(p)])
  out,repairs=orient_patches(positions,faces);np.testing.assert_array_equal(out,faces);self.assertEqual(repairs,[])
  # Lifted clear of the roof, the same tray is an inverted upper deck.
  lifted=positions.copy();lifted[len(p):,1]+=1
  self.assertEqual(len(orient_patches(lifted,faces)[1]),1)

 def test_tile_packer_reverses_inward_walls(self):
  p,f=cube(open_bottom=True);walls=f.copy();walls[2:]=walls[2:][:,[0,2,1]]
  q,facade,roofs,scale=tileformat.mesh_record(p,walls,[0,0,0],0)
  self.assertTrue(np.all(outward(q.astype(float)*scale,facade)>0));self.assertEqual(len(facade),8);self.assertEqual(len(roofs),2)


if __name__=='__main__':unittest.main()
