"""Turnpike and Storrow Drive stage pieces (scripts/boston_highways.py) on small synthetic inputs."""
import math,unittest
import numpy as np
from shapely.geometry import LineString,Point,Polygon,box
import boston_highways as H
import i93_north as I
from building_outline import from_rings,rings,roof_outline


def feature(id,points,a=0,b=0):return {'id':id,'points':points,'from':a,'to':b,'name':'','cfcc':'A15'}


def plan(points,widths=None,levels=None,main=True,lanes=2,clearance=H.CLEARANCE):
 """A solved plan on a level line: stations at `points`, heights set by the test."""
 n=len(points);p=H.Plan('t',[list(q) for q in points],[0]*n,widths or [10.0]*n,I.MAINLINE_GRADE,[lanes]*n)
 p.main=main;p.level=levels or [0]*n;p.clearance=clearance;p.spec={'bridge':'i90'};p.landing=[False,False];p.buildings=[];p.hulls=[]
 p.built=[[] for _ in range(n)];p.above=[[] for _ in range(n)];p.centred=set();p.forced=[False]*n;p.candidate=[False]*n
 p.y=[0.0]*n;p.high=[0.0]*n;p.low=[0.0]*n;p.edge=[0.0]*n;return p


def line(n,step=3.0):return [[i*step,0.0] for i in range(n)]


def shell(x0,z0,x1,z1,base,top):
 """A box shell: positions, facade faces, roof faces."""
 c=[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];v=np.array([[x,base,z] for x,z in c]+[[x,top,z] for x,z in c],float);f=[]
 for i in range(4):j=(i+1)%4;f+=[[i,j,j+4],[i,j+4,i+4]]
 return v,np.array(f),np.array([[4,5,6],[4,6,7]])


class AssembleTest(unittest.TestCase):
 def test_a_level_change_is_cut_at_the_middle_and_slivers_go(self):
  source={'features':[feature(1,[[0,0],[30,0]]),feature(2,[[30,0],[60,0]],0,-1),feature(3,[[60,0],[60.2,0],[90,0]],-1,-1)],'ways':[]}
  points,owner,ways=H.assemble(source,H.R('t','Test',[1,2,3],lanes=[(1,2),(3,3)]))
  self.assertEqual(points,[[0,0],[30,0],[45,0],[60,0],[90,0]],'the vertex 0.2 m after a segment end is the same vertex; the end stays')
  self.assertEqual([ways[o]['tags']['layer'] for o in owner],['0','0','-1','-1','-1']);self.assertEqual([ways[o]['tags']['lanes'] for o in owner],['2','2','2','3','3'])
  self.assertEqual(len(points),len(owner))

 def test_a_broken_chain_is_refused(self):
  with self.assertRaises(AssertionError):H.assemble({'features':[feature(1,[[0,0],[30,0]]),feature(2,[[31,0],[60,0]])],'ways':[]},H.R('t','Test',[1,2]))


class WidthTest(unittest.TestCase):
 def twins(self,gap):
  a=plan(line(20),[18.8]*20,lanes=4);b=plan([[x,gap] for x,_ in line(20)][::-1],[18.8]*20,lanes=4)
  for p in (a,b):p.nominal=list(p.widths)
  return a,b
 def test_twin_carriageways_give_way_equally_and_keep_their_lanes(self):
  a,b=self.twins(17.0);wa,wb=H.twin_cap(a,b),H.twin_cap(b,a)
  self.assertEqual(wa[5],wb[5],'each gives up the same');self.assertAlmostEqual((wa[5]+wb[5])/2+H.WALL,17.0,places=2,msg='the two pavements stand a wall apart')
  a,b=self.twins(12.0);self.assertAlmostEqual(H.twin_cap(a,b)[5],3*I.LANE+2.4,places=3,msg='never under what four lanes take')
  a,b=self.twins(30.0);self.assertEqual(H.twin_cap(a,b),a.widths,'carriageways standing apart keep their widths')
 def test_a_building_at_the_edge_narrows_the_pavement_but_one_over_the_road_does_not(self):
  p=plan(line(60),[18.8]*60,lanes=4);p.buildings=[{'shape':box(40,8,50,20),'base':3.0,'height':20.0}];p.built[14]=[0];p.built[15]=[0]
  self.assertTrue(H.building_cap(p));self.assertAlmostEqual(p.widths[15],2*(8-.4),places=2);self.assertAlmostEqual(p.widths[25],2*(8-.4)+30/20,places=2,msg='a metre in twenty');self.assertEqual(p.widths[59],18.8,'the change tapers out')
  q=plan(line(30),[18.8]*30,lanes=4);q.buildings=p.buildings;q.built[15]=[0];q.centred={0};self.assertFalse(H.building_cap(q),'a building over the centre line is passed under, not beside')
  r=plan(line(30),[18.8]*30,levels=[-1]*30,lanes=4);r.buildings=p.buildings;r.built[15]=[0];self.assertFalse(H.building_cap(r),'a tunnel passes under the buildings over its edge')
 def test_a_street_alongside_narrows_the_pavement_at_level_zero(self):
  p=plan(line(30),[18.8]*30,lanes=4);p.ends=[None,None];street={'id':'s','name':'Newbury Street','points':[[0,13],[90,13]],'width':10};lines=[LineString(street['points'])]
  from shapely.strtree import STRtree
  self.assertTrue(H.street_cap(p,[street],lines,STRtree(lines)));self.assertAlmostEqual(p.widths[15],2*(13-5-.6),places=2)
  cross={'id':'c','name':'Cross Street','points':[[45,-40],[45,40]],'width':10};lines=[LineString(cross['points'])];q=plan(line(30),[18.8]*30,lanes=4);q.ends=[None,None]
  self.assertFalse(H.street_cap(q,[cross],lines,STRtree(lines)),'a street crossing the road is no neighbour')


class BuildingTest(unittest.TestCase):
 def test_the_outline_is_the_plan_of_the_roofs_not_the_convex_footprint(self):
  a=shell(0,0,30,10,2,20);b=shell(0,10,10,40,2,20);pos=np.concatenate([a[0],b[0]]);roof=np.concatenate([a[2],b[2]+8]);outline=roof_outline(pos,roof)
  self.assertAlmostEqual(outline.area,600,places=1);self.assertFalse(outline.contains(Point(25,30)),'the hull of an L spans the yard inside it')
  self.assertTrue(from_rings(rings(outline)).equals(outline),'the outline kept with a carved shell is the same geometry')
  self.assertTrue(roof_outline(pos,np.zeros((0,3),int)).is_empty)
 def test_a_road_passes_under_a_base_with_room_or_over_a_roof(self):
  p=plan(line(4));b={'base':5.0,'height':30.0};need=p.clearance+H.ROOF
  p.y[1]=5-.05-need;self.assertEqual(H.building_relation(p,1,b),'under');p.y[1]+=.02;self.assertIsNone(H.building_relation(p,1,b))
  shed={'base':0.0,'height':3.0};p.y[2]=3+.3+H.THICKNESS;self.assertEqual(H.building_relation(p,2,shed),'over');p.y[2]-=.02;self.assertIsNone(H.building_relation(p,2,shed))
 def classified(self,p):
  p.ends=[None,None];H.classify_ground(p);return p
 def test_a_roofed_station_is_a_covered_tunnel_and_a_conflict_an_open_one(self):
  p=plan(line(40));p.buildings=[{'id':'b','base':6.0,'height':40.0},{'id':'low','base':2.0,'height':40.0}]
  for i in range(10,20):p.built[i]=[0];p.above[i]=[0]
  for i in range(28,32):p.built[i]=[1];p.above[i]=[1]
  self.classified(p);self.assertEqual(H.runs(p.covered),[[10,19]],'the roof slab fits under the first building');self.assertEqual(H.runs(p.conflict),[[28,31]])
  self.assertEqual(H.runs(p.tunnel),[[9,32]],'a deck shorter than GAP between the two stays part of them, with one clear station at each end')
 def test_a_walled_cut_is_an_open_tunnel_record_and_a_viaduct_is_not(self):
  p=plan(line(60));p.edge=[2.0 if 20<=i<30 else 0.0 for i in range(60)];self.classified(p)
  self.assertEqual(H.runs(p.tunnel),[[19,30]]);self.assertFalse(any(p.covered))
  q=plan(line(60),levels=[1]*60);q.edge=list(p.edge);self.classified(q);self.assertFalse(any(q.tunnel),'a raised deck beside higher ground stays a deck')
 def test_what_the_buildings_over_a_road_need(self):
  p=plan([[i*3.0,0.0] for i in range(40)],main=False);p.id='ramp';p.tangents=I.tangents(p.points);p.y=[4.0-.1*i for i in range(40)]
  tall={'id':'tower','tile':'0_0','name':'Tower','base':3.0,'height':60.0,'shape':box(30,-20,90,20),'hull':box(30,-20,90,20)}
  slab={'id':'slab','tile':'0_0','name':'Bridge slab','base':3.0,'height':1.5,'shape':box(100,-6,112,6),'hull':box(100,-6,112,6)}
  p.buildings=[tall,slab];p.hulls=[tall,slab]
  for i in range(10,31):p.built[i]=[0];p.above[i]=[0]
  for i in range(34,38):p.built[i]=[1]
  p.ends=[None,None];H.classify_ground(p);over=H.buildings_over([p],lambda x,z:0.0)
  self.assertEqual([r['id'] for r in over['removed']],['slab'],'a low structure standing in the roadway goes');self.assertEqual([m['id'] for m in over['mesh']],['tower'])
  (q,)=over['passages'];self.assertEqual((q['building'],q['road']),('tower','ramp'))
  # the passage runs from before the first conflict station to after the last, its ceiling falling with the ramp
  self.assertLess(q['start'][0],30);self.assertGreater(q['end'][0],90);self.assertGreater(q['ceiling'],q['ceilingEnd'])
  need=p.clearance+H.ROOF+.25
  for i in range(10,31):
   s=p.points[i][0]-q['start'][0];self.assertGreaterEqual(q['ceiling']+(q['ceilingEnd']-q['ceiling'])*s/(q['end'][0]-q['start'][0])+.002,p.y[i]+need,'the ceiling (to the millimetre) clears the ramp at every station')
  self.assertLessEqual(q['left'],-p.widths[0]/2-1+1e-6);self.assertGreaterEqual(q['right'],p.widths[0]/2+1-1e-6)
  again=H.buildings_over([p],lambda x,z:0.0,[{'id':'gone','tile':'9_9','name':'','roads':['ramp']}])
  self.assertEqual([r['id'] for r in again['removed']],['gone','slab'],'a structure an earlier run removed stays on the record')


class SeamTest(unittest.TestCase):
 def roads(self):
  bridge={'id':'b','name':'Bridge Street','points':[[0,0],[15,0],[30,0]],'width':12,'oneway':0,'elevations':[2.0,5.0,8.4],'startLevel':0,'endLevel':1,'bridge':{'id':'structure-b','thickness':.75,'clearanceEstimated':True,'kind':'elevated'}}
  street={'id':'s','name':'Bridge Street','points':[[30,0],[45,0],[60,0]],'width':12,'oneway':0,'pavedWidth':14.0}
  return [bridge,street,{'id':'o','name':'Side Street','points':[[60,0],[60,40]],'width':8,'oneway':0}]
 def test_a_street_starting_on_a_bridge_node_over_the_road_is_the_bridges_ramp(self):
  road=plan([[30,-30],[30,-15],[30,0],[30,15],[30,30]]);road.terrain=[-3.0]*5;road.water_polygons=[];roads=self.roads();ground=lambda x,z:1.0+x/100
  out,originals,notes,added=H.bridge_seams(roads,[road],ground);ramp=out[1];self.assertEqual(added,[],'the street keeps its id')
  self.assertEqual(originals,[roads[1]]);self.assertEqual(notes,[]);self.assertIs(out[0],roads[0]);self.assertIs(out[2],roads[2]);self.assertNotIn('pavedWidth',ramp)
  self.assertEqual((ramp['startLevel'],ramp['endLevel'],ramp['bridge']['kind'],ramp['bridge']['id']),(1,0,'elevated','structure-s'))
  self.assertEqual((ramp['points'][0],ramp['points'][-1]),([30,0],[60,0]));self.assertEqual(ramp['elevations'][0],8.4,'lifted at the bridge node');self.assertAlmostEqual(ramp['elevations'][-1],1.6,msg='landing on the ground')
  self.assertGreater(len(ramp['points']),3,'resampled, so its profile can curve')
  # and the bridge is then levelled with it, between the two banks
  levelled,sources,report=H.level_overpasses(out,[road],ground);heights=[y for r in levelled[:2] for y in r['elevations']]
  self.assertEqual(report[0]['changed'],['b','s']);self.assertLessEqual(max(heights),2.0+1e-6);self.assertGreaterEqual(min(heights),1.6-1e-6)
  road.level=[1]*5;self.assertEqual(H.bridge_seams(roads,[road],ground)[1],[],'a road raised over the node is not beneath the bridge')
  self.assertEqual(H.bridge_seams(roads,[plan([[40,-30],[40,0],[40,30]])],ground)[1],[],'nor is one that passes the node by')
  far=self.roads();far[1]['points']=[[30,0],[130,0]];out,originals,notes,added=H.bridge_seams(far,[plan([[30,-30],[30,0],[30,30]])],ground)
  self.assertEqual(originals,[]);self.assertEqual(notes[0]['road'],'s','a long street is reported, not taken')
 def test_a_landing_on_the_slope_of_the_cut_moves_to_where_the_street_levels_off(self):
  def bridge(side=6):
   # (build-metro.py's profile: a lifted node 6.4 m over its ground, a landing on it)
   deck=lambda id,points,a,b:{'id':id,'name':'Bridge Street','points':points,'width':12,'oneway':0,'elevations':[2.0+6.4*(a if i==0 else b if i==len(points)-1 else .5) for i in range(len(points))],'startLevel':a,'endLevel':b,'bridge':{'id':f'structure-{id}','thickness':.75,'clearanceEstimated':True,'kind':'elevated'}}
   return [deck('a',[[0,0],[20,0],[40,0]],0,1),deck('d',[[40,0],[60,0],[80,0]],1,1),deck('c',[[80,0],[88,0]],1,0),
    {'id':'s','name':'Bridge Street','points':[[88,0],[200,0]],'width':12,'oneway':0,'pavedWidth':13.0},{'id':'m','name':'Mews','points':[[88,0],[88,-30]],'width':side,'oneway':0}]
  # the bank is 1.5 m higher than the last node of the bridge, which the street reaches 30 m on
  ground=lambda x,z:2.0 if x<=88 else min(3.5,2.0+(x-88)*.05);road=plan([[80,-30],[80,-15],[80,0],[80,15],[80,30]]);road.terrain=[-3.0]*5;road.water_polygons=[]
  out,originals,notes,added=H.bridge_seams(bridge(),[road],ground)
  self.assertEqual([r['id'] for r in out],['a','d','c','s-deck','s','m']);self.assertEqual(added,['s-deck']);self.assertEqual(sorted(o['id'] for o in originals),['c','s'])
  c,ramp,rest=out[2],out[3],out[4];self.assertEqual((c['startLevel'],c['endLevel']),(1,1),'the old landing is a node of the bridge now')
  self.assertEqual((ramp['points'][0],ramp['points'][-1],ramp['startLevel'],ramp['endLevel']),([88,0],[112.0,0.0],1,0),'where the street has made four fifths of its climb');self.assertEqual(rest['points'],[[112.0,0.0],[200,0]]);self.assertAlmostEqual(ramp['elevations'][-1],3.2)
  levelled,sources,report=H.level_overpasses(out,[road],ground);heights=[y for r in levelled[:4] for y in r['elevations']]
  self.assertLessEqual(max(heights),3.5+.31);self.assertGreaterEqual(min(heights),2.0-1e-6);self.assertLess(max(abs(b-a)/20 for r in levelled[:2] for a,b in zip(r['elevations'],r['elevations'][1:])),.05,'a level bridge between its banks')
  self.assertEqual(H.bridge_seams(bridge(side=10),[road],ground)[1],[],'a street of its own width meeting the landing keeps its junction')
  self.assertEqual(H.bridge_seams(bridge(),[road],lambda x,z:2.0)[1],[],'a landing on level ground stays')
  self.assertEqual(H.bridge_seams(bridge(),[plan([[30,-30],[30,0],[30,30]])],ground)[1],[],'and so does one far from the road')
 def test_a_street_joining_a_deck_at_its_height_splits_the_record(self):
  p=plan(line(40));p.id='storrow-eb';p.spec={'id':'storrow-eb','bridge':'storrow','kind':'motorway'};p.ways=[{'name':'Storrow Drive East','tags':{}}];p.ends=[None,None];p.on_deck=[False,False]
  p.tunnel=[False]*40;p.covered=[False]*40;p.junctions=[(20,-.2),(30,-2.0)]
  decks,tunnels,ids=H.records([p],[])
  self.assertEqual([r['points'][0] for r in decks],[[0.0,0.0],[60.0,0.0]],'split where the street meets it within JOIN of its height, not under the one 2 m below')


class LidTest(unittest.TestCase):
 def test_a_short_hole_between_two_roofed_stretches_is_closed_whole_or_left(self):
  grid={'width':40,'height':20,'cellSize':6.0,'originX':-30.0,'originZ':-60.0,'scale':.01};heights=np.full(40*20,300,dtype=np.int16)
  hollow=[gj*40+gi for gj in (9,10,11) for gi in (14,15)];heights[hollow]=0   # the survey's cut left open over the road at x 54 to 60
  p=plan(line(40),levels=[-1]*40);p.y=[-3.0]*40;p.tunnel=[True]*40;p.candidate=[True]*40;p.covered=[not 18<=i<=21 for i in range(40)]
  out=H.close_gaps([p],[],[],grid,heights,lambda bounds:[]);lid=round((-3.0+H.CLEARANCE+H.ROOF+H.COVER)/.01)
  self.assertEqual(sorted(np.flatnonzero(out!=heights).tolist()),hollow);self.assertTrue((out[hollow]==lid).all(),'up to the roof slab and its cover, no higher')
  shed={'hull':box(58,-2,62,2),'base':1.0};self.assertIsNone(H.close_gaps([p],[],[],grid,heights,lambda bounds:[shed]),'not over the base of a building standing in the hole')
  street={'id':'s','name':'Low Street','points':[[57,-40],[57,40]],'width':8};self.assertIsNone(H.close_gaps([p],[street],[LineString(street['points'])],grid,heights,lambda bounds:[]),'nor over a street lying in it')
  p.covered=[not 10<=i<=30 for i in range(40)];self.assertIsNone(H.close_gaps([p],[],[],grid,heights,lambda bounds:[]),'a longer open stretch is a real one')


class CutTest(unittest.TestCase):
 def test_a_street_beside_a_deck_keeps_its_corridor_out_of_the_cut_unless_it_joins_the_road(self):
  from shapely.strtree import STRtree
  grid={'width':40,'height':30,'cellSize':6.0,'originX':-30.0,'originZ':-60.0,'scale':.01};vertex=lambda x,z:int(round((z+60)/6))*40+int(round((x+30)/6))
  deck=H.DeckRun.__new__(H.DeckRun);deck.points=[[0.0,0.0],[120.0,0.0]];deck.line=LineString(deck.points);deck.along=np.array([0.0,120.0]);deck.widths=[10.0,10.0]
  street={'id':'s','name':'Back Street','points':[[0,14],[120,14]],'width':7};lines=[LineString(street['points'])]
  # the cut wants every vertex within 14 m of the deck's centre line lowered (its footprint, the shelf and the first cell beyond it)
  allowed={vertex(x,z):-1.0 for x in range(0,121,6) for z in (-12,-6,0,6,12)};kept=H.street_pavements((allowed,set(allowed)),[deck],[street],lines,STRtree(lines),grid)
  self.assertEqual(kept,{vertex(x,z) for x in range(0,121,6) for z in (6,12)},'the vertices of the cells the street corridor passes over, outside the deck')
  self.assertEqual(H.street_pavements((allowed,set(allowed)),[deck],[street],lines,STRtree(lines),grid,{id(street)}),set(),'a street that joins the road shares its ground')
  self.assertEqual(H.street_pavements(({},set()),[deck],[street],lines,STRtree(lines),grid),set())


class SignTest(unittest.TestCase):
 def test_storrow_posts_cars_only_at_its_entrances_and_the_height_ahead_of_each_structure(self):
  p=plan(line(120),main=True,clearance=H.STORROW_CLEARANCE);p.id='storrow-eb';p.spec={'bridge':'storrow'};p.landing=[True,False]
  p.covered=[200<=3*i<=260 for i in range(120)];p.pieces=[(0,60,'storrow-eb-01'),(60,119,'storrow-eb-02')]
  source={'ways':[{'id':H.STORROW_TAG_WAYS[0],'tags':{'maxheight':"10'0\""},'points':[[150,0],[300,0]]}]}
  report={'crossings':[{'road':'storrow-eb','at':330.0,'under':'bridge'}],'newCrossings':[]}
  signs=H.warning_signs([p],report,source)
  self.assertEqual(signs[0],{'kind':'cars-only','road':'storrow-eb-01','station':27.0})
  self.assertEqual(signs[1],{'kind':'clearance','road':'storrow-eb-01','station':132.0,'clearance':"10'-0\""},'70 m before the roof begins')
  self.assertEqual(len(signs),3,'the bridge beyond the tunnel gets its own warning');self.assertEqual(signs[2]['road'],'storrow-eb-02')
  q=plan(line(40));q.id='i90-eb';q.landing=[False,False];q.covered=[True]*40;q.pieces=[(0,39,'i90-eb-01')];self.assertEqual(H.warning_signs([q],{'crossings':[],'newCrossings':[]},source),[],'the Turnpike posts none')


class RestoreTest(unittest.TestCase):
 def test_before_stage_takes_the_stage_back_out(self):
  bridge={'id':'b','name':'Bridge Street','points':[[0,0],[10,0]],'width':8,'oneway':0,'elevations':[6.4,6.4],'bridge':{'kind':'elevated'}}
  roads=[{**bridge,'elevations':[4.0,4.0]},{'id':'i90-eb-01','name':'I-90 East','points':[[0,5],[10,5]],'width':18,'oneway':1,'lanes':4,'elevations':[2,2],'bridge':{'id':'i90','kind':H.KIND}}]
  record={'roads':{'added':['i90-eb-01'],'tunnels':['i90-eb-02'],'sources':[bridge]},'terrain':{'vertices':[1,3],'heights':[150,-20]}}
  self.assertEqual([H.stage_owned(r) for r in roads],[False,True]);self.assertTrue(H.stage_owned({'id':'storrow-wb-03'}))
  pre,heights=H.before_stage(roads,np.array([1.0,.5,2.0,0.0]),record)
  self.assertEqual(pre,[bridge],'the levelled bridge has its source profile again');np.testing.assert_allclose(heights,[1.0,1.5,2.0,-.2]);self.assertEqual(len(roads),2)
  both=H.before_road_stages(roads,np.array([1.0,.5,2.0,0.0]),{'bostonHighways':record});self.assertEqual(both[0],[bridge])


class RouteTest(unittest.TestCase):
 def test_every_route_names_layer_eight_segments_once_and_storrow_has_no_closed_end(self):
  ids=[r['id'] for r in H.ROUTES];self.assertEqual(len(ids),len(set(ids)))
  parts=[p for r in H.ROUTES for p in r['parts']];self.assertEqual(len(parts),len(set(parts)),'a source segment belongs to one route')
  self.assertEqual(sorted(r['id'] for r in H.ROUTES if r.get('closed')),['i90-eb','i90-wb']);self.assertTrue(all(r['bridge']=='storrow' and r['id'].startswith('storrow-') for r in H.STORROW))
  self.assertEqual(sorted(r['id'] for r in H.ROUTES if r.get('main')),['i90-eb','i90-wb','storrow-eb','storrow-wb'])
  self.assertLess(H.STORROW_CLEARANCE,H.CLEARANCE);self.assertAlmostEqual(H.CLEARANCE,4.2,msg="the Turnpike's posted 13 ft 9 in")


if __name__=='__main__':unittest.main()
