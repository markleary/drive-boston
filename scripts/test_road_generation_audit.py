import copy,unittest
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

if __name__=='__main__':unittest.main()
