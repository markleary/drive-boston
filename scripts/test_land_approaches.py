"""Seam stubs meet the street that continues them, sunk approaches ride their embankment, the clipped Jamaicaway ramp reaches the loop."""
import copy
import gzip
import json
import math
import pathlib
import unittest

import numpy as np

from land_approaches import AT_GRADE,SINK,TOWN_LINKS,level_land_approaches,restore_links,restore_sources,water_chain_ids,levelled_water_ids
from water_crossings import DECK,RAMP_RISE,TERRAIN_RISE,grid_sampler,level_water_crossings,lifted,water_inputs

ROOT=pathlib.Path(__file__).resolve().parents[1]


def flat(x,z):return 1


def street(id,points,name='Terrain Street'):return {'id':id,'name':name,'width':10,'oneway':0,'points':[list(p) for p in points]}


def piece(id,points,start,end,ground,name='Elevated Street'):
 """A segment profiled the way build-metro.py does: a lifted end 6.4 m above the local ground, a straight profile between the ends, sampled every 3 m."""
 out=[];ys=[];along=0;total=sum(math.dist(a,b) for a,b in zip(points,points[1:]))
 ha=ground(*points[0])+(DECK if start==1 else 0);hb=ground(*points[-1])+(DECK if end==1 else 0)
 for a,b in zip(points,points[1:]):
  n=max(1,math.ceil(math.dist(a,b)/3))
  for j in range(n):
   t=j/n;s=(along+t*math.dist(a,b))/total;out.append([round(a[0]+(b[0]-a[0])*t,3),round(a[1]+(b[1]-a[1])*t,3)]);ys.append(round(ha+(hb-ha)*s,4))
  along+=math.dist(a,b)
 out.append(list(points[-1]));ys.append(round(hb,4))
 return {'id':id,'name':name,'width':10,'oneway':0,'points':out,'elevations':ys,'startLevel':start,'endLevel':end,'bridge':{'id':f'structure-{id}','thickness':.75,'kind':'elevated'}}


class SeamStubs(unittest.TestCase):
 def test_a_culvert_stub_continued_by_a_terrain_street_becomes_a_surface_street(self):
  # Huntington Avenue's first 15 m inside Boston: level 1 at the town line, where Washington Street arrives on the ground.
  roads=[street('w','[[-40,0],[0,0]]'[0:0] or [[-40,0],[0,0]],'Washington Street'),piece('h',[[0,0],[15,0]],1,0,flat,'Huntington Avenue'),street('e',[[15,0],[60,0]],'Huntington Avenue')]
  report=level_land_approaches(roads,flat,links=[])
  self.assertEqual([s['road'] for s in report['seams']],['h']);self.assertTrue(report['seams'][0]['surface']);self.assertEqual(report['seams'][0]['continues'],['w']);self.assertAlmostEqual(report['seams'][0]['lowered'],DECK,places=3)
  for key in ('elevations','bridge','startLevel','endLevel'):self.assertNotIn(key,roads[1])
  self.assertEqual(report['changedRoads'],['h']);self.assertEqual(level_land_approaches(roads,flat,links=[])['changedRoads'],[],'idempotent')

 def test_a_stream_span_keeps_a_small_deck_over_the_gully(self):
  def gully(x,z):return -1 if 6<x<18 else 1
  roads=[street('w',[[-40,0],[0,0]]),piece('s',[[0,0],[24,0]],1,0,gully),street('e',[[24,0],[60,0]])]
  report=level_land_approaches(roads,gully,links=[]);span=roads[1];ys=span['elevations']
  self.assertFalse(report['seams'][0]['surface']);self.assertEqual(span['startLevel'],0);self.assertEqual(span['endLevel'],0);self.assertIn('bridge',span)
  self.assertEqual(ys[0],1,'the lifted node meets the ground the continuing street arrives on');self.assertEqual(ys[-1],1,'the pinned landing stays')
  for p,y in zip(span['points'],ys):self.assertGreaterEqual(y,gully(*p)-1e-9);self.assertLess(y,1+RAMP_RISE+1e-9)
  self.assertTrue(any(y-gully(*p)>AT_GRADE for p,y in zip(span['points'],ys)),'the deck stays above the gully')
  again=copy.deepcopy(roads);self.assertEqual(level_land_approaches(roads,gully,links=[])['changedRoads'],[]);self.assertEqual(roads,again)

 def test_overpasses_and_split_crossings_are_left_alone(self):
  # A terrain street passing through the lifted node (planar GIS: the crossing beneath).
  roads=[piece('o',[[0,0],[30,0]],1,0,flat),street('under',[[0,-20],[0,0],[0,20]])]
  self.assertEqual(level_land_approaches(roads,flat,links=[])['changedRoads'],[])
  # The same crossing split at the node into two halves continuing each other.
  roads=[piece('o',[[0,0],[30,0]],1,0,flat),street('n',[[0,-20],[0,0]]),street('s',[[0,0],[0,20]])]
  self.assertEqual(level_land_approaches(roads,flat,links=[])['changedRoads'],[])
  # A side street meeting the node at an angle is not a continuation.
  roads=[piece('o',[[0,0],[30,0]],1,0,flat),street('side',[[0,0],[-20,25]])]
  self.assertEqual(level_land_approaches(roads,flat,links=[])['changedRoads'],[])
  # A street crossing beneath the piece away from its ends.
  roads=[street('w',[[-40,0],[0,0]]),piece('o',[[0,0],[30,0]],1,0,flat),street('x',[[15,-20],[15,20]])]
  self.assertEqual(level_land_approaches(roads,flat,links=[])['changedRoads'],[])
  # Two lifted pieces joined at the node form a chain, not a stub.
  roads=[street('w',[[-40,0],[0,0]]),piece('a',[[0,0],[30,0]],1,0,flat),piece('b',[[0,0],[-30,0]],1,0,flat)]
  self.assertEqual([s['road'] for s in level_land_approaches(roads,flat,links=[])['seams']],[])


class SunkApproaches(unittest.TestCase):
 def test_a_ramp_rides_its_embankment_and_never_descends_toward_the_deck(self):
  def embankment(x,z):return 1+5*max(0,1-abs(x-60)/30)
  roads=[piece('r',[[0,0],[100,0]],0,1,flat),piece('d',[[100,0],[130,0]],1,1,flat)]
  before=copy.deepcopy(roads);report=level_land_approaches(roads,embankment,links=[]);ramp=roads[0];ys=ramp['elevations']
  self.assertEqual([f['road'] for f in report['floored']],['r']);self.assertEqual(roads[1],before[1],'the deck piece above the embankment is untouched')
  self.assertEqual(ys[0],before[0]['elevations'][0]);self.assertEqual(ys[-1],before[0]['elevations'][-1],'landing and deck junction are fixed')
  for i,(p,y) in enumerate(zip(ramp['points'],ys)):
   if 0<i<len(ys)-1:self.assertGreaterEqual(y,embankment(*p)-1e-9,f'point {i} sinks into the embankment')
  self.assertEqual(ys,sorted(ys),'the ramp only climbs toward its deck')
  again=copy.deepcopy(roads);self.assertEqual(level_land_approaches(roads,embankment,links=[])['changedRoads'],[]);self.assertEqual(roads,again)

 def test_a_held_profile_is_pulled_taut_over_a_rough_embankment(self):
  # A 3 m DEM sawtooth under the ramp (the Riverway stub stepped 1.3 m between two points) must not become steps in the deck.
  def rough(x,z):return 1+4*max(0,1-abs(x-50)/35)+(.6 if int(x/3)%2 else 0)
  roads=[piece('r',[[0,0],[100,0]],0,1,flat)];level_land_approaches(roads,rough,links=[]);ramp=roads[0];ys=ramp['elevations'];along=[p[0] for p in ramp['points']]
  for i,(p,y) in enumerate(zip(ramp['points'],ys)):
   if 0<i<len(ys)-1:self.assertGreaterEqual(y,rough(*p)-1e-9)
  grades=[(b-a)/(db-da) for a,b,da,db in zip(ys,ys[1:],along,along[1:])]
  self.assertTrue(all(g2<=g1+1e-3 for g1,g2 in zip(grades,grades[1:])),'the profile is concave: it never steepens again after easing')
  self.assertLess(max(grades),.2,f'no DEM step survives as a deck step: {max(grades):.3f}')

 def test_a_piece_within_the_sink_margin_keeps_its_profile(self):
  roads=[piece('r',[[0,0],[100,0]],0,0,flat)];roads[0]['elevations'][3]=flat(0,0)-(SINK-.01);before=copy.deepcopy(roads)
  self.assertEqual(level_land_approaches(roads,flat,links=[])['changedRoads'],[]);self.assertEqual(roads,before)
  roads[0]['elevations'][3]=flat(0,0)-(SINK+.01);self.assertEqual(level_land_approaches(roads,flat,links=[])['changedRoads'],['r'])
  self.assertGreaterEqual(roads[0]['elevations'][3],flat(0,0))

 def test_a_deck_piece_is_held_over_a_rise_between_its_ends(self):
  def rise(x,z):return 7 if 40<x<60 else 1
  roads=[piece('d',[[0,0],[100,0]],1,1,flat)];level_land_approaches(roads,rise,links=[]);ys=roads[0]['elevations']
  self.assertEqual((ys[0],ys[-1]),(1+DECK,1+DECK));self.assertTrue(all(y>=rise(*p)+TERRAIN_RISE-1e-9 for p,y in list(zip(roads[0]['points'],ys))[1:-1]))


class TownLinks(unittest.TestCase):
 LINK=[{'road':'osm-1-0','way':1,'tail':[[20,30]],'join':'loop'}]

 def test_the_clipped_tail_is_restored_and_snapped_to_the_loop_node(self):
  roads=[street('osm-1-0',[[12,10],[0,-20]],'Unnamed trunk ramp'),street('loop',[[22,36],[50,40]])]
  report=level_land_approaches(roads,flat,links=self.LINK);ramp=roads[0]
  self.assertEqual(report['links'][0]['node'],[22,36]);self.assertEqual(ramp['points'],[[22,36],[20,30],[12,10],[0,-20]])
  self.assertEqual(level_land_approaches(roads,flat,links=self.LINK)['changedRoads'],[],'a joined ramp is left alone')
  roads=[street('osm-1-0',[[0,-20],[12,10]],'Unnamed trunk ramp'),street('loop',[[22,36],[50,40]])]
  level_land_approaches(roads,flat,links=self.LINK);self.assertEqual(roads[0]['points'],[[0,-20],[12,10],[20,30],[22,36]],'the tail attaches at the end nearest it')

 def test_a_tail_beyond_the_snap_or_a_missing_road_is_an_error(self):
  with self.assertRaises(ValueError):restore_links([street('osm-1-0',[[12,10],[0,-20]]),street('loop',[[40,60],[50,70]])],self.LINK)
  with self.assertRaises(ValueError):restore_links([street('osm-1-0',[[12,10],[0,-20]])],self.LINK)


class RecordedSources(unittest.TestCase):
 LINK=[{'road':'osm-1-0','way':1,'tail':[[320,30]],'join':'loop'}]

 def roads(self):
  def gully(x,z):return -1 if 6<x<18 else 1
  def embankment(x,z):return gully(x,z)+5*max(0,1-abs(x-160)/30)
  return embankment,[street('w',[[-40,0],[0,0]]),piece('s',[[0,0],[24,0]],1,0,flat),street('e',[[24,0],[60,0]]),piece('h',[[60,0],[75,0]],1,0,flat),street('h2',[[75,0],[100,0]]),
   piece('r',[[100,0],[200,0]],0,1,flat),piece('d',[[200,0],[230,0]],1,1,flat),street('osm-1-0',[[312,10],[300,-20]]),street('loop',[[322,36],[350,40]])]

 def test_records_restore_the_source_profiles_and_a_rerun_redoes_the_same_repairs(self):
  ground,roads=self.roads();source=copy.deepcopy(roads);report=level_land_approaches(roads,ground,links=self.LINK)
  self.assertEqual(sorted(report['changedRoads']),['h','osm-1-0','r','s']);self.assertTrue(report['seams'][0]['source']['elevations']);self.assertEqual(report['links'][0]['points'],[[322,36],[320,30]])
  installed=copy.deepcopy(roads);restore_sources(roads,report);self.assertEqual(roads,source,'the records put every road back to its source profile')
  again=level_land_approaches(roads,ground,links=self.LINK);self.assertEqual(roads,installed);self.assertEqual(again,report)

 def test_a_record_that_no_longer_fits_its_road_is_rejected(self):
  ground,roads=self.roads();report=level_land_approaches(roads,ground,links=self.LINK)
  stale=copy.deepcopy(report);stale['floored'][0]['source']=stale['floored'][0]['source'][:-1]
  with self.assertRaises(ValueError):restore_sources(copy.deepcopy(roads),stale)
  stale=copy.deepcopy(report);stale['links'][0]['points']=[[322,36],[321,30]]
  with self.assertRaises(ValueError):restore_sources(copy.deepcopy(roads),stale)
  with self.assertRaises(ValueError):restore_sources([r for r in copy.deepcopy(roads) if r['id']!='h'],report)


class ShippedPackage(unittest.TestCase):
 def test_the_installed_package_is_levelled_and_the_interchange_is_whole(self):
  city=json.loads((ROOT/'public/data/city.json').read_text());grid=city['elevation']
  heights=np.frombuffer(gzip.decompress((ROOT/'public/data'/grid['file']).read_bytes()),dtype='<i2')*grid.get('scale',.01);ground=grid_sampler(grid,heights)
  polygons,water_level=water_inputs(city);water=level_water_crossings(city['roads'],polygons,ground,water_level,apply=False)
  report=level_land_approaches(city['roads'],ground,water_chain_ids(water),apply=False,profile_excluded=levelled_water_ids(water))
  self.assertEqual(report['changedRoads'],[],'the installed package must already be levelled')
  roads={r['id']:r for r in city['roads']}
  for id in ('14547-0-0','14549-0-0'):self.assertNotIn('elevations',roads[id],'Huntington Avenue meets Washington Street on the ground')
  for id in ('8693-0-0','9074-0-0','25551-0-0','25558-0-0'):
   road=roads[id]
   for i,(p,y) in enumerate(zip(road['points'],road['elevations'])):
    if 0<i<len(road['points'])-1:self.assertGreaterEqual(y,ground(*p)-.002,f'{id} point {i} sits in its embankment')
  ramp=roads['osm-48918271-0'];loop=roads['8686-0-0'];self.assertEqual(ramp['points'][0],loop['points'][-1],'the Pond Avenue ramp reaches the Jamaicaway loop')
  for id in ('16746-0-0','25549-0-0'):self.assertEqual((roads[id]['startLevel'],roads[id]['endLevel']),(0,0));self.assertLess(abs(roads[id]['elevations'][0]-ground(*roads[id]['points'][0])),.002)
  provenance=json.loads((ROOT/'public/data/provenance.json').read_text())['landApproaches']
  self.assertEqual(sorted(s['road'] for s in provenance['seams']),['14547-0-0','14549-0-0','16746-0-0','25549-0-0']);self.assertEqual([l['road'] for l in provenance['links']],[l['road'] for l in TOWN_LINKS])
  replay=copy.deepcopy(city['roads']);restore_sources(replay,provenance);replayed=level_land_approaches(replay,ground,water_chain_ids(water),profile_excluded=levelled_water_ids(water))
  for key in ('seams','floored','links'):self.assertEqual([{k:v for k,v in e.items() if k!='way'} for e in provenance[key]],replayed[key],f'the recorded {key} are exactly what a replay from their sources produces')
  by={r['id']:r for r in replay}
  for id in replayed['changedRoads']:self.assertEqual(by[id],roads[id],f'{id} replays to the installed road')


if __name__=='__main__':unittest.main()
