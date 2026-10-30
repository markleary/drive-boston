"""Source alignment, reproducibility and independent tunnel-level regressions."""
import gzip,importlib.util,itertools,json,math,pathlib,unittest
import numpy as np
from shapely.geometry import LineString,Point
from road_structure_clearance import crossing_points,road_height

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('central_artery',ROOT/'scripts/build-central-artery.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class CentralArterySourceTest(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.source=json.loads((ROOT/'public/data/central-artery-source.json').read_text());cls.city=json.loads((ROOT/'public/data/city.json').read_text());cls.data=json.loads((ROOT/'public/data/central-artery.json').read_text());cls.roads=cls.data['roads'];cls.by_id={r['id']:r for r in cls.roads};cls.features={f['attributes']['OBJECTID']:f for f in cls.source['features']}
  grid=cls.city['elevation'];cls.heights=np.frombuffer(gzip.decompress((ROOT/'public/data'/grid['file']).read_bytes()),dtype='<i2')*grid.get('scale',.01)
 def test_regeneration_matches_shipped_sidecar(self):
  self.assertEqual(module.build(self.city,self.source,self.heights),self.data)
  self.assertEqual(self.city['tunnels']['file'],'central-artery.json')
 def test_source_nodes_remain_exact_except_documented_survey_lip_fit(self):
  for route in self.source['routes']:
   road=self.by_id[route['id']];points={tuple(p) for p in road['points']}
   for index,fid in enumerate(route['featureIds']):
    f=self.features[fid]
    for endpoint in f['geometry']['paths'][0][::len(f['geometry']['paths'][0])-1]:
     p=module.xy(endpoint)
     if route.get('surveyLateralFit'):
      feature=self.features[route['featureIds'][-1 if route.get('direction')=='north' else 0]]
      anchor=module.xy(feature['geometry']['paths'][0][-1 if route.get('direction')=='north' else 0])
      if math.dist(p,anchor)<max(80,route.get('surfaceRoadFit',{}).get('endMetersFromNorth',0)):continue
     self.assertIn(tuple(p),points,(route['id'],fid,p))
 def test_surface_landings_use_actual_triangle_terrain_and_existing_streets(self):
  endpoints=[p for r in self.city['roads'] if not r.get('elevations') for p in [r['points'][0],r['points'][-1]]]
  for route in self.source['routes']:
   road=self.by_id[route['id']]
   for index,flag in [(0,'surfaceStart'),(-1,'surfaceEnd')]:
    if not route.get(flag):continue
    p=road['points'][index];ground=module.sample_grid(self.city['elevation'],self.heights,p)
    self.assertAlmostEqual(road['elevations'][index],ground,delta=.0001)
    self.assertLess(min(math.dist(p,e) for e in endpoints),.002,(road['id'],p))
 def test_all_surface_junctions_have_level_landings_outside_the_through_lanes(self):
  streets={r['id']:r for r in self.city['roads']};checked=0
  for route in self.source['routes']:
   if not (route.get('surfaceStart') or route.get('surfaceEnd')):continue
   road=self.by_id[route['id']];line=LineString(road['points']);ss=module.stations(road['points'])
   record=next(r for r in self.data['provenance']['routes'] if r['id']==road['id'])
   self.assertTrue(record['surfaceStreetIds'],road['id'])
   a,b=road['tunnel']['surfaceLandings'][0]
   self.assertGreater(b-a,6,road['id'])
   for p,y,s in zip(road['points'],road['elevations'],ss):
    if a-.001<=s<=b+.001:self.assertAlmostEqual(y,module.sample_grid(self.city['elevation'],self.heights,p),delta=.0001)
   for id in record['surfaceStreetIds']:
    street=streets[id];overlap=line.intersection(LineString(street['points']).buffer((street['width']+road['width'])/2+.3))
    for part in getattr(overlap,'geoms',[overlap]):
     if part.geom_type!='LineString':continue
     stations=[line.project(Point(p)) for p in part.coords];lo,hi=min(stations),max(stations)
     if (lo<.001 if route.get('surfaceStart') else hi>line.length-.001):
      self.assertGreaterEqual(lo,a-.001);self.assertLessEqual(hi,b+.001,(road['id'],id))
   checked+=1
  self.assertEqual(checked,11)
 def test_source_graph_merges_keep_one_elevation(self):
  for route in self.data['provenance']['routes']:
   road=self.by_id[route['id']]
   for join in route['joins']:
    parent=self.by_id[join['roadId']];p=road['points'][join['pointIndex']];index=parent['points'].index(p)
    self.assertEqual(road['elevations'][join['pointIndex']],parent['elevations'][index])
 def test_merging_pavement_cannot_create_a_step_across_the_parent_lane(self):
  checked=0
  for specification in self.source['routes']:
   if not specification.get('matchParentPavement'):continue
   road=self.by_id[specification['id']];record=next(r for r in self.data['provenance']['routes'] if r['id']==road['id'])
   for join in record['joins']:
    parent=self.by_id[join['roadId']];line=LineString(parent['points'])
    stations=module.stations(road['points'])
    indexes=range(len(road['points'])) if join['pointIndex']==0 else range(len(road['points'])-1,-1,-1)
    for i in indexes:
     point=road['points'][i]
     if line.distance(Point(point))>(road['width']+parent['width'])/2+.5 or abs(stations[i]-stations[join['pointIndex']])>specification.get('mergeMatchLimit',math.inf):break
     self.assertAlmostEqual(road['elevations'][i],road_height(parent,point,lambda x,z:0),delta=.005,msg=f"{road['id']} slab edge crosses its parent lane")
     checked+=1
  self.assertGreater(checked,20)
 def test_overlapping_opposing_bores_have_independent_clearance(self):
  north,south=self.roads[:2];south_line=LineString(south['points']);checked=0
  for point,y in zip(north['points'],north['elevations']):
   distance=south_line.distance(Point(point))
   if distance>north['width']/2+south['width']/2+.3:continue
   foot=south_line.interpolate(south_line.project(Point(point)));other=road_height(south,[foot.x,foot.y],lambda x,z:0)
   self.assertGreater(abs(y-other),6.2,(point,distance,y,other));checked+=1
  self.assertGreater(checked,30)
 def test_nonjunction_crossings_leave_full_vehicle_headroom(self):
  checked=0
  for a,b in itertools.combinations(self.roads,2):
   for crossing in crossing_points(LineString(a['points']).intersection(LineString(b['points']))):
    p=[crossing.x,crossing.y]
    if min(math.dist(p,q) for q in [a['points'][0],a['points'][-1],b['points'][0],b['points'][-1]])<5:continue
    ya=road_height(a,p,lambda x,z:0);yb=road_height(b,p,lambda x,z:0)
    self.assertGreater(abs(ya-yb),6.2,(a['id'],b['id'],p,ya,yb));checked+=1
  self.assertGreater(checked,5)
 def test_terminal_scope_and_profiles(self):
  self.assertEqual(len(self.roads),13)
  self.assertEqual(len(self.data['landmarks']),3)
  self.assertEqual(sum(bool(r['tunnel'].get('capStart'))+bool(r['tunnel'].get('capEnd')) for r in self.roads),2)
  for r in self.roads:
   self.assertFalse(r['traffic']);self.assertEqual(r['oneway'],1)
   for p,q,a,b in zip(r['points'],r['points'][1:],r['elevations'],r['elevations'][1:]):self.assertLess(abs(b-a)/math.dist(p,q),.12)
  for r,index in [(self.roads[0],0),(self.roads[1],-1)]:
   self.assertTrue(100<r['points'][index][1]<400,'close the tunnel near the I-90/south portals')

if __name__=='__main__':unittest.main()
