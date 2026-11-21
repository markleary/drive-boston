"""Geometry regressions for future OpenStreetMap extrusion builds."""
import importlib.util
import pathlib
import unittest
import numpy as np
import shapely
from shapely.geometry import LineString, Polygon, Point
from shapely.affinity import rotate, translate
import tileformat
from house_shapes import house_mesh
from roof_soffits import close_roof_soffits

spec=importlib.util.spec_from_file_location('metro',pathlib.Path(__file__).with_name('build-metro.py'))
metro=importlib.util.module_from_spec(spec);spec.loader.exec_module(metro)


class ExtrusionTests(unittest.TestCase):
 def test_pitched_attic_is_closed_above_a_recessed_wall(self):
  # A rectangular gable spans the 1 by 3 m recess at the front corner.
  poly=Polygon([(0,0),(7,0),(7,3),(8,3),(8,12),(0,12)])
  for styled in (False, True):
   with self.subTest(styled=styled):
    if styled:
     vertices,faces,mask,_=house_mesh(poly,10,6.9,'victorian')
    else:
     vertices,faces=metro.extrude(poly,10,6.9,{'building':'house'});mask=None
    record=tileformat.mesh_record(vertices,faces,[0,10,0],10,repair_winding=not styled,roof_mask=mask)
    closed=close_roof_soffits(record,6.9)
    extra=closed[0][closed[2][len(record[2]):]]*closed[3]
    self.assertTrue(len(extra))
    self.assertTrue(np.allclose(extra[:,:,1],6.9))
    self.assertTrue(np.all(np.cross(extra[:,1]-extra[:,0],extra[:,2]-extra[:,0])[:,1]<0))
    soffit=shapely.union_all(shapely.polygons(extra[:,:,(0,2)]))
    opening=poly.minimum_rotated_rectangle.difference(poly)
    self.assertLess(opening.difference(soffit).area,.001)
    self.assertTrue(opening.buffer(.035).covers(soffit))
    self.assertTrue(soffit.covers(Point(7.5,1.5)))
    self.assertIs(close_roof_soffits(closed,6.9),closed)

 def test_florence_street_left_front_recess_has_a_soffit_in_the_shipped_mesh(self):
  path=pathlib.Path(__file__).resolve().parents[1]/'public/data/tiles/t_0_-12.bin'
  _,buildings=tileformat.read_tile(path)
  house=next(b for b in buildings if b['id']=='osm-way-29627148')
  roof=house['positions'][house['roof']]
  horizontal=np.isclose(roof[:,:,1],house['baseElevation']+house['eaveHeight']).all(axis=1)
  down=np.cross(roof[:,1]-roof[:,0],roof[:,2]-roof[:,0])[:,1]<0
  soffit=shapely.union_all(shapely.polygons(roof[horizontal&down][:,:,(0,2)]))
  self.assertTrue(soffit.covers(Point(76.6,-11556.7)))
  # The rake's projection used to end 8.7 mm behind the gable near the left
  # tip. At street level that read as a dotted line of sky along the fascia.
  walls=house['positions'][house['facade']]
  eave=house['baseElevation']+house['eaveHeight']
  ends=walls[walls[:,:,1].max(axis=1)>eave+1]
  front=min(ends,key=lambda tri:tri[:,0].mean())
  edge=LineString(front[np.isclose(front[:,1],eave)][:,(0,2)])
  floor=shapely.union_all(shapely.polygons(roof[horizontal][:,:,(0,2)]))
  self.assertLess(edge.difference(floor).length,.001)
  # Also meet the *slope* all along the notched side wall. This diagonal
  # segment left six pinholes at the original street-level camera angle.
  slope_edge=LineString([(75.337,-11558.225),(86.007,-11552.075)])
  joint=LineString([slope_edge.interpolate(d) for d in (.7,2.8)])
  self.assertLess(joint.difference(soffit).length,.001)

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
