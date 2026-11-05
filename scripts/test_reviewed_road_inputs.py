import copy,json,pathlib,unittest
from shapely.geometry import Polygon,Point
from shapely.ops import unary_union
from reviewed_road_inputs import reviewed_profiles,reviewed_pavement,reviewed_streets,reviewed_parking_edges,restore_parking_sources,restore_street_sources,install_fields


def road(id,points,ys):return {'id':id,'points':points,'elevations':ys,'width':10,'startLevel':0,'endLevel':0,'bridge':{'kind':'elevated'}}


class ReviewedInputs(unittest.TestCase):
 def setUp(self):
  self.roads=[road('a',[[0,0],[10,0],[20,0]],[6,6,1]),road('b',[[20,0],[30,0],[40,0]],[1,5,5])]
  self.source={'bridgeChains':[{'id':'verified','roads':['a','b'],'landings':[[0,0],[40,0]],'maxGrade':.08}]}

 def test_false_landing_is_removed_but_real_ends_and_plan_stay_fixed(self):
  before=copy.deepcopy(self.roads);changes=reviewed_profiles(self.roads,lambda x,z:0,self.source)
  self.assertEqual(self.roads,before,'analysis must not mutate its inputs')
  for r,piece in zip(self.roads,changes):install_fields(r,piece['result'])
  a,b=self.roads;self.assertEqual(a['elevations'][0],6);self.assertEqual(b['elevations'][-1],5)
  self.assertEqual(a['elevations'][-1],b['elevations'][0]);self.assertGreater(a['elevations'][-1],5)
  self.assertEqual([r['points'] for r in self.roads],[r['points'] for r in before])
  self.assertEqual(a['endLevel'],1);self.assertEqual(b['startLevel'],1)
  self.assertEqual(reviewed_profiles(self.roads,lambda x,z:0,self.source),[])

 def test_new_ground_junction_or_incomplete_chain_requires_another_review(self):
  branch={'id':'street','points':[[20,0],[20,20]],'width':8}
  with self.assertRaisesRegex(AssertionError,'new road'):reviewed_profiles(self.roads+[branch],lambda x,z:0,self.source)
  with self.assertRaisesRegex(AssertionError,'incomplete'):reviewed_profiles(self.roads[:1],lambda x,z:0,self.source)

 def test_terrain_conflict_is_rejected_without_changing_the_road(self):
  before=copy.deepcopy(self.roads)
  with self.assertRaisesRegex(AssertionError,'grade limit'):reviewed_profiles(self.roads,lambda x,z:20 if x==20 else 0,self.source)
  self.assertEqual(before,self.roads)

 def test_straight_span_preserves_landings_width_and_reversible_source_points(self):
  self.roads[0]['points'][1][1]=2;self.roads[0]['points'][-1][1]=3;self.roads[1]['points'][0][1]=3
  self.source['bridgeChains'][0].update(straight=True,width=12,maxPlanShift=3.5)
  before=copy.deepcopy(self.roads);changes=reviewed_profiles(self.roads,lambda x,z:0,self.source)
  for r,piece in zip(self.roads,changes):install_fields(r,piece['result'])
  self.assertTrue(all(p[1]==0 for r in self.roads for p in r['points']))
  self.assertTrue(all(w==12 for r in self.roads for w in r['deckWidths']))
  self.assertEqual(reviewed_profiles(self.roads,lambda x,z:0,self.source),[])
  for r,piece in zip(self.roads,changes):install_fields(r,piece['source'])
  self.assertEqual(self.roads,before)
  self.roads[0]['points'][1][1]=4
  with self.assertRaisesRegex(AssertionError,'reviewed bounds'):reviewed_profiles(self.roads,lambda x,z:0,self.source)

 def test_street_corridor_replaces_pinched_edges_and_only_conflicting_survey_rows(self):
  import numpy as np
  from street_surfaces import encode_edges
  roads=[{'id':'a','width':8,'points':[[0,5],[10,5]]},{'id':'b','width':8,'points':[[10,5],[20,5]]}]
  source={'streetCorridors':[{'id':'street','roads':['a','b'],'landings':[[0,5],[20,5]],'width':8}]}
  tile={'tx':0,'tz':0,'size':30,'buildings':[],'pavements':[{'road':r['id'],'edges':encode_edges(np.array(r['points'])+[0,1],np.array(r['points'])-[0,1],0,0,30)} for r in roads],'borderPavements':[],
   'curbs':[[[5,0],[5,10]],[[15,4],[15,6]],[[0,12],[20,12]]],'sidewalks':[{'rings':[[[4,0],[6,0],[6,10],[4,10]]],'material':'brick'}],'islands':[[[[14,4],[16,4],[16,6],[14,6]]]]}
  headers={'0_0':tile};before=copy.deepcopy(headers);reviewed_streets(headers,roads,source)
  self.assertEqual(roads[0]['pavedWidth'],8)
  for rec in tile['pavements']:
   edges=np.asarray(rec['edges']).reshape(-1,4)/100;np.testing.assert_allclose(np.linalg.norm(edges[:,:2]-edges[:,2:],axis=1),8)
  self.assertEqual(tile['curbs'][-1],before['0_0']['curbs'][-1]);self.assertEqual(tile['islands'],[])
  self.assertTrue(all(w['material']=='brick' for w in tile['sidewalks']))
  snapshot=json.dumps(headers)
  for _ in range(3):
   headers=json.loads(json.dumps(headers));reviewed_streets(headers,roads,source);self.assertEqual(json.dumps(headers),snapshot)
  restore_street_sources(headers);self.assertEqual(headers,before)

 def test_pavement_is_bounded_preserves_walkways_and_replays(self):
  source={'pavedAreas':[{'ring':[[0,0],[15,0],[15,10],[0,10]]}]}
  tile={'tx':0,'tz':0,'size':10,'sidewalks':[{'rings':[[[3,0],[5,0],[5,10],[3,10]]]}],'islands':[],'buildings':[],'driveways':[[[[0,0],[3.17,0],[2.63,2.91],[0,3]]]]};headers={'0_0':tile}
  reviewed_pavement(headers,source);snapshot=copy.deepcopy(headers)
  shape=unary_union([Polygon(r[0],r[1:]) for r in tile['driveways']])
  self.assertTrue(shape.covers(Point(2,5)));self.assertFalse(shape.covers(Point(4,5)));self.assertEqual(shape.bounds,(0,0,10,10))
  for _ in range(5):reviewed_pavement(headers,source);self.assertEqual(snapshot,headers)
  reviewed_pavement(headers,{'pavedAreas':[]});self.assertEqual(len(tile['driveways']),1,'removing an input removes its generated addition')

 def test_installed_pavement_replays_after_serialization_without_rounding_drift(self):
  from street_surfaces import unpack
  root=pathlib.Path(__file__).resolve().parents[1];headers={k:unpack(root/f'public/data/tiles/t_{k}.bin')[0] for k in ['-1_-4','0_-4']}
  snapshot=json.dumps(headers,separators=(',',':'))
  self.assertGreater(headers['-1_-4'].get('reviewedDrivewayParts',0),0,'install the reviewed generation inputs')
  for _ in range(5):
   headers=json.loads(json.dumps(headers));has_parking=any(t.get('reviewedParkingSources') for t in headers.values())
   restore_parking_sources(headers);reviewed_pavement(headers)
   if has_parking:reviewed_parking_edges(headers)
   self.assertEqual(snapshot,json.dumps(headers,separators=(',',':')))

 def test_parking_sidewalk_width_curb_breaks_tile_seam_and_replay(self):
  from shapely.geometry import LineString,box
  source={'parkingSidewalks':[{'ring':[[5,5],[35,5],[35,25],[5,25]],'width':2.4,'entrances':[{'points':[[20,0],[20,10]],'width':6}]}]}
  headers={}
  for tx in [0,1]:
   headers[str(tx)]={'tx':tx,'tz':0,'size':20,'buildings':[],'sidewalks':[],'curbs':[[[tx*20,18],[(tx+1)*20,18]]],'islands':[],'driveways':[[[[tx*20,0],[(tx+1)*20,0],[(tx+1)*20,20],[tx*20,20]]]],'streetPavement':[],'streetSidewalks':[]}
  before=copy.deepcopy(headers);reviewed_parking_edges(headers,source);snapshot=json.dumps(headers)
  walks=unary_union([Polygon(w['rings'][0],w['rings'][1:]) for t in headers.values() for w in t['sidewalks']]);curbs=unary_union([LineString(c) for t in headers.values() for c in t['curbs']]);paving=unary_union([Polygon(r[0],r[1:]) for t in headers.values() for r in t['driveways']])
  self.assertAlmostEqual(walks.intersection(LineString([[10,0],[10,10]])).length,2.4,places=3)
  self.assertLess(walks.intersection(paving).area,.001)
  self.assertFalse(walks.intersects(box(17.01,3.7,22.99,6.3)));self.assertFalse(curbs.intersects(box(17.01,3.7,22.99,6.3)))
  self.assertTrue(paving.covers(Point(20,5)));self.assertTrue(paving.covers(Point(10,12)))
  for _ in range(3):
   headers=json.loads(json.dumps(headers));restore_parking_sources(headers);self.assertEqual(headers,before)
   reviewed_parking_edges(headers,source);self.assertEqual(json.dumps(headers),snapshot)

 def test_installed_parking_access_remains_paved_and_free_of_curbs_and_sidewalks(self):
  from shapely.geometry import LineString
  from street_surfaces import unpack
  root=pathlib.Path(__file__).resolve().parents[1];source=json.loads((root/'public/data/sullivan-square-source.json').read_text())
  tiles=[unpack(root/f'public/data/tiles/t_{k}.bin')[0] for k in ['-1_-4','0_-4']]
  walks=unary_union([Polygon(w['rings'][0],w['rings'][1:]) for t in tiles for w in t['sidewalks']]+[Polygon(r[0],r[1:]) for t in tiles for r in t['streetSidewalks']])
  curbs=unary_union([LineString(c) for t in tiles for c in t['curbs']]);paving=unary_union([Polygon(r[0],r[1:]) for t in tiles for r in t['driveways']+t['streetPavement']])
  generated=unary_union([Polygon(w['rings'][0],w['rings'][1:]) for t in tiles for w in t['sidewalks'][-t['reviewedParkingSources']['sidewalks']['added']:]])
  self.assertLess(generated.intersection(paving).area,.02,'asphalt cannot paint over the sidewalk')
  for entry in source['parkingSidewalks']:
   for entrance in entry['entrances']:
    line=LineString(entrance['points']);aisle=line.buffer(entrance['width']/2-.1)
    self.assertLess(walks.intersection(aisle).area,.01,'the full entrance width stays open')
    self.assertGreater(line.distance(curbs),entrance['width']/2-.01)
    self.assertLess(aisle.difference(paving).area,.01,'paving continues from street to lot')

if __name__=='__main__':unittest.main()
