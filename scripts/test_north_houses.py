import pathlib,re,unittest
from shapely.geometry import Polygon
from building_semantics import house_palette
from house_shapes import FORMS,eave_height,house_mesh,parse_stories,typology

ROOT=pathlib.Path(__file__).resolve().parents[1]


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


if __name__=='__main__':unittest.main()
