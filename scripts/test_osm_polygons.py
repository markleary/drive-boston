"""Preserve complete OSM multipolygon buildings, parks, and courtyards."""
import importlib.util
import pathlib
import unittest
from unittest.mock import patch

from shapely.geometry import Point


spec = importlib.util.spec_from_file_location(
    'metro_polygons', pathlib.Path(__file__).with_name('build-metro.py'))
metro = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metro)


def way_member(ref, role, points):
    return {'type': 'way', 'ref': ref, 'role': role,
            'geometry': [{'lon': x, 'lat': y} for x, y in points]}


def courtyard_relation():
    # Neither ring is a closed member way. Members are deliberately shuffled,
    # and adjacent ways do not all have the same direction in the source.
    return {'type': 'relation', 'id': 314159,
            'tags': {'type': 'multipolygon', 'building': 'apartments'},
            'members': [
                way_member(4, 'outer', [(0, 0), (0, 30)]),
                way_member(12, 'inner', [(8, 17), (20, 17), (20, 7)]),
                way_member(2, 'outer', [(40, 30), (40, 0)]),
                {'type': 'node', 'ref': 999, 'role': 'label'},
                way_member(1, 'outer', [(0, 0), (40, 0)]),
                way_member(11, 'inner', [(8, 17), (8, 7), (20, 7)]),
                way_member(3, 'outer', [(0, 30), (40, 30)]),
            ]}


class OsmPolygonTests(unittest.TestCase):
    def setUp(self):
        # Use metre-like Cartesian fixtures so the expected footprint is exact;
        # projection itself has separate source-data validation.
        projection = patch.object(metro, 'xy', side_effect=lambda lon, lat: (lon, lat))
        projection.start()
        self.addCleanup(projection.stop)

    def test_fragmented_outer_ways_keep_inner_courtyard(self):
        polygons = metro.osm_polygons(courtyard_relation(), require_complete=True)

        self.assertEqual(len(polygons), 1)
        footprint = polygons[0]
        self.assertTrue(footprint.is_valid)
        self.assertEqual(footprint.bounds, (0, 0, 40, 30))
        self.assertAlmostEqual(footprint.area, 40 * 30 - 12 * 10)
        self.assertEqual(len(footprint.interiors), 1)
        self.assertTrue(footprint.contains(Point(4, 4)))
        self.assertFalse(footprint.covers(Point(14, 12)),
                         'a courtyard must remain open instead of becoming solid building')

    def test_disconnected_outer_rings_remain_separate_buildings(self):
        relation = courtyard_relation()
        relation['members'].extend([
            way_member(21, 'outer', [(60, 0), (80, 0), (80, 30)]),
            way_member(22, 'outer', [(60, 0), (60, 30), (80, 30)]),
        ])

        polygons = metro.osm_polygons(relation, require_complete=True)

        self.assertEqual(len(polygons), 2)
        self.assertTrue(all(poly.is_valid for poly in polygons))
        self.assertAlmostEqual(sum(poly.area for poly in polygons), 1680)
        self.assertEqual(sum(len(poly.interiors) for poly in polygons), 1)
        self.assertFalse(any(poly.covers(Point(50, 15)) for poly in polygons),
                         'separate outer rings must not create a connecting building')

    def test_closed_way_footprints_still_work(self):
        element = {'type': 'way', 'id': 2718, 'geometry': [
            {'lon': x, 'lat': y} for x, y in
            [(0, 0), (20, 0), (20, 10), (0, 10), (0, 0)]]}

        polygons = metro.osm_polygons(element, require_complete=True)

        self.assertEqual(len(polygons), 1)
        self.assertAlmostEqual(polygons[0].area, 200)
        element['geometry'].pop()
        self.assertEqual(metro.osm_polygons(element, require_complete=True), [])

    def test_incomplete_chelsea_relations_fail_with_refresh_instruction(self):
        for missing in ['members', 'outer geometry', 'inner geometry']:
            with self.subTest(missing=missing):
                relation = courtyard_relation()
                if missing == 'members':
                    del relation['members']
                else:
                    role = missing.split()[0]
                    member = next(m for m in relation['members'] if m['role'] == role)
                    del member['geometry']

                with self.assertRaisesRegex(
                        ValueError, r'OSM relation 314159 .*out body geom'):
                    metro.osm_polygons(relation, require_complete=True)

    def test_legacy_tags_only_relations_remain_optional_outside_chelsea(self):
        element = {'type': 'relation', 'id': 314159,
                   'tags': {'type': 'multipolygon', 'building': 'apartments'}}
        self.assertEqual(metro.osm_polygons(element), [])


if __name__ == '__main__':
    unittest.main()
