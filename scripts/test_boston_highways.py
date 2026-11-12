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


class BankTest(unittest.TestCase):
 """A bridge over the cut with a landing down in it, as build-metro.py leaves it: every lifted node 6.4 m over its ground."""
 def ground(self,x,z):
  if 50<x<70:return -3.3                                   # the cut's floor under the bridge
  return 2.0 if z>=-10 else -2.5 if z<=-30 else 2.0-(-10-z)*.225   # the bank the steps climb
 def bridge(self):
  deck=lambda id,points,a,b,name='Bridge Street':{'id':id,'name':name,'points':points,'width':12,'oneway':1,'elevations':[self.ground(*p)+6.4*(a if i==0 else b if i==len(points)-1 else .5) for i,p in enumerate(points)],'startLevel':a,'endLevel':b,'bridge':{'id':f'structure-{id}','thickness':.75,'clearanceEstimated':True,'kind':'elevated'}}
  return [deck('a',[[0,0],[20,0],[40,0]],0,1),deck('d',[[40,0],[60,0],[80,0]],1,1),deck('c',[[80,0],[100,0],[120,0]],1,0),deck('steps',[[40,-40],[40,-35],[40,-30],[40,-25],[40,-20],[40,-15],[40,-10],[40,-5],[40,0]],0,1,'Bridge Street Steps')]
 def beneath(self):
  road=plan([[60,-30],[60,-15],[60,0],[60,15],[60,30]]);road.terrain=[-3.0]*5;road.water_polygons=[];return road

 def test_a_landing_down_in_the_cut_is_no_bank_and_its_piece_rises_to_the_deck(self):
  roads=self.bridge();self.assertEqual(roads[1]['elevations'],[8.4,-3.3+3.2,8.4]);levelled,sources,report=H.level_overpasses(roads,[self.beneath()],self.ground)
  self.assertEqual(len(report),1);r=report[0];self.assertEqual(r['changed'],['a','c','d','steps']);self.assertEqual(r['landings'],[2.0,2.0],'the two banks');self.assertEqual(r['inCut'],[-2.5])
  # (the deck's own nodes stand on the banks' ground, which it keeps 0.3 m under it)
  a,d,c,steps=levelled;self.assertEqual({round(y,3) for y in d['elevations']},{2.3},'the deck is level between its banks');self.assertEqual((a['elevations'][0],c['elevations'][-1]),(2.0,2.0))
  self.assertTrue(all(2.0-1e-6<=y<=2.3+1e-6 for r in (a,c) for y in r['elevations']));self.assertEqual(sorted(o['id'] for o in sources),['a','c','d','steps']);self.assertEqual(r['lifts'],[.3,.3])
  ys=steps['elevations'];self.assertEqual((ys[0],ys[-1]),(-2.5,2.3),'from its landing in the cut to the deck');self.assertTrue(all(b>=a for a,b in zip(ys,ys[1:])))
  grades=[(b-a)/5 for a,b in zip(ys,ys[1:])];self.assertTrue(all(g2<=g1+1e-3 for g1,g2 in zip(grades,grades[1:])),'pulled taut over the bank: it never steepens again');self.assertLess(max(grades),.2)
  self.assertTrue(all(y>=self.ground(*p)-1e-9 for p,y in zip(steps['points'],ys)),'and never under it')
  # the room the road asks for lifts the banks' surface, not the landing in the cut
  deep=self.beneath();deep.terrain=[-.5]*5;lifted=H.level_overpasses(self.bridge(),[deep],self.ground)[2][0];top=-.5+I.TERRAIN_RISE+H.THICKNESS+H.CLEAR_UNDER
  self.assertEqual(lifted['inCut'],[-2.5]);self.assertTrue(lifted['deck'][0]<=top+1e-3<=lifted['deck'][1]+2e-3,'the surface between the banks meets the room over the road');self.assertEqual(len(lifted['lifts']),2);self.assertGreater(max(lifted['lifts']),1.5)

 def test_a_bridge_whose_landings_all_stand_near_the_road_is_left_on_its_nodes(self):
  shallow=self.beneath();shallow.terrain=[1.0]*5;roads=self.bridge();levelled,sources,report=H.level_overpasses(roads,[shallow],self.ground)
  self.assertEqual(report,[]);self.assertEqual(sources,[]);self.assertEqual([r['elevations'] for r in levelled],[r['elevations'] for r in roads],'an overpass over a road at grade keeps its climb')

 def test_a_route_that_starts_on_the_bridge_joins_it_and_is_no_road_beneath(self):
  # An entrance ramp leaves the street at the bridge's landing: its ground there is the street's, not a cut's floor.
  entrance=plan([[0,0],[0,15],[0,30]],main=False);entrance.terrain=[2.0,1.9,1.8];entrance.water_polygons=[];roads=self.bridge()[:3]
  levelled,sources,report=H.level_overpasses(roads,[self.beneath(),entrance],self.ground)
  self.assertEqual(len(report),1,'the bridge is levelled over the road in the cut');self.assertEqual(report[0]['landings'],[2.0,2.0]);self.assertNotIn('inCut',report[0])
  crossing=plan([[20,-30],[20,0],[20,30]],main=False);crossing.terrain=[1.8]*3;crossing.water_polygons=[]
  self.assertEqual(H.level_overpasses(self.bridge()[:3],[self.beneath(),crossing],self.ground)[2],[],'a road at the banks\' height passing under the bridge is one: nothing stands CUT over it')


class CopyTest(unittest.TestCase):
 """A street both sources carry, as Saint Mary's Street on the line between Boston and Brookline."""
 def roads(self):
  deck=lambda id,points,a,b:{'id':id,'name':'Line Street','points':points,'width':7,'oneway':1,'elevations':[2.0+6.4*(a if i==0 else b if i==len(points)-1 else .5) for i in range(len(points))],'startLevel':a,'endLevel':b,'bridge':{'id':f'structure-{id}','thickness':.75,'clearanceEstimated':True,'kind':'elevated'}}
  street=lambda id,points,**extra:{'id':id,'name':'Line Street','points':points,'width':12.2,'oneway':1,**extra}
  return [street('north',[[-40,0],[0,0]]),deck('a',[[0,0],[20,0],[40,0]],0,1),deck('d',[[40,0],[60,0],[80,0]],1,1),deck('c',[[80,0],[100,0],[120,0]],1,0),street('south',[[120,0],[160,0]]),
   # the second source: a street down the bank to the bridge's first node, a deck from the cut's floor up, a stub, and its own copies of the streets beyond
   street('osm-north',[[-40,0],[0,0]],pavedWidth=8.2),street('osm-a',[[0,0],[40,0]],pavedWidth=10.3),
   {**deck('osm-d',[[40,.3],[60,.3],[80,.3],[105,.2]],0,0),'elevations':[-2.5,-1.0,.5,1.6],'width':12.2},street('osm-s',[[105,.2],[120,0]]),street('osm-south',[[120,0],[160,0]]),
   street('cross',[[120,0],[120,40]]),deck('twin',[[0,10],[60,10],[120,10]],0,0),street('stub',[[20,-1.2],[20,1.2]])]
 def beneath(self,x=60):
  road=plan([[x,-30],[x,-15],[x,0],[x,15],[x,30]]);road.terrain=[-3.0]*5;road.water_polygons=[];return road

 def test_the_second_source_s_copies_of_a_bridge_over_the_road_leave_the_package_and_come_back(self):
  roads=self.roads();kept,copies=H.bridge_copies(roads,[self.beneath()])
  self.assertEqual([c['road']['id'] for c in copies],['osm-a','osm-d','osm-s']);self.assertEqual([c['index'] for c in copies],[6,7,8]);self.assertTrue(all(c['of']==['a','c','d'] for c in copies))
  self.assertEqual([r['id'] for r in kept],['north','a','d','c','south','osm-north','osm-south','cross','twin','stub'],'the streets beyond the bridge, the cross street, the carriageway beside it and a stub across its line stay')
  self.assertEqual(copies[1]['road'],roads[7]);self.assertIsNot(copies[1]['road'],roads[7])
  # restore puts each back at its own place
  back=list(kept);H.restore(back,None,{'roads':{'added':[],'sources':[],'removed':copies}});self.assertEqual(back,roads)
  # of two chains on one line the longer is the bridge: the single copied deck never takes the bridge's own pieces
  self.assertTrue(all(r in kept for r in roads[1:4]))

 def test_a_bridge_that_crosses_none_of_the_stage_s_roads_keeps_what_lies_on_it(self):
  roads=self.roads();self.assertEqual(H.bridge_copies(roads,[self.beneath(300)]),(roads,[]))
  raised=self.beneath();raised.level=[1]*5;self.assertEqual(H.bridge_copies(roads,[raised])[1],[],'nor one the road passes over')
  owned=self.roads();owned[2]={**owned[2],'bridge':{**owned[2]['bridge'],'kind':'harvard'}};self.assertEqual(H.bridge_copies(owned,[self.beneath()])[1],[],'nor a bridge with a dedicated builder')


class NodeTest(unittest.TestCase):
 """Carlton Street: the span and the two legs it parts into are three bridge ways that meet over the bank of the cut."""
 def ground(self,x,z):return 2.0 if x>=95 else 1.8 if x<=26 else -2.5
 def roads(self):
  piece=lambda id,points:{'id':id,'name':'Fork Street','points':points,'width':12,'oneway':0,'elevations':[round(self.ground(*points[0])+(self.ground(*points[-1])-self.ground(*points[0]))*i/(len(points)-1),4) for i in range(len(points))],'startLevel':0,'endLevel':0,'bridge':{'id':f'structure-{id}','thickness':.75,'clearanceEstimated':True,'kind':'elevated'}}
  return [piece('span',[[40,0],[50,0],[60,0],[70,0],[80,0],[90,0],[100,0]]),piece('leg',[[40,0],[35,3],[30,6],[25,9]]),piece('arm',[[25,-9],[30,-6],[35,-3],[40,0]]),
   {'id':'north','name':'Fork Street','points':[[100,0],[140,0]],'width':12,'oneway':0},{'id':'west','name':'West Street','points':[[25,9],[0,20]],'width':12,'oneway':0},{'id':'east','name':'East Street','points':[[25,-9],[0,-20]],'width':12,'oneway':0}]
 def beneath(self):
  road=plan([[60,-30],[60,-15],[60,0],[60,15],[60,30]]);road.terrain=[-3.0]*5;road.water_polygons=[];return road

 def test_a_node_where_only_bridge_pieces_meet_over_the_cut_is_lifted_and_the_bridge_levelled(self):
  roads=self.roads();self.assertEqual(roads[0]['elevations'][0],-2.5);out,originals,notes,added=H.bridge_seams(roads,[self.beneath()],self.ground)
  self.assertEqual((added,notes),([],[]));self.assertEqual(sorted(o['id'] for o in originals),['arm','leg','span']);self.assertEqual([r['id'] for r in out],[r['id'] for r in roads])
  span,leg,arm=out[:3];self.assertEqual([(r['startLevel'],r['endLevel']) for r in (span,leg,arm)],[(1,0),(1,0),(0,1)],'each piece is lifted at the node and lands at its other end')
  self.assertEqual(originals[0]['startLevel'],0);self.assertIs(out[3],roads[3])
  levelled,sources,report=H.level_overpasses(out,[self.beneath()],self.ground);self.assertEqual(len(report),1);self.assertEqual(report[0]['landings'],[1.8,1.8,2.0])
  span,leg,arm=levelled[:3];node=span['elevations'][0];self.assertEqual((leg['elevations'][0],arm['elevations'][-1]),(node,node),'the three pieces meet at one height')
  self.assertTrue(1.5<=node<=2.4,node);self.assertEqual((span['elevations'][-1],leg['elevations'][-1],arm['elevations'][0]),(2.0,1.8,1.8))
  self.assertTrue(all(y>=1.5 for y in span['elevations']),'no fall to the node any more');self.assertGreaterEqual(span['elevations'][2]-H.THICKNESS-(-3.0+I.TERRAIN_RISE),H.CLEAR_UNDER-1e-6)

 def test_a_piece_two_rules_change_is_recorded_once_as_the_stage_found_it(self):
  # A second carriageway passes close under the span's far landing, which stands on the slope of the cut: the street beyond climbs out, so that
  # landing moves along the street (the second rule) after the node was lifted (the first). restore must find the span as it was before both.
  climbing=lambda x,z:2.0+min(1.2,max(0,x-100)*.05) if x>=95 else 1.8 if x<=26 else -2.5;roads=self.roads()
  near=plan([[88,-30],[88,-15],[88,0],[88,15],[88,30]]);near.terrain=[-3.0]*5;near.water_polygons=[]
  out,originals,notes,added=H.bridge_seams(roads,[self.beneath(),near],climbing)
  self.assertEqual(added,['north-deck']);self.assertEqual(sorted(o['id'] for o in originals),['arm','leg','north','span'],'each road once');span=next(o for o in originals if o['id']=='span')
  self.assertEqual((span['startLevel'],span['endLevel']),(0,0),'as the stage found it, not as the first rule left it');self.assertEqual(span,roads[0])
  self.assertEqual([(r['id'],r.get('startLevel'),r.get('endLevel')) for r in out[:5]],[('span',1,1),('leg',1,0),('arm',0,1),('north-deck',1,0),('north',None,None)])
  back=list(out);H.restore(back,None,{'roads':{'added':added,'sources':originals}});self.assertEqual(back,roads,'and restore gives the stage its roads back')

 def test_a_junction_on_the_ground_or_on_a_bank_or_with_a_builder_of_its_own_stays(self):
  road=self.beneath()
  street=self.roads()+[{'id':'side','name':'Side Street','points':[[40,0],[40,-40]],'width':8,'oneway':0}];self.assertEqual(H.bridge_seams(street,[road],self.ground)[1],[],'a street ends at the node: it is a junction')
  bank=lambda x,z:2.0 if x>=95 else 1.8 if x<=26 else 0.5;high=self.roads()
  for r in high[:3]:r['elevations']=[.5 if p==[40,0] else y for p,y in zip(r['points'],r['elevations'])]
  self.assertEqual(H.bridge_seams(high,[road],bank)[1],[],'a node standing CUT over the road is on a bank')
  built=self.roads();built[1]={**built[1],'bridge':{**built[1]['bridge'],'kind':'harvard'}};self.assertEqual(H.bridge_seams(built,[road],self.ground)[1],[],'a chain with a dedicated builder is left alone')
  far=plan([[160,-30],[160,0],[160,30]]);far.terrain=[-3.0]*3;far.water_polygons=[];self.assertEqual(H.bridge_seams(self.roads(),[far],self.ground)[1],[],'and so is a node far from the road')
  low=self.roads()
  for r in low[:3]:r['elevations']=[y if p==[40,0] else -2.4 for p,y in zip(r['points'],r['elevations'])]
  self.assertEqual(H.bridge_seams(low,[road],lambda x,z:-2.5)[1],[],'pieces with no end on a bank are no bridge over the cut')


class HollowTest(unittest.TestCase):
 """A bridge over the cut whose western landing stands in a hollow: the source ended the bridge on the slope the survey shows
 under it, and the street beyond was graded down to that landing."""
 GRID={'width':41,'height':21,'cellSize':6,'originX':-60,'originZ':-60,'scale':.01}
 def height(self,x,z,hollow):
  if 30<x<90:return -2.5                                           # the cut the bridge crosses
  if x>=90:return 2.0                                              # the east bank, level with its street
  return min(2.0,.2+max(0,24-x)*.075) if hollow else .2          # the west street climbs 1.8 m out of the hollow in 24 m, or lies low all along
 def heights(self,hollow=True):
  g=self.GRID;return np.asarray([round(self.height(g['originX']+i*g['cellSize'],g['originZ']+j*g['cellSize'],hollow)*100) for j in range(g['height']) for i in range(g['width'])],dtype='<i2')
 def roads(self,ground):
  deck=lambda id,points,a,b:{'id':id,'name':'Bridge Street','points':points,'width':12,'oneway':0,'elevations':[round(ground(*q)+6.4*(a if i==0 else b if i==len(points)-1 else .5),4) for i,q in enumerate(points)],'startLevel':a,'endLevel':b,'bridge':{'id':f'structure-{id}','thickness':.75,'clearanceEstimated':True,'kind':'elevated'}}
  street=lambda id,points:{'id':id,'name':'Bridge Street','points':points,'width':12,'oneway':0}
  return [deck('west-ramp',[[24,0],[30,0],[36,0],[42,0]],0,1),deck('deck',[[42,0],[60,0],[78,0]],1,1),deck('east-ramp',[[78,0],[84,0],[90,0],[96,0]],1,0),street('west',[[24,0],[0,0],[-48,0]]),street('east',[[96,0],[150,0]]),street('side',[[0,0],[0,40]])]
 def beneath(self):
  road=plan([[60,-30],[60,-15],[60,0],[60,15],[60,30]]);road.terrain=[-3.0]*5;road.water_polygons=[];return road

 def test_the_ground_at_a_landing_in_a_hollow_is_raised_to_the_bridge_and_the_bank_stays(self):
  g=self.GRID;heights=self.heights();ground=I.Terrain(g,heights);roads=self.roads(ground);road=self.beneath();levelled,sources,report=H.level_overpasses(roads,[road],ground)
  ramp=levelled[0];top=ramp['elevations'][-1];self.assertEqual(ramp['elevations'][0],.2);self.assertGreaterEqual(top-.2,H.HOLLOW,'the level deck falls to its landing in the hollow')
  filled,again,before,notes=H.raise_hollows(roads,levelled,report,[road],g,heights);level=round(top,2)
  self.assertEqual([(n['road'],n['landing'],n['from'],n['streets']) for n in notes],[('west-ramp',[24,0],.2,['west'])],'the east landing stands on its bank and is no hollow')
  self.assertAlmostEqual(notes[0]['to'],level,2,msg='to the height of the deck at the node the ramp climbs to');self.assertEqual(notes[0]['maxFillMeters'],round(level-.2,3))
  changed=np.flatnonzero(filled!=heights);xs=g['originX']+(changed%g['width'])*6;zs=g['originZ']+(changed//g['width'])*6;self.assertEqual(notes[0]['vertices'],len(changed))
  self.assertTrue(np.all(filled[changed]==round(level*100)) and np.all(filled>=heights),'raised to one level, nothing lowered');self.assertTrue(np.all(np.abs(zs)<=12) and np.all(xs<=30),'the cells of the street corridor')
  self.assertEqual(sorted(zip(xs[xs==30].tolist(),zs[xs==30].tolist())),[(30,-6),(30,0),(30,6)],'behind the landing only what lies within the corridor\'s reach of it')
  self.assertTrue(np.all(filled[(np.arange(len(filled))%g['width']>=16)&(np.arange(len(filled))%g['width']<=24)]==heights[(np.arange(len(heights))%g['width']>=16)&(np.arange(len(heights))%g['width']<=24)]),'the cut the bridge crosses keeps its ground')
  after=I.Terrain(g,filled);self.assertTrue(all(after(x,0)>=level-1e-9 for x in (24,20,16,12,8,4,0,-10)),'the street no longer dips to the bridge');self.assertAlmostEqual(after(-10,0),2.0)
  # the landing takes the new ground, the record as it was is kept for restore, and the bridge levelled once more comes down to it gently
  # (its west end rides up a little with its bank, which no road beneath holds down here: what is left is under HOLLOW)
  self.assertEqual([r['id'] for r in before],['west-ramp']);self.assertEqual(before[0],roads[0]);self.assertEqual(again[0]['elevations'][0],round(level,4));self.assertEqual(again[0]['elevations'][1:],roads[0]['elevations'][1:]);self.assertTrue(all(a is b for a,b in zip(again[1:],roads[1:])))
  once_more,_,second=H.level_overpasses(again,[road],after,raised={(24.0,0.0)});ys=once_more[0]['elevations'];self.assertEqual(ys[0],round(level,4));self.assertTrue(0<=ys[-1]-ys[0]<min(H.HOLLOW,(top-.2)/2),ys);self.assertEqual(second[0]['landings'],[round(level,3),2.0])
  self.assertEqual(H.raise_hollows(again,once_more,second,[road],g,filled)[3],[],'and a second look finds no hollow')

 def test_a_bridge_standing_over_its_streets_keeps_its_ramp_and_its_ground(self):
  g=self.GRID;heights=self.heights(hollow=False);ground=I.Terrain(g,heights);roads=self.roads(ground);road=self.beneath();levelled,sources,report=H.level_overpasses(roads,[road],ground)
  self.assertGreaterEqual(levelled[0]['elevations'][-1]-levelled[0]['elevations'][0],H.HOLLOW);filled,again,before,notes=H.raise_hollows(roads,levelled,report,[road],g,heights)
  self.assertEqual((notes,before),([],[]));self.assertIs(filled,heights);self.assertIs(again,roads)


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


class LandingTest(unittest.TestCase):
 def ramp(self,spec=None):
  p=plan(line(30),[7.0]*30,main=False,lanes=1);p.mid=[0.0]*30;p.spec={'bridge':'i90',**(spec or {})}
  # crossed at its first vertex: the street's roadway reaches (12+7)/2+0.4 = 9.9 m along the ramp
  return p,{'points':p.points,'width':7.0},[({'id':'s','name':'Cross Street','points':[[0,-40],[0,40]],'width':12},1)]
 def test_a_landing_reaches_over_the_street_and_ends_where_the_ground_stands_over_the_road(self):
  p,rec,streets=self.ramp();self.assertEqual(H.landing_interval(p,rec,0,29,0,streets),[0,9.9],'on the ground: as far as the street reaches')
  # level for 6 m, then down at 6%: 0.18 m under the ground at 9 m, past the lip inside the street's reach
  p.y=[-max(0,3*i-6)*.06 for i in range(30)];self.assertEqual(H.landing_interval(p,rec,0,29,0,streets),[0,round(6+3*H.LANDING_STEP/.18,3)],'back to where the ground first stood a step over it')
  p.on_deck=[True,False];self.assertEqual(H.landing_interval(p,rec,0,29,0,streets),[0,9.9],'a ramp that starts on a bridge is not measured against the ground beneath it')
  p.on_deck=[False,False];p.y=[-.1]*30;self.assertEqual(H.landing_interval(p,rec,0,29,0,streets),[0,9.9],'within the lip the two share the ground')
  # at the other end of a route the interval is counted back from the record's end
  q,rec,_=self.ramp();q.y=[-max(0,81-3*i)*.06 for i in range(30)];end=[({'id':'s','name':'Cross Street','points':[[87,-40],[87,40]],'width':12},1)]
  self.assertEqual(H.landing_interval(q,rec,0,29,1,end),[round(87-(6+3*H.LANDING_STEP/.18),3),87.0])
 def test_a_reviewed_landing_is_held_on_its_street_and_begins_the_tunnel_record(self):
  p,rec,streets=self.ramp({'landing':12});p.level=[-1]*30;p.mid=[.2]*30;p.terrain=[-4.0]*30;p.fixed={0:.21};p.allowance=[min(1,3*i/15) for i in range(30)]
  H.street_stretch(p,0);on=[i for i in range(30) if p.street[i]];self.assertEqual(on,[0,1,2,3,4],'the stations of its first 12 m')
  self.assertEqual([p.fixed.get(i) for i in range(6)],[.21,.2,.2,.2,.2,None],'held on the street (its vertex keeps the height it was landed at)');self.assertEqual(p.reach,[12.0,0.])
  self.assertEqual([p.terrain[i] for i in (4,5)],[.2,-4.0]);self.assertEqual([p.allowance[i] for i in (4,5)],[0.,1.0])
  # the natural line starts from the street, not from under it
  nat=H.natural(p,(None,-6.0),[False]*30);self.assertEqual(nat[:5],[.2]*5);self.assertAlmostEqual(nat[-1],-6.0);self.assertLess(nat[6],.2)
  # solved: on the street for 12 m, in its slot from 18 m on. The record is one tunnel record from its first station, landing for 12 m.
  p.y=[.2 if i<5 else .2-(3*i-12)*.04 for i in range(30)];p.high=[.2]*30;p.low=[.2]*30;p.edge=[.2]*30;p.landing=[True,False];p.ends=[('street',streets[0][0]),None]
  H.classify_ground(p);self.assertEqual(p.tunnel,[True]*30,'the street stretch and the first shallow metres belong to the record that goes down');self.assertFalse(any(p.covered),'3 m down at its end: no room for a roof yet')
  self.assertEqual(H.landing_interval(p,rec,0,29,0,streets),[0,12.0])
  free=plan(line(30),[7.0]*30,main=False,lanes=1);self.assertFalse(any(free.street),'no route is held without a reviewed landing')
 def test_the_two_reviewed_landings(self):
  held={r['id']:r['landing'] for r in H.ROUTES if 'landing' in r};self.assertEqual(held,{'i90-wb-entrance-copley':12,'i90-eb-entrance-135':24})
  self.assertEqual({r['id']:r['width'] for r in H.ROUTES if 'width' in r},{'i90-wb-entrance-copley':6.0},"the survey's slot between Huntington Avenue's carriageways")


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
