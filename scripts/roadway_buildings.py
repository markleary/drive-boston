"""Exclude compact ground-level building imports occupying through pavement."""
import gzip

import numpy as np
from shapely.geometry import MultiPoint, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

from building_clearance import RoadClearanceIndex
from far_massing import pack_far, read_far
import tileformat

MAX_HEIGHT = 6
MAX_AREA = 16
PAVEMENT_MARGIN = 0.75
END_MARGIN = 2


def roadway_buildings(city, headers):
    """Find standalone shells entirely inside measured ground-level roadways.

    Require both a centerline crossing and pavement around the whole footprint.
    Width guesses, junction endpoints, driveways and decks alone are insufficient.
    The citywide polygon index lets footprints straddle tile boundaries.
    """
    roads = RoadClearanceIndex([
        road for road in city['roads']
        if road.get('pavedWidth') and not road.get('tunnel') and not road.get('surveyDeck')
    ])
    asphalt = STRtree([
        Polygon(rings[0], rings[1:])
        for header in headers.values() for rings in header['streetPavement']
    ])
    islands = [rings for header in headers.values() for rings in header['islands']]
    walks = [walk['rings'] for header in headers.values() for walk in header['sidewalks']]
    protected_pavement = STRtree([Polygon(rings[0], rings[1:]) for rings in islands + walks])
    protected_ids = {entry['id'] for entry in city.get('landmarkBuildings', [])}
    protected_ids.update(place.get('buildingId') for place in city.get('landmarks', []))
    protected_ids.update(entry['partOf'] for header in headers.values()
                         for entry in header['buildings'] if entry.get('partOf'))
    findings = {}
    for key, header in headers.items():
        for ordinal, entry in enumerate(header['buildings']):
            if (not 0 < entry['height'] <= MAX_HEIGHT or entry['id'] in protected_ids
                    or any(entry.get(field) for field in
                           ('structure', 'landmark', 'partOf', 'buildingPassage', 'amenity'))
                    or entry.get('norm', {}).get('offset', 0) > 0.25):
                continue
            footprint = Polygon(entry['footprint']).buffer(0)
            if not 0 < footprint.area <= MAX_AREA:
                continue
            crossing = [
                road for road in roads.overlaps(entry)
                if MultiPoint([road['points'][0], road['points'][-1]]).distance(footprint) > END_MARGIN
            ]
            if not crossing:
                continue
            interior = footprint.buffer(PAVEMENT_MARGIN)
            if len(protected_pavement.query(interior, predicate='intersects')):
                continue
            hits = asphalt.query(interior, predicate='intersects')
            if unary_union(asphalt.geometries[hits]).covers(interior):
                findings.setdefault(key, {})[ordinal] = {
                    'id': entry['id'], 'roads': sorted({road['id'] for road in crossing}),
                }
    return findings


def prune_package(data_dir, city, headers, provenance):
    """Keep detailed meshes, far proxies and manifest counts in ordinal order."""
    excluded = roadway_buildings(city, headers)
    if not excluded:
        return []
    removed = remove_buildings(data_dir, city, excluded, provenance, headers)
    exclusions = provenance.setdefault('roadwayBuildingExclusions', {})
    exclusions.update({entry['id']: entry['roads'] for entry in removed})
    return removed


def remove_buildings(data_dir, city, excluded, provenance, headers=None):
    """Drop the buildings `excluded` lists ({tile key: {ordinal: {'id', ...}}}) from
    their tiles and from the far index, and keep the manifest counts in step
    (`headers`, when given, are checked against the far index's counts)."""
    far_path = data_dir / city['tiles']['far']
    far, records = read_far(gzip.decompress(far_path.read_bytes()))
    packed = {}
    assert excluded.keys() <= records.keys(), 'Missing DBF2 tile for roadway building exclusions'
    for key, tile in records.items():
        skip = excluded.get(key, {})
        ordinal = -1
        retained = []
        for record in tile:
            if not record[6] & 8:  # A fragment shares its primary building's ordinal.
                ordinal += 1
            if ordinal not in skip:
                retained.append(record)
        if headers is not None:
            assert ordinal + 1 == len(headers[key]['buildings']), f'{key}: DBT2 and DBF2 counts differ'
        if retained:
            packed[key] = len(retained), b''.join(retained)
    raw = pack_far(far['size'], packed)

    removed = []
    tile_dir = data_dir / city['tiles']['directory']
    for key, skip in excluded.items():
        path = tile_dir / f't_{key}.bin'
        header, meshes = tileformat.read_tile(path)
        retained = []
        geometry = []
        for ordinal, (entry, mesh) in enumerate(zip(header['buildings'], meshes)):
            if ordinal in skip:
                assert entry['id'] == skip[ordinal]['id'], f'{key}: building order changed'
                removed.append(skip[ordinal])
                policy = entry['norm']['policy']
                provenance['buildingSources'][policy] -= 1
                continue
            scale = entry.get('scale', tileformat.SCALE)
            positions = np.rint((mesh['positions'] - entry['anchor']) / scale).astype(np.int16)
            geometry.append((positions, mesh['facade'], mesh['roof'], scale))
            retained.append(entry)
        header['buildings'] = retained
        tileformat.write_tile(path, header, geometry)

    tileformat.write_gzip(far_path, raw)
    city['tiles']['buildingCount'] -= len(removed)
    provenance['farLodBytes'] = len(raw)
    return removed
