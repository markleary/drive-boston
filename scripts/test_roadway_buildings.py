import copy
import gzip
from pathlib import Path
import struct
import tempfile
import unittest

import numpy as np

from far_massing import pack_far, read_far
from roadway_buildings import prune_package, roadway_buildings
import tileformat


def rectangle(x0, z0, x1, z1):
    return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]


def building(identifier, **fields):
    return {
        'id': identifier, 'height': 4, 'anchor': [10, 0, 10], 'footprint': rectangle(9, 9, 11, 11),
        'norm': {'offset': 0, 'policy': 'catalog-metres-and-source-floor'}, **fields,
    }


def tile(pavement, *buildings):
    return {'streetPavement': [[pavement]], 'islands': [], 'sidewalks': [], 'buildings': list(buildings)}


class RoadwayBuildingsTest(unittest.TestCase):
    def setUp(self):
        self.road = {'id': 'street', 'points': [[0, 10], [20, 10]], 'pavedWidth': 8}
        self.city = {'roads': [self.road], 'landmarkBuildings': [], 'landmarks': []}
        self.pavement = rectangle(0, 6, 20, 14)
        self.obstruction = building('box')

    def test_conflict_can_span_tile_seam(self):
        headers = {
            '0_0': tile(rectangle(0, 6, 10, 14)),
            '1_0': tile(rectangle(10, 6, 20, 14), self.obstruction),
        }
        self.assertEqual(roadway_buildings(self.city, headers),
                         {'1_0': {0: {'id': 'box', 'roads': ['street']}}})

    def test_keeps_uncertain_or_intentional_structures(self):
        self.city['landmarkBuildings'] = [{'id': 'key'}]
        entries = [
            building('key'), building('part', partOf='parent'), building('parent'),
            building('bridge', structure=True), building('overhead', norm={'offset': 4.5}),
            building('tower', height=14), building('large', footprint=rectangle(7, 8, 13, 12)),
            building('sidewalk-edge', footprint=rectangle(9, 9, 11, 13.5)),
        ]
        self.assertEqual(roadway_buildings(self.city, {'0_0': tile(self.pavement, *entries)}), {})
        for field, value in [('elevations', [8, 8]), ('tunnel', True), ('pavedWidth', None),
                             ('points', [[0, 10], [10.5, 10]])]:
            with self.subTest(field=field):
                city = {**self.city, 'roads': [{**self.road, field: value}]}
                self.assertEqual(roadway_buildings(city, {'0_0': tile(self.pavement, self.obstruction)}), {})
        for field, feature in [('islands', [rectangle(9, 9, 11, 11)]),
                               ('sidewalks', {'rings': [rectangle(9, 9, 11, 11)]})]:
            header = tile(self.pavement, self.obstruction)
            header[field].append(feature)
            self.assertEqual(roadway_buildings(self.city, {'0_0': header}), {})

    def test_package_removes_geometry_and_matching_far_record_once(self):
        kept = building('landmark', landmark='landmark')
        header = tile(self.pavement, self.obstruction, kept)
        geometry = [
            (np.array([[0, 0, 0], [n, 0, 0], [0, n, 0]], dtype=np.int16),
             np.array([[0, 1, 2]]), np.empty((0, 3)), 0.01)
            for n in [100, 200]
        ]
        self.city['tiles'] = {'directory': 'tiles', 'far': 'far.bin', 'buildingCount': 2}
        provenance = {'buildingSources': {'catalog-metres-and-source-floor': 2}}
        far_records = [struct.pack('<HHhBBhhhhhh', 3, 400, 0, flags, 1, 0, 0, 10, 0, 0, 10)
                       for flags in [2, 5, 13]]
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp)
            path = data / 'tiles/t_0_0.bin'
            tileformat.write_tile(path, header, geometry)
            tileformat.write_gzip(data / 'far.bin', pack_far(1000, {'0_0': (3, b''.join(far_records))}))
            result = prune_package(data, self.city, {'0_0': header}, provenance)
            self.assertEqual(result, [{'id': 'box', 'roads': ['street']}])
            self.assertEqual(self.city['tiles']['buildingCount'], 1)
            self.assertEqual(provenance['buildingSources']['catalog-metres-and-source-floor'], 1)
            rebuilt, meshes = tileformat.read_tile(path)
            self.assertEqual([mesh['id'] for mesh in meshes], ['landmark'])
            np.testing.assert_array_equal(meshes[0]['positions'], geometry[1][0] * 0.01 + kept['anchor'])
            far = gzip.decompress((data / 'far.bin').read_bytes())
            self.assertEqual(read_far(far)[1], {'0_0': far_records[1:]})
            self.assertEqual(provenance['farLodBytes'], len(far))
            before = copy.deepcopy(provenance)
            self.assertEqual(prune_package(data, self.city, {'0_0': rebuilt}, provenance), [])
            self.assertEqual(provenance, before)
