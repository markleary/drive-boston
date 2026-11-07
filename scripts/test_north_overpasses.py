import copy,unittest
import numpy as np
from north_overpasses import APPROACH,DECK,SITES,applies,deck_piece,node,restore,split_line
from water_crossings import owned


class NorthOverpassTests(unittest.TestCase):
 def test_split_line_shares_the_split_point_and_drops_coincident_vertices(self):
  head,tail=split_line([[0,0],[10,0],[20,0]],15)
  self.assertEqual(head,[[0,0],[10,0],[15.0,0.0]]);self.assertEqual(tail,[[15.0,0.0],[20,0]])
  head,tail=split_line([[0,0],[10,0],[20,0]],10.004)
  self.assertEqual(head,[[0,0],[10.004,0.0]]);self.assertEqual(tail,[[10.004,0.0],[20,0]],'the vertex 4 mm away is dropped')
  with self.assertRaises(ValueError):split_line([[0,0],[10,0]],11)

 def test_deck_piece_takes_graded_heights_and_the_joint_heights_of_deck_ends(self):
  road={'id':'s','name':'Street','points':[[0,0],[12,0]],'width':8,'kind':'primary','pavedWidth':7.2}
  ground=lambda x,z:1+x/100
  piece=deck_piece(road,[[0,0],[12,0]],'s-deck',ground,{node([0,0]):3.5})
  self.assertEqual(piece['id'],'s-deck');self.assertEqual(piece['bridge']['kind'],APPROACH);self.assertNotIn('pavedWidth',piece)
  self.assertEqual(piece['points'][0],[0,0]);self.assertEqual(piece['points'][-1],[12,0])
  self.assertEqual(piece['elevations'][0],3.5,'a shared deck end keeps that deck height');self.assertAlmostEqual(piece['elevations'][-1],1.12)
  self.assertEqual((piece['startLevel'],piece['endLevel']),(1,0))
  self.assertEqual(road['points'],[[0,0],[12,0]],'the source street is not edited')

 def test_restore_puts_back_streets_profiles_and_grid_vertices(self):
  original=[{'id':'a','points':[[0,0],[5,0]],'elevations':[1,1]},{'id':'b','points':[[5,0],[9,0]]}]
  repaired=copy.deepcopy(original);repaired[0]['elevations']=[2,2];repaired[1]['points']=[[5,0],[7,0]];repaired.append({'id':'b-deck','points':[[7,0],[9,0]]})
  heights=np.array([10,20,30],dtype='<i2');heights[1]=-5
  record={'roads':{'added':['b-deck'],'sources':[copy.deepcopy(original[1])]},'sourceProfiles':[{'road':'a','elevations':[1,1]}],'terrain':{'vertices':[1],'heights':[20]}}
  restore(repaired,heights,record)
  self.assertEqual(repaired,original);self.assertEqual(heights.tolist(),[10,20,30])
  restore(repaired,heights,None);self.assertEqual(repaired,original)

 def test_the_steps_own_decks_are_left_to_it_by_the_earlier_stages(self):
  for kind in (APPROACH,DECK):self.assertTrue(owned({'name':'Florence Street','bridge':{'id':'structure-osm-80482630-0','kind':kind}}))
  self.assertFalse(owned({'name':'Florence Street','bridge':{'id':'structure-osm-80482630-0','kind':'elevated'}}))

 def test_the_land_stage_leaves_the_site_decks_for_the_trench_beneath(self):
  from land_approaches import SINK,level_land_approaches
  def sunk(id,z):
   ys=[1.0]*35;ys[3]=1-SINK-.01
   return {'id':id,'name':'Broadway','width':10,'oneway':0,'points':[[i*100/34,z] for i in range(35)],'elevations':ys,'startLevel':0,'endLevel':0,'bridge':{'id':f'structure-{id}','thickness':.75,'kind':'elevated'}}
  roads=[sunk('osm-9080041-0',0),sunk('x',50)]
  self.assertEqual(level_land_approaches(roads,lambda x,z:1,links=[],apply=False)['changedRoads'],['x'],'the Sweetser Circle deck dips the same but is left alone')

 def test_sites_apply_only_to_packages_carrying_them(self):
  ids=[i for site in SITES for i in site['upper']+site['lower']]
  self.assertTrue(applies([{'id':i} for i in ids]))
  self.assertFalse(applies([{'id':i} for i in ids[1:]]))


if __name__=='__main__':unittest.main()
