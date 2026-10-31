"""Water-crossing chains get one flat deck between their own junctions."""
import copy
import gzip
import json
import math
import pathlib
import unittest

import numpy as np
from shapely.geometry import box

from water_crossings import DECK,chain_grades,grid_sampler,level_water_crossings,water_inputs

ROOT=pathlib.Path(__file__).resolve().parents[1]
WATER=[box(40,-30,160,30)]
SUMMER=['16427-0-0','16424-0-0','water-link-16424-0-0','16424-0-1','18106-0-0']
CONGRESS=['16432-0-0','16428-0-0','water-link-16428-0-0','16428-0-1','17615-0-0']


def ground(x,z):return -5 if 40<x<160 else 0


def piece(id,points,start,end,kind='elevated',name='Test Street'):
 """A segment profiled the way build-metro.py does: lifted ends 6.4 m above the local ground."""
 out=[];ys=[];along=0;total=sum(math.dist(a,b) for a,b in zip(points,points[1:]))
 lifted=[start==1,end==1];ha=ground(*points[0])+(DECK if lifted[0] else 0);hb=ground(*points[-1])+(DECK if lifted[1] else 0)
 for a,b in zip(points,points[1:]):
  n=max(1,math.ceil(math.dist(a,b)/3))
  for j in range(n):
   t=j/n;s=(along+t*math.dist(a,b))/total;out.append([round(a[0]+(b[0]-a[0])*t,3),round(a[1]+(b[1]-a[1])*t,3)]);ys.append(round(ha+(hb-ha)*s,4))
  along+=math.dist(a,b)
 out.append(list(points[-1]));ys.append(round(hb,4))
 return {'id':id,'name':name,'width':10,'oneway':0,'points':out,'elevations':ys,'startLevel':start,'endLevel':end,'bridge':{'id':f'structure-{id}','thickness':.75,'clearanceEstimated':True,'kind':kind}}


def bridge():
 """Junction stub, bank-to-water pieces, a restored water span and a far stub, as at Fort Point Channel."""
 return [piece('1-0-0',[[0,0],[10,0]],0,1),piece('2-0-0',[[10,0],[60,0]],1,1),piece('water-link-2-0-0',[[60,0],[140,0]],1,1,'restored-water-span'),piece('3-0-0',[[140,0],[190,0]],1,1),piece('4-0-0',[[190,0],[230,0]],1,0),
  {'id':'5-0-0','name':'Cross Street','width':7,'oneway':0,'points':[[-40,0],[0,0]]}]


class WaterCrossingsTest(unittest.TestCase):
 def test_bridge_is_one_flat_deck_between_unchanged_junctions(self):
  roads=bridge();before=copy.deepcopy(roads)
  self.assertGreater(chain_grades(roads,{r['id'] for r in roads}),.5,'the per-segment profile climbs 6.4 m inside the 10 m stub')
  report=level_water_crossings(roads,WATER,ground)
  self.assertEqual(len(report['chains']),1);self.assertEqual(report['skipped'],[])
  chain=report['chains'][0];deck=chain['deck']
  self.assertEqual(chain['junctions'],[0,0]);self.assertEqual(deck,.3,'the water estimate (1.4 m) is limited to the junction heights, then kept 0.3 m over the bank')
  for id in ['2-0-0','water-link-2-0-0','3-0-0']:self.assertTrue(all(y==deck for y in next(r for r in roads if r['id']==id)['elevations']))
  self.assertEqual(roads[0]['elevations'][0],0);self.assertEqual(roads[4]['elevations'][-1],0,'ground landings the grader pinned stay put')
  self.assertLess(chain_grades(roads,{r['id'] for r in roads}),.05)
  for road,old in zip(roads,before):self.assertEqual(road['points'],old['points']);self.assertEqual({k:v for k,v in road.items() if k!='elevations'},{k:v for k,v in old.items() if k!='elevations'})
  self.assertEqual(roads[5],before[5],'surface streets are untouched')
  again=copy.deepcopy(roads);self.assertEqual(level_water_crossings(roads,WATER,ground)['changedRoads'],[]);self.assertEqual(roads,again)

 def test_deck_rises_for_a_street_crossing_beneath_and_for_terrain(self):
  roads=bridge()+[{'id':'6-0-0','name':'Under Street','width':7,'oneway':0,'points':[[30,-40],[30,40]]}]
  level_water_crossings(roads,WATER,ground)
  self.assertAlmostEqual(roads[1]['elevations'][0],DECK,places=3,msg='an at-grade street crossing under the approach keeps its 6.4 m clearance')
  self.assertAlmostEqual(roads[0]['elevations'][-1],DECK,places=3);self.assertEqual(roads[0]['elevations'][0],0,'the ramp still meets its junction')
  roads=bridge();level_water_crossings(roads,WATER,lambda x,z:2 if 180<x<195 else ground(x,z))
  self.assertAlmostEqual(roads[1]['elevations'][0],2.3,places=3,msg='a bank above the deck lifts the whole chain just over the terrain')

 def test_junction_range_and_water_floor(self):
  roads=bridge();roads[0]['elevations'][0]=3;roads[4]['elevations'][-1]=2.5
  level_water_crossings(roads,WATER,ground)
  self.assertEqual(roads[1]['elevations'][0],2.5,'the deck follows the lower junction when the water estimate is below both')
  roads=bridge();roads[0]['elevations'][0]=-9;roads[4]['elevations'][-1]=-9
  level_water_crossings(roads,WATER,lambda x,z:-9.6 if 40<x<160 else -9)
  self.assertEqual(roads[1]['elevations'][0],-8.1,'never within 1.5 m of the water plane (-9.6 here) even when the junctions sit lower')

 def test_dedicated_builders_inland_viaducts_and_overpasses_are_reported_only(self):
  roads=bridge();roads[2]['bridge']['kind']='connected-source-approach';before=copy.deepcopy(roads)
  report=level_water_crossings(roads,WATER,ground);self.assertEqual(roads,before);self.assertEqual(report['skipped'][0]['reason'],'dedicated builder')
  roads=bridge();roads[0]['name']='Longfellow Bridge';report=level_water_crossings(roads,WATER,ground);self.assertEqual(report['skipped'][0]['reason'],'dedicated builder')
  roads=bridge();roads[4]['points'][-1]=[300,0];roads[4]['elevations'].append(0);roads[4]['points'].append([310,0]);roads[4]['endLevel']=1
  roads[4]['startLevel']=1;roads+=[piece('7-0-0',[[310,0],[320,0]],1,0)]
  report=level_water_crossings(roads,WATER,ground);self.assertEqual(report['skipped'][0]['reason'],'inland viaduct')
  roads=bridge()+[piece('8-0-0',[[30,-40],[30,40]],1,1)]
  for road in roads[-1:]:road['elevations']=[20]*len(road['points'])
  report=level_water_crossings(roads,WATER,ground);self.assertEqual(report['skipped'][0]['reason'],'crossed above')

 def test_shipped_fort_point_bridges_are_level(self):
  city=json.loads((ROOT/'public/data/city.json').read_text());grid=city['elevation']
  heights=np.frombuffer(gzip.decompress((ROOT/'public/data'/grid['file']).read_bytes()),dtype='<i2')*grid.get('scale',.01)
  roads={r['id']:r for r in city['roads']};ground=grid_sampler(grid,heights)
  polygons,water_level=water_inputs(city);report=level_water_crossings(city['roads'],polygons,ground,water_level,apply=False)
  self.assertEqual(report['changedRoads'],[],'the installed package must already be levelled')
  for ids in (SUMMER,CONGRESS):
   ys=[y for id in ids for y in roads[id]['elevations']]
   self.assertLess(max(ys)-min(ys),1.5,'no 6.4 m hump beside Dorchester Avenue');self.assertLess(chain_grades(city['roads'],set(ids)),.05)
   for id in (ids[0],ids[-1]):
    road=roads[id];index=0 if id==ids[0] else -1
    self.assertLess(abs(road['elevations'][index]-ground(*road['points'][index])),.02,f'{id} meets the graded street at its junction')
  provenance=json.loads((ROOT/'public/data/provenance.json').read_text())['waterCrossingDecks']
  self.assertEqual([c['roads'] for c in provenance['chains']],[c['roads'] for c in report['chains']])


if __name__=='__main__':unittest.main()
