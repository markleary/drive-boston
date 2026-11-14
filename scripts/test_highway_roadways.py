"""The surveyed roadways of the highway stage (scripts/highway_roadways.py) on small synthetic inputs."""
import math,unittest
import numpy as np
from shapely.geometry import LineString
import boston_highways as H
import highway_roadways as HR
import i93_north as I


def plan(id='storrow-t',n=61,z=0.0,width=6.65,lanes=2,bridge='storrow',main=True,cut=False,y=.35):
 """A solved road along x at `z`, every 3 m: a deck riding its ground at TERRAIN_RISE, or an open cut (`cut`)."""
 p=H.Plan(id,[[i*3.0,z] for i in range(n)],[0]*n,[width]*n,I.MAINLINE_GRADE,[lanes]*n)
 p.main=main;p.spec={'bridge':bridge};p.y=[y]*n;p.high=[0.0]*n;p.tunnel=[cut]*n;p.covered=[False]*n;p.built=[[] for _ in range(n)];p.junctions=[];p.level=[0]*n;p.edge=[0.0]*n;return p


def curb(offset,a=-10.0,b=200.0,z=0.0):return [[a,z+offset],[b,z+offset]]
def flat(x,z):return 0.0
def none(bounds):return []
def survey(plans,curbs,streets=(),hold=None,buildings=none):
 """Measure and correct `plans`; +z is a plan's left here (its normal is (-tz, tx) = (0, 1))."""
 m=HR.survey(plans,curbs,list(streets),flat,flat,buildings,H.least_width);pairs,summary,_=HR.apply(plans,m,{},H.least_width,hold or {});return m,pairs,summary


class MeasureTest(unittest.TestCase):
 def test_the_first_curb_each_way_is_the_edge(self):
  p=plan();m,_,_=survey([p],[curb(5.0),curb(-3.5)]);k=m[p.id]['at'][30]
  self.assertAlmostEqual(m[p.id]['L'][k],5.0,places=6);self.assertAlmostEqual(m[p.id]['R'][k],3.5,places=6)

 def test_a_side_the_survey_does_not_show_is_carried_between_its_neighbours(self):
  p=plan();m,_,_=survey([p],[curb(5.0,-10,60),curb(6.0,120,200),curb(-3.5)]);at=m[p.id]['at'];L=m[p.id]['L']
  self.assertAlmostEqual(L[at[30]],5.5,places=1,msg='half way through a 60 m gap between a curb at 5 m and one at 6 m');self.assertFalse(np.isnan(L[at[5]:at[55]]).any(),'no station falls back to the lane-count width')

 def test_a_short_excursion_is_not_the_edge(self):
  p=plan();m,_,_=survey([p],[curb(5.0),curb(-3.5),[[88,1.0],[92,1.0]]]);self.assertAlmostEqual(m[p.id]['L'][m[p.id]['at'][30]],5.0,places=6,msg='a 4 m piece of curb in the roadway is dropped')

 def test_a_far_curb_with_another_road_behind_it_is_that_roads(self):
  street={'id':'s','name':'Back Street','points':[[-10,-11.0],[200,-11.0]],'width':7.0}
  p=plan();m,_,_=survey([p],[curb(5.0),curb(-9.0)],[street]);self.assertTrue(np.isnan(m[p.id]['R'][m[p.id]['at'][30]]),"the street's own curb, reached across a verge")
  q=plan();m,_,_=survey([q],[curb(5.0),curb(-9.0)]);self.assertAlmostEqual(m[q.id]['R'][m[q.id]['at'][30]],9.0,places=6,msg='with nothing behind it the far curb is the edge: a merge lane')
  r=plan();m,_,_=survey([r],[curb(5.0),curb(-4.5)],[{**street,'points':[[-10,-6.0],[200,-6.0]]}]);self.assertAlmostEqual(m[r.id]['R'][m[r.id]['at'][30]],4.5,places=6,msg="a curb close to the lanes is the road's own whatever lies behind it")

 def test_a_far_curb_on_other_ground_is_no_edge(self):
  p=plan();m=HR.survey([p],[curb(5.0),curb(-9.0)],[],flat,(lambda x,z:3.0 if z<-8 else 0.0),none,H.least_width);self.assertTrue(np.isnan(m[p.id]['R'][m[p.id]['at'][30]]),'the top of a bank')

 def test_a_road_alongside_at_the_same_height_shares_the_roadway(self):
  a=plan('storrow-a');b=plan('storrow-b',z=-8.0);m,_,_=survey([a,b],[curb(5.0),curb(-12.0)]);k=m['storrow-a']['at'][30]
  self.assertAlmostEqual(m['storrow-a']['R'][k],4.0+HR.OVERLAP,places=6,msg='to the line half way between the two');self.assertAlmostEqual(m['storrow-b']['L'][k],4.0+HR.OVERLAP,places=6)
  c=plan('storrow-c');d=plan('storrow-d',z=-8.0,y=6.0);m,_,_=survey([c,d],[curb(5.0),curb(-12.0)]);self.assertAlmostEqual(m['storrow-c']['R'][k],12.0,places=6,msg='a road 6 m overhead shares nothing')

 def test_a_tunnel_alongside_bounds_the_roadway_at_its_wall(self):
  # a ramp's cut beside the tunnel it joins: the survey has the trench's curb 5 m out, over the tunnel's roof, whose wall stands 3.2 m out
  a=plan('storrow-a',cut=True);b=plan('storrow-b',z=-6.5,cut=True);b.covered=[True]*61;m,_,_=survey([a,b],[curb(4.5),curb(-5.0)]);k=m['storrow-a']['at'][30]
  self.assertAlmostEqual(m['storrow-a']['R'][k],6.65/2,places=6,msg="no wider than its own pavement on the tunnel's side");self.assertAlmostEqual(m['storrow-a']['L'][k],4.5,places=6)
  self.assertLessEqual(min(q[1]-w/2 for q,w in zip(a.points,a.widths)),-6.65/2+.76,'and the cut it becomes stays out of the tunnel but for the move to the middle of what is left')
  # 6 m overhead it clears the roof, and the trench is its own
  c=plan('storrow-c',cut=True,y=6.4);d=plan('storrow-d',z=-6.5,cut=True);d.covered=[True]*61;m,_,_=survey([c,d],[curb(4.5),curb(-5.0)]);self.assertAlmostEqual(m['storrow-c']['R'][m['storrow-c']['at'][30]],5.0,places=6)

 def test_a_curb_across_the_centre_line_hides_the_road_under_it(self):
  p=plan();bridge=[[[80,-20],[80,20]],[[100,-20],[100,20]],[[80,2.0],[100,2.0]]];m,_,_=survey([p],[curb(5.0),curb(-3.5)]+bridge);at=m[p.id]['at']
  self.assertTrue(m[p.id]['under'][at[30]],'between the two edges of a bridge 20 m wide');self.assertAlmostEqual(m[p.id]['L'][at[30]],5.0,places=6,msg="the bridge's kerb 2 m from the centre line is not the roadway's")

 def test_two_curbs_the_lanes_do_not_fit_between_are_ignored(self):
  p=plan();m,_,_=survey([p],[curb(2.0),curb(-2.0)]);self.assertTrue(np.isnan(m[p.id]['L']).all() and np.isnan(m[p.id]['R']).all(),'two lanes do not run in 4 m');self.assertEqual(p.widths,[6.65]*61)

 def test_only_a_road_in_the_open_at_its_ground_is_measured(self):
  p=plan(y=6.0);m,_,_=survey([p],[curb(5.0),curb(-3.5)]);self.assertFalse(m[p.id]['open'].any(),'a viaduct');self.assertEqual(p.shift,[0.0]*61)
  q=plan(cut=True);q.covered=[20<=i<=40 for i in range(61)];m,_,_=survey([q],[curb(5.0),curb(-3.5)]);self.assertFalse(m[q.id]['open'][m[q.id]['at'][21]:m[q.id]['at'][40]].any(),'a roofed stretch');self.assertTrue(m[q.id]['open'][m[q.id]['at'][10]])


class CorrectTest(unittest.TestCase):
 def test_a_cut_moves_onto_the_middle_of_its_roadway_and_takes_it_whole(self):
  p=plan(cut=True);survey([p],[curb(5.0),curb(-3.5)])
  self.assertAlmostEqual(p.shift[30],.75,places=2);self.assertAlmostEqual(p.widths[30],8.5,places=2);self.assertAlmostEqual(p.points[30][1],.75,places=2)
  self.assertEqual((p.shift[0],p.shift[-1]),(0.0,0.0),'the ends, where other roads meet it, stay');self.assertEqual(p.points[0],[0.0,0.0])
  self.assertLessEqual(max(abs(a-b) for a,b in zip(p.shift,p.shift[1:])),HR.SHIFT_RATE*3+1e-6);self.assertLessEqual(max(abs(a-b)/2 for a,b in zip(p.widths,p.widths[1:])),HR.WIDTH_RATE*3+.002)

 def test_a_cut_is_walled_at_its_own_kerbs_and_takes_no_more_than_a_shoulder_beside_its_lanes(self):
  p=plan(cut=True);survey([p],[curb(9.0),curb(-9.0)]);self.assertEqual(p.widths,[6.65]*61,'a curb far beside a cut is not its wall')
  # two cuts 12 m apart with no curb between them share that ground half way, and neither takes more than a shoulder beside its lanes
  a=plan('storrow-a',cut=True);b=plan('storrow-b',z=-12.0,cut=True);survey([a,b],[curb(4.0),curb(-16.0)])
  self.assertAlmostEqual(a.points[30][1]-a.widths[30]/2,-6.0-HR.OVERLAP,places=2);self.assertAlmostEqual(a.points[30][1]+a.widths[30]/2,4.0,places=2);self.assertLessEqual(max(a.widths),2*(2*I.LANE/2+HR.SHOULDER))

 def test_a_deck_keeps_its_lanes_and_is_paved_to_the_curbs(self):
  p=plan();_,pairs,_=survey([p],[curb(3.4),curb(-8.5)]);self.assertEqual(p.shift,[0.0]*61);self.assertEqual(p.widths,[6.65]*61)
  self.assertEqual(len(pairs),1);apron=pairs[0][1];self.assertTrue(apron['graded']);self.assertAlmostEqual(apron['left'][0][1],3.4,places=2);self.assertAlmostEqual(apron['right'][0][1],-8.5,places=2)
  self.assertAlmostEqual(HR.strip(apron).area,180*11.9,delta=1)

 def test_a_curb_inside_the_lanes_moves_a_deck_just_clear_of_it(self):
  p=plan();survey([p],[curb(2.0),curb(-9.0)]);self.assertAlmostEqual(p.shift[30],2.0-6.65/2,places=2);self.assertEqual(p.widths[30],6.65)

 def test_a_turnpike_carriageway_only_narrows_and_keeps_room_beside_its_lanes(self):
  wide=plan('i90-t',width=15.2,lanes=3,bridge='i90');survey([wide],[curb(12.0),curb(-12.0)]);self.assertEqual(wide.widths,[15.2]*61);self.assertEqual(wide.shift,[0.0]*61)
  tight=plan('i90-t',width=15.2,lanes=3,bridge='i90');_,pairs,_=survey([tight],[curb(5.0),curb(-6.0)]);self.assertAlmostEqual(tight.widths[30],3*I.LANE+2*HR.SHY,places=2);self.assertAlmostEqual(tight.shift[30],-.5,places=2);self.assertEqual(pairs,[],'a carriageway is railed at its pavement, not paved beside it')

 def test_a_station_beside_a_building_stays_as_solved(self):
  p=plan(cut=True);p.built[30]=[0];survey([p],[curb(5.0),curb(-3.5)])
  for i in (29,30,31):self.assertEqual((p.shift[i],p.widths[i]),(0.0,6.65))
  self.assertLessEqual(max(abs(a-b)/2 for a,b in zip(p.widths,p.widths[1:])),HR.WIDTH_RATE*3+.002,'and the pavement comes out to it without a step')

 def test_a_moved_pavement_keeps_clear_of_a_building(self):
  from shapely.geometry import box
  p=plan(cut=True);hull=box(60,4.5,120,20);m,_,_=survey([p],[curb(5.5),curb(-3.5)],buildings=lambda bounds:[{'hull':hull}])
  self.assertAlmostEqual(m[p.id]['L'][m[p.id]['at'][30]],4.5-HR.CLEAR,places=6);self.assertLessEqual(p.points[30][1]+p.widths[30]/2,4.5-HR.CLEAR+1e-6)

 def test_a_held_station_stays_and_a_rerun_starts_from_the_solved_road(self):
  p=plan(cut=True);m,_,_=survey([p],[curb(5.0),curb(-3.5)]);moved=list(p.points);HR.apply([p],m,{},H.least_width,{p.id:{30}})
  self.assertEqual(p.shift[30],0.0);self.assertEqual(p.points[30],[90.0,0.0]);HR.apply([p],m,{},H.least_width,{});self.assertEqual(p.points,moved,'the same correction again')
  HR.restore(p);self.assertEqual(p.points,[[i*3.0,0.0] for i in range(61)]);self.assertEqual(p.widths,[6.65]*61)


class GradeTest(unittest.TestCase):
 grid={'width':60,'height':30,'cellSize':6,'originX':-60,'originZ':-90,'scale':.01}
 def ground(self,heights):return I.Terrain(self.grid,heights)
 def run_(self,streets=(),sag=False,curbs=None,landing=0):
  p=plan();p.allowance=[min(1.0,i/landing) if landing else 1.0 for i in range(61)]
  if sag:p.y=[.35+((i-30)*3.0)**2/200 for i in range(61)]
  _,pairs,_=survey([p],curbs or [curb(3.4),curb(-8.5)],streets);heights=np.zeros(60*30,dtype='<i2')
  out=HR.grade([p],pairs,self.grid,heights,list(streets),set(),none,[],H.deck_runs([p]),[],H.LANDING_LIP);return p,out
 def test_the_ground_is_set_under_the_deck_across_its_roadway(self):
  p,out=self.run_();g=self.ground(out)
  for z in (-8.0,-3.0,0.0,3.0):self.assertAlmostEqual(g(90.0,z),.35-HR.DROP,delta=.011,msg=f'{z} m across')
  self.assertEqual(g(90.0,-40.0),0.0,'and stays where the roadway does not reach');self.assertEqual(H.standing_ground([p],g),{})
 def test_the_ground_stays_under_a_deck_that_sags(self):
  p,out=self.run_(sag=True);self.assertEqual(H.standing_ground([p],self.ground(out)),{},'no ground between two vertices reaches the pavement')
 def test_a_street_beside_the_road_keeps_its_ground(self):
  street={'id':'s','name':'Back Street','points':[[-10,-14.0],[200,-14.0]],'width':7.0};p,out=self.run_([street]);g=self.ground(out)
  self.assertEqual(g(90.0,-14.0),0.0);self.assertAlmostEqual(g(90.0,0.0),.35-HR.DROP,delta=.011,msg="but the deck's own pavement is set")
  # the street's class corridor passes over the cells out to 6 m from the deck, where the survey has the deck's roadway (its curb stands at 8.5 m)
  self.assertAlmostEqual(g(90.0,-6.0),.35-HR.DROP,delta=.011,msg="and so is its surveyed roadway, whatever the street's class width covers")
 def test_a_roadway_shared_with_a_street_is_one_surface(self):
  # a lane leaving beside the deck, 7 m from its centre line with no curb between the two: the far curb of that lane stands 11 m out
  street={'id':'s','name':'Mugar Way','points':[[-10,-7.0],[200,-7.0]],'width':7.0};p,out=self.run_([street],curbs=[curb(3.4),curb(-11.0)]);g=self.ground(out);edge=7.0/2+HR.OVERLAP
  self.assertAlmostEqual(g(90.0,0.0),.35-HR.DROP,delta=.011);self.assertAlmostEqual(g(90.0,-6.0),.35-HR.DROP-HR.CROSSFALL*(6.0-edge),delta=.011,msg="the street's lane is raised to fall 4% from the deck's edge")
  self.assertEqual(g(90.0,-12.0),0.0,"beyond the street's far curb its corridor keeps its ground");self.assertEqual(H.standing_ground([p],g),{})
  # one that stands higher than the deck's fall is left alone: the shared pavement is only ever raised
  heights=np.full(60*30,40,dtype='<i2');q=plan();q.allowance=[1.0]*61;_,pairs,_=survey([q],[curb(3.4),curb(-11.0)],[street])
  again=self.ground(HR.grade([q],pairs,self.grid,heights,[street],set(),none,[],H.deck_runs([q]),[],H.LANDING_LIP));self.assertEqual(again(90.0,-12.0),.4)
 def test_a_streets_class_width_does_not_reach_across_the_deck(self):
  # a lane 4 m beside the deck behind its own curb, 14 m wide by its class: its corridor passes over the cells on the far side of the deck too
  street={'id':'s','name':'Mugar Way','points':[[-10,-4.0],[200,-4.0]],'width':14.0};p,out=self.run_([street],curbs=[curb(3.4),curb(-3.5)]);g=self.ground(out)
  self.assertAlmostEqual(g(90.0,6.0),.35-HR.DROP,delta=.011,msg="beyond the deck's lanes from the street the ground is the deck's");self.assertEqual(g(90.0,-6.0),0.0,"on the street's own side its corridor keeps its ground")
 def test_of_two_roads_side_by_side_each_keeps_its_own_ground(self):
  # twin carriageways 12 m apart, the second 0.4 m lower: a vertex under the first one's lanes is in a cell the second one's roadway passes over
  a=plan('storrow-a');b=plan('storrow-b',z=-12.0,y=-.05)
  for q in (a,b):q.allowance=[1.0]*61
  _,pairs,_=survey([a,b],[curb(3.4),curb(-15.4)]);g=self.ground(HR.grade([a,b],pairs,self.grid,np.zeros(60*30,dtype='<i2'),[],set(),none,[],H.deck_runs([a,b]),[],H.LANDING_LIP))
  self.assertAlmostEqual(g(90.0,0.0),.35-HR.DROP,delta=.011,msg="the higher one's ground is its own, not the lower one's");self.assertAlmostEqual(g(90.0,-12.0),-.05-HR.DROP,delta=.011);self.assertEqual(H.standing_ground([a,b],g),{})
 def test_paving_beside_the_lanes_is_kept_only_where_the_ground_is_flush(self):
  # the ground beyond 5 m on the right is held 1 m under the deck (another road's): the paving stops where it falls away
  p=plan();p.allowance=[1.0]*61;_,pairs,_=survey([p],[curb(3.4),curb(-8.5)]);heights=np.zeros(60*30,dtype='<i2');W=self.grid['width']
  out=HR.grade([p],pairs,self.grid,heights,[],set(),none,[],H.deck_runs([p]),[],H.LANDING_LIP);out[13*W:14*W]=-70;out[14*W:15*W]=-70
  pulled=HR.trim([p],pairs,self.ground(out));self.assertGreater(pulled,100);self.assertLess(p.roadway[30][1],6.0+.6);self.assertGreaterEqual(p.roadway[30][1],6.65/2);self.assertAlmostEqual(p.roadway[30][0],3.4,places=2,msg='the other side keeps its paving')
  self.assertLess(HR.strip(pairs[0][1]).area,180*9.0)
 def test_the_cell_a_route_lands_in_keeps_its_ground(self):
  p=plan();p.allowance=[min(1.0,i/5) for i in range(61)];p.ends=[('street',None),None];_,pairs,_=survey([p],[curb(3.4),curb(-8.5)]);W=self.grid['width']
  out=HR.grade([p],pairs,self.grid,np.zeros(60*30,dtype='<i2'),[],set(),none,[],H.deck_runs([p]),[],H.LANDING_LIP);g=self.ground(out)
  self.assertEqual([int(out[(15+b)*W+10+a]) for a in (0,1) for b in (0,1)],[0]*4,'the four corners round the landing vertex');self.assertEqual(g(0.0,0.0),0.0);self.assertAlmostEqual(g(18.0,0.0),.35-HR.DROP,delta=.011)
 def test_a_deck_in_its_street_landing_has_its_ground_raised_to_it(self):
  p,out=self.run_(landing=5);g=self.ground(out)
  self.assertAlmostEqual(g(6.0,0.0),.35-HR.DROP,delta=.011,msg='two stations into a landing of five');self.assertAlmostEqual(g(90.0,0.0),.35-HR.DROP,delta=.011)
  # ground that already stands higher in the landing is the street's and stays (the stage allows it LANDING_LIP over the deck there)
  q=plan();q.allowance=[min(1.0,i/5) for i in range(61)];_,pairs,_=survey([q],[curb(3.4),curb(-8.5)]);heights=np.zeros(60*30,dtype='<i2');W=self.grid['width'];v=15*W+11;heights[v]=40
  self.assertEqual(int(HR.grade([q],pairs,self.grid,heights,[],set(),none,[],H.deck_runs([q]),[],H.LANDING_LIP)[v]),40)


class LiftTest(unittest.TestCase):
 grid=GradeTest.grid
 def lifted(self,by=.5,rows=range(15,46),**extra):
  """A Turnpike carriageway on the ground whose twin has lifted the stations `rows` by `by` (boston_highways.build)."""
  p=plan('i90-t',bridge='i90',width=15.0,lanes=3,**extra);p.solo=list(p.y);p.y=[y+(by if i in rows else 0.) for i,y in enumerate(p.y)];return p
 def graded(self,p,heights,existing=()):
  return I.Terrain(self.grid,HR.grade([p],HR.fills([p],[]),self.grid,heights,[],set(),none,[],H.deck_runs([p]),list(existing),H.LANDING_LIP))

 def test_what_a_road_is_reads_the_heights_it_has_alone(self):
  p=self.lifted(2.0);self.assertEqual(HR.alone(p),p.solo);self.assertEqual(HR.alone(plan()),[.35]*61,'a road no twin has lifted: as it lies')
  self.assertTrue(all(HR.station_state(p,H.least_width)[0]),'a deck its twin has lifted 2 m still rides its ground')
  self.assertFalse(any(HR.station_state(plan('i90-u',bridge='i90',y=2.35),H.least_width)[0]),'one that stands as high alone is a viaduct')

 def test_the_ground_comes_up_with_a_lifted_road(self):
  p=self.lifted();strips=HR.fills([p],[]);self.assertEqual([(s['a'],s['b'],s['graded']) for _,s in strips],[(14,46,False)],'one strip over the lifted stretch, closed on the stations beside it')
  g=self.graded(p,np.full(60*30,-20,dtype='<i2'))   # the ground 0.55 m under the road as it rode alone
  self.assertAlmostEqual(g(90.0,0.0),.3,delta=.011,msg='up by what the road rose: it lies under the road as before');self.assertAlmostEqual(g(90.0,6.0),.3,delta=.011,msg='across its pavement')
  self.assertEqual(g(90.0,-40.0),-.2,'and nowhere else');self.assertEqual(g(15.0,0.0),-.2,'nor where the road kept its height')
  near=self.graded(p,np.full(60*30,30,dtype='<i2'));self.assertAlmostEqual(near(90.0,0.0),.85-HR.DROP,delta=.011,msg='to no more than DROP under the road');self.assertEqual(H.standing_ground([p],near),{})

 def test_the_ground_follows_under_a_bridge_but_not_under_a_road_that_lies_on_it(self):
  p=self.lifted();heights=np.full(60*30,-20,dtype='<i2');bridge={'id':'b','name':'Bridge','points':[[90.0,-60.0],[90.0,60.0]],'width':12.0,'elevations':[8.0,8.0]}
  self.assertAlmostEqual(self.graded(p,heights,[bridge])(90.0,0.0),.3,delta=.011,msg='a deck 7 m overhead passes over the road')
  self.assertEqual(self.graded(p,heights,[{**bridge,'elevations':[.6,.6]}])(90.0,0.0),-.2,'one at the height of that ground is a road on it, whose ground stays')

 def test_no_fill_where_a_graded_strip_sets_the_ground_or_the_road_is_a_viaduct_or_roofed(self):
  p=self.lifted();self.assertEqual(HR.fills([p],[(p,{'graded':True,'a':0,'b':60})]),[]);self.assertEqual(len(HR.fills([p],[(p,{'graded':False,'a':0,'b':60})])),1,'a strip that only raises (a street landing) sets nothing')
  v=self.lifted();v.solo=[y+2.0 for y in v.solo];v.y=[y+2.0 for y in v.y];self.assertEqual(HR.fills([v],[]),[],'a deck that stood over its ground alone')
  c=self.lifted(cut=True);c.covered=[True]*61;self.assertEqual(HR.fills([c],[]),[],'under a roof');c.covered=[False]*61;self.assertEqual(len(HR.fills([c],[])),1,'an open cut takes its ground up like a deck')
  self.assertEqual(HR.fills([plan()],[]),[],'a road no twin has lifted has none')


def carriageways(apart,width=15.8,lanes=4,n=61,y=.35,**extra):
 """The two carriageways of a railed road `apart` metres from centre line to centre line: `a` runs along +x at z = 0, `b` back along -x beside it."""
 a=plan('i90-a',n=n,width=width,lanes=lanes,bridge='i90',y=y,**extra);b=plan('i90-b',n=n,width=width,lanes=lanes,bridge='i90',y=y,**extra)
 b.points=[[(n-1-i)*3.0,-float(apart)] for i in range(n)];b.tangents=I.tangents(b.points);b.line=LineString(b.points);return a,b
def parted(a,b,curbs=(),hold=None):
 m=HR.survey([a,b],list(curbs),[],flat,flat,none,H.least_width);_,_,medians=HR.apply([a,b],m,{},H.least_width,hold or {},[(a,b)]);return medians[0]
def between(a,b):
 """Metres between the two pavements at each station of `a` (the carriageways lie along x)."""
 return [abs(p[1]-q[1])-(w+v)/2 for p,w,q,v in zip(a.points,a.widths,b.points[::-1],b.widths[::-1])]
def edges(p):return [(q[1]-w/2,q[1]+w/2) for q,w in zip(p.points,p.widths)]


class MedianTest(unittest.TestCase):
 def test_two_pavements_in_each_other_each_end_half_the_barrier_short_of_the_middle(self):
  # two pavements of four lanes and 0.6 m beside them, their centre lines 14.6 m apart: 1.2 m in each other
  a,b=carriageways(14.6);self.assertAlmostEqual(between(*carriageways(14.6))[30],-1.2,places=6);out=parted(a,b);gap=between(a,b)
  self.assertGreaterEqual(min(gap[1:-1]),HR.BARRIER);self.assertLessEqual(max(gap[2:-2]),HR.BARRIER+2*HR.MEDIAN_SLACK,"no more is taken than the barrier's footprint")
  # the middle of the overlap lay 7.3 m from either centre line: each median edge ends 0.31 m short of it, and the outer edges stay
  self.assertAlmostEqual(edges(a)[30][0],-7.3+HR.BARRIER/2,delta=.02);self.assertAlmostEqual(edges(b)[30][1],-7.3-HR.BARRIER/2,delta=.02);self.assertAlmostEqual(edges(a)[30][1],7.9,delta=.002);self.assertAlmostEqual(edges(b)[30][0],-14.6-7.9,delta=.002)
  self.assertGreaterEqual(min(a.widths),H.least_width(a,0));self.assertGreater(a.shift[30],.4,'its centre line, and its lanes with it, move out by half of what the pavement lost')
  self.assertEqual(out['roads'],['i90-a','i90-b']);self.assertEqual(out['parted']['i90-a']['tight'],[]);self.assertGreaterEqual(out['leastBetween'],HR.BARRIER);self.assertAlmostEqual(out['parted']['i90-a']['maxBack'],.92,delta=.02)
  self.assertEqual((a.shift[0],a.shift[-1],b.shift[0]),(0.0,0.0,0.0),'the ends, where other records meet, do not move')

 def test_pavements_closer_than_the_barrier_is_wide_are_parted_and_wider_medians_left(self):
  a,b=carriageways(16.1);parted(a,b);self.assertGreaterEqual(min(between(a,b)[1:-1]),HR.BARRIER);self.assertAlmostEqual(a.widths[30],15.8-(HR.BARRIER+HR.MEDIAN_SLACK-.3)/2,delta=.02)
  c,d=carriageways(16.6);out=parted(c,d);self.assertEqual((c.widths,c.shift,d.widths),([15.8]*61,[0.0]*61,[15.8]*61),'0.8 m between the two: nothing to mend');self.assertEqual(out['passes'],0)

 def test_the_room_the_survey_shows_beyond_the_outer_edge_goes_first(self):
  # each outer curb stands 1 m beyond its pavement: the carriageways move out to them and keep their shoulders
  a,b=carriageways(14.6);parted(a,b,[curb(8.9),curb(-14.6-8.9)]);self.assertGreaterEqual(min(between(a,b)[1:-1]),HR.BARRIER)
  self.assertEqual(a.widths[30],15.8);self.assertAlmostEqual(a.shift[30],.92,delta=.02);self.assertLessEqual(edges(a)[30][1],8.9+1e-6)
  # with 0.5 m there, the pavement takes that and narrows for the rest, its outer edge at the curb
  c,d=carriageways(14.6);parted(c,d,[curb(8.4),curb(-14.6-8.4)]);self.assertAlmostEqual(edges(c)[30][1],8.4,delta=.002);self.assertAlmostEqual(c.widths[30],15.8-.42,delta=.03);self.assertGreaterEqual(min(between(c,d)[1:-1]),HR.BARRIER)

 def test_a_pavement_at_its_least_width_moves_out_and_keeps_its_lanes(self):
  # two viaducts of four lanes at their least width (the lane centres 1.2 m inside), 13.2 m apart: nothing to narrow
  least=3*I.LANE+2*HR.LANE_ROOM;a,b=carriageways(13.2,width=least,y=7.35);self.assertFalse(any(HR.station_state(a,H.least_width)[0]),'no curb is measured on a viaduct');out=parted(a,b)
  self.assertEqual(a.widths[5:-5],[least]*51);self.assertGreaterEqual(min(between(a,b)),HR.BARRIER);self.assertAlmostEqual(a.shift[30],(least+HR.BARRIER+HR.MEDIAN_SLACK-13.2)/2,delta=.01);self.assertAlmostEqual(b.shift[30],a.shift[30],delta=.01)
  self.assertAlmostEqual(out['parted']['i90-a']['maxPast'],a.shift[30],delta=.01,msg='the outer edge passes where it lay by as much')
  # an inner lane's centre keeps LANE_ROOM to the barrier's face
  inner=1.5*I.LANE;self.assertGreaterEqual(min(w/2-inner+(g-HR.BARRIER)/2 for w,g in list(zip(a.widths,between(a,b)))[10:-10]),HR.LANE_ROOM)
  self.assertLessEqual(max(abs(p-q) for p,q in zip(a.shift,a.shift[1:])),HR.SHIFT_RATE*3+.002,'the centre line leaves its ends no faster than a curb moves it')
  # both roads end abreast here, and neither end moves: only there, where neither can give with its lanes kept, do the pavements come narrower, by the same on both
  tight=out['parted']['i90-a']['tight'];self.assertEqual([t[:2] for t in tight],[[0,1],[59,60]]);self.assertAlmostEqual(tight[0][2],(least+HR.BARRIER+HR.MEDIAN_SLACK-13.2)/2,delta=.01);self.assertEqual(a.widths[0],b.widths[-1])

 def test_a_pinned_station_does_not_move_and_narrows(self):
  a,b=carriageways(14.6);out=parted(a,b,hold={'i90-a':{30}});gap=between(a,b)
  self.assertEqual(a.shift[30],0.0);self.assertEqual(a.points[30],[90.0,0.0]);self.assertAlmostEqual(a.widths[30],15.8-2*.92,delta=.05,msg='what the move cannot give, the width does: both edges come in')
  self.assertGreaterEqual(min(gap[1:-1]),HR.BARRIER);self.assertLessEqual(max(abs(p-q) for p,q in zip(a.shift,a.shift[1:])),HR.SHIFT_RATE*3+.002);self.assertLessEqual(max(abs(p-q)/2 for p,q in zip(a.widths,a.widths[1:])),HR.WIDTH_RATE*3+.002)
  # at its least width a pinned station cannot give: it is listed, with what it is short
  self.assertEqual(out['parted']['i90-a']['tight'],[],'13.96 m still hold four lanes')
  # at its least width a pinned station cannot give: its twin takes what is left, and it keeps its lanes
  least=3*I.LANE+2*HR.LANE_ROOM;need=least+HR.BARRIER+HR.MEDIAN_SLACK-13.2;c,d=carriageways(13.2,width=least,y=7.35);out=parted(c,d,hold={'i90-a':{30}});self.assertGreaterEqual(min(between(c,d)),HR.BARRIER)
  self.assertEqual((c.shift[30],c.widths[30]),(0.0,least));self.assertAlmostEqual(d.shift[30],need,delta=.06,msg='all of it');self.assertEqual(d.widths[30],least);self.assertAlmostEqual(d.shift[20],need/2,delta=.01,msg='and half again where the other can give its own')
  self.assertFalse(any(i<=30<=j for i,j,_ in out['parted']['i90-a']['tight']+out['parted']['i90-b']['tight']))
  # pinned on both sides, each comes narrower than its lanes take by half of what is missing, and the stretch is listed
  e,f=carriageways(13.2,width=least,y=7.35);out=parted(e,f,hold={'i90-a':{30},'i90-b':{30}});self.assertGreaterEqual(min(between(e,f)),HR.BARRIER);self.assertAlmostEqual(e.widths[30],least-need,delta=.02);self.assertAlmostEqual(f.widths[30],least-need,delta=.02)
  tight=[t for t in out['parted']['i90-a']['tight'] if t[0]<=30<=t[1]];self.assertEqual(len(tight),1);self.assertAlmostEqual(tight[0][2],need/2,delta=.01)

 def test_no_median_under_a_roof_between_two_levels_or_beside_a_road_running_the_same_way(self):
  a,b=carriageways(14.6,cut=True);b.covered=[True]*61;out=parted(a,b);self.assertEqual((a.widths,b.widths,out['passes']),([15.8]*61,[15.8]*61,0),'a bore keeps its walls')
  c,d=carriageways(14.6);d.y=[.35+HR.STOREY]*61;parted(c,d);self.assertEqual(c.widths,[15.8]*61,'a road a storey overhead passes over')
  e=plan('i90-a',width=15.8,lanes=4,bridge='i90');f=plan('i90-b',z=-14.6,width=15.8,lanes=4,bridge='i90');parted(e,f);self.assertEqual(e.widths,[15.8]*61,'a road running the same way is no twin across a median')
  g,h=carriageways(14.6);h.y=[.35+1.0]*61;parted(g,h);self.assertGreaterEqual(min(between(g,h)[1:-1]),HR.BARRIER,'a step of a metre is a median with a ledge: the two are parted')

 def test_at_a_portal_the_pavements_are_parted_as_far_as_the_first_roofed_station(self):
  # the eastbound road goes under a roof at station 30: its pavement lies in the open up to that station, which keeps its place and narrows
  a,b=carriageways(14.6,cut=True);a.covered=[i>=30 for i in range(61)];out=parted(a,b);gap=between(a,b)
  self.assertGreaterEqual(min(gap[:31]),HR.BARRIER);self.assertEqual(a.shift[30],0.0);self.assertLess(a.widths[30],15.8);self.assertGreaterEqual(a.widths[30],H.least_width(a,30))
  self.assertEqual(a.widths[36:],[15.8]*25,'and inside, the bore is as it was solved');self.assertEqual(a.shift[30:],[0.0]*31);self.assertLessEqual(max(abs(p-q)/2 for p,q in zip(a.widths,a.widths[1:])),HR.WIDTH_RATE*3+.002)
  self.assertEqual(b.widths[:24],[15.8]*24,'the road beside the bore keeps its pavement there');self.assertLess(b.widths[30],15.8,'and gives its half at the portal');self.assertLessEqual(out['passes'],6)

 def test_only_a_railed_road_has_a_median_barrier(self):
  self.assertTrue(HR.railed(plan('i90-t',bridge='i90')));self.assertFalse(HR.railed(plan()),'a parkway is paved to its curbs');self.assertFalse(HR.railed(plan('i90-ramp',bridge='i90',main=False)))

 def record(self,id,z,width=15.8,lanes=4,back=False,y=5.0,bridge='i90',n=21,**extra):
  xs=[(n-1-i)*3.0 if back else i*3.0 for i in range(n)];return {'id':id,'points':[[x,z] for x in xs],'deckWidths':[width]*n,'width':width,'lanes':lanes,'elevations':[y]*n,'bridge':{'id':bridge},**extra}
 def test_the_installed_records_are_held_to_it(self):
  ok=HR.median_check([([self.record('a-01',0.0)],[self.record('b-01',-16.5,back=True)],True)]);self.assertEqual(ok['medianStations'],42);self.assertAlmostEqual(ok['leastBetween'],.7,places=3);self.assertAlmostEqual(ok['leastLaneRoom'],7.9-1.5*I.LANE+.04,places=3)
  with self.assertRaisesRegex(AssertionError,'in each other'):HR.median_check([([self.record('a-01',0.0)],[self.record('b-01',-15.0,back=True)],True)])
  with self.assertRaisesRegex(AssertionError,'less than the median barrier is wide'):HR.median_check([([self.record('a-01',0.0)],[self.record('b-01',-16.2,back=True)],True)])
  # a parkway's two roadways only keep out of each other
  self.assertEqual(HR.median_check([([self.record('a-01',0.0)],[self.record('b-01',-16.2,back=True)],False)])['medianStations'],0)
  with self.assertRaisesRegex(AssertionError,'in each other'):HR.median_check([([self.record('a-01',0.0)],[self.record('b-01',-15.0,back=True)],False)])
  # four lanes on 12.6 m: the lanes close up to keep 1.2 m inside (the runtime's rule), but a record 13.35 m wide at its widest that narrows to 12.6 m does not
  HR.median_check([([self.record('a-01',0.0,width=12.6)],[self.record('b-01',-13.3,width=12.6,back=True)],True)])
  narrow={**self.record('a-01',0.0,width=12.6),'width':13.35}
  with self.assertRaisesRegex(AssertionError,'inner lane'):HR.median_check([([narrow],[self.record('b-01',-13.3,width=12.6,back=True)],True)])
  HR.median_check([([narrow],[self.record('b-01',-13.3,width=12.6,back=True)],True)],{'a-01':[[0,20]]})
  # under a roof, a storey apart, or running the same way: no median
  roofed={**self.record('b-01',-15.0,back=True),'tunnel':{'covered':[[0,60]]}};del roofed['bridge'];roofed['highway']='i90'
  self.assertEqual(HR.median_check([([self.record('a-01',0.0)],[roofed],True)])['medianStations'],0);self.assertEqual(HR.median_check([([self.record('a-01',0.0)],[self.record('b-01',-15.0,back=True,y=5.0+HR.STOREY)],True)])['medianStations'],0)
  self.assertEqual(HR.median_check([([self.record('a-01',0.0)],[self.record('b-01',-15.0)],True)])['medianStations'],0)


class CheckTest(unittest.TestCase):
 def record(self,widths):return {'id':'t','points':[[i*3.0,0.0] for i in range(len(widths))],'deckWidths':widths}
 def test_a_step_in_the_pavement_fails(self):
  self.assertEqual(HR.check({'t':[self.record([6.0,6.5,7.0])]},[],{},flat)['widthStations'],2)
  with self.assertRaises(AssertionError):HR.check({'t':[self.record([6.0,8.5,8.5])]},[],{},flat)
  with self.assertRaises(AssertionError):HR.check({'t':[self.record([6.0,6.0]),{**self.record([8.5,8.5]),'points':[[3.0,0.0],[6.0,0.0]]}]},[],{},flat)
 def test_an_apron_must_be_a_surface_of_its_route(self):
  good={'road':'t','left':[[0,3],[30,3]],'right':[[0,-3],[30,-3]]};HR.check({'t':[self.record([6.0,6.0])]},[good],{},flat)
  with self.assertRaises(AssertionError):HR.check({'t':[self.record([6.0,6.0])]},[{**good,'road':'other'}],{},flat)


class ExtractTest(unittest.TestCase):
 def test_only_the_survey_along_the_routes_is_kept(self):
  features=[{'geometry':{'paths':[[[0,5],[100,5]],[[0,500],[100,500]]]}},{'geometry':{'paths':[[[-200,5],[300,5]]]}}]
  out=HR.extract_curbs(features,lambda x,z:[x,z],[[[0,0],[100,0]]]);self.assertEqual(len(out),2);self.assertEqual(out[0],[[0,5],[100,5]])
  self.assertAlmostEqual(out[1][0][0],-math.sqrt(HR.CURB_ZONE**2-25),places=1,msg='a long curb is cut to the zone')


if __name__=='__main__':unittest.main()
