import unittest
from shapely.geometry import Point,box
from shapely.ops import unary_union
from deck_contacts import contact_polygons

GRID={'width':2,'height':2,'cellSize':12,'originX':0,'originZ':0}

class DeckContacts(unittest.TestCase):
 def test_only_terrain_reaching_the_deck_gets_pavement(self):
  road={'id':'r','points':[[0,6],[12,6]],'width':8,'elevations':[3,3]}
  contacts,ids=contact_polygons([road],GRID,[0,0,6,6]);shape=unary_union(contacts)
  self.assertEqual(ids,['r']);self.assertTrue(shape.covers(Point(6,8)));self.assertFalse(shape.covers(Point(6,4)))
  self.assertTrue(box(0,2,12,10).covers(shape));self.assertAlmostEqual(shape.area,48.12,places=4)

 def test_nothing_is_painted_under_a_bridge_or_tunnel(self):
  high={'id':'high','points':[[0,6],[12,6]],'width':8,'elevations':[20,20]}
  tunnel={**high,'id':'tunnel','elevations':[-2,-2],'tunnel':True}
  self.assertEqual(contact_polygons([high,tunnel],GRID,[0,0,6,6]),([],[]))

 def test_crossfall_uses_the_deck_edges_instead_of_the_center_height(self):
  road={'id':'r','points':[[0,6],[12,6]],'width':8,'elevations':[3,3],'deckEdgeElevations':[[1.02,5.02],[1.02,5.02]]}
  self.assertEqual(contact_polygons([road],GRID,[0,0,6,6]),([],[]))

if __name__=='__main__':unittest.main()
