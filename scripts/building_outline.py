"""The plan a building's shell covers, for the stages that route roads under buildings.

A tile stores each building's convex footprint, which spans the streets and
roads beside an L-shaped or hollow shell; the plan is the union of its roof
faces seen from above, snapped to millimetres so that the outline a stage
computes and the copy kept with a carved shell (`buildingPassage.outline`) are
the same geometry.
"""
import shapely
from shapely.geometry import Polygon

GRID = .001


def roof_outline(positions, roof):
 """Union of the roof triangles' plans (an empty polygon for a shell without roof faces)."""
 if not len(roof):return Polygon()
 polygons = shapely.polygons(positions[roof][:, :, [0, 2]]);polygons = polygons[shapely.area(polygons) > 1e-4]
 if not len(polygons):return Polygon()
 return snapped(shapely.union_all(shapely.make_valid(polygons)).buffer(.05).buffer(-.05))


def snapped(shape):
 """`shape` on the millimetre grid, polygons only."""
 shape = shapely.set_precision(shape, GRID)
 parts = [g for g in shapely.get_parts(shape) if g.geom_type == 'Polygon' and not g.is_empty]
 return shapely.union_all(parts) if len(parts) != 1 else parts[0]


def rings(shape):
 """JSON form of an outline: one list of rings (exterior first) per polygon."""
 return [[[list(map(float, c)) for c in ring.coords] for ring in (g.exterior, *g.interiors)] for g in shapely.get_parts(shape) if g.geom_type == 'Polygon' and not g.is_empty]


def from_rings(value):
 """The outline `rings` wrote."""
 parts = [Polygon(r[0], r[1:]) for r in value]
 return parts[0] if len(parts) == 1 else shapely.union_all(parts)
