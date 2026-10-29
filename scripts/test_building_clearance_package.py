"""Package updates must track road edits without losing legacy collision policy."""
import copy,gzip,json,pathlib,struct,tempfile,unittest
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


if __name__=='__main__':unittest.main()
