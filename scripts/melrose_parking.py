"""Parallel parking on Main Street, from Foster Street to Essex Street.

The town's source curbs follow a two-lane width. Move both the measured roadway
edges and their matching curb lines out beside the shops. Taper the bays back
to the original curb at crossings and side streets. Keep the source rows in the
standard replay table so a regeneration starts from the same measurements.
"""
import json
import pathlib

import numpy as np

from street_surfaces import decode_edges, encode_edges

SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'src/data/melrose-main-street.json'


def apply_bays(headers):
    site = json.loads(SOURCE.read_text())
    tile = headers.get(site['tile'])
    if tile is None:
        return []
    origin = np.asarray(site['origin'])
    north = np.asarray(site['north'])
    east = np.array([-north[1], north[0]])
    curb = site['curbOffset']
    taper = site['taper']
    bays = site['bays']

    def widen(rows):
        # Each row is one curb point or a pair of points across a road record.
        centers = rows.mean(axis=1)
        stations = (centers - origin) @ north
        offsets = (rows - origin) @ east
        if (stations.max() < bays[0]['start'] or stations.min() > max(b['end'] for b in bays)
                or offsets.min() > curb or offsets.max() < -curb):
            return None
        breaks = {d for b in bays for d in (b['start'], b['start'] + taper, b['end'] - taper, b['end'])}
        expanded = []
        for a, b, s0, s1 in zip(rows, rows[1:], stations, stations[1:]):
            expanded.append(a)
            fractions = sorted((d - s0) / (s1 - s0) for d in breaks if min(s0, s1) < d < max(s0, s1))
            expanded.extend(a + f * (b - a) for f in fractions)
        expanded.append(rows[-1])
        coords = np.asarray(expanded)
        stations = (coords.mean(axis=1) - origin) @ north
        offsets = (coords - origin) @ east
        movement = np.zeros_like(offsets)
        for bay in bays:
            side = bay['east']
            amount = np.clip(np.minimum(stations - bay['start'], bay['end'] - stations) / taper, 0, 1)
            # Only the existing Main Street curb, never a parallel driveway or a rear lot.
            at_curb = np.abs(offsets * side - 3.9) < .55
            movement += amount[:, None] * at_curb * (side * curb - offsets)
        if np.max(np.abs(movement)) < .001:
            return None
        return coords + movement[:, :, None] * east

    saved = {}
    for field in ('pavements', 'curbs'):
        changes = []
        for index, item in enumerate(tile[field]):
            if field == 'pavements':
                if item['road'] != site['road']:
                    continue
                args = (tile['tx'], tile['tz'], tile['size'])
                edges = widen(np.stack(decode_edges(item['edges'], *args), axis=1))
                if edges is None:
                    continue
                replacement = {**item, 'edges': encode_edges(edges[:, 0], edges[:, 1], *args)}
            else:
                points = widen(np.asarray(item)[:, None, :])
                if points is None:
                    continue
                replacement = points[:, 0].round(3).tolist()
            changes.append([index, 1, item])
            tile[field][index] = replacement
        if changes:
            saved[field] = changes
    if saved:
        replay = tile.setdefault('reviewedStreetSources', {})
        for field, rows in saved.items():
            replay.setdefault(field, []).extend(rows)
        return [site['tile']]
    return []
