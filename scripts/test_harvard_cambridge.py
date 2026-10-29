"""Regression checks for regenerating the connected Harvard/Memorial approach."""
import array
import copy
import gzip
import json
import math
import pathlib
import unittest

from harvard_bridge import harmonize_harvard
from harvard_cambridge import CONNECTOR_ID,SLIP_IDS,UPPER_IDS,repair_cambridge,validate_cambridge

ROOT=pathlib.Path(__file__).resolve().parents[1]

class HarvardCambridgeGenerationTest(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.city=json.loads((ROOT/'public/data/city.json').read_text());cls.grid=cls.city['elevation']
  cls.heights=array.array('h',gzip.decompress((ROOT/'public/data'/cls.grid['file']).read_bytes()))

 @classmethod
 def ground(cls,p):
  grid=cls.grid;w=grid['width'];fx=(p[0]-grid['originX'])/grid['cellSize'];fz=(p[1]-grid['originZ'])/grid['cellSize'];i=int(fx);j=int(fz);tx=fx-i;tz=fz-j;k=j*w+i
  a,b,c,d=[cls.heights[n]*grid.get('scale',.01) for n in [k,k+1,k+w,k+w+1]]
  return a+(b-a)*tx+(c-a)*tz if tx+tz<=1 else d+(c-d)*(1-tx)+(b-d)*(1-tz)

 def fresh_roads(self):
  roads=copy.deepcopy(self.city['roads']);selected=set(UPPER_IDS+SLIP_IDS+[CONNECTOR_ID])
  for r in roads:
   if r['id'] not in selected:continue
   # Reproduce the pre-repair interpretation: upper paths follow bare earth,
   # and the individual one-lane links inherit the whole corridor's width.
   for key in ['elevations','bridge','startLevel','endLevel','deckTangents','deckWidths']:r.pop(key,None)
   if r['id'] in SLIP_IDS+[CONNECTOR_ID]:r['width']=16
  return roads

 def test_fresh_source_profiles_repaired_with_fixed_landings_and_lower_roads(self):
  roads=self.fresh_roads();before=copy.deepcopy(roads)
  repair_cambridge(roads,self.ground);harmonize_harvard(roads);validate_cambridge(roads,self.ground)
  selected=set(UPPER_IDS+SLIP_IDS+[CONNECTOR_ID]);by_id={r['id']:r for r in roads}
  for r,old in zip(roads,before):
   if r['id'] not in selected:self.assertEqual(r,old,f"unrelated/lower road changed: {r['id']}")
   else:
    self.assertEqual(r['points'][0],old['points'][0]);self.assertEqual(r['points'][-1],old['points'][-1])
    for i,key in [(0,'startLevel'),(-1,'endLevel')]:
     if r[key]==0:self.assertAlmostEqual(r['elevations'][i],self.ground(old['points'][i]),delta=.000051)
  for id in ['osm-138789021-0','osm-138789031-0']:self.assertEqual(by_id[id],next(r for r in before if r['id']==id),'Memorial Drive must retain its lower roadway')
  once=copy.deepcopy(roads);repair_cambridge(roads,self.ground);harmonize_harvard(roads)
  self.assertEqual(roads,once,'all profile samples, source vertices and tangents must be stable on rerun')

 def test_harvard_details_and_cambridge_approach_share_the_arrival_section(self):
  roads=self.fresh_roads();repair_cambridge(roads,self.ground);harmonize_harvard(roads)
  by_id={r['id']:r for r in roads};a=by_id['osm-961263635-0'];b=by_id['osm-826552799-0']
  self.assertEqual(a['points'][-1],b['points'][0]);self.assertEqual(a['elevations'][-1],b['elevations'][0]);self.assertEqual(a['width'],b['width'])
  ta=a['deckTangents']['end'];tb=b['deckTangents']['start'];la=math.hypot(*ta);lb=math.hypot(*tb)
  for x,y in zip(ta,tb):self.assertAlmostEqual(x/la,y/lb,places=12,msg='the joined deck edges must meet exactly after both postprocessors')

if __name__=='__main__':unittest.main()
