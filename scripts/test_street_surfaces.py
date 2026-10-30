"""Curb-bounded street surfaces: edge measurement, cleaning, islands, town
fillets and an idempotent install into a small synthetic package.

  PYTHONPATH=scripts .venv-data/bin/python -m unittest scripts/test_street_surfaces.py
"""
import importlib.util,json,pathlib,tempfile,types,unittest
import numpy as np
from shapely.geometry import LineString,Polygon
from shapely.ops import unary_union
import street_surfaces as ss
from tileformat import write_tile
ROOT=pathlib.Path(__file__).resolve().parents[1]

def road(identifier,points,width=10,name='Test Street'):return {'id':identifier,'name':name,'points':points,'width':width,'oneway':0}
def rect_curb(x0,z0,x1,z1):return [[x0,z0],[x1,z0],[x1,z1],[x0,z1],[x0,z0]]


class MeasurementTest(unittest.TestCase):
 def test_midpoint_is_the_half_length_point(self):
  self.assertEqual(ss.road_midpoint([[0,0],[10,0],[10,30]]),[10,10])
  self.assertEqual(ss.road_midpoint([[0,0],[4,0]]),[2,0])

 def test_stations_every_metre_with_left_normals(self):
  pts,nrm,along=ss.road_stations([[0,0],[5,0],[5,5]])
  self.assertEqual(len(pts),11);self.assertAlmostEqual(along[-1],10);np.testing.assert_allclose(nrm[1],[0,1]);np.testing.assert_allclose(nrm[-1],[-1,0])
  np.testing.assert_allclose(nrm[5],[-1,1]/np.sqrt(2),atol=1e-9)

 def test_rays_measure_the_nearest_curb_each_side(self):
  r=road('a',[[0,0],[40,0]]);curbs=[LineString([[-5,-6],[45,-6]]),LineString([[-5,7],[45,7]]),LineString([[-5,9],[45,9]])]
  pts,nrm,along,L,R=ss.cast_edges([r],curbs)[ss.road_key(r)][:5]
  np.testing.assert_allclose(L,7);np.testing.assert_allclose(R,6)

 def test_cleaning_suppresses_tongues_fills_gaps_and_ramps_to_nominal(self):
  along=np.arange(60,dtype=float);d=np.full(60,6.0);d[20:23]=11;d[30:35]=np.nan;d[40:42]=1.2;d[50:]=np.nan
  out=ss.clean_side(d,along,5.0)
  np.testing.assert_allclose(out[20:23],6);np.testing.assert_allclose(out[30:35],6);np.testing.assert_allclose(out[40:42],6,err_msg='a median curb crossed at a junction is not a narrowing')
  self.assertAlmostEqual(out[56],5);self.assertGreater(out[50],5);self.assertLess(out[50],6)
  np.testing.assert_allclose(ss.clean_side(np.full(5,np.nan),np.arange(5.0),4.5),4.5)
  self.assertGreaterEqual(ss.clean_side(np.full(5,.2),np.arange(5.0),4.5).min(),1.2)

 def test_compression_keeps_only_the_bends(self):
  Lp=np.array([[x,5.0] for x in range(30)]);Rp=np.array([[x,-5.0 if x<15 else -8.0] for x in range(30)])
  keep=ss.compress(Lp,Rp);self.assertEqual(keep[0],0);self.assertEqual(keep[-1],29);self.assertLess(len(keep),8);self.assertIn(14,keep)
  self.assertEqual(ss.compress(np.array([[0,1],[1,1],[2,1]],float),np.array([[0,-1],[1,-1],[2,-1]],float)),[0,2])

 def test_records_carry_width_and_sidewalk_presence(self):
  r=road('a',[[0,0],[40,0]]);curbs=[LineString([[-5,-6],[45,-6]]),LineString([[-5,7],[45,7]])]
  edges=ss.cast_edges([r],curbs);walks=ss.STRtree([Polygon([[-5,7],[45,7],[45,10],[-5,10]])])
  rec=ss.pavement_records([r],edges,walks)[ss.road_key(r)]
  self.assertEqual(rec['pavedWidth'],13);self.assertEqual(rec['walk'],[1,0]);np.testing.assert_allclose(rec['left'][:,1],7);np.testing.assert_allclose(rec['right'][:,1],-6)


class TownCurbTest(unittest.TestCase):
 def setUp(self):
  self.roads=[road('osm-1-0',[[-50,0],[50,0]]),road('osm-2-0',[[0,-50],[0,50]],8)];self.towns={'Town':Polygon([[-100,-100],[100,-100],[100,100],[-100,100]])}

 def test_legacy_curbs_match_the_metro_builder(self):
  spec=importlib.util.spec_from_file_location('metro',ROOT/'scripts/build-metro.py');metro=importlib.util.module_from_spec(spec);spec.loader.exec_module(metro)
  districts=types.SimpleNamespace(town=self.towns)
  self.assertEqual(ss.legacy_town_curbs(self.roads,self.towns),metro.synthetic_curbs(self.roads,districts))

 def test_fillets_round_the_inside_corners(self):
  curbs=ss.town_curbs(self.roads,self.towns);ring=unary_union([LineString(c) for c in curbs])
  faces=list(ss.polygonize(ring));self.assertEqual(len(faces),1);area=faces[0].area
  mitred=unary_union([LineString(r['points']).buffer(r['width']/2+ss.LIP,cap_style=2,join_style=2) for r in self.roads]).area
  self.assertGreater(area,mitred+4*(1-np.pi/4)*ss.FILLET**2*.9);self.assertLess(area,mitred+4*ss.FILLET**2)
  # The pavement edges away from the junction are untouched by the closing.
  self.assertTrue(faces[0].contains(ss.Point(40,5.05)));self.assertFalse(faces[0].contains(ss.Point(40,5.2)))


class IslandTest(unittest.TestCase):
 def test_closed_faces_without_a_street_become_islands(self):
  curbs=[LineString(rect_curb(0,0,10,20)),LineString(rect_curb(30,0,40,20)),LineString(rect_curb(60,0,120,40)),LineString(rect_curb(200,0,203,300))]
  roads=[road('a',[[35,-5],[35,25]])]
  islands,drives,stats=ss.curb_islands(curbs,roads,[],[[65,5]])
  self.assertEqual(stats['faces'],4);self.assertEqual(stats['road'],1);self.assertEqual(stats['building'],1);self.assertEqual(drives,[])
  self.assertEqual([round(i.area) for i in islands],[200,900],'the small face and the thin divider; the block and the street are not islands')
  parks=[{'rings':[[[0,0],[10,0],[10,20],[0,20]]]}]
  self.assertEqual(ss.curb_islands(curbs,roads,parks,[[65,5]])[2]['park'],1)
  walks=ss.STRtree([Polygon([[2,2],[8,2],[8,8],[2,8]])])
  self.assertEqual(ss.curb_islands(curbs,roads,[],[[65,5]],walks)[2]['sidewalk'],1)

 def test_faces_a_service_road_enters_or_a_lot_covers_are_paved(self):
  # A park pull-off (the whole face is park) that a service road enters, a face a lot
  # polygon covers, a face a service road only grazes, and a block too large to pave.
  curbs=[LineString(rect_curb(0,0,40,20)),LineString(rect_curb(60,0,80,20)),LineString(rect_curb(100,0,110,20)),LineString(rect_curb(200,0,300,100))]
  roads=[road('a',[[-20,-5],[-20,25]])];parks=[{'rings':[[[-5,-5],[45,-5],[45,25],[-5,25]]]}]
  service=[LineString([[-20,10],[30,10],[30,15]]),LineString([[100,0],[110,0]]),LineString([[150,50],[250,50]])];lots=[Polygon([[58,-2],[82,-2],[82,22],[58,22]])]
  islands,faces,stats=ss.curb_islands(curbs,roads,parks,[],None,(service,lots))
  self.assertEqual(stats['driveways'],2);self.assertEqual(sorted(round(f.area) for f in faces),[400,800])
  self.assertEqual([round(i.area) for i in islands],[200],'the grazed face stays a concrete island; the block stays terrain')
  self.assertEqual(stats['park'],0,'a paved face inside a park is a driveway, not lawn')
  # The surfaces dissolve the ribbons (4 m wide), the lots and the faces inside the coverage and cut out inventory sidewalks.
  coverage=Polygon([[-30,-10],[260,-10],[260,110],[-30,110]]);walks=ss.STRtree([Polygon([[0,0],[40,0],[40,4],[0,4]])])
  drives=ss.driveway_surfaces(service,[4,4,4],lots,faces,coverage,walks)
  areas=sorted(round(d.area) for d in drives)
  self.assertEqual(areas,[40,400,576,720],'the grazing stub (10 m by 4 m), the block ribbon, the lot absorbing its face, and the pull-off plus its 20 m approach minus its sidewalk')

 def test_service_roads_are_measured_to_the_curbs(self):
  # A 4 m class driveway between a left curb 5 m out and a right curb 2 m out for 30 m (so the line's width is 7 m);
  # then the OSM line runs 5 cm outside the right curb with the far curb 7 m beyond it and nothing on the left, so
  # the asphalt lies across the touched curb; then it runs 5 cm inside a right curb with nothing else in reach, so
  # the open left side is completed to the 7 m.
  line=LineString([[0,0],[90,0]]);curbs=[LineString([[0,5],[30,5]]),LineString([[0,-2],[30,-2]]),LineString([[30,-.05],[60,-.05]]),LineString([[30,-7.05],[60,-7.05]]),LineString([[60,-.05],[90,-.05]])]
  left,right=ss.driveway_edges([line],[4.0],curbs)[0]
  self.assertAlmostEqual(left[10][1],5,places=2);self.assertAlmostEqual(right[10][1],-2,places=2)
  self.assertAlmostEqual(left[45][1],ss.DRIVEWAY_FLOOR,places=2,msg='outside the driveway: only the 10 cm floor on the open side');self.assertAlmostEqual(right[45][1],-7.05,places=2,msg='the asphalt spans the two curbs across the line')
  self.assertAlmostEqual(left[75][1],7-.05,places=2,msg='inside, touching: the open side completes the width');self.assertAlmostEqual(right[75][1],-ss.DRIVEWAY_FLOOR,places=2,msg='only the 10 cm floor, under the curb box, passes the curb the line runs along')
  far=ss.driveway_edges([LineString([[0,0],[60,0]])],[4.0],[LineString([[0,9],[60,9]])])[0]
  self.assertTrue(np.allclose(far[0][:,1],2) and np.allclose(far[1][:,1],-2),'a curb beyond reach leaves the class width')
  self.assertEqual(ss.driveway_edges([line],[4.0],[]),[None],'no curbs at all: the caller buffers the line')

 def test_driveway_features_split_lines_and_lots(self):
  elements=[{'type':'way','tags':{'highway':'service','service':'parking_aisle'},'geometry':[{'lon':0,'lat':0},{'lon':1,'lat':1}]},{'type':'way','tags':{'highway':'service','width':"12'"},'geometry':[{'lon':0,'lat':0},{'lon':1,'lat':0}]},{'type':'way','tags':{'amenity':'parking','parking':'surface'},'geometry':[{'lon':0,'lat':0},{'lon':2,'lat':0},{'lon':2,'lat':2},{'lon':0,'lat':2},{'lon':0,'lat':0}]},{'type':'way','tags':{'amenity':'parking','parking':'multi-storey'},'geometry':[{'lon':0,'lat':0},{'lon':2,'lat':0},{'lon':2,'lat':2},{'lon':0,'lat':2},{'lon':0,'lat':0}]},{'type':'way','tags':{'amenity':'parking'},'geometry':[{'lon':5,'lat':5},{'lon':6,'lat':5}]},{'type':'way','tags':{'highway':'service','tunnel':'yes'},'geometry':[{'lon':0,'lat':0},{'lon':1,'lat':0}]},{'type':'way','tags':{'highway':'service','layer':'-1'},'geometry':[{'lon':0,'lat':0},{'lon':1,'lat':0}]},{'type':'node','tags':{},'lon':0,'lat':0}]
  lines,widths,lots=ss.driveway_features(elements,lambda x,y:(x*10,y*10))
  self.assertEqual([round(l.length,3) for l in lines],[round(10*2**.5,3),10],'surface service ways only');self.assertEqual([round(w,4) for w in widths],[5.5,round(12*.3048,4)]);self.assertEqual([a.area for a in lots],[400],'surface lots only, closed ways only')
  self.assertEqual(ss.osm_width({'width':'30'},4),12);self.assertEqual(ss.osm_width({'width':'narrow'},4),4);self.assertEqual(ss.osm_width({'width':'3 m'},4),3)


class SidewalkTest(unittest.TestCase):
 def test_esri_rings_build_polygons_with_holes(self):
  outer=[[0,0],[0,10],[10,10],[10,0],[0,0]];hole=[[4,4],[6,4],[6,6],[4,6],[4,4]]
  features=[{'attributes':{'MATERIAL':'BR'},'geometry':{'rings':[outer,hole]}},{'attributes':{'MATERIAL':'CC'},'geometry':{'rings':[[[20,0],[20,5],[25,5],[25,0],[20,0]]]}},{'attributes':{'MATERIAL':' '},'geometry':{'rings':[[[200,0],[200,5],[205,5],[205,0],[200,0]]]}}]
  out=ss.sidewalk_polygons(features,lambda x,y:(x,y),Polygon([[-1,-1],[100,-1],[100,100],[-1,100]]))
  self.assertEqual([m for _,m in out],['brick','concrete']);self.assertAlmostEqual(out[0][0].area,96);self.assertEqual(len(out[0][0].interiors),1)
 def test_island_outlines_keep_only_the_declared_sidewalk_width(self):
  square=lambda x0:[[x0,0],[x0,40],[x0+40,40],[x0+40,0],[x0,0]]
  # The same 40 m island outline with a 9.5 ft sidewalk: reduced inside parkland, kept whole outside it; a declared 40 ft plaza in parkland is kept.
  features=[{'attributes':{'MATERIAL':'CC','SWK_WIDTH':'9.5'},'geometry':{'rings':[square(0)]}},{'attributes':{'MATERIAL':'CC','SWK_WIDTH':'9.5'},'geometry':{'rings':[square(100)]}},{'attributes':{'MATERIAL':'CC','SWK_WIDTH':'40'},'geometry':{'rings':[square(200)]}},{'attributes':{'MATERIAL':'CC','SWK_WIDTH':' '},'geometry':{'rings':[square(300)]}}]
  parks=[{'rings':[[[-5,-5],[45,-5],[45,45],[-5,45]]]},{'rings':[[[195,-5],[245,-5],[245,45],[195,45]]]},{'rings':[[[295,-5],[345,-5],[345,45],[295,45]]]}]
  stats={};out=ss.sidewalk_polygons(features,lambda x,y:(x,y),Polygon([[-10,-10],[400,-10],[400,100],[-10,100]]),parks,stats)
  self.assertEqual(stats['outlines'],2);self.assertEqual(len(out),4)
  width=9.5*.3048;self.assertAlmostEqual(out[0][0].area,1600-(40-2*width)**2,delta=.01);self.assertEqual(len(out[0][0].interiors),1)
  self.assertAlmostEqual(out[1][0].area,1600);self.assertAlmostEqual(out[2][0].area,1600)
  self.assertAlmostEqual(out[3][0].area,1600-(40-2*ss.WALK_FALLBACK)**2,delta=.01,msg='a blank width falls back to the plain band width')
  self.assertEqual(ss.sidewalk_polygons(features[:1],lambda x,y:(x,y),Polygon([[-10,-10],[400,-10],[400,100],[-10,100]]))[0][0].area,1600,'without parks nothing is reduced')


class InstallTest(unittest.TestCase):
 def test_install_is_idempotent_and_measures_the_roadway(self):
  with tempfile.TemporaryDirectory() as temporary:
   data=pathlib.Path(temporary);source=data/'source';source.mkdir();(data/'tiles').mkdir()
   roads=[road('b-1',[[100,500],[900,500]],10,'Boston Street'),road('osm-1-0',[[1100,100],[1100,900]],8,'Town Street'),road('osm-2-0',[[1010,500],[1190,500]],8,'Cross Street'),road('deck',[[100,100],[400,100]],10,'Deck')]
   roads[3]['elevations']=[8,8]
   city={'roads':roads,'neighborhoods':[{'name':'Boston','rings':[[[0,0],[1000,0],[1000,1000],[0,1000]]],'town':False},{'name':'Town','rings':[[[1000,0],[2000,0],[2000,1000],[1000,1000]]],'town':True}],'coverage':[[[0,0],[2000,0],[2000,1000],[0,1000]]],'parks':[{'name':'Old Loop','rings':[[[100,650],[400,650],[400,750],[100,750]]]}],'sources':[],'tiles':{'size':1000,'directory':'tiles','keys':['0_0','1_0']}}
   (data/'city.json').write_text(json.dumps(city));(data/'provenance.json').write_text('{}')
   legacy=ss.legacy_town_curbs(roads,{'Town':Polygon(city['neighborhoods'][1]['rings'][0])})
   # Boston: a survey curb pair 7 m from the centerline (wider than the 5 m guess) with a short driveway tongue on the left (+z) side, an inventory sidewalk on the right; a closed island; the town has legacy mitred curbs.
   # Two curbs 200 m from any street: the one in the park is a removed roadway's remnant, the other is kept.
   curbs0=[[[0,493],[1000,493]],[[0,507],[400,507],[400,512],[403,512],[403,507],[1000,507]],rect_curb(500,520,520,530),rect_curb(600,520,640,530),[[150,700],[350,700]],[[600,700],[800,700]]]
   write_tile(data/'tiles/t_0_0.bin',{'tx':0,'tz':0,'size':1000,'buildings':[],'curbs':curbs0,'parkPaths':[],'roads':['b-1','deck']},[])
   write_tile(data/'tiles/t_1_0.bin',{'tx':1,'tz':0,'size':1000,'buildings':[],'curbs':[c for curb in legacy for c in ss.clip_line(curb,ss.box(1000,0,2000,1000))],'parkPaths':[],'roads':['osm-1-0','osm-2-0']},[])
   (source/'layer-0.json').write_text(json.dumps({'features':[{'attributes':{'MATERIAL':'CC'},'geometry':{'rings':[[[0,493],[0,490],[1000,490],[1000,493],[0,493]]]}}]}))
   # A service road enters the curbed pull-off at (600..640, 520..530); the island at 500 stays bare.
   (source/'osm-metro-driveways.json').write_text(json.dumps({'elements':[{'type':'way','id':1,'tags':{'highway':'service'},'geometry':[{'lon':620,'lat':506.5},{'lon':620,'lat':525}]}]}))
   first=ss.install(data,source,lambda x,y:(x,y),log=lambda *a,**k:None);snapshot={p.name:p.read_bytes() for p in data.rglob('*') if p.is_file()}
   second=ss.install(data,source,lambda x,y:(x,y),log=lambda *a,**k:None)
   self.assertEqual({p.name:p.read_bytes() for p in data.rglob('*') if p.is_file()},snapshot,'a rerun rewrites identical bytes')
   self.assertEqual({**first,'changedTiles':0,'staleCurbs':0,'staleCurbMetres':0},second);self.assertEqual(first['changedTiles'],2)
   header=ss.unpack(data/'tiles/t_0_0.bin')[0];record=next(p for p in header['pavements'] if p['road']=='b-1')
   self.assertEqual([p['road'] for p in header['pavements']],['b-1'],'decks keep their ribbons');self.assertEqual(record['walk'],[0,1])
   self.assertEqual(first['staleCurbs'],1);self.assertEqual(first['staleCurbMetres'],200);self.assertNotIn([[150,700],[350,700]],header['curbs']);self.assertIn([[600,700],[800,700]],header['curbs'],'beyond reach but outside parkland')
   edges=np.array(record['edges']).reshape(-1,4)/100;np.testing.assert_allclose(edges[:,1],507,atol=.011);np.testing.assert_allclose(edges[:,3],493,atol=.011)
   self.assertLess(len(edges),6,'straight edges compress; the driveway tongue is suppressed');self.assertEqual(len(header['islands']),1);self.assertEqual(len(header['sidewalks']),1)
   # The paved face (40 m by 10 m) plus the untagged 4.5 m service ribbon approaching it from the curb (no curb within reach of its stations), dissolved into one surface.
   self.assertEqual(len(header['driveways']),1);self.assertAlmostEqual(Polygon(header['driveways'][0][0]).area,400+13.5*ss.SERVICE_WIDTH,delta=.01);self.assertEqual(first['driveways'],1);self.assertEqual(first['pavedFaces'],1)
   installed=json.loads((data/'city.json').read_text());self.assertEqual(next(r for r in installed['roads'] if r['id']=='b-1')['pavedWidth'],14)
   self.assertEqual([s['name'] for s in installed['sources']],['Boston Sidewalk Inventory','OpenStreetMap service roads and parking areas (driveway fills)'])
   town=ss.unpack(data/'tiles/t_1_0.bin')[0];self.assertFalse({json.dumps(c) for c in town['curbs']}&{json.dumps(c) for curb in legacy for c in ss.clip_line(curb,ss.box(1000,0,2000,1000))},'legacy mitred curbs are replaced')
   self.assertEqual(len(town['curbs']),first['townCurbs']);self.assertGreater(len(town['curbs']),0)
   self.assertEqual(first['surveyCurbs']+first['townCurbs'],len(header['curbs'])+len(town['curbs']),'the two counts partition the curbs in the tiles')
   provenance=json.loads((data/'provenance.json').read_text());self.assertEqual(provenance['streetSurfaces']['measuredRoads'],3,'the Boston street and both town streets')


if __name__=='__main__':unittest.main()
