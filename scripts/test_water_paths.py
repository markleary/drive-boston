import importlib.util
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('water_paths',ROOT/'scripts/build-water-paths.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class WaterPathTests(unittest.TestCase):
    def test_replay_keeps_the_shipped_profiles_byte_identical(self):
        source=json.loads((ROOT/'public/data/water-paths-source.json').read_text())
        origin=json.loads((ROOT/'public/data/city.json').read_text())['origin']
        actual=module.compile_paths(source,origin)
        self.assertEqual(json.dumps(actual,separators=(',',':'))+'\n',(ROOT/'src/data/water-paths.json').read_text())
        by_id={p['id']:p for p in actual['paths']}
        east=by_id['osm-way-29328208-0'];west=by_id['osm-way-832417246-0']
        self.assertEqual(east['points'][-1],west['points'][0])
        self.assertEqual(east['bridgePoints'],west['bridgePoints'])
        self.assertIn('osm-way-165358917-0',by_id)
        self.assertEqual(by_id['osm-way-832417214-0']['bridgePoints'],by_id['osm-way-242536776-0']['bridgePoints'])

if __name__=='__main__':unittest.main()
