"""Back Street must remain a local road separated from Storrow's asphalt."""
import copy,json,pathlib,unittest
import numpy as np
from shapely.geometry import LineString,Point,Polygon
from shapely.ops import unary_union
from reviewed_road_inputs import reviewed_streets,restore_street_sources
from street_surfaces import unpack,encode_edges,decode_edges

ROOT=pathlib.Path(__file__).resolve().parents[1]


class BackStreet(unittest.TestCase):
 def test_verge_preserves_crossing_and_can_be_rebuilt_or_removed(self):
  roads=[{'id':'back','width':7,'points':[[0,10],[30,10]]},{'id':'cross','width':4,'points':[[15,0],[15,20]]}]
  tile={'tx':0,'tz':0,'size':40,'buildings':[],'borderPavements':[],'curbs':[],
   'pavements':[{'road':'back','edges':encode_edges(np.array([[0,15],[30,15]]),np.array([[0,5],[30,5]]),0,0,40)},
                {'road':'cross','edges':encode_edges(np.array([[13,0],[13,20]]),np.array([[17,0],[17,20]]),0,0,40)}],
   'sidewalks':[{'rings':[[[0,6],[30,6],[30,8],[0,8]]]}],'islands':[],
   'driveways':[[[[0,5],[30,5],[30,10],[0,10]]]]}
  source={'streetCorridors':[{'id':'back','roads':['back'],'landings':[[0,10],[30,10]],'width':5.5,'verge':{'side':'right','width':2}}]}
  headers={'0_0':tile};original=copy.deepcopy(headers)
  reviewed_streets(headers,roads,source)
  lawn=unary_union([Polygon(r[0],r[1:]) for r in tile['streetLawns']])
  self.assertTrue(lawn.contains(Point(5,6)))
  self.assertFalse(lawn.intersects(Polygon([[13,0],[17,0],[17,20],[13,20]]).buffer(-.01)))
  self.assertEqual(tile['pavements'][0]['walk'],[0,1],'no fallback sidewalk along the grass side')
  for field in ('sidewalks','driveways'):
   shapes=[v['rings'] if field=='sidewalks' else v for v in tile[field]]
   self.assertLess(unary_union([Polygon(r[0],r[1:]) for r in shapes]).intersection(lawn).area,.001)
  snapshot=json.dumps(headers)
  for _ in range(2):
   headers=json.loads(json.dumps(headers));reviewed_streets(headers,roads,source)
   self.assertEqual(json.dumps(headers),snapshot)
  restore_street_sources(headers);self.assertEqual(headers,original)

 def test_packaged_back_bay_frontage_is_narrow_with_unpaved_grass(self):
  source=json.loads((ROOT/'public/data/back-street-source.json').read_text())['streetCorridors'][0]
  city=json.loads((ROOT/'public/data/city.json').read_text());roads={r['id']:r for r in city['roads']}
  tiles=[unpack(ROOT/f'public/data/tiles/t_{key}.bin')[0] for key in ('-2_-1','-1_-1','0_-1')]
  lawn=unary_union([Polygon(r[0],r[1:]) for t in tiles for r in t.get('streetLawns',[])])
  self.assertGreater(lawn.area,2500)
  for field in ('streetPavement','streetSidewalks','sidewalks','islands','driveways','deckPavement'):
   polygons=[item['rings'] if field=='sidewalks' else item for t in tiles for item in t.get(field,[])]
   surface=unary_union([Polygon(r[0],r[1:]) for r in polygons])
   # Compiled polygons round to millimetres; ignore that shared edge tolerance.
   self.assertLess(surface.intersection(lawn.buffer(-.002)).area,.01,field+' must not paint over the verge')
  found=set()
  for t in tiles:
   for rec in t['pavements']:
    if rec['road'] not in source['roads']:continue
    found.add(rec['road']);left,right=decode_edges(rec['edges'],t['tx'],t['tz'],t['size'])
    self.assertTrue(np.all(np.abs(np.linalg.norm(left-right,axis=1)-5.5)<.02))
    self.assertEqual(roads[rec['road']]['pavedWidth'],5.5)
    self.assertEqual(rec['walk'][0],1)
  self.assertEqual(found,set(source['roads']))
  # Real points in the grass, midway along both blocks adjoining Exeter.
  for id in ('13244-0-0','13245-0-0'):
   line=LineString(roads[id]['points']);a=np.array(line.interpolate(.45,normalized=True).coords[0]);b=np.array(line.interpolate(.55,normalized=True).coords[0])
   tangent=(b-a)/np.linalg.norm(b-a);normal=np.array([-tangent[1],tangent[0]])
   self.assertTrue(lawn.contains(Point((a+b)/2+normal*3.75)),id)
   self.assertFalse(lawn.contains(Point((a+b)/2-normal*3.75)),id+' keeps its building-side sidewalk')


if __name__=='__main__':unittest.main()
