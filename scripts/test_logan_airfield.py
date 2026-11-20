"""Airfield stage pieces (scripts/logan_airfield.py) on small synthetic inputs, and the installed package."""
import json,math,pathlib,unittest
from shapely.geometry import LineString,Point,Polygon
import logan_airfield as A

ROOT=pathlib.Path(__file__).resolve().parents[1];DATA=ROOT/'public/data'


def square(x,z,s):return [(x,z),(x+s,z),(x+s,z+s),(x,z+s),(x,z)]


class RunwayTest(unittest.TestCase):
 def test_the_faa_ends_give_the_published_lengths_and_bearings(self):
  plan=A.runway_plan();self.assertEqual([r['id'] for r in plan],['04L/22R','04R/22L','09/27','14/32','15L/33R','15R/33L'])
  for r,raw in zip(plan,A.RUNWAYS):
   self.assertLessEqual(abs(r['length']-raw['length']*A.FT),A.RUNWAY_SLACK);self.assertAlmostEqual(r['width'],raw['width']*A.FT)
   a,b=[e['point'] for e in r['ends']];bearing=math.degrees(math.atan2(b[0]-a[0],-(b[1]-a[1])))%360
   # The first end's number is its magnetic heading in tens of degrees: the true bearing plus Boston's 15 degrees of variation.
   self.assertLess(abs((bearing+15-int(r['ends'][0]['name'].rstrip('LR'))*10+180)%360-180),6,r['id'])
  self.assertEqual({e['name']:round(e['displaced']/A.FT) for r in plan for e in r['ends'] if e['displaced']},{'22R':819,'4R':1155,'22L':1199,'15R':882})

 def test_a_strip_is_the_rectangle_about_its_line(self):
  s=A.strip((0,0),(100,0),20,before=5,after=10);self.assertAlmostEqual(s.area,115*20);self.assertEqual(s.bounds,(-5.0,-10.0,110.0,10.0))

 def test_the_projection_is_the_packages(self):
  # The Logan landmark of build-metro.py, whose position city.json records.
  x,z=A.world(-71.0165,42.3669);self.assertAlmostEqual(x,4794.198,1);self.assertAlmostEqual(z,-1889.161,1)


class PavementTest(unittest.TestCase):
 def setUp(self):
  # A 600 m runway along x with a taxiway crossing its east end, an apron north of it, a stand on the apron and a hangar beside it.
  def way(id,kind,line,**tags):return {'id':id,'kind':kind,'line':line,**tags}
  self.runways=[{'id':'09/27','width':45.72,'shoulder':7.62,'grooved':True,'length':600,'ends':[{'name':'9','point':(0,0),'displaced':0,'marking':'basic'},{'name':'27','point':(600,0),'displaced':0,'marking':'basic'}]}]
  self.ways=[way(1,'aerodrome',[(-200,-500),(900,-500),(900,300),(-200,300),(-200,-500)]),way(2,'taxiway',[(500,0),(500,-200)]),way(3,'apron',[(300,-400),(700,-400),(700,-200),(300,-200),(300,-400)]),
   way(4,'stopway',[(600,0),(660,0)],width='46'),way(5,'parking_position',[(520,-250),(520,-330)],ref='A1'),way(6,'parking_position',[(600,-250),(600,-330)],ref='A2'),way(7,'taxilane',[(350,-230),(650,-230)]),
   way(8,'jet_bridge',[(500,-398),(500,-380),(510,-335)],ref='A1'),way(9,'jet_bridge',[(620,-398),(620,-380),(610,-335)],ref='A2')]
  self.buildings=[Polygon(square(400,-460,300)).intersection(Polygon([(300,-470),(800,-470),(800,-400),(300,-400)]))]
  self.city={'water':[{'rings':[[[800,-500],[900,-500],[900,300],[800,300]]]}],'tiles':{'size':1000}}

 def test_the_layers_do_not_overlap_and_stop_at_the_water(self):
  layers,aerodrome,ground=A.pavement(self.city,self.ways,[],self.runways,self.buildings);names=sorted(layers)
  for i,a in enumerate(names):
   for b in names[i+1:]:self.assertLess(layers[a].intersection(layers[b]).area,1,(a,b))
  self.assertAlmostEqual(layers['runway'].area,600*45.72,-1);self.assertGreater(layers['taxiway'].area,150*A.TAXIWAY);self.assertFalse(layers['taxiway'].intersects(layers['runway'].buffer(-1)))
  # The shoulder is what lies beside the runway and the taxiway, and the blast pad beyond the end.
  self.assertTrue(layers['shoulder'].contains(Point(300,45.72/2+3)));self.assertTrue(layers['shoulder'].contains(Point(640,0)));self.assertTrue(layers['runway'].contains(Point(300,0)))
  self.assertTrue(layers['apron'].contains(Point(520,-300)));self.assertFalse(layers['apron'].intersects(self.buildings[0].buffer(-1)))
  for shape in layers.values():self.assertLess(shape.bounds[2],800,'nothing is paved in the water')

 def test_tiles_carry_each_layer_in_centimetres_from_their_origin(self):
  layers,_,_=A.pavement(self.city,self.ways,[],self.runways,self.buildings);tiles=A.tiled(layers,1000)
  self.assertEqual(set(tiles),{'0_0','0_-1'});area=0
  for key,by_layer in tiles.items():
   tx,tz=map(int,key.split('_'))
   for rings in by_layer.get('runway',[]):
    ring=[(tx*1000+rings[0][i]/100,tz*1000+rings[0][i+1]/100) for i in range(0,len(rings[0]),2)];self.assertTrue(all(isinstance(v,int) and -1<=v<=100001 for v in rings[0]));area+=Polygon(ring).area
  self.assertAlmostEqual(area,layers['runway'].area,-1)

 def test_aircraft_take_a_fixed_share_of_the_stands_nose_to_the_terminal(self):
  layers,_,_=A.pavement(self.city,self.ways,[],self.runways,self.buildings);paved=A.unary_union(list(layers.values()))
  old=A.OCCUPANCY;A.OCCUPANCY=1.1
  try:placed,bridges=A.place_aircraft(self.ways,self.buildings,paved,[]);again,_=A.place_aircraft(self.ways,self.buildings,paved,[])
  finally:A.OCCUPANCY=old
  self.assertEqual(placed,again);self.assertEqual(sorted(p['stand'] for p in placed),['A1','A2'])
  for p in placed:
   self.assertEqual(p['heading'],(0.0,-1.0),'the nose is toward the building north of the stand');shape=A.aircraft_shape(p['kind'],p['nose'],p['heading'])
   self.assertGreaterEqual(shape.distance(self.buildings[0]),A.BUILDING_ROOM)
  self.assertGreaterEqual(A.aircraft_shape(placed[0]['kind'],placed[0]['nose'],placed[0]['heading']).distance(A.aircraft_shape(placed[1]['kind'],placed[1]['nose'],placed[1]['heading'])),A.WING_ROOM)
  # The bridge runs from the terminal to the aircraft's forward left door.
  bridge=bridges[0];self.assertTrue(bridge['docked']);self.assertFalse(bridges[1]['docked'],'a bridge on an aircraft\'s right has no door to meet');self.assertEqual(bridges[1]['line'][-1],(610,-335))
  a1=next(p for p in placed if p['stand']=='A1');spec=A.AIRCRAFT[a1['kind']]
  self.assertLess(self.buildings[0].distance(Point(bridge['line'][0])),3);self.assertLess(bridge['line'][-1][0],a1['nose'][0],'west of an aircraft that faces north is its left')
  self.assertAlmostEqual(abs(bridge['line'][-1][0]-a1['nose'][0]),spec['body']/2+.4,2);self.assertAlmostEqual(bridge['line'][-1][1],a1['nose'][1]+spec['door'],2)

 def test_rings_are_filed_in_one_form_whatever_the_overlay_hands_back(self):
  # The same square with a hole, begun at another vertex and wound the other way.
  a=A.canonical([[0,0,10,0,10,10,0,10],[4,4,4,6,6,6,6,4]]);b=A.canonical([[10,10,10,0,0,0,0,10],[6,6,4,6,4,4,6,4]])
  self.assertEqual(a,b);self.assertEqual(a[0][:2],[0,0]);self.assertEqual(a[1][:2],[4,4])
  area=lambda f:sum(f[i]*f[(i+3)%len(f)]-f[(i+2)%len(f)]*f[i+1] for i in range(0,len(f),2));self.assertGreater(area(a[0])*-area(a[1]),0,'the hole winds against the outline')
  layers,_,_=A.pavement(self.city,self.ways,[],self.runways,self.buildings)
  for shape in layers.values():
   for part in A.polygons(shape):self.assertTrue(all(abs(v*100-round(v*100))<1e-6 for xz in part.exterior.coords for v in xz),'every vertex is on the centimetre grid')

 def test_a_relations_open_outer_ways_join_into_one_ring(self):
  rings=[{'role':'outer','line':[(0,0),(10,0),(10,10)]},{'role':'outer','line':[(10,10),(0,10),(0,0)]},{'role':'inner','line':[(4,4),(6,4),(6,6),(4,6),(4,4)]}]
  shapes=A.ring_polygons(rings);self.assertEqual(len(shapes),1);self.assertAlmostEqual(shapes[0].area,96)

 def test_a_stand_draw_is_fixed_and_spread(self):
  draws=[A.stand_draw(f'B{i}') for i in range(400)];self.assertEqual(draws,[A.stand_draw(f'B{i}') for i in range(400)]);self.assertTrue(all(0<=d<1 for d in draws))
  self.assertLess(abs(sum(d<.27 for d in draws)/400-.27),.07)


@unittest.skipUnless((DATA/A.OUTPUT_NAME).exists() and (DATA/A.SOURCE_NAME).exists(),'needs the package with its airfield')
class PackageTest(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.city=json.loads((DATA/'city.json').read_text());cls.source=json.loads((DATA/A.SOURCE_NAME).read_text());cls.record=json.loads((DATA/'provenance.json').read_text())['loganAirfield'];cls.airfield=json.loads((DATA/A.OUTPUT_NAME).read_text())

 def test_a_replay_writes_the_installed_sidecar_and_changes_nothing(self):
  counts=A.validate(DATA,self.city,self.record,self.source);self.assertEqual(counts['runways'],6);_,changed=A.install(DATA,self.source,check=True);self.assertEqual(changed,[])

 def test_every_faa_runway_end_lies_on_its_mapped_runway(self):
  ways,_=A.project(self.source);names=lambda ref:{n.lstrip('0') for n in ref.split('/')}
  for r in self.airfield['runways']:
   # The mapped line of the same name, with the unnamed pieces mapped beyond a displaced threshold.
   lines=[LineString(w['line']) for w in ways if w['kind'] in('runway','stopway') and ('ref' not in w or names(w['ref'])=={e['name'] for e in r['ends']})]
   self.assertTrue(any('ref' in w and names(w['ref'])=={e['name'] for e in r['ends']} for w in ways if w['kind']=='runway'),r['id'])
   for e in r['ends']:self.assertLessEqual(min(l.distance(Point(e['point'])) for l in lines),A.END_SLACK,e['name'])

 def test_the_airfield_is_the_size_of_logans(self):
  area=self.airfield['area'];self.assertAlmostEqual(area['runway'],sum(r['length']*r['width']*A.FT*A.FT for r in A.RUNWAYS)-0,delta=45000)
  self.assertGreater(area['apron'],600000);self.assertGreater(area['taxiway'],400000);self.assertEqual(self.record['addedTiles'],['6_-3']);self.assertIn('6_-3',self.city['tiles']['keys'])
  self.assertGreaterEqual(len(self.airfield['terminals']),5);self.assertGreater(len(self.airfield['outline']),200)


if __name__=='__main__':unittest.main()
