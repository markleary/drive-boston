import unittest
import numpy as np
from museum_survey import duplicate_components,REVIEWED
import boston_highways as H


class MuseumSurveyTest(unittest.TestCase):
 def fixture(self):
  vertices=[];faces=[]
  for count,low,high in REVIEWED:
   i=len(vertices);vertices.extend([low,high,[low[0],high[1],high[2]]]);faces.extend([[i,i+1,i+2]]*count)
  # Unrelated upper structure shares the same XY and height envelope.
  i=len(vertices);vertices.extend([[700,30,-1800],[720,32,-1800],[710,31,-1820]]);faces.append([i,i+1,i+2])
  return np.array(vertices,float),np.array(faces)

 def test_reviewed_lower_components_go_but_upper_structure_at_same_xy_stays(self):
  vertices,faces=self.fixture();removed,groups=duplicate_components(vertices,faces)
  self.assertEqual(int(removed.sum()),2656)
  self.assertFalse(removed[-1]);self.assertEqual(len(groups),11)

 def test_a_welded_or_changed_survey_is_refused(self):
  vertices,faces=self.fixture()
  with self.assertRaises(AssertionError):duplicate_components(vertices,faces[1:])

 def test_reviewed_existing_deck_join_preserves_vertex_and_tapers_width(self):
  parent={'id':'parent','points':[[95,2],[110,2]],'elevations':[8,9],'width':10,'deckWidths':[10,10]}
  source={'features':[{'id':1,'points':[[0,0],[100,0]],'from':0,'to':0,'name':'','cfcc':'A60'}],'ways':[]}
  city={'roads':[parent],'coverage':[[[-50,-50],[150,-50],[150,50],[-50,50]]]}
  spec=H.SR('test','Storrow Drive Test',[1],width=7,join={'end':'parent'})
  plan=H.plans_of(source,city,[spec])[0]
  self.assertEqual(plan.points[-1],[95,2]);self.assertEqual(plan.widths[-1],10)
  self.assertEqual(plan.widths[0],7);self.assertEqual(parent['points'][0],[95,2])
  self.assertTrue(all(abs(a-b)<.11*(t-s) for a,b,s,t in zip(plan.widths,plan.widths[1:],plan.along,plan.along[1:])))

if __name__=='__main__':unittest.main()
