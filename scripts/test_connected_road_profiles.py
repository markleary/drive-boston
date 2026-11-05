import copy,unittest
from connected_road_profiles import connected_profiles,MAX_GRADE
from road_structure_clearance import road_height


def road(id,points,ys):return {'id':id,'name':'Example','points':points,'width':8,'elevations':ys,'startLevel':0,'endLevel':0,'bridge':{'id':'structure-'+id,'kind':'elevated'}}

class ConnectedProfiles(unittest.TestCase):
 def test_crossing_clearance_between_sparse_or_one_sided_nearby_vertices(self):
  # Each middle segment has no interior node. The second case has just one
  # vertex within the old 4 m radius, so constraining that vertex still fails
  # to protect the interpolated height toward its lower neighbor.
  for xs,ys,crossing in [([0,10,50,100],[0,10,4,0],40),([0,30,60,110],[0,7,3,0],34)]:
   for reverse in [False,True]:
    with self.subTest(xs=xs,crossing=crossing,reverse=reverse):
     decks=[road(str(i),[[xs[i],0],[xs[i+1],0]],ys[i:i+2]) for i in range(3)]
     if reverse:
      for r in decks:r['points'].reverse();r['elevations'].reverse()
     street={'id':'lower','points':[[crossing,-10],[crossing,10]],'width':8};before=copy.deepcopy(decks)
     changes,unresolved=connected_profiles([*decks,street],lambda x,z:0)
     self.assertEqual(decks,before,'analysis must not mutate source geometry');self.assertEqual(unresolved,[]);self.assertTrue(changes)
     for r,new in changes:r['elevations']=new
     self.assertGreaterEqual(road_height(decks[1],[crossing,0],lambda x,z:0)-.75,4.5-.0001)
     for r in decks:
      self.assertLessEqual(abs(r['elevations'][1]-r['elevations'][0]),MAX_GRADE*abs(r['points'][1][0]-r['points'][0][0])+.0001)
     self.assertEqual(decks[0]['elevations'][int(reverse)],0);self.assertEqual(decks[-1]['elevations'][int(not reverse)],0)
     self.assertEqual(connected_profiles([*decks,street],lambda x,z:0)[0],[],'repeated generation is stable')

 def test_infeasible_sparse_crossing_keeps_the_original_bridge_and_reports_it(self):
  r=road('a',[[0,0],[10,0],[50,0],[100,0]],[0,10,10,0]);before=copy.deepcopy(r)
  street={'id':'lower','points':[[20,-10],[20,10]],'width':8}
  changes,unresolved=connected_profiles([r,street],lambda x,z:0)
  self.assertEqual(changes,[]);self.assertEqual(r,before);self.assertEqual(unresolved[0]['roads'],['a'])
  self.assertGreater(unresolved[0]['excess'],0)
  self.assertEqual(road_height(r,[20,0],lambda x,z:0)-.75,9.25,'must not silently reduce clearance to 2.85 m')

 def test_crossing_bound_allows_a_lower_pinned_endpoint_when_interpolation_is_safe(self):
  a=road('a',[[0,0],[40,0],[50,0]],[0,6,12]);b=road('b',[[50,0],[100,0]],[12,0])
  street={'id':'lower','points':[[35,-10],[35,10]],'width':8}
  changes,unresolved=connected_profiles([a,b,street],lambda x,z:0)
  self.assertEqual(unresolved,[]);self.assertTrue(changes)
  for r,new in changes:r['elevations']=new
  self.assertEqual(a['elevations'][0],0);self.assertGreaterEqual(road_height(a,[35,0],lambda x,z:0)-.75,4.5-.0001)

 def test_original_clearance_below_target_is_preserved_at_the_crossing(self):
  decks=[road('a',[[0,0],[30,0]],[0,7]),road('b',[[30,0],[60,0]],[7,3]),road('c',[[60,0],[110,0]],[3,0])]
  street={'id':'lower','points':[[45,-10],[45,10]],'width':8}
  changes,unresolved=connected_profiles([*decks,street],lambda x,z:0)
  self.assertEqual(unresolved,[])
  for r,new in changes:r['elevations']=new
  self.assertGreaterEqual(road_height(decks[1],[45,0],lambda x,z:0)-.75,4.25-.0001)

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
