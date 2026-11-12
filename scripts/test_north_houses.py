import pathlib,random,re,unittest
from shapely.geometry import LineString,Polygon
from shapely.strtree import STRtree
from building_semantics import house_palette
from house_driveways import WALK,WIDEST,house_driveways,street_frame
from house_shapes import FORMS,eave_height,house_mesh,parse_stories,typology

ROOT=pathlib.Path(__file__).resolve().parents[1]


def street(name,points,width):return {'id':name,'points':points,'width':width}


def far_streets(seed,count,band=(-4000,4000)):
 """Streets 300 m or more north or south of the origin the houses of these tests stand at, their x inside `band`."""
 rng=random.Random(seed);out=[]
 for k in range(count):
  side=rng.choice((-1,1));points=[[rng.uniform(*band),side*rng.uniform(300,4000)]]
  for _ in range(rng.randint(1,4)):points.append([min(band[1],max(band[0],points[-1][0]+rng.uniform(-60,60))),points[-1][1]+side*rng.uniform(5,60)])
  out.append(street(f'far-{seed}-{k}',points,rng.choice((6,8,12))))
 return out


def road_lists(near):
 """The streets near a house alone, then among unrelated ones: listed after them, before them and around them (in
 their own order), and with two of the unrelated streets taken out again. A band of streets between the x of the
 near ones parts them in a tree packed by x."""
 yield near
 for seed,count,band in [(1,2,(-4000,4000)),(2,30,(-4000,4000)),(3,12,(-20,65)),(4,160,(-20,65)),(5,400,(-4000,4000))]:
  far=far_streets(seed,count,band);yield near+far;yield far+near
  rng=random.Random(seed);mixed=far[:]
  for k,at in enumerate(sorted(rng.randrange(len(far)+1) for _ in near)):mixed.insert(at+k,near[k])
  yield mixed;yield [r for r in mixed if r not in far[:2]]


class NorthHouseTests(unittest.TestCase):
 def test_far_city_paint_matches_the_renderer(self):
  # tests/north-houses.test.mjs pins the same indices for housePalette() in src/render/house-styles.ts.
  cases=[{'id':'osm-way-29809314','houseStyle':'victorian','yearBuilt':1890},{'id':'osm-way-555','houseStyle':'two-family','yearBuilt':1900},{'id':'osm-way-556','houseStyle':'old-style','yearBuilt':1830},{'id':'x1','houseStyle':'ranch'},{'id':'osm-way-1','houseStyle':'garage'}]
  self.assertEqual([house_palette(c) for c in cases],[17,13,13,17,12])

 def test_renderer_storey_heights_match_the_shell_forms(self):
  text=(ROOT/'src/render/house-styles.ts').read_text();record=re.search(r'const FLOOR:Record<string,number>=\{([^}]*)\}',text).group(1)
  floors={k.strip("'"):float(v) for k,v in re.findall(r"('?[\w-]+'?):([\d.]+)",record)}
  self.assertEqual(floors,{kind:form[2] for kind,form in FORMS.items()})

 def test_assessor_styles_and_storeys(self):
  self.assertEqual(typology('VICTORIAN'),'victorian')
  self.assertEqual(typology('2 FAMILY'),'two-family')
  self.assertEqual(typology('CAPE COD'),'cape')
  self.assertEqual(typology('',1890,'1010'),'old-style')
  self.assertEqual(typology('',1950,'1010'),'colonial')
  self.assertIsNone(typology('OFFICE BLDG',1950,'340'))
  self.assertEqual(parse_stories('2.5'),(2.0,True))
  self.assertEqual(parse_stories('2A'),(2.0,True))
  self.assertEqual(parse_stories('1'),(1.0,False))
  self.assertEqual(parse_stories(None),(None,False))
  self.assertEqual(eave_height('victorian',None,False),6.9)
  self.assertEqual(eave_height('cape',None,False),3.3)

 def test_a_colonial_shell_keeps_its_walls_and_gable_over_its_footprint(self):
  footprint=Polygon([(0,0),(12,0),(12,8),(0,8)]);vertices,faces,roof,meta=house_mesh(footprint,10,eave_height('colonial',2,False),'colonial',seed=3,stories=2)
  self.assertEqual(meta['roof'],'gable');self.assertEqual(meta['parts'],1)
  self.assertTrue(any(roof) and not all(roof),'wall and roof faces')
  eave=10+eave_height('colonial',2,False);top=max(v[1] for v in vertices)
  self.assertGreater(top,eave+2,'a 38 degree gable over an 8 m span rises about 3 m')
  self.assertTrue(all(-1<v[0]<13 and -1<v[2]<9 for v in vertices),'no vertex beyond the eave overhang')
  self.assertTrue(all(len({*f})==3 for f in faces))

 def test_flat_three_decker(self):
  vertices,faces,roof,meta=house_mesh(Polygon([(0,0),(7,0),(7,14),(0,14)]),0,eave_height('three-decker',3,False),'three-decker')
  self.assertEqual(meta['roof'],'flat');self.assertAlmostEqual(max(v[1] for v in vertices),.6+3*2.95)


class HouseDrivewayTests(unittest.TestCase):
 def frame(self,center,roads):
  segments=[(LineString([a,b]),ri) for ri,r in enumerate(roads) for a,b in zip(r['points'],r['points'][1:])]
  frame,edge,ri=street_frame(center,segments,STRtree([s for s,_ in segments]),roads,{},lambda r:r['id'])
  return roads[ri]['id'],frame.q.tolist(),frame.t.tolist(),frame.n.tolist(),edge

 def test_a_house_takes_the_same_street_whatever_unrelated_roads_the_list_holds(self):
  # Each house is exactly as near two or three segments, and their order in the tree changes with the rest of the list.
  cases=[
   # Off the outside of a bend, nearest the vertex: the eastward segment's centre lies further north (lower z).
   ('a bend',[street('bend',[[10,30],[40,0],[80,0]],8)],(35,-17),('bend',[40,0],[1,0],[0,-1],4)),
   # North of a fork, nearest its node on all three legs: two centres are equally far north, the western (lower x) one is taken.
   ('a fork',[street('south-west',[[0,0],[-30,30]],8),street('south',[[0,0],[0,42.5]],10),street('south-east',[[30,30],[0,0]],12)],(0,-20),('south-west',[0,0],[-.5**.5,.5**.5],[-.5**.5,-.5**.5],4)),
   # Beside one line listed twice, the second time reversed: the same centre, so the earlier in the list.
   ('a street listed twice',[street('first',[[0,0],[50,0]],8),street('second',[[50,0],[0,0]],12)],(20,-15),('first',[20,0],[1,0],[0,-1],4))]
  for name,near,house,(road,q,t,n,edge) in cases:
   alone=self.frame(house,near);self.assertEqual((alone[0],alone[4]),(road,edge),name)
   for found,expected in zip(alone[1:4],(q,t,n)):
    for a,b in zip(found,expected):self.assertAlmostEqual(a,b,places=12,msg=name)
   for k,roads in enumerate(road_lists(near)):self.assertEqual(self.frame(house,roads),alone,f'{name}: list {k} of {len(roads)} roads')

 def test_a_driveway_is_laid_out_the_same_whatever_unrelated_roads_the_list_holds(self):
  # The house off the bend, on a parcel with the wider side yard to the west: its lane runs square to the eastward segment.
  house={'id':'osm-way-1','district':'Malden','houseStyle':'colonial','footprint':[[30,-22],[40,-22],[40,-12],[30,-12]]};parcel=Polygon([(22,-26),(44,-26),(44,-5),(22,-5)])
  laid=[]
  for roads in road_lists([street('bend',[[10,30],[40,0],[80,0]],8)]):
   lanes,cuts=house_driveways([house],[parcel],roads,{},lambda r:r['id']);laid.append(([list(l.exterior.coords) for l in lanes],[list(c.exterior.coords) for c in cuts]))
  self.assertEqual((len(laid[0][0]),len(laid[0][1])),(1,1))
  for found,expected in zip(Polygon(laid[0][0][0]).bounds,(40-10-.6-WIDEST,-(22+1.5),40-10-.6,-(4+WALK))):self.assertAlmostEqual(found,expected,places=9)
  for k,other in enumerate(laid):self.assertEqual(other,laid[0],f'list {k}')


if __name__=='__main__':unittest.main()
