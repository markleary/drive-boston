"""Interstate 93 north of the Central Artery tunnel, from the Zakim survey to the
Medford/Stoneham line.

The town imports leave out OpenStreetMap motorway classes, so north of the
surveyed Zakim / Charlestown viaduct the expressway was missing, and the survey
mesh had no traffic graph. This stage adds both carriageways and the interchange
ramps inside the coverage from `i93-north-source.json`: the OpenStreetMap ways of
the cached town extracts (I 93 carriageways and their motorway_link ramps; the
reversible HOV viaduct in Somerville and the few-metre junction links inside the
Wellington Mystic Avenue intersection are left out), projected like every town
street, plus carriageway stations traced from the survey mesh (`survey`: both
carriageways between the tunnel mouths and the north mouth, the Leverett
Connector, and the City Square ramp pieces the lower deck replaces).

- Alignment: the source ways, resampled every 3 m with their vertices kept, so
  every gore (where a ramp leaves or joins) and every street landing is an exact
  shared vertex. The northbound deck starts SURVEY_OVERLAP metres up the surveyed
  northbound carriageway at its traced height plus LIFT and blends onto the
  source line within BLEND metres of the north mouth. Both carriageways stop
  INSET metres inside the coverage at the Medford/Stoneham line, where they are
  closed with concrete barriers (`closed`).
- Southbound lower deck: OpenStreetMap carries the southbound carriageway through
  Charlestown on a lower deck (layer 2) beneath the northbound viaduct (layer 3);
  the survey has only the upper deck and a City Square ramp onto the Zakim. The
  southbound deck follows its source ways beneath the survey, held
  CLEAR_UNDER_TARGET + SURVEY_MARGIN under the lowest survey surface over its
  footprint (never closer than CLEAR_UNDER + SURVEY_MARGIN), leaves the source
  line CURVE metres before the City Square ramp on a curve onto the ramp's
  centreline, narrowing to its two lanes (MERGE_HALF) over NARROW metres, climbs
  along the ramp and ends SURVEY_OVERLAP metres up survey carriageway #30 (the
  Zakim southbound) at the survey height plus LIFT. The ramp pieces it replaces
  are cut out of the survey mesh (CUT_MARGIN beyond their edges and the deck's,
  KEEP_MARGIN clear of the carriageways beside them; triangles crossing the cut
  are split on vertical planes). The tile entry records the cut (`surveyCut`, with
  a digest of its inputs), so a rerun finds it and leaves the mesh alone. No
  triangle of the cut mesh may come within CLEAR_UNDER of the deck top or
  THICKNESS of its underside.
- Survey traces: traffic, GPS and street names need graph records over the
  drivable survey, so `i93-zakim-*` traces (`surveyDeck`, bridge kind TRACE)
  follow the traced stations LIFT above the survey surface from the Central
  Artery tunnel bores' ends to the I-93 decks (and from the Leverett Connector,
  GPS only), sharing the neighbouring records' end points exactly. The tracer
  splits carriageways where the deck changes, so JOINT metres either side of each
  split are replaced by a curve. The tunnel's Cross Street entrance ends beside
  the northbound bore at the mouth; its trace curves onto the northbound trace
  CROSS_MERGE metres on, LIFT over the survey surface. The runtime never draws,
  collides or samples them as a surface.
- Profile: every carriageway and ramp is a deck (bridge kind KIND), solved as a
  smoothing spline over its stations: it follows the graded terrain at
  TERRAIN_RISE across its full width (never less than TERRAIN_FLOOR), clears
  every street and mapped water it crosses above (CLEAR_OVER under
  the slab, more where the grade allows), and passes CLEAR_UNDER beneath the
  bridges OpenStreetMap layers over it (Roosevelt Circle, Fellsway West and the
  Mystic Valley Parkway in Medford), within MAINLINE_GRADE (RAMP_GRADE on ramps).
  Ramps start at the carriageway's height at their gore, match it while their
  pavements overlap and land on the graded street vertex; of two ramps
  splitting from (or merging into) one point, the lower keeps the higher one's
  height while their pavements overlap (the Sullivan Square exit beside the
  collector's return to the carriageway, the two Mystic Valley Parkway
  entrances), and where ramps meet end to end the trunk sets the joint's height
  (node_trunks). Where two new roads cross, the upper one clears the lower one
  and the lower one stays under it, each solve taking the other's latest heights.
  The hard bounds are coned under the grade and rounded to MAINLINE_RADIUS
  (RAMP_RADIUS) so the deck is never pressed over a sharper crest or sag.
  Ramps gain shoulder width only where the neighbouring road and building
  envelopes leave room, tapering back to the original width at junctions.
  Consecutive records of one carriageway or ramp share their seam's tangent
  (`deckTangents`), so their deck ends and lane paint meet square.
- Cuts: the source overpasses are estimated decks between at-grade landings, so
  under them the expressway sits below the bare-earth DEM. The graded grid is cut
  under the deck where it would cover the road (CUT_BELOW under the deck, rising
  at WALL beyond its edge); street corridors and buildings keep their heights.
  Every changed vertex is recorded with its original height for restore and
  replay.
- Twins: the two carriageways are each solved on their own ground and came out
  a step apart wherever that ground, or what they pass, differs across the
  median: the Fellsway West bridge stands 1.2 m higher over the northbound road
  than over the southbound one, the two climb to a bridge a few stations apart.
  Their pavements meet or overlap through most of Medford (MEDIAN_SLACK), and
  the runtime rails no deck edge another deck covers within 0.8 m, so a step
  under that was a bare ledge down the middle of the road and a higher one a
  wall. They are brought to one height where they run alongside each other in
  the open (in_the_open: not held beneath the surveyed viaduct) with no more
  than TWIN_MEDIAN between their pavements, the lower following the higher, by
  the rule the Turnpike and Storrow Drive stage has (boston_highways.py binds
  alongside, twin_lift, eased and lower_envelope from here): a lift fades at
  TWIN_RATE, out into the stretch where more lies between the two or, before a
  station that keeps its height, inside the stretch itself; it ends under a
  bridge's clearance and keeps the road within its grade (graded_lift holds it
  to that once more). Three things are this stage's own. A station laid on the
  survey keeps the survey's height (may_rise). Where one carriageway stands a
  storey over the other (STOREY) the two are on two levels, and the stretch
  along which the one stands over the other on the way there keeps its heights
  (one_level: north of the Charlestown viaduct the southbound road climbs to
  its lower deck beside the northbound one coming down from the upper). And a
  lift ends under any deck that lies over the pavement without crossing the
  centre line (overhead: a street carried over the trench's edge), so the cut
  and those street pieces are made in build, for the roads alone, before it. A
  ramp whose ends or bounds a lift has changed is solved again and never comes
  down for it. install cuts the trench and widens the ramps for each road as
  it rides alone (plan.solo), so no record, width or carried street moves;
  the trench is then cut again for the roads as they lie, a vertex taking the
  higher of the two cuts, and the ground under a lifted road that rode it
  comes up to the ground its twin stands over (fill), by no more than the road
  rose, never lowered. `twins` of the provenance lists the lifts, the ramps
  solved again and, record by record, what stays under its twin (`apart`);
  validate holds the installed carriageways to that list.

Heights and clearances are game estimates, not surveyed structures."""
import copy,hashlib,json,math,re
from collections import defaultdict
import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import LineString,Point,Polygon
from shapely.strtree import STRtree
from road_connections import resample,stations
from road_structure_clearance import crossing_points,road_height
from tileformat import SCALE,mesh_record,read_tile,write_tile
from water_crossings import grid_sampler

PREFIX='i93-'
KIND='i93-north'
SOURCE_NAME='i93-north-source.json'
SURVEY_ID='BOS-2E9SM-83L3W-UVT08'
SURVEY_OVERLAP=35   # deck laid over the surveyed carriageway past each mouth
LIFT=.02            # deck above the surveyed surface where they overlap
BLEND=60            # lateral blend from the surveyed mouth onto the source line
INSET=25            # closure barrier distance inside the coverage edge
MAX_PIECE=900       # longest carriageway record (a tile owns a deck by its midpoint)
THICKNESS=.75
TERRAIN_RISE=.35    # deck above the highest terrain across its width at grade
TERRAIN_FLOOR=.2
LANDING_TAPER=15    # a ramp's terrain allowance fades out over this distance before its street landing
CLEAR_OVER=4.3      # under the slab above streets (CLEAR_OVER_TARGET where the grade allows)
CLEAR_OVER_TARGET=4.8
CLEAR_WATER=1.5     # under the slab above the water surface
CLEAR_UNDER=3.4     # beneath an overpass slab (CLEAR_UNDER_TARGET where the grade allows)
CLEAR_UNDER_TARGET=4.4
MAINLINE_GRADE=.055
RAMP_GRADE=.075
MAINLINE_RADIUS=250  # sharpest crest or sag the solved profile is forced into (RAMP_RADIUS on ramps)
RAMP_RADIUS=100
OVERLAP_SLACK=.3    # decks overlapping beside each other by more than this keep one height,
STEP=.25            # within this (a deck crossing another is at least THICKNESS+CLEAR_UNDER above it)
OVERLAP_REACH=30    # gaps in such an overlap shorter than this are bridged
MEDIAN_SLACK=1.0    # the carriageways' inner shoulders may overlap this much across a narrow median
STIFFNESS=2e5       # curvature penalty per station (about a 30 m response length)
TRENCH_STIFFNESS=4e6
TRENCH_REACH=320    # terrain is a target, not a floor, this far along the road from an overpass
CUT_BELOW=.35
SHELF=3             # level cut beyond a deck edge before the trench wall rises
WALL=.7
CORRIDOR=2.9        # sidewalk allowance kept around street pavements
CARRY_MAX=60        # longest stretch of a street carried on a deck over the trench edge
APPROACH='i93-overpass-approach'
BUILDING=1.0
LANE=3.65
RAMP_WIDTHS={1:7.0,2:10.4}
RAMP_SHOULDER=1.0   # extra room on each side where the mapped corridor allows
RAMP_TAPER=25       # metres of travel per metre of extra shoulder
RAMP_EDGE_MARGIN=.4 # clearance from obstacles beyond the widened deck
# Existing decks the carriageways pass over whatever the source layers say. At
# Exit 22 OpenStreetMap makes the Mystic Valley Parkway the bridge, but the
# packaged parkway piece is a water-crossing deck 1.3 m over the river bank, so
# the expressway (a bridge over the Mystic River a few metres north) carries on over it.
OVER_EXISTING={'osm-80989746-0'}
PARALLEL=.87         # cosine between two roads that run the same way (30 degrees)
TWIN_MEDIAN=6.0      # the two carriageways of a road share one height where no more than this lies between their pavements: a cell of the terrain grid, which cannot hold two levels closer together
TWIN_REACH=60        # a stretch where they stand further apart than that is bridged when it is no longer than this (two source lines wander apart and back)
TWIN_APART=12.0      # with more than this between them they are two roads: a lift fades out before it (the ground of a wider median takes up the difference)
TWIN_RATE=.02        # a carriageway leaves its own profile for the shared one no faster than this
TWIN_STEP=.03        # where they share a height the two may differ by this: a station left further under its twin is listed (`twins.apart` of the provenance)
LIFTED=.001          # a lift smaller than this is none
STOREY=THICKNESS+CLEAR_UNDER  # a twin standing this far over a carriageway (a slab and the room under it: the one could pass beneath the other) is on another level of the road, not a step across its median
GROUNDED=.9          # a deck this close over its ground rides it: lifted, it takes that ground up with it
FILLED=.02           # by more than this (the grid holds centimetres)
OVERHEAD=2.5         # a deck of another stage this far over that ground passes over the road: the ground under it comes up too

NB=[138533767,42770991,89920116,354700641,122090890,89920112,80676381,80676380,9038895,80676437,1090251781,1132327152,80676435,80989740,80989737,80662283,1481276631,80662285,80653153,80653162,80653174,80653165,80541074,1573381080,80541073,80619082,80619079,9038256,9038257,80619349,80619354,1094048969]
# The southbound carriageway runs on through the Charlestown viaduct on its lower
# deck (the last four ways, layer 2 beneath the layer 3 northbound deck) to City Square.
SB=[9038259,80619337,80619341,932440863,9038897,80619099,80619076,80541072,1481276629,80541071,80653155,80653159,80653172,80653166,1573381081,80662303,80662279,80989742,1090702921,1090702922,80989744,80676429,1090723429,80676430,9429267,122090892,80676382,80676378,89920111,933852037,1093816841,89920114,122090893,42770986,
 138533765,650781431,355229843,355230980]
CURVE=60            # the lower deck leaves its source line this far before the City Square ramp it replaces
MERGE_HALF=3.9      # its half width from there, the ramp's two lanes
NARROW=100          # and the distance over which it narrows to that before
SURVEY_MARGIN=.15   # extra clearance under the survey mesh for its 1 m raster
CUT_MARGIN=.4       # survey removed beyond a replaced carriageway's edge and the lower deck's
KEEP_MARGIN=.1      # survey kept beyond the edge of a carriageway beside the cut
TRACE='zakim-survey-trace'
TRACE_BLEND=40      # lateral blend of a trace onto a neighbouring record's end point
JOINT=30            # a trace's curve between two traced pieces starts this far back on each
CROSS_MERGE=120     # the Cross Street entrance's trace joins the northbound trace this far from the tunnel
CUT_VERSION=1
# Outboard corner of the detached survey spur south of the Zakim. Its high
# lip overhangs the tunnel approach; neither mainline nor any ramp uses it.
PORTAL_SPUR_TIP=(1172.09,10.27,-1761.38)
# The obsolete tip of the survey's outer parapet crosses the generated bore
# diagonally. Start its cut where it hands off to the bore's own outside wall.
PORTAL_RAIL_TAIL=((1162.1,-1794.8),(1183.9,-1770.7))
SPLIT_MERGE=[-896.935,-4751.959]   # 540052144 joins 542171987 at this interior vertex
# Ramp records in solve order: a group's trunk first, so the pieces after it find
# their shared split node already profiled.
RAMPS=[
 {'id':'i93-nb-exit-21','name':'I-93 North · Exit 21 Route 28','ways':[9429564,354700640]},
 {'id':'i93-nb-exit-21-medford','name':'I-93 North · Exit 21 to Somerville and Medford','ways':[9429161]},
 {'id':'i93-nb-exit-21-assembly','name':'I-93 North · Exit 21 to Malden and Assembly Square','ways':[89920110]},
 {'id':'i93-nb-entrance-21','name':'I-93 North · Entrance from Mystic Avenue','ways':[9428734,89920113]},
 {'id':'i93-nb-entrance-wellington','name':'I-93 North · Entrance from Mystic Avenue at Wellington','ways':[9038384,9038387,80676385,80676383]},
 {'id':'i93-nb-exit-22','name':'I-93 North · Exit 22 Mystic Valley Parkway','ways':[9038411]},
 {'id':'i93-mvp-entrance','name':'I-93 · Entrance from Mystic Valley Parkway','ways':[9038401,591908516]},
 {'id':'i93-mvp-entrance-east','name':'I-93 · Entrance from Mystic Valley Parkway eastbound','ways':[1358204987]},
 {'id':'i93-nb-entrance-22','name':'I-93 North · Entrance from Mystic Valley Parkway','ways':[9038773,80989750,80989749]},
 {'id':'i93-sb-entrance-22','name':'I-93 South · Entrance from Mystic Valley Parkway','ways':[9037708]},
 {'id':'i93-nb-exit-23','name':'I-93 North · Exit 23 Route 60 Medford Square','ways':[1481276632,9038335]},
 {'id':'i93-nb-entrance-23','name':'I-93 North · Entrance from Fountain Street','ways':[175345440,1481276628]},
 {'id':'i93-nb-exit-24','name':'I-93 North · Exit 24 Route 28 Fellsway West','ways':[9038926]},
 {'id':'i93-nb-entrance-24','name':'I-93 North · Entrance from Fellsway West','ways':[9037916]},
 {'id':'i93-sb-exit-24','name':'I-93 South · Exit 24 Route 28 Fellsway West','ways':[9038607]},
 {'id':'i93-sb-entrance-24','name':'I-93 South · Entrance from Fellsway West','ways':[9037898]},
 {'id':'i93-sb-exit-23','name':'I-93 South · Exit 23 Route 60 Medford Square','ways':[1481276630,94333536]},
 {'id':'i93-sb-entrance-23','name':'I-93 South · Entrance from Salem Street','ways':[9037944]},
 {'id':'i93-sb-exit-22','name':'I-93 South · Exit 22 Revere Beach Parkway','ways':[1358204988]},
 {'id':'i93-sb-exit-21','name':'I-93 South · Exit 21 Mystic Avenue','ways':[9038337]},
 {'id':'i93-sb-exit-21-somerville','name':'I-93 South · Exit 21 to Somerville','ways':[9038336]},
 {'id':'i93-sb-exit-21-medford','name':'I-93 South · Exit 21 to Medford','ways':[31133490]},
 {'id':'i93-sb-exit-20','name':'I-93 South · Exit 20 Sullivan Square','ways':[9429523,89920115]},
 {'id':'i93-sb-collector','name':'I-93 South · Collector to Boston','ways':[924036539]},
 {'id':'i93-sb-exit-sullivan','name':'I-93 South · Exit to Sullivan Square and Charlestown','ways':[9429129]},
 {'id':'i93-sb-entrance-collector','name':'I-93 South · Collector entrance','ways':[1102528642,9429970]},
 {'id':'i93-sb-entrance-mystic','name':'I-93 South · Entrance from Mystic Avenue','ways':[9429318]},
 {'id':'i93-sb-entrance-route-28-merge','name':'I-93 South · Entrance from Route 28','ways':[542171987],'from':SPLIT_MERGE},
 {'id':'i93-sb-entrance-route-28','name':'I-93 South · Entrance from Route 28','ways':[542171987],'until':SPLIT_MERGE},
 {'id':'i93-sb-entrance-mystic-east','name':'I-93 South · Entrance from Mystic Avenue eastbound','ways':[540052144]},
 {'id':'i93-sb-entrance-fellsway','name':'I-93 South · Entrance from the Fellsway','ways':[9429515]},
]
TAGS=('highway','ref','name','lanes','layer','bridge','tunnel','oneway','destination','junction:ref')
TOWNS=('somerville','medford','everett','malden','cambridge','chelsea','melrose')
TO_FEET=Transformer.from_crs(4326,2249,always_xy=True)
FT=1200/3937
METHOD=('OpenStreetMap I 93 carriageways and motorway_link ramps from the cached town extracts, resampled with source vertices kept; '
 'decks solved as smoothing splines over the graded terrain with street and water clearances above and overpass clearances beneath; '
 'graded grid cut under the overpasses (street corridors and buildings kept); concrete closures inside the Medford/Stoneham coverage edge; '
 'southbound lower deck held beneath the surveyed Charlestown viaduct onto the Zakim, with the City Square ramp pieces it replaces cut from the survey mesh; '
 'survey traces joining the Central Artery tunnel bores and the Cross Street entrance to the decks for traffic and GPS')


def project(lon,lat):
 x,y=TO_FEET.transform(lon,lat);return [round((x-771100)*FT,3),round(-(y-2952900)*FT,3)]


def extract(source_dir,survey):
 """The source sidecar: every OpenStreetMap way the stage uses, from the cached
 town extracts, and the survey carriageway stations at the two viaduct mouths."""
 wanted=set(NB)|set(SB)|{w for r in RAMPS for w in r['ways']};ways={};extracts={t:json.loads((source_dir/f'osm-{t}-roads.json').read_text()) for t in TOWNS}
 stamps={t:d.get('osm3s',{}).get('timestamp_osm_base') for t,d in extracts.items()}
 # A way split after an older extract was taken keeps its old geometry there: the newest extract wins.
 for town in sorted(TOWNS,key=lambda t:(stamps[t] or '',t),reverse=True):
  for e in extracts[town]['elements']:
   if e.get('type')=='way' and e['id'] in wanted and e['id'] not in ways:
    ways[e['id']]={'id':e['id'],'town':town,'tags':{k:e['tags'][k] for k in TAGS if k in e.get('tags',{})},'points':[project(g['lon'],g['lat']) for g in e['geometry']]}
 missing=sorted(wanted-set(ways));assert not missing,f'I-93 source ways missing from the extracts: {missing}'
 return {'version':1,'name':'Interstate 93 north of the Charlestown viaduct','source':'OpenStreetMap town road extracts (data-source-cache/osm-<town>-roads.json)',
  'url':'https://www.openstreetmap.org/','license':'ODbL 1.0, © OpenStreetMap contributors','extracts':stamps,
  'projection':'EPSG:4326 to Massachusetts State Plane feet (EPSG:2249), metres from 771100 E, 2952900 N, z southward, like every town street',
  'survey':{'building':SURVEY_ID,**survey},
  'ways':[ways[i] for i in sorted(ways)]}


def smooth(t):t=max(0,min(1,t));return t*t*(3-2*t)


def concat(ways,ids):
 """Points of consecutive source ways and, per point, the way leading away from it."""
 points=[];owner=[]
 for i in ids:
  p=[list(q) for q in ways[i]['points']]
  if points:
   assert math.dist(points[-1],p[0])<.002,f'I-93 source chain broken before way {i}'
   p=p[1:]
  points+=p;owner+=[i]*len(p)
 return points,owner


def cut_line(points,owner,start=None,end=None):
 """The part of a polyline between two distances along it, keeping the vertices inside."""
 along=stations(points);start=0 if start is None else start;end=along[-1] if end is None else end
 def at(d):
  for k in range(len(points)-1):
   if along[k+1]>=d-1e-9:t=(d-along[k])/((along[k+1]-along[k]) or 1);return [round(points[k][j]+(points[k+1][j]-points[k][j])*t,3) for j in (0,1)],owner[k]
  return list(points[-1]),owner[-1]
 p,o=at(start);out=[p];own=[o]
 for k,d in enumerate(along):
  if start+.01<d<end-.01:out.append(list(points[k]));own.append(owner[k])
 p,o=at(end)
 if math.dist(p,out[-1])>.01:out.append(p);own.append(o)
 return out,own


def barrier_station(points,outline,from_end):
 """Distance along the line where it first stands INSET metres inside the coverage, walking in from its outer end."""
 line=LineString(points);total=line.length;edge=outline.exterior
 for k in range(int(total)):
  d=total-k if from_end else k;p=line.interpolate(d)
  if outline.contains(p) and edge.distance(p)>=INSET:return d
 raise ValueError('I-93 never reaches the closure inset inside the coverage')


def survey_join(points,owner,survey):
 """Start the northbound carriageway SURVEY_OVERLAP metres up the surveyed deck
 inside the viaduct's north mouth and blend the source line onto the mouth.
 `survey` lists [x,z,y,half] from the mouth inward. Returns points, owners and
 {point: (height, half width)} for the surveyed stations."""
 along=stations([s[:2] for s in survey]);inward=[s for s,d in zip(survey,along) if d<=SURVEY_OVERLAP+1e-6]
 mouth=survey[0][:2];line=LineString(points);d=line.project(Point(mouth));foot=line.interpolate(d);offset=(mouth[0]-foot.x,mouth[1]-foot.y)
 fixed={tuple(s[:2]):(round(s[2]+LIFT,4),s[3]) for s in inward}
 rest,own=cut_line(points,owner,start=d);ds=stations(rest)
 rest=[[round(p[0]+offset[0]*(1-smooth(s/BLEND)),3),round(p[1]+offset[1]*(1-smooth(s/BLEND)),3)] for p,s in zip(rest,ds)];rest[0]=list(mouth)
 head=[list(s[:2]) for s in inward[::-1]]
 return head[:-1]+rest,[own[0]]*(len(head)-1)+own,fixed


def city_square_join(points,owner,survey,ramp):
 """End the southbound lower deck on the Zakim's surveyed southbound carriageway in
 place of the City Square ramp that merged into it (`ramp`, traced stations in
 travel order; it runs within 2 m of the source line): leave the source line CURVE
 metres before the ramp's first station, curve onto it in the ramp's direction (a
 cubic Hermite curve), follow the ramp's centre line to the carriageway and lay
 SURVEY_OVERLAP metres over the surveyed deck, blending from the ramp's side onto
 its centre line and full width. `survey` lists [x,z,y,half,...] in travel order.
 Returns points, owners, {point: (height, half width)} for the surveyed stations
 and the index of the curve's first point."""
 xz=np.array([s[:2] for s in survey],dtype=float);along=stations(xz.tolist());last=max(i for i,d in enumerate(along) if d<=SURVEY_OVERLAP+1e-6)
 t=np.gradient(xz,axis=0);t/=np.linalg.norm(t,axis=1)[:,None];n=np.stack([-t[:,1],t[:,0]],1)
 rp=np.array([r[:2] for r in ramp],dtype=float);inside=[list(map(float,q)) for q in rp if np.dot(q-xz[0],t[0])<-1.5]
 offset=float(np.dot(np.array(inside[-1])-xz[0],n[0]));offset=math.copysign(min(abs(offset),max(0,survey[0][3]-MERGE_HALF)),offset)
 tail=[];fixed={}
 for i in range(last+1):
  f=smooth(along[i]/along[last]);p=xz[i]+n[i]*offset*(1-f);q=[round(float(p[0]),3),round(float(p[1]),3)]
  tail.append(q);fixed[tuple(q)]=(round(survey[i][2]+LIFT,4),round(MERGE_HALF+(survey[i][3]-MERGE_HALF)*f,3))
 line=LineString(points);end=line.project(Point(inside[0]))-CURVE;head,own=cut_line(points,owner,end=end)
 a=line.interpolate(end-1);b=line.interpolate(end+1);t0=np.array([b.x-a.x,b.y-a.y]);t0/=np.linalg.norm(t0);t1=rp[1]-rp[0];t1/=np.linalg.norm(t1)
 p0=np.array(head[-1],dtype=float);p1=np.array(inside[0]);L=float(np.linalg.norm(p1-p0));m=max(2,math.ceil(L/3));curve=[]
 for k in range(1,m):
  u=k/m;q=(2*u**3-3*u**2+1)*p0+(u**3-2*u**2+u)*L*t0+(3*u**2-2*u**3)*p1+(u**3-u**2)*L*t1;curve.append([round(float(q[0]),3),round(float(q[1]),3)])
 follow=[[round(q[0],3),round(q[1],3)] for q in inside]
 return head+curve+follow+tail,own+[own[-1]]*(len(curve)+len(follow)+len(tail)),fixed,len(head)-1


def resample_owned(points,owner):
 """resample() keeps every source vertex; carry each vertex's owner along."""
 out=[];own=[]
 for k,(a,b) in enumerate(zip(points,points[1:])):
  count=max(1,math.ceil(math.dist(a,b)/3.001))
  for j in range(count):out.append([round(a[i]+(b[i]-a[i])*j/count,3) for i in (0,1)]);own.append(owner[k])
 return out+[list(points[-1])],own+[owner[-1]]


def tangents(points):
 out=[]
 for k in range(len(points)):
  a=points[max(0,k-1)];b=points[min(len(points)-1,k+1)];dx,dz=b[0]-a[0],b[1]-a[1];n=math.hypot(dx,dz) or 1;out.append((dx/n,dz/n))
 return out


def lanes_of(ways,way_id,ramp=False):
 value=str(ways[way_id]['tags'].get('lanes',''))
 try:n=int(value.split(';')[0])
 except ValueError:n=1 if ramp else 3
 return max(1,min(2,n)) if ramp else max(2,min(5,n))


def layer_of(ways,way_id):
 try:return int(ways[way_id]['tags'].get('layer','0'))
 except ValueError:return 0


def mainline_width(lanes):return round(min(20,lanes*LANE+4.2),2)


def taper(points,values,reach):
 """Values that change along a road blended over `reach` metres centred on each change."""
 along=stations(points);changes=[(along[i],values[i-1],values[i]) for i in range(1,len(values)) if values[i]!=values[i-1]];out=[]
 for i,s in enumerate(along):
  v=values[i]
  for d,a,b in changes:
   if abs(s-d)<reach/2:v=a+(b-a)*smooth((s-d+reach/2)/reach)
  out.append(round(v,3))
 return out


class Terrain:
 """Graded grid as float metres with bilinear sampling."""
 def __init__(self,grid,heights):
  self.grid=grid;self.scale=grid.get('scale',.01);self.values=heights.astype(np.float64)*self.scale;self.sample=grid_sampler(grid,self.values)
 def __call__(self,x,z):return self.sample(x,z)
 def across(self,p,tangent,half):
  nx,nz=-tangent[1],tangent[0];return max(self.sample(p[0]+nx*o,p[1]+nz*o) for o in np.linspace(-half,half,7).tolist())


class Plan:
 """A new road being profiled: stations, widths, per-station targets and bounds, then the solved heights."""
 def __init__(self,id,points,owner,widths,grade,lanes):
  n=len(points);self.id=id;self.points=points;self.owner=owner;self.widths=list(widths);self.grade=grade;self.lanes=lanes;self.radius=MAINLINE_RADIUS if grade==MAINLINE_GRADE else RAMP_RADIUS
  self.along=np.asarray(stations(points));self.tangents=tangents(points);self.line=LineString(points)
  self.terrain=[0.0]*n;self.floor=[-math.inf]*n;self.ceiling=[math.inf]*n;self.lift=[-math.inf]*n;self.drop=[math.inf]*n
  self.trench=[False]*n;self.water=[False]*n;self.allowance=[1.0]*n;self.stiff=[STIFFNESS]*n;self.hold=[None]*n;self.fixed={};self.y=None;self.ends=[None,None];self.landing=[False,False];self.min_layer=[None]*n
 def window(self,d,reach):return range(int(np.searchsorted(self.along,d-reach,'left')),int(np.searchsorted(self.along,d+reach,'right')))
 def nearest(self,p):return int(np.argmin([(q[0]-p[0])**2+(q[1]-p[1])**2 for q in self.points]))
 def at(self,d):return float(np.interp(d,self.along,self.y))
 def height(self,p):return self.at(self.line.project(Point(p)))
 def width_at(self,d):return float(np.interp(d,self.along,self.widths))
 def bounds(self):
  """Hard low and high bounds, target and weight per station, and the terrain
  floor a trench station keeps wherever the overpass above leaves room."""
  low=[];high=[];target=[];weight=[];soft=[]
  for i in range(len(self.points)):
   if i in self.fixed:y=self.fixed[i];low.append(y);high.append(y);target.append(y);weight.append(1e4);soft.append(-math.inf);continue
   a=self.allowance[i];t=self.terrain[i]+TERRAIN_RISE*a;w=.001 if self.water[i] else 1.0;ground=self.terrain[i]+TERRAIN_FLOOR*a
   # A deck held under the survey keeps its clearance beneath it instead of following the ground.
   if self.hold[i] is not None:t=self.hold[i];w=30.0
   if self.lift[i]>t:t=self.lift[i];w=30.0
   if self.drop[i]<t:t=self.drop[i];w=30.0
   low.append(self.floor[i] if self.trench[i] else max(self.floor[i],ground));soft.append(ground if self.trench[i] else -math.inf)
   high.append(self.ceiling[i]);target.append(t);weight.append(w)
  return low,high,target,weight,soft


def penta_solve(d0,d1,d2,b):
 """Solve a symmetric positive definite pentadiagonal system by banded Cholesky."""
 n=len(d0);L0=[0.0]*n;L1=[0.0]*n;L2=[0.0]*n
 for i in range(n):
  l2=d2[i-2]/L0[i-2] if i>=2 else 0.0
  l1=(d1[i-1]-l2*L1[i-1])/L0[i-1] if i>=1 else 0.0
  L2[i]=l2;L1[i]=l1;L0[i]=math.sqrt(max(d0[i]-l2*l2-l1*l1,1e-12))
 y=[0.0]*n
 for i in range(n):y[i]=(b[i]-(L1[i]*y[i-1] if i>=1 else 0.0)-(L2[i]*y[i-2] if i>=2 else 0.0))/L0[i]
 x=[0.0]*n
 for i in range(n-1,-1,-1):x[i]=(y[i]-(L1[i+1]*x[i+1] if i+1<n else 0.0)-(L2[i+2]*x[i+2] if i+2<n else 0.0))/L0[i]
 return x


def spline(along,target,weight,low,high,stiffness,grade,big=1e7,tol=.003):
 """Heights close to `target` (per-station `weight`) under a curvature penalty
 (`stiffness` per station) within the hard bounds `low` and `high`. Violated
 bounds are pinned and the system solved again; where the grade still exceeds
 `grade`, the stiffness there is raised and the whole solve repeated. Returns
 the heights and whether the grade limit holds."""
 n=len(along);stiff=list(stiffness);y=list(target)
 for _ in range(14):
  pin=[None]*n
  for _ in range(60):
   d0=[weight[i]+(big if pin[i] is not None else 0) for i in range(n)];d1=[0.0]*n;d2=[0.0]*n
   b=[weight[i]*target[i]+(big*pin[i] if pin[i] is not None else 0) for i in range(n)]
   for i in range(1,n-1):
    # Second difference on uneven stations (source vertices sit between the 3 m steps).
    h1=max(.05,along[i]-along[i-1]);h2=max(.05,along[i+1]-along[i]);ca=2/(h1*(h1+h2));cb=-2/(h1*h2);cc=2/(h2*(h1+h2));w=stiff[i]*(h1+h2)/2
    d0[i-1]+=w*ca*ca;d0[i]+=w*cb*cb;d0[i+1]+=w*cc*cc;d1[i-1]+=w*ca*cb;d1[i]+=w*cb*cc;d2[i-1]+=w*ca*cc
   y=penta_solve(d0,d1,d2,b);changed=False
   for i in range(n):
    if pin[i] is None and y[i]<low[i]-tol:pin[i]=low[i];changed=True
    elif pin[i] is None and y[i]>high[i]+tol:pin[i]=high[i];changed=True
   if not changed:break
  steep=[i for i in range(n-1) if abs(y[i+1]-y[i])>grade*(along[i+1]-along[i])+1e-4]
  if not steep:return y,True
  for i in steep:
   for k in range(max(0,i-30),min(n,i+31)):stiff[k]=min(stiff[k]*2.5,1e10)
 return y,False


def effective_layer(tags):
 """OSM crossing order of a way: its layer, or 1 for an untagged bridge."""
 try:return int(tags.get('layer'))
 except (TypeError,ValueError):return 1 if tags.get('bridge')=='yes' else 0


def crossing_windows(plan,others,lines,tree):
 """(other road, distance along the plan, half window, point, plan station) for
 every independent centreline crossing; a shared vertex is a junction, not a crossing."""
 out=[]
 for j in tree.query(plan.line,predicate='intersects'):
  other=others[j]
  if other is plan:continue
  pts=other.points if isinstance(other,Plan) else other['points']
  for hit in crossing_points(plan.line.intersection(lines[j])):
   p=[hit.x,hit.y]
   if any(math.dist(p,q)<.05 for q in plan.points) and any(math.dist(p,q)<.05 for q in pts):continue
   d=plan.line.project(hit);k=int(np.argmin(np.abs(plan.along-d)));best=(math.inf,None)
   for a,b in zip(pts,pts[1:]):
    dist=LineString([a,b]).distance(hit)
    if dist<best[0]:L=math.dist(a,b) or 1;best=(dist,((b[0]-a[0])/L,(b[1]-a[1])/L))
   t=plan.tangents[k];ot=best[1];sine=max(.25,abs(t[0]*ot[1]-t[1]*ot[0]));cosine=abs(t[0]*ot[0]+t[1]*ot[1])
   if isinstance(other,Plan):half_other=other.width_at(other.line.project(hit))/2
   elif other.get('elevations'):half_other=max(other.get('deckWidths') or [other['width']])/2
   else:half_other=other['width']/2+CORRIDOR
   out.append((other,d,min(45,half_other/sine+plan.widths[k]/2*cosine/sine+2),p,k))
 return out


def constrain_existing(plan,ways,ground,existing,lines,tree,water,report):
 """Terrain target and floor, clearances at existing roads, and over water. A
 crossed road's height is taken at the crossing and wherever it lies over a
 station's cross-section, so a sloping deck above (or street below) keeps its
 clearance across the whole overlap, not only at the centrelines."""
 for i,(p,t) in enumerate(zip(plan.points,plan.tangents)):plan.terrain[i]=ground.across(p,t,plan.widths[i]/2+.5)
 def heights(other,i,h):
  line=LineString(other['points']);reach=max(other.get('deckWidths') or [other['width']])/2 if other.get('elevations') else other['width']/2+CORRIDOR
  (x,z),(tx,tz)=plan.points[i],plan.tangents[i];out=[h]
  for o in np.linspace(-plan.widths[i]/2,plan.widths[i]/2,5).tolist():
   q=(x-tz*o,z+tx*o)
   if line.distance(Point(q))<=reach:out.append(road_height(other,q,ground))
  return out
 for other,d,half,p,k in crossing_windows(plan,existing,lines,tree):
  h=road_height(other,p,ground);mine=effective_layer(ways[plan.owner[k]]['tags'])
  theirs=other.get('bridge',{}).get('sourceLayer',1) if other.get('elevations') else 0
  if other['id'] in OVER_EXISTING:
   # Passing over a deck the source layers put above: the stations there take the layer above it, so the records keep the solved order.
   for i in plan.window(d,half):plan.min_layer[i]=max(plan.min_layer[i] if plan.min_layer[i] is not None else theirs+1,theirs+1)
   theirs=-1
  elif other.get('elevations') and theirs==mine:report['unresolved'].append({'road':plan.id,'other':other['id'],'name':other['name'],'point':[round(v,2) for v in p],'layer':mine})
  if theirs>mine:
   thick=other.get('bridge',{}).get('thickness',THICKNESS)
   for i in plan.window(d,half):bottom=min(heights(other,i,h))-thick;plan.ceiling[i]=min(plan.ceiling[i],bottom-CLEAR_UNDER);plan.drop[i]=min(plan.drop[i],bottom-CLEAR_UNDER_TARGET)
   for i in plan.window(d,TRENCH_REACH):plan.trench[i]=True;plan.stiff[i]=max(plan.stiff[i],TRENCH_STIFFNESS)
   report['crossings'].append({'road':plan.id,'under':other['id'],'name':other['name'],'at':round(d,1),'point':[round(v,2) for v in p],'deck':round(h,2)})
  else:
   for i in plan.window(d,half):top=max(heights(other,i,h));plan.floor[i]=max(plan.floor[i],top+THICKNESS+CLEAR_OVER);plan.lift[i]=max(plan.lift[i],top+THICKNESS+CLEAR_OVER_TARGET)
   report['crossings'].append({'road':plan.id,'over':other['id'],'name':other['name'],'at':round(d,1),'point':[round(v,2) for v in p],'street':round(h,2)})
 polygons,level=water
 for poly in polygons:
  if not poly.intersects(plan.line):continue
  for i,p in enumerate(plan.points):
   if poly.covers(Point(p)):
    surface=level(*p);surface=ground(*p) if surface is None else surface
    plan.floor[i]=max(plan.floor[i],surface+THICKNESS+CLEAR_WATER);plan.water[i]=True


def cone(values,along,grade,sign):
 """The tightest envelope of `values` (sign 1: from below, -1: from above) whose grade never exceeds `grade`."""
 v=[sign*x for x in values]
 for i in range(1,len(v)):v[i]=max(v[i],v[i-1]-grade*(along[i]-along[i-1]))
 for i in range(len(v)-2,-1,-1):v[i]=max(v[i],v[i+1]-grade*(along[i+1]-along[i]))
 return [sign*x for x in v]


def free_runs(pinned):
 """Index ranges between pinned stations (and the ends), each including the pinned stations that bound it."""
 cuts=[0,*np.flatnonzero(pinned).tolist(),len(pinned)-1];return [(i,j) for i,j in zip(cuts,cuts[1:]) if j-i>=2]


def round_bound(values,cap,along,radius,grade,sign):
 """Smooth a hard bound so that the solved deck, which leaves a floor only upwards
 and a ceiling only downwards, is never forced over a corner sharper than `radius`.
 For a floor (sign 1; -1 mirrors it for a ceiling) each crest corner is raised to a
 parabola carried on at `grade` (steeper than the coned bound, so it comes back down
 onto it), then the sags are filled with the least curve above them whose sags are no
 sharper (the upper hull of values - x^2/2R, plus x^2/2R). Pinned stations (where
 `cap`, the other bound, meets it) are kept, and nothing crosses them or passes `cap`."""
 v=sign*np.asarray(values,float);c=sign*np.asarray(cap,float);a=np.asarray(along,float);out=v.copy();pinned=np.abs(v-c)<1e-6
 if not np.isfinite(v).all():return list(values)  # a coned bound is finite everywhere or nowhere (no ceiling at all)
 h=np.maximum(np.diff(a),1e-6);s=np.diff(v)/h
 for lo,hi in free_runs(pinned):
  x=a[lo:hi+1]
  for i in range(lo+1,hi):
   if s[i-1]-s[i]<=(h[i-1]+h[i])/2/radius:continue
   # A corner beside a pinned station keeps that side's slope; a free one splits the turn.
   st=s[i-1] if pinned[i-1] else s[i] if pinned[i+1] else (s[i-1]+s[i])/2
   d=x-a[i];dd=np.clip(d,(st-grade)*radius,(st+grade)*radius)
   out[lo:hi+1]=np.maximum(out[lo:hi+1],v[i]+st*dd-dd*dd/(2*radius)-grade*np.abs(d-dd))
  for e in (lo,hi):
   if pinned[e]:out[e]=v[e]
  q=(x-x[0])**2/(2*radius);u=out[lo:hi+1]-q;hull=[]
  for i in range(len(x)):
   while len(hull)>=2 and (u[hull[-1]]-u[hull[-2]])*(x[i]-x[hull[-2]])<=(u[i]-u[hull[-2]])*(x[hull[-1]]-x[hull[-2]]):hull.pop()
   hull.append(i)
  out[lo:hi+1]=np.maximum(out[lo:hi+1],np.interp(x,x[hull],u[hull])+q)
 return (sign*np.minimum(out,np.maximum(c,v))).tolist()


def solve(plan,report):
 """Solve a plan's profile. The hard bounds are first widened into cones that
 respect the grade, so a steep embankment is met by climbing early, not by a kink,
 and their corners rounded to the plan's radius (round_bound)."""
 low,high,target,weight,soft=plan.bounds();g=plan.grade*.92
 # Near an overpass the terrain floor yields only where the cone of the target
 # clearance beneath the bridge needs it (the cut). That cone lies under the
 # coned ceiling, so the coned floor stays under it too.
 room=cone([min(h,d) for h,d in zip(high,plan.drop)],plan.along,g,-1);high=cone(high,plan.along,g,-1)
 low=cone([max(l,min(s,r-.01)) for l,s,r in zip(low,soft,room)],plan.along,g,1)
 for i,y in plan.fixed.items():low[i]=high[i]=y  # a fixed run steeper than the cones (a ramp matched to its sibling) keeps its heights
 # The rounding carries on a little steeper than the cones (so it comes back onto them) but under the grade.
 low=round_bound(low,high,plan.along,plan.radius,plan.grade*.96,1);high=round_bound(high,low,plan.along,plan.radius,plan.grade*.96,-1)
 bad=[i for i in range(len(low)) if low[i]>high[i]+.01]
 if bad:report['infeasible'].append({'road':plan.id,'stations':len(bad),'at':[round(float(plan.along[bad[0]]),1),round(float(plan.along[bad[-1]]),1)],'worst':round(max(low[i]-high[i] for i in bad),2)})
 y,ok=spline(plan.along,target,weight,low,high,plan.stiff,plan.grade);plan.y=[round(v,4) for v in y];report['grades'][plan.id]=ok;return ok


def key(p):return (round(p[0],3),round(p[1],3))


def runs(mask):
 """[start, end] index pairs of the True runs of a boolean list."""
 out=[];start=None
 for i,v in enumerate(mask):
  if v and start is None:start=i
  if not v and start is not None:out.append([start,i-1]);start=None
 if start is not None:out.append([start,len(mask)-1])
 return out


def alongside(plan,other,free,other_open):
 """Where `other` runs alongside `plan` in the open: (beside, near). `beside` gives, per station of `plan` that may
 rise (`free`: may_rise), the distance along `other` of the point beside it, None where `other` does not run there in
 the open (`other_open`: in_the_open) the same way (PARALLEL) with no more than TWIN_APART between the two pavements.
 `near` marks the stations where only a median lies between them (TWIN_MEDIAN): there the two share one height; a
 stretch where more does is bridged when it is no longer than TWIN_REACH."""
 n=len(plan.points);pts=shapely.points(plan.points);d=shapely.distance(other.line,pts);s=shapely.line_locate_point(other.line,pts);total=other.line.length
 k=np.clip(np.searchsorted(other.along,s,'right'),1,len(other.points)-1);q=np.asarray(other.points,float);t=q[k]-q[k-1];t/=np.maximum(np.hypot(t[:,0],t[:,1]),1e-9)[:,None]
 shown=np.asarray(other_open,bool);median=d-(np.asarray(plan.widths,float)+np.interp(s,other.along,other.widths))/2
 ok=(s>.5)&(s<total-.5)&(np.abs(np.sum(t*np.asarray(plan.tangents,float),axis=1))>=PARALLEL)&np.asarray(free,bool)&shown[k-1]&shown[k]&(median<=TWIN_APART);near=ok&(median<=TWIN_MEDIAN)
 for a,b in runs((~near).tolist()):
  if a>0 and b<n-1 and plan.along[b+1]-plan.along[a-1]<=TWIN_REACH and ok[a:b+1].all():near[a:b+1]=True
 return [float(s[i]) if ok[i] else None for i in range(n)],near.tolist()


def lower_envelope(cap,up,down):
 """The largest sequence under `cap` that rises by no more than up[i] and falls by no more than down[i] from station i-1 to i."""
 f=list(cap)
 for i in range(1,len(f)):f[i]=min(f[i],f[i-1]+up[i])
 for i in range(len(f)-2,-1,-1):f[i]=min(f[i],f[i+1]+down[i+1])
 return f


def eased(values,along,radius,pinned):
 """`values` along a road with no corner sharper than `radius`: a crest is cut from below (the lower hull of
 values + x^2/2R, less x^2/2R: nothing is raised for it), then a sag is filled from above between the stations that
 keep their value (`pinned`; the upper hull of values - x^2/2R, plus x^2/2R)."""
 v=np.asarray(values,float).copy();x=np.asarray(along,float);q=(x-x[0])**2/(2*radius)
 def hull(lo,hi,u,sign):
  out=[]
  for i in range(lo,hi+1):
   while len(out)>=2 and sign*((u[out[-1]]-u[out[-2]])*(x[i]-x[out[-2]])-(u[i]-u[out[-2]])*(x[out[-1]]-x[out[-2]]))<=0:out.pop()
   out.append(i)
  return out
 u=v+q;k=hull(0,len(v)-1,u,-1);v=np.interp(x,x[k],u[k])-q
 for lo,hi in free_runs(np.asarray(pinned,bool)):
  u=v-q;k=hull(lo,hi,u,1);v[lo:hi+1]=np.maximum(v[lo:hi+1],np.interp(x[lo:hi+1],x[k],u[k])+q[lo:hi+1])
 return v


def twin_lift(plan,heights,beside,near,level):
 """How far a carriageway rises to its twin: per station, metres over `heights` (its profile alone). `beside` and
 `near` are alongside's, `level(distance)` the twin's height. Where only a median lies between them (`near`) the lift
 is what the twin stands higher by. It fades from there no faster than TWIN_RATE: out into the stretch where they
 stand further apart (never over the twin's level there), or, before a station that may not move, inside the stretch
 itself, which it leaves on the road's radius. It is no more than the room under whatever the road passes beneath
 (plan.ceiling), and nowhere changes faster than the road's own grade leaves room for (the nearest point of the twin
 jumps where the two lines bend apart), so the lifted profile keeps within the grade; its corners (where the two
 profiles cross at an angle, where a fade ends) are rounded to that radius (eased)."""
 n=len(heights);x=np.asarray(plan.along,float);h=np.maximum(np.diff(x),1e-6);slope=np.diff(np.asarray(heights,float))/h;limit=plan.grade-1e-4
 rise=[0.,*(np.maximum(0.,limit-slope)*h).tolist()];fall=[0.,*(np.maximum(0.,limit+slope)*h).tolist()]   # what the grade leaves a lift to rise and to fall by from station i-1 to i
 slow=[0.,*(TWIN_RATE*h).tolist()];up=[min(a,b) for a,b in zip(rise,slow)];down=[min(a,b) for a,b in zip(fall,slow)]
 twin=[max(0.,level(s)-heights[i]) if s is not None else 0. for i,s in enumerate(beside)];want=[v if near[i] else 0. for i,v in enumerate(twin)]
 if max(want)<=LIFTED:return [0.]*n
 for i in range(1,n):want[i]=max(want[i],want[i-1]-down[i])   # carried on, fading as fast as it may
 for i in range(n-2,-1,-1):want[i]=max(want[i],want[i+1]-up[i+1])
 cap=[max(0.,plan.ceiling[i]-heights[i]) if beside[i] is not None else 0. for i in range(n)];fade=lower_envelope(cap,up,down)
 still=x[[s is None for s in beside]]
 if len(still):
  # (a station that keeps its height is left on a curve, not at an angle: on the road's radius until the lift changes at TWIN_RATE)
  k=np.searchsorted(still,x);d=np.minimum(np.abs(x-still[np.clip(k-1,0,len(still)-1)]),np.abs(still[np.clip(k,0,len(still)-1)]-x));r=TWIN_RATE*plan.radius
  fade=np.minimum(fade,np.where(d<=r,d*d/(2*plan.radius),TWIN_RATE*(d-r/2))).tolist()
 lift=lower_envelope([min(want[i],fade[i],twin[i]) for i in range(n)],rise,fall)   # (never over the twin)
 lift=np.minimum(eased(lift,x,plan.radius,[beside[i] is None or lift[i]>=cap[i]-1e-9 for i in range(n)]),cap)
 return [float(v) if v>LIFTED else 0. for v in lift]


def carriageways(source,city,ways):
 """The two carriageway plans: the northbound from inside the viaduct's north
 mouth, the southbound through the viaduct's lower deck onto the Zakim's
 surveyed southbound carriageway, both cut at the northern closures."""
 outline=Polygon(city['coverage'][0]);sv=source['survey'];carriageway=sv['southbound'][0]
 ramp=min(sv['cut'],key=lambda r:math.dist(r[-1][:2],carriageway[0][:2]))
 nb,nb_own=concat(ways,NB);sb,sb_own=concat(ways,SB)
 nb,nb_own,nb_fixed=survey_join(nb,nb_own,sv['nbMouth']);sb,sb_own,sb_fixed,curve=city_square_join(sb,sb_own,carriageway,ramp)
 nb,nb_own=cut_line(nb,nb_own,end=barrier_station(nb,outline,True))
 start=barrier_station(sb,outline,False);curve_at=stations(sb)[curve]-start;sb,sb_own=cut_line(sb,sb_own,start=start)
 out={}
 for name,points,owner,fixed in (('nb',nb,nb_own,nb_fixed),('sb',sb,sb_own,sb_fixed)):
  rp,ro=resample_owned(points,owner);lanes=[lanes_of(ways,o) for o in ro]
  plan=Plan(f'i93-{name}',rp,ro,taper(rp,[mainline_width(l) for l in lanes],80),MAINLINE_GRADE,lanes)
  surveyed=[i for i,p in enumerate(rp) if key(p) in {key(q) for q in fixed}]
  for i in surveyed:plan.fixed[i],half=fixed[next(q for q in fixed if key(q)==key(rp[i]))];plan.widths[i]=round(2*half,3)
  plan.survey=(min(surveyed),max(surveyed));out[name]=plan
 # Northbound: widen from the surveyed carriageway at the mouth to the source lanes beyond it.
 nb=out['nb'];edge=nb.survey[1];w0=nb.widths[edge]
 for i in range(edge+1,len(nb.points)):nb.widths[i]=round(float(w0+(nb.widths[i]-w0)*smooth((nb.along[i]-nb.along[edge])/80)),3)
 # Southbound: narrow to the City Square ramp's width before leaving the source line.
 sb=out['sb'];sb.curve=c=int(np.searchsorted(sb.along,curve_at-.01));e=sb.survey[0];w=2*MERGE_HALF
 for i in range(e):
  d=float(sb.along[c]-sb.along[i])
  if d<NARROW:sb.widths[i]=round(float(w+(sb.widths[i]-w)*smooth(d/NARROW)),3)
 return out


def polygonal(geometry):
 parts=[g for g in shapely.get_parts(shapely.make_valid(geometry)) if g.geom_type=='Polygon' and g.area>1e-6]
 return shapely.union_all(parts) if parts else Polygon()


def strip(stations_,margin):
 """Plan outline of a traced carriageway: its stations offset by half width plus `margin` to each side."""
 xz=np.array([s[:2] for s in stations_],dtype=float);half=np.array([s[3] for s in stations_],dtype=float)+margin
 t=np.gradient(xz,axis=0);t/=np.linalg.norm(t,axis=1)[:,None];n=np.stack([-t[:,1],t[:,0]],1)
 return polygonal(Polygon(np.concatenate([xz+n*half[:,None],(xz-n*half[:,None])[::-1]])))


def joined(pieces):return [s for p in pieces for s in p]


def deck_stations(plan):
 """[x, z, -, half] of the southbound plan from its City Square curve to the surveyed join."""
 return [[*plan.points[i],0,plan.widths[i]/2] for i in range(plan.curve,plan.survey[0]+1)]


def cut_region(survey,plan):
 """Plan region of the survey mesh the southbound lower deck replaces: the City Square
 ramps it takes over whole, the ramp that led into them from where the deck crosses
 it, and the deck's own footprint from its curve to the join, less every traced
 carriageway kept (the drivable deck, the Leverett Connector ramp and the pieces beside the cut)."""
 deck=strip(deck_stations(plan),CUT_MARGIN);parts=[deck]+[strip(p,CUT_MARGIN) for p in survey['cut']]
 for p in survey['trim']:
  hits=[k for k in range(len(p)-1) if strip(p[k:k+2],CUT_MARGIN).intersects(deck)]
  if hits:parts.append(strip(p[hits[0]:],CUT_MARGIN))
 keep=[strip(joined(survey[k]),KEEP_MARGIN) for k in ('northbound','leverettNorthbound','southbound')]+[strip(p,KEEP_MARGIN) for p in survey['keep']]
 return polygonal(shapely.union_all(parts).difference(shapely.union_all(keep)))


def cut_digest(survey,plan):
 spec=[CUT_VERSION,CUT_MARGIN,KEEP_MARGIN,*(survey[k] for k in ('cut','trim','keep','northbound','leverettNorthbound','southbound')),[[round(v,3) for v in (s[0],s[1],s[3])] for s in deck_stations(plan)]]
 return hashlib.sha256(json.dumps(spec,separators=(',',':')).encode()).hexdigest()


def cut_mesh(positions,facade,roof,region):
 """The mesh without its parts inside `region` (in plan). A triangle crossing the
 region's outline is split by the vertical planes through the outline edges it
 crosses and each piece kept or dropped by its centre. Returns vertices, faces,
 roof flags and the dropped and split triangle counts."""
 from building_passages import _split
 faces=np.concatenate([facade,roof]).astype(np.int64);flags=np.r_[np.zeros(len(facade),bool),np.ones(len(roof),bool)];tri=positions[faces];xz=tri[:,:,[0,2]]
 segs=np.array([[c[k],c[k+1]] for g in shapely.get_parts(region) for ring in (g.exterior,*g.interiors) for c in [np.asarray(ring.coords)] for k in range(len(c)-1) if np.hypot(*(c[k+1]-c[k]))>1e-9])
 area=np.abs((xz[:,1,0]-xz[:,0,0])*(xz[:,2,1]-xz[:,0,1])-(xz[:,1,1]-xz[:,0,1])*(xz[:,2,0]-xz[:,0,0]));flat=area<1e-9
 shapes=np.empty(len(tri),dtype=object);shapes[~flat]=shapely.polygons(xz[~flat]);shapes[flat]=shapely.linestrings(xz[flat])
 hit,seg=STRtree(shapely.linestrings(segs)).query(shapes,predicate='intersects');crossed={}
 for h,s in zip(hit.tolist(),seg.tolist()):crossed.setdefault(h,[]).append(s)
 centre=xz.mean(1);inside=shapely.contains_xy(region,centre[:,0],centre[:,1]);whole=[i for i in range(len(tri)) if i not in crossed and not inside[i]]
 extra=[];new_faces=[];new_flags=[]
 for h in sorted(crossed):
  pieces=[list(tri[h])]
  for s in crossed[h]:
   a,b=segs[s];d=b-a;normal=np.array([-d[1],0.0,d[0]])/math.hypot(*d);offset=float(normal[0]*a[0]+normal[2]*a[1])
   pieces=[q for poly in pieces for q in _split(poly,normal,offset) if len(q)>=3]
  if not pieces:continue
  mid=np.array([np.mean([[v[0],v[2]] for v in q],axis=0) for q in pieces])
  for q,dropped in zip(pieces,shapely.contains_xy(region,mid[:,0],mid[:,1])):
   if dropped:continue
   base=len(positions)+len(extra);extra+=q;new_faces+=[[base,base+k,base+k+1] for k in range(1,len(q)-1)];new_flags+=[flags[h]]*(len(q)-2)
 vertices=np.concatenate([positions,np.asarray(extra,dtype=np.float64).reshape(-1,3)])
 faces=np.concatenate([faces[whole],np.asarray(new_faces,dtype=np.int64).reshape(-1,3)]);roof=np.r_[flags[whole],np.asarray(new_flags,dtype=bool)]
 return vertices,faces,roof,int(np.count_nonzero(inside&~np.isin(np.arange(len(tri)),list(crossed)))),len(crossed)


def survey_raster(positions,faces,cell=1.0):
 """(x0, z0, cell, lowest, highest): the survey mesh's lowest and highest point over
 each plan cell (nan where empty). A vertical face marks the cells along its plan
 segment, a sliver too thin to cover a cell centre the cell of its centroid."""
 x0=math.floor(positions[:,0].min())-1;z0=math.floor(positions[:,2].min())-1
 W=int(math.ceil((positions[:,0].max()-x0)/cell))+2;H=int(math.ceil((positions[:,2].max()-z0)/cell))+2;lo=np.full((H,W),np.inf);hi=np.full((H,W),-np.inf)
 def mark(i,j,a,b):
  if 0<=i<W and 0<=j<H:lo[j,i]=min(lo[j,i],a);hi[j,i]=max(hi[j,i],b)
 for tri in positions[faces]:
  xs,ys,zs=tri[:,0],tri[:,1],tri[:,2];ax,az=xs[1]-xs[0],zs[1]-zs[0];bx,bz=xs[2]-xs[0],zs[2]-zs[0];det=ax*bz-az*bx
  if abs(det)<1e-6*cell*cell:
   for a,c in ((0,1),(1,2),(2,0)):
    for t in np.linspace(0,1,int(math.hypot(xs[c]-xs[a],zs[c]-zs[a])/(cell*.5))+2):mark(int((xs[a]+(xs[c]-xs[a])*t-x0)//cell),int((zs[a]+(zs[c]-zs[a])*t-z0)//cell),ys.min(),ys.max())
   continue
  i0=max(0,int((xs.min()-x0)//cell));i1=min(W-1,int((xs.max()-x0)//cell));j0=max(0,int((zs.min()-z0)//cell));j1=min(H-1,int((zs.max()-z0)//cell))
  I,J=np.meshgrid(np.arange(i0,i1+1),np.arange(j0,j1+1));cx=x0+(I+.5)*cell-xs[0];cz=z0+(J+.5)*cell-zs[0]
  u=(cx*bz-cz*bx)/det;v=(ax*cz-az*cx)/det;m=(u>=-.02)&(v>=-.02)&(u+v<=1.02)
  if not m.any():mark(int((xs.mean()-x0)//cell),int((zs.mean()-z0)//cell),ys.min(),ys.max());continue
  y=ys[0]+u*(ys[1]-ys[0])+v*(ys[2]-ys[0]);np.minimum.at(lo,(J[m],I[m]),y[m]);np.maximum.at(hi,(J[m],I[m]),y[m])
 lo[np.isinf(lo)]=np.nan;hi[np.isinf(hi)]=np.nan
 return x0,z0,cell,lo,hi


def survey_cells(raster,p,t,half,reach=1.5):
 """Lowest and highest survey points, and the sample positions, over a station's footprint."""
 x0,z0,cell,lo,hi=raster;o,a=np.meshgrid(np.linspace(-half,half,max(3,int(2*half/.5)+1)),np.array([-reach,0,reach]))
 x=(p[0]-t[1]*o+t[0]*a).ravel();z=(p[1]+t[0]*o+t[1]*a).ravel();i=np.floor((x-x0)/cell).astype(int);j=np.floor((z-z0)/cell).astype(int)
 ok=(i>=0)&(j>=0)&(i<lo.shape[1])&(j<lo.shape[0]);ok[ok]=~np.isnan(lo[j[ok],i[ok]])
 return lo[j[ok],i[ok]],hi[j[ok],i[ok]],x[ok],z[ok]


def survey_surface(raster):
 """(x, z) -> the survey's top surface: the median of the highest points over the 3 x 3
 cells around the point (a parapet or kerb line is narrower), nan off the mesh."""
 x0,z0,cell,lo,hi=raster
 def at(x,z):
  i=int((x-x0)//cell);j=int((z-z0)//cell);block=hi[max(0,j-1):j+2,max(0,i-1):i+2]
  return float(np.nanmedian(block)) if np.isfinite(block).any() else math.nan
 return at


def survey_constraints(plan,raster):
 """Hold the southbound lower deck CLEAR_UNDER_TARGET beneath the surveyed upper deck
 (never closer than CLEAR_UNDER) up to its City Square curve, then climb steadily
 along the curve to the surveyed join."""
 last=None;e=plan.survey[0]
 for i in range(plan.curve):
  lo,_,_,_=survey_cells(raster,plan.points[i],plan.tangents[i],plan.widths[i]/2+.5)
  if not len(lo):continue
  bottom=float(lo.min());plan.ceiling[i]=min(plan.ceiling[i],bottom-CLEAR_UNDER-SURVEY_MARGIN);plan.hold[i]=bottom-CLEAR_UNDER_TARGET-SURVEY_MARGIN;last=i
 if last is None:return
 y0,y1=plan.hold[last],plan.fixed[e]
 for i in range(last+1,e):plan.hold[i]=y0+(y1-y0)*float(plan.along[i]-plan.along[last])/float(plan.along[e]-plan.along[last])


def survey_conflicts(plan,triangles,join):
 """Stations of a solved plan whose deck comes within CLEAR_UNDER beneath, or within
 the slab above, a triangle of the (cut) survey mesh over its footprint, outside
 `join` (the surveyed carriageway the deck merges onto)."""
 xz=triangles[:,:,[0,2]];y0=triangles[:,:,1].min(1);y1=triangles[:,:,1].max(1);centre=xz.mean(1);away=~shapely.contains_xy(join,centre[:,0],centre[:,1])
 area=np.abs((xz[:,1,0]-xz[:,0,0])*(xz[:,2,1]-xz[:,0,1])-(xz[:,1,1]-xz[:,0,1])*(xz[:,2,0]-xz[:,0,0]));flat=area<1e-9
 shapes=np.empty(len(xz),dtype=object);shapes[~flat]=shapely.polygons(xz[~flat]);shapes[flat]=shapely.linestrings(xz[flat]);tree=STRtree(shapes);out=[]
 for i,(p,t) in enumerate(zip(plan.points,plan.tangents)):
  if i in plan.fixed:continue
  h=plan.widths[i]/2;step=1.5;q=Polygon([(p[0]+sx*t[0]*step-sy*t[1]*h,p[1]+sx*t[1]*step+sy*t[0]*h) for sx,sy in ((-1,-1),(1,-1),(1,1),(-1,1))])
  hits=tree.query(q,predicate='intersects');y=plan.y[i];bad=[k for k in hits.tolist() if away[k] and y0[k]<y+CLEAR_UNDER and y1[k]>y-THICKNESS-.3]
  if bad:out.append({'road':plan.id,'at':round(float(plan.along[i]),1),'deck':round(float(y),2),'survey':[round(float(y0[bad].min()),2),round(float(y1[bad].max()),2)],'triangles':len(bad)})
 return out


class SurveyMesh:
 """The Zakim survey building in its package tile, cut once for the southbound lower
 deck: the tile entry records the cut (`surveyCut`), so a rerun on a cut package
 finds the same cut and leaves the mesh alone."""
 def __init__(self,data_dir,city):
  z=next(b for b in city['landmarkBuildings'] if b['id']==SURVEY_ID);size=city['tiles']['size']
  self.path=data_dir/city['tiles']['directory']/f"t_{math.floor(z['center'][0]/size)}_{math.floor(z['center'][1]/size)}.bin"
  self.header,self.buildings=read_tile(self.path);self.k=next(i for i,b in enumerate(self.buildings) if b['id']==SURVEY_ID);self.geometry=None;self.cells=None
 def cut(self,region,digest):
  entry=self.header['buildings'][self.k];mark=entry.get('surveyCut')
  if mark:
   if mark['sha256']!=digest:raise ValueError(f'{self.path.name}: the Zakim survey was cut for another lower deck; rebuild from a package without the I-93 stage')
   return mark
  b=self.buildings[self.k];vertices,faces,roof,dropped,split=cut_mesh(b['positions'],b['facade'],b['roof'],region)
  mark={'version':CUT_VERSION,'stage':'build-i93-north.py','sha256':digest,'droppedTriangles':dropped,'splitTriangles':split,'areaSquareMeters':round(float(region.area),1)}
  entry['surveyCut']=mark;generated={f:entry.pop(f) for f in ('collision','roadOverlaps','buildingPassage','v','f','r','scale') if f in entry};entry.update(generated)
  self.replace(vertices,faces,roof)
  return mark
 def repair_portal_approach(self):
  """Remove the detached survey shell that ends over the active southbound
  approach and the old outer parapet beyond the handoff to the tunnel wall."""
  entry=self.header['buildings'][self.k]
  if entry.get('portalApproachRepaired'):return
  b=self.buildings[self.k];v=b['positions'];seed=np.linalg.norm(v-PORTAL_SPUR_TIP,axis=1)<.15
  faces=np.concatenate([b['facade'],b['roof']]);roof=np.arange(len(faces))>=len(b['facade'])
  removed=seed[faces].any(axis=1)
  while True:
   seed[faces[removed]]=True
   expanded=seed[faces].any(axis=1)
   if np.array_equal(removed,expanded):break
   removed=expanded
  # Fail closed if a different survey edition welds the spur to the mainline.
  if removed.any():
   cut=v[faces[removed]]
   assert cut[:,:,0].min()>950 and cut[:,:,2].min()>-1980 and cut[:,:,1].max()<18,'unexpected Zakim portal spur extent'
  kept=faces[~removed];flags=roof[~removed]
  rail=LineString(PORTAL_RAIL_TAIL).buffer(1.25,cap_style='square')
  vertices,faces,roof,_,_=cut_mesh(v,kept[~flags],kept[flags],rail)
  entry['portalApproachRepaired']=True
  self.replace(vertices,faces,roof)
 def replace(self,vertices,faces,roof):
  entry=self.header['buildings'][self.k];b=self.buildings[self.k]
  record=mesh_record(vertices,faces,entry['anchor'],entry['baseElevation'],repair_winding=False,roof_mask=roof);q,facade,roof_faces,scale=record
  self.geometry=[record if i==self.k else (np.rint((x['positions']-np.asarray(x['anchor']))/x.get('scale',SCALE)).astype(np.int16),x['facade'],x['roof'],x.get('scale',SCALE)) for i,x in enumerate(self.buildings)]
  # Continue with the survey as the tile stores it, as a rerun reads it back.
  b['positions']=q.astype(np.float64)*scale+np.asarray(entry['anchor'],dtype=np.float64);b['facade']=facade.astype(np.int64);b['roof']=roof_faces.astype(np.int64);self.cells=None
 def triangles(self):b=self.buildings[self.k];return b['positions'][np.concatenate([b['facade'],b['roof']])]
 def raster(self):
  if self.cells is None:b=self.buildings[self.k];self.cells=survey_raster(b['positions'],np.concatenate([b['facade'],b['roof']]))
  return self.cells
 def write(self):
  if self.geometry is not None:write_tile(self.path,self.header,self.geometry)


def tunnel_joins(data_dir,city):
 """End points the survey traces continue, as [x, z, height]: the Central Artery tunnel
 bores' surveyed ends, the end of the tunnel's Cross Street entrance beside the
 northbound bore (with its direction, half width and name) and the Leverett
 Connector's northbound end."""
 tunnel={r['id']:r for r in json.loads((data_dir/city['tunnels']['file']).read_text())['roads']};roads={r['id']:r for r in city['roads']}
 nb=tunnel['central-artery-northbound'];sb=tunnel['central-artery-southbound'];cross=tunnel['central-artery-cross-street-north-on'];lev=roads['leverett-connector-north']
 return {'northbound':[*nb['points'][-1],nb['elevations'][-1]],'southbound':[*sb['points'][0],sb['elevations'][0]],'leverett':[*lev['points'][-1],lev['elevations'][-1]],
  'cross':[*cross['points'][-1],cross['elevations'][-1]],'crossTangent':unit(cross['points'][-2],cross['points'][-1]).tolist(),'crossHalf':cross['width']/2,'crossName':cross['name']}


def hermite(p0,t0,p1,t1,step=3.0):
 """Interior points of a cubic Hermite curve from p0 to p1 with unit end directions t0, t1."""
 p0,p1,t0,t1=(np.asarray(v,dtype=float) for v in (p0,p1,t0,t1));L=float(np.linalg.norm(p1-p0));m=max(2,math.ceil(L/step))
 return [((2*u**3-3*u**2+1)*p0+(u**3-2*u**2+u)*L*t0+(3*u**2-2*u**3)*p1+(u**3-u**2)*L*t1,u) for u in (k/m for k in range(1,m))]


def unit(a,b):d=np.subtract(b,a,dtype=float);return d/np.linalg.norm(d)


def trace_points(pieces,start,end,blend=(TRACE_BLEND,TRACE_BLEND)):
 """[x, z, height, half width, lanes, piece] along consecutive traced pieces from the
 projection of `start` to that of `end` ([x, z, height]). The tracer splits pieces
 where the deck changes, often a few metres sideways, so each joint is cut back
 JOINT metres both ways and bridged by a Hermite curve (the piece changes at its
 middle). The stations `blend` metres from each end shift onto the two points,
 which the trace starts and ends on exactly."""
 st=[]
 for k,p in enumerate(pieces):
  rows=[[*q[:4],q[4] if len(q)>4 else 1,k] for q in p]
  if st:
   along=stations([q[:2] for q in st]);tail=[q for q,d in zip(st,along) if q[5]!=k-1 or d<=along[-1]-JOINT];head=rows
   ra=stations([q[:2] for q in rows]);head=[q for q,d in zip(rows,ra) if d>=JOINT] or rows[-2:]
   if tail[-1][5]!=k-1 or len(tail)<2:tail=st[:-1]
   a,b=tail[-1],head[0]
   bridge=[[float(q[0]),float(q[1]),a[2]+(b[2]-a[2])*u,a[3]+(b[3]-a[3])*u,a[4] if u<.5 else b[4],k-1 if u<.5 else k] for q,u in hermite(a[:2],unit(tail[-2][:2],a[:2]),b[:2],unit(b[:2],head[1][:2]))]
   st=tail+bridge+head
  else:st=rows
 xz=[q[:2] for q in st];line=LineString(xz);along=np.asarray(stations(xz));ends=[]
 for p in (start,end):
  d=line.project(Point(p[:2]));f=line.interpolate(d);n=int(np.argmin(np.abs(along-d)))
  ends.append((d,(p[0]-f.x,p[1]-f.y,p[2]-float(np.interp(d,along,[q[2] for q in st]))-LIFT),st[n]))
 (a,oa,sa),(b,ob,sb)=ends;pts=[[*start,sa[3],sa[4],sa[5]]]
 for q,d in zip(st,along):
  if a+1.5<d<b-1.5:
   wa=1-smooth((d-a)/blend[0]);wb=1-smooth((b-d)/blend[1])
   pts.append([q[0]+oa[0]*wa+ob[0]*wb,q[1]+oa[1]*wa+ob[1]*wb,q[2]+LIFT+oa[2]*wa+ob[2]*wb,q[3],q[4],q[5]])
 return pts+[[*end,sb[3],sb[4],sb[5]]]


def merge_points(pts,join,tangent,half,surface,reach=CROSS_MERGE):
 """[x, z, height, half width, lanes, piece] from a ramp end beside the start of trace
 `pts` (`join` [x, z, height], leaving along `tangent`) to the vertex of `pts` nearest
 `reach` metres along it: a Hermite curve LIFT over the survey (`surface(x, z)`, eased
 over three stations against the raster's 1 m steps), its heights shifted onto both
 end points within TRACE_BLEND metres of them."""
 along=np.asarray(stations([p[:2] for p in pts]));k=int(np.argmin(np.abs(along-reach)));end=pts[k]
 xz=[list(map(float,join[:2]))]+[[float(q[0]),float(q[1])] for q,_ in hermite(join[:2],tangent,end[:2],unit(pts[k-1][:2],pts[k+1][:2]))]+[list(map(float,end[:2]))]
 d=np.asarray(stations(xz));top=np.array([surface(*q) for q in xz])+LIFT;ok=np.isfinite(top);assert ok.any(),'the Cross Street merge lies off the survey'
 top=np.interp(d,d[ok],top[ok]);top=np.convolve(np.pad(top,1,mode='edge'),[.25,.5,.25],'valid');b=min(TRACE_BLEND,d[-1]/2);start,stop=join[2]-top[0],end[2]-top[-1];lanes=1 if 2*half<RAMP_WIDTHS[2] else 2
 rows=[[q[0],q[1],float(y+start*(1-smooth(t/b))+stop*(1-smooth((d[-1]-t)/b))),half,lanes,0] for q,y,t in zip(xz,top,d)]
 rows[0][:3]=list(join[:3]);rows[-1][:3]=list(end[:3]);return rows


def trace_records(source,main,joins,neighborhoods,surface=None):
 """Road records over the drivable survey (`surveyDeck`, never drawn: the mesh is the
 road) for traffic, GPS and the HUD street name: the northbound carriageway from the
 tunnel's end to the northbound deck, split where the Leverett Connector ramp joins
 it (GPS only, like the connector), the tunnel's Cross Street entrance onto the
 northbound trace (with `surface`, the survey's top), and the Zakim's southbound
 carriageway from the lower deck to the tunnel. One record per traced piece (split
 at MAX_PIECE); each chain starts and ends exactly on the record it continues."""
 sv=source['survey'];nb,sb=main['nb'],main['sb'];out=[]
 nb_pts=trace_points(sv['northbound'],joins['northbound'],[*nb.points[0],round(nb.y[0],3)])
 J=next(p for p in nb_pts if p[5]==len(sv['northbound'])-1)
 chains=[('i93-zakim-nb','I-93 North · {}','motorway',nb_pts),('i93-zakim-leverett-nb','Leverett Connector','motorway_link',trace_points(sv['leverettNorthbound'],joins['leverett'],J[:3],(TRACE_BLEND,2*TRACE_BLEND))),
  ('i93-zakim-sb','I-93 South · {}','motorway',trace_points(sv['southbound'],[*sb.points[-1],round(sb.y[-1],3)],joins['southbound']))]
 if surface is not None and 'cross' in joins:chains.insert(1,('i93-zakim-cross-nb',joins['crossName'],'motorway_link',merge_points(nb_pts,joins['cross'],joins['crossTangent'],joins['crossHalf'],surface)))
 for prefix,name,kind,pts in chains:
  bounds=[0]+[i for i in range(1,len(pts)-1) if pts[i][5]!=pts[i-1][5]]+[len(pts)-1];marks=[0]
  for a,b in zip(bounds,bounds[1:]):
   span=stations([p[:2] for p in pts[a:b+1]]);parts=math.ceil(span[-1]/MAX_PIECE-1e-9)
   for k in range(1,parts):marks.append(a+int(np.argmin(np.abs(np.asarray(span)-span[-1]*k/parts))))
   marks.append(b)
  for k,(a,b) in enumerate(zip(marks,marks[1:])):
   seg=pts[a:b+1];lanes=sorted({p[4] for p in seg},key=lambda l:(-sum(p[4]==l for p in seg),l))[0];w=[round(min(20,2*p[3]),3) for p in seg]
   lanes=max(1,min(2,lanes)) if kind=='motorway_link' else max(2,min(5,lanes))
   place=place_name(seg[len(seg)//2][:2],neighborhoods) or 'Zakim Bridge'
   rec={'id':f'{prefix}-{k+1:02d}','name':name.format(place),'kind':kind,'points':[[round(p[0],4),round(p[1],4)] for p in seg],
    'width':max(w),'oneway':1,'lanes':lanes,'elevations':[round(p[2],4) for p in seg],'startLevel':1,'endLevel':1,'deckWidths':w,
    'bridge':{'id':'i93','kind':TRACE,'thickness':THICKNESS,'clearanceEstimated':True,'sourceLayer':3},'surveyDeck':SURVEY_ID}
   if prefix=='i93-zakim-leverett-nb':rec['traffic']=False
   out.append(rec)
 return out


def ramp_plans(ways):
 out=[]
 for spec in RAMPS:
  points,owner=concat(ways,spec['ways'])
  if 'from' in spec or 'until' in spec:
   at=spec.get('from') or spec.get('until');d=LineString(points).project(Point(at))
   points,owner=cut_line(points,owner,start=d) if 'from' in spec else cut_line(points,owner,end=d)
   points[0 if 'from' in spec else -1]=list(at)
  rp,ro=resample_owned(points,owner);lanes=[lanes_of(ways,o,True) for o in ro]
  plan=Plan(spec['id'],rp,ro,taper(rp,[RAMP_WIDTHS[l] for l in lanes],40),RAMP_GRADE,lanes);plan.spec=spec;out.append(plan)
 return out


def widen_ramps(ramps,main,existing,ground,footprints):
 """Cap each added shoulder along full segments, including between stations.
 Reserve room for a sibling ramp's extra shoulder and keep the baseline
 section wherever a street, deck or building already touches it. Fit to the
 solved deck height and graded ground so a wider ramp keeps its profile."""
 lines=[LineString(r['points']) for r in existing];tree=STRtree(lines)
 obstacles={p:strip([(*q,0,w/2) for q,w in zip(p.points,p.widths)],RAMP_SHOULDER if p in ramps else 0) for p in [*main,*ramps]}
 street_reach=max((r['width']/2+CORRIDOR for r in existing),default=0)
 for plan in ramps:
  reach=max(plan.widths)/2+RAMP_SHOULDER+RAMP_EDGE_MARGIN
  x0,z0,x1,z1=plan.line.bounds
  houses=[Polygon(f) for f in footprints((x0-reach,z0-reach,x1+reach,z1+reach)) if len(f)>=3]
  streets=[lines[j].buffer(existing[j]['width']/2+(0 if existing[j].get('elevations') else CORRIDOR))
   for j in tree.query(plan.line,predicate='dwithin',distance=reach+street_reach)]
  nearby=STRtree([*houses,*streets,*(shape for other,shape in obstacles.items() if other is not plan)])
  extra=[RAMP_SHOULDER]*len(plan.points);extra[0]=extra[-1]=0
  for i,(a,b) in enumerate(zip(plan.points,plan.points[1:])):
   segment=LineString([a,b]);half=max(plan.widths[i:i+2])/2
   gap=min((segment.distance(nearby.geometries[j]) for j in nearby.query(segment,predicate='dwithin',distance=half+RAMP_SHOULDER+RAMP_EDGE_MARGIN)),default=math.inf)
   room=max(0,gap-half-RAMP_EDGE_MARGIN)
   extra[i]=min(extra[i],room);extra[i+1]=min(extra[i+1],room)
  for i,(p,t,w,y) in enumerate(zip(plan.points,plan.tangents,plan.widths,plan.y)):
   while extra[i]>0 and ground.across(p,t,w/2+extra[i])>y-.12:extra[i]=max(0,extra[i]-.125)
  for i in range(1,len(extra)):extra[i]=min(extra[i],extra[i-1]+(plan.along[i]-plan.along[i-1])/RAMP_TAPER)
  for i in range(len(extra)-2,-1,-1):extra[i]=min(extra[i],extra[i+1]+(plan.along[i+1]-plan.along[i])/RAMP_TAPER)
  plan.widths=[round(w+2*e,3) for w,e in zip(plan.widths,extra)]


def classify(p,plan,main,ramps,streets):
 """How a ramp end meets the network: a street vertex, a carriageway vertex (gore) or another ramp's end or vertex (node)."""
 k=key(p)
 if k in streets:return ('street',streets[k])
 for other in main.values():
  for i,q in enumerate(other.points):
   if key(q)==k:return ('gore',other,i)
 for other in ramps:
  if other is plan:continue
  for i,q in enumerate(other.points):
   if key(q)==k:return ('node',other,i)
 return None


def overlap(plan,e,other):
 """(station, height of `other` there) for the stations of `plan` from end `e` inward while their pavements
 overlap, through gaps shorter than OVERLAP_REACH (two diverging source lines wander apart and back)."""
 out=[];last=None
 for i in (range(len(plan.points)) if e==0 else range(len(plan.points)-1,-1,-1)):
  p=Point(plan.points[i]);d=other.line.project(p)
  if other.line.distance(p)<=(plan.widths[i]+other.width_at(d))/2-OVERLAP_SLACK:last=i
  elif last is None or abs(plan.along[i]-plan.along[last])>OVERLAP_REACH:break
  out.append((i,other.at(d)))
 return [(i,y) for i,y in out if last is not None and (i<=last if e==0 else i>=last)]


def match_overlap(plan,e,other):
 """Fix the ramp to the road it leaves or joins while their pavements overlap, walking in from end `e`."""
 for i,y in overlap(plan,e,other):plan.fixed[i]=round(y,4)


def node_trunks(ramps):
 """Ramp ends meeting at one point would each take the other's height and keep the first
 sweep's guess. The trunk there (the one end of its kind: an exit's end before its branches,
 an entrance's start after them, the upstream end of a plain continuation) is solved free at
 that point every sweep and the others start or end at its height: returns the trunk ends
 (plan, end) and points the other ends there at the trunk. Ends on a ramp running through
 the point take that ramp's height there instead."""
 meeting=defaultdict(list);trunks=set();through={key(q):(plan,i) for plan in ramps for i,q in enumerate(plan.points[1:-1],1)}
 for plan in ramps:
  for e in (0,1):
   if plan.ends[e][0]=='node':meeting[key(plan.points[0 if e==0 else -1])].append((plan,e))
 for k,group in meeting.items():
  if k in through:
   for p,e in group:
    if through[k][0] is not p:p.ends[e]=('node',*through[k])
   continue
  if len(group)<2:continue
  unique=[(p,e) for p,e in group if sum(f==e for _,f in group)==1];trunk=max(unique,key=lambda t:t[1]) if unique else group[0];trunks.add(trunk)
  for p,e in group:
   if (p,e)!=trunk:p.ends[e]=('node',trunk[0],0 if trunk[1]==0 else len(trunk[0].points)-1)
 return trunks


def ordered(ramps,leads,trunks):
 """The ramps, each after those it takes heights from (the trunk or ramp it starts or ends on, a sibling it follows)."""
 deps={p:[k[1] for e,k in enumerate(p.ends) if k[0]=='node' and (p,e) not in trunks]+[o for o,_ in leads.get(p.id,())] for p in ramps};out=[];done=set()
 def visit(p,path):
  if p in done or p in path:return
  for q in deps[p]:visit(q,path|{p})
  done.add(p);out.append(p)
 for p in ramps:visit(p,frozenset())
 return out


def in_the_open(plan):
 """The stations of a solved carriageway that run in the open: not held beneath the surveyed viaduct (plan.hold, the
 southbound lower deck). Its twin beside it comes up to it there."""
 return [h is None for h in plan.hold]


def may_rise(plan):
 """Of those, the stations a twin may lift: none on the survey (plan.fixed: the deck laid over the surveyed carriageway
 at a mouth of the viaduct keeps the survey's height)."""
 return [o and i not in plan.fixed for i,o in enumerate(in_the_open(plan))]


def one_level(heights,beside,near,level):
 """alongside's (beside, near) of a carriageway at `heights` whose twin stands at `level(distance)`, less the
 stretches between two levels of the road: where the twin stands a storey over it (STOREY: a slab and the room under
 it) the two are on two levels, not a step apart across a median (the southbound carriageway climbing to the lower
 deck of the Charlestown viaduct beside the northbound one coming down from the upper), and the whole stretch along
 which the twin stands over it on the way there, by more than TWIN_STEP throughout, is the way between them. Each
 keeps its own height along it, and a lift ends before it as before any station that keeps its height."""
 over=[level(s)-heights[i] if s is not None else 0. for i,s in enumerate(beside)];apart=[False]*len(over)
 for a,b in runs([v>TWIN_STEP for v in over]):
  if max(over[a:b+1])>=STOREY:apart[a:b+1]=[True]*(b-a+1)
 return [None if a else s for s,a in zip(beside,apart)],[v and not a for v,a in zip(near,apart)]


def overhead(plan,decks,ground):
 """The height a road's surface may reach under the decks that lie over its pavement, per station (inf where none
 does): CLEAR_UNDER beneath the lowest underside over its cross-section. A bridge that ends at the shoulder and a
 street carried over the trench's edge on a deck piece (carry_overpasses) do not cross the centre line, so no crossing
 window holds them (constrain_existing), and a lift must end under them all the same."""
 n=len(plan.points);out=[math.inf]*n
 if not decks:return out
 lines=[LineString(r['points']) for r in decks];reach=[max(r.get('deckWidths') or [r['width']])/2 for r in decks];pts=shapely.points(plan.points);half=np.asarray(plan.widths,float)/2
 for j in sorted(STRtree(lines).query(plan.line,predicate='dwithin',distance=float(half.max())+max(reach)).tolist()):
  r=decks[j];thick=r.get('bridge',{}).get('thickness',THICKNESS)
  for i in np.flatnonzero(shapely.distance(lines[j],pts)<=half+reach[j]).tolist():
   (x,z),(tx,tz)=plan.points[i],plan.tangents[i];over=[]
   for o in np.linspace(-plan.widths[i]/2,plan.widths[i]/2,5).tolist():
    q=(x-tz*o,z+tx*o)
    if lines[j].distance(Point(q))<=reach[j]:over.append(road_height(r,q,ground))
   if over and min(over)-thick>plan.y[i]:out[i]=min(out[i],min(over)-thick-CLEAR_UNDER)
 return out


def graded_lift(plan,heights,lift):
 """A lift (twin_lift) held once more under what the road's grade leaves it to rise and to fall by from station to
 station: the rounding of its corners (eased) takes the flank of a crest a little past that on a road that runs at
 its grade (the northbound carriageway coming down to the Mystic Valley Parkway, 5.54% for 5.5%), and the stage holds
 every profile to its grade."""
 x=np.asarray(plan.along,float);h=np.maximum(np.diff(x),1e-6);slope=np.diff(np.asarray(heights,float))/h;limit=plan.grade-1e-4
 return lower_envelope(lift,[0.,*(np.maximum(0.,limit-slope)*h).tolist()],[0.,*(np.maximum(0.,limit+slope)*h).tolist()])


def build(city,source,graded,water,survey=None,twins=True):
 """New road plans solved against the package and a report. `graded` is the
 int16 graded grid (with any earlier I-93 cut restored); `water` is
 (polygons, level(x,z)); `survey(plan)` cuts the survey mesh for the southbound
 plan and returns its raster (survey_raster), which bounds the lower deck, and its
 triangles, which the solved deck must clear. With `twins` the two carriageways are
 brought to one height where they run alongside each other (see the module text);
 every plan keeps the heights it was solved with alone in plan.solo."""
 ways={w['id']:w for w in source['ways']};ground=Terrain(city['elevation'],graded)
 existing=[r for r in city['roads'] if not stage_owned(r)]
 lines=[LineString(r['points']) for r in existing];tree=STRtree(lines);streets={}
 for r in existing:
  for i,p in enumerate(r['points']):streets.setdefault(key(p),[]).append((r,i))
 report={'crossings':[],'unresolved':[],'grades':{},'infeasible':[],'newCrossings':[],'surveyConflicts':[]}
 main=carriageways(source,city,ways);ramps=ramp_plans(ways);plans=[*main.values(),*ramps];raster,triangles=survey(main['sb']) if survey else (None,None)
 for plan in plans:constrain_existing(plan,ways,ground,existing,lines,tree,water,report)
 if raster is not None:survey_constraints(main['sb'],raster)
 for plan in ramps:
  for e in (0,1):
   p=plan.points[0 if e==0 else -1];kind=classify(p,plan,main,ramps,streets)
   assert kind,f'{plan.id} {"starts" if e==0 else "ends"} off the network at {p}'
   plan.ends[e]=kind
   if kind[0]=='street':
    plan.landing[e]=True
    for i,s in enumerate(plan.along):
     dist=s if e==0 else plan.along[-1]-s
     if dist<LANDING_TAPER:plan.allowance[i]=min(plan.allowance[i],dist/LANDING_TAPER)
 trunks=node_trunks(ramps)
 # Crossings between new roads: the higher source layer, then the bridge tag, goes over.
 nlines=[p.line for p in plans];ntree=STRtree(nlines);pairs=[];unders=[]
 for plan in plans:
  for other,d,half,p,k in crossing_windows(plan,plans,nlines,ntree):
   ko=other.nearest(p);a=ways[plan.owner[k]]['tags'];b=ways[other.owner[ko]]['tags'];la,lb=effective_layer(a),effective_layer(b)
   # Untagged crossings of a ramp and a carriageway: the ramp passes under.
   if la==lb and (plan in main.values())!=(other in main.values()):la,lb=(1,0) if plan in main.values() else (0,1)
   if la==lb:report['unresolved'].append({'road':plan.id,'other':other.id,'point':[round(v,2) for v in p],'layer':la});continue
   if la>lb:pairs.append((plan,other,d,half,p,ko));report['newCrossings'].append({'over':plan.id,'under':other.id,'point':[round(v,2) for v in p]})
   else:unders.append((plan,other,d,half,p,ko))
 base={plan:(list(plan.floor),list(plan.lift),list(plan.ceiling),list(plan.drop)) for plan in plans}
 def across(plan,i,other):
  # The other road's heights wherever it lies under (or over) station i's cross-section.
  (x,z),(tx,tz)=plan.points[i],plan.tangents[i];out=[]
  for o in np.linspace(-plan.widths[i]/2,plan.widths[i]/2,5).tolist():
   q=Point(x-tz*o,z+tx*o);e=other.line.project(q)
   if other.line.distance(q)<=other.width_at(e)/2:out.append(other.at(e))
  return out
 def apply_pairs(plan):
  # Crossings between new roads, from the other road's latest heights (reset each time, so a
  # deck raised over a ramp that has since gone down comes down with it): the upper deck clears
  # the lower one's top across its cross-section and the lower one stays under the upper slab.
  plan.floor,plan.lift,plan.ceiling,plan.drop=(list(v) for v in base[plan])
  for upper,lower,d,half,p,ko in pairs:
   if upper is not plan:continue
   for i in upper.window(d,half):
    top=max([lower.y[ko],*across(upper,i,lower)]) if lower.y else lower.terrain[ko]+TERRAIN_RISE
    upper.floor[i]=max(upper.floor[i],top+THICKNESS+CLEAR_OVER);upper.lift[i]=max(upper.lift[i],top+THICKNESS+CLEAR_OVER_TARGET)
  for lower,upper,d,half,p,ko in unders:
   if lower is not plan or upper.y is None:continue
   for i in lower.window(d,half):
    bottom=min([upper.y[ko],*across(lower,i,upper)])-THICKNESS
    lower.ceiling[i]=min(lower.ceiling[i],bottom-CLEAR_OVER);lower.drop[i]=min(lower.drop[i],bottom-CLEAR_OVER_TARGET)
 # Ramps leaving (or joining) at one point run side by side at first. After a first sweep that
 # solves them apart, the lower one keeps the higher one's height while their pavements overlap
 # (raising a deck never takes it into the ground).
 leads=defaultdict(list)
 def bind(plan):
  # What a ramp is solved between: its ends, the stations held to the roads it leaves, joins or follows, and its bounds.
  plan.fixed={}
  for e,kind in enumerate(plan.ends):
   i=0 if e==0 else len(plan.points)-1
   if kind[0]=='street':r,j=kind[1][0];plan.fixed[i]=round(road_height(r,r['points'][j],ground),4)
   elif (plan,e) in trunks:continue
   elif kind[1].y is not None:plan.fixed[i]=round(kind[1].y[kind[2]],4);match_overlap(plan,e,kind[1])
   for o,f in leads[plan.id]:
    if f==e:match_overlap(plan,e,o)
  apply_pairs(plan)
 for sweep in range(3):
  report['infeasible']=[]
  for plan in main.values():apply_pairs(plan);solve(plan,report)
  for plan in ordered(ramps,leads,trunks):bind(plan);solve(plan,report)
  if sweep==0:
   for a,b in ((a,b) for k,a in enumerate(ramps) for b in ramps[k+1:]):
    for e in (0,1):
     i=0 if e==0 else -1;shared=overlap(a,e,b) if key(a.points[i])==key(b.points[i]) else []
     if shared:lower,upper=(a,b) if sum(y-a.y[j] for j,y in shared)>0 else (b,a);leads[lower.id].append((upper,e))
 # The two carriageways, each solved on its own ground, come out a step apart where that ground or what they pass differs
 # across the median (a bridge that stands higher over the one than over the other, two approaches that begin a few stations
 # apart), and their pavements meet along most of the road. They are brought to one height where they run alongside each other
 # in the open. Every plan first keeps the heights it has alone (plan.solo): the cut, the streets carried over it and the
 # ramps' shoulders are judged on those (install), so lifting a road moves none of them.
 report['twins']={'pairs':[],'ramps':[]}
 for plan in plans:plan.solo=list(plan.y)
 # (the cut under the decks and the streets carried over its edge on deck pieces, made here for the same reason, and
 # because a lift ends under those pieces as under any deck over the pavement)
 grid=city['elevation'];report['cut']=cut_plan(plans,grid,graded)
 report['carried']=carry_overpasses(city['roads'],sorted({c['under'] for c in report['crossings'] if 'under' in c}),grid,ground,report['cut'][1])
 above=[r for r in existing if r.get('elevations') and not r.get('tunnel') and r['id'] not in report['carried'][0]]+[x for k in sorted(report['carried'][0]) for x in report['carried'][0][k] if x.get('elevations')]
 def couple(a,b):
  # The lower follows the higher: `a` rises to its twin's profile wherever that stands higher, and `b` then to what `a`
  # has become, so the two are one where both may move and each keeps its own height elsewhere.
  ua,ub=list(a.y),list(b.y)
  for plan in (a,b):
   apply_pairs(plan)   # (its bounds as the ramps now lie: the ceilings)
   plan.ceiling=[min(c,o) for c,o in zip(plan.ceiling,overhead(plan,above,ground))]
  sa,na=one_level(ua,*alongside(a,b,may_rise(a),in_the_open(b)),b.at);a.y=[round(y+v,4) for y,v in zip(ua,graded_lift(a,ua,twin_lift(a,ua,sa,na,b.at)))]
  sb,nb=one_level(ub,*alongside(b,a,may_rise(b),in_the_open(a)),a.at);b.y=[round(y+v,4) for y,v in zip(ub,graded_lift(b,ub,twin_lift(b,ub,sb,nb,a.at)))]
  def tally(plan,u):
   lift=np.asarray(plan.y)-np.asarray(u);rows=np.flatnonzero(lift>.02).tolist();return {'meters':round(float(sum(plan.along[min(len(u)-1,i+1)]-plan.along[i] for i in rows)),1),'max':round(float(lift.max()),3)}
  def beside(plan,other):
   # (where only a median lies between the two, whatever either may do there)
   return alongside(plan,other,[True]*len(plan.points),[True]*len(other.points))
  def apart(plan,other):
   # what stays under its twin although only a median lies between them: a station that keeps its height and the fade
   # before it, the room under a bridge, another level
   s,near=beside(plan,other);under=[other.at(v)-plan.y[i] if v is not None and near[i] else 0. for i,v in enumerate(s)]
   return [[i,j,round(float(max(under[i:j+1])),3)] for i,j in runs([v>TWIN_STEP for v in under])]
  return {'roads':[a.id,b.id],'alongsideMeters':round(float(sum(a.along[min(len(ua)-1,i+1)]-a.along[i] for i,v in enumerate(beside(a,b)[1]) if v)),1),'lifted':{a.id:tally(a,ua),b.id:tally(b,ub)},'apart':{a.id:apart(a,b),b.id:apart(b,a)}}
 if twins:
  # A ramp is solved again when what it is solved between has changed: the carriageway it leaves or joins, a ramp it follows or crosses.
  def reads(plan):bind(plan);return (tuple(sorted(plan.fixed.items())),*(tuple(v) for v in (plan.floor,plan.lift,plan.ceiling,plan.drop)))
  known={plan.id:reads(plan) for plan in ordered(ramps,leads,trunks)}
  report['twins']['pairs']=[couple(main['nb'],main['sb'])];again=set()
  if max(v['max'] for v in report['twins']['pairs'][0]['lifted'].values())>LIFTED:
   for _ in range(8):
    late=False
    for plan in ordered(ramps,leads,trunks):
     now=reads(plan)
     if now!=known[plan.id]:
      known[plan.id]=now;report['infeasible']=[x for x in report['infeasible'] if x['road']!=plan.id];solve(plan,report);again.add(plan.id);late=True
      # (a ramp only ever rises with its carriageway: a station the spline lets sag beside the lift stays where it was)
      plan.y=[max(y,u) for y,u in zip(plan.y,plan.solo)]
    if not late:break
   else:raise AssertionError('the ramps of the lifted carriageways did not settle')
  report['twins']['ramps']=sorted(again)
 if raster is not None:report['surveyConflicts']=survey_conflicts(main['sb'],triangles,strip(source['survey']['southbound'][0],KEEP_MARGIN+.5))
 return main,ramps,report


def cut_plan(plans,grid,heights):
 """The unprotected cut of the graded grid under the decks: {vertex: allowed
 height} and the vertices a clean deck edge needs lowered (inside a footprint or
 its first cell beyond the edge).

 Where the terrain comes within 5 cm of a deck surface (under an overpass the
 expressway sits below the bare-earth DEM, which fills the removed bridge), the
 grid drops to CUT_BELOW under the deck and SHELF metres beyond its edge (so the
 bilinear surface of a cell straddling the edge stays under the deck), then
 rises at WALL. A ramp meeting its street at grade (inside its landing taper)
 cuts nothing."""
 scale=grid.get('scale',.01);W=grid['width'];C=grid['cellSize'];ox,oz=grid['originX'],grid['originZ']
 values=heights.astype(np.float64)*scale;allowed={};must=set()
 for plan in plans:
  y=np.asarray(plan.y);allow=np.asarray(plan.allowance);intrude=(np.asarray(plan.terrain)>y-.05)&(allow>.999)
  if not intrude.any():continue
  depth=float(np.max(np.asarray(plan.terrain)[intrude]-y[intrude]))+CUT_BELOW
  idx=np.flatnonzero(intrude);a,b=max(0,idx[0]-2),min(len(y)-1,idx[-1]+2)
  reach=max(plan.widths[a:b+1])/2+SHELF+depth/WALL+C
  region=LineString(plan.points[a:b+1]).buffer(reach);x0,z0,x1,z1=region.bounds
  i0,i1=int((x0-ox)//C),int((x1-ox)//C)+1;j0,j1=int((z0-oz)//C),int((z1-oz)//C)+1
  gi,gj=np.meshgrid(np.arange(i0,i1+1),np.arange(j0,j1+1));gx=ox+gi.ravel()*C;gz=oz+gj.ravel()*C;flat=gj.ravel()*W+gi.ravel()
  inside=shapely.contains_xy(region,gx,gz);gx,gz,flat=gx[inside],gz[inside],flat[inside]
  pts=shapely.points(gx,gz);d=shapely.line_locate_point(plan.line,pts);e=shapely.distance(plan.line,pts)
  yd=np.interp(d,plan.along,y);half=np.interp(d,plan.along,plan.widths)/2;beyond=np.maximum(0,e-half-SHELF)*WALL
  hit=(values[flat]>yd-.05+beyond)&(np.interp(d,plan.along,allow)>.999)
  for k in np.flatnonzero(hit):
   v=int(flat[k]);low=yd[k]-CUT_BELOW+beyond[k]
   if low<allowed.get(v,math.inf):allowed[v]=low
   if e[k]<=half[k]+C and values[v]-low>.05:must.add(v)
 return allowed,must


def carry_overpasses(roads,decks,grid,ground,must):
 """Carry the streets meeting the given overpass decks on short decks over the
 trench edge, as level-north-overpasses.py does: a source bridge over the
 expressway can end at the shoulder (Roosevelt Circle spans both carriageways
 edge to edge), and the 6 m grid cannot hold a street at its height there with
 the trench a cell away. Each street meeting a deck end becomes a deck piece
 (bridge kind APPROACH, at its graded heights) up to the first station whose
 corridor cells no longer meet a vertex the cut needs (`must`), split there, or
 taken whole when the rest would be shorter than TAIL. Returns
 ({street id: replacement roads}, notes)."""
 from north_overpasses import walk,split_line,deck_piece,node,half_width,STEP,TAIL,PIECE
 by_id={r['id']:r for r in roads};ends={};joints={};replaced={};notes=[]
 for r in roads:
  for e in (0,-1):
   ends.setdefault(node(r['points'][e]),[]).append((r['id'],e))
   if r.get('elevations'):joints.setdefault(node(r['points'][e]),r['elevations'][e])
 queue=[node(by_id[d]['points'][e]) for d in decks for e in (0,-1)];seen=set();walked=set()
 while queue:
  key=queue.pop(0)
  if key in seen:continue
  seen.add(key)
  for road_id,e in sorted(ends.get(key,[])):
   road=by_id[road_id]
   if road_id in walked or road.get('elevations') or road.get('tunnel'):continue
   walked.add(road_id);line=road['points'] if e==0 else road['points'][::-1];samples,total=walk(line,grid,must,half_width(road))
   last=max((s for s,hit in samples if hit),default=None)
   if last is None:continue
   if last>CARRY_MAX:notes.append({'road':road_id,'name':road['name'],'reason':f'meets the cut {last:.0f} m from the deck end'});continue
   if road.get('sourceSeam') or road.get('sourcePoints') or road.get('townSeam'):notes.append({'road':road_id,'name':road['name'],'reason':'carries source records a deck piece would lose'});continue
   split=max(last+STEP,PIECE)
   if total-split<TAIL:
    piece=deck_piece(road,road['points'],road_id,ground,joints);parts=[piece]
    if samples[-1][1]:queue.append(node(line[-1]))
   else:
    head,tail=split_line(line,split);piece=deck_piece(road,head if e==0 else head[::-1],f'{road_id}-deck',ground,joints)
    rest={**copy.deepcopy(road),'points':tail if e==0 else tail[::-1]};parts=[piece,rest] if e==0 else [rest,piece]
   piece['bridge']={'id':f"{PREFIX}{piece['id']}",'thickness':THICKNESS,'clearanceEstimated':True,'kind':APPROACH}
   replaced[road_id]=parts
   for k in (0,-1):joints.setdefault(node(piece['points'][k]),piece['elevations'][k])
 return replaced,notes


def cut_terrain(plans,grid,heights,existing,footprints,cut):
 """Apply `cut` (from cut_plan) to the graded grid. Every grid vertex of a cell
 a surface street corridor passes over keeps its height, as do buildings, and
 the terrain under any deck stays within TERRAIN_RISE+.3 m of it; inside its own
 footprint and its first cell (the vertices a clean edge needs) the deck wins
 over a street corridor reaching across it; buildings always keep their ground.
 Returns the new int16 grid and the flat indices and original heights of every
 changed vertex."""
 from north_overpasses import Window,covered,half_width
 allowed,must=cut
 if not allowed:return heights.copy(),[],[]
 scale=grid.get('scale',.01);W=grid['width'];C=grid['cellSize'];ox,oz=grid['originX'],grid['originZ']
 values=heights.astype(np.float64)*scale;vs=np.asarray(sorted(allowed),dtype=np.int64);proposed=values.copy();proposed[vs]=[allowed[v] for v in vs.tolist()]
 gx=ox+(vs%W)*C;gz=oz+(vs//W)*C;pts=shapely.points(gx,gz);keep=np.zeros(len(vs),bool)
 win=Window(grid,(float(gx.min())-C,float(gz.min())-C,float(gx.max())+C,float(gz.max())+C));area=shapely.box(*win.bounds)
 streets=[r for r in existing if not r.get('elevations') and not r.get('tunnel') and LineString(r['points']).buffer(half_width(r)+C).intersects(area)]
 kept=set(win.index[covered(grid,win,streets)].tolist()) if streets else set()
 keep|=np.isin(vs,np.fromiter(kept,dtype=np.int64,count=len(kept)))
 clear=np.isin(vs,np.fromiter(must,dtype=np.int64,count=len(must)));house=np.zeros(len(vs),bool)
 houses=[Polygon(f).buffer(BUILDING) for f in footprints(win.bounds) if len(f)>=3]
 if houses:
  for k,j in zip(*STRtree(houses).query(pts,predicate='within')):house[k]=True
 for plan in plans:
  # Another deck resting on the grid keeps its support, except along its edge
  # where it runs beside a lower carriageway (the two decks touch north of
  # Roosevelt Circle and the lower one needs its edge clear).
  d=shapely.line_locate_point(plan.line,pts);e=shapely.distance(plan.line,pts);half=np.interp(d,plan.along,plan.widths)/2;under=e<=half+.5
  if under.any():
   yd=np.interp(d,plan.along,plan.y);floor=yd-TERRAIN_RISE-.3;rest=e<=half-1
   proposed[vs[rest]]=np.maximum(proposed[vs[rest]],np.minimum(values[vs[rest]],floor[rest]))
   clear|=under&(values[vs]>yd-.05)
 keep=(keep&~clear)|house
 proposed[vs[keep]]=values[vs[keep]]
 result=heights.copy();new=np.round(proposed[vs]/scale).astype(np.int64);changed=new<heights[vs]
 result[vs[changed]]=new[changed].astype(heights.dtype)
 return result,vs[changed].tolist(),heights[vs[changed]].astype(int).tolist()


def ground_level(ground,plan,d):
 """The level of the ground a road stands over at distance `d` along it: the median across its pavement (the highest
 point is what a deck must clear, and beside a higher twin that is the twin's ground at the shared edge)."""
 k=min(len(plan.points)-1,max(1,int(np.searchsorted(plan.along,d,'right'))));a,b=plan.points[k-1],plan.points[k];l=math.dist(a,b) or 1;u=min(1.,max(0.,(d-float(plan.along[k-1]))/l))
 x,z=a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u;nx,nz=-(b[1]-a[1])/l,(b[0]-a[0])/l;half=plan.width_at(d)/2
 return float(np.median([ground(x+nx*o,z+nz*o) for o in np.linspace(-half,half,7).tolist()]))


def raise_ground(pairs,plans,grid,heights,alone,existing,footprints,water=()):
 """The ground under the lifted roads of `pairs`, [(road, the road it rose to)], brought up to the ground that other
 road stands over (fill has the rule): the new int16 grid. `plans` are all the stage's roads as they lie, `alone` the
 grid the roads rode alone: what a road rode is read from it, and a vertex rises over it by no more than the road did."""
 from north_overpasses import Window,covered,half_width
 scale=grid.get('scale',.01);W=grid['width'];C=grid['cellSize'];ox,oz=grid['originX'],grid['originZ']
 ground=Terrain(grid,heights);rode=Terrain(grid,alone);values=heights.astype(np.float64)*scale;before=alone.astype(np.float64)*scale;wanted={}
 for plan,other in pairs:
  n=len(plan.points);lift=np.asarray(plan.y,float)-np.asarray(plan.solo,float)
  if lift.max()<=FILLED:continue
  pts=shapely.points(plan.points);s=shapely.line_locate_point(other.line,pts);between=shapely.distance(other.line,pts)-(np.asarray(plan.widths,float)+np.interp(s,other.along,other.widths))/2
  beside=(between<=TWIN_APART)&(s>.5)&(s<other.line.length-.5)
  rides=[bool(lift[i]>FILLED and beside[i]) and plan.solo[i]-rode.across(plan.points[i],plan.tangents[i],plan.widths[i]/2+.5)<=GROUNDED for i in range(n)]
  rise=np.where(rides,lift,0.);level=np.asarray([ground_level(ground,other,float(s[i])) if rides[i] else math.nan for i in range(n)])
  for a,b in runs(rides):
   if a>0:level[a-1]=level[a]
   if b<n-1:level[b+1]=level[b]
   a,b=max(0,a-1),min(n-1,b+1)   # (closed on the stations beside it, where it rises by nothing)
   if b<=a:continue
   line=LineString(plan.points[a:b+1]);along=np.asarray(plan.along[a:b+1],float)-float(plan.along[a]);x0,z0,x1,z1=line.bounds;reach=max(plan.widths[a:b+1])/2+C
   gi,gj=np.meshgrid(np.arange(int((x0-reach-ox)//C),int((x1+reach-ox)//C)+2),np.arange(int((z0-reach-oz)//C),int((z1+reach-oz)//C)+2));gx=ox+gi.ravel()*C;gz=oz+gj.ravel()*C;flat=gj.ravel()*W+gi.ravel()
   q=shapely.points(gx,gz);d=shapely.line_locate_point(line,q);e=shapely.distance(line,q)
   # (beside the stretch, not beyond its ends: the vertices of the cells its pavement passes over)
   inside=(e<=np.interp(d,along,plan.widths[a:b+1])/2+C)&(d>1e-6)&(d<along[-1]-1e-6);up=np.interp(d,along,rise[a:b+1]);to=np.interp(d,along,level[a:b+1])
   for k in np.flatnonzero(inside&(up>0)).tolist():
    v=int(flat[k]);level_=min(before[v]+float(up[k]),float(to[k]))
    if level_>wanted.get(v,-math.inf):wanted[v]=level_
 if not wanted:return heights.copy()
 vs=np.asarray(sorted(wanted),dtype=np.int64);gx=ox+(vs%W)*C;gz=oz+(vs//W)*C;pts=shapely.points(gx,gz);target=np.asarray([wanted[v] for v in vs.tolist()])
 for plan in plans:
  # under every deck of the stage as it now lies, the lifted road's own and any beside it
  d=shapely.line_locate_point(plan.line,pts);under=shapely.distance(plan.line,pts)<=np.interp(d,plan.along,plan.widths)/2+C
  if under.any():target[under]=np.minimum(target[under],np.interp(d[under],plan.along,plan.y)-TERRAIN_FLOOR)
 rising=target>values[vs]+scale/2
 if not rising.any():return heights.copy()
 vs,gx,gz,target=vs[rising],gx[rising],gz[rising],target[rising];pts=shapely.points(gx,gz);keep=np.zeros(len(vs),bool)
 streets=[r for r in existing if not r.get('elevations') and not r.get('tunnel')];tree=STRtree([LineString(r['points']) for r in streets]) if streets else None
 # every vertex of a cell a surface street's corridor passes over keeps its height (window by window along the road: the corridors are many)
 order=np.argsort(gz,kind='stable')
 for chunk in np.array_split(order,max(1,math.ceil(len(order)/400))):
  win=Window(grid,(float(gx[chunk].min())-C,float(gz[chunk].min())-C,float(gx[chunk].max())+C,float(gz[chunk].max())+C));area=shapely.box(*win.bounds)
  near=[streets[j] for j in sorted(tree.query(area.buffer(max(half_width(r) for r in streets)+C)).tolist())] if tree is not None else []
  near=[r for r in near if LineString(r['points']).buffer(half_width(r)+C).intersects(area)]
  if near:
   kept=win.index[covered(grid,win,near)];keep[chunk]|=np.isin(vs[chunk],kept)
 area=shapely.box(float(gx.min())-C,float(gz.min())-C,float(gx.max())+C,float(gz.max())+C)
 houses=[Polygon(f).buffer(BUILDING) for f in footprints(area.bounds) if len(f)>=3]
 if houses:
  for k,_ in zip(*STRtree(houses).query(pts,predicate='within')):keep[k]=True
 wet=[poly for poly in water if poly.intersects(area)]
 if wet:
  for k,_ in zip(*STRtree([poly.buffer(2) for poly in wet]).query(pts,predicate='within')):keep[k]=True
 decks=[r for r in existing if r.get('elevations') and not r.get('tunnel') and LineString(r['points']).intersects(area)]
 if decks:
  for k,j in zip(*STRtree([LineString(r['points']).buffer(r['width']/2+1) for r in decks]).query(pts,predicate='within')):
   if road_height(decks[j],(float(gx[k]),float(gz[k])),None)<target[k]+OVERHEAD:keep[k]=True
 result=heights.copy();new=np.floor(target/scale+1e-6).astype(np.int64);changed=~keep&(new>heights[vs])
 result[vs[changed]]=new[changed].astype(heights.dtype)
 return result


def fill(main,ramps,grid,heights,existing,footprints,water=(),alone=None):
 """The ground under the roads their twins have lifted (build; plan.solo keeps the heights each was solved with alone),
 where they rode it: a carriageway on the ground whose twin stands higher on its own would otherwise stand a slab's
 thickness over its verge, and the higher one over the median. `heights` is the grid as it lies under them (install:
 cut for the roads alone and again for the roads as they lie), `alone` the grid they rode alone (`heights` if none is
 given). Under every stretch a lift has raised by more than FILLED that stood within GROUNDED of its ground alone (the
 highest across its width), each vertex of the cells its pavement passes over comes up to the ground the twin beside
 it stands over (ground_level, at no more than TWIN_APART): the two then lie on one ground. It comes up by no more
 than the road rose there, to no more than TERRAIN_FLOOR under any deck of the stage over it (a ramp beside the
 carriageway keeps its room), and is never lowered. Where the twin stands on its piers over the same ground (the
 approach to a bridge it climbs a few stations sooner) nothing is filled: the lifted road stands on piers beside it.
 A ramp a lift has taken up with its carriageway then has its ground brought up the same way, to the ground that
 carriageway now stands over. A vertex keeps its height in the corridor of a surface street, under a building, in
 mapped water and under a deck of another stage unless that one passes OVERHEAD. Returns the new int16 grid."""
 mains=list(main.values());plans=[*mains,*ramps];alone=heights if alone is None else alone
 first=raise_ground([(a,b) for a in mains for b in mains if a is not b],plans,grid,heights,alone,existing,footprints,water)
 return raise_ground([(r,m) for r in ramps for m in mains],plans,grid,first,alone,existing,footprints,water)


def station_layers(plan,ways):
 """Source layer at every station: its way's, raised over an OVER_EXISTING deck."""
 return [max(effective_layer(ways[o]['tags']),m if m is not None else -99) for o,m in zip(plan.owner,plan.min_layer)]


def piece_marks(plan,ways,gores):
 """Record boundaries along a carriageway: gores, lane and source layer changes, then the MAX_PIECE limit."""
 n=len(plan.points);lay=station_layers(plan,ways);marks={0,n-1}|set(gores)
 for i in range(1,n-1):
  if plan.lanes[i]!=plan.lanes[i-1] or lay[i]!=lay[i-1]:marks.add(i)
 marks=sorted(marks);out=[marks[0]]
 for a,b in zip(marks,marks[1:]):
  span=plan.along[b]-plan.along[a];parts=math.ceil(span/MAX_PIECE-1e-9)
  for k in range(1,parts):out.append(int(np.argmin(np.abs(plan.along-(plan.along[a]+span*k/parts)))))
  out.append(b)
 return out,lay


def deck_record(id,name,kind,plan,a,b,lanes,layer,levels=(1,1),bridge_kind=KIND):
 w=[min(20,v) for v in plan.widths[a:b+1]]
 return {'id':id,'name':name,'kind':kind,'points':[[round(p[0],3),round(p[1],3)] for p in plan.points[a:b+1]],'width':round(max(w),2),'oneway':1,'lanes':lanes,
  'elevations':[round(v,3) for v in plan.y[a:b+1]],'startLevel':levels[0],'endLevel':levels[1],'deckWidths':[round(v,3) for v in w],
  'bridge':{'id':'i93','kind':bridge_kind,'thickness':THICKNESS,'clearanceEstimated':True,'sourceLayer':layer}}


def place_name(point,neighborhoods,reach=150):
 """The neighbourhood covering a point, or the nearest within `reach` metres where the outlines leave a gap (rail yards, viaducts)."""
 p=Point(point);best=(reach,None)
 for n in neighborhoods:
  d=n['shape'].distance(p)
  if d==0:return n['name']
  if d<best[0]:best=(d,n['name'])
 return best[1]


def records(main,ramps,ways,neighborhoods):
 """Road records: carriageway pieces in travel order (the northbound closure at
 the end of its last piece, the southbound at the start of its first) and the
 ramps, split where their lanes or source layers change, so each record's
 `sourceLayer` is the layer where it crosses another road. Records of one plan
 share the plan's tangent at their seam (`deckTangents`)."""
 out=[];gores={plan.id:set() for plan in main.values()}
 for r in ramps:
  for kind in r.ends:
   if kind[0]=='gore':gores[kind[1].id].add(kind[2])
 for name,plan in main.items():
  marks,lay=piece_marks(plan,ways,gores[plan.id]);label='North' if name=='nb' else 'South';plan.pieces=[(a,b,f'{plan.id}-{k+1:02d}') for k,(a,b) in enumerate(zip(marks,marks[1:]))]
  for k,(a,b) in enumerate(zip(marks,marks[1:])):
   place=place_name(plan.points[(a+b)//2],neighborhoods);rec=deck_record(f'{plan.id}-{k+1:02d}',f'I-93 {label}'+(f' · {place}' if place else ''),'motorway',plan,a,b,plan.lanes[a],lay[a])
   out.append(seam_tangents(rec,plan,a,b,len(plan.points)))
  if name=='nb':out[-1]['closed']='end'
  else:out[len(out)-len(marks)+1]['closed']='start'
 for r in ramps:
  lay=station_layers(r,ways);marks=[0]+[i for i in range(1,len(r.points)-1) if r.lanes[i]!=r.lanes[i-1] or lay[i]!=lay[i-1]]+[len(r.points)-1]
  for k,(a,b) in enumerate(zip(marks,marks[1:])):
   levels=(0 if r.landing[0] and a==0 else 1,0 if r.landing[1] and b==len(r.points)-1 else 1)
   out.append(seam_tangents(deck_record(r.id if k==0 else f'{r.id}-{k+1}',r.spec['name'],'motorway_link',r,a,b,r.lanes[a],lay[a],levels),r,a,b,len(r.points)))
 return out


def seam_tangents(rec,plan,a,b,n):
 """Give a record the plan's tangent at each end that meets another record of the plan (stations a and b of n)."""
 ends={k:[round(v,6) for v in plan.tangents[i]] for k,i,inner in (('start',a,a>0),('end',b,b<n-1)) if inner}
 if ends:rec['deckTangents']=ends
 return rec


FIELDS=('name','points','width','oneway','kind','lanes','closed','elevations','startLevel','endLevel','deckWidths','deckTangents','bridge','surveyDeck','traffic')


def stage_owned(road):
 """Roads this stage adds: the I-93 records and the deck pieces carrying streets over its cuts."""
 return road['id'].startswith(PREFIX) or road.get('bridge',{}).get('kind') in (KIND,APPROACH)


def restore(roads,heights,record):
 """Drop the roads a previous run added and put back the streets and grid vertices it changed (in place; `heights` None leaves the grid)."""
 if not record:return
 changes=record.get('roads',{});added=set(changes.get('added',[]));sources={r['id']:r for r in changes.get('sources',[])}
 if added or sources:roads[:]=[copy.deepcopy(sources[r['id']]) if r['id'] in sources else r for r in roads if r['id'] not in added]
 terrain=record.get('terrain')
 if heights is not None and terrain and terrain['vertices']:heights[np.asarray(terrain['vertices'],dtype=np.int64)]=np.asarray(terrain['heights'],dtype=heights.dtype)


def before_stage(roads,heights,record,scale=.01):
 """Copies of the package roads and graded grid as the stages before this one left
 them, for checks and replays of those stages on an installed package."""
 roads=copy.deepcopy(roads);restore(roads,None,record);return roads,staged_heights(heights,record,scale)


def staged_heights(heights,record,scale=.01):
 """The graded grid (float metres or int16 centimetres, like `heights`) as the stages before this one left it."""
 out=heights.copy();terrain=(record or {}).get('terrain')
 if terrain and terrain['vertices']:
  original=np.asarray(terrain['heights'],dtype=np.float64)
  out[np.asarray(terrain['vertices'],dtype=np.int64)]=original if out.dtype.kind=='i' else original*scale
 return out


def install(city,source,heights,footprints,mesh=None,joins=None):
 """Build the stage on a package without it (`heights` the int16 graded grid,
 `mesh` the SurveyMesh to cut for the lower deck, `joins` from tunnel_joins for the
 survey traces): (provenance record, the package roads with the stage applied, the
 grid as the stage leaves it: cut under the decks, and filled under a carriageway its
 twin has lifted). The mesh keeps its cut tile until SurveyMesh.write()."""
 from water_crossings import water_inputs
 grid=city['elevation'];mark={}
 def survey(plan):
  mark.update(mesh.cut(cut_region(source['survey'],plan),cut_digest(source['survey'],plan)))
  mesh.repair_portal_approach()
  return mesh.raster(),mesh.triangles()
 water=water_inputs(city);main,ramps,report=build(city,source,heights,water,survey if mesh else None);plans=[*main.values(),*ramps]
 bad=[p for p,ok in report['grades'].items() if not ok];assert not bad,f'I-93 profiles exceed their grade: {bad}'
 # (and as they lie once the carriageways share a height: a lift keeps a road within its grade, the solver's own measure with the rounding of both profiles)
 steep={p.id:round(g,4) for p in plans for g in [float(np.max(np.abs(np.diff(p.y))-p.grade*np.diff(p.along)))] if g>5e-4};assert not steep,f'I-93 profiles exceed their grade where the carriageways share a height: {steep}'
 assert not report['surveyConflicts'],f"I-93 lower deck meets the survey mesh: {report['surveyConflicts'][:6]}"
 # The cut, the streets carried over its edge (both made in build) and the ramps' shoulders are for each road as it rides
 # its own ground (plan.solo), so a carriageway its twin has lifted moves none of them; its ground then comes up with it.
 lifted=[p.y for p in plans]
 for p in plans:p.y=p.solo
 cut=report['cut'];replaced,notes=report['carried']
 roads=[x for r in city['roads'] for x in replaced.get(r['id'],[r])]
 result,_,_=cut_terrain(plans,grid,heights,roads,footprints,cut)
 widen_ramps(ramps,main.values(),roads,Terrain(grid,result),footprints)
 for p,y in zip(plans,lifted):p.y=y
 # The trench is then cut again for the roads as they lie, and a vertex takes the higher of the two cuts: no deeper under
 # a lifted road than it now needs, nor under its twin beside it, whose ground the lower road's cut had taken down too.
 alone=result;again,_,_=cut_terrain(plans,grid,heights,roads,footprints,cut_plan(plans,grid,heights));result=np.maximum(alone,again)
 result=fill(main,ramps,grid,result,roads,footprints,water[0],alone)
 vertices=np.flatnonzero(result!=heights);originals=heights[vertices].astype(int).tolist();vertices=vertices.tolist()
 hoods=[{'name':n['name'],'shape':Polygon(n['rings'][0],n['rings'][1:])} for n in city['neighborhoods']]
 ways={w['id']:w for w in source['ways']};recs=records(main,ramps,ways,hoods)+(trace_records(source,main,joins,hoods,survey_surface(mesh.raster()) if mesh else None) if joins else [])
 pieces=[x for k in sorted(replaced) for x in replaced[k] if x.get('elevations')]
 # (what the twins left apart, by record: stations of the record and the most its twin stands over it there)
 by_id={p.id:p for p in plans}
 twins={**report['twins'],'pairs':[{**pair,'apart':[{'road':rid,'stations':[max(i,a)-a,min(j,b)-a],'by':by} for k in pair['roads'] for i,j,by in pair['apart'][k] for a,b,rid in by_id[k].pieces if max(i,a)<=min(j,b)]} for pair in report['twins']['pairs']]}
 scale=grid.get('scale',.01);delta=(result.astype(np.int64)-heights.astype(np.int64))*scale
 lengths={p.id:round(float(p.along[-1]),1) for p in main.values()};sb=main['sb'];held=[i for i in range(sb.curve) if sb.hold[i] is not None]
 lower={'heldMeters':round(float(sb.along[held[-1]]-sb.along[held[0]]),1),'minClearanceMeters':round(min(sb.hold[i]+CLEAR_UNDER_TARGET+SURVEY_MARGIN-sb.y[i] for i in held),2),
  'curveMeters':round(float(sb.along[sb.survey[0]]-sb.along[sb.curve]),1),'joinOverlapMeters':round(float(sb.along[sb.survey[1]]-sb.along[sb.survey[0]]),1)} if held else None
 record={'method':METHOD,'survey':SURVEY_ID,
  'carriageways':{p.id:{'lengthMeters':lengths[p.id],'pieces':sum(r['id'].startswith(p.id+'-') and r['kind']=='motorway' for r in recs),'lanes':sorted(set(p.lanes))} for p in main.values()},
  'ramps':len(ramps),'closed':[{'road':r['id'],'end':r['closed'],'point':r['points'][-1 if r['closed']=='end' else 0]} for r in recs if r.get('closed')],
  'overrides':sorted(OVER_EXISTING),'crossings':report['crossings'],'newCrossings':report['newCrossings'],
  'infeasible':[{k:(float(v) if isinstance(v,np.floating) else v) for k,v in i.items()} for i in report['infeasible']],'unresolved':report['unresolved'],
  'approachPieces':[{'road':p['id'],'lengthMeters':round(stations(p['points'])[-1],2)} for p in pieces],'notCarried':notes,
  'lowerDeck':lower,'twins':twins,'surveyCut':dict(mark) or None,'traces':[{'road':r['id'],'lengthMeters':round(stations(r['points'])[-1],1),'lanes':r['lanes'],**({'traffic':False} if r.get('traffic') is False else {})} for r in recs if r.get('surveyDeck')],
  'roads':{'added':[r['id'] for r in recs]+[p['id'] for p in pieces if p['id'] not in replaced],'sources':[copy.deepcopy(r) for r in city['roads'] if r['id'] in replaced]},
  'terrain':{'vertices':[int(v) for v in vertices],'heights':[int(h) for h in originals],'maxCutMeters':round(float(max(0,-delta.min())),3) if len(vertices) else 0,'volumeCubicMeters':round(float(-delta[delta<0].sum())*grid['cellSize']**2),
   'maxFillMeters':round(float(max(0,delta.max())),3) if len(vertices) else 0,'fillCubicMeters':round(float(delta[delta>0].sum())*grid['cellSize']**2)}}
 return record,roads+recs,result


def replay(data_dir,city,record,source,footprints,installed=None):
 """Rerun the stage from the recorded originals; True when it rewrites the installed package exactly.
 `installed` is the int16 graded grid this stage left, where a later stage (the Turnpike) has changed the shipped one."""
 from north_overpasses import load_grid
 grid=city['elevation'];roads=copy.deepcopy(city['roads']);installed=load_grid(data_dir/grid['file']) if installed is None else installed;heights=installed.copy();restore(roads,heights,record)
 again,out,result=install({**city,'roads':roads},source,heights,footprints,SurveyMesh(data_dir,city),tunnel_joins(data_dir,city))
 by_id={r['id']:r for r in city['roads']};touched=set(again['roads']['added'])|{r['id'] for r in again['roads']['sources']}
 same=[r['id'] for r in out]==[r['id'] for r in city['roads']] and all(r.get(f)==by_id[r['id']].get(f) for r in out if r['id'] in touched for f in FIELDS)
 return same and np.array_equal(result,installed) and all(again[k]==record.get(k) for k in ('terrain','roads','surveyCut','lowerDeck','traces','twins'))


def validate(city,record,joins,ground):
 """Check the installed stage: record fields, the two closed ends, and that every
 record meets the one it continues: the traces the tunnel ends and the decks, the
 mainline pieces each other, each ramp end a carriageway or ramp vertex or a street
 vertex at the street's height (`ground(x,z)` the graded terrain). Returns counts."""
 roads=[r for r in city['roads'] if stage_owned(r)];by={r['id']:r for r in roads};assert len(by)==len(roads),'I-93 road ids must be unique'
 def series(pattern):return [by[i] for i in sorted((i for i in by if re.fullmatch(pattern,i)),key=lambda i:int(i.rsplit('-',1)[1]))]
 def meet(a,ia,b,ib,tol=.0002):return a['points'][ia]==b['points'][ib] and abs(a['elevations'][ia]-b['elevations'][ib])<=tol
 def at(r,i,p):return r['points'][i]==p[:2] and abs(r['elevations'][i]-p[2])<=.0002
 vertices=defaultdict(list)
 for r in city['roads']:
  if not stage_owned(r):
   for i,q in enumerate(r['points']):vertices[(round(q[0],3),round(q[1],3))].append((r,i))
 nb,sb=series(r'i93-nb-\d+'),series(r'i93-sb-\d+');znb,zsb,lev,cross=series(r'i93-zakim-nb-\d+'),series(r'i93-zakim-sb-\d+'),series(r'i93-zakim-leverett-nb-\d+'),series(r'i93-zakim-cross-nb-\d+')
 assert nb and sb and znb and zsb and lev and cross,'I-93 carriageways and survey traces must be installed'
 for r in roads:
  assert len(r['elevations'])==len(r['points'])==len(r.get('deckWidths',r['points'])) and all(math.isfinite(y) for y in r['elevations']),f"{r['id']} deck profile"
  if r['id'].startswith(PREFIX):
   kind=r['bridge']['kind'];assert r['oneway']==1 and isinstance(r['lanes'],int),f"{r['id']} is not a one-way I-93 deck"
   if r['kind']=='motorway' or r.get('surveyDeck'):assert r['startLevel']==r['endLevel']==1,f"{r['id']} must be lifted at both ends"
   assert kind==(TRACE if r.get('surveyDeck') else KIND) and (r.get('surveyDeck') in (None,SURVEY_ID)),f"{r['id']} bridge kind"
   assert (2<=r['lanes']<=5) if r['kind']=='motorway' else (r['kind']=='motorway_link' and 1<=r['lanes']<=2),f"{r['id']} lanes"
   assert r['name'].startswith('I-93 ') or (r['name']=='Leverett Connector' and r in lev),f"{r['id']} name"
   assert ('traffic' not in r) or (r in lev and r['traffic'] is False),f"{r['id']} traffic flag"
  else:assert r['bridge']['kind']==APPROACH,f"{r['id']} is not an I-93 street approach"
 closed=sorted((r['id'],r['closed']) for r in roads if r.get('closed'));assert closed==sorted([(nb[-1]['id'],'end'),(sb[0]['id'],'start')]),f'I-93 closures: {closed}'
 for chain in (nb,sb,znb,zsb,lev,cross):
  for a,b in zip(chain,chain[1:]):assert meet(a,-1,b,0),f"{a['id']} does not meet {b['id']}"
 assert at(znb[0],0,joins['northbound']) and meet(znb[-1],-1,nb[0],0),'the northbound trace must run from the tunnel to the northbound deck'
 assert meet(sb[-1],-1,zsb[0],0) and at(zsb[-1],-1,joins['southbound']),'the southbound trace must run from the lower deck to the tunnel'
 assert at(lev[0],0,joins['leverett']) and any(meet(lev[-1],-1,r,0) for r in znb[1:]),'the Leverett trace must run from the connector to the northbound trace'
 assert at(cross[0],0,joins['cross']) and any(meet(cross[-1],-1,r,j) for r in znb for j in range(1,len(r['points'])-1)),'the Cross Street trace must run from the entrance onto the northbound trace'
 for chain in (nb,sb):
  for a,b in zip(chain,chain[1:]):assert a.get('deckTangents',{}).get('end')==b.get('deckTangents',{}).get('start')!=None,f"{a['id']} and {b['id']} must share their seam tangent"
 landings=0
 for r in roads:
  if r['kind']!='motorway_link' or r.get('surveyDeck') or not r['id'].startswith(PREFIX):continue
  for i in (0,-1):
   key=(round(r['points'][i][0],3),round(r['points'][i][1],3));y=r['elevations'][i]
   joined=[o for o in roads if o is not r and any(q==r['points'][i] and abs(o['elevations'][j]-y)<=.01 for j,q in enumerate(o['points']))]
   if joined:continue
   street=[(o,j) for o,j in vertices.get(key,()) if abs((o['elevations'][j] if o.get('elevations') else ground(*o['points'][j]))-y)<=.1]
   assert street,f"{r['id']} {'starts' if i==0 else 'ends'} at {r['points'][i]} on no carriageway, ramp or street vertex at its height"
   assert r['startLevel' if i==0 else 'endLevel']==0,f"{r['id']} lands on a street with a lifted end";landings+=1
 # No two decks of the stage overlap beside each other (more than OVERLAP_SLACK, or MEDIAN_SLACK running
 # the other way) at different heights short of a crossing.
 decks=[r for r in roads if not r.get('surveyDeck')];lines=[LineString(r['points']) for r in decks];tree=STRtree(lines)
 runs=[np.asarray(stations(r['points'])) for r in decks];widths=[np.asarray(r.get('deckWidths') or [r.get('pavedWidth') or r['width']]*len(r['points']),float) for r in decks]
 for a,(r,line) in enumerate(zip(decks,lines)):
  for d in np.arange(0,line.length,2.0).tolist():
   p=line.interpolate(d);y=float(np.interp(d,runs[a],r['elevations']));w=float(np.interp(d,runs[a],widths[a]))
   for b in tree.query(p.buffer(15)).tolist():
    q=lines[b].project(p)
    if b==a or q<=.01 or q>=lines[b].length-.01:continue
    over=(w+float(np.interp(q,runs[b],widths[b])))/2-lines[b].interpolate(q).distance(p);dy=abs(y-float(np.interp(q,runs[b],decks[b]['elevations'])))
    if over<=OVERLAP_SLACK or not STEP<dy<THICKNESS+CLEAR_UNDER:continue
    u,v=line.interpolate(min(d+1,line.length)),lines[b].interpolate(min(q+1,lines[b].length));same=(u.x-p.x)*(v.x-lines[b].interpolate(q).x)+(u.y-p.y)*(v.y-lines[b].interpolate(q).y)>0
    assert not same and over<=MEDIAN_SLACK,f"{r['id']} overlaps {decks[b]['id']} beside it {dy:.2f} m apart at {p.x:.1f}, {p.y:.1f}"
 # The two carriageways at one height where they run alongside each other (build): a station whose twin stands more than
 # TWIN_STEP over it with no more than TWIN_MEDIAN between the two pavements is one the stage lists as left apart
 # (`twins` of the provenance: a station that keeps its height and the fade before it, the room under a bridge, two levels).
 listed=defaultdict(list);level=0
 for pair in (record.get('twins') or {}).get('pairs',[]):
  for e in pair['apart']:listed[e['road']].append(e['stations'])
 def chain(series_):
  pts=[];ys=[];ws=[];own=[]
  for r in series_:
   for i,q in enumerate(r['points']):
    if i==0 and pts:own[-1].append((r['id'],0));continue   # (the station two records share is either's)
    pts.append(q);ys.append(r['elevations'][i]);ws.append(r['deckWidths'][i]);own.append([(r['id'],i)])
  return pts,np.asarray(ys,float),np.asarray(ws,float),own,np.asarray(stations(pts)),LineString(pts)
 lanes={'nb':chain(nb),'sb':chain(sb)}
 for mine,theirs in (('nb','sb'),('sb','nb')):
  pts,ys,ws,own,_,_=lanes[mine];opts,oys,ows,_,along,line=lanes[theirs];q=shapely.points(pts);s=shapely.line_locate_point(line,q);gap=shapely.distance(line,q)-(ws+np.interp(s,along,ows))/2
  k=np.clip(np.searchsorted(along,s,'right'),1,len(opts)-1);o=np.asarray(opts,float);u=o[k]-o[k-1];u/=np.maximum(np.hypot(u[:,0],u[:,1]),1e-9)[:,None]
  beside=(s>.5)&(s<line.length-.5)&(np.abs(np.sum(u*np.asarray(tangents(pts),float),axis=1))>=PARALLEL)&(gap<=TWIN_MEDIAN);under=np.interp(s,along,oys)-ys
  for i in np.flatnonzero(beside).tolist():
   level+=1
   if under[i]<=TWIN_STEP+.005:continue
   assert any(lo-2<=j<=hi+2 for rid,j in own[i] for lo,hi in listed[rid]),f"{own[i][0][0]} lies {under[i]:.2f} m under its twin at {pts[i]} with only a median between them"
 return {'carriageways':len(nb)+len(sb),'traces':len(znb)+len(zsb)+len(lev)+len(cross),'ramps':sum(1 for r in roads if r['kind']=='motorway_link' and not r.get('surveyDeck')),'streetLandings':landings,'twinStations':level}
