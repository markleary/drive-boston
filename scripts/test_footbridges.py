"""Footbridge stage pieces (scripts/footbridges.py) on small synthetic inputs, and the installed package."""
import json,math,pathlib,unittest
import footbridges as F
import boston_highways as H

ROOT=pathlib.Path(__file__).resolve().parents[1]


def way(id,points,highway='footway',incline='up',**tags):return {'id':id,'tags':{'highway':highway,'bridge':'yes','incline':incline,**tags},'points':[list(p) for p in points]}


def turns(points):
 out=[]
 for a,p,b in zip(points,points[1:],points[2:]):
  ax,az,bx,bz=p[0]-a[0],p[1]-a[1],b[0]-p[0],b[1]-p[1];out.append(abs(math.atan2(ax*bz-az*bx,ax*bx+az*bz)))
 return out


# A ramp out and back with a level landing at the turn, a span over a road along z=31 and a ramp down beyond it.
WAYS=[way(1,[[0,0],[30,0]]),way(2,[[30,0],[30,3]],incline='0%'),way(3,[[30,3],[10,3]]),way(4,[[10,3],[10,23],[10,43]],incline='0%',width='3'),way(5,[[10,43],[50,43]],incline='down')]
SPEC={'id':'test','span':4}
def road(id,z,height,**extra):return {'id':id,'name':id,'points':[[-40,z],[60,z]],'width':8,'elevations':[height,height],**extra}
def flat(x,z):return -1.0


class LineTest(unittest.TestCase):
 def test_ways_are_ordered_from_ground_to_ground_whatever_their_direction(self):
  mixed=[{**WAYS[3]},{**WAYS[0],'points':WAYS[0]['points'][::-1]},{**WAYS[4]},{**WAYS[2],'points':WAYS[2]['points'][::-1]},{**WAYS[1]}]
  out=F.ordered(mixed);self.assertEqual([w['id'] for w in out],[1,2,3,4,5]);self.assertEqual(out[0]['points'][0],[0,0]);self.assertEqual(out[2]['points'],[[30,3],[10,3]])
  for a,b in zip(out,out[1:]):self.assertEqual(a['points'][-1],b['points'][0])

 def test_a_branch_or_a_gap_is_refused(self):
  with self.assertRaises(ValueError):F.ordered(WAYS+[way(6,[[10,23],[20,23]])][:0]+[way(6,[[30,0],[40,-5]])])
  with self.assertRaises(ValueError):F.ordered([WAYS[0],WAYS[3]])

 def test_sharp_turns_are_rounded_inside_their_legs(self):
  points=[[0,0],[30,0],[30,3],[10,3]];out,own=F.rounded(points,[0,1,2])
  self.assertEqual(out[0],[0,0]);self.assertEqual(out[-1],[10,3]);self.assertEqual(len(own),len(out)-1)
  self.assertLess(max(turns(out)),F.BEND,'no turn sharper than BEND is left')
  # the 3 m end of the ramp that turns back gives each turn half of itself: the two arcs meet without crossing
  self.assertTrue(all(b[1]>=a[1]-1e-9 for a,b in zip(out[1:],out[2:-1])),'the line never doubles back across the end')
  self.assertTrue(all(p[0]<=31.6 and -1e-9<=p[1]<=3+1e-9 for p in out));self.assertEqual(own[0],0);self.assertEqual(own[-1],2);self.assertEqual(sorted(set(own)),[0,1,2])
  straight,_=F.rounded([[0,0],[10,0],[20,2]],[0,0]);self.assertEqual(straight,[[0,0],[10,0],[20,2]],'a gentle bend stays as mapped')

 def test_stations_are_no_further_apart_than_STEP_and_keep_every_vertex(self):
  out,own=F.stationed([[0,0],[5,0],[5,1]],[7,8]);self.assertIn([5,0],out);self.assertLessEqual(max(math.dist(a,b) for a,b in zip(out,out[1:])),F.STEP+1e-9);self.assertEqual(own,[7,7,7,8])


class ProfileTest(unittest.TestCase):
 def planned(self,roads,ground=flat,spec=SPEC):return F.profile(spec,{'id':'test','ways':WAYS},F.Roads(roads),ground)

 def test_the_deck_is_level_at_the_room_the_road_asks_for_and_the_ramps_climb_at_one_grade(self):
  p=self.planned([road('storrow-x',31,-.5,bridge={'id':'storrow','kind':H.KIND})]);pts,e=p['points'],p['elevations']
  self.assertEqual(p['deck'],round(-.5+H.STORROW_UNDER+F.SLAB+F.MARGIN,4));self.assertEqual(p['landings'],[round(-1+F.PATH_RISE,4)]*2);self.assertEqual((e[0],e[-1]),tuple(p['landings']))
  self.assertEqual(p['width'],3.0);self.assertEqual(p['ways'],[1,2,3,4,5]);self.assertEqual([c['road'] for c in p['crossings']],['storrow-x'])
  over=[h for q,h in zip(pts,e) if abs(q[0]-10)<1e-6 and 5<=q[1]<=41];self.assertTrue(over and all(h==p['deck'] for h in over),'the span is level')
  # the way mapped level where the ramp turns back takes none of the climb; both inclines have one grade
  turn=[i for i,q in enumerate(pts) if q[0]>29.5 and q[1]<3.5];self.assertGreaterEqual(len(turn),5);self.assertEqual(len({e[i] for i in turn}),1,'level round the end of the ramp that turns back')
  self.assertLess(e[turn[0]-2],e[turn[0]]);self.assertGreater(e[turn[-1]+2],e[turn[-1]])
  first=[(q[0],h) for q,h in zip(pts,e) if q[1]==0 and q[0]<=28];grades={round((b[1]-a[1])/(b[0]-a[0]),3) for a,b in zip(first,first[1:])};self.assertEqual(len(grades),1)
  last=[(q[0],h) for q,h in zip(pts,e) if q[1]==43 and q[0]>=12];down={round((b[1]-a[1])/(b[0]-a[0]),3) for a,b in zip(last,last[1:])};self.assertEqual(len(down),1)
  self.assertGreater(next(iter(grades)),.05);self.assertLess(next(iter(down)),-.05)
  self.assertLessEqual(max(math.dist(a,b) for a,b in zip(pts,pts[1:])),F.STEP+1e-6);self.assertLess(max(turns(pts)),F.BEND)
  self.assertAlmostEqual(p['grade'],max(abs(b-a)/math.dist(q,r) for q,r,a,b in zip(pts,pts[1:],e,e[1:])),3)

 def test_each_road_asks_for_its_own_room_and_a_roofed_tunnel_for_none(self):
  street=self.planned([road('street',31,-.5)]);self.assertEqual(street['deck'],round(-.5+F.STREET_UNDER+F.SLAB+F.MARGIN,4))
  pike=self.planned([road('i90-x',31,-.5,bridge={'id':'i90','kind':H.KIND})]);self.assertEqual(pike['deck'],round(-.5+H.CLEAR_UNDER+F.SLAB+F.MARGIN,4))
  both=self.planned([road('storrow-x',31,-.5,bridge={'id':'storrow','kind':H.KIND}),road('street',20,-1.2)]);self.assertEqual(both['deck'],round(-1.2+F.STREET_UNDER+F.SLAB+F.MARGIN,4),'the highest ask decides')
  roofed=road('tunnel',20,-6,tunnel={'clearance':3.2,'covered':[[0,100]]},highway='storrow')
  self.assertEqual(self.planned([road('storrow-x',31,-.5,bridge={'id':'storrow','kind':H.KIND}),roofed])['crossings'][0]['road'],'storrow-x')
  self.assertEqual(len(self.planned([road('storrow-x',31,-.5,bridge={'id':'storrow','kind':H.KIND}),{**roofed,'tunnel':{'clearance':3.2,'covered':[]}}])['crossings']),2,'an open cut is a road beneath')

 def test_a_ramp_is_held_over_ground_that_rises_faster_and_steps_are_marked(self):
  def hump(x,z):return 1.5 if z==0 and 8<=x<=12 else -1.0
  p=self.planned([road('storrow-x',31,-.5,bridge={'id':'storrow','kind':H.KIND})],hump);held=[h for q,h in zip(p['points'],p['elevations']) if q[1]==0 and 8<=q[0]<=12]
  self.assertGreaterEqual(len(held),2);self.assertTrue(all(h==round(1.5+F.PATH_RISE,4) for h in held),'the incline alone would pass under the hump')
  ways=[{**WAYS[0],'tags':{**WAYS[0]['tags'],'highway':'steps'}}]+WAYS[1:]
  q=F.profile(SPEC,{'id':'test','ways':ways},F.Roads([road('storrow-x',31,-.5,bridge={'id':'storrow','kind':H.KIND})]),flat)
  self.assertTrue(q['stairs'][0]);self.assertFalse(q['stairs'][-1]);entry=F.entries(q,1000)['0_0'][0];self.assertEqual(entry['steps'][0][0],0);self.assertEqual(len(entry['steps']),1)
  last=q['points'][entry['steps'][0][1]];self.assertTrue(last[0]>29 and last[1]<1.3,'the range ends in the turn at the end of the steps way')

 def test_a_bridge_that_crosses_no_road_or_has_no_ramp_is_refused(self):
  with self.assertRaises(ValueError):self.planned([])
  with self.assertRaises(ValueError):self.planned([{'id':'storrow-x','name':'','points':[[15,-10],[15,10]],'width':8,'elevations':[-.5,-.5]}])   # under the first way: the deck would start on the ground
  # a street at the very end of the line is the street the bridge lands on, no road beneath
  ends=self.planned([road('storrow-x',31,-.5,bridge={'id':'storrow','kind':H.KIND}),{'id':'landing','name':'','points':[[.5,-5],[.5,5]],'width':7}]);self.assertEqual(len(ends['crossings']),1)


class TileTest(unittest.TestCase):
 def test_a_tile_border_cuts_the_line_at_an_added_vertex(self):
  points=[[990.0,5.0],[998.0,5.0],[1006.0,5.0],[1014.0,5.0]];heights=[0.0,1.0,2.0,3.0];parts=F.fragments(points,heights,[True,False,False],1000)
  self.assertEqual([(tx,tz) for tx,tz,*_ in parts],[(0,0),(1,0)]);a,b=parts
  self.assertEqual(a[2][-1],[1000.0,5.0]);self.assertEqual(b[2][0],[1000.0,5.0]);self.assertEqual(a[3][-1],1.25);self.assertEqual(b[3][0],1.25)
  self.assertEqual(a[4],[True,False]);self.assertEqual(b[4],[False,False]);self.assertEqual(len(a[4]),len(a[2])-1)
  planned={'id':'t','name':'','kind':'footway','width':2.0,'points':points,'elevations':heights,'stairs':[True,False,False]};out=F.entries(planned,1000)
  self.assertEqual(sorted(out),['0_0','1_0']);self.assertEqual(out['0_0'][0]['id'],'footbridge-t-0_0_0');self.assertEqual(out['1_0'][0]['bridgePoints'],points)
  self.assertEqual(out['0_0'][0]['steps'],[[0,1]]);self.assertNotIn('steps',out['1_0'][0]);self.assertEqual(len(out['0_0'][0]['elevations']),len(out['0_0'][0]['points']))


class InstalledTest(unittest.TestCase):
 """The shipped package: every listed bridge is whole, clears its roads and replays."""
 def test_the_installed_bridges_replay_and_clear_their_roads(self):
  data=ROOT/'public/data';city=json.loads((data/'city.json').read_text());record=json.loads((data/'provenance.json').read_text())['footbridges'];source=json.loads((data/F.SOURCE_NAME).read_text())
  counts=F.validate(data,city,record,source);self.assertEqual(counts['bridges'],len(F.FOOTBRIDGES));self.assertEqual([b['id'] for b in record['bridges']],[s['id'] for s in F.FOOTBRIDGES])
  for b in record['bridges']:
   self.assertGreaterEqual(len(b['crossings']),2,b['id']);self.assertLess(b['grade'],.45,b['id'])
   for c in b['crossings']:self.assertGreaterEqual(round(b['deck']-F.SLAB-c['surface'],3),c['room'],f"{b['id']} over {c['road']}")
  fiedler=next(b for b in record['bridges'] if b['id']=='arthur-fiedler');self.assertEqual(fiedler['name'],'Arthur Fiedler Footbridge');self.assertGreater(fiedler['length'],190)
  self.assertTrue(any(c['road'].startswith('storrow-wb') for c in fiedler['crossings']));self.assertLess(fiedler['grade'],.12)


if __name__=='__main__':unittest.main()
