import json,pathlib,tempfile,unittest
import numpy as np
from charlestown_survey import REVIEWED,retire_southbound_shell
from museum_survey import duplicate_components
from i93_north import SurveyMesh,SURVEY_ID,ramp_plans
from tileformat import mesh_record,write_tile


class CharlestownSurveyTest(unittest.TestCase):
 def fixture(self):
  count,lo,hi=REVIEWED[0]
  vertices=np.array([lo,hi,[lo[0],hi[1],hi[2]],[-200,32,-3700],[-180,32,-3700],[-190,32,-3680]],float)
  faces=np.array([[0,1,2]]*count+[[3,4,5]])
  return vertices,faces

 def test_only_the_reviewed_component_is_removed_even_with_a_deck_at_the_same_height(self):
  v,f=self.fixture();removed,components=duplicate_components(v,f,REVIEWED,'Charlestown')
  self.assertEqual(int(removed.sum()),980);self.assertFalse(removed[-1]);self.assertEqual(len(components),1)
  with self.assertRaises(AssertionError):duplicate_components(v,f[1:],REVIEWED,'Charlestown')
  with self.assertRaises(AssertionError):duplicate_components(v,np.vstack([f,[0,3,4]]),REVIEWED,'Charlestown')

 def test_removal_is_recorded_and_replays_without_changing_tile_bytes(self):
  v,f=self.fixture()
  with tempfile.TemporaryDirectory() as temporary:
   data=pathlib.Path(temporary);(data/'tiles').mkdir();path=data/'tiles/t_0_0.bin'
   header={'tx':0,'tz':0,'size':1000,'buildings':[{'id':SURVEY_ID,'anchor':[0,0,-3000],'baseElevation':0.,'structure':True}],'curbs':[],'parkPaths':[],'roads':[]}
   write_tile(path,header,[mesh_record(v,f,[0,0,-3000],0.,repair_winding=False)])
   city={'landmarkBuildings':[{'id':SURVEY_ID,'center':[0,0]}],'tiles':{'size':1000,'directory':'tiles'}}
   mesh=SurveyMesh(data,city);mark=retire_southbound_shell(mesh);mesh.write();before=path.read_bytes()
   self.assertEqual(len(mesh.triangles()),1,'the unrelated upper deck stays')
   again=SurveyMesh(data,city);self.assertEqual(retire_southbound_shell(again),mark);again.write()
   self.assertEqual(path.read_bytes(),before);self.assertIsNone(again.geometry)

 def test_real_exit_follows_its_westward_motorway_sources_and_existing_connector(self):
  source=json.loads((pathlib.Path(__file__).resolve().parents[1]/'public/data/i93-north-source.json').read_text())
  ways={w['id']:w for w in source['ways']};plan=next(p for p in ramp_plans(ways,source['survey']) if p.id=='i93-sb-exit-18')
  self.assertEqual(plan.points[0],[-180.652,-3739.15]);self.assertEqual(plan.points[-1],[329.783,-2592.463])
  self.assertLess(min(p[0] for p in plan.points),-245,'the mapped exit bows west over the rail yard')
  self.assertGreater(plan.along[-1],1300);self.assertTrue(plan.spec['viaduct'])
  self.assertEqual({ways[w]['tags']['highway'] for w in plan.owner},{'motorway'})


if __name__=='__main__':unittest.main()
