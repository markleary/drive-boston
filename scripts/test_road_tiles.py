"""Road deck edges crossing tile boundaries must also stream their tile."""
import gzip,json,pathlib,struct,tempfile,unittest
import numpy as np
from road_tiles import refresh_road_tiles
from tileformat import write_tile


def unpack(path):
 raw=gzip.decompress(path.read_bytes());size=struct.unpack_from('<I',raw,4)[0]
 return json.loads(raw[8:8+size]),raw[(8+size+3)//4*4:]


class RoadTilesTest(unittest.TestCase):
 def test_edge_ownership_and_stable_mesh_payload(self):
  with tempfile.TemporaryDirectory() as temporary:
   data=pathlib.Path(temporary);path=data/'tiles/t_0_0.bin'
   header={'tx':0,'tz':0,'size':1000,'buildings':[{'id':'test','anchor':[0,0,0]}],'curbs':[],'parkPaths':[],'roads':['old-road','untouched']}
   record=(np.array([[0,0,0],[100,0,0],[0,0,100]],dtype=np.int16),np.empty((0,3),dtype=np.uint32),np.array([[0,1,2]],dtype=np.uint32),.01)
   write_tile(path,header,[record]);before=unpack(path)[1]
   city={'tiles':{'size':1000,'keys':['0_0']}}
   # The road centerline stays in tile 0; only its widened edge reaches tile 1.
   road={'id':'crossing','points':[[994,300],[994,400]],'width':7,'deckWidths':[18,18]}
   changed=refresh_road_tiles(data,city,[road],['old-road'])
   self.assertEqual(changed,['0_0','1_0']);self.assertEqual(city['tiles']['keys'],['0_0','1_0'])
   self.assertEqual(unpack(path)[0]['roads'],['crossing','untouched']);self.assertEqual(unpack(path)[1],before)
   self.assertEqual(unpack(data/'tiles/t_1_0.bin')[0]['roads'],['crossing'])
   self.assertEqual(refresh_road_tiles(data,city,[road],['old-road']),[])


if __name__=='__main__':unittest.main()
