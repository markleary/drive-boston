import unittest
from connected_road_profiles import connected_profiles,MAX_GRADE


def road(id,points,ys):return {'id':id,'name':'Example','points':points,'width':8,'elevations':ys,'startLevel':0,'endLevel':0,'bridge':{'id':'structure-'+id,'kind':'elevated'}}

class ConnectedProfiles(unittest.TestCase):
 def test_short_source_stub_borrows_approach_distance_from_its_chain(self):
  a=road('a',[[0,0],[3,0],[6,0]],[0,3,6]);b=road('b',[[6,0],[30,0],[60,0],[100,0]],[6,6,6,0])
  a['endLevel']=b['startLevel']=1
  changes,unresolved=connected_profiles([a,b],lambda x,z:0)
  self.assertEqual(unresolved,[]);self.assertTrue(changes)
  for r,new in changes:r['elevations']=new
  self.assertEqual(a['elevations'][0],0);self.assertEqual(b['elevations'][-1],0);self.assertEqual(a['elevations'][-1],b['elevations'][0])
  for r in [a,b]:
   for p,q,y,z in zip(r['points'],r['points'][1:],r['elevations'],r['elevations'][1:]):self.assertLessEqual(abs(z-y),MAX_GRADE*abs(q[0]-p[0])+.001)
  self.assertEqual(connected_profiles([a,b],lambda x,z:0)[0],[])

 def test_two_ground_level_ends_do_not_hide_a_buried_bridge_interior(self):
  r=road('a',[[0,0],[30,0],[60,0]],[0,0,0])
  changes,unresolved=connected_profiles([r],lambda x,z:3 if x==30 else 0)
  self.assertEqual(unresolved,[]);self.assertGreaterEqual(changes[0][1][1],3)

 def test_infeasible_chain_keeps_landings_and_reports_the_conflict(self):
  r=road('a',[[0,0],[3,0],[6,0]],[0,0,0])
  changes,unresolved=connected_profiles([r],lambda x,z:10 if x==3 else 0)
  self.assertEqual(changes,[]);self.assertEqual(unresolved[0]['roads'],['a']);self.assertEqual(r['elevations'],[0,0,0])

 def test_interior_merge_with_a_dedicated_ramp_keeps_its_interpolated_height(self):
  parent=road('a',[[0,0],[30,0],[60,0]],[0,0,0]);ramp=road('b',[[15,10],[15,0]],[1,0]);ramp['bridge']['kind']='dedicated'
  changes,_=connected_profiles([parent,ramp],lambda x,z:3 if x==30 else 0)
  self.assertEqual(changes,[],'cannot raise the parent across a fixed interpolated merge')

 def test_taut_envelope_does_not_raise_a_pinned_interior_junction(self):
  parent=road('a',[[0,0],[30,0],[60,0],[90,0],[120,0]],[0,0,0,0,0]);ramp=road('b',[[60,20],[60,0]],[1,0]);ramp['bridge']['kind']='dedicated'
  changes,_=connected_profiles([parent,ramp],lambda x,z:3 if x==30 and z==0 else 0)
  profile=next(new for r,new in changes if r is parent)
  self.assertEqual(profile[2],0,'the ramp landing is a fixed interior vertex')

 def test_ground_landings_stay_fixed_when_two_decks_share_the_node(self):
  a=road('a',[[0,0],[30,0],[60,0]],[0,0,0]);b=road('b',[[60,0],[90,0],[120,0]],[0,0,0])
  changes,_=connected_profiles([a,b],lambda x,z:3 if x==30 else 0)
  for r,new in changes:self.assertEqual(new[0],0);self.assertEqual(new[-1],0)

if __name__=='__main__':unittest.main()
