import copy,unittest
from shapely.geometry import LineString,box
from shapely.ops import unary_union
from source_seams import COPY_REACH,clipped_spans,connect_source_seams,edge_bridge_stubs,restore_clipped_spans,restore_source_copies,source_copies,town_bridge_joints,town_seams,unrestore_clipped_spans,unrestore_town_seams
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


class SourceCopies(unittest.TestCase):
 """A street on the town line that both sources carry: Boston's segments between their nodes, the town's way on the same roadway."""
 def street(self):
  # Boston's two segments meet at a node (100, 0); the town's way runs 1 m beside them and takes their ends, as build-metro.py snaps it.
  return [road('101-0-0',[[0,0],[100,0]]),road('102-0-0',[[100,0],[200,0]]),road('osm-7-0',[[0,0],[50,1],[100,0]]),road('osm-7-1',[[100,0],[150,-1.8],[200,0]]),road('osm-8-0',[[100,0],[100,-80]])]

 def test_a_town_way_lying_along_boston_segments_leaves_and_goes_back_where_it_was(self):
  roads=self.street();before=copy.deepcopy(roads)
  kept,copies,held=source_copies(roads)
  self.assertEqual([r['id'] for r in kept],['101-0-0','102-0-0','osm-8-0'],'the segments and the side street stay');self.assertEqual(held,[])
  self.assertEqual([(c['index'],c['road']['id'],c['of']) for c in copies],[(2,'osm-7-0',['101-0-0']),(3,'osm-7-1',['102-0-0'])])
  self.assertEqual(roads,before,'the input list is not changed');self.assertEqual(source_copies(kept)[1:],([],[]),'nothing is left to take')
  self.assertEqual(restore_source_copies(kept,{'removed':copies}),['osm-7-0','osm-7-1']);self.assertEqual(kept,before)
  self.assertEqual(restore_source_copies(kept,None),[])

 def test_one_way_lying_along_a_chain_of_segments_is_one_copy(self):
  roads=self.street()[:2]+[road('osm-7-0',[[0,0],[50,1],[150,-1.8],[200,0]])]
  self.assertEqual([(c['road']['id'],c['of']) for c in source_copies(roads)[1]],[('osm-7-0',['101-0-0','102-0-0'])])

 def test_a_boston_stub_of_a_town_street_leaves_and_the_town_street_stays_whole(self):
  # The town's street runs on past the segment's dead end, so it is no copy; the segment lies along it all along.
  roads=[road('201-0-0',[[0,0],[40,2],[80,2.5]]),road('osm-9-0',[[0,0],[40,0],[80,0],[260,0]]),road('202-0-0',[[0,0],[0,90]])]
  kept,copies,held=source_copies(roads)
  self.assertEqual([(c['index'],c['road']['id'],c['of']) for c in copies],[(0,'201-0-0',['osm-9-0'])]);self.assertEqual([r['id'] for r in kept],['osm-9-0','202-0-0']);self.assertEqual(held,[])

 def test_crossing_parallel_and_short_roads_are_no_copies(self):
  boston=road('101-0-0',[[0,0],[200,0]])
  for other,why in [(road('osm-1-0',[[100,-40],[100,40]]),'a street crossing the segment'),(road('osm-1-0',[[99,-2],[101,2]]),'a piece no longer than the reach is wide'),
    (road('osm-1-0',[[0,COPY_REACH+2],[200,COPY_REACH+2]]),'the other carriageway'),(road('osm-1-0',[[100,-2.5],[104,0],[108,2.5]]),'a short way crossing at a slant, within reach all along'),
    (road('osm-1-0',[[0,0],[100,0],[170,30]]),'a street that leaves the segment')]:
   self.assertEqual(source_copies([boston,other])[1:],([],[]),why)

 def test_roads_with_heights_or_in_a_tunnel_are_neither_copies_nor_references(self):
  for field,value in (('elevations',[5,5,5]),('tunnel',{'clearance':5})):
   roads=self.street()[:1]+[{**road('osm-7-0',[[0,0],[50,1],[100,0]]),field:value}];self.assertEqual(source_copies(roads)[1:],([],[]),f'a town deck over the segment ({field})')
   roads=[{**road('101-0-0',[[0,0],[50,0],[100,0]]),field:value},road('osm-7-0',[[0,0],[50,1],[100,0]])];self.assertEqual(source_copies(roads)[1:],([],[]),f'a town street along a Boston deck ({field})')

 def test_a_copy_that_a_street_meets_off_the_segment_is_held_back(self):
  # The side street ends on the town way's own vertex (50, 1), which the segment does not have: taking the way out would leave it hanging.
  roads=self.street()[:3]+[road('osm-8-0',[[50,1],[50,80]])]
  kept,copies,held=source_copies(roads)
  self.assertEqual(copies,[]);self.assertEqual(kept,roads);self.assertEqual(held,[{'road':'osm-7-0','of':['101-0-0'],'vertices':[[50,1]]}])
  # A way that ends on the held copy's end, where a segment has its node, still leaves.
  kept,copies,held=source_copies(roads+[road('osm-7-1',[[100,0],[150,-1.8],[200,0]])])
  self.assertEqual([c['road']['id'] for c in copies],['osm-7-1']);self.assertEqual([h['road'] for h in held],['osm-7-0'])

 def test_the_line_a_park_edge_move_changed_is_read_at_its_source(self):
  # street_surfaces.py moves a centerline out of a curbed park edge and keeps the source line; the copy is the street as mapped.
  roads=self.street()[:1]+[road('osm-7-0',[[0,0],[50,1],[100,0]])];roads[0]['points']=[[0,0],[50,9],[100,0]];roads[0]['sourcePoints']=[[0,0],[100,0]]
  self.assertEqual([c['road']['id'] for c in source_copies(roads)[1]],['osm-7-0'])


class ShippedPackage(unittest.TestCase):
 def test_no_street_of_the_installed_package_is_carried_by_both_sources(self):
  import json,pathlib,re
  from shapely.strtree import STRtree
  data=pathlib.Path(__file__).resolve().parents[1]/'public/data';roads=json.loads((data/'city.json').read_text())['roads'];record=json.loads((data/'provenance.json').read_text())['sourceCopies']
  kept,copies,held=source_copies(roads);self.assertEqual((copies,held,record['held']),([],[],[]),'a record lies along the other source\'s line of its street; run connect-source-seams.py')
  # The check itself, without the rule's alignment test: no surface town road within the reach of surface Boston segments all along.
  surface=[r for r in roads if not (r.get('elevations') or r.get('tunnel'))];boston=[LineString(r.get('sourcePoints') or r['points']) for r in surface if re.fullmatch(r'\d+-\d+-\d+',r['id'])];tree=STRtree(boston)
  for r in surface:
   line=LineString(r.get('sourcePoints') or r['points'])
   if not r['id'].startswith('osm-') or line.length<=2*COPY_REACH:continue
   near=[boston[int(i)] for i in tree.query(line.buffer(COPY_REACH))]
   self.assertFalse(near and unary_union(near).buffer(COPY_REACH).covers(line),f"{r['id']} {r['name']} lies on Boston's line all along")
  # The records that left: Brookline's pieces of Saint Mary's Street on both sides of the Turnpike bridge among them, each still a copy of what stayed.
  gone=[c['road'] for c in record['removed']];ids={r['id'] for r in gone};self.assertFalse(ids&{r['id'] for r in roads},'a record that left is still in the package')
  self.assertTrue({'osm-8814884-0','osm-327270827-0','osm-927685720-0','osm-927685720-1','osm-8814508-0','osm-8814266-0','osm-9429379-0'}<=ids)
  again=source_copies(roads+copy.deepcopy(gone));self.assertEqual(([c['road'] for c in again[1]],[c['of'] for c in again[1]],again[2]),(gone,[c['of'] for c in record['removed']],[]))
  # Every street that met a copy still meets a record that stayed: a road alone at a copy's vertex is the record the copy lay along.
  at={}
  for r in roads:
   for p in r['points']:at.setdefault((round(p[0],2),round(p[1],2)),set()).add(r['id'])
  for c in record['removed']:
   for p in c['road']['points']:
    met=at.get((round(p[0],2),round(p[1],2)),set())
    self.assertFalse(len(met)==1 and not met<=set(c['of']),f"{sorted(met)} met {c['road']['id']} at {p} and now meets nothing")

if __name__=='__main__':unittest.main()
