import copy,unittest
from shapely.geometry import LineString
from source_seams import connect_source_seams


def road(id,points,oneway=0):return {'id':id,'name':'Shared Street','points':points,'width':8,'oneway':oneway}

class SourceSeams(unittest.TestCase):
 def test_only_source_confirmed_aligned_dangling_ends_are_joined(self):
  roads=[road('gis',[[-50,0],[0,0]]),road('osm-1-0',[[20,0],[60,0]])]
  self.assertEqual(connect_source_seams(copy.deepcopy(roads),{},lambda x,z:0),[])
  links=connect_source_seams(roads,{'1':LineString([[-10,0],[60,0]])},lambda x,z:0)
  self.assertEqual(len(links),1);self.assertEqual(links[0]['points'][0],[0,0]);self.assertEqual(links[0]['points'][-1],[20,0])
  self.assertEqual(connect_source_seams(roads,{'1':LineString([[-10,0],[60,0]])},lambda x,z:0),[])

 def test_crossings_and_opposing_one_way_flows_are_not_joined(self):
  source={'1':LineString([[-10,0],[60,0]])}
  for other in [road('osm-1-0',[[20,-20],[20,0]]),road('osm-1-0',[[60,0],[20,0]],1)]:
   self.assertEqual(connect_source_seams([road('gis',[[-50,0],[0,0]],1),other],source,lambda x,z:0),[])

 def test_bridge_link_interpolates_height_and_refuses_a_cliff(self):
  a=road('gis',[[-50,0],[0,0]],1);a['elevations']=[4,4]
  b=road('osm-1-0',[[30,0],[60,0]],1);b['elevations']=[6,6]
  source={'1':LineString([[-10,0],[60,0]])}
  link=connect_source_seams([a,b],source,lambda x,z:0)[0]
  self.assertEqual((link['elevations'][0],link['elevations'][-1]),(4,6));self.assertEqual(link['oneway'],1)
  b['elevations']=[20,20];self.assertEqual(connect_source_seams([a,b],source,lambda x,z:0),[])

if __name__=='__main__':unittest.main()
