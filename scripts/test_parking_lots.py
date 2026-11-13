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

 def test_no_stall_touches_the_street_pavement_as_drawn(self):
  # A street along z -8 whose roadway is lopsided: 4 m to one side of its centre line and 12 m to the other, into the lot. The ribbon of the
  # median width about the centre line misses the lot; the pavement as drawn does not.
  lot=box(0,0,60,18);aisle=LineString([(0,9),(60,9)]);ribbon=LineString([(-10,-8),(70,-8)]).buffer(4,cap_style=2);pavement=box(-10,-12,70,4)
  self.assertEqual(P.stalls([lot],[aisle],[],[ribbon]),P.stalls([lot],[aisle],[]))
  found=P.stalls([lot],[aisle],[],[ribbon,pavement]);self.assertTrue(found and all(s[1]>9 for s in found),'only the row beyond the aisle is left')
  self.assertTrue(all(not Polygon(P.rectangle(s[:2],(0,1),P.STALL[1]/2-P.GAP,P.STALL[0]/2-P.GAP)).intersects(pavement) for s in found))
  self.assertEqual(P.misplaced(found,[pavement],[lot]),[]);wrong=P.misplaced(P.stalls([lot],[aisle],[]),[pavement],[lot])
  self.assertEqual({w[2] for w in wrong},{'in the street pavement'});self.assertEqual(len(wrong),len(found),'the whole near row stood in the street')

 def test_a_lot_is_laid_out_on_the_asphalt_that_is_drawn(self):
  lot=box(0,0,80,18);aisle=LineString([(0,9),(80,9)]);whole=P.stalls([lot],[aisle],[])
  # as the tile draws it, simplified and rounded by a few centimetres: the lot as mapped, stall for stall
  self.assertEqual(P.stalls([lot],[aisle],[],(),[lot.buffer(-.04)]),whole);self.assertEqual(P.stalls([lot],[aisle],[],(),[box(0,0,40,18),box(40,0,80,18)]),whole,'asphalt clipped at a tile border is one surface')
  # no asphalt (beyond the coverage): no stall
  self.assertEqual(P.stalls([lot],[aisle],[],(),[]),[]);self.assertEqual(P.stalls([lot],[aisle],[],(),[box(200,0,240,18)]),[])
  # across the coverage's edge: the half that is paved is a lot of its own
  half=[box(0,0,40,18)];found=P.stalls([lot],[aisle],[],(),half);self.assertEqual(found,P.stalls([box(0,0,40,18)],[aisle],[]))
  self.assertTrue(found and all(P.INSET-.01<=s[0]-P.STALL[0]/2 and s[0]+P.STALL[0]/2<=40-P.INSET+.01 for s in found),'inside the paved half, a stall\'s inset from its edge');self.assertEqual(P.misplaced(found,[],half),[])
  self.assertEqual({w[2] for w in P.misplaced(whole,[],half)},{'off the asphalt of its lot'});self.assertEqual(len(P.misplaced(whole,[],half)),len(whole)-len([s for s in whole if s[0]+P.STALL[0]/2<=40+P.ON_ASPHALT]))
  # cut around a sidewalk along one side (4 m of an aisle-less lot): the rows are centred in what is paved, not in the mapped outline
  plain=box(0,0,80,2*P.STALL[1]+P.AISLE+1+4);cut=[box(0,4,80,2*P.STALL[1]+P.AISLE+1+4)];found=P.stalls([plain],[],[],(),cut)
  self.assertEqual(found,P.stalls(cut,[],[]));self.assertEqual(len({s[1] for s in found}),2);self.assertTrue(all(s[1]-P.STALL[1]/2>=4+P.INSET-.01 for s in found))
  # a sliver of asphalt is no lot, nor is a patch too small for four cars; a strip deep enough for a bay is a row of kerbside bays
  self.assertEqual(P.stalls([lot],[aisle],[],(),[box(0,0,80,2)]),[]);self.assertEqual(P.stalls([lot],[aisle],[],(),[box(0,0,6,6)]),[])
  bays=P.stalls([lot],[aisle],[],(),[box(0,0,80,3)]);self.assertTrue(bays and all(s[2] in (9000,27000) and s[1]==1.5 for s in bays))
  # two parts: each its own rows, in a stable order
  parts=[box(0,0,30,18),box(50,0,80,18)];both=P.stalls([lot],[aisle],[],(),parts);self.assertEqual(both,P.stalls([lot],[aisle],[],(),parts[::-1]));self.assertTrue(any(s[0]<30 for s in both) and any(s[0]>50 for s in both) and not any(30<=s[0]<=50 for s in both))

 def test_a_lot_mapped_out_to_the_curb_keeps_its_stalls_off_the_street_sidewalk(self):
  # A lot along a street whose outline reaches the curb (z 0): the street's sidewalk band is drawn over its first 2.9 m, where the walkers pace.
  depth=2*P.STALL[1]+P.AISLE+1+2.9;lot=box(0,0,80,depth);band=box(-20,0,100,2.9);free=P.stalls([lot],[],[],(),[lot]);found=P.stalls([lot],[],[],[band],[lot])
  near=[s for s in free if s[1]-P.STALL[1]/2<2.9];self.assertTrue(near,'laid out as mapped, the first row stands on the band')
  ground=lambda stalls:[rect(s[:2],s[2],P.STALL[1]/2-P.GAP,P.STALL[0]/2-P.GAP) for s in stalls]
  self.assertTrue(all(not g.intersects(band) for g in ground(found)),'no stall touches the band');self.assertGreaterEqual(len(found),len(free)-len(near),'and the lot holds at least the row that was clear of it')
  self.assertEqual(P.misplaced(found,[],[lot],[band]),[]);wrong=P.misplaced(free,[],[lot],[band]);self.assertEqual({w[2] for w in wrong},{'on a street sidewalk'});self.assertEqual(len(wrong),len(near))
  # a band that stops short of the first stalls changes nothing; a strip of bays wholly under the band is left to the walkers
  self.assertEqual(P.stalls([lot],[],[],[box(-20,-3,100,.2)],[lot]),free);self.assertEqual(P.stalls([box(0,0,60,3)],[],[],[box(-10,0,70,2.9)],[box(0,0,60,3)]),[])
  # a street through the lot: no stall on its pavement or on either band, and stalls on both sides
  wide=box(0,0,80,60);street=box(-10,26,90,34);bands=[box(-10,23.1,90,26),box(-10,34,90,36.9)];split=P.stalls([wide],[],[],[street]+bands,[wide])
  sides=ground(split);self.assertTrue(any(g.bounds[3]<23.1 for g in sides) and any(g.bounds[1]>36.9 for g in sides))
  self.assertTrue(all(g.bounds[3]<=23.1 or g.bounds[1]>=36.9 for g in sides));self.assertEqual(P.misplaced(split,[street],[wide],bands),[])

 def test_a_lot_mapped_twice_is_laid_out_once_and_no_two_stalls_share_ground(self):
  lot=box(0,0,60,18);aisle=LineString([(0,9),(60,9)]);once=P.stalls([lot],[aisle],[]);self.assertEqual(P.crowded(once),[])
  # the same lot on a second way, its outline a little off: one layout, not two rows of cars through each other
  twice=P.stalls([lot,box(.4,-.3,60.2,18.1)],[aisle],[]);self.assertEqual(len(twice),len(once));self.assertEqual(P.crowded(twice),[])
  self.assertEqual(P.stalls([lot,lot],[aisle],[]),once,'an exact copy changes nothing');self.assertEqual(len(P.merged([lot,lot])),1)
  # a section of the lot mapped again inside it is the lot
  self.assertEqual(P.stalls([lot,box(10,0,30,18)],[aisle],[]),once);self.assertEqual(P.stalls([box(10,0,30,18),lot],[aisle],[]),once,'whatever their order')
  # what the package would hold with each laid out alone: the same stalls twice, which the check names
  doubled=once+once;pairs=P.crowded(doubled);self.assertEqual(len(pairs),len(once));self.assertEqual(pairs[0][0],pairs[0][1])
  self.assertEqual(len(P.crowded(once+[(once[0][0]+.6,once[0][1]+.3,once[0][2])])),2,'a car half a metre off stands in its stall and the next')
  # two lots that only overlap along their edges stay two lots, and the second keeps off the first's stalls
  left=box(0,0,40,18);right=box(36,0,80,18);rows=[LineString([(0,9),(40,9)]),LineString([(36,9),(80,9)])];both=P.stalls([left,right],rows,[])
  self.assertEqual(len(P.merged([left,right])),2);self.assertEqual(P.crowded(both),[]);self.assertTrue(any(s[0]<36 for s in both) and any(s[0]>42 for s in both))
  alone=P.stalls([left],rows[:1],[])+P.stalls([right],rows[1:],[]);self.assertTrue(P.crowded(alone),'laid out alone, their rows meet in the strip they share');self.assertLess(len(both),len(alone))
  # lots that only touch, or stand apart, are untouched
  apart=[box(0,0,40,18),box(40,0,80,18),box(200,0,240,18)];self.assertEqual([g.bounds for g in P.merged(apart)],[g.bounds for g in apart])

 def test_the_drawn_polygons_and_stalls_of_a_package_are_read_back(self):
  tiles={'0_0':{'tx':0,'tz':0,'size':1000,'driveways':[[[[0,0],[10,0],[10,10],[0,10]],[[4,4],[6,4],[6,6],[4,6]]]],'parking':[150,250,9000]},'1_-1':{'tx':1,'tz':-1,'size':1000,'streetPavement':[[[[1000,-10],[1010,-10],[1010,0],[1000,0]]]],'parking':[50,99950,0,150,99950,18000]}}
  drive=P.tile_polygons(tiles,'driveways');self.assertEqual(len(drive),1);self.assertAlmostEqual(drive[0].area,96);self.assertEqual(len(P.tile_polygons(tiles,'streetPavement')),1);self.assertEqual(P.tile_polygons(tiles,'islands'),[])
  self.assertEqual(P.in_world(tiles),[(1.5,2.5,9000),(1000.5,-.5,0),(1001.5,-.5,18000)]);self.assertEqual(P.by_tile(P.in_world(tiles),1000),{(0,0):[150,250,9000],(1,-1):[50,99950,0,150,99950,18000]})
  self.assertEqual(P.misplaced([],drive,drive),[])
  # an outline that crosses itself (two lobes) is repaired whole, not dropped or halved
  bow={'a':{'tx':0,'tz':0,'size':1000,'driveways':[[[[0,0],[10,10],[10,0],[0,10]]]]}};self.assertAlmostEqual(sum(g.area for g in P.tile_polygons(bow,'driveways')),50)

 def test_a_lot_for_a_car_or_two_is_left_empty_and_the_layout_is_stable(self):
  self.assertEqual(P.stalls([box(0,0,8.5,6.5)],[],[]),[]);lots=[box(0,0,60,18),box(100,0,160,40)];self.assertEqual(P.stalls(lots,[],[]),P.stalls(lots[::-1],[],[]),'whatever the order of the lots')

 def test_tiles_take_centimetres_from_their_origin(self):
  self.assertEqual(P.by_tile([(1001.5,-0.25,9000)],1000),{(1,-1):[150,99975,9000]})


if __name__=='__main__':unittest.main()
