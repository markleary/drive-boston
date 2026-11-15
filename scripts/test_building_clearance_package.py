"""Package updates must track road edits without losing legacy collision policy."""
import copy,gzip,io,json,pathlib,struct,tempfile,unittest,zipfile
import numpy as np
import tileformat
from building_clearance_package import prepare_buildings,prepare_package


LEGACY='BOS-KBIA4-2XA04-WNETP'


def building(identifier,x):
 return {'id':identifier,'name':identifier,'center':[x,10],'height':10,'baseElevation':0,
         'footprint':[[x-10,0],[x+10,0],[x+10,20],[x-10,20]],'anchor':[x,0,10]}


def record(entry):
 x=entry['center'][0]
 return tileformat.mesh_record([[x-10,0,0],[x+10,0,0],[x+10,10,0],[x-10,10,0]],[[0,1,2],[0,2,3]],entry['anchor'],0)


def far_data():
 header=json.dumps({'size':1000,'tiles':[{'key':'0_0','offset':0,'count':4}]},separators=(',',':')).encode()
 raw=bytearray(b'DBF2'+struct.pack('<I',len(header))+header);raw.extend(b'\0'*((-len(raw))%4))
 for flags in [5,13,7,15]:
  raw.extend(struct.pack('<HHhBB',4,1000,0,flags,3))
  for x,z in [(0,0),(200,0),(200,200),(0,200)]:raw.extend(struct.pack('<hh',x,z))
 return raw


def flags(data_dir):
 raw=gzip.decompress((data_dir/'far.bin').read_bytes());length=struct.unpack_from('<I',raw,4)[0]
 offset=8+length;offset+=(-offset)%4;out=[]
 for _ in range(4):
  count=struct.unpack_from('<H',raw,offset)[0];out.append(raw[offset+6]);offset+=8+count*4
 return out


def snapshot(data_dir):
 return {str(p.relative_to(data_dir)):p.read_bytes() for p in data_dir.rglob('*') if p.is_file()}


class BuildingClearancePackageTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.path=pathlib.Path(self.temp.name)
  self.entries=[building('over-road',20),building(LEGACY,100)]
  self.road={'id':'street','name':'Street','width':8,'points':[[0,10],[40,10]]}
  self.city={'tiles':{'keys':['0_0'],'directory':'tiles','far':'far.bin'},'roads':[self.road],
             'landmarkBuildings':copy.deepcopy(self.entries)}
  self.write_city()
  header={'tx':0,'tz':0,'size':1000,'buildings':copy.deepcopy(self.entries),'curbs':[],'parkPaths':[],'roads':['street']}
  tileformat.write_tile(self.path/'tiles/t_0_0.bin',header,[record(b) for b in self.entries])
  tileformat.write_gzip(self.path/'far.bin',far_data())

 def write_city(self):
  (self.path/'city.json').write_text(json.dumps(self.city,separators=(',',':'))+'\n')

 def test_road_edit_clears_generated_flags_and_landmarks_but_preserves_legacy_and_fragment_bits(self):
  prepare_package(self.path)
  self.assertEqual(flags(self.path),[7,15,7,15])
  self.city=json.loads((self.path/'city.json').read_text())
  self.assertEqual(self.city['landmarkBuildings'][0]['collision'],'mesh')
  self.city['roads']=[];self.write_city();prepare_package(self.path)
  header,_=tileformat.read_tile(self.path/'tiles/t_0_0.bin')
  self.assertNotIn('collision',header['buildings'][0]);self.assertNotIn('roadOverlaps',header['buildings'][0])
  self.assertEqual(flags(self.path),[5,13,7,15],'clear both primary/fragment exact flags without changing landmark or hidden bits')
  city=json.loads((self.path/'city.json').read_text());self.assertNotIn('collision',city['landmarkBuildings'][0])
  before=snapshot(self.path);result=prepare_package(self.path)
  self.assertEqual(result['changedTiles'],[]);self.assertFalse(result['farChanged']);self.assertEqual(snapshot(self.path),before)

 def test_repeated_update_is_byte_identical_to_fresh_compiler_metadata(self):
  prepare_package(self.path);before=snapshot(self.path);result=prepare_package(self.path)
  self.assertEqual(result['changedTiles'],[]);self.assertEqual(snapshot(self.path),before)
  entries=copy.deepcopy(self.entries);geometry=[record(b) for b in entries]
  prepare_buildings(entries,geometry,[self.road])
  header={'tx':0,'tz':0,'size':1000,'buildings':entries,'curbs':[],'parkPaths':[],'roads':['street']}
  fresh=self.path/'fresh.bin';tileformat.write_tile(fresh,header,geometry)
  self.assertEqual(fresh.read_bytes(),(self.path/'tiles/t_0_0.bin').read_bytes())

 def test_a_building_over_a_highway_record_takes_exact_collision_from_the_stage_record(self):
  # build-boston-highways.py lists the buildings whose convex proxy would stand in one of its roads; no surface street says so.
  self.city['roads']=[];self.write_city()
  (self.path/'provenance.json').write_text(json.dumps({'bostonHighways':{'buildings':{'mesh':[{'id':'over-road','tile':'0_0','roads':['i90-wb']}],'passages':[],'removed':[]}}}))
  prepare_package(self.path);header,_=tileformat.read_tile(self.path/'tiles/t_0_0.bin');entry=header['buildings'][0]
  self.assertEqual((entry['collision'],entry['highwayOverlaps']),('mesh',['i90-wb']));self.assertNotIn('roadOverlaps',entry);self.assertEqual(flags(self.path)[:2],[7,15],'and its far proxy is exact')
  before=snapshot(self.path);self.assertEqual(prepare_package(self.path)['changedTiles'],[]);self.assertEqual(snapshot(self.path),before,'a rerun changes nothing')
  (self.path/'provenance.json').write_text(json.dumps({'bostonHighways':{'buildings':{'mesh':[],'passages':[],'removed':[]}}}));prepare_package(self.path)
  entry=tileformat.read_tile(self.path/'tiles/t_0_0.bin')[0]['buildings'][0];self.assertNotIn('collision',entry);self.assertNotIn('highwayOverlaps',entry)
  self.assertEqual(flags(self.path)[:2],[5,13],'the flag goes when the stage no longer lists the building')

 def source_shell(self):
  """A retained survey cube, deliberately higher in the source vertical datum."""
  entry=self.entries[0];entry.update(source='boston-obj',norm={'min':7.,'max':17.,'ground':7.,'catalogGround':7.,'policy':'catalog-metres-and-source-floor'})
  vertices=np.asarray([[x,y,z] for y in (0,10) for x,z in ((10,0),(30,0),(30,20),(10,20))],dtype=float)
  faces=np.asarray([[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]])
  raw=''.join(f'v {x/(1200/3937)+40000:.15f} {50000-z/(1200/3937):.15f} {(y+7)/(1200/3937):.15f}\n' for x,y,z in vertices)
  raw+=''.join('f '+' '.join(str(int(i)+1) for i in f)+'\n' for f in faces)
  nested=io.BytesIO()
  with zipfile.ZipFile(nested,'w') as archive:archive.writestr('over-road.obj',raw)
  cache=self.path/'sources';cache.mkdir()
  with zipfile.ZipFile(cache/'A1-models.zip','w') as archive:
   archive.writestr('catalog.csv','Model_ID\nover-road\n');archive.writestr('objz/over-road_OBJ.zip',nested.getvalue())
  header,_=tileformat.read_tile(self.path/'tiles/t_0_0.bin');header['buildings']=copy.deepcopy(self.entries)
  tileformat.write_tile(self.path/'tiles/t_0_0.bin',header,[tileformat.mesh_record(vertices,faces,entry['anchor'],0),record(self.entries[1])])
  return cache

 def passage(self,ceiling):
  cut={'building':'over-road','road':'highway','start':[0,10],'end':[40,10],'left':-3.,'right':3.,'ceiling':ceiling,'ceilingEnd':ceiling}
  (self.path/'provenance.json').write_text(json.dumps({'bostonHighways':{'buildings':{'mesh':[],'passages':[cut] if ceiling is not None else []}}}))

 def test_changed_and_retired_passages_rebuild_from_exact_retained_source(self):
  cache=self.source_shell();pristine=(self.path/'tiles/t_0_0.bin').read_bytes()
  self.passage(5.);prepare_package(self.path,cache)
  self.passage(2.);result=prepare_package(self.path,cache)
  self.assertEqual(result['restoredPassages'],['over-road'])
  revised=(self.path/'tiles/t_0_0.bin').read_bytes()
  # A lower ceiling must put the old void back before cutting the new one.
  (self.path/'tiles/t_0_0.bin').write_bytes(pristine);prepare_package(self.path,cache)
  self.assertEqual((self.path/'tiles/t_0_0.bin').read_bytes(),revised)
  before=snapshot(self.path);self.assertEqual(prepare_package(self.path,cache)['restoredPassages'],[]);self.assertEqual(snapshot(self.path),before)
  self.passage(None);result=prepare_package(self.path,cache)
  self.assertEqual(result['restoredPassages'],['over-road'])
  restored=(self.path/'tiles/t_0_0.bin').read_bytes();entry=tileformat.read_tile(self.path/'tiles/t_0_0.bin')[0]['buildings'][0]
  self.assertNotIn('buildingPassage',entry);self.assertEqual(entry['name'],'over-road');self.assertEqual(entry['norm'],self.entries[0]['norm'])
  (self.path/'tiles/t_0_0.bin').write_bytes(pristine);prepare_package(self.path,cache)
  self.assertEqual((self.path/'tiles/t_0_0.bin').read_bytes(),restored,'retired passages leave the same full source shell and collision metadata as a fresh package')

 def test_missing_or_changed_retained_source_fails_before_package_writes(self):
  cache=self.source_shell();self.passage(5.);prepare_package(self.path,cache);self.passage(2.)
  before=snapshot(self.path)
  with self.assertRaisesRegex(ValueError,'retained survey model is missing'):prepare_package(self.path,self.path/'missing')
  self.assertEqual(snapshot(self.path),before)
  header,records=tileformat.read_tile(self.path/'tiles/t_0_0.bin');header['buildings'][0]['norm']['max']=18.
  tileformat.write_tile(self.path/'tiles/t_0_0.bin',header,[(np.rint((b['positions']-np.asarray(b['anchor']))/.01).astype(np.int16),b['facade'],b['roof'],.01) for b in records])
  before=snapshot(self.path)
  with self.assertRaisesRegex(ValueError,'heights do not match'):prepare_package(self.path,cache)
  self.assertEqual(snapshot(self.path),before)

 def test_retired_cut_preserves_independent_source_collision(self):
  cache=self.source_shell();self.city['roads']=[];self.write_city()
  header,geometry=tileformat.read_tile(self.path/'tiles/t_0_0.bin');header['buildings'][0]['collision']='mesh'
  tileformat.write_tile(self.path/'tiles/t_0_0.bin',header,[(np.rint((b['positions']-np.asarray(b['anchor']))/.01).astype(np.int16),b['facade'],b['roof'],.01) for b in geometry])
  self.passage(5.);prepare_package(self.path,cache)
  entry=tileformat.read_tile(self.path/'tiles/t_0_0.bin')[0]['buildings'][0]
  self.assertEqual(entry['buildingPassage']['sourceCollision'],'mesh')
  self.passage(None);prepare_package(self.path,cache)
  entry=tileformat.read_tile(self.path/'tiles/t_0_0.bin')[0]['buildings'][0]
  self.assertNotIn('buildingPassage',entry);self.assertEqual(entry['collision'],'mesh');self.assertEqual(flags(self.path)[:2],[7,15])


if __name__=='__main__':unittest.main()
