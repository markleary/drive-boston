"""Source alignment, reproducibility and independent tunnel-level regressions."""
import gzip,importlib.util,itertools,json,math,pathlib,unittest
import numpy as np
from shapely.geometry import LineString,Point,Polygon
from shapely.strtree import STRtree
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
     if route.get('surveyLateralFit') or route.get('surfaceRoadFit'):
      north_end=route.get('direction')=='north' or route.get('surfaceStart')
      feature=self.features[route['featureIds'][-1 if north_end else 0]]
      anchor=module.xy(feature['geometry']['paths'][0][-1 if north_end else 0])
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
 def test_full_width_pavement_meets_or_has_independent_headroom(self):
  # Independent triangle/triangle intersections catch oblique slab steps and
  # side overlaps that a centerline graph or centerline drive cannot reveal.
  decks={}
  for road in self.roads:
   sections=module.deck_sections(road);triangles=[]
   for a,b in zip(sections,sections[1:]):
    for vertices in [(a[0],a[1],b[0]),(a[1],b[1],b[0])]:
     p,q,r=vertices;dx1,dz1=q[0]-p[0],q[2]-p[2];dx2,dz2=r[0]-p[0],r[2]-p[2];det=dx1*dz2-dx2*dz1
     if abs(det)<1e-8:continue
     gx=((q[1]-p[1])*dz2-(r[1]-p[1])*dz1)/det;gz=(dx1*(r[1]-p[1])-dx2*(q[1]-p[1]))/det
     triangles.append((Polygon([(v[0],v[2]) for v in vertices]),(p[0],p[1],p[2],gx,gz)))
   decks[road['id']]=triangles
  checked=0
  for a,b in itertools.combinations(self.roads,2):
   ta,tb=decks[a['id']],decks[b['id']];tree=STRtree([t[0] for t in tb])
   for polygon,plane in ta:
    for j in tree.query(polygon):
     other,other_plane=tb[j];overlap=polygon.intersection(other)
     if overlap.area<.001:continue
     height=lambda v,p:v[1]+v[3]*(p[0]-v[0])+v[4]*(p[1]-v[2])
     for point in overlap.exterior.coords:
      difference=abs(height(plane,point)-height(other_plane,point))
      self.assertTrue(difference<=.08 or difference>=6.2,(a['id'],b['id'],point,difference))
      checked+=1
  self.assertGreater(checked,2000)
 def test_all_surface_lips_match_terrain_across_the_lane(self):
  for spec,road in zip(self.source['routes'],self.roads):
   for index,flag in [(0,'surfaceStart'),(-1,'surfaceEnd')]:
    if not spec.get(flag):continue
    for x,y,z in module.deck_sections(road)[index]:
     ground=module.sample_grid(self.city['elevation'],self.heights,[x,z])
     self.assertAlmostEqual(y,ground,delta=.0001,msg=road['id'])
 def test_local_width_tapers_leave_usable_lanes(self):
  narrowed=0
  for road in self.roads:
   if 'deckWidths' not in road:continue
   narrowed+=1;widths=road['deckWidths'];self.assertGreaterEqual(min(widths),10 if road['kind']=='motorway' else 3.8)
   self.assertLessEqual(max(widths),road['width'])
   for p,q,a,b in zip(road['points'],road['points'][1:],widths,widths[1:]):self.assertLessEqual(abs(b-a)/math.dist(p,q),.1001)
  self.assertGreater(narrowed,2)
 def test_surface_crossings_keep_intact_roadways_above_the_tunnel(self):
  checked=0
  for record in self.data['provenance']['routes']:
   road=self.by_id[record['id']]
   for crossing in record.get('surfaceUnderpasses',[]):
    for station in np.linspace(crossing['start'],crossing['end'],11):
     self.assertTrue(any(a-.001<=station<=b+.001 for a,b in road['tunnel']['covered']),(road['id'],crossing['street'],station,'surface street must not be excavated'))
     checked+=1
  self.assertGreater(checked,100)
 def test_covered_roof_fits_beneath_surface_at_both_edges(self):
  for road in self.roads:
   for station,section in zip(module.stations(road['points']),module.deck_sections(road)):
    if not any(a-.001<=station<=b+.001 for a,b in road['tunnel']['covered']):continue
    for x,y,z in section:self.assertLessEqual(y+6,module.sample_grid(self.city['elevation'],self.heights,[x,z])+.0001,road['id'])
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
