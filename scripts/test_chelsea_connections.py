"""The Chelsea Creek source seams stay connected and deterministic."""
import array,copy,gzip,json,pathlib,unittest
from chelsea_connections import repair_chelsea,validate_chelsea,SPECS
from harvard_terrain import sample_grid

ROOT=pathlib.Path(__file__).resolve().parents[1]


class ChelseaConnectionsTest(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.city=json.loads((ROOT/'public/data/city.json').read_text());grid=cls.city['elevation']
  cls.heights=[v*grid.get('scale',.01) for v in array.array('h',gzip.decompress((ROOT/'public/data'/grid['file']).read_bytes()))]
  cls.source=json.loads((ROOT/'public/data/chelsea-bridges-source.json').read_text())

 def ground(self,p):return sample_grid(self.city['elevation'],self.heights,p)

 def test_physical_crossings_have_both_landings_and_no_duplicate_decks(self):
  validate_chelsea(self.city,self.ground)
  for spec in SPECS:
   road=next(r for r in self.city['roads'] if r['id']==spec['id'])
   self.assertGreater(max(road['elevations'])-max(road['elevations'][0],road['elevations'][-1]),4.7)
  for landmark in self.city['landmarks']:
   if landmark['id'] in ['maverick-square','logan-airport']:self.assertNotIn('detached',landmark)

 def test_rebuilding_crossings_is_byte_stable_and_preserves_other_roads(self):
  city=copy.deepcopy(self.city);before=copy.deepcopy(city)
  first=repair_chelsea(city,self.source,self.ground);validate_chelsea(city,self.ground)
  once=copy.deepcopy(city);second=repair_chelsea(city,self.source,self.ground)
  self.assertEqual(city,once);self.assertEqual(first,second)
  owned={s['id'] for s in SPECS}
  self.assertEqual([r for r in city['roads'] if r['id'] not in owned],[r for r in before['roads'] if r['id'] not in owned])


if __name__=='__main__':unittest.main()
