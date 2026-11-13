"""Interstate 93 stage pieces (scripts/i93_north.py) on small synthetic inputs."""
import pathlib,tempfile,unittest
import numpy as np
from shapely.geometry import box
import i93_north as I
from i93_north import LIFT
from tileformat import mesh_record,read_tile,write_tile


def turn(points):
 v=np.diff(np.asarray(points,dtype=float)[:,:2],axis=0);a=np.degrees(np.arctan2(v[:,1],v[:,0]))
 return float(np.abs((np.diff(a)+180)%360-180).max())


def plan_area(vertices,faces):
 p=vertices[faces][:,:,[0,2]];return float(np.abs((p[:,1,0]-p[:,0,0])*(p[:,2,1]-p[:,0,1])-(p[:,1,1]-p[:,0,1])*(p[:,2,0]-p[:,0,0])).sum()/2)


class TraceTest(unittest.TestCase):
 def pieces(self):
  # Two traced pieces [x, z, height, half width, lanes] that the tracer split 3 m apart sideways.
  return [[[x,0.0,10.0,5.0,3] for x in np.arange(0,301,3.0)],[[x,3.0,10.0,5.5,4] for x in np.arange(300,601,3.0)]]

 def test_a_trace_starts_and_ends_on_the_records_it_continues(self):
  pts=I.trace_points(self.pieces(),[1.0,1.5,9.0],[598.0,2.0,11.0])
  self.assertEqual(pts[0][:3],[1.0,1.5,9.0]);self.assertEqual(pts[-1][:3],[598.0,2.0,11.0])
  self.assertTrue(all(abs(p[2]-(10+I.LIFT))<1e-9 for p in pts if 150<p[0]<200),'away from its ends a trace rides LIFT over the traced surface')

 def test_a_split_between_traced_pieces_becomes_a_curve(self):
  pts=I.trace_points(self.pieces(),[1.0,0.0,10.0],[598.0,3.0,10.0])
  self.assertLess(turn(pts),8,'no kink where the tracer split the carriageway')
  labels=[p[5] for p in pts];k=labels.index(1)
  self.assertEqual(labels,[0]*k+[1]*(len(labels)-k),'the trace changes piece once');self.assertAlmostEqual(pts[k][0],300,delta=8)

 def test_hermite_leaves_and_arrives_along_its_tangents(self):
  curve=I.hermite([0,0],[1,0],[30,10],[0,1])
  self.assertTrue(all(0<u<1 for _,u in curve));first=curve[0][0];last=curve[-1][0]
  self.assertLess(abs(first[1]),.5);self.assertGreater(first[0],1);self.assertLess(abs(last[0]-30),.5)

 def test_place_names_fall_back_to_the_nearest_neighbourhood(self):
  hoods=[{'name':'Charlestown','shape':box(0,0,100,100)},{'name':'Somerville','shape':box(300,0,400,100)}]
  self.assertEqual(I.place_name([50,50],hoods),'Charlestown');self.assertEqual(I.place_name([180,50],hoods),'Charlestown')
  self.assertEqual(I.place_name([250,50],hoods),'Somerville');self.assertIsNone(I.place_name([50,400],hoods))


class MergeTest(unittest.TestCase):
 def test_an_entrance_beside_the_trace_curves_onto_one_of_its_vertices(self):
  pts=[[x,0.0,10.0+LIFT,8.0,4,0] for x in np.arange(0,301,3.0)];join=[0.0,7.0,10.3];flat=lambda x,z:10.0
  rows=I.merge_points(pts,join,[1.0,0.0],3.2,flat)
  self.assertEqual(rows[0][:3],join);end=min(pts,key=lambda p:abs(p[0]-I.CROSS_MERGE));self.assertEqual(rows[-1][:3],end[:3])
  self.assertLess(turn(rows),8);self.assertEqual({r[4] for r in rows},{1})
  middle=[r[2] for r in rows if I.TRACE_BLEND+5<r[0]<end[0]-I.TRACE_BLEND-5];self.assertTrue(middle and all(abs(y-10-LIFT)<1e-9 for y in middle),'away from its ends it rides LIFT over the survey')

 def test_records_of_one_plan_share_their_seam_tangents(self):
  plan=type('P',(),{'tangents':[(1.0,0.0)]*4+[(.6,.8)]+[(0.0,1.0)]*5})()
  self.assertEqual(I.seam_tangents({},plan,0,4,10),{'deckTangents':{'end':[.6,.8]}})
  self.assertEqual(I.seam_tangents({},plan,4,9,10),{'deckTangents':{'start':[.6,.8]}});self.assertEqual(I.seam_tangents({},plan,0,9,10),{})


def curvature(along,y):
 a,y=np.asarray(along,float),np.asarray(y,float);g=np.diff(y)/np.diff(a);return np.diff(g)/((a[2:]-a[:-2])/2)


class ProfileTest(unittest.TestCase):
 def test_ramp_shoulders_use_open_space_and_taper_to_streets_and_buildings(self):
  points=[[float(x),0.] for x in range(0,201,2)]
  ramp=I.Plan('ramp',points,[1]*len(points),[7.]*len(points),I.RAMP_GRADE,[1]*len(points))
  ramp.y=[2.]*len(points)
  road={'points':[(130,-20),(130,20)],'width':6}
  ground=type('Ground',(),{'across':lambda self,p,t,half:2 if 160<=p[0]<=164 and half>3.5 else 0})()
  I.widen_ramps([ramp],[],[road],ground,lambda bounds:[list(box(70,3.8,90,8).exterior.coords)])
  self.assertEqual((ramp.widths[0],ramp.widths[-1]),(7.,7.),'preserve both shared end widths')
  self.assertEqual(ramp.widths[20],9.,'use the clear shoulders 40 m along')
  self.assertEqual(ramp.widths[40],7.,'leave the existing building clearance at 80 m')
  self.assertEqual(ramp.widths[65],7.,'keep the crossing at its original width')
  self.assertEqual(ramp.widths[81],7.,'stay clear of the raised ground')
  self.assertLessEqual(max(abs(np.diff(ramp.widths))),.161,'the shoulder tapers by at most 4 cm per metre on either side')

 def test_a_floor_tent_is_rounded_to_the_radius_and_never_lowered(self):
  # A floor peaking over a crossing, coned and rounded as solve() does it for a 5% grade.
  a=np.arange(0,301,3.0).tolist();floor=I.cone([12.0 if 140<=x<=160 else 0.0 for x in a],a,.92*.05,1)
  out=I.round_bound(floor,[np.inf]*len(a),a,250,.96*.05,1)
  self.assertTrue(all(o>=f-1e-9 for o,f in zip(out,floor)),'the rounded floor stays above the floor')
  self.assertLess(curvature(a,floor).min(),-1/100,'the coned floor has a sharp crest')
  self.assertGreater(curvature(a,out).min(),-1/250-1e-6,'no crest sharper than the radius')
  self.assertLess(curvature(a,out).max(),1/250+1e-6,'and no sag sharper either')

 def test_a_ceiling_dip_is_rounded_and_pinned_stations_kept(self):
  # A coned ceiling under an overpass, with a pinned station (a gore) the rounding must not move.
  a=np.arange(0,301,3.0).tolist();ceiling=I.cone([5.0 if 140<=x<=160 else np.inf for x in a],a,.92*.05,-1)
  floor=[-50.0]*len(a);k=a.index(201.0);floor[k]=ceiling[k]
  out=I.round_bound(ceiling,floor,a,250,.96*.05,-1)
  self.assertTrue(all(o<=c+1e-9 for o,c in zip(out,ceiling)),'the rounded ceiling stays below the ceiling')
  self.assertEqual(out[k],ceiling[k],'a pinned station keeps its height')
  self.assertLess(np.abs(curvature(a,out)).max(),1/250+1e-6,'no sag or crest sharper than the radius, the pin included')
  self.assertEqual(I.round_bound([np.inf]*len(a),floor,a,250,.96*.05,-1),[np.inf]*len(a),'no ceiling stays no ceiling')

 def test_an_overlap_is_followed_through_a_short_gap(self):
  # Two 7 m ramps from one point: they part to 8 m at x=40, close to 6 m at x=50, then part for good.
  pts=[[float(x),0.0] for x in range(0,101,2)];off=lambda x:np.interp(x,[0,40,50,60,100],[0,8,6,9,20])
  plan=I.Plan('a',pts,[1]*len(pts),[7.0]*len(pts),I.RAMP_GRADE,[1]*len(pts))
  other=I.Plan('b',[[x,float(off(x))] for x,_ in pts],[1]*len(pts),[7.0]*len(pts),I.RAMP_GRADE,[1]*len(pts));other.y=[x*.05 for x,_ in pts]
  stations=[i for i,_ in I.overlap(plan,0,other)]
  self.assertEqual(stations,list(range(stations[-1]+1)),'every station from the shared end on')
  self.assertTrue(48<=pts[stations[-1]][0]<=54,f'through the gap to where they last overlap, not {pts[stations[-1]][0]}')


class JointTest(unittest.TestCase):
 def ramp(self,id,points):
  return I.Plan(id,[[float(x),float(z)] for x,z in points],[1]*len(points),[7.0]*len(points),I.RAMP_GRADE,[1]*len(points))

 def test_an_exit_splitting_in_two_is_led_by_its_trunk_and_solved_first(self):
  trunk=self.ramp('trunk',[(0,0),(50,0),(100,0)]);left=self.ramp('left',[(100,0),(150,20)]);right=self.ramp('right',[(100,0),(150,-20)])
  trunk.ends=[('gore',None,0),('node',left,0)];left.ends=[('node',right,0),('street',None)];right.ends=[('node',trunk,2),('street',None)]
  trunks=I.node_trunks([left,right,trunk])
  self.assertEqual(trunks,{(trunk,1)});self.assertEqual(left.ends[0],('node',trunk,2));self.assertEqual(right.ends[0],('node',trunk,2))
  leads={'right':[(left,0)]};order=I.ordered([right,left,trunk],leads,trunks)
  self.assertLess(order.index(trunk),order.index(left));self.assertLess(order.index(left),order.index(right),'a sibling after the one it follows')

 def test_merging_branches_and_a_plain_continuation(self):
  a=self.ramp('a',[(0,20),(100,0)]);b=self.ramp('b',[(0,-20),(100,0)]);c=self.ramp('c',[(100,0),(200,0)])
  a.ends=[('street',None),('node',b,1)];b.ends=[('street',None),('node',c,0)];c.ends=[('node',a,1),('gore',None,0)]
  self.assertEqual(I.node_trunks([a,b,c]),{(c,0)},'two branches end where the trunk starts');self.assertEqual(a.ends[1],('node',c,0))
  d=self.ramp('d',[(0,0),(100,0)]);e=self.ramp('e',[(100,0),(200,0)]);d.ends=[('street',None),('node',e,0)];e.ends=[('node',d,1),('street',None)]
  self.assertEqual(I.node_trunks([e,d]),{(d,1)},'the upstream end of a plain continuation');self.assertEqual(I.ordered([e,d],{},{(d,1)}),[d,e])
  f=self.ramp('f',[(0,0),(100,0),(200,0)]);g=self.ramp('g',[(100,50),(100,0)]);h=self.ramp('h',[(100,0),(150,-50)])
  g.ends=[('street',None),('node',h,0)];h.ends=[('node',g,1),('street',None)];f.ends=[('street',None),('street',None)]
  self.assertEqual(I.node_trunks([g,h,f]),set(),'no trunk on a ramp running through');self.assertEqual((g.ends[1],h.ends[0]),(('node',f,1),('node',f,1)))


def carriageways(n=81,gap=19.4,width=18.8):
 """The two carriageways on level lines `gap` apart, the second running the other way, as Interstate 93's do through
 Medford: 0.6 m between their pavements. Both lie at 1.0 m."""
 a=I.Plan('i93-nb',[[i*3.0,0.0] for i in range(n)],[1]*n,[width]*n,I.MAINLINE_GRADE,[4]*n)
 b=I.Plan('i93-sb',[[(n-1-i)*3.0,gap] for i in range(n)],[1]*n,[width]*n,I.MAINLINE_GRADE,[4]*n)
 for p in (a,b):p.y=[1.0]*n;p.solo=[1.0]*n
 return a,b


class TwinTest(unittest.TestCase):
 grid={'width':60,'height':30,'cellSize':6,'originX':-60,'originZ':-90,'scale':.01}
 def ground(self,under_twin=115,under_road=65):
  """The grid at `under_road` cm, and at `under_twin` cm from z = 12 on: under the second carriageway."""
  z=-90+6*np.repeat(np.arange(30),60);return np.where(z>=12,under_twin,under_road).astype('<i2')
 def lifted(self,by=.5,rows=range(20,61),**kw):
  a,b=carriageways(**kw);b.y=[1.0+by]*81;b.solo=list(b.y);a.y=[1.0+(by if i in rows else 0.) for i in range(81)];return a,b
 def filled(self,a,b,heights,ramps=(),existing=(),footprints=lambda bounds:[]):
  return I.Terrain(self.grid,I.fill({'nb':a,'sb':b},list(ramps),self.grid,heights,list(existing),footprints))

 def test_the_rule_is_the_one_the_turnpike_stage_has(self):
  import boston_highways as H
  for name in ('alongside','twin_lift','eased','lower_envelope','runs'):self.assertIs(getattr(H,name),getattr(I,name),name)
  for name in ('TWIN_MEDIAN','TWIN_REACH','TWIN_APART','TWIN_RATE','TWIN_STEP','LIFTED','PARALLEL'):self.assertEqual(getattr(H,name),getattr(I,name),name)

 def test_a_carriageway_rises_in_the_open_and_off_the_survey(self):
  a,_=carriageways();a.hold[10]=4.0;a.fixed={0:1.0,1:1.0}
  self.assertEqual([i for i,v in enumerate(I.in_the_open(a)) if not v],[10],'held beneath the surveyed viaduct')
  self.assertEqual([i for i,v in enumerate(I.may_rise(a)) if not v],[0,1,10],'and the deck laid over the survey keeps its height')

 def test_a_storey_apart_is_two_levels(self):
  level=lambda s:{10.0:1.5,20.0:1.0+I.STOREY,30.0:1.0-I.STOREY-.1,40.0:1.0}[s]
  self.assertEqual(I.one_level([1.0]*5,[None,40.0,20.0,30.0,10.0],[False,True,True,True,True],level),([None,40.0,None,30.0,10.0],[False,True,False,True,True]),'a storey over it: another level; a storey under it is its twin\'s to judge')
  self.assertEqual(I.one_level([1.0]*4,[10.0,20.0,10.0,40.0],[True]*4,level),([None,None,None,40.0],[False,False,False,True]),'and so is the whole way up to it')
  # the lower follows the higher, but not onto another level: the stretch between the two keeps its height and a lift fades before it
  a,b=carriageways();b.y=[7.0 if 40<=j<=50 else 1.5 if j<40 else 1.0 for j in range(81)]   # (station j of the twin lies beside station 80 - j)
  s,near=I.one_level(a.y,*I.alongside(a,b,I.may_rise(a),I.in_the_open(b)),b.at);lift=I.graded_lift(a,a.y,I.twin_lift(a,a.y,s,near,b.at))
  self.assertEqual(max(lift[30:]),0.,'beside the twin 6 m up, and all along its way down to it');self.assertEqual(max(lift[:30]),0.,'level with it before: nothing to rise to')
  b.y=[7.0 if 40<=j<=50 else 1.5 if j<40 else 1.0 if j<60 else 1.5 for j in range(81)];s,near=I.one_level(a.y,*I.alongside(a,b,I.may_rise(a),I.in_the_open(b)),b.at);lift=I.graded_lift(a,a.y,I.twin_lift(a,a.y,s,near,b.at))
  self.assertEqual(max(lift[30:]),0.);self.assertAlmostEqual(lift[10],.5,places=6,msg='a step across the median further on is still taken up')
  self.assertLessEqual(max(abs(p-q) for p,q in zip(lift,lift[1:]))/3,a.grade+1e-9,'and the road stays within its grade where it comes back down to its twin')

 def test_a_lift_is_held_to_what_the_grade_leaves_it(self):
  a,_=carriageways();down=[10-i*3.0*.05 for i in range(81)];lift=[1.0]*40+[max(0.,1.0-.05*(i-39)) for i in range(40,81)]
  out=I.graded_lift(a,down,lift);self.assertTrue(all(o<=l+1e-12 for o,l in zip(out,lift)),'only ever lowered')
  self.assertLessEqual(max(abs(down[i+1]+out[i+1]-down[i]-out[i])/3 for i in range(80)),a.grade+1e-9,'a road at 5% has half a percent to give')
  self.assertAlmostEqual(out[0],59*3.0*(a.grade-1e-4-.05),places=9,msg='so the lift starts down 59 stations before it must be gone');self.assertEqual(I.graded_lift(a,[1.0]*81,lift),lift,'a level road leaves it whole')

 def test_a_lift_ends_under_a_deck_over_the_pavement(self):
  a,_=carriageways();piece={'id':'s-deck','name':'S','points':[[90.0,-12.0],[120.0,-12.0]],'width':8.0,'elevations':[6.0,6.0],'bridge':{'thickness':.75}}
  out=I.overhead(a,[piece],None);under=[i for i,v in enumerate(out) if v<np.inf]
  self.assertTrue(set(range(30,41))<=set(under)<=set(range(28,43)),'a street carried over the trench edge lies over the shoulder for 30 m and crosses no centre line')
  self.assertAlmostEqual(out[35],6.0-.75-I.CLEAR_UNDER,places=9)
  self.assertEqual(I.overhead(a,[{**piece,'elevations':[1.2,1.2]}],None),[np.inf]*81,'a deck at the road\'s own height is beside it, not over it')
  self.assertEqual(I.overhead(a,[{**piece,'points':[[90.0,-40.0],[120.0,-40.0]]}],None),[np.inf]*81);self.assertEqual(I.overhead(a,[],None),[np.inf]*81)

 def test_the_ground_comes_up_to_the_ground_its_twin_stands_over(self):
  a,b=self.lifted();g=self.filled(a,b,self.ground())
  self.assertAlmostEqual(g(120.0,0.0),1.15,delta=.011,msg='the two lie on one ground');self.assertAlmostEqual(g(120.0,-8.0),1.15,delta=.011,msg='across its pavement')
  self.assertEqual(g(120.0,-40.0),.65,'and nowhere else');self.assertEqual(g(15.0,0.0),.65,'nor where the road kept its height')
  self.assertAlmostEqual(g(120.0,22.0),1.15,delta=1e-9,msg='the twin keeps its own')

 def test_no_more_than_the_road_rose_and_no_nearer_a_deck_than_its_floor(self):
  a,b=self.lifted();self.assertAlmostEqual(self.filled(a,b,self.ground(145))(120.0,0.0),1.15,delta=.011,msg='the twin on ground 0.8 m higher: up by the half metre the road rose')
  self.assertAlmostEqual(self.filled(a,b,self.ground(145,95))(120.0,0.0),1.5-I.TERRAIN_FLOOR,delta=.011,msg='and to TERRAIN_FLOOR under the deck at most')
  flat=self.ground(65);self.assertTrue(np.array_equal(I.fill({'nb':a,'sb':b},[],self.grid,flat,[],lambda bounds:[]),flat),'the twin on piers over the same ground: the lifted road stands on piers beside it')
  low=self.ground(40,65);self.assertTrue(np.array_equal(I.fill({'nb':a,'sb':b},[],self.grid,low,[],lambda bounds:[]),low),'never lowered')

 def test_no_fill_under_a_deck_that_stood_over_its_ground_alone(self):
  a,b=self.lifted();a.solo=[y+1.0 for y in a.solo];a.y=[y+1.0 for y in a.y];b.y=[y+1.0 for y in b.y];heights=self.ground()
  self.assertTrue(np.array_equal(I.fill({'nb':a,'sb':b},[],self.grid,heights,[],lambda bounds:[]),heights),'a bridge and its approach stand higher on their piers')
  c,d=carriageways();self.assertTrue(np.array_equal(I.fill({'nb':c,'sb':d},[],self.grid,heights,[],lambda bounds:[]),heights),'no lift, no fill')

 def test_a_street_and_a_building_keep_their_ground(self):
  a,b=self.lifted();street={'id':'s','name':'S','points':[[120.0,-60.0],[120.0,60.0]],'width':8.0}
  g=self.filled(a,b,self.ground(),existing=[street]);self.assertEqual(g(120.0,0.0),.65,'the corridor of a street crossing under');self.assertAlmostEqual(g(180.0,0.0),1.15,delta=.011)
  g=self.filled(a,b,self.ground(),footprints=lambda bounds:[[(85.0,-4.0),(95.0,-4.0),(95.0,4.0),(85.0,4.0)]]);self.assertEqual(g(90.0,0.0),.65,'the vertex under a building');self.assertAlmostEqual(g(180.0,0.0),1.15,delta=.011)
  bridge={'id':'b','name':'Bridge','points':[[120.0,-60.0],[120.0,60.0]],'width':8.0,'elevations':[8.0,8.0]}
  self.assertAlmostEqual(self.filled(a,b,self.ground(),existing=[bridge])(120.0,0.0),1.15,delta=.011,msg='a deck 7 m overhead passes over the road')
  self.assertEqual(self.filled(a,b,self.ground(),existing=[{**bridge,'elevations':[1.6,1.6]}])(120.0,0.0),.65,'one at the height of that ground is a road on it')

 def test_a_ramp_lifted_with_its_carriageway_takes_its_ground_up_to_the_carriageways(self):
  a,b=self.lifted();n=81;ramp=I.Plan('i93-nb-exit',[[i*3.0,-13.0] for i in range(n)],[1]*n,[7.0]*n,I.RAMP_GRADE,[1]*n);ramp.solo=[1.0]*n;ramp.y=list(a.y)
  self.assertEqual(self.filled(a,b,self.ground())(120.0,-18.0),.65,'beyond the cells the carriageway passes over')
  g=self.filled(a,b,self.ground(),ramps=[ramp]);self.assertAlmostEqual(g(120.0,-18.0),1.15,delta=.011,msg='under the ramp beside it');self.assertEqual(g(15.0,-18.0),.65)
  still=I.Plan('i93-nb-exit',ramp.points,[1]*n,[7.0]*n,I.RAMP_GRADE,[1]*n);still.solo=[1.0]*n;still.y=[1.0]*n
  self.assertEqual(self.filled(a,b,self.ground(),ramps=[still])(120.0,-18.0),.65,'a ramp that kept its height keeps its ground')


class SurveyCutTest(unittest.TestCase):
 def deck(self):
  # A 20 m square deck at height 10 in two triangles over a wall along its z = 0 edge.
  v=np.array([[0,10,0],[20,10,0],[20,10,20],[0,10,20],[0,0,0],[20,0,0]],dtype=float)
  return v,np.array([[0,1,5],[0,5,4]]),np.array([[0,2,1],[0,3,2]])

 def test_triangles_across_the_outline_are_split_and_the_inside_dropped(self):
  v,facade,roof=self.deck();vertices,faces,flags,dropped,split=I.cut_mesh(v,facade,roof,box(5,-1,10,21))
  self.assertEqual((dropped,split),(0,4));self.assertAlmostEqual(plan_area(vertices,faces[flags]),300,places=6)
  self.assertFalse(any(5<c[0]<10 for c in vertices[faces].mean(1)),'nothing is kept inside the cut')
  self.assertEqual(I.cut_mesh(v,facade,roof,box(-1,-1,21,21))[3],4)

 def test_the_tile_records_its_cut_and_a_rerun_leaves_it(self):
  v,facade,roof=self.deck();faces=np.concatenate([facade,roof]);mask=np.r_[np.zeros(len(facade),bool),np.ones(len(roof),bool)]
  with tempfile.TemporaryDirectory() as temporary:
   data=pathlib.Path(temporary);(data/'tiles').mkdir();path=data/'tiles/t_0_0.bin'
   header={'tx':0,'tz':0,'size':1000,'buildings':[{'id':I.SURVEY_ID,'anchor':[0,0,0],'baseElevation':0.0,'structure':True}],'curbs':[],'parkPaths':[],'roads':[]}
   write_tile(path,header,[mesh_record(v,faces,[0,0,0],0.0,repair_winding=False,roof_mask=mask)])
   city={'landmarkBuildings':[{'id':I.SURVEY_ID,'center':[10,10]}],'tiles':{'size':1000,'directory':'tiles'}}
   mesh=I.SurveyMesh(data,city);mark=mesh.cut(box(5,-1,10,21),'a'*64);mesh.write()
   stored,buildings=read_tile(path);self.assertEqual(stored['buildings'][0]['surveyCut'],mark);self.assertEqual(mark['sha256'],'a'*64)
   self.assertTrue(np.array_equal(mesh.buildings[0]['positions'],buildings[0]['positions']),'the stage continues with the mesh as the tile stores it')
   again=I.SurveyMesh(data,city);self.assertEqual(again.cut(box(0,0,1,1),'a'*64),mark);self.assertIsNone(again.geometry,'a rerun finds the recorded cut')
   with self.assertRaises(ValueError):again.cut(box(5,-1,10,21),'b'*64)


class RestoreTest(unittest.TestCase):
 def test_before_stage_takes_the_stage_back_out(self):
  street={'id':'s','name':'Street','points':[[0,0],[10,0]],'width':8,'oneway':0}
  roads=[{**street,'points':[[0,0],[6,0]]},{'id':'s-deck','name':'Street','points':[[6,0],[10,0]],'width':8,'oneway':0,'elevations':[1,1],'bridge':{'kind':I.APPROACH}},
   {'id':'i93-nb-01','name':'I-93 North','points':[[0,5],[10,5]],'width':18,'oneway':1,'elevations':[2,2],'bridge':{'kind':I.KIND}}]
  record={'roads':{'added':['i93-nb-01','s-deck'],'sources':[street]},'terrain':{'vertices':[1,3],'heights':[150,-20]}}
  self.assertEqual([I.stage_owned(r) for r in roads],[False,True,True])
  pre,heights=I.before_stage(roads,np.array([1.0,.5,2.0,0.0]),record)
  self.assertEqual(pre,[street]);np.testing.assert_allclose(heights,[1.0,1.5,2.0,-.2]);self.assertEqual(len(roads),3,'the package roads are left as they are')
  np.testing.assert_array_equal(I.staged_heights(np.array([100,50,200,0],dtype=np.int16),record),[100,150,200,-20])


if __name__=='__main__':unittest.main()
