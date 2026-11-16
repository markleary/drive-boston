import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


class CastleIslandTest(unittest.TestCase):
    def test_staged_package_uses_its_city_elevation_and_tile_without_touching_installed_data(self):
        installed = ROOT/'public/data'
        sidecar = ROOT/'src/data/castle-island.json'
        files = [installed/'city.json', installed/'elevation.bin', installed/'tiles/t_5_1.bin', sidecar]
        def hashes():
            return [hashlib.sha256(file.read_bytes()).hexdigest() for file in files]
        before = hashes()
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory); (stage/'tiles').mkdir()
            city = json.loads((installed/'city.json').read_text())
            grid = city['elevation']
            heights = np.frombuffer(gzip.decompress((installed/grid['file']).read_bytes()), dtype='<i2').copy()
            heights += round(1/grid.get('scale', .01))
            grid['file'] = 'staged-elevation.bin'
            (stage/grid['file']).write_bytes(gzip.compress(heights.tobytes()))
            (stage/'city.json').write_text(json.dumps(city))
            # Change only a same-length metadata ID, retaining the survey payload.
            raw = gzip.decompress((installed/'tiles/t_5_1.bin').read_bytes())
            old_id = b'BOS-AQD15-29RFX-598N6'; new_id = b'STG-AQD15-29RFX-598N6'
            self.assertEqual(raw.count(old_id), 1)
            (stage/'tiles/t_5_1.bin').write_bytes(gzip.compress(raw.replace(old_id, new_id)))
            output = stage/'castle-island.json'
            command = [sys.executable, str(ROOT/'scripts/build-castle-island.py'), '--data-dir', str(stage), '--output', str(output)]
            subprocess.run(command, check=True, capture_output=True, text=True)
            detail = json.loads(output.read_text())
            self.assertEqual(detail['fort']['id'], new_id.decode())
            self.assertEqual(detail['bay']['level'], -2.14)
            water = next(w for w in json.loads((stage/'city.json').read_text())['water'] if w['id'] == 'water-merged-55')
            self.assertEqual([s['level'] for s in water['surfaces'] if s.get('name') == 'Pleasure Bay'], [-2.14])
            first = [(stage/'city.json').read_bytes(), output.read_bytes()]
            subprocess.run(command, check=True, capture_output=True, text=True)
            self.assertEqual(first, [(stage/'city.json').read_bytes(), output.read_bytes()])
        self.assertEqual(before, hashes(), 'a staged build must not rewrite the installed package or sidecar')


if __name__ == '__main__':
    unittest.main()
