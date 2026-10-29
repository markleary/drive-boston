"""Mixed-source bridge connections retain their shared deck and outer street."""
import array
import copy
import gzip
import json
import pathlib
import unittest

from road_connections import repair_source_connections,validate_source_connections

ROOT=pathlib.Path(__file__).resolve().parents[1]
APPROACHES={'osm-262605757-0','osm-1377669404-0','osm-8648787-0','osm-8647560-0'}


class SourceConnectionsTest(unittest.TestCase):
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
  roads=copy.deepcopy(self.city['roads'])
  for road in roads:
   if road['id'] not in APPROACHES:continue
   # Reproduce source-independent compilation even after the package is fixed.
   for key in ('elevations','bridge','startLevel','endLevel','deckWidths','deckTangents'):road.pop(key,None)
  return roads

 def test_reported_bridges_and_same_root_cause_are_continuous(self):
  roads=self.fresh_roads();before=copy.deepcopy(roads)
  with self.assertRaisesRegex(AssertionError,'Unreconciled mixed-source deck step'):validate_source_connections(roads,self.ground)
  result=repair_source_connections(roads,self.ground)
  self.assertEqual({v['approachRoad'] for v in result},APPROACHES)
  validate_source_connections(roads,self.ground)
  changed=APPROACHES|{v['sourceRoad'] for v in result}
  for road,old in zip(roads,before):
   if road['id'] not in changed:self.assertEqual(road,old,f"Unrelated overpass or street changed: {road['id']}")
   self.assertEqual(road['points'][0],old['points'][0]);self.assertEqual(road['points'][-1],old['points'][-1])
  once=copy.deepcopy(roads)
  self.assertEqual(repair_source_connections(roads,self.ground),result)
  self.assertEqual(roads,once,'profiles, tapers and source vertices must remain stable on rerun')

 def test_owned_profile_tracks_later_deck_and_terrain_datum_corrections(self):
  roads=[{'id':'1-0-0','name':'Test Road','width':10,'points':[[-60,0],[0,0]],'elevations':[4,4],'startLevel':1,'endLevel':1},
         {'id':'osm-1-0','name':'Test Road','width':16,'points':[[0,0],[60,0]]}]
  repair_source_connections(roads,lambda p:0)
  roads[0]['elevations'][-1]=4.5
  repair_source_connections(roads,lambda p:.2)
  self.assertEqual(roads[1]['elevations'][0],4.5);self.assertEqual(roads[1]['elevations'][-1],.2)
  validate_source_connections(roads,lambda p:.2)
  once=copy.deepcopy(roads);repair_source_connections(roads,lambda p:.2);self.assertEqual(roads,once)

 def test_coincident_crossing_and_multi_arm_junction_are_not_connections(self):
  def upper(id,points):return {'id':id,'name':'Test Road','width':10,'points':points,'elevations':[6.4]*len(points),'startLevel':1,'endLevel':1}
  def lower(id,points):return {'id':id,'name':'Test Road','width':10,'points':points}
  roads=[upper('1-0-0',[[-10,0],[0,0]]),lower('osm-1-0',[[0,0],[0,10]])]
  before=copy.deepcopy(roads);self.assertEqual(repair_source_connections(roads,lambda p:0),[]);self.assertEqual(roads,before)
  roads=[upper('1-0-0',[[-10,0],[0,0]]),lower('osm-1-0',[[0,0],[10,0]]),lower('osm-2-0',[[0,0],[0,10]])]
  before=copy.deepcopy(roads);self.assertEqual(repair_source_connections(roads,lambda p:0),[]);self.assertEqual(roads,before)


if __name__=='__main__':unittest.main()
