import json
import unittest
import numpy as np
from shapely.geometry import LineString
from shapely.strtree import STRtree
import rail_tracks as R

# A synthetic strip of terrain 100 m wide and 700 m long, 1 m cells, the track running down x=0 from z=0 to z=600.
META={'originX':-50.0,'originZ':-50.0,'cellSize':1.0,'width':101,'height':701}
Z=META['originZ']+np.arange(META['height'])*META['cellSize'];X=META['originX']+np.arange(META['width'])*META['cellSize']


def heights(f):
 """A height grid from f(x, z) evaluated on the cell centres (row-major, z rows)."""
 xx,zz=np.meshgrid(X,Z);return f(xx,zz).ravel()


def track(points=((0,0),(0,300),(0,600)),nodes=(1,2,3),tags=None,**spec):
 marks=[(tags or {},0,len(points)-1)]
 return R.Track({'id':'test','line':'commuter','name':'Test track','ways':[1],**spec},list(points),list(nodes),marks)


def road(name,z,width=10,**kwargs):
 return {'name':name,'width':width,'points':[[-45,z],[45,z]],**kwargs}


def profiled(t,graded,raw,roads=(),level=()):
 """Run the base profile and the constrained profile of one track; returns the report entry."""
 roads=list(roads);lines=[LineString(r['points']) for r in roads];report={}
 t.base=R.base_profile(t,R.Grid(META,raw),None);t.tor=t.base
 R.profile(t,[t],[],R.Grid(META,graded),roads,lines,STRtree(lines),report,set(level))
 return report['tracks'][t.id]


def max_grade(t,a=0,b=None):
 m=(t.s>=a)&(t.s<=(t.length if b is None else b));return float(np.abs(np.diff(t.tor[m])).max()/R.STEP)


class FilterTests(unittest.TestCase):
 def test_closing_fills_narrow_dips_and_opening_cuts_narrow_bumps(self):
  v=np.zeros(101);v[40:46]=-2
  self.assertTrue(np.allclose(R.closing(v,11),0))
  v=np.zeros(101);v[40:46]=2
  self.assertTrue(np.allclose(R.opening(v,11),0))
  v=np.zeros(101);v[20:80]=-2
  self.assertAlmostEqual(float(R.closing(v,11)[50]),-2)

 def test_cone_up_holds_the_bound_and_limits_the_rise(self):
  bound=np.full(50,-1e9);bound[25]=3.0
  f=R.cone_up(bound,2.0,.03)
  self.assertEqual(f[25],3.0);self.assertAlmostEqual(f[24],3.0-.06);self.assertAlmostEqual(f[30],3.0-.3)

 def test_runs_and_merge(self):
  self.assertEqual(R.runs(np.array([0,1,1,0,1],bool)),[(1,2),(4,4)])
  self.assertEqual(R.merge([(10,20,{'a'}),(0,5),(24,30)],gap=4),[[0,5,set()],[10,30,{'a'}]])


class ChainTests(unittest.TestCase):
 def ways(self):
  return {1:{'nodes':[10,11],'points':[(0,0),(0,10)],'tags':{'bridge':'yes'}},2:{'nodes':[12,11],'points':[(0,20),(0,10)],'tags':{}},3:{'nodes':[30,31],'points':[(5,0),(5,9)],'tags':{}}}

 def test_ways_join_through_shared_nodes_whatever_their_direction(self):
  points,nodes,marks=R.chain(self.ways(),[1,2])
  self.assertEqual(points,[(0,0),(0,10),(0,20)]);self.assertEqual(nodes,[10,11,12]);self.assertEqual([m[1:] for m in marks],[(0,1),(1,2)])
  points,nodes,_=R.chain(self.ways(),[2,1])
  self.assertEqual(nodes,[12,11,10])

 def test_a_gap_in_the_chain_is_an_error(self):
  with self.assertRaises(ValueError):R.chain(self.ways(),[1,3])

 def test_track_records_osm_bridge_spans(self):
  points,nodes,marks=R.chain(self.ways(),[1,2])
  t=R.Track({'id':'t','line':'yard','name':'t'},points,nodes,marks)
  self.assertEqual(t.osm_spans,[(0.0,10.0,'bridge')]);self.assertAlmostEqual(t.length,20.0);self.assertEqual(len(t.s),11)


class ProfileTests(unittest.TestCase):
 def test_level_crossing_holds_the_road_surface_with_gentle_approaches(self):
  ground=heights(lambda x,z:0.02*(z-300)*(np.abs(z-300)>20))   # a dip and a hump either side
  t=track();rec=profiled(t,ground,ground,[road('Level Street',300)],level=[2])
  self.assertEqual([name for _,name in rec['level']],['Level Street'])
  self.assertAlmostEqual(float(t.height(300)),0.04,places=2)
  self.assertLessEqual(max_grade(t,250,350),R.LEVEL_GRADE+1e-6)
  self.assertEqual(t.covered,[])

 def test_a_street_dam_over_the_bed_becomes_a_covered_underpass(self):
  # The grader raised the street 3 m above the raw ground; the raw DEM under the rails is flat.
  graded=heights(lambda x,z:np.clip(3-np.maximum(0,np.abs(z-200)-8)*.5,0,3))
  t=track();rec=profiled(t,graded,heights(lambda x,z:0*x),[road('Dam Street',200)])
  self.assertEqual(len(t.covered),1);c=t.covered[0]
  self.assertEqual(c['kind'],'underpass');self.assertEqual(c['roads'],['Dam Street'])
  self.assertLess(c['start'],200-8);self.assertGreater(c['end'],200+8)
  self.assertLess(float(t.height(200)),.5)   # under the street, not lifted over it
  self.assertEqual(rec['buried'],[])

 def test_a_wide_mound_away_from_streets_lifts_the_bed(self):
  graded=heights(lambda x,z:np.where(np.abs(z-400)<40,1.0,0.0))
  t=track();rec=profiled(t,graded,heights(lambda x,z:0*x))
  self.assertEqual(t.covered,[])
  self.assertGreaterEqual(float(t.height(400)),1.0+.22-.02)
  self.assertLessEqual(max_grade(t),R.LIFT+.004)
  self.assertEqual(rec['buried'],[])

 def test_a_narrow_spike_is_left_to_poke_through(self):
  graded=heights(lambda x,z:np.where(np.abs(z-400)<4,1.0,0.0))
  t=track();rec=profiled(t,graded,heights(lambda x,z:0*x))
  self.assertLess(float(t.height(400)),.5)
  self.assertEqual(len(rec['buried']),1);self.assertGreater(rec['buried'][0][2],.9)

 def test_a_portal_end_follows_its_approach_cut_into_the_tunnel(self):
  # A 4 m approach cut rising at 2% from the portal (z=0), the DEM's portal structure a 2 m hump at the face.
  cut=lambda x,z:np.minimum(0,-4+np.maximum(0,z-40)*.02)+np.where(z<2,2.0,0.0)
  t=track();t.ends[0]='portal'
  profiled(t,heights(cut),heights(cut))
  self.assertLess(float(t.height(10)),-3.4)
  self.assertTrue(t.covered and t.covered[0]['start']==0 and t.covered[0]['kind']=='tunnel' and t.covered[0]['end']>=2)
  plain=track();profiled(plain,heights(cut),heights(cut))
  self.assertGreater(float(plain.height(10)),float(t.height(10))+.8)   # without the portal the closing fills the cut

 def test_the_profile_is_deterministic(self):
  graded=heights(lambda x,z:np.sin(z/37)*1.5)
  a=track();profiled(a,graded,graded);b=track();profiled(b,graded,graded)
  self.assertTrue(np.array_equal(a.tor,b.tor))


class LevelCrossingRecordTests(unittest.TestCase):
 def test_tracks_crossing_one_street_together_share_one_record(self):
  ground=heights(lambda x,z:0*x)
  street=road('Franklin Street',300,width=12)
  tracks=[]
  for i,x in enumerate((0,4.5)):
   t=track(((x,0),(x,300),(x,600)),(10*i+1,10*i+2,10*i+3),id=f't{i}');profiled(t,ground,ground,[street],level=[10*i+2]);tracks.append(t)
  records=R.level_crossing_records(tracks)
  self.assertEqual(len(records),1);r=records[0]
  self.assertEqual(r['name'],'Franklin Street');self.assertEqual(r['tracks'],['t0','t1']);self.assertEqual(r['road'],6.0)
  self.assertAlmostEqual(r['x'],2.25,places=1);self.assertAlmostEqual(r['z'],300,places=1)
  json.dumps(records)


if __name__=='__main__':
 unittest.main()
