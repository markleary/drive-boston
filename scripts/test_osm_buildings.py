"""Geometry regressions for future OpenStreetMap extrusion builds."""
import importlib.util
import pathlib
import unittest
import numpy as np
import shapely
from shapely.geometry import Polygon, Point
from shapely.affinity import rotate, translate
import tileformat

spec=importlib.util.spec_from_file_location('metro',pathlib.Path(__file__).with_name('build-metro.py'))
metro=importlib.util.module_from_spec(spec);spec.loader.exec_module(metro)


class ExtrusionTests(unittest.TestCase):
 def test_gables_face_out_and_both_roof_pitches_cover_the_rectangle(self):
  for dimensions in [(8,15),(15,8),(8,8)]:
   for angle in [0,17,90,181,256]:
    for reverse in [False,True]:
     with self.subTest(dimensions=dimensions,angle=angle,reverse=reverse):
      w,d=dimensions
      poly=translate(rotate(Polygon([(0,0),(w,0),(w,d),(0,d)]),angle),-2774,-4428)
      if reverse:poly=Polygon(list(poly.exterior.coords)[::-1])
      vertices,faces=metro.extrude(poly,22.631,7.2,{'building':'house'})
      record=tileformat.mesh_record(vertices,faces,[poly.centroid.x,22.631,poly.centroid.y],22.631)
      q,facade,roof,scale=record;p=q*scale+np.array([poly.centroid.x,22.631,poly.centroid.y]);ends=0;area=0;slopes=0
      for f in np.concatenate([facade,roof]):
       a,b,c=p[f];n=np.cross(b-a,c-a);length=np.linalg.norm(n)
       if max(a[1],b[1],c[1])<29.85:continue
       if abs(n[1])/length<.05:
        ends+=1;outward=((a+b+c)/3)[[0,2]]-[poly.centroid.x,poly.centroid.y]
        self.assertGreater(np.dot(n[[0,2]],outward),0,'culled gable end')
       else:
        self.assertGreater(n[1],0,'culled roof pitch');area+=n[1]/2;slopes+=1
      self.assertEqual(ends,2);self.assertEqual(slopes,4)
      self.assertAlmostEqual(area,poly.minimum_rotated_rectangle.area,delta=.3)

 def test_concave_walls_and_courtyard_normals_point_outside(self):
  shapes=[Polygon([(0,0),(10,0),(10,3),(3,3),(3,10),(0,10)]),
          Polygon([(0,0),(15,0),(15,15),(0,15)],holes=[[(4,4),(11,4),(11,11),(4,11)]])]
  for poly in shapes:
   for reversed_poly in [poly,shapely.reverse(poly)]:
    v,f=metro.extrude(reversed_poly,0,9,{'building':'commercial'})
    p=np.asarray(v)
    for face in f:
     a,b,c=p[face];n=np.cross(b-a,c-a)
     if abs(n[1])>1e-8:continue
     sample=((a+b+c)/3)[[0,2]]+n[[0,2]]/np.linalg.norm(n)*.001
     self.assertFalse(poly.contains(Point(sample)),'wall faces into solid building')


if __name__=='__main__':unittest.main()
