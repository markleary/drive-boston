import gzip
import hashlib
import importlib.util
import pathlib
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('footbridge_profiles',pathlib.Path(__file__).with_name('backfill-footbridge-profiles.py'))
profiles=importlib.util.module_from_spec(spec);spec.loader.exec_module(profiles)

class FootbridgeProfilesTest(unittest.TestCase):
    def test_stitching_keeps_bends_and_ignores_fragment_order_and_direction(self):
        fragments=[[[0,2],[1,3],[2,4]],[[0,0],[0,1],[0,2]],[[3,5],[2,4]]]
        expected=[[0,0],[0,1],[0,2],[1,3],[2,4],[3,5]]
        self.assertEqual(profiles.stitch(fragments),expected)
        self.assertEqual(profiles.stitch([list(reversed(p)) for p in reversed(fragments)]),expected)

    def test_rejects_disconnected_branching_or_closed_chains(self):
        for fragments in [
            [[[0,0],[1,0]],[[2,0],[3,0]]],
            [[[0,0],[1,0]],[[1,0],[2,0]],[[1,0],[1,1]]],
            [[[0,0],[1,0]],[[1,0],[0,0]]],
        ]:
            with self.subTest(fragments=fragments),self.assertRaises(ValueError):profiles.stitch(fragments)

    def test_tile_id_preserves_disconnected_park_components(self):
        self.assertEqual(profiles.source_id('osm-way-123-0--2_1_0',-2,1),'osm-way-123-0')
        self.assertEqual(profiles.source_id('osm-way-123-1--2_1_0',-2,1),'osm-way-123-1')
        with self.assertRaises(ValueError):profiles.source_id('osm-way-123-0--2_1_0',2,1)

    def test_backfill_preserves_payload_alignment_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);tiles=root/'tiles';tiles.mkdir()
            fragments=[(-1,{'id':'osm-way-123-0--1_0_0','bridge':True,'width':2.6,'points':[[-2,1],[0,2]]}),
                       (0,{'id':'osm-way-123-0-0_0_0','bridge':True,'width':2.6,'points':[[0,2],[3,3]]})]
            payload=bytes(range(256))*3+b'\x00\x00\x01\x00\x02\x00'
            for tx,path in fragments:
                paths=[path]
                if tx==0:paths.append({'id':'osm-way-123-1-0_0_0','bridge':True,'points':[[8,2],[9,3]],'width':2.6})
                header={'tx':tx,'tz':0,'size':1000,'buildings':[],'vertexCount':0,'indexBytes':2,'parkPaths':paths}
                (tiles/f't_{tx}_0.bin').write_bytes(profiles.pack(header,payload))
            before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in tiles.iterdir()}
            self.assertEqual(profiles.backfill(root,check=True)['changedTiles'],2)
            self.assertEqual(before,{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in tiles.iterdir()})
            report=profiles.backfill(root)
            self.assertEqual((report['bridgeFragments'],report['splitGroups'],report['changedTiles']),(3,1,2))
            for file in tiles.iterdir():
                header,actual=profiles.unpack(gzip.decompress(file.read_bytes()))
                self.assertEqual(actual,payload)
                self.assertEqual(header['parkPaths'][0]['bridgePoints'],[[-2,1],[0,2],[3,3]])
                if header['tx']==0:self.assertNotIn('bridgePoints',header['parkPaths'][1])
            after={p.name:p.read_bytes() for p in tiles.iterdir()}
            self.assertEqual(profiles.backfill(root)['changedTiles'],0)
            self.assertEqual(after,{p.name:p.read_bytes() for p in tiles.iterdir()})

if __name__=='__main__':unittest.main()
