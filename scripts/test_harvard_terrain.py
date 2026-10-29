"""The shared lower-road grid must remain flat and reproducible after repair."""
import array
import gzip
import json
import math
import pathlib
import unittest

from harvard_terrain import MEMORIAL_ROADS,repair_memorial_terrain,sample_grid

ROOT=pathlib.Path(__file__).resolve().parents[1]

class HarvardTerrainTest(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.city=json.loads((ROOT/'public/data/city.json').read_text());cls.grid=cls.city['elevation']
  raw=array.array('h',gzip.decompress((ROOT/'public/data'/cls.grid['file']).read_bytes()))
  cls.heights=array.array('d',(v*cls.grid.get('scale',.01) for v in raw))

 def test_local_embankment_removed_without_drifting_boundaries_or_outer_landings(self):
  city=self.city;grid=self.grid;heights=self.heights[:];w=grid['width'];cell=grid['cellSize']
  # Recreate a competing surface-road bank beneath the now-separated upper
  # approach, even after the checked-in terrain has already been corrected.
  x,z=-1476.247,-785.191;i=round((x-grid['originX'])/cell);j=round((z-grid['originZ'])/cell);heights[j*w+i]+=3
  before=heights[:];roads=[r for r in city['roads'] if r['id'] in MEMORIAL_ROADS]
  anchors=[p for r in roads for p in [r['points'][0],r['points'][-1]]]
  # Closest surveyed MIT building corner and the bank outside the corridor.
  protected=anchors+[[-1536.17,-790.155],[-1537.843,-789.498],[-1550.585,-784.928],[-1440,-730]]
  original=[sample_grid(grid,before,p) for p in protected]
  stats=repair_memorial_terrain(city,heights)
  self.assertGreater(stats['changedVertices'],0);self.assertLess(stats['vertices'],300)
  self.assertEqual([sample_grid(grid,heights,p) for p in protected],original)
  changed=[n for n,(a,b) in enumerate(zip(before,heights)) if a!=b]
  self.assertLess(len(changed),300,'only the local underpass patch may change')
  for n in changed:
   px=grid['originX']+(n%w)*cell;pz=grid['originZ']+(n//w)*cell
   self.assertLess(math.hypot(px+1471.124,pz+781.659),110,'no remote terrain may be altered')
  worst=0
  for road in roads:
   for a,b in zip(road['points'],road['points'][1:]):
    dx=b[0]-a[0];dz=b[1]-a[1];length=math.hypot(dx,dz);nx=-dz/length;nz=dx/length
    for station in range(math.ceil(length)):
     px=a[0]+dx*station/length;pz=a[1]+dz*station/length
     if math.hypot(px+1471.124,pz+781.659)>65:continue
     ys=[sample_grid(grid,heights,[px+nx*offset,pz+nz*offset]) for offset in range(-6,7)]
     worst=max(worst,max(abs(y-x) for x,y in zip(ys,ys[1:])))
  self.assertLess(worst,.01,'both pavement and sidewalks must have less than 1% internal crossfall beneath the bridge')
  once=heights[:];second=repair_memorial_terrain(city,heights)
  self.assertEqual(second['changedVertices'],0);self.assertEqual(heights,once,'fixed-boundary regeneration must be byte-idempotent')

if __name__=='__main__':unittest.main()
