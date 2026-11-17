import copy,json,pathlib,unittest
import numpy as np
from shapely.geometry import box
import charles_dam as D
from water_crossings import grid_sampler,level_water_crossings,water_inputs

ROOT=pathlib.Path(__file__).resolve().parents[1];DATA=ROOT/'public/data'


def dam(crest=2.,low=0.,lock=(96,114)):
 """A 240 m dam along x with a 30 m crest, a lock through it and low ground at both ends: (roads, grid, int16 heights, water)."""
 grid={'width':81,'height':41,'cellSize':6,'originX':-120,'originZ':-120,'scale':.01};h=np.full((41,81),-300,dtype='<i2')
 for j in range(41):
  for i in range(81):
   x=-120+i*6;z=-120+j*6
   if 0<=x<=240 and -18<=z<=24 and not lock[0]<x<lock[1]:h[j,i]=round((low+(crest-low)*D.smooth(min(x,240-x)/40))*100)
   if x<0 or x>240:h[j,i]=round(low*100)
 road=lambda i,x0,x1,z,**more:{'id':i,'name':'Charles River','width':10,'oneway':1,'points':[[x0,z],[(x0+x1)/2,z],[x1,z]],**more}
 deck=lambda n:{'elevations':[2.5]*n,'bridge':{'id':'structure','kind':'elevated','thickness':.75},'startLevel':1,'endLevel':1}
 # Travel toward Cambridge runs to -x here, so downstream, its right, is -z.
 north=[road(i,240-60*k,180-60*k,0,**(deck(3) if k in (1,2) else {})) for k,i in enumerate(D.NORTHBOUND)]
 south=[road(i,60*k,60+60*k,9,**(deck(3) if k in (1,2) else {})) for k,i in enumerate(D.SOUTHBOUND)]
 more=[{'id':D.CONTINUATION,'name':'Charles River Dam Road','width':16,'points':[[0,0],[-30,0]]},{'id':D.LINK,'name':'Charles River Dam Road','width':10,'oneway':1,'points':[[-30,0],[0,9]]},
  {'id':'8477-0-0','name':'Science','width':7,'points':[[150,29],[190,29],[196,60]]},{'id':'8427-0-0','name':'Science','width':7,'points':[[150,9],[150,29]]},{'id':'14681-0-0','name':'Science','width':7,'points':[[150,29],[60,29]]},
  {'id':'far','name':'Elsewhere','width':10,'points':[[-100,80],[100,80]]}]
 water=[box(-120,-120,360,-18.5),box(lock[0],-120,lock[1],120)]
 return north+south+more,grid,h.reshape(-1),water


class CharlesDamTests(unittest.TestCase):
 def test_the_lock_is_bridged_and_the_profile_is_smooth_between_held_ends(self):
  roads,grid,heights,water=dam();record,result,out=D.build(roads,grid,heights,water);profile=record['profile']
  self.assertTrue(90<min(profile['openings'])<max(profile['openings'])<156,'only the lock is an opening')
  self.assertAlmostEqual(profile['heights'][0],0,2);self.assertAlmostEqual(profile['heights'][-1],0,2)
  step=profile['stepMeters'];mid=[h for i,h in enumerate(profile['heights']) if 80<i*step<170]
  self.assertGreater(min(mid),1.8,'no dip into the lock');self.assertLess(record['steepestGrade'],.06)
  counts=D.check(out,grid,result,record);self.assertLessEqual(counts['offLevel'],D.LEVEL)

 def test_every_piece_becomes_a_named_surface_street_and_nothing_else_changes(self):
  roads,grid,heights,water=dam();before=copy.deepcopy(roads);record,result,out=D.build(roads,grid,heights,water)
  self.assertEqual(roads,before,'the input roads are not edited')
  by_id={r['id']:r for r in out}
  for i in D.NORTHBOUND+D.SOUTHBOUND:
   self.assertFalse(any(f in by_id[i] for f in D.DECK_FIELDS));self.assertEqual(by_id[i]['name'],'Charles River Dam Road')
  for i in D.RENAMED:self.assertEqual(by_id[i]['name'],'Science Park')
  for i in (D.NORTHBOUND[1],D.SOUTHBOUND[2]):self.assertEqual(len(by_id[i]['points']),2,'the profile station on a straight deck is gone')
  self.assertEqual(by_id['far'],before[-1]);self.assertEqual(len(record['roads']['sources']),11)
  self.assertEqual(sum('elevations' in r for r in record['roads']['sources']),4)

 def test_a_street_keeps_its_ends_its_bends_and_the_vertices_other_roads_share(self):
  line=[[0,0],[3,0],[6,0],[9,0.01],[12,0],[15,2],[18,4],[21,6]]
  self.assertEqual(D.source_vertices(line),[[0,0],[12,0],[21,6]])
  self.assertEqual(D.source_vertices(line,{D.vertex([6,0])}),[[0,0],[6,0],[12,0],[21,6]])
  self.assertEqual(D.source_vertices([[0,0],[5,0]]),[[0,0],[5,0]])

 def test_the_crest_is_level_across_both_roadways_and_sidewalks_and_ends_in_a_wall_at_the_water(self):
  roads,grid,heights,water=dam();record,result,out=D.build(roads,grid,heights,water);ground=grid_sampler(grid,result*.01)
  for x in (60,105,150,200):
   across=[ground(x,z) for z in np.arange(-10,18,1.)]
   self.assertLess(max(across)-min(across),.02,f'level from sidewalk to sidewalk at x={x}')
  self.assertGreater(ground(105,0),1.9,'the lock is filled under the road')
  self.assertEqual(ground(105,60),-3,'and stays open beside it');self.assertEqual(ground(60,-40),-3,'no shoulder into the water');self.assertEqual(ground(60,-26),-3,'nothing filled where the viaduct stands')

 def test_a_street_beside_the_crest_is_raised_level_across(self):
  roads,grid,heights,water=dam(crest=2.);flat=heights.reshape(41,81)
  # The Museum's drive lies 0.8 m under the crest, 20 m from the Boston-bound line.
  for j in range(41):
   for i in range(81):
    if -120+j*6>=24:flat[j,i]=120 if 0<=-120+i*6<=240 else flat[j,i]
  record,result,out=D.build(roads,grid,heights,water);ground=grid_sampler(grid,result*.01)
  self.assertGreater(record['terrain']['streetVertices'],0)
  for x in (165,175,185):self.assertLess(abs(ground(x,26)-ground(x,32)),.15,'the drive is not tilted toward the dam by the 0.8 m between them')
  self.assertGreater(ground(175,29),1.25,'and comes up toward the crest');self.assertAlmostEqual(ground(196,58),1.2,1)

 def test_a_rerun_restores_its_originals_and_writes_the_same_package(self):
  roads,grid,heights,water=dam();record,result,out=D.build(roads,grid,heights,water)
  self.assertTrue(D.replay(out,grid,result,record,water))
  back=copy.deepcopy(out);values=result.copy();D.restore(back,values,record)
  self.assertEqual(back,roads);self.assertTrue(np.array_equal(values,heights))
  later=copy.deepcopy(out);later[0]['pavedWidth']=11.2
  self.assertTrue(D.replay(later,grid,result,record,water),'a width measured by a later stage is not this stage\'s')

 def test_a_rerun_on_a_finished_package_keeps_what_later_stages_added(self):
  roads,grid,heights,water=dam();record,result,out=D.build(roads,grid,heights,water)
  # The surface stage measures every piece afterwards, the former decks among them.
  finished=copy.deepcopy(out)
  for road in finished:
   if road['id'] in D.NORTHBOUND+D.SOUTHBOUND:road['pavedWidth']=19.5
  again=copy.deepcopy(finished);values=result.copy();D.restore(again,values,record)
  self.assertTrue(all(r['pavedWidth']==19.5 for r in again if r['id'] in D.NORTHBOUND+D.SOUTHBOUND),'restoring a source keeps the measured width')
  self.assertIn('elevations',next(r for r in again if r['id']==D.NORTHBOUND[1]));self.assertTrue(np.array_equal(values,heights))
  record2,result2,out2=D.build(again,grid,values,water)
  self.assertEqual(out2,finished,'the rerun writes the finished roads back, widths included')
  self.assertEqual([list(r) for r in out2],[list(r) for r in finished],'in the same key order, so city.json is the same file')
  self.assertEqual(record2,record,'and the same record');self.assertTrue(np.array_equal(result2,result))
  self.assertTrue(all(set(r)<={'id',*D.OWNED} for r in record['roads']['sources']),'a source holds only what the stage decides')
  moved=result.copy();moved[record['terrain']['vertices'][0]]+=7
  self.assertFalse(D.replay(out,grid,moved,record,water))

 def test_the_water_stage_finds_no_crossing_on_the_dam(self):
  roads,grid,heights,water=dam();record,result,out=D.build(roads,grid,heights,water)
  report=level_water_crossings(out,water,grid_sampler(grid,result*.01),apply=False)
  self.assertEqual(report['chains'],[]);self.assertEqual(report['changedRoads'],[])

 def test_installed_package(self):
  city=json.loads((DATA/'city.json').read_text())
  if not D.applies(city['roads']):self.skipTest('no dam road in this package')
  record=json.loads((DATA/'provenance.json').read_text()).get('charlesRiverDam');self.assertTrue(record,'run build-charles-dam.py');grid=city['elevation'];heights=D.load_grid(DATA/grid['file'])
  counts=D.check(city['roads'],grid,heights,record);self.assertEqual(counts['pieces'],8)
  self.assertTrue(D.replay(city['roads'],grid,heights,record,water_inputs(city)[0]))
  self.assertEqual(sum('elevations' in r for r in record['roads']['sources']),5)
  self.assertTrue(all(r['name']==D.NAME for r in city['roads'] if r['id'] in D.NORTHBOUND+D.SOUTHBOUND))


if __name__=='__main__':unittest.main()
