"""Parking stalls of the surface lots (scripts/parking_lots.py)."""
import math,unittest
from shapely.geometry import LineString,Polygon,box
import parking_lots as P


def rect(c,yaw,half_along=2.35,half_across=.95):
 """The footprint of a car at stall `c` heading `yaw` (hundredths of a degree)."""
 h=math.radians(yaw/100);f=(math.sin(h),math.cos(h));return Polygon(P.rectangle(c,f,half_along,half_across))


class FeaturesTest(unittest.TestCase):
 def way(self,tags,ring=True):
  pts=[(0,0),(40,0),(40,30),(0,30),(0,0)] if ring else [(0,15),(40,15)];return {'type':'way','tags':tags,'geometry':[{'lon':x,'lat':z} for x,z in pts]}
 def test_surface_lots_and_their_aisles_are_read(self):
  elements=[self.way({'amenity':'parking','parking':'surface'}),self.way({'amenity':'parking','parking':'multi-storey'}),self.way({'amenity':'parking','layer':'-1'}),
   self.way({'highway':'service','service':'parking_aisle'},False),self.way({'highway':'service','service':'driveway'},False),self.way({'amenity':'parking','access':'no'})]
  lots,aisles,roads=P.features(elements,lambda lon,lat:[lon,lat]);self.assertEqual((len(lots),len(aisles),len(roads)),(1,1,1))


class LayoutTest(unittest.TestCase):
 def test_rows_stand_square_to_an_aisle_on_both_sides(self):
  lot=box(0,0,60,18);aisle=LineString([(0,9),(60,9)]);found=P.stalls([lot],[aisle],[])
  self.assertEqual(len(found),2*int((60-.6)//P.STALL[0]));left=[s for s in found if s[1]>9];self.assertEqual(len(left)*2,len(found))
  self.assertTrue(all(abs(s[1]-(9+P.AISLE/2+P.STALL[1]/2))<.01 and s[2]==0 for s in left),'a row beyond the aisle, each car nose in, away from it')
  self.assertTrue(all(s[2]==18000 for s in found if s[1]<9))
  cars=[rect(s[:2],s[2]) for s in found];self.assertTrue(all(lot.contains(c) and c.distance(aisle)>=P.AISLE/2-.3 for c in cars),'inside the lot and clear of the aisle')
  self.assertTrue(all(not a.intersects(b) for i,a in enumerate(cars) for b in cars[i+1:]),'no two share ground')

 def test_a_lot_without_aisles_is_laid_out_in_rows_with_aisles_between(self):
  lot=box(0,0,80,2*P.STALL[1]+P.AISLE+1);found=P.stalls([lot],[],[]);rows=sorted({s[1] for s in found})
  self.assertEqual(len(rows),2);self.assertAlmostEqual(rows[1]-rows[0],P.AISLE+P.STALL[1],places=2);self.assertEqual(len(found),2*int((80-2*P.INSET)//P.STALL[0]))
  self.assertEqual({s[2] for s in found if s[1]==rows[0]},{18000},'the rows face each other across the aisle')

 def test_a_strip_too_shallow_for_a_stall_is_a_row_of_kerbside_bays(self):
  found=P.stalls([box(0,0,40,3)],[],[]);self.assertEqual(len(found),int((40-2*P.INSET)//P.BAY[1]));self.assertTrue(all(s[2] in (9000,27000) for s in found),'parked along it')

 def test_stalls_keep_clear_of_buildings_roadways_and_through_roads(self):
  lot=box(0,0,60,18);aisle=LineString([(0,9),(60,9)]);house=box(20,12,30,18);found=P.stalls([lot],[aisle],[],[house])
  self.assertTrue(all(not rect(s[:2],s[2]).intersects(house) for s in found));self.assertLess(len(found),2*22)
  through=LineString([(30,-5),(30,25)]);found=P.stalls([lot],[aisle],[through]);self.assertTrue(all(rect(s[:2],s[2]).distance(through)>=P.LANE/2-.1 for s in found),'the driveway through the lot stays open')

 def test_a_lot_for_a_car_or_two_is_left_empty_and_the_layout_is_stable(self):
  self.assertEqual(P.stalls([box(0,0,8.5,6.5)],[],[]),[]);lots=[box(0,0,60,18),box(100,0,160,40)];self.assertEqual(P.stalls(lots,[],[]),P.stalls(lots[::-1],[],[]),'whatever the order of the lots')

 def test_tiles_take_centimetres_from_their_origin(self):
  self.assertEqual(P.by_tile([(1001.5,-0.25,9000)],1000),{(1,-1):[150,99975,9000]})


if __name__=='__main__':unittest.main()
