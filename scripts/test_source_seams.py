import copy,unittest
from shapely.geometry import LineString,box
from shapely.ops import unary_union
from source_seams import clipped_spans,connect_source_seams,edge_bridge_stubs,restore_clipped_spans,town_bridge_joints,town_seams,unrestore_clipped_spans,unrestore_town_seams
from water_crossings import level_water_crossings


def road(id,points,oneway=0):return {'id':id,'name':'Shared Street','points':points,'width':8,'oneway':oneway}

class SourceSeams(unittest.TestCase):
 def test_only_source_confirmed_aligned_dangling_ends_are_joined(self):
  roads=[road('gis',[[-50,0],[0,0]]),road('osm-1-0',[[20,0],[60,0]])]
  self.assertEqual(connect_source_seams(copy.deepcopy(roads),{},lambda x,z:0),[])
  links=connect_source_seams(roads,{'1':LineString([[-10,0],[60,0]])},lambda x,z:0)
  self.assertEqual(len(links),1);self.assertEqual(links[0]['points'][0],[0,0]);self.assertEqual(links[0]['points'][-1],[20,0])
  self.assertEqual(connect_source_seams(roads,{'1':LineString([[-10,0],[60,0]])},lambda x,z:0),[])

 def test_crossings_and_opposing_one_way_flows_are_not_joined(self):
  source={'1':LineString([[-10,0],[60,0]])}
  for other in [road('osm-1-0',[[20,-20],[20,0]]),road('osm-1-0',[[60,0],[20,0]],1)]:
   self.assertEqual(connect_source_seams([road('gis',[[-50,0],[0,0]],1),other],source,lambda x,z:0),[])

 def test_bridge_link_interpolates_height_and_refuses_a_cliff(self):
  a=road('gis',[[-50,0],[0,0]],1);a['elevations']=[4,4]
  b=road('osm-1-0',[[30,0],[60,0]],1);b['elevations']=[6,6]
  source={'1':LineString([[-10,0],[60,0]])}
  link=connect_source_seams([a,b],source,lambda x,z:0)[0]
  self.assertEqual((link['elevations'][0],link['elevations'][-1]),(4,6));self.assertEqual(link['oneway'],1)
  b['elevations']=[20,20];self.assertEqual(connect_source_seams([a,b],source,lambda x,z:0),[])


# Two towns whose outlines stop at the shores of a 60 m river (x 0 to 60).
TOWNS=unary_union([box(-200,-100,0,100),box(60,-100,260,100)]);RIVER=box(0,-100,60,100)
PARKWAY={'highway':'trunk','name':'River Parkway','oneway':'yes'}
def deck(id,points,ys):return {**road(id,points,1),'name':'River Parkway','elevations':ys,'startLevel':0,'endLevel':0,'bridge':{'id':f'structure-{id}','kind':'elevated'}}
def banks():return [deck('osm-7-0',[[-100,0],[-50,0],[0,0]],[3,2,-1]),deck('osm-7-0',[[60,0],[110,0],[160,0]],[-2,1,4])]
def width(tags):return 16

class ClippedWaterSpans(unittest.TestCase):
 def test_the_span_between_two_bank_pieces_of_one_way_is_restored_as_a_deck(self):
  roads=banks();before=copy.deepcopy(roads)
  added=restore_clipped_spans(roads,{'7':(LineString([[-100,0],[160,0]]),PARKWAY)},TOWNS,RIVER,lambda x,z:0,width)
  self.assertEqual([r['id'] for r in added],['osm-7-span']);span=added[0]
  self.assertEqual((span['points'][0],span['points'][-1]),([0,0],[60,0]));self.assertEqual(len(span['points']),21,'a station every 3 m')
  self.assertEqual((span['elevations'][0],span['elevations'][-1]),(-1,-2),'heights run between the bank ends until the water step levels the chain')
  self.assertEqual((span['startLevel'],span['endLevel'],span['oneway'],span['width'],span['bridge']['kind']),(1,1,1,16,'restored-water-span'))
  self.assertEqual((roads[0]['endLevel'],roads[1]['startLevel']),(1,1),'the bank pieces are lifted where the span joins them')
  self.assertEqual(restore_clipped_spans(roads,{'7':(LineString([[-100,0],[160,0]]),PARKWAY)},TOWNS,RIVER,lambda x,z:0,width),[],'nothing is left to restore')
  self.assertEqual(unrestore_clipped_spans(roads),['osm-7-span']);self.assertEqual(roads,before)

 def test_a_crossing_through_a_source_junction_becomes_one_piece_per_way(self):
  roads=banks();roads[1]['points']=[[60,0],[110,0],[160,0]]
  sources={'8':(LineString([[-100,0],[30,0]]),PARKWAY),'9':(LineString([[30,0],[160,0]]),{**PARKWAY,'name':'Bridge Parkway'})}
  roads[0]['id']='osm-8-0';roads[1]['id']='osm-9-0'
  added=restore_clipped_spans(roads,sources,TOWNS,RIVER,lambda x,z:0,width)
  self.assertEqual([(r['id'],r['name'],r['points'][0],r['points'][-1]) for r in added],[('osm-8-span','River Parkway',[0,0],[30,0]),('osm-9-span','Bridge Parkway',[30,0],[60,0])])
  self.assertEqual((added[0]['endLevel'],added[1]['startLevel']),(1,1));self.assertAlmostEqual(added[0]['elevations'][-1],added[1]['elevations'][0])

 def test_dry_gaps_open_ends_and_drawn_stretches_are_left_alone(self):
  source={'7':(LineString([[-100,0],[160,0]]),PARKWAY)}
  self.assertEqual(clipped_spans(banks(),source,TOWNS,box(500,500,510,510)),[],'a gap on land is not a water crossing')
  self.assertEqual(clipped_spans(banks()[:1],source,TOWNS,RIVER),[],'a way leaving the package has an open end')
  drawn=banks()+[road('gis',[[-5,.5],[65,.5]])]
  self.assertEqual(clipped_spans(drawn,source,TOWNS,RIVER),[],'a road along the gap already carries it')
  crossed=banks()+[road('gis',[[30,-80],[30,80]])]
  self.assertEqual(len(clipped_spans(crossed,source,TOWNS,RIVER)),1,'a road crossing beneath does not count as drawing the span')


 def test_the_water_step_levels_the_span_and_both_bank_pieces_of_one_way_as_one_deck(self):
  # Both bank pieces carry the way's id; the chain must still give each its own stations.
  roads=banks();restore_clipped_spans(roads,{'7':(LineString([[-100,0],[160,0]]),PARKWAY)},TOWNS,RIVER,lambda x,z:0,width)
  level_water_crossings(roads,[RIVER],lambda x,z:0,lambda x,z:-1)
  west,east,span=roads
  self.assertAlmostEqual(span['elevations'][0],west['elevations'][-1],places=4);self.assertAlmostEqual(span['elevations'][-1],east['elevations'][0],places=4)
  self.assertGreaterEqual(min(span['elevations']),.5,'the deck clears the water')


class TownSeams(unittest.TestCase):
 # Two towns whose outlines leave a 1 m sliver between them (x 0 to 1).
 TOWNS={'West':box(-200,-100,0,100),'East':box(1,-100,200,100)}
 def test_a_street_split_at_a_town_line_is_carried_to_its_continuation(self):
  roads=[road('osm-5-0',[[-100,0],[0,0]]),road('osm-5-0',[[1,0],[100,0]])];before=copy.deepcopy(roads);source={'5':LineString([[-100,0],[100,0]])}
  joins=town_seams(roads,source,self.TOWNS)
  self.assertEqual([(j['road'],j['end'],j['kind'],j['point']) for j in joins],[('osm-5-0','end','continuation',[1,0])])
  self.assertEqual(roads[0]['points'][-1],roads[1]['points'][0],'the pieces share their end')
  self.assertEqual(town_seams(roads,source,self.TOWNS),[],'a rerun finds nothing left to join')
  self.assertEqual(unrestore_town_seams(roads),['osm-5-0']);self.assertEqual(roads,before)

 def test_a_side_street_reaching_a_street_across_the_line_joins_it_at_a_new_vertex(self):
  roads=[road('osm-6-0',[[-50,50],[0,50]]),road('osm-9-0',[[1.4,-100],[1.4,100]])];source={'6':LineString([[-50,50],[1.4,50]]),'9':LineString([[1.4,-100],[1.4,100]])}
  joins=town_seams(roads,source,self.TOWNS)
  self.assertEqual([(j['road'],j['kind'],j['to']) for j in joins],[('osm-6-0','junction','osm-9-0')])
  self.assertEqual(roads[0]['points'][-1],[1.4,50]);self.assertIn([1.4,50],roads[1]['points'])
  self.assertEqual(sorted(unrestore_town_seams(roads)),['osm-6-0','osm-9-0']);self.assertEqual(roads[1]['points'],[[1.4,-100],[1.4,100]])

 def test_pieces_of_one_way_that_overlap_across_the_line_meet_in_the_middle(self):
  towns={'West':box(-200,-100,.8,100),'East':box(-.8,-100,200,100)}
  roads=[road('osm-5-0',[[-100,0],[.8,0]]),road('osm-5-0',[[-.8,0],[100,0]])]
  joins=town_seams(roads,{'5':LineString([[-100,0],[100,0]])},towns)
  self.assertEqual([j['kind'] for j in joins],['overlap']);self.assertEqual((roads[0]['points'][-1],roads[1]['points'][0]),([0,0],[0,0]))

 def test_ends_the_source_does_not_continue_and_decks_are_left_alone(self):
  source={'5':LineString([[-100,0],[0,0]]),'8':LineString([[1,0],[100,0]])}
  self.assertEqual(town_seams([road('osm-5-0',[[-100,0],[0,0]]),road('osm-8-0',[[1,0],[100,0]])],source,self.TOWNS),[],'two ways that do not meet in the source stay apart')
  deck=road('osm-5-0',[[-100,0],[0,0]]);deck['elevations']=[0,0]
  self.assertEqual(town_seams([deck,road('osm-5-0',[[1,0],[100,0]])],{'5':LineString([[-100,0],[100,0]])},self.TOWNS)[0]['road'],'osm-5-0','only the surface piece moves')

 def test_a_street_whose_next_way_lost_16_m_to_the_clipping_is_carried_to_it(self):
  # Commercial Street at River's Edge: one way ends 16 m before the line and the next way's first 17 m were clipped.
  roads=[road('osm-5-0',[[-100,0],[-16,0]]),road('osm-6-0',[[1,0],[100,0]])]
  joins=town_seams(roads,{'5':LineString([[-100,0],[-16,0]]),'6':LineString([[-16,0],[100,0]])},self.TOWNS)
  self.assertEqual([(j['road'],j['kind'],j['to'],j['point'],j['carried']) for j in joins],[('osm-5-0','continuation','osm-6-0',[1,0],17.0)])

 def bridge(self):
  # Boston Avenue at the Medford/Somerville line: two deck pieces of one way meeting at a ground-level joint in a cut.
  west=road('osm-7-0',[[-20,0],[.5,0]]);west.update(elevations=[1.0,-3.0],startLevel=0,endLevel=0)
  east=road('osm-7-0',[[.5,0],[10,0]]);east.update(elevations=[-3.0,.5],startLevel=0,endLevel=1)
  return [west,east]

 def test_a_bridge_split_at_a_town_line_is_carried_as_one_deck(self):
  roads=self.bridge();before=copy.deepcopy(roads)
  joints=town_bridge_joints(roads,self.TOWNS);west,east=roads
  self.assertEqual([(j['road'],j['point'],j['sourceJoint']) for j in joints],[('osm-7-0',[.5,0],-3.0)])
  self.assertAlmostEqual(west['elevations'][-1],1.0-.5*20.5/30,places=4);self.assertEqual(west['elevations'][-1],east['elevations'][0])
  self.assertEqual((west['elevations'][0],east['elevations'][-1]),(1.0,.5),'the outer ends keep their heights')
  self.assertEqual((west['endLevel'],east['startLevel'],west['startLevel'],east['endLevel']),(1,1,0,1),'the joint is lifted')
  self.assertEqual(town_bridge_joints(roads,self.TOWNS),[],'a rerun finds nothing left to join')
  self.assertEqual(unrestore_town_seams(roads),['osm-7-0','osm-7-0']);self.assertEqual(roads,before)

 def test_bridge_joints_away_from_a_town_line_or_at_a_junction_are_left_alone(self):
  roads=self.bridge()
  for r in roads:r['points']=[[x+50,z] for x,z in r['points']]
  self.assertEqual(town_bridge_joints(roads,self.TOWNS),[],'a joint far from the line')
  roads=self.bridge()+[road('osm-8-0',[[.5,0],[.5,40]])]
  self.assertEqual(town_bridge_joints(roads,self.TOWNS),[],'another road meets the joint')
  roads=self.bridge();roads[0]['endLevel']=1
  self.assertEqual(town_bridge_joints(roads,self.TOWNS),[],'a joint already lifted')


class EdgeBridges(unittest.TestCase):
 DISTRICTS=box(0,-100,200,100)  # the map ends at x 0
 def bridge(self):
  # High Street at the Arlington line: a deck rising 3.5 m over 14 m from the street, then a 4 m stub dropping to the bank at the edge.
  high=road('osm-2-0',[[18,0],[4,0]]);high.update(elevations=[-1.0,2.5],startLevel=0,endLevel=1)
  stub=road('osm-3-0',[[0,0],[4,0]]);stub.update(elevations=[-3.7,2.5],startLevel=0,endLevel=1)
  return [road('osm-1-0',[[40,0],[18,0]]),high,stub]

 def test_a_bridge_cut_at_the_edge_of_the_map_is_held_level_from_its_landing(self):
  roads=self.bridge();before=copy.deepcopy(roads)
  bridges=edge_bridge_stubs(roads,self.DISTRICTS)
  self.assertEqual([(b['roads'],b['height'],b['sourceEdge'],b['landing']) for b in bridges],[(['osm-3-0','osm-2-0'],-1.0,-3.7,[18,0])])
  self.assertEqual((roads[1]['elevations'],roads[2]['elevations']),([-1.0,-1.0],[-1.0,-1.0]));self.assertEqual(roads[2]['startLevel'],1,'the edge end is lifted')
  self.assertEqual(edge_bridge_stubs(roads,self.DISTRICTS),[],'a rerun finds nothing left')
  unrestore_town_seams(roads);self.assertEqual(roads,before)

 def test_gentle_decks_at_the_edge_and_decks_a_street_meets_there_are_left_alone(self):
  roads=self.bridge();roads[2]['elevations']=[2.0,2.5]
  self.assertEqual(edge_bridge_stubs(roads,self.DISTRICTS),[],'a deck that does not drop at the edge')
  self.assertEqual(edge_bridge_stubs(self.bridge()+[road('osm-4-0',[[0,0],[0,50]])],self.DISTRICTS),[],'a street meets the edge end')
  self.assertEqual(edge_bridge_stubs(self.bridge(),box(-50,-100,200,100)),[],'an end inside the map')

if __name__=='__main__':unittest.main()
