import copy,importlib.util,pathlib,unittest

spec=importlib.util.spec_from_file_location('museum_roads',pathlib.Path(__file__).with_name('repair-museum-roads.py'))
M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)


class MuseumRoadOrderingTest(unittest.TestCase):
 def fixture(self):
  return {'roads':[
   {'id':'14555-0-0','points':[[0.,-50.],[0.,0.]],'width':8},
   {'id':'14556-0-0','points':[[3.,0.],[3.,-50.]],'width':8},
   {'id':M.DAM,'name':'Dam road','kind':'trunk','points':[[0.,0.],[0.,50.],[0.,100.]],'width':10,'pavedWidth':10},
  ]}

 def test_rerun_keeps_links_before_a_later_highway_stage(self):
  city=self.fixture();M.repair(city)
  city['roads'].extend([{'id':'i93-nb-01','points':[[50,0],[50,100]]},{'id':'i93-sb-01','points':[[60,100],[60,0]]}])
  before=copy.deepcopy(city)
  M.repair(city)
  self.assertEqual(city,before,'a repeated repair preserves both source geometry and road order across later stages')

 def test_only_a_missing_link_is_appended(self):
  city=self.fixture();M.repair(city)
  city['roads']=[r for r in city['roads'] if r['id']!=M.LINK]
  city['roads'].append({'id':'later-road','points':[[20,0],[20,10]]})
  before=[r['id'] for r in city['roads']]
  M.repair(city)
  self.assertEqual([r['id'] for r in city['roads']],before+[M.LINK])
  self.assertEqual(sum(r['id']==M.NORTH_LINK for r in city['roads']),1)


if __name__=='__main__':unittest.main()
