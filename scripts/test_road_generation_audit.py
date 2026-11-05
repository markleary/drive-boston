import copy,gzip,json,pathlib,subprocess,sys,tempfile,unittest
from road_generation_audit import regressions

class RegressionGate(unittest.TestCase):
 def test_known_issues_cannot_hide_new_or_worse_profiles(self):
  baseline={'remainingProfiles':[{'road':'a','maxGrade':.2,'gradePoint':[1,2],'unpavedTerrainIntrusion':{'depth':0}}]}
  self.assertEqual(regressions(baseline,baseline),[])
  self.assertEqual(regressions({'remainingProfiles':[]},baseline),[])
  for field,value in [('road','b'),('maxGrade',.25),('gradePoint',[2,3]),('unpavedTerrainIntrusion',{'depth':.2})]:
   candidate=copy.deepcopy(baseline);candidate['remainingProfiles'][0][field]=value
   self.assertTrue(regressions(candidate,baseline),field)

 def test_new_constraint_conflicts_fail_the_gate(self):
  baseline={'remainingProfiles':[],'fixedConstraintConflicts':[{'roads':['a'],'excess':1}]}
  candidate=copy.deepcopy(baseline);candidate['fixedConstraintConflicts'][0]['excess']=2
  self.assertTrue(regressions(candidate,baseline))
  candidate['fixedConstraintConflicts'][0]={'roads':['b'],'excess':1}
  self.assertTrue(regressions(candidate,baseline))


class StrictGate(unittest.TestCase):
 def run_audit(self,conflicts,*flags):
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory)
   city={'tiles':{'keys':[]},'elevation':{'file':'elevation.bin','width':2,'height':2,'cellSize':100,'originX':0,'originZ':0},
    'roads':[{'id':'deck','name':'Example','points':[[20,20],[80,20]],'width':8,'elevations':[6,6],'bridge':{'id':'structure-deck','kind':'elevated'}}]}
   (root/'city.json').write_text(json.dumps(city));(root/'elevation.bin').write_bytes(gzip.compress(bytes(8)))
   (root/'provenance.json').write_text(json.dumps({'landApproaches':{'unresolvedProfiles':conflicts}}))
   (root/'baseline.json').write_text(json.dumps({'remainingProfiles':[],'fixedConstraintConflicts':conflicts}))
   command=[sys.executable,str(pathlib.Path(__file__).with_name('audit-road-generation.py')),'--data-dir',str(root),'--output',str(root/'report.json'),*flags]
   result=subprocess.run(command,cwd=root,capture_output=True,text=True)
   report=json.loads((root/'report.json').read_text())
   self.assertEqual(report['remainingProfiles'],[],'fixture must have clean sampled profiles')
   self.assertEqual(report['fixedConstraintConflicts'],conflicts)
   return result

 def test_strict_rejects_constraint_only_conflicts_even_with_a_known_baseline(self):
  conflicts=[{'roads':['deck'],'reason':'clearance exceeds the fixed-landing envelope','excess':1}]
  for flags in [('--strict',),('--strict','--baseline','baseline.json')]:
   with self.subTest(flags=flags):
    result=self.run_audit(conflicts,*flags)
    self.assertNotEqual(result.returncode,0)
    self.assertIn('constraint',result.stderr)

 def test_strict_accepts_a_clean_report(self):
  result=self.run_audit([],'--strict')
  self.assertEqual(result.returncode,0,result.stderr)

 def test_baseline_mode_still_accepts_known_constraint_conflicts(self):
  result=self.run_audit([{'roads':['deck'],'excess':1}],'--baseline','baseline.json')
  self.assertEqual(result.returncode,0,result.stderr)

if __name__=='__main__':unittest.main()
