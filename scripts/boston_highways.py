"""The Massachusetts Turnpike (Interstate 90) from the Newton line to Route 1A in
East Boston, Storrow Drive between the Boston University Bridge and David G.
Mugar Way, and the ramps that tie the Turnpike to the Central Artery tunnel.

build-metro.py leaves out the Boston segments named for an interstate, a
turnpike or James J. Storrow and every unnamed ramp, so both roads were missing
from the package although Boston's own street centerlines (layer 8, the source
of every Boston street and of the Central Artery tunnel) carry them whole. This
stage adds them from `boston-highways-source.json`: the layer 8 segments each
route lists (ROUTES), with their source levels (F_ZLEV / T_ZLEV), and the
OpenStreetMap ways of the cached Brookline and Cambridge extracts that fill the
300 m of the Turnpike inside Brookline at the Boston University Bridge and give
Storrow Drive its lane counts, its tunnel and its posted clearances.

- Alignment: the source segments in travel order, resampled every 3 m with
  their vertices kept (two closer than SLIVER are one), so a ramp leaves a
  carriageway at an exact shared vertex and lands on the exact vertex of the
  street it meets. A segment whose level changes is cut at its middle. The
  Turnpike starts (and ends) INSET metres inside the coverage at the Newton
  line, closed with concrete barriers (`closed`), and runs on along Route 1A to
  the McClellan Highway segments the package already has. Storrow Drive lands on
  Soldiers Field Road and David G. Mugar Way, so it has no closed end. Layer 8
  draws a ramp on the centre line of the road it joins: keep_beside moves it
  clear. Twin carriageways give way to each other equally (twin_cap), and at
  source level 0 the pavement narrows beside a building at its edge or a street
  alongside (building_cap, street_cap), never under what its lanes take.
- Profile: the smoothing spline of i93_north.py over the graded terrain. A
  station at or above source level 0 follows the terrain at TERRAIN_RISE,
  clears the streets and water it crosses above and passes under the bridges
  over it (Storrow Drive at STORROW_UNDER, its posted 10 ft). The bare-earth
  survey already holds the Turnpike's embankments and its cut through the Back
  Bay and the South End, so the road rides on them. Below level 0, under a
  reviewed tunnel span (`buried`) and under a building that leaves the headroom,
  the road lies under its cover: CLEARANCE (the Turnpike's posted 13 ft 9 in;
  STORROW_CLEARANCE in Storrow Drive's tunnel) and the ROOF slab beneath the
  lowest ground across its width, a street's surface, a building's base or the
  bed of mapped water (cover). The street bridges over the cut, which
  build-metro.py lifts 6.4 m over each node, are levelled between their
  landings first (level_overpasses); a street the segments start at level 0 on
  a bridge node over the road is that bridge's ramp (bridge_seams: Tremont
  Street's southern piece over the eastbound Turnpike). A route's `spans`
  correct a source level where the segments leave an underpass at level 0
  (the Exit 135 ramp under West Service Road).
- Buildings are the plan their roof faces cover (building_outline.py), not the
  stored convex footprint. The survey's cut is closed under each building over
  a road, up to the building's base, and under each street that has sunk into
  it over a tunnel, across the street's corridor (lids). A road passes under a base with the
  roof slab between; where it cannot (a ramp still near its street), the stage
  records a passage for building_passages.py to carve out of the shell, with a
  ceiling that falls with the ramp; a structure under SHED metres or lying
  mostly inside the roadway (a bridge's slab or a toll canopy stored as a
  building) is removed from the package; and every building whose convex proxy
  would stand in a roadway is listed for exact collision (buildings_over).
- Records: a road below the ground it runs through is a tunnel record in the
  `boston-highways.json` sidecar: a stretch holding a station below level 0, a
  stretch under a building, and a walled cut (ground WALLED over the road at
  the edge of its pavement, or left standing in it by the 6 m grid). The
  runtime cuts the ground at the pavement edge and walls it, and roofs the
  `tunnel.covered` intervals. Every other stretch is a deck record in city.json
  like the I-93 decks: one-way, integer `lanes`, split at every gore, lane and
  level change and at MAX_PIECE, consecutive records sharing their seam's
  tangent (`deckTangents`); the graded grid is cut under a deck as
  build-i93-north.py cuts it. No stretch is shorter than SHORT. A deck is also
  split where a street starts or ends on one of its vertices within JOIN of its
  height (Charlesgate off and onto Storrow Drive East), so the traffic graph
  joins the two there.
- Ramps start at their carriageway's height at the gore, match it while their
  pavements overlap, and land on the graded street vertex (on the deck, where
  the vertex is a bridge's). Ramps ending on a Central Artery tunnel road take
  its height there, so the Turnpike joins I-93 inside the existing tunnel and
  the bores keep their southern closures. A ramp out of a tunnel the package
  does not carry (`cap`: the exit to Congress Street from the tunnel between
  Interstate 93 North and the Turnpike eastbound) starts at a closed bore end,
  free in height, at least BORE metres under its roof; its first record
  carries `tunnel.capStart`. A tunnel record that lands on a
  street has a `surfaceLandings` interval, over which the runtime keeps the
  ground whole and builds no wall: it reaches as far as the road lies on the
  street's roadway and ends where the ground first stands over the road
  (landing_interval). A route with a reviewed `landing` is held on its street
  for that length before it descends (street_stretch: the Dartmouth Street
  entrance to the nose of the island between Huntington Avenue's carriageways,
  the Haul Road entrance to where the curbs part it from the road).
- Twins: the two carriageways of a road are each solved on their own ground, and came out a step apart wherever that
  ground differs across the median (a street's graded corridor reaching under one, a crossfall, two bridge approaches
  a few stations apart): 0.3 to 0.5 m along Storrow Drive between Massachusetts Avenue and Dartmouth Street, up to
  1.9 m where the Allston viaduct comes down. The 6 m grid cannot hold two levels a lane apart, so the higher one
  stood proud of the ground on its median side, railed. They are brought to one height wherever they run alongside
  each other in the open (at or above source level 0, under no roof: in_the_open) with no more than TWIN_MEDIAN
  between their pavements, the lower following the higher, so that nothing is taken into the ground (twin_lift). A
  lift fades at TWIN_RATE, out into the stretch where more lies between them (up to TWIN_APART) or, before a station
  that keeps its height (a portal, a street landing, a street joining the road, a building over the pavement:
  may_rise), inside the stretch itself; it ends under a bridge's clearance and keeps the road within its grade. A ramp
  that takes its heights from a lifted carriageway is solved again. The roads are classified, the ground is cut and
  the ground a deck stands in is judged on each road as it rides alone (plan.solo; classify_ground, cut_ground, stand),
  so no record boundary and no id moves; the ground then comes up with a lifted road (the graded roadway of
  highway_roadways.py, or its fills). `twins` of the provenance lists the lifts and, record by record, what stays
  under its twin (`apart`), against which validate checks the installed decks.
- Roadways: once the profiles are solved and the records classified, every road in the open at its own ground is
  measured to Boston's curb survey (the `curbs` of the source sidecar) and corrected (highway_roadways.py): a cut
  and a Turnpike carriageway are moved and narrowed to their surveyed pavement, Storrow Drive's cuts take theirs
  whole, and the decks of Storrow Drive and of the ramps on the ground keep their lanes while the roadway beside
  them is paved (`roadways.aprons` of the provenance, compiled by build-street-surfaces.py) and the ground set
  under them. The lane-count widths remain where the survey shows nothing: under a roof, on a viaduct, and
  along a side with no curb in reach.
- Median: each carriageway is fitted to its own curbs, and where the survey shows no median (or a roadway
  narrower than the lanes and what the stage keeps beside them) the two pavements of the Turnpike lay in each
  other, by up to 1.95 m, or closer than the barrier the runtime stands between the two directions is wide. The
  two carriageways of a railed road (highway_roadways.railed: not the parkway, whose roadways are paved to their
  curbs) are therefore parted once all roads are corrected (highway_roadways.part, in apply): each gives up half
  of what is missing on its median side, first the room the survey shows beyond its outer edge, then its
  shoulders down to least_width, then its centre line. `roadways.medians` of the provenance records it, and
  validate holds the installed records to it (highway_roadways.median_check: no carriageway pavements in each
  other, the barrier's footprint between those of a railed road, every inner lane LANE_ROOM from its face).
- Signs: the sidecar lists Storrow Drive's warnings (`signs`): CARS ONLY where
  traffic comes onto it and LOW CLEARANCE, with the height the OpenStreetMap way
  posts, ahead of every structure it passes under (warning_signs).

The stage reads only what the stages before it wrote: class widths, never the
roadway widths build-street-surfaces.py measures afterwards (the curb survey it
measures its own roads to is in its source sidecar), and for a shell
building_passages.py has carved the outline kept with it. validate-city.py
replays it (replay) and checks its records (validate).

Heights, lane counts on the Turnpike and clearances are game estimates, not
surveyed structures."""
import copy,hashlib,json,math
from collections import defaultdict
import numpy as np
import shapely
import shapely.ops
from pyproj import Transformer
from shapely.geometry import LineString,Point,Polygon
from shapely.strtree import STRtree
import i93_north as I
from road_connections import stations
from road_structure_clearance import crossing_points,road_height

import water_crossings as W
import highway_roadways as HR
from building_outline import from_rings,roof_outline

SOURCE_NAME='boston-highways-source.json'
SIDECAR='boston-highways.json'
KIND='boston-highway'
APPROACH='boston-highway-overpass-approach'
PREFIXES=('i90-','storrow-','route1a-')
INSET=I.INSET
MAX_PIECE=I.MAX_PIECE
THICKNESS=I.THICKNESS
LANE=I.LANE
CLEARANCE=4.2        # tunnel headroom over the roadway: the Turnpike's posted 13 ft 9 in (Storrow Drive's low tunnel: STORROW_CLEARANCE)
STORROW_CLEARANCE=3.2 # Storrow Drive's tunnel and underpasses are posted 10 ft
STORROW_UNDER=3.2     # and it passes that close under the bridges over it
ROOF=.45             # the runtime's roof slab over that
COVER=.35            # ground kept over the roof slab
WATER_COVER=1.0      # bed kept over the roof slab under mapped water
OPEN_MAX=1.2          # ground this close over the line between the portals is the road's own open cut,
OPEN_RUN=70          # where it runs this far along the road or reaches a portal (a shorter one is a trench crossing over the tunnel)
ENVELOPE=150         # a tunnel's target is the lowest its ceilings ask for within this distance: one basin, not a dip under each street
PORTAL_REACH=300     # the terrain is a target, not a floor, this far along the road from cover
TUNNEL_STIFFNESS=4e6
SUNK=.05             # a deck station whose ground stands this close under its surface is below ground
MIN_COVERED=6        # shortest covered run recorded
BORE=25              # a ramp that starts at a closed bore end runs this far under its roof at least: the closure stands out of sight of the portal
BESIDE=(40,100)      # a ramp keeps its source line this close to its gore, and stands clear of the road it joins from here on
WALL=.8              # room between the two pavements there
REMNANT=60           # under a bridge the road follows the lowest ground within this distance: the survey keeps a part of many bridges as a bump
CUT=1.5              # a street bridge whose landings stand this far over the road beneath crosses a cut: it is levelled between them
MEETS=1.0            # a route ending this close to where its line meets a bridge's lands on the bridge there: it does not pass beneath
TWIN=1.5             # a road lying this close to a bridge's line all along is a second source's copy of that bridge
HOLLOW=.5            # a levelled bridge whose deck stands this far over a ramp's landing, with every street leaving the landing back at that height within SEAM_MAX, lands in a hollow of the ground: the ground is raised
REFINE=.1            # room kept over the solved road's height when a bridge is levelled a second time
RAMP_START=.08       # a bridge's ramp piece may rise this steeply from its landing to clear a road crossing beneath it there
CLEAR_UNDER=I.CLEAR_UNDER  # under a levelled bridge's slab: the bridge rises just enough for it, the road beneath keeps its grade
BENEATH=5.0          # a levelled bridge over any other road crossing beneath it
SEAM_MAX=60          # longest street stretch taken as the missing ramp of a bridge over the road
SEAM_NEAR=15         # a bridge landing this close beside the pavement of one of the stage's roads may stand on the slope of its cut
BANK=.75             # where the street carrying on from it climbs this much within SEAM_MAX,
CREST=.8             # and the bridge then lands where the street has made this share of that climb
MINOR=8              # a side street narrower than this may lose its junction with a landing that becomes part of the bridge
SNAP=.3              # a ramp end the solver leaves this close to the height it is held to is set on it
MOUTH=10             # a walled record ending where a street joins the road stands open (no walls) this far from the junction
JOIN=.5              # a street ending on a deck vertex this close to its height joins it: the record is split there for the traffic graph
CLOSE=30             # an unroofed stretch of a tunnel no longer than this between two roofed ones is a hole between the lids, which the stage closes
MERGE=120            # a ramp crossing the centre line of the road it joins this close to the join is merging, not crossing
GRADE_SLACK=.02
TUNNEL_RAMP_GRADE=.105 # ramps with a stretch below level 0 (the Central Artery's own ramps reach 11.5%)
LANDING=18           # a ramp's street landing is never underground this close to the street vertex
RIM=120              # a street's level beside a cut is its highest surface within this distance along it beyond the road, on the lower side
PORTAL_ZONE=80       # a shorter stretch of ground too thin to roof the road is a portal's slope or a gap in the survey, left open
EDGE=30              # and so are the first metres of a longer one beside an open stretch
DIP=1.5              # a street this far below that level over the road has sunk into the survey's cut, which the stage closes under it
SHED=4               # a building lower than this (a kiosk, a shed) does not roof the road
DIP_MAX=1.5          # a carriageway at source level 0 goes down this far under its own ground to pass under a building
WALLED=.8            # ground this far over the road at either pavement edge is a cut's wall: the stretch is a walled cut, not a deck
GAP=60               # a deck shorter than this between two walled or covered stretches stays part of them
PARALLEL=I.PARALLEL  # cosine between a ramp and a street that runs along it rather than across it (30 degrees)
FILL=.75             # graded ground this far over the survey is fill the grader laid for another street: the road follows the survey there
WATER_CLEAR=.4       # under the slab over a culverted stream (the Muddy River at Charlesgate)
BLEND=40             # an OpenStreetMap filler's ends shift onto the layer 8 segment ends over this distance
SLIVER=.6            # source vertices closer than this are one vertex
SHORT=12             # no record shorter than this unless ramps meet the road at both its ends
LANDING_LIP=.15      # ground this far over a ramp inside its street landing's taper is no longer the street it meets
LANDING_STEP=.05     # and a landing that ends for it ends where the ground first stood this far over the road: the step the runtime leaves there
SIGN_IN=25           # a CARS ONLY sign stands this far along Storrow Drive from where traffic comes onto it
SIGN_AHEAD=70        # and a LOW CLEARANCE sign this far before the structure
TWIN_MEDIAN=I.TWIN_MEDIAN  # the two carriageways of a road share one height where no more than this lies between their pavements (the rule and its functions are i93_north.py's, shared with Interstate 93: alongside, twin_lift, eased, lower_envelope)
TWIN_REACH=I.TWIN_REACH
TWIN_APART=I.TWIN_APART
TWIN_RATE=I.TWIN_RATE
TWIN_STEP=I.TWIN_STEP
LIFTED=I.LIFTED
THROUGH=.9            # cosine between a record that ends on a vertex and one that starts there, when the two carry one road through it
STREET_FLUSH=HR.FLUSH  # a deck this close to the terrain at a station lies on the ground there: where it shares a vertex with a street it is that street's own pavement (on_street), as highway_roadways.py keeps the paving beside a deck by the same step
TO_FEET=Transformer.from_crs(4326,2249,always_xy=True)
FT=1200/3937
METHOD=('Boston GIS layer 8 segments of the Massachusetts Turnpike, Storrow Drive and their ramps in travel order, resampled with source vertices kept; '
 'profiles solved as smoothing splines over the graded terrain with street and water clearances above and overpass clearances beneath, the street bridges over the cut levelled between their landings first '
 '(a street the segments start at level 0 on a bridge node over the road taken as that bridge\'s ramp); '
 'stretches below source level 0, under a reviewed tunnel span or under a building, and cuts walled at the pavement edge, kept as tunnel records with their covered intervals, every other stretch a deck with the grid cut under it; '
 "the survey's cut closed under each building over a road, passages recorded for building_passages.py where a ramp cannot pass under a base, structures standing in the roadway removed; "
 'ramps matched to their carriageway at the gore and landed on the graded street vertex, or on the Central Artery tunnel road they join, and a deck split where a street joins it at its height; '
 'concrete closures inside the Newton coverage edge')


def project(lon,lat):
 x,y=TO_FEET.transform(lon,lat);return [round((x-771100)*FT,3),round(-(y-2952900)*FT,3)]


def key(p):return (round(p[0],3),round(p[1],3))
def smooth(t):return I.smooth(t)


# ---------------------------------------------------------------- routes
VIADUCT=7.0          # the Allston viaduct's deck over the rail yard beneath it (nothing mapped crosses under it)
# A route lists layer 8 OBJECTIDs in travel order; 'w<id>' is an OpenStreetMap way that fills a gap between
# two segments (cut between their ends). `lanes`: (first segment of a run, lanes). `names`: (first segment, name).
# `landing`: the reviewed length a ramp runs on the street it lands on before it leaves for its own cut (street_stretch),
# `width`: its reviewed pavement width. `cap`: 'start' for a ramp out of a tunnel the package does not carry, which begins at a
# closed bore end under its roof (the runtime closes it as it closes the Central Artery's southern ends, and traffic emerges there).
def R(id,name,parts,lanes=1,kind='motorway_link',bridge='i90',**extra):
 return {'id':id,'name':name,'parts':parts,'lanes':lanes,'kind':kind,'bridge':bridge,**extra}


TURNPIKE=[
 R('i90-eb','I-90 East',[14685,11108,10282,10281,13447,13413,9778,8736,10279,10280,16526,14644,'w8646132',14646,13225,8629,15061,15062,12300,13035,11513,16343,16341,16342,13441,
   10262,10261,8472,10444,10443,13466,10365,10363,8667,14248,8728,13381,10405,10406,9775,13358,10398,13613,10394,8600,11256],
  lanes=[(14685,4),(13413,3),(10279,4),(12300,3),(10262,2),(10365,3),(14248,2)],kind='motorway',closed='start',names=[(13613,'Route 1A North')],main=True,
  spans=[{'from':[-3603.5,-522.7],'to':[-3190.3,-164.9],'rise':VIADUCT},{'from':[-3020,-63],'to':[-2942,-2],'level':-1}]),
 R('i90-wb','I-90 West',[16375,16374,10393,12158,10397,8725,13360,9774,10404,10403,9038,8639,8413,8428,10442,8985,15066,15065,10264,10263,11654,16348,16347,16344,11511,11512,11510,
   14251,9035,10259,10503,8721,11536,11535,14645,'w8814367',16527,16525,10277,10278,8781,13412,13446,8935,15080,10283,15079,14684],
  lanes=[(16375,2),(10442,3),(14251,4),(8781,3),(10283,4)],kind='motorway',closed='end',names=[(16375,'Route 1A South'),(13360,'I-90 West')],main=True,
  spans=[{'from':[-3152,-161.5],'to':[-3588.5,-526.1],'rise':VIADUCT},{'from':[-2906,2],'to':[-2992,-64],'level':-1}]),
 # Allston, Exit 131
 R('i90-eb-exit-131','I-90 East · Exit 131 Brighton / Cambridge',[13411,8998,13416,10310]),
 R('i90-eb-exit-131-cambridge','I-90 East · Exit 131 to Cambridge',[8692]),
 R('i90-eb-exit-131-brighton','I-90 East · Exit 131 to Allston and Brighton',[11809]),
 R('i90-wb-exit-131','I-90 West · Exit 131 Brighton / Cambridge',[8699,9024,13418]),
 R('i90-wb-exit-131-cambridge','I-90 West · Exit 131 to Cambridge',[13420]),
 R('i90-wb-exit-131-brighton','I-90 West · Exit 131 to Allston and Brighton',[13423]),
 R('i90-exit-131-cambridge-street-east','I-90 · Exit 131 to Cambridge Street and the River Street Bridge',[9434]),
 R('i90-exit-131-cambridge-street-west','I-90 · Exit 131 to Cambridge Street and Brighton',[11808]),
 R('i90-entrance-131-east','I-90 · Entrance from Cambridge Street',[11807]),
 R('i90-entrance-131-east-turn','I-90 · Entrance from Cambridge Street',[11815]),
 R('i90-entrance-131','I-90 · Entrance from Cambridge Street',[8569,15081]),
 R('i90-entrance-131-west','I-90 · Entrance from Cambridge Street at Lincoln Street',[9437]),
 R('i90-wb-entrance-131-from-east','I-90 West · Entrance from Cambridge Street',[13419]),
 R('i90-wb-entrance-131-from-west','I-90 West · Entrance from Cambridge Street',[13415]),
 R('i90-wb-entrance-131','I-90 West · Entrance from Cambridge Street',[13414]),
 R('i90-eb-entrance-131-from-east','I-90 East · Entrance from Cambridge Street',[13421]),
 R('i90-eb-entrance-131-from-west','I-90 East · Entrance from Cambridge Street',[13422]),
 R('i90-eb-entrance-131','I-90 East · Entrance from Cambridge Street',[13417,8638,8760,8978]),
 # Back Bay
 R('i90-wb-entrance-massachusetts-avenue','I-90 West · Entrance from Massachusetts Avenue',[9178]),
 # The Stuart Street branch (11048, 11047, 9177) dives under both carriageways and climbs 11 m to the street in 80 m: left out.
 R('i90-eb-exit-133','I-90 East · Exit 133 Prudential Center / Copley Square',[15053,15054,15724,15723]),
 # Layer 8 leaves the Dartmouth Street entrance at level 0 along Huntington Avenue, which it runs beneath to the tunnel:
 # it goes down a walled slot in the island between the avenue's two carriageways. The curb survey (layer 6) puts the
 # island's nose 12 m from the Dartmouth Street vertex and the slot's inner curbs 6 m apart; by their class width (15 m
 # each, 15 m apart) the carriageways would carry the ramp on their own pavement as far as Exeter Street.
 R('i90-wb-entrance-copley','I-90 West · Entrance from Dartmouth Street',[10257,10258],level=-1,landing=12,width=6.0),
 R('i90-wb-entrance-clarendon','I-90 West · Entrance from Clarendon Street',[11069]),
 R('i90-wb-entrance-arlington','I-90 West · Entrance from Arlington Street',[14293]),
 # South Bay: the Turnpike and the Central Artery tunnel
 R('i90-wb-entrance-albany','I-90 West · Entrance from Albany Street',[8549]),
 R('i90-wb-entrance-i93','I-90 West · Entrance from I-93 South and Albany Street',[8591]),
 # From the Central Artery's Purchase Street entrance ramp, 12 m down at the end of its collector tunnel: the ramp stays below Albany Street until
 # it meets the Turnpike in its cut (layer 8 brings it to level 0 on the way). The collector from the southbound exit ramp to that tunnel (8980)
 # passes under the exit ramp's own portal cut within 100 m of both and is left out: southbound traffic reaches it by Purchase Street.
 R('i90-wb-from-i93-south','I-90 West · Entrance from I-93 South and Purchase Street',[14775,8515],level=-1),
 R('i90-eb-exit-134','I-90 East · Exit 134 I-93 North / South Station',[10260]),
 R('i90-eb-exit-134-south-station','I-90 East · Exit 134A to South Station',[10265,11019]),
 R('i90-eb-exit-134-i93-north','I-90 East · Exit 134B to I-93 North',[11038,11013,8622,11014]),
 R('i90-to-i93-north','I-90 · Entrance to I-93 North',[8437]),
 R('i90-wb-exit-135','I-90 West · Exit 135 South Boston / I-93 North',[8624]),
 R('i90-wb-exit-135-congress','I-90 West · Exit 135 to Congress Street',[8915,17588]),
 R('i90-wb-exit-134-i93-north','I-90 West · Exit 134 to I-93 North',[17592,8368,9779,11017]),
 # South Boston, Exit 135
 # The segment climbs from level -1 to 0 and crosses West Service Road half way: the ramp stays under the street and comes out of the
 # ground in the survey's cut beyond it.
 R('i90-eb-exit-135','I-90 East · Exit 135 South Boston',[11117],spans=[{'from':[2038.252,252.661],'to':[2189.1,229.8],'level':-1}]),
 R('i90-eb-exit-135-congress','I-90 East · Exit 135 to Congress Street',[18017]),
 R('i90-eb-exit-135-haul-road','I-90 East · Exit 135 to the South Boston Haul Road',[11024,14778]),
 # The entrance leaves the Haul Road as a lane on its pavement; the curb survey has the two roadways apart 24 m on.
 R('i90-eb-entrance-135','I-90 East · Entrance from the South Boston Haul Road',[17593,10364],landing=24),
 R('i90-wb-entrance-135','I-90 West · Entrance from the South Boston Haul Road',[11020,8712]),
 # Layer 8 draws each turning roadway where a ramp meets its streets as a segment of its own, and the entrance from Congress Street
 # (17590) goes down its own cut in the survey to the Exit 134 ramp, 5.7 m below the street: a trench with no road in it until the ramp is one.
 R('i90-eb-exit-135-haul-road-east','I-90 East · Exit 135 to the South Boston Haul Road',[11025]),
 R('i90-wb-entrance-135-congress','I-90 West · Entrance from Congress Street to I-93 North',[17591,17590]),
 R('i90-wb-entrance-135-congress-east','I-90 West · Entrance from B Street to I-93 North',[17584]),
 # The westbound exit's second turning roadway. The curb survey has one roadway from the gore under 401 Congress Street to Congress
 # Street, 8 to 17 m wide, that fans out to two vertices there, and layer 8 draws a centre line to each: without this one the ramp
 # filled the east half of its roadway and reached Congress Street eastbound only. It leaves its sibling down in that ramp's walled
 # cut and is matched to it while their pavements overlap, so it takes that ramp's grade class.
 R('i90-wb-exit-135-congress-west','I-90 West · Exit 135 to Congress Street',[17589],grade=TUNNEL_RAMP_GRADE),
 # D Street's ramp down to the Haul Road, 21 m short of the westbound entrance (11020): a roadway of its own, 6 to 8 m between its
 # curbs, that leaves D Street on its bridge (level 1) and comes down along the foot of the deck over the Turnpike.
 R('i90-wb-entrance-135-d-street','I-90 West · Entrance from D Street',[9090]),
 # The second barrel up to Congress Street, beside the exit from the eastbound carriageway (18017): the exit from the tunnel that
 # brings Interstate 93 North to the Turnpike eastbound. The package does not carry that tunnel (8451 and the segments before it:
 # 1.4 km under the South Bay and Fort Point Channel and the viaduct that feeds it; nor 8444, its last 104 m before the carriageway),
 # so the ramp starts at the tunnel's node as a closed bore end (`cap`). It passes under the two Haul Road ramps and comes out where
 # layer 8 changes level: the survey has its cut there, 67 m long and deepest at that end, between curbs of its own with nothing
 # between them. A 6 m grid shows a cut that narrow as a dent 1.4 m deep, so the stretch below level 0 runs on 20 m past the portal
 # (short of the carriageways the ramp crosses over further on) and the road climbs out of the ground on its own grade.
 R('i90-eb-exit-135-from-i93','I-90 East · Exit 135 to Congress Street',[11034,8626,18016],cap='start',spans=[{'from':[2264.041,241.358],'to':[2333.8,215.0],'level':-1}]),
 R('i90-eb-exit-135-from-i93-east','I-90 East · Exit 135 to Congress Street',[18018]),
 # East Boston, Exit 137 and Route 1A
 R('i90-eb-exit-137','I-90 East · Exit 137 Logan Airport',[11065]),
 R('i90-eb-exit-137-terminals','I-90 East · Exit 137 to the Logan Airport terminals',[11023,8516,9777,10411,10410]),
 R('i90-eb-exit-137-hotel','I-90 East · Exit 137 to Hotel Drive',[11030,8782,8579]),
 R('i90-wb-entrance-137','I-90 West · Entrance from Logan Airport',[16449,11067]),
 R('route1a-nb-exit-neptune','Route 1A North · Exit to Neptune Road',[11126],bridge='route1a'),
 R('route1a-sb-exit-logan','Route 1A South · Exit to Logan Airport',[8553,8663,11220],bridge='route1a'),
 R('route1a-nb-entrance-logan','Route 1A North · Entrance from Logan Airport',[8493,10407,9020,8494,8627],bridge='route1a'),
]
# Storrow Drive (James J Storrow Memorial Drive in layer 8) between the Boston University Bridge, where it carries on
# as Soldiers Field Road, and David G. Mugar Way, which the package already has along the river to Leverett Circle (as
# David G. Mugar Way, then Charlesbank Road). Both carriageways land on those streets' own vertices, so neither has a closed end. Lane counts follow the OpenStreetMap
# ways of the cached Brookline and Cambridge extracts (STORROW_TAG_WAYS).
def SR(id,name,parts,**extra):return R(id,name,parts,bridge='storrow',**{'stiffness':I.STIFFNESS,**extra})
STORROW=[
 SR('storrow-eb','Storrow Drive East',[8850,8828,8704,8708,12142,8856,10241,10499,10240,14454,12136,12132,12133,11253,12130,8688,10505,14325],
  lanes=[(8850,2),(12136,3),(11253,2)],kind='motorway',main=True,grade=.09,stiffness=I.STIFFNESS,
  # The tunnel at the Esplanade, as OpenStreetMap maps it (ways 8648153 and 932735298): under Back Street and the westbound lanes.
  spans=[{'from':[-230.2,-524.9],'to':[103.9,-661.5],'buried':True}]),
 SR('storrow-wb','Storrow Drive West',[9283,12129,12131,12134,12135,15059,15060,12141,7459,17732],lanes=[(9283,2),(12131,3),(12141,2)],kind='motorway',main=True,grade=.09,stiffness=I.STIFFNESS),
 # Boston University Bridge: the loop by University Road
 SR('storrow-eb-exit-university','Storrow Drive East · Exit to University Road',[25511]),
 SR('storrow-eb-entrance-university','Storrow Drive East · Entrance from University Road',[25456]),
 # Charlesgate and the Bowker Overpass
 SR('storrow-wb-exit-charlesgate','Storrow Drive West · Exit to Fenway / Kenmore Square',[9287]),
 SR('storrow-wb-exit-charlesgate-bowker','Storrow Drive West · Exit to the Bowker Overpass',[8556]),
 SR('storrow-wb-exit-charlesgate-beacon','Storrow Drive West · Exit to Charlesgate',[12138]),
 SR('storrow-wb-entrance-charlesgate-from-beacon','Storrow Drive West · Entrance from Beacon Street',[12139,10244,10501],grade=.09),
 SR('storrow-wb-entrance-charlesgate-from-bowker','Storrow Drive West · Entrance from the Bowker Overpass',[10242,10500],grade=.09),
 SR('storrow-wb-entrance-charlesgate','Storrow Drive West · Entrance from Charlesgate',[9078,9362],grade=.09),
 # Massachusetts Avenue (the Harvard Bridge)
 SR('storrow-wb-exit-massachusetts-avenue','Storrow Drive West · Exit to Massachusetts Avenue',[11254]),
 SR('storrow-eb-entrance-bowker','Storrow Drive East · Entrance from the Bowker Overpass',[9014,13249]),
 SR('storrow-eb-entrance-massachusetts-avenue','Storrow Drive East · Entrance from Massachusetts Avenue',[13250]),
 # Back Bay: the tunnel at the Esplanade
 SR('storrow-eb-exit-clarendon','Storrow Drive East · Exit to Clarendon Street / Copley Square',[18021]),
 SR('storrow-eb-exit-beacon','Storrow Drive East · Exit to Beacon Street / Arlington Street',[8513,10291,10290]),
 SR('storrow-eb-entrance-berkeley','Storrow Drive East · Entrance from Berkeley Street',[10288,10289,14326]),
 SR('storrow-wb-entrance-berkeley','Storrow Drive West · Entrance from Berkeley Street',[9742]),
 # Charles Circle. North of David G. Mugar Way layer 8 names the two roadways Charlesbank Road and Charles Street, which the
 # package has as streets; the ramps between the southbound one and the circle, over the northbound one, are unnamed
 # segments like every ramp above.
 SR('storrow-wb-exit-charles-circle','Storrow Drive West · Exit to Charles Circle / Government Center',[11054,11053,11052,8895]),
 SR('storrow-wb-exit-charles-circle-longfellow','Storrow Drive West · Exit to the Longfellow Bridge',[8460]),
 SR('storrow-wb-entrance-charles-circle','Storrow Drive West · Entrance from Charles Circle',[11146,11055,11056]),
]
ROUTES=TURNPIKE+STORROW
# OpenStreetMap ways the routes use: the Turnpike through the Brookline sliver at the Boston University Bridge.
OSM_WAYS=[8646132,8814367]
OSM_TOWNS=('brookline','cambridge')
TAGS=('highway','ref','name','lanes','layer','bridge','tunnel','oneway','maxheight','maxspeed','destination','junction:ref')
# Where two roads of the stage cross at one source level, the first passes over the second.
OVER={('i90-eb-exit-134-i93-north','i90-wb-exit-134-i93-north')}   # the ramp coming down from the surface crosses the one coming up from under the channel 280 m before they meet


def extract(source_dir):
 """The source sidecar: every layer 8 segment and OpenStreetMap way the routes use."""
 wanted={p for r in ROUTES for p in r['parts'] if isinstance(p,int)};layer=json.loads((source_dir/'layer-8.json').read_text());features={}
 for f in layer['features']:
  a=f['attributes']
  if a['OBJECTID'] in wanted:
   assert len(f['geometry']['paths'])==1,f"layer 8 segment {a['OBJECTID']} has several paths"
   features[a['OBJECTID']]={'id':a['OBJECTID'],'segment':a.get('SEGMENT_ID'),'name':(a.get('ST_NAME') or '').strip(),'type':a.get('ST_TYPE'),'cfcc':(a.get('CFCC') or '').strip(),'oneway':a.get('ONEWAY'),
    'from':a.get('F_ZLEV') or 0,'to':a.get('T_ZLEV') or 0,'speed':a.get('SPEEDLIMIT'),'points':[project(*v) for v in f['geometry']['paths'][0]]}
 missing=sorted(wanted-set(features));assert not missing,f'highway source segments missing from layer 8: {missing}'
 ways={};extracts={t:json.loads((source_dir/f'osm-{t}-roads.json').read_text()) for t in OSM_TOWNS};stamps={t:d.get('osm3s',{}).get('timestamp_osm_base') for t,d in extracts.items()}
 wanted_ways=set(OSM_WAYS)|{w for w in STORROW_TAG_WAYS}
 for town in sorted(OSM_TOWNS,key=lambda t:(stamps[t] or '',t),reverse=True):
  for e in extracts[town]['elements']:
   if e.get('type')=='way' and e['id'] in wanted_ways and e['id'] not in ways:
    ways[e['id']]={'id':e['id'],'town':town,'tags':{k:e['tags'][k] for k in TAGS if k in e.get('tags',{})},'points':[project(g['lon'],g['lat']) for g in e['geometry']]}
 missing=sorted(wanted_ways-set(ways));assert not missing,f'highway source ways missing from the extracts: {missing}'
 # The curb survey along the routes (layer 6), which the roadways are measured to (highway_roadways.py).
 survey=json.loads((source_dir/'layer-6.json').read_text());used=[features[p]['points'] if isinstance(p,int) else ways[int(p[1:])]['points'] for r in ROUTES for p in r['parts']]
 curbs=HR.extract_curbs(survey['features'],project,used)
 return {'version':1,'name':'Massachusetts Turnpike, Storrow Drive and the Central Artery tunnel ramps','source':layer.get('source','Boston GIS street centerlines (layer 8)'),
  'url':'https://gisportal.boston.gov/arcgis/rest/services/Infrastructure/OpenData/MapServer/8','license':'City of Boston open data; source centerline attributes retained',
  'osm':{'source':'OpenStreetMap town road extracts (data-source-cache/osm-<town>-roads.json)','url':'https://www.openstreetmap.org/','license':'ODbL 1.0, © OpenStreetMap contributors','extracts':stamps},
  'projection':'EPSG:4326 to Massachusetts State Plane feet (EPSG:2249), metres from 771100 E, 2952900 N, z southward, like every Boston street',
  'features':[features[i] for i in sorted(features)],'ways':[ways[i] for i in sorted(ways)],
  'curbSurvey':{'source':survey.get('source','Boston GIS curbs (layer 6)'),'url':'https://gisportal.boston.gov/arcgis/rest/services/Infrastructure/OpenData/MapServer/6','reachMeters':HR.CURB_ZONE},'curbs':curbs}


# The OpenStreetMap ways along Storrow Drive that carry a posted clearance (`maxheight`) or its tunnel, west to east then back.
STORROW_TAG_WAYS=[8636729,807640156,807640158,807640159,242520458,8648153,932735298,822392249,1525900443,1525900444,828315560,1525900445,41877950,807640157]


# ---------------------------------------------------------------- plans
def clean(points):
 out=[]
 for p in points:
  if not out or math.dist(out[-1],p)>.005:out.append([round(p[0],3),round(p[1],3)])
 return out


def filler(way,a,b):
 """The stretch of an OpenStreetMap way between the points nearest `a` and `b` (the layer 8 segment ends it
 joins), its ends shifted onto them and the shift faded out over BLEND metres."""
 line=LineString(way['points']);da,db=line.project(Point(a)),line.project(Point(b));assert db>da+1,f"way {way['id']} runs against its route"
 pts,_=I.cut_line([list(p) for p in way['points']],[0]*len(way['points']),start=da,end=db);along=stations(pts);total=along[-1]
 oa=(a[0]-pts[0][0],a[1]-pts[0][1]);ob=(b[0]-pts[-1][0],b[1]-pts[-1][1]);reach=min(BLEND,total/2);out=[]
 for p,s in zip(pts,along):
  wa=1-smooth(s/reach);wb=1-smooth((total-s)/reach);out.append([round(p[0]+oa[0]*wa+ob[0]*wb,3),round(p[1]+oa[1]*wa+ob[1]*wb,3)])
 out[0]=list(a);out[-1]=list(b);return clean(out)


def assemble(source,spec):
 """A route's centre line: points, the pseudo way each point leads into, and the pseudo ways
 ({id: {'tags': {'layer', 'lanes'}, 'feature', 'name'}}). A segment whose level changes is cut at its
 middle into two pseudo ways."""
 features={f['id']:f for f in source['features']};osm={w['id']:w for w in source['ways']};parts=spec['parts'];points=[];owner=[];ways={}
 lanes=spec['lanes'];names=dict(spec.get('names',[]));lane=dict(lanes) if isinstance(lanes,list) else None;n=lanes[0][1] if lane else lanes;name=spec['name']
 def add(pts,way_id,level,feature):
  nonlocal points,owner
  ways[way_id]={'id':way_id,'tags':{'layer':str(level),'lanes':str(n)},'feature':feature,'name':name}
  if points:
   assert math.dist(points[-1],pts[0])<.02,f"{spec['id']}: source chain broken before {feature} ({points[-1]} to {pts[0]})"
   owner[-1]=way_id;pts=pts[1:]   # the shared vertex leads into the new way
  points+=pts;owner+=[way_id]*len(pts)
 for k,part in enumerate(parts):
  if isinstance(part,str):
   prev=features[parts[k-1]]['points'][-1];nxt=features[parts[k+1]]['points'][0];add(filler(osm[int(part[1:])],prev,nxt),part,0,part);continue
  f=features[part]
  if lane and part in lane:n=lane[part]
  if part in names:name=names[part]
  pts=clean(f['points']);a,b=f['from'],f['to']
  if a==b:add(pts,str(part),a,part);continue
  along=stations(pts);half=along[-1]/2;head,_=I.cut_line(pts,[0]*len(pts),end=half);tail,_=I.cut_line(pts,[0]*len(pts),start=half)
  add(clean(head),f'{part}a',a,part);add(clean(tail),f'{part}b',b,part)
 # Two source vertices closer than SLIVER leave a segment too short to build a deck on (a flipped triangle at a record's end):
 # the one that is not a segment's end goes, since ramps and streets join the route at segment ends.
 node={key(features[p]['points'][i]) for p in parts if not isinstance(p,str) for i in (0,-1)};keep=[True]*len(points);last=0
 for i in range(1,len(points)):
  if math.dist(points[i],points[last])>=SLIVER:last=i;continue
  final=i==len(points)-1
  if (final or key(points[i]) in node) and last>0 and key(points[last]) not in node:keep[last]=False;last=i
  elif not final and key(points[i]) not in node:keep[i]=False
  else:last=i
 points=[p for p,k in zip(points,keep) if k];owner=[o for o,k in zip(owner,keep) if k]
 # the last point leads nowhere: it keeps the last way
 return points,owner,ways


def least_width(plan,i):
 """The narrowest pavement a station's lanes take: the runtime keeps each outer lane's centre HR.LANE_ROOM (1.2 m) inside the
 edge, which is also the room an inner lane keeps to the face of the median barrier (highway_roadways.part)."""
 return (plan.lanes[i]-1)*LANE+2*HR.LANE_ROOM if plan.main else 4.6


def twin_cap(plan,other):
 """Keep a carriageway clear of its twin: where the two pavements (at their nominal widths) would overlap or leave
 no room for the walls between them, each gives up half of what is missing, down to least_width. Returns the widths."""
 pts=shapely.points(plan.points);d=shapely.distance(other.line,pts);s=shapely.line_locate_point(other.line,pts);out=list(plan.widths)
 for i in range(len(plan.points)):
  if s[i]<=.5 or s[i]>=other.line.length-.5 or float(d[i])<=4:continue
  missing=(plan.nominal[i]+float(np.interp(s[i],other.along,other.nominal)))/2+WALL-float(d[i])
  if missing>0:out[i]=round(min(out[i],max(plan.nominal[i]-missing,least_width(plan,i))),3)
 return out


def building_cap(plan):
 """Narrow the pavement beside a building that reaches over its edge only (never over its centre line, plan.centred):
 the centre lines are Boston's and the widths lane-count guesses, and where a building stands at the edge of
 the cut its wall is the cut's. Each such station at source level 0 keeps the room from its centre line to the building less
 0.4 m, never under least_width, and the change tapers at 1 m in 20. Returns whether a width changed."""
 n=len(plan.points);caps={}
 for i in range(n):
  if plan.level[i]!=0:continue   # a tunnel passes under the buildings over it and a viaduct over the sheds beneath it
  for j in plan.built[i]:
   if j not in plan.centred:caps[i]=min(caps.get(i,math.inf),2*(plan.buildings[j]['shape'].distance(Point(plan.points[i]))-.4))
 return narrow(plan,caps)


def narrow(plan,caps):
 """Hold a plan's widths to `caps` ({station: width}), never under least_width, the change tapering at 1 m in 20. Returns whether a width changed."""
 if not caps:return False
 at=np.asarray([float(plan.along[i]) for i in caps]);cap=np.asarray([caps[i] for i in caps]);changed=False
 for i in range(len(plan.points)):
  w=max(least_width(plan,i),min(plan.widths[i],float(np.min(cap+np.abs(at-float(plan.along[i]))/20))))
  if w<plan.widths[i]-.005:plan.widths[i]=round(w,3);changed=True
 return changed


def street_cap(plan,streets,lines,tree):
 """Narrow the pavement beside a surface street that runs along it at source level 0 (Newbury Street beside the
 Turnpike's cut): each station keeps the room from its centre line to the street's roadway (its class width; the
 width measured between its curbs is build-street-surfaces.py's output, which follows this stage) less 0.6 m for
 the wall between them. A street the plan lands on or crosses is no neighbour."""
 n=len(plan.points);pts=shapely.points(plan.points);caps={};landing={id(r) for kind in plan.ends if kind and kind[0]=='street' for r,_ in kind[1]}
 for j in sorted(tree.query(plan.line,predicate='dwithin',distance=max(plan.widths)/2+12).tolist()):
  r=streets[j]
  if id(r) in landing:continue
  half=r['width']/2;d=shapely.distance(lines[j],pts);s=shapely.line_locate_point(lines[j],pts)
  a=shapely.get_coordinates(shapely.line_interpolate_point(lines[j],np.maximum(s-1,0)));b=shapely.get_coordinates(shapely.line_interpolate_point(lines[j],np.minimum(s+1,lines[j].length)))
  t=b-a;t/=np.maximum(np.hypot(t[:,0],t[:,1]),1e-9)[:,None];along_=np.abs(np.sum(t*np.asarray(plan.tangents),axis=1))>=PARALLEL
  for i in range(n):
   if plan.level[i]==0 and along_[i] and .5<s[i]<lines[j].length-.5 and d[i]-half-.6<plan.widths[i]/2 and d[i]>half:caps[i]=min(caps.get(i,math.inf),2*(float(d[i])-half-.6))
 return narrow(plan,caps)


class Plan(I.Plan):
 """An I-93 plan whose underground stations (`candidate`) have no ground floor at all: they follow the natural line under
 their ceilings. `street` marks the stations of a reviewed street landing (street_stretch), `reach` its length at each end."""
 candidate=();water=None
 def __init__(self,*args):
  super().__init__(*args);self.street=[False]*len(self.points);self.reach=[0.,0.];self.on_deck=[False,False]
 def wet_at(self,k):return bool(self.water_polygons) and any(poly.covers(Point(self.points[k])) for poly in self.water_polygons)
 def bounds(self):
  low,high,target,weight,soft=super().bounds()
  for i in range(len(self.points)):
   if i not in self.fixed and self.candidate and self.candidate[i]:low[i]=self.floor[i];soft[i]=-math.inf
  return low,high,target,weight,soft


class Fixed:
 """An existing road with a profile (a Central Artery tunnel road) that new ramps start or end on."""
 def __init__(self,road):
  self.id=road['id'];self.road=road;self.points=[list(p) for p in road['points']];self.y=list(road['elevations']);self.along=np.asarray(stations(self.points));self.line=LineString(self.points)
  self.widths=list(road.get('deckWidths') or [road['width']]*len(self.points));self.tangents=I.tangents(self.points);self.clearance=road['tunnel']['clearance']
 def at(self,d):return float(np.interp(d,self.along,self.y))
 def width_at(self,d):return float(np.interp(d,self.along,self.widths))
 def nearest(self,p):return int(np.argmin([(q[0]-p[0])**2+(q[1]-p[1])**2 for q in self.points]))


def plans_of(source,city,routes):
 """Unsolved plans of the routes, each with its pseudo ways (plan.ways) and levels (plan.level)."""
 outline=Polygon(city['coverage'][0]);out=[]
 for spec in routes:
  points,owner,ways=assemble(source,spec);main=spec.get('main')
  if spec.get('closed')=='start':points,owner=I.cut_line(points,owner,start=I.barrier_station(points,outline,False))
  if spec.get('closed')=='end':points,owner=I.cut_line(points,owner,end=I.barrier_station(points,outline,True))
  rp,ro=I.resample_owned(points,owner);lanes=[int(ways[o]['tags']['lanes']) for o in ro]
  parkway=spec['bridge']=='storrow'   # no shoulders: the lanes and a kerb's width
  if parkway:widths=I.taper(rp,[(l-1)*LANE+3.0 for l in lanes],60) if main else [5.6]*len(rp)
  else:widths=I.taper(rp,[I.mainline_width(l) for l in lanes],80) if main else I.taper(rp,[I.RAMP_WIDTHS[min(2,l)] for l in lanes],40)
  if 'width' in spec:widths=[float(spec['width'])]*len(rp)   # reviewed against the curb survey
  level=[int(ways[o]['tags']['layer']) for o in ro]
  plan=Plan(spec['id'],rp,ro,widths,spec.get('grade',I.MAINLINE_GRADE if main else TUNNEL_RAMP_GRADE if min(level)<0 or spec.get('level',0)<0 else I.RAMP_GRADE),lanes)
  if not main or parkway:plan.radius=I.RAMP_RADIUS
  plan.under=STORROW_UNDER if parkway else CLEAR_UNDER;plan.spec=spec;plan.ways=ways;plan.main=bool(main);plan.level=[spec['level']]*len(level) if 'level' in spec else level
  plan.clearance=STORROW_CLEARANCE if spec['bridge']=='storrow' else CLEARANCE;plan.rises=[];plan.buried=[bool(spec.get('buried'))]*len(rp)
  # Reviewed spans: stations between the points nearest `from` and `to` take a source level (an underpass the
  # segments leave at level 0) or a least height over the ground (a viaduct with nothing mapped beneath it).
  for span in spec.get('spans',[]):
   a,b=sorted(int(np.argmin(np.abs(plan.along-plan.line.project(Point(span[k]))))) for k in ('from','to'))
   if 'level' in span:
    for i in range(a,b+1):plan.level[i]=span['level']
   if 'rise' in span:plan.rises.append((a,b,span['rise']))
   if span.get('buried'):
    for i in range(a,b+1):plan.buried[i]=True
  out.append(plan)
 mains=[p for p in out if p.main]
 for a in mains:a.nominal=list(a.widths)
 capped={a.id:[twin_cap(a,b) for b in mains if a is not b and a.spec['bridge']==b.spec['bridge']] for a in mains}
 for a in mains:
  for widths in capped[a.id]:a.widths=[min(v,w) for v,w in zip(a.widths,widths)]
 return out


def keep_beside(plan,e,other,nodes=frozenset()):
 """Layer 8 draws a ramp on the centre line of the road it leaves or joins for up to 200 m. Move it beside
 that road: beyond BESIDE[0] metres from the gore (end `e`) each station whose pavement would overlap the
 other road's shifts sideways, fully clear (WALL between the pavements) from BESIDE[1] metres on, on the side
 the source line runs. The shift fades out again where the source line crosses the other road's centre line
 (a ramp that passes over a carriageway before running beside it). The moved run is then eased: each
 station but the plan's ends and the vertices other routes meet (`nodes`) moves toward the mean of its
 neighbours, so the stations set off the other road's curve do not fold where the ramp turns away from it
 (the Prudential exit's loop). Returns the stations moved."""
 n=len(plan.points);order=list(range(n)) if e==0 else list(range(n-1,-1,-1));start=float(plan.along[order[0]]);rows=[];total=other.line.length
 for i in order[1:-1]:
  p=Point(plan.points[i]);d=other.line.project(p)
  if d<=.5 or d>=total-.5:break
  q=other.line.interpolate(d);a=other.line.interpolate(max(0,d-1));b=other.line.interpolate(min(total,d+1));tx,tz=b.x-a.x,b.y-a.y;L=math.hypot(tx,tz) or 1;tx/=L;tz/=L
  off=tx*(p.y-q.y)-tz*(p.x-q.x);need=(plan.widths[i]+other.width_at(d))/2+WALL
  if abs(off)>=need:
   if rows and abs(plan.along[i]-plan.along[rows[-1][0]])>30:break
   continue
  rows.append((i,off,need,(q.x,q.y),(-tz,tx),abs(float(plan.along[i])-start)))
 if not rows:return 0
 # The side the line keeps over most of the run; the run ends where it has crossed to the other side.
 side=1 if sum(1 if off>0 else -1 for _,off,_,_,_,_ in rows if abs(off)>.75)>=0 else -1;kept=[]
 for row in rows:
  if row[1]*side<-1.5:break
  kept.append(row)
 if not kept:return 0
 far=kept[-1][5];crossed=len(kept)<len(rows);moved=[]
 for i,off,need,q,normal,dist in kept:
  w=I.smooth((dist-BESIDE[0])/(BESIDE[1]-BESIDE[0]))*(I.smooth((far-dist)/BESIDE[0]) if crossed else 1);target=max(off*side,need*w)
  if target>off*side+.01:plan.points[i]=[round(q[0]+normal[0]*side*target,3),round(q[1]+normal[1]*side*target,3)];moved.append(i)
 if moved:
  span=[i for i in range(max(1,min(moved)-4),min(n-1,max(moved)+5)) if key(plan.points[i]) not in nodes]
  for _ in range(4):
   eased={i:[(plan.points[i-1][k]+2*plan.points[i][k]+plan.points[i+1][k])/4 for k in (0,1)] for i in span}
   for i,q in eased.items():plan.points[i]=[round(q[0],3),round(q[1],3)]
  plan.along=np.asarray(stations(plan.points));plan.tangents=I.tangents(plan.points);plan.line=LineString(plan.points)
 return len(moved)


# ---------------------------------------------------------------- constraints
def cross_sections(plan,margin):
 """Sample points across every station: (stations x 7 x 2)."""
 p=np.asarray(plan.points,float);t=np.asarray(plan.tangents,float);n=np.stack([-t[:,1],t[:,0]],1);half=np.asarray(plan.widths,float)/2+margin
 return p[:,None,:]+n[:,None,:]*(np.linspace(-1,1,7)[None,:,None]*half[:,None,None])


def measure_ground(plan,ground,raw):
 """Ground under every station from the graded grid: plan.high and plan.low, the highest and lowest across the
 lanes (the middle two thirds of the width), plan.edge the highest across the full width, and plan.terrain, the
 ground the profile follows: the median across the lanes at or above source level 0, less the fill the
 grader laid across the road for a street (`raw` is the survey grid), and the lowest across the full width
 below level 0, where an open cut narrower than the survey resolves shows only as its floor. plan.mid is the graded
 ground itself, the median across the lanes: the surface of the street a road lands on (street_stretch)."""
 n=len(plan.points);x=cross_sections(plan,.5);g=np.array([[ground(float(a),float(b)) for a,b in row] for row in x]);r=np.array([[raw(float(a),float(b)) for a,b in row] for row in x])
 plan.edge=g.max(1).tolist();plan.high=g[:,1:6].max(1).tolist();plan.low=g.min(1).tolist();plan.mid=np.median(g[:,1:6],axis=1).tolist();fill=np.median(np.where(g-r>FILL,r,g)[:,1:6],axis=1)
 plan.terrain=[plan.low[i] if plan.level[i]<0 else float(fill[i]) for i in range(n)]


def pavement_reach(line,width,e,streets):
 """How far a line of pavement `width` runs from its end `e` (0 start, 1 end) over the roadway of the streets it lands
 on there (each by its class width, 0.4 m more), 6 m at least."""
 total=line.length;extent=0.
 for r,_ in streets:
  other=LineString(r['points']);radius=(r['width']+width)/2+.4;part=line.intersection(other.buffer(radius))
  for g in getattr(part,'geoms',[part]):
   if g.geom_type!='LineString' or g.is_empty:continue
   lo,hi=sorted([line.project(Point(g.coords[0])),line.project(Point(g.coords[-1]))]);start,end=(lo,hi) if e==0 else (total-hi,total-lo)
   if start<=.5:extent=max(extent,end)
 return min(max(extent,6.0),total)


def street_stretch(plan,e):
 """Keep a road on the street it lands on at end `e` over the reviewed `landing` of its spec, the length it runs on that
 street's roadway (measured on the curb survey where the class widths misjudge the junction: pavement_reach had the
 Dartmouth Street entrance on Huntington Avenue's pavement for 180 m). The stations of that stretch are the street's
 (plan.street): they are held on its surface (plan.mid; a floor alone is rounded into a hump ahead of the descent) and
 are no candidates for cover, so the road's descent begins where the roadway ends. Left to its source level, or to the
 survey under the grader's fill (measure_ground), it went down inside the junction instead, under ground that is the
 street's and stays whole."""
 n=len(plan.points);plan.reach[e]=float(plan.spec['landing'])
 for i in range(n):
  if (plan.along[i] if e==0 else plan.along[-1]-plan.along[i])<=plan.reach[e]+.01:
   plan.street[i]=True;plan.terrain[i]=plan.mid[i];plan.allowance[i]=0.;plan.fixed.setdefault(i,round(plan.mid[i],4))


def overhead(plan,streets,lines,tree,buildings,water):
 """What stands over every station: mapped water (`wet`), surface streets (`over`, {street index: lowest street
 surface over the station}) and buildings (`built`, the indices in plan.buildings of every building whose outline
 crosses the station's pavement; `above`, of those of SHED metres or more that stand over the road's centre line
 somewhere). A building is the plan its roof faces cover, not its stored convex footprint, which spans the
 streets beside an L-shaped shell. A street counts when it covers the station's centre or three of its seven
 cross-section samples: one running beside the road only touches its edge. plan.rim gives each such street's level beside the road,
 the highest surface within RIM metres along it beyond the road's edge on its lower side; a street DIP below
 that over the road has sunk into the survey's cut (plan.sunk)."""
 n=len(plan.points);plan.wet=[False]*n;plan.over=[{} for _ in range(n)];plan.above=[[] for _ in range(n)];plan.rim={};plan.sunk={};x=cross_sections(plan,.5);pts=shapely.points(x.reshape(-1,2))
 landing={id(r) for kind in plan.ends if kind and kind[0]=='street' for r,_ in kind[1]}
 near=None if plan.main or not any(plan.landing) else [any(plan.landing[e] and (plan.along[i] if e==0 else plan.along[-1]-plan.along[i])<=PORTAL_REACH for e in (0,1)) for i in range(n)]
 for j in sorted(tree.query(plan.line,predicate='dwithin',distance=max(plan.widths)/2+30).tolist()):
  if id(streets[j]) in landing:continue
  hit=(shapely.distance(lines[j],pts)<=streets[j]['width']/2).reshape(n,7);rows=[i for i in range(n) if hit[i,3] or hit[i].sum()>=3]
  if rows and near is not None:
   # A ramp leaving its street runs down in a slot of its own along the avenue beside it (the Dartmouth Street
   # entrance along Huntington Avenue): a street running along the ramp there is no cover over it, one crossing it is.
   d=shapely.line_locate_point(lines[j],shapely.points([plan.points[i] for i in rows]));a=shapely.get_coordinates(shapely.line_interpolate_point(lines[j],np.maximum(d-1,0)));b=shapely.get_coordinates(shapely.line_interpolate_point(lines[j],np.minimum(d+1,lines[j].length)))
   t=b-a;t/=np.maximum(np.hypot(t[:,0],t[:,1]),1e-9)[:,None];along_=np.abs(np.sum(t*np.asarray([plan.tangents[i] for i in rows]),axis=1))>=PARALLEL
   rows=[i for i,p_ in zip(rows,along_) if not (p_ and near[i])]
  for i in rows:plan.over[i][j]=min(plan.ground(float(a),float(b)) for (a,b),h in zip(x[i],hit[i]) if h)
  if rows:
   line=lines[j];mid=line.project(Point(plan.points[rows[len(rows)//2]]));clear=max(plan.widths[i] for i in rows)/2+4;sides=[]
   for sign in (-1,1):
    heights=[plan.ground(q.x,q.y) for q in (line.interpolate(mid+sign*d) for d in np.arange(clear,RIM,4.0).tolist() if 0<=mid+sign*d<=line.length)]
    if heights:sides.append(max(heights))
   plan.rim[j]=min(sides) if len(sides)==2 else -math.inf;plan.sunk[j]=plan.rim[j]-min(plan.over[i][j] for i in rows)>=DIP
 x0,z0,x1,z1=plan.line.bounds;reach=max(plan.widths)/2+2;corridor=plan.line.buffer(reach);plan.buildings=[];plan.hulls=[];plan.built=[[] for _ in range(n)];plan.centred=set()
 for b in buildings((x0-reach,z0-reach,x1+reach,z1+reach)):
  if not b['hull'].intersects(corridor):continue
  plan.hulls.append(b);shape=b['outline']()
  if not shape.is_empty and shape.intersects(corridor):plan.buildings.append({**b,'shape':shape})
 if plan.buildings:
  # A building is over a station when its outline crosses the pavement there, edge to edge (plan.built, sheds included),
  # and over the road when it also covers the centre line somewhere along it (plan.centred); plan.above lists those of SHED metres or more.
  shapes=[b['shape'] for b in plan.buildings];tree_=STRtree(shapes);p=np.asarray(plan.points,float);t=np.asarray(plan.tangents,float);off=np.stack([-t[:,1],t[:,0]],1)*(np.asarray(plan.widths,float)/2)[:,None]
  for i,j in zip(*tree_.query(shapely.linestrings(np.stack([p+off,p-off],1)),predicate='intersects')):plan.built[int(i)].append(int(j))
  plan.centred={int(j) for _,j in zip(*tree_.query(shapely.points(p),predicate='within'))}
  for i in range(n):
   plan.built[i].sort();plan.above[i]=[j for j in plan.built[i] if j in plan.centred and plan.buildings[j]['height']>=SHED]
 polygons,_=water;wet=[poly for poly in polygons if poly.intersects(plan.line)]
 for i in range(n):
  if any(poly.covers(Point(plan.points[i])) for poly in wet):plan.wet[i]=True


def natural(plan,ends,open_):
 """The straight line between the heights where the road is at grade or in its own open cut (`open_`): its
 level without any cover over it. `ends` gives the known height of an end below ground (None: unknown)."""
 n=len(plan.points);xs=[];ys=[]
 for i in range(n):
  if plan.street[i]:xs.append(float(plan.along[i]));ys.append(plan.terrain[i])
  elif plan.level[i]>=0 or open_[i]:xs.append(float(plan.along[i]));ys.append(plan.terrain[i]+I.TERRAIN_RISE)
 for e,i in ((0,0),(1,n-1)):
  if plan.level[i]<0 and not open_[i] and not plan.street[i]:
   y=ends[e] if ends[e] is not None else plan.low[i]-(plan.clearance+ROOF+COVER)
   if e==0:xs.insert(0,float(plan.along[0]));ys.insert(0,y)
   else:xs.append(float(plan.along[-1]));ys.append(y)
 if not xs:return [plan.low[i]-(plan.clearance+ROOF+COVER) for i in range(n)]
 return np.interp(plan.along,xs,ys).tolist()


def cover(plan,ends=(None,None)):
 """Targets and ceilings of the stations below source level 0. Against the straight line between the heights
 where the road is at grade, a station whose ground lies within OPEN_MAX over the line is the road's own open
 cut: it follows its floor and anchors the natural line (natural). Against that line the ground elsewhere is
 thick enough to roof the road (clearance, ROOF and COVER over the line) or thin. A thin stretch shorter than
 PORTAL_ZONE is a portal's slope or a gap in the survey: the road keeps the line there, in the open. A longer
 one is real ground under a carriageway, which goes down under it (but for its first EDGE metres beside an open
 stretch); a ramp stays on the line, in the open. A station under mapped water stays under its bed, one under a
 surface street under the street, one under a building under the building's base (the roof slab against it); a
 station of a street stretch (street_stretch) is on its street, not under anything; the
 stage closes the survey's cut under a building, and under a street that has sunk into it (plan.sunk), over the
 road (plan.lid). A carriageway at source level 0 under a building is treated the same way where the base leaves
 the headroom within DIP_MAX of its ground (Parcel 12 over the cut at Massachusetts Avenue).
 The target is the lowest that the ceilings within ENVELOPE metres ask for."""
 n=len(plan.points);need=plan.clearance+ROOF;low=plan.low;along=plan.along;plan.candidate=[False]*n;plan.lid=[False]*n
 # A carriageway at source level 0 passes under a building as one below level 0 does, where the building's base leaves the headroom within DIP_MAX under its own ground.
 base=[min((plan.buildings[j]['base'] for j in plan.above[i]),default=math.inf) for i in range(n)]
 roofed=[plan.main and plan.level[i]==0 and base[i]<math.inf and base[i]-.05-need>=plan.terrain[i]+I.TERRAIN_RISE-DIP_MAX for i in range(n)]
 under=[(plan.level[i]<0 or roofed[i]) and not plan.street[i] for i in range(n)]
 for a,b,rise in plan.rises:
  for i in range(a,b+1):plan.floor[i]=max(plan.floor[i],plan.low[i]+rise)
 solid=[under[i] and (plan.buried[i] or plan.wet[i] or bool(plan.over[i]) or bool(plan.above[i])) for i in range(n)]
 # A reviewed tunnel (`buried`) lies under the ground beside it: the highest across its width within two cells along
 # the road, since the 6 m survey shows a tunnel this shallow as a dent and smears its portals.
 edge=np.asarray(plan.edge);ridge=[float(edge[int(np.searchsorted(along,along[i]-12,'left')):int(np.searchsorted(along,along[i]+12,'right'))].max()) for i in range(n)]
 line=natural(plan,ends,[False]*n);open_=[under[i] and not solid[i] and low[i]-line[i]<OPEN_MAX for i in range(n)];floor=[False]*n
 for a,b in runs(open_):
  # (a street stretch beside it is the road's landing, not a stretch at grade the cut leads up to)
  if along[b]-along[a]<OPEN_RUN and not (a>0 and not under[a-1] and not plan.street[a-1]) and not (b<n-1 and not under[b+1] and not plan.street[b+1]):
   for i in range(a,b+1):open_[i]=False
   continue
  # Only the cut's floor anchors the line: its ends lie on the slopes the survey rounds the cut's walls into.
  level=float(np.median(low[a:b+1]))+.5
  for i in range(a,b+1):floor[i]=low[i]<=level
  # Beside a covered stretch the survey rounds the cut's floor up into the ground over the portal: within three cells
  # of that end the floor is the lowest the survey shows there.
  for end,inward in ((a,1),(b,-1)):
   beyond=end-inward
   if 0<=beyond<n and under[beyond]:
    for i in range(a,b+1):
     if abs(float(along[i]-along[end]))<=18:plan.terrain[i]=min(plan.terrain[i],min(low[j] for j in range(a,b+1) if abs(float(along[j]-along[i]))<=18))
 open_=floor;line=natural(plan,ends,open_);plan.natural=line;thin=[under[i] and not open_[i] and not solid[i] and low[i]-line[i]<need+COVER for i in range(n)];portal=[False]*n
 for a,b in runs(thin):
  left=a>0 and (open_[a-1] or not under[a-1]);right=b<n-1 and (open_[b+1] or not under[b+1]);short=along[b]-along[a]<PORTAL_ZONE
  for i in range(a,b+1):portal[i]=short or not plan.main or (left and along[i]-along[a]<EDGE) or (right and along[b]-along[i]<EDGE)
 # From its street landing a road comes down at its grade: a ceiling it cannot be under yet is part of its descent, in the open.
 reach=[-math.inf]*n
 for e in (0,1):
  k=0 if e==0 else n-1
  if plan.landing[e] and k in plan.fixed:
   level=plan.reach[e] if plan.street[k] else 0.   # (a street stretch is level with its street: the descent begins beyond it)
   for i in range(n):reach[i]=max(reach[i],plan.fixed[k]-plan.grade*.9*max(0.,abs(float(along[i]-along[k]))-level))
 target=[math.inf]*n
 for i in range(n):
  if not under[i] or open_[i]:continue
  plan.candidate[i]=True;plan.stiff[i]=max(plan.stiff[i],plan.spec.get('stiffness',TUNNEL_STIFFNESS))
  if portal[i]:continue
  if plan.wet[i]:roof=low[i]-WATER_COVER
  elif solid[i]:
   caps=[plan.buildings[j]['base']+COVER-.05 for j in plan.above[i]];plan.lid[i]=bool(caps)
   for j,surface in ({} if roofed[i] else plan.over[i]).items():
    # Under a street sunk into the survey's cut the cut is closed as far as the road's roof needs and the street's level beside it allows.
    if plan.sunk[j]:plan.lid[i]=True;caps.append(min(plan.rim[j],max(surface,line[i]+need+COVER)))
    else:caps.append(surface)
   roof=(min(caps) if caps else ridge[i] if plan.buried[i] else low[i])-COVER
  else:roof=low[i]-COVER
  if roof-need-.25<reach[i]:continue
  plan.ceiling[i]=min(plan.ceiling[i],roof-need);plan.drop[i]=min(plan.drop[i],roof-need-.25);target[i]=roof-need-.25
 marks=np.flatnonzero(plan.candidate);t=np.asarray(target)
 for i in marks.tolist():plan.hold[i]=min(line[i],float(t[int(np.searchsorted(along,along[i]-ENVELOPE,'left')):int(np.searchsorted(along,along[i]+ENVELOPE,'right'))].min()))
 for i in range(n):
  if under[i] or (len(marks) and float(np.min(np.abs(along[marks]-along[i])))<=PORTAL_REACH):plan.trench[i]=True


def lids(plans,streets,lines,grid,heights,buildings):
 """Close the survey's cut under the buildings standing over the stage's roads and under the streets that have
 sunk into it over a tunnel station (plan.lid). Inside each such building's outline (and half a cell around it)
 the graded grid rises to the building's base, never over it, nor over the base of any other building whose
 footprint holds the vertex (888 Boylston Street stands inside the Prudential's outline on lower ground), except
 along a surface street passing beneath the building: the roof slab lies under the base
 and the building's walls reach the ground instead of hanging over the cut.
 Along each sunk street's corridor (and a cell beside it, where the building lids begin) it rises to the roof slab
 plus COVER, between the points where the street already stands that high, never over the base of a building
 standing there; no vertex of a street lid within a cell of an open stretch of any road of the stage, across the
 road, is raised. Returns the new int16 grid."""
 from north_overpasses import Window,covered
 scale=grid.get('scale',.01);W=grid['width'];C=grid['cellSize'];ox,oz=grid['originX'],grid['originZ'];want={};fixed={}
 def raise_(mask_xy,level,into):
  for v in mask_xy:into[v]=max(into.get(v,-math.inf),level)
 def vertices_in(shape):
  x0,z0,x1,z1=shape.bounds;i0,i1=int((x0-ox)//C),int((x1-ox)//C)+1;j0,j1=int((z0-oz)//C),int((z1-oz)//C)+1
  gi,gj=np.meshgrid(np.arange(i0,i1+1),np.arange(j0,j1+1));gx=ox+gi.ravel()*C;gz=oz+gj.ravel()*C;inside=shapely.contains_xy(shape,gx,gz)
  return (gj.ravel()*W+gi.ravel())[inside].tolist()
 top=lambda plan,i:plan.y[i]+plan.clearance+ROOF+COVER;roofed={};sunk=set()
 for plan in plans:
  by_street=defaultdict(list)
  for i in range(len(plan.points)):
   for j in plan.above[i]:roofed.setdefault(plan.buildings[j]['id'],(plan.buildings[j]['shape'].buffer(C/2),plan.buildings[j]['base']))
   if not plan.lid[i]:continue
   for j in plan.over[i]:
    if plan.sunk[j]:by_street[j].append(i)
  for j,rows in sorted(by_street.items()):
   level=min(plan.rim[j],max(top(plan,i) for i in rows));line=lines[j];mid=line.project(Point(plan.points[rows[len(rows)//2]]));ends=[]
   for sign in (-1,1):
    d=mid
    while 0<d+sign*2<line.length and abs(d-mid)<120:
     d+=sign*2;q=line.interpolate(d)
     if abs(d-mid)>max(plan.widths[i] for i in rows)/2 and plan.ground(q.x,q.y)>=level-.05:break
    ends.append(d)
   a,b=sorted(ends);part=shapely.ops.substring(line,a,b)
   if part.length>1:raise_(vertices_in(part.buffer(streets[j]['width']/2+I.CORRIDOR+C,cap_style='flat')),level,want);sunk.add(j)
 if roofed:
  near=shapely.union_all([shape for shape,_ in roofed.values()]);kept=[lines[j].buffer(streets[j]['width']/2+I.CORRIDOR+C) for j in STRtree(lines).query(near,predicate='dwithin',distance=30).tolist()]
  streets_=shapely.union_all(kept) if kept else Polygon()
  for k in sorted(roofed):shape,level=roofed[k];raise_(vertices_in(shape.difference(streets_)),level,fixed)
  # no vertex over the base of another building standing there
  vs=sorted(fixed);pts=shapely.points(ox+(np.asarray(vs)%W)*C,oz+(np.asarray(vs)//W)*C);others=[b for b in buildings(near.bounds) if b['id'] not in roofed]
  if others:
   # (within a cell of its footprint: the ground at a small building's centre is the four vertices around it)
   for q,j in zip(*STRtree([b['hull'].buffer(C) for b in others]).query(pts,predicate='within')):fixed[vs[int(q)]]=min(fixed[vs[int(q)]],others[int(j)]['base'])
 if not want and not fixed:return heights.copy()
 result=heights.copy()
 if want:
  vs=np.asarray(sorted(want),dtype=np.int64);gx=ox+(vs%W)*C;gz=oz+(vs//W)*C;pts=shapely.points(gx,gz);keep=np.zeros(len(vs),bool)
  # no street lid over the base of a building standing beside the street (within a cell of its footprint, as below)
  beside=list(buildings((float(gx.min())-C,float(gz.min())-C,float(gx.max())+C,float(gz.max())+C)))
  if beside:
   for q,j in zip(*STRtree([b['hull'].buffer(C) for b in beside]).query(pts,predicate='within')):want[int(vs[int(q)])]=min(want[int(vs[int(q)])],beside[int(j)]['base'])
  for plan in plans:
   for a,b in runs([not c for c in plan.candidate]):
    # (across the open stretch, not beyond its ends along the road: there the lid has to reach the first open station)
    if b>a:keep|=shapely.contains_xy(LineString(plan.points[a:b+1]).buffer(max(plan.widths[a:b+1])/2+C,cap_style='flat'),gx,gz)
  new=np.round(np.asarray([want[v] for v in vs.tolist()])/scale).astype(np.int64);up=(new>result[vs])&~keep;result[vs[up]]=new[up].astype(heights.dtype)
 if fixed:
  vs=np.asarray(sorted(fixed),dtype=np.int64);new=np.round(np.asarray([fixed[v] for v in vs.tolist()])/scale).astype(np.int64);up=new>result[vs];result[vs[up]]=new[up].astype(heights.dtype)
 return result


def close_gaps(plans,streets,lines,grid,heights,buildings):
 """Close the holes the lids leave over a tunnel. A stretch below source level 0 that the ground does not roof and
 that runs no further than CLOSE between two roofed stretches (the slot between the Prudential's lid and Ring
 Road's) is no portal: the grid rises over its roadway, and a cell beside it, to the roof slab plus COVER. A hole
 is closed whole or left: not where a vertex would rise over the base of a building standing there, where a
 surface street lies lower, or within a cell of an open stretch of any road of the stage. Returns the new int16
 grid, or None when nothing changes."""
 scale=grid.get('scale',.01);W=grid['width'];C=grid['cellSize'];ox,oz=grid['originX'],grid['originZ'];holes=[]
 for plan in plans:
  n=len(plan.points)
  for a,b in runs([plan.tunnel[i] and plan.level[i]<0 and not plan.covered[i] for i in range(n)]):
   if a==0 or b==n-1 or not (plan.covered[a-1] and plan.covered[b+1]) or plan.along[b+1]-plan.along[a-1]>CLOSE:continue
   level=max(plan.y[i]+plan.clearance+ROOF+COVER for i in range(a-1,b+2));shape=LineString(plan.points[a-1:b+2]).buffer(max(plan.widths[a-1:b+2])/2+.5+C,cap_style='flat')
   x0,z0,x1,z1=shape.bounds;gi,gj=np.meshgrid(np.arange(int((x0-ox)//C),int((x1-ox)//C)+2),np.arange(int((z0-oz)//C),int((z1-oz)//C)+2))
   inside=shapely.contains_xy(shape,ox+gi.ravel()*C,oz+gj.ravel()*C);holes.append(((gj.ravel()*W+gi.ravel())[inside].astype(np.int64),level))
 if not holes:return None
 vs=np.unique(np.concatenate([v for v,_ in holes]));gx=ox+(vs%W)*C;gz=oz+(vs//W)*C;pts=shapely.points(gx,gz);cap=np.full(len(vs),math.inf);kept=np.zeros(len(vs),bool);current=heights[vs].astype(np.float64)*scale
 beside=list(buildings((float(gx.min())-C,float(gz.min())-C,float(gx.max())+C,float(gz.max())+C)))
 if beside:
  for q,j in zip(*STRtree([b['hull'].buffer(C) for b in beside]).query(pts,predicate='within')):cap[int(q)]=min(cap[int(q)],beside[int(j)]['base'])
 for plan in plans:
  for a,b in runs([not c for c in plan.candidate]):
   if b>a:kept|=shapely.contains_xy(LineString(plan.points[a:b+1]).buffer(max(plan.widths[a:b+1])/2+C,cap_style='flat'),gx,gz)
 near=np.full(len(vs),math.inf)   # the lowest a street's corridor lets a vertex stand: its own ground
 for j in STRtree(lines).query(shapely.union_all(pts).envelope,predicate='intersects').tolist():
  hit=shapely.distance(lines[j],pts)<=streets[j]['width']/2+I.CORRIDOR+C;near[hit]=np.minimum(near[hit],current[hit])
 result=None
 for v,level in holes:
  k=np.searchsorted(vs,v);low=current[k]<level-.05
  if (low&(kept[k]|(cap[k]<level-.05)|(near[k]<level-.05))).any() or not low.any():continue
  result=heights.copy() if result is None else result;result[v[low]]=np.maximum(result[v[low]],int(round(level/scale)))
 return result


def crossing_windows(plan,others,lines,tree):
 """i93_north.crossing_windows for layer 8 geometry: (other road, distance along the plan, half window, point,
 plan station) for every centre line crossing. Boston's segments end at the node where two roads cross and tell
 the roads apart by its level, so a vertex shared with the other road is still a crossing; only the plan's own
 ends (its gores and landings) and another plan's ends are junctions."""
 out=[];ends=(plan.points[0],plan.points[-1])
 for j in sorted(tree.query(plan.line,predicate='intersects').tolist()):
  other=others[j]
  if other is plan:continue
  pts=other.points if hasattr(other,'points') else other['points'];seen=[]
  for hit in crossing_points(plan.line.intersection(lines[j])):
   p=[hit.x,hit.y]
   if any(math.dist(p,q)<.05 for q in ends) or any(math.dist(p,q)<3 for q in seen):continue
   if hasattr(other,'points') and any(math.dist(p,q)<.05 for q in (pts[0],pts[-1])):continue
   seen.append(p);d=plan.line.project(hit);k=int(np.argmin(np.abs(plan.along-d)));best=(math.inf,None)
   for a,b in zip(pts,pts[1:]):
    dist=LineString([a,b]).distance(hit)
    if dist<best[0]:L=math.dist(a,b) or 1;best=(dist,((b[0]-a[0])/L,(b[1]-a[1])/L))
   t=plan.tangents[k];ot=best[1];sine=max(.25,abs(t[0]*ot[1]-t[1]*ot[0]));cosine=abs(t[0]*ot[0]+t[1]*ot[1])
   if hasattr(other,'points'):half_other=other.width_at(other.line.project(hit))/2
   elif other.get('elevations'):half_other=max(other.get('deckWidths') or [other['width']])/2
   else:half_other=other['width']/2+I.CORRIDOR
   out.append((other,d,min(45,half_other/sine+plan.widths[k]/2*cosine/sine+2),p,k))
 return out


def span_floors(plan):
 """Keep a raised stretch (source level 1 or more) from sagging to the ground between two roads it bridges: the
 floors of consecutive crossings in one raised stretch are joined by a straight grade."""
 for a,b in runs([l>=1 for l in plan.level]):
  marks=[i for i in range(a,b+1) if plan.floor[i]>-math.inf]
  for i,j in zip(marks,marks[1:]):
   for k in range(i+1,j):
    f=(plan.along[k]-plan.along[i])/(plan.along[j]-plan.along[i]);plan.floor[k]=max(plan.floor[k],plan.floor[i]+(plan.floor[j]-plan.floor[i])*float(f))


def constrain_roads(plan,ground,existing,lines,tree,water,report):
 """Clearances at the existing roads a plan crosses and over mapped water, by source level: a road above
 (a deck with a higher source layer) bounds the plan from above, a road at or below its level from below.
 A plan below level 0 passes under every surface street (its cover keeps it there), and a plan at level 0
 crossing a surface street off a junction is reported."""
 def heights(other,i,h):
  line=LineString(other['points']);reach=max(other.get('deckWidths') or [other['width']])/2 if other.get('elevations') else other['width']/2+I.CORRIDOR
  (x,z),(tx,tz)=plan.points[i],plan.tangents[i];out=[h]
  for o in np.linspace(-plan.widths[i]/2,plan.widths[i]/2,5).tolist():
   q=(x-tz*o,z+tx*o)
   if line.distance(Point(q))<=reach:out.append(road_height(other,q,ground))
  return out
 for other,d,half,p,k in crossing_windows(plan,existing,lines,tree):
  h=road_height(other,p,ground);mine=plan.level[k];deck=bool(other.get('elevations'));theirs=other.get('bridge',{}).get('sourceLayer',1) if deck else 0
  # A deck that starts or ends on the ground at this vertex is a ramp leaving or joining the road here (the Bowker Overpass off Storrow Drive), not a bridge over it.
  if deck and any(math.dist(p,other['points'][i])<.05 and other.get(f)==0 for i,f in ((0,'startLevel'),(-1,'endLevel'))):report['junctions'].append({'road':plan.id,'name':other['name'],'other':other['id'],'point':[round(v,2) for v in p]});continue
  entry={'road':plan.id,'name':other['name'],'at':round(d,1),'point':[round(v,2) for v in p]}
  if not deck and mine<0:report['crossings'].append({**entry,'beneath':other['id'],'street':round(h,2)});continue
  if not deck and mine==0:
   # A street that starts or ends on the plan's own vertex joins the road there (Charlesgate off and onto Storrow Drive East).
   joins=any(math.dist(p,other['points'][i])<.05 for i in (0,-1)) and math.dist(p,plan.points[k])<.05
   if joins:plan.junctions.append((k,h));plan.joined.append(other)
   report['atGrade'].append({**entry,'other':other['id'],'street':round(h,2),**({'joins':True} if joins else {})});continue
  if deck and theirs==mine and mine>0:report['unresolved'].append({**entry,'other':other['id'],'layer':mine})
  if theirs>mine:
   thick=other.get('bridge',{}).get('thickness',THICKNESS)
   if mine>=0:
    # The survey keeps a part of many bridges as a bump across the road beneath: under the bridge the road follows the lowest ground nearby.
    base=min(plan.terrain[i] for i in plan.window(d,half+REMNANT))
    for i in plan.window(d,half+REMNANT/3):plan.terrain[i]=min(plan.terrain[i],base+.25*abs(float(plan.along[i])-d)/(half+REMNANT/3))
   for i in plan.window(d,half):bottom=min(heights(other,i,h))-thick;plan.ceiling[i]=min(plan.ceiling[i],bottom-plan.under);plan.drop[i]=min(plan.drop[i],bottom-plan.under)
   for i in plan.window(d,I.TRENCH_REACH):plan.trench[i]=True;plan.stiff[i]=max(plan.stiff[i],I.TRENCH_STIFFNESS)
   report['crossings'].append({**entry,'under':other['id'],'deck':round(h,2)})
  else:
   for i in plan.window(d,half):top=max(heights(other,i,h));plan.floor[i]=max(plan.floor[i],top+THICKNESS+I.CLEAR_OVER);plan.lift[i]=max(plan.lift[i],top+THICKNESS+I.CLEAR_OVER_TARGET)
   report['crossings'].append({**entry,'over':other['id'],'street':round(h,2)})
 polygons,level=water
 for poly in polygons:
  if not poly.intersects(plan.line):continue
  for i,p in enumerate(plan.points):
   if plan.level[i]>=0 and poly.covers(Point(p)):
    surface=level(*p);surface=ground(*p) if surface is None else surface
    plan.floor[i]=max(plan.floor[i],surface+THICKNESS+WATER_CLEAR);plan.water[i]=True
 span_floors(plan)


def bridge_copies(roads,plans):
 """A second source's copies of a bridge over the road. Saint Mary's Street is the line between Boston and Brookline, and
 both sources carry it: Boston's segments, whose bridge is a chain with lifted nodes that level_overpasses levels, and
 Brookline's OpenStreetMap ways on the same line between the same vertices, which build-metro.py profiles between the
 survey's ground at each way's own ends: a street running down the bank of the cut to the bridge's first node, a second
 deck from the cut's floor up, and a stub. The road beneath was solved CLEAR_UNDER under that second deck, 3 m below its
 own cut. A road that lies within TWIN of the line of a chain of elevated pieces crossing one of the stage's roads at
 source level 0 or below, all along its own length, and is no piece of that chain, is such a copy: it leaves the package
 (restore puts it back). Of two chains on one line the longer is the bridge, and a chain with a dedicated builder
 loses no piece. Returns (the road list without the copies, [{index, road, of}] with each copy's place in `roads`)."""
 plan_lines=[p.line for p in plans];plan_tree=STRtree(plan_lines);lines=[LineString(r['points']) for r in roads];tree=STRtree(lines);place={id(r):k for k,r in enumerate(roads)};copies={}
 def crosses(chain):
  for road in chain:
   line=lines[place[id(road)]]
   for j in plan_tree.query(line,predicate='intersects').tolist():
    plan=plans[j]
    for q in crossing_points(line.intersection(plan_lines[j])):
     at=plan.line.project(q);k=int(np.argmin(np.abs(plan.along-at)))
     if plan.level[k]<=0 and not plan.wet_at(k) and min(at,plan.line.length-at)>=MEETS:return True
  return False
 every=W.water_chains(roads);chains=[c for c in every if not any(W.owned(r) or stage_owned(r) for r in c)]
 built={place[id(r)] for c in every if any(W.owned(r) for r in c) for r in c}   # (a chain with a dedicated builder loses no piece)
 for chain in sorted(chains,key=lambda c:(-sum(lines[place[id(r)]].length for r in c),min(r['id'] for r in c))):
  if any(place[id(r)] in copies for r in chain) or not crosses(chain):continue
  own={place[id(r)] for r in chain};zone=shapely.ops.unary_union([lines[k] for k in own]).buffer(TWIN)
  for k in sorted(tree.query(zone,predicate='covers').tolist()):
   r=roads[k]
   if k in own or k in copies or k in built or r.get('tunnel') or stage_owned(r) or lines[k].length<=2*TWIN:continue   # (a piece no longer than the zone is wide may only cross it)
   copies[k]={'index':k,'road':copy.deepcopy(r),'of':sorted(roads[j]['id'] for j in own)}
 return [r for k,r in enumerate(roads) if k not in copies],[copies[k] for k in sorted(copies)]


def bridge_seams(roads,plans,ground):
 """Streets that are the missing ramp of a bridge over the road. Boston's segments end a bridge at the node where
 it crosses a road beneath and give each segment end its own level.
 - Tremont Street's southern piece starts at level 0 on the very node where the eastbound Turnpike passes under
   the bridge: the bridge then stops over the carriageway and the street steps down to the fill the grader laid
   in the cut. A surface street with one end on a lifted end of an elevated piece, at a vertex one of the stage's
   roads passes at source level 0 or below, becomes that bridge's ramp piece (lifted at the node, landing on the
   ground at its other end).
 - Columbus Avenue's southern landing stands on the slope of the cut, 8 m from the node over the westbound
   carriageway and 1.1 m under the street 30 m on, where the grader brought the street down to it: the bridge
   fell 2.7 m to the landing and the street climbed out again. A ramp piece's ground landing within SEAM_NEAR of
   the pavement of one of the stage's roads, whose street carries straight on and climbs BANK or more within
   SEAM_MAX, is no landing: the piece becomes deck and the street, up to where it has made CREST of that climb
   (or its next junction), the bridge's ramp (`<street id>-deck`, the street keeping the rest). Only a side street
   narrower than MINOR may lose its junction with such a landing (Cahners Place).
 - Carlton Street's bridge is three OpenStreetMap bridge ways, the span and the two legs it parts into at its southern
   end, and build-metro.py profiles each between the survey's ground at its own ends: their common node lies over the
   bank of the cut, 3 m under the legs' landings, and the deck fell to it from both sides. A node where only bridge
   pieces meet, none of them lifted there, within SEAM_NEAR of the pavement of one of the stage's roads and less than
   CUT over that road's ground, with a piece whose other end stands CUT over it, is a node of the bridge: every piece
   is lifted at it, as at the nodes Boston's segments mark.
 level_overpasses then levels each bridge with its new ramp. Returns (the road list with the ramps, the original
 records of the changed roads, notes, the ids of the pieces added)."""
 from road_connections import resample
 from north_overpasses import split_line
 lifted={}
 for r in roads:
  if r.get('elevations') and not r.get('tunnel') and not W.owned(r):
   for e in (0,-1):
    if W.lifted(r,e):lifted.setdefault(W.node_key(r['points'][e]),r['elevations'][e])
 def beneath(p):
  q=Point(p);return any(plan.line.distance(q)<.05 and plan.level[plan.nearest(p)]<=0 for plan in plans)
 def beside(p):
  q=Point(p)
  for plan in plans:
   d=plan.line.distance(q)
   if d<=max(plan.widths)/2+SEAM_NEAR:
    i=plan.nearest(p)
    if plan.level[i]<=0 and d<=plan.widths[i]/2+SEAM_NEAR:return True
  return False
 def ramp(r,points,e,id=None):
  # the street stretch `points` as a ramp piece lifted at its end e
  line=points;points=resample(line);points[0]=list(line[0]);points[-1]=list(line[-1]);id=id or r['id']
  return {**{f:copy.deepcopy(v) for f,v in r.items() if f!='pavedWidth'},'id':id,'points':points,'elevations':[round(ground(*q),4) for q in points],'startLevel':int(e==0),'endLevel':int(e==-1),
   'bridge':{'id':f"structure-{id}",'thickness':THICKNESS,'clearanceEstimated':True,'kind':'elevated'}}
 changed={};originals=[];notes=[];added=[];recorded=set()
 def original(r):
  # a road's record as the stage found it, kept once: a piece one rule lifts at a node may be changed again by the next
  if r['id'] not in recorded:recorded.add(r['id']);originals.append(copy.deepcopy(r))
 # nodes of a bridge over the cut that the source left on the ground
 def floor(p):
  # the ground of the stage's road beside the point, where it passes at source level 0 or below within SEAM_NEAR of its pavement
  q=Point(p);found=[]
  for plan in plans:
   d=plan.line.distance(q)
   if d<=max(plan.widths)/2+SEAM_NEAR:
    i=plan.nearest(p)
    if plan.level[i]<=0 and d<=plan.widths[i]/2+SEAM_NEAR:found.append(plan.terrain[i])
  return max(found) if found else None
 meeting=defaultdict(list);built={id(r) for chain in W.water_chains(roads) if any(W.owned(r) for r in chain) for r in chain}   # (pieces of a chain with a dedicated builder)
 for k,r in enumerate(roads):
  if not r.get('tunnel'):
   for e in (0,-1):meeting[W.node_key(r['points'][e])].append((k,e))
 for key in sorted(meeting):
  pieces=meeting[key]
  if len(pieces)<2 or any(not roads[k].get('elevations') or id(roads[k]) in built or stage_owned(roads[k]) or W.lifted(roads[k],e) for k,e in pieces):continue
  k,e=pieces[0];low=floor(roads[k]['points'][e])
  if low is None or roads[k]['elevations'][e]-low>=CUT or not any(roads[j]['elevations'][-1 if f==0 else 0]-low>=CUT for j,f in pieces):continue
  for j,f in pieces:
   if j not in changed:original(roads[j])
   changed[j]=[{**changed.get(j,[roads[j]])[0],('startLevel' if f==0 else 'endLevel'):1}]
 if changed:
  roads=[x for k,r in enumerate(roads) for x in changed.get(k,[r])];changed={}
  for r in roads:
   if r.get('elevations') and not r.get('tunnel') and not W.owned(r):
    for e in (0,-1):
     if W.lifted(r,e):lifted.setdefault(W.node_key(r['points'][e]),r['elevations'][e])
 for k,r in enumerate(roads):
  if r.get('elevations') or r.get('tunnel') or stage_owned(r):continue
  ends=[e for e in (0,-1) if W.node_key(r['points'][e]) in lifted and beneath(r['points'][e])]
  if not ends:continue
  line=r['points'];length=stations(line)[-1]
  if len(ends)==2 or length>SEAM_MAX:notes.append({'road':r['id'],'name':r['name'],'reason':'starts on a bridge node over the road at both ends' if len(ends)==2 else f'starts on a bridge node over the road and runs {length:.0f} m'});continue
  e=ends[0];piece=ramp(r,line,e);piece['elevations'][e]=lifted[W.node_key(line[e])];changed[k]=[piece];original(r)
 # landings on the slope of the cut
 ends=defaultdict(list)
 for k,r in enumerate(roads):
  if not r.get('tunnel'):
   for e in (0,-1):ends[W.node_key(r['points'][e])].append((k,e))
 for k,r in enumerate(roads):
  if not r.get('elevations') or r.get('tunnel') or W.owned(r) or stage_owned(r) or k in changed:continue
  for e in (0,-1):
   if W.lifted(r,e) or not W.lifted(r,-1 if e==0 else 0):continue
   L=r['points'][e]
   if not beside(L):continue
   a=r['points'][1 if e==0 else -2];n=math.dist(a,L) or 1;bearing=((L[0]-a[0])/n,(L[1]-a[1])/n);carry=[];blocked=False
   for j,f in ends[W.node_key(L)]:
    if j==k:continue
    q=roads[j]
    if q.get('elevations') or stage_owned(q) or j in changed:blocked=True;break
    pts=q['points'] if f==0 else q['points'][::-1];m=math.dist(pts[0],pts[1]) or 1;cosine=((pts[1][0]-L[0])*bearing[0]+(pts[1][1]-L[1])*bearing[1])/m
    if cosine>=.9:carry.append((j,f))
    elif q['width']>=MINOR or abs(cosine)>=.5:blocked=True;break
   if blocked or len(carry)!=1:continue
   j,f=carry[0];street=roads[j];pts=street['points'] if f==0 else street['points'][::-1];line=LineString(pts);total=line.length
   if total<6:continue
   # where the street has made CREST of its climb out of the cut (within SEAM_MAX), or meets its next junction
   along=np.arange(0,min(SEAM_MAX,total)+.01,3.0);profile=[ground(q.x,q.y) for q in (line.interpolate(float(d)) for d in along)];rise=max(profile)-profile[0]
   if rise<BANK:continue
   stop=float(next(d for d,h in zip(along,profile) if h-profile[0]>=CREST*rise))
   for p in pts[1:-1]:
    if W.node_key(p) in ends:stop=min(stop,line.project(Point(p)))
   if total-stop<3:stop=total
   top=line.interpolate(stop)
   if stop<6 or ground(top.x,top.y)-ground(*L)<BANK*CREST:continue
   if stop>=total:parts=[ramp(street,street['points'],0 if f==0 else -1)]
   else:
    head,tail=split_line(pts,stop);piece=ramp(street,head if f==0 else head[::-1],0 if f==0 else -1,f"{street['id']}-deck");rest={**copy.deepcopy(street),'points':tail if f==0 else tail[::-1]}
    parts=[piece,rest] if f==0 else [rest,piece];added.append(piece['id'])
   changed[j]=parts;changed[k]=[{**r,('startLevel' if e==0 else 'endLevel'):1}];original(street);original(r)
   break
 return [x for k,r in enumerate(roads) for x in changed.get(k,[r])],originals,notes,added


def level_overpasses(roads,plans,ground,solved=None,raised=()):
 """Level the street bridges over the road's cut. build-metro.py lifts every bridge node 6.4 m over the survey
 at that node, so a bridge over the Turnpike's cut climbs from each bank to a node over the cut's floor and
 drops again (Columbus Avenue rose 5.7 m in 37 m). As level-water-crossings.py does over water, every chain of
 elevated pieces joined through lifted nodes that crosses one of the stage's roads in its cut (a station at
 source level 0, or in a reviewed underpass, lying CUT under a landing of the chain) gets one deck surface:
 the inverse-distance blend of the heights of its banks (the at-grade landings standing CUT over the road)
 along the chain, where each lower bound raises a bank's effective height until the surface meets it (a deck
 piece's bound the nearest bank, a ramp piece's its own). A landing down in the cut is no bank and takes no
 part in the surface: its piece rises from it to the deck, pulled taut over the bank it climbs (the Blandford
 Street Steps beside the Turnpike: counted as a bank, they kept Beacon Street's westbound bridge on its lifted
 nodes, 4 m over the eastbound one and dipping 1.5 m at the node between two pieces). A route that starts or ends on the bridge's line
 (within MEETS: the Arlington Street entrance) joins the street there and is no road beneath. The bounds: the slab THICKNESS and CLEAR_UNDER over the
 road beneath, 0.3 m over the graded terrain under the deck pieces, BENEATH over any other road crossing
 beneath. Ramp pieces keep the ground landing the grader pinned and smoothstep to the deck, held over the
 terrain. Chains with a dedicated builder are left alone. The road's height under a bridge is first an estimate
 from its ground; `solved` ({plan id: (stations, heights)} of a first solve) corrects it where the road turned
 out lower (held down by the lids beside the bridge, as under Columbus Avenue, whose estimate lifted one landing
 3.5 m and left a ramp of 60%): a bridge is then no higher than the solved road needs. A ramp whose landing
 raise_hollows has raised to the bridge (`raised`, the landings' node keys) lies on level ground made for it and
 keeps only W.RAMP_RISE over that, so it comes down to its landing by centimetres, not by the 0.2 m the terrain
 margin would ask a cell from the landing. Returns (the road list with the levelled copies, the original records
 of the changed roads, a report)."""
 from land_approaches import taut
 roads=list(roads);others=[r for r in roads if not r.get('tunnel')];lines=[LineString(r['points']) for r in others];tree=STRtree(lines)
 plan_lines=[p.line for p in plans];plan_tree=STRtree(plan_lines);originals=[];report=[]
 def reference(plan,k):
  # The height the road will take under the bridge: its own ground at level 0, the ground where it next runs at grade in an underpass.
  # (the lowest within REMNANT metres: the survey keeps a part of many bridges as a bump across the road beneath)
  near=[plan.terrain[i] for i in plan.window(float(plan.along[k]),REMNANT if plan.level[k]==0 else 200) if plan.level[i]==0]
  estimate=(min(near) if near else plan.low[k])+I.TERRAIN_RISE
  return min(estimate,float(np.interp(float(plan.along[k]),*solved[plan.id]))+REFINE) if solved and plan.id in solved else estimate
 for chain in W.water_chains(roads):
  if any(W.owned(r) for r in chain):continue
  landings,distances=W.landing_distances(chain)
  if not landings:continue
  alongs={id(road):W.stations(road['points']) for road in chain};ids={r['id'] for r in chain}
  def point_distances(road,d):
   a,b=W.node_key(road['points'][0]),W.node_key(road['points'][-1]);total=alongs[id(road)][-1]
   return {start:min(dist.get(a,math.inf)+d,dist.get(b,math.inf)+total-d) for start,dist in distances.items()}
  def ends_of(road):return [W.lifted(road,0),W.lifted(road,-1)]
  def bound(road,d,required):
   # A lower bound d metres along a piece: on a deck piece at that point, on a ramp at its deck end, scaled by the ramp's share of the climb there.
   along=alongs[id(road)];ends=ends_of(road)
   if all(ends):return (point_distances(road,d),required,None)
   if not any(ends):return None
   landing,low,shares,taper=W.ramp(road);share=W.smooth(abs(d-along[landing])/(along[-1] or 1));top=point_distances(road,along[len(along)-1 if ends[1] else 0]);own=W.node_key(road['points'][landing])
   if share<W.LANDING_SHARE:return None
   # A need the ramp meets by rising from its landing at RAMP_START is met right there (local), and the deck end only has to
   # stand as high: the share of a smoothstep is next to nothing near the landing, where the road beneath often crosses
   # (Columbus Avenue's landing stands at the edge of the cut), and dividing by it lifted the whole bridge by metres.
   if required-low<=RAMP_START*abs(d-along[landing]):local[id(road)].append((d,required));return (top,required,own)
   return (top,low+(required-low)/share,own)
  crossings=[];local=defaultdict(list)
  for road in chain:
   line=LineString(road['points'])
   for j in plan_tree.query(line,predicate='intersects').tolist():
    plan=plans[j]
    for q in crossing_points(line.intersection(plan_lines[j])):
     at=plan.line.project(q);k=int(np.argmin(np.abs(plan.along-at)))
     if plan.level[k]>0 or plan.wet_at(k):continue
     crossings.append((road,line.project(q),reference(plan,k),min(at,plan.line.length-at)<MEETS))
  # A route that starts or ends on the bridge (the Arlington Street entrance leaves the street at the bridge's landing) joins it there: it is no road beneath.
  crossed=[ref for _,_,ref,joins in crossings if not joins]
  if not crossed:continue
  # The banks of the cut are the landings standing CUT over the road. A landing down in the cut (the Blandford Street Steps, which come up to the
  # Beacon Street bridge from beside the Turnpike) is none: the deck spans from bank to bank and that landing's piece rises to it.
  banks={key:h for key,h in landings.items() if h-max(crossed)>=CUT}
  if not banks:continue
  distances={key:distances[key] for key in banks}
  bounds=[b for b in (bound(road,d,ref+THICKNESS+CLEAR_UNDER) for road,d,ref,_ in crossings) if b]
  for road in chain:
   along=alongs[id(road)];points=road['points'];ends=ends_of(road);line=LineString(points)
   if all(ends):bounds.extend((point_distances(road,d),ground(*p)+W.TERRAIN_RISE,None) for d,p in zip(along,points))
   elif any(ends):
    landing,low,shares,taper=W.ramp(road);margin=W.RAMP_RISE if W.node_key(points[landing]) in raised else W.TERRAIN_RISE
    bounds.append((point_distances(road,along[len(points)-1 if ends[1] else 0]),max(ground(*p)+margin*t for i,(p,t) in enumerate(zip(points,taper)) if i!=landing),W.node_key(points[landing])))
   for j in tree.query(line,predicate='intersects').tolist():
    other=others[j]
    if other['id'] in ids:continue
    for q in crossing_points(line.intersection(lines[j])):
     p=[q.x,q.y]
     if any(math.dist(p,v)<.05 for v in points) and any(math.dist(p,v)<.05 for v in other['points']):continue
     below=road_height(other,p,ground)
     if below>=road_height(road,p,ground):continue
     b=bound(road,line.project(q),below+BENEATH)
     if b:bounds.append(b)
  lifts={key:0.0 for key in banks}
  def height(dist):
   weights=[(banks[start]+lifts[start],1/max(d,.01)) for start,d in dist.items()];total=sum(w for _,w in weights);return sum(h*w for h,w in weights)/total
  for _ in range(60):
   raise_by={}
   for dist,required,own in bounds:
    # A ramp's need (the ground under it, a road beneath it) raises its own landing's effective height: the nearest landing
    # may be the other bank's, a few metres beyond a short ramp (Columbus Avenue: the long northern ramp's ground lifted the
    # southern landing 3.5 m, 8 m from its node).
    deficit=required-height(dist)
    if deficit>.0001:key=own if own in lifts else min(dist,key=dist.get);raise_by[key]=max(raise_by.get(key,0),deficit)
   if not raise_by:break
   for key,d in raise_by.items():lifts[key]+=d
  changed=[];heights=[]
  for road in chain:
   along=alongs[id(road)];old=road['elevations'];ends=ends_of(road)
   if all(ends):new=[height(point_distances(road,d)) for d in along];heights.extend(new)
   elif any(ends):
    landing,low,shares,taper=W.ramp(road);top=height(point_distances(road,along[len(along)-1 if ends[1] else 0]));heights.append(top)
    new=[low+(top-low)*s if i==landing else max(low+(top-low)*s,ground(*p)+W.RAMP_RISE*t) for i,(p,s,t) in enumerate(zip(road['points'],shares,taper))]
    for d,required in local[id(road)]:new=[v if i==landing else max(v,min(top,required)-RAMP_START*abs(float(along[i])-d)) for i,v in enumerate(new)]
    if top>=max(new):
     for i in (range(1,len(new)) if landing==0 else range(len(new)-2,-1,-1)):new[i]=max(new[i],new[i-1 if landing==0 else i+1])
    # A piece that comes up out of the cut climbs its bank, whose every step the terrain floor would copy into it (the Blandford Street Steps
    # reached 22%): it is pulled taut over the bank instead, as level-land-approaches.py pulls a sunk approach.
    if W.node_key(road['points'][landing]) not in banks:new=taut(along,new)
   else:continue
   new=[round(v,4) for v in new]
   if any(abs(a-b)>.0001 for a,b in zip(old,new)):
    k=next(i for i,r in enumerate(roads) if r is road);originals.append(copy.deepcopy(road));roads[k]={**road,'elevations':new};changed.append(road['id'])
  if changed:report.append({'names':sorted({r['name'] for r in chain}),'roads':sorted(ids),'deck':[round(min(heights),3),round(max(heights),3)],'landings':sorted(round(v,3) for v in banks.values()),'lifts':sorted(round(v,3) for v in lifts.values()),'changed':sorted(changed),
   **({'inCut':sorted(round(v,3) for key,v in landings.items() if key not in banks)} if len(banks)<len(landings) else {})})
 return roads,originals,report


def raise_hollows(roads,levelled,report,plans,grid,heights):
 """The ground at a levelled bridge's landing where it lies in a hollow. OpenStreetMap ends Carlton Street's bridge on
 the slope the survey shows under it, 0.8 and 1.1 m up a bank that tops out at 4.9 m, and the grader brought the
 junction of Carlton and Mountfort Streets down to those two landings: the level deck then fell 0.9 m to one of them
 and 0.6 m to the other, 11 m apart, and its two legs, each drawn at its full width, overlapped with a ledge of half a
 metre between their slabs. Cambridge Street lands the same way west of the Allston ramps, 2.7 and 1.6 m under its
 deck, with the street back at the deck's height 20 m on. A ramp piece of a levelled bridge whose deck end stands
 HOLLOW over its landing, where every street leaving that landing is back at the deck's height within SEAM_MAX along
 it, lands in such a hollow (a bridge standing over its streets has ramps that come down to them: those streets do
 not climb back). The ground is raised to the deck's height there: every vertex of the cells that the corridors
 of those street stretches pass over, as far along each as its ground lay lower, and each landing in it takes the
 new ground (level_overpasses then lets such a ramp lie on it, so sibling ramps are one surface). The bank of the cut the bridge crosses stays as
 it is: a vertex HOLLOW under the street's ground at the station beside it is none of the street's, nor is one on
 the bridge's side of the landing and beyond the corridor's reach from it (in a cell the corridor only touches),
 unless it is a corner of the cell the landing stands in. The stage's own roads keep their ground too.
 Returns (the grid with the hollows raised, `roads` with those landings for level_overpasses to level once more,
 the records of the changed roads as they were, [{road, name, landing, from, to, streets, vertices, maxFillMeters}])."""
 from north_overpasses import Window,box,covered,half_width
 scale=grid.get('scale',.01);cell=grid['cellSize'];width=grid['width'];ground=I.Terrain(grid,heights);filled=heights.copy()
 ids={i for o in report for i in o['roads']};streets=[r for r in levelled if not r.get('elevations') and not r.get('tunnel') and not stage_owned(r)];at=defaultdict(list)
 for r in streets:
  for i,q in enumerate(r['points']):at[W.node_key(q)].append((r,i))
 def sample(x,z):
  # (the triangle rule of water_crossings.grid_sampler, on the grid being filled)
  fx=(x-grid['originX'])/cell;fz=(z-grid['originZ'])/cell;i=int(fx);j=int(fz);tx=fx-i;tz=fz-j;a,b,c,d=[float(filled[k])*scale for k in (j*width+i,j*width+i+1,(j+1)*width+i,(j+1)*width+i+1)]
  return a+(b-a)*tx+(c-a)*tz if tx+tz<=1 else d+(c-d)*(1-tx)+(b-d)*(1-tz)
 def basin(L,level):
  # the street stretches from the landing along which the ground lies under `level`; None when one is still under it SEAM_MAX on
  found=[];walked=set();queue=[(W.node_key(L),0.0)]
  while queue:
   key,done=queue.pop(0)
   for r,i in at.get(key,[]):
    for step in (1,-1):
     j=i+step;line=[list(r['points'][i])];d=done;back=False
     while 0<=j<len(r['points']) and not back and (id(r),min(j-step,j)) not in walked:
      walked.add((id(r),min(j-step,j)));a,b=r['points'][j-step],r['points'][j];length=math.dist(a,b);n=max(1,math.ceil(length))
      for k in range(1,n+1):
       q=[a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n];d+=length/n
       if ground(*q)>=level:line.append(q);back=True;break
       if d>SEAM_MAX:return None
      else:line.append(list(b));queue.append((W.node_key(b),d));j+=step
     if len(line)>1:found.append({'id':r['id'],'points':line,'width':r['width']})
  return found
 notes=[]
 for chain in W.water_chains(levelled):
  if any(W.owned(r) for r in chain) or not any(r['id'] in ids for r in chain):continue
  for r in chain:
   ends=[W.lifted(r,0),W.lifted(r,-1)]
   if all(ends) or not any(ends):continue
   landing,low,_,_=W.ramp(r);top=r['elevations'][-1 if landing==0 else 0];level=top;L=r['points'][landing]
   if top-low<HOLLOW:continue
   stretches=basin(L,level)
   if not stretches:continue
   win=Window(grid,box([q for s in stretches for q in s['points']],max(half_width(s) for s in stretches)+2*cell));index=win.index[covered(grid,win,stretches)]
   pts=shapely.points(grid['originX']+(index%width)*cell,grid['originZ']+(index//width)*cell);keep=np.ones(len(index),dtype=bool)
   for plan in plans:keep&=shapely.distance(plan.line,pts)>np.interp(shapely.line_locate_point(plan.line,pts),plan.along,plan.widths)/2+I.SHELF+cell
   # (the street's own ground: not the bank beside its last cells, HOLLOW under the street at the station beside the vertex)
   # (the street's own ground: not the bank HOLLOW under the street at the station beside the vertex, nor what lies behind the landing but for its own cell)
   lines=[LineString(s['points']) for s in stretches];reach=[half_width(s) for s in stretches];beside=[min(range(len(lines)),key=lambda k:lines[k].distance(q)) for q in pts.tolist()]
   i=int((L[0]-grid['originX'])//cell);j=int((L[1]-grid['originZ'])//cell);own={(j+b)*width+i+a for a in (0,1) for b in (0,1)}
   def behind(q,k):
    # on the bridge's side of the landing's cross-section (of a stretch that starts on the landing) and beyond the corridor's reach from the landing: there only for its cell
    a=lines[k].coords[0];b=next((c for c in lines[k].coords[1:] if math.dist(a,c)>.01),a);n=math.dist(a,b)
    return math.dist(a,L)<.05 and n>0 and ((q.x-a[0])*(b[0]-a[0])+(q.y-a[1])*(b[1]-a[1]))/n<-.5 and math.dist((q.x,q.y),L)>reach[k]
   keep&=np.asarray([v in own or (float(heights[v])*scale>=ground(*lines[k].interpolate(lines[k].project(q)).coords[0])-HOLLOW and not behind(q,k)) for v,q,k in zip(index.tolist(),pts.tolist(),beside)],dtype=bool)
   index=index[keep];target=int(round(level/scale));index=index[filled[index]<target];rise=(target-filled[index].astype(np.int64))*scale;filled[index]=target
   notes.append({'road':r['id'],'name':r['name'],'landing':[round(L[0],3),round(L[1],3)],'from':round(low,3),'to':round(level,3),'streets':sorted({s['id'] for s in stretches}),'vertices':int(len(index)),'maxFillMeters':round(float(rise.max()),3) if len(index) else 0})
 if not notes:return heights,roads,[],[]
 # Every landing the raised ground now stands over takes it: a piece of a bridge this stage levels is levelled again, any other must not be there.
 out=list(roads);before=[]
 for k,r in enumerate(levelled):
  if not r.get('elevations') or r.get('tunnel') or stage_owned(r):continue
  for e in (0,-1):
   if W.lifted(r,e):continue
   L=r['points'][e];new=round(sample(*L),4)
   if new-ground(*L)<.0005:continue
   assert r['id'] in ids and not W.owned(r),f"the ground raised at a bridge's landing lifts the landing of {r['id']}, which this stage does not level"
   if out[k] is roads[k]:before.append(copy.deepcopy(roads[k]));out[k]={**roads[k],'elevations':list(roads[k]['elevations'])}
   out[k]['elevations'][e]=new
 for note in notes:note['to']=round(sample(*note['landing']),3)
 return filled,out,before,notes


def classify(p,plan,plans,fixed,streets):
 """How a ramp end meets the network: a street vertex, a carriageway vertex (gore), a ramp vertex (node) or a vertex of an existing tunnel road (fixed)."""
 k=key(p)
 for other in plans:
  if other is plan or not other.main:continue
  for i,q in enumerate(other.points):
   if key(q)==k:return ('gore',other,i)
 # A ramp end on an existing road's vertex lands there, even where another ramp starts or ends on the same vertex
 # (the two ramps of Storrow Drive's loop by University Road).
 if k in streets and all(key(other.points[i])!=k for other in plans if other is not plan and not other.main for i in range(1,len(other.points)-1)):return ('street',streets[k])
 for other in plans:
  if other is plan or other.main:continue
  for i,q in enumerate(other.points):
   if key(q)==k:return ('node',other,i)
 for other in fixed:
  for i,q in enumerate(other.points):
   if key(q)==k:return ('fixed',other,i)
 if k in streets:return ('street',streets[k])
 return None


def separation(lower_tunnel,lower):
 """Height of an upper road's surface over a lower one's: its roof and cover underground, else the slab and the room under it (Storrow Drive's low one under its own ramps)."""
 return (lower.clearance+ROOF+.35) if lower_tunnel else THICKNESS+(STORROW_UNDER if getattr(lower,'under',None)==STORROW_UNDER else I.CLEAR_OVER)


def twin_pairs(plans):
 """The pairs of carriageways of one road, in route order: the main plans that share a `bridge`."""
 mains=[p for p in plans if p.main];return [(a,b) for k,a in enumerate(mains) for b in mains[k+1:] if a.spec['bridge']==b.spec['bridge']]


def in_the_open(plan):
 """The stations of a solved, classified plan that run in the open at or above source level 0: under no roof and no
 candidate for one (cover). Its twin beside it comes up to it there."""
 return [plan.level[i]>=0 and not plan.candidate[i] and not plan.covered[i] for i in range(len(plan.points))]


def may_rise(plan):
 """Of those, the stations a twin may lift: off the street the road lands on, none where a street joins it at its
 height (the street's end is the ground's, which does not follow), and none with a building over its pavement there
 or at the station beside it (what that building needs, buildings_over, is measured against the road as it lies)."""
 n=len(plan.points);joins={k for k,_ in plan.junctions}
 return [o and plan.allowance[i]>.999 and not plan.street[i] and i not in joins and not any(plan.built[j] for j in (i-1,i,i+1) if 0<=j<n) for i,o in enumerate(in_the_open(plan))]


alongside,lower_envelope,eased,twin_lift=I.alongside,I.lower_envelope,I.eased,I.twin_lift   # where the two run alongside each other, and how far the lower rises: shared with Interstate 93


def cut_ground(city,plans,grid,lidded,paved,paved_lines,paved_tree,under,joined,footprints):
 """The deck cut under the plans as they lie (i93_north.cut_plan, a street's corridor kept out of it: street_pavements):
 (the cut grid, the streets carried over its edge on deck pieces, the notes on those not carried, the road list with
 those pieces, the deck runs as they lie)."""
 # (each deck at the height it has on its own ground, HR.alone: a carriageway its twin has lifted takes its ground up with it afterwards, highway_roadways.fills)
 runs_=deck_runs(plans,True);cut=I.cut_plan(runs_,grid,lidded);cut=(cut[0],cut[1]-street_pavements(cut,runs_,paved,paved_lines,paved_tree,grid,joined))
 replaced,notes=I.carry_overpasses(city['roads'],under,grid,I.Terrain(grid,lidded),cut[1]) if cut[0] else ({},[])
 for parts in replaced.values():
  for piece in parts:
   if piece.get('bridge',{}).get('kind')==I.APPROACH:piece['bridge']={**piece['bridge'],'id':f"highway-{piece['id']}",'kind':APPROACH}
 roads=[x for r in city['roads'] for x in replaced.get(r['id'],[r])]
 result,_,_=I.cut_terrain(runs_,grid,lidded,roads,footprints,cut)
 return result,replaced,notes,roads,deck_runs(plans)


def stand(city,plans,grid,lidded,paved,paved_lines,paved_tree,under,joined,footprints):
 """Cut the ground under the decks until none has ground standing in its pavement: a deck station the ground still
 stands in becomes a walled cut (plan.forced), and the grid is cut again for the decks that remain. Like the
 classification it feeds, this is judged on each road as it rides its own ground (HR.alone), so a lift moves no record
 boundary. Returns what cut_ground returns for the last cut."""
 by_id={p.id:p for p in plans}
 for _ in range(12):
  out=cut_ground(city,plans,grid,lidded,paved,paved_lines,paved_tree,under,joined,footprints);standing=standing_ground(plans,I.Terrain(grid,out[0]),True)
  if not standing:return out
  for k,rows in standing.items():
   for i in rows:by_id[k].forced[i]=True
   classify_ground(by_id[k])
 raise AssertionError(f'decks with ground standing in their pavement: {sorted(standing)}')


def build(city,source,graded,ungraded,water,buildings,tunnels=(),routes=None,twins=True):
 """Solved plans and a report. `graded` is the int16 graded grid with any earlier cut of this stage
 restored, `ungraded` the survey grid, `water` (polygons, level(x,z)), `buildings(bounds)` the buildings of the package tiles
 (tile_buildings), `tunnels` the Central Artery tunnel roads. With `twins` the two carriageways of a road are brought to
 one height where they run alongside each other (see the module text); without, each keeps the profile of its own ground."""
 ground=I.Terrain(city['elevation'],graded);raw=I.Terrain(city['elevation'],ungraded);existing=[r for r in city['roads'] if not stage_owned(r) and not r.get('tunnel')]
 lines=[LineString(r['points']) for r in existing];tree=STRtree(lines);streets={}
 for r in existing:
  for i,p in enumerate(r['points']):streets.setdefault(key(p),[]).append((r,i))
 surface=[r for r in existing if not r.get('elevations')];surface_lines=[LineString(r['points']) for r in surface];surface_tree=STRtree(surface_lines)
 fixed=[Fixed(r) for r in tunnels]
 report={'crossings':[],'atGrade':[],'unresolved':[],'grades':{},'infeasible':[],'newCrossings':[],'movedBeside':{},'narrowed':{},'junctions':[]}
 plans=plans_of(source,city,ROUTES if routes is None else routes);mains=[p for p in plans if p.main];ramps=[p for p in plans if not p.main]
 for plan in plans:plan.ends=[None,None];plan.on_deck=[False,False];plan.junctions=[];plan.joined=[]
 for plan in ramps:
  for e in (0,1):
   if e==0 and plan.spec.get('cap')=='start':plan.ends[e]=('cap',None,0);continue   # a closed bore end: nothing to meet, no height to take
   p=plan.points[0 if e==0 else -1];kind=classify(p,plan,plans,fixed,streets)
   assert kind,f'{plan.id} {"starts" if e==0 else "ends"} off the network at {p}'
   plan.ends[e]=kind
 moved={};joints=frozenset(key(q.points[i]) for q in plans for i in (0,-1))
 for plan in ramps:
  for e,kind in enumerate(plan.ends):
   if kind[0] in ('gore','fixed'):
    count=keep_beside(plan,e,kind[1],joints)
    if count:moved[plan.id]=moved.get(plan.id,0)+count
 report['movedBeside']=moved
 for plan in plans:
  plan.ground=ground;plan.cut_width=list(plan.widths)
  if street_cap(plan,surface,surface_lines,surface_tree):report['narrowed'][plan.id]=round(float(np.min(np.asarray(plan.widths)-np.asarray(plan.cut_width))),2)
  measure_ground(plan,ground,raw)
 for plan in ramps:
  for e,kind in enumerate(plan.ends):
   if kind[0]=='street':
    plan.landing[e]=True
    for i,s in enumerate(plan.along):
     dist=s if e==0 else plan.along[-1]-s
     if dist<I.LANDING_TAPER:plan.allowance[i]=min(plan.allowance[i],dist/I.LANDING_TAPER)
 for plan in mains:
  # A carriageway that starts or ends on a street vertex lands there like a ramp.
  for e in (0,1):
   k=key(plan.points[0 if e==0 else -1])
   if k in streets and not plan.spec.get('closed')==('start' if e==0 else 'end'):
    plan.ends[e]=('street',streets[k]);plan.landing[e]=True
    for i,s in enumerate(plan.along):
     dist=s if e==0 else plan.along[-1]-s
     if dist<I.LANDING_TAPER:plan.allowance[i]=min(plan.allowance[i],dist/I.LANDING_TAPER)
 for plan in plans:
  overhead(plan,surface,surface_lines,surface_tree,buildings,water)
  if building_cap(plan):measure_ground(plan,ground,raw);overhead(plan,surface,surface_lines,surface_tree,buildings,water);report['narrowed'][plan.id]=round(float(np.min(np.asarray(plan.widths)-np.asarray(plan.cut_width))),2)
  constrain_roads(plan,ground,existing,lines,tree,water,report)
 trunks=I.node_trunks(ramps)
 # Crossings between new roads, and of new roads with the existing tunnel roads: the higher source level goes over.
 everything=[*plans,*fixed];nlines=[p.line for p in everything];ntree=STRtree(nlines);pairs=[];unders=[]
 def merging(a,b,p):
  # `a` joins `b` (or both end at one point) within MERGE metres of the crossing at p.
  d=a.line.project(Point(p))
  for e,kind in enumerate(a.ends):
   end=a.points[0 if e==0 else -1];near=(d if e==0 else a.along[-1]-d)<MERGE
   if near and kind and kind[0]!='street' and kind[1] is b:return True
   if near and isinstance(b,I.Plan) and any(key(end)==key(b.points[i]) for i in (0,-1)):return True
  return False
 for plan in plans:
  for other,d,half,p,k in crossing_windows(plan,everything,nlines,ntree):
   new=isinstance(other,I.Plan)
   if merging(plan,other,p) or (new and merging(other,plan,p)):continue
   ko=other.nearest(p);la=plan.level[k]
   # An existing tunnel road has no source level here: one within 6 m of the ground is a ramp near its portal, which a road below level 0 passes under; a deeper bore lies under everything new.
   lb=other.level[ko] if new else (-.5 if plan.low[k]-other.y[ko]<6 else -9)
   if (plan.id,other.id) in OVER:la,lb=1,0
   elif (other.id,plan.id) in OVER:la,lb=0,1
   elif la==lb and la==0:continue   # two roads at grade: a crossing on the level
   elif la==lb and plan.main!=other.main:la,lb=(1,0) if plan.main else (0,1)
   if la==lb:report['unresolved'].append({'road':plan.id,'other':other.id,'point':[round(v,2) for v in p],'layer':la});continue
   if la>lb:
    pairs.append((plan,other,d,half,p,ko))
    if new:report['newCrossings'].append({'over':plan.id,'under':other.id,'point':[round(v,2) for v in p]})
   else:unders.append((plan,other,d,half,p,ko))
 def across(plan,i,other,at,reach):
  # The other road's heights where it lies under (or over) station i's cross-section, within `reach` of the crossing along it
  # (a ramp that crosses a carriageway and later runs beside it to merge is not over it there).
  (x,z),(tx,tz)=plan.points[i],plan.tangents[i];out=[]
  for o in np.linspace(-plan.widths[i]/2,plan.widths[i]/2,5).tolist():
   q=Point(x-tz*o,z+tx*o);e=other.line.project(q)
   if abs(e-at)<=reach and other.line.distance(q)<=other.width_at(e)/2:out.append(other.at(e))
  return out
 def buried(plan,k):return plan.level[k]<0 if isinstance(plan,I.Plan) else True
 def add_pairs(plan):
  # Crossings between new roads, from the other road's latest heights: the upper road clears the lower one's
  # top (and roof, underground) across its cross-section and the lower one stays under the upper road.
  for upper,lower,d,half,p,ko in pairs:
   if upper is not plan:continue
   gap=separation(buried(lower,ko),lower);at=float(lower.along[ko])
   for i in upper.window(d,half):
    top=max([lower.y[ko],*across(upper,i,lower,at,half+10)]) if lower.y else lower.terrain[ko]+I.TERRAIN_RISE
    upper.floor[i]=max(upper.floor[i],top+gap);upper.lift[i]=max(upper.lift[i],top+gap+.5)
  for lower,upper,d,half,p,ko in unders:
   if lower is not plan or upper.y is None:continue
   k=lower.nearest(p);gap=separation(buried(lower,k),lower);at=float(upper.along[ko])
   for i in lower.window(d,half):
    bottom=min([upper.y[ko],*across(lower,i,upper,at,half+10)])
    lower.ceiling[i]=min(lower.ceiling[i],bottom-gap);lower.drop[i]=min(lower.drop[i],bottom-gap-.5)
   for i in lower.window(d,PORTAL_REACH):lower.trench[i]=True
 def end_height(plan,e):
  kind=plan.ends[e]
  if kind is not None and kind[0]=='street':return plan.fixed.get(0 if e==0 else len(plan.points)-1)   # at grade on its street
  if kind is None or kind[0]=='cap':return None
  return kind[1].y[kind[2]] if kind[1].y is not None else None
 def prepare(plan):
  # Bounds from the existing roads, then the cover (it needs the heights of the roads the plan leaves and joins underground), then the new crossings.
  plan.floor,plan.lift,plan.ceiling,plan.drop=(list(v) for v in plan.base);plan.hold=[None]*len(plan.points)
  cover(plan,(end_height(plan,0),end_height(plan,1)));add_pairs(plan)
 for plan in plans:plan.base=(list(plan.floor),list(plan.lift),list(plan.ceiling),list(plan.drop))
 def land(plan):
  for e,kind in enumerate(plan.ends):
   if kind and kind[0]=='street':
    # Boston's segments share a vertex where a bridge crosses the street beneath it (Storrow Drive starts on Soldiers
    # Field Road under the Boston University Bridge): a road raised there lands on the deck, any other on the ground.
    i=0 if e==0 else len(plan.points)-1;heights=[road_height(r,r['points'][j],ground) for r,j in kind[1]];k=int(np.argmax(heights) if plan.level[i]>=1 else np.argmin(heights))
    # (a bridge record's own end on the ground is a street like any other: Cambridge Street's approach at the Turnpike's Allston ramps)
    # (and so is a deck that runs on the ground where the ramp meets it, as the Harvard Bridge's approach does at Storrow Drive)
    r,j=kind[1][k];plan.fixed[i]=round(heights[k],4)
    plan.on_deck[e]=bool(r.get('elevations')) and not ((j==0 and r.get('startLevel')==0) or (j==len(r['points'])-1 and r.get('endLevel')==0)) and heights[k]-ground(*r['points'][j])>.5
    if 'landing' in plan.spec and not plan.on_deck[e]:street_stretch(plan,e)
 leads=defaultdict(list)
 def bind_ramp(plan):
  # What a ramp is solved between: its ends, the stations held to the roads it leaves, joins or follows, and its bounds.
  plan.fixed={};land(plan)
  for e,kind in enumerate(plan.ends):
   i=0 if e==0 else len(plan.points)-1
   if kind[0] in ('street','cap') or (plan,e) in trunks:continue
   if kind[1].y is not None:
    plan.fixed[i]=round(kind[1].y[kind[2]],4)
    # A ramp ending where its trunk starts shares that one point with it: its last stations lie before the trunk begins, and
    # holding them to the trunk's first height left the ramps onto Storrow Drive West no room to come down from their crossing.
    if kind[0]=='node' and e==1 and kind[2]==0:continue
    # Where it is held to the road it joins, the ramp's own ground is a target, not a floor: the survey's ramp
    # stands a little over the carriageway until the gore, and a floor over the matched heights has no profile.
    for k,_ in I.overlap(plan,e,kind[1]):
     for j in plan.window(float(plan.along[k]),MERGE):plan.trench[j]=True
    I.match_overlap(plan,e,kind[1])
  for o,f in leads[plan.id]:I.match_overlap(plan,f,o)
  prepare(plan);plan.floors=list(plan.floor)
  # A trunk is solved free where its branches meet it, and stays as high there as they must be on their way to it
  # (the ramps onto Storrow Drive West cross over it just before they join at Charlesgate).
  for e in (0,1):
   if (plan,e) not in trunks:continue
   i=0 if e==0 else len(plan.points)-1
   for other in ramps:
    for f,kind in enumerate(other.ends):
     j=0 if f==0 else len(other.points)-1
     if other is plan or not kind or kind[0]!='node' or kind[1] is not plan or key(other.points[j])!=key(plan.points[i]) or not hasattr(other,'floors'):continue
     need=max(v-other.grade*.9*abs(float(other.along[q]-other.along[j])) for q,v in enumerate(other.floors))
     if need>-math.inf:plan.floor[i]=max(plan.floor[i],need)
 def settle_ramp(plan):
  I.solve(plan,report)
  # Held to the road it follows at the stations beside its end as well, or squeezed between its bounds further on, the spline
  # can leave the end itself centimetres off the road it meets: the end is exact, and its first segment takes up the difference.
  for i in (0,len(plan.points)-1):
   if i in plan.fixed and abs(plan.y[i]-plan.fixed[i])<SNAP:plan.y[i]=plan.fixed[i]
 def solve_ramp(plan):bind_ramp(plan);settle_ramp(plan)
 for sweep in range(3):
  report['infeasible']=[]
  for plan in mains:plan.fixed={};land(plan);prepare(plan);I.solve(plan,report)
  for plan in I.ordered(ramps,leads,trunks):solve_ramp(plan)
  if sweep==0:
   for a,b in ((a,b) for k,a in enumerate(ramps) for b in ramps[k+1:]):
    for e in (0,1):
     i=0 if e==0 else -1;shared=I.overlap(a,e,b) if key(a.points[i])==key(b.points[i]) else []
     if shared:lower,upper=(a,b) if sum(y-a.y[j] for j,y in shared)>0 else (b,a);leads[lower.id].append((upper,e))
 # A ramp solved before the road it joins or follows was last solved in the sweep starts a centimetre off it: solve those once more.
 def stale(plan):
  for e,kind in enumerate(plan.ends):
   # (an end on a carriageway or a tunnel road that it misses is squeezed, not late: those were solved before every ramp)
   if kind[0]=='node' and (plan,e) not in trunks and kind[1].y is not None and abs(plan.y[0 if e==0 else -1]-kind[1].y[kind[2]])>5e-4:return True
  return any(abs(plan.y[k]-y)>5e-4 for o,f in leads[plan.id] for k,y in I.overlap(plan,f,o))
 for _ in range(4):
  late=[plan for plan in I.ordered(ramps,leads,trunks) if stale(plan)]
  if not late:break
  for plan in late:report['infeasible']=[x for x in report['infeasible'] if x['road']!=plan.id];solve_ramp(plan)
 # Close the survey's cut over the tunnels, then read the ground again: the lids decide what is covered.
 def finish():
  lidded=lids(plans,surface,surface_lines,city['elevation'],graded,buildings)
  def read(heights):
   over=I.Terrain(city['elevation'],heights)
   for plan in plans:
    x=cross_sections(plan,.5);g=np.array([[over(float(a),float(b)) for a,b in row] for row in x]);plan.edge=g.max(1).tolist();plan.high=g[:,1:6].max(1).tolist();plan.low=g.min(1).tolist();plan.mid=np.median(g[:,1:6],axis=1).tolist()
    plan.forced=[False]*len(plan.points);classify_ground(plan)
  read(lidded)
  # and the holes the lids leave between them over a tunnel
  closed=close_gaps(plans,surface,surface_lines,city['elevation'],lidded,buildings)
  if closed is not None:lidded=closed;read(lidded)
  return lidded
 lidded=finish();report['twins']={'pairs':[],'ramps':[]};pairs_=twin_pairs(plans) if twins else []
 if not pairs_:return plans,fixed,report,lidded
 # The two carriageways of a road, each solved on its own ground, come out a step apart where that ground differs across the
 # median (a street's graded corridor reaching under one, a crossfall, two bridge approaches a few stations apart), and the 6 m
 # grid cannot hold two levels a lane apart. They are brought to one height where they run alongside each other in the open.
 # Every plan first keeps the heights it has alone (plan.solo): the classification, the cut and the ground a road stands in
 # are read from those from here on (classify_ground, cut_ground, stand), so lifting a road moves no record boundary.
 for plan in plans:plan.solo=list(plan.y)
 def couple(a,b):
  # The lower follows the higher: `a`, the first in route order, rises to its twin's profile wherever that stands higher,
  # and `b` then to what `a` has become, so the two are one where both may move and each keeps its own height elsewhere.
  ua,ub=list(a.y),list(b.y);sa,na=alongside(a,b,may_rise(a),in_the_open(b));sb,nb=alongside(b,a,may_rise(b),in_the_open(a))
  for plan in (a,b):plan.fixed={};land(plan);prepare(plan)   # (its bounds as it was last solved with: the ceilings)
  a.y=[round(y+v,4) for y,v in zip(ua,twin_lift(a,ua,sa,na,b.at))];b.y=[round(y+v,4) for y,v in zip(ub,twin_lift(b,ub,sb,nb,a.at))]
  def tally(plan,u):
   lift=np.asarray(plan.y)-np.asarray(u);rows=np.flatnonzero(lift>.02).tolist();return {'meters':round(float(sum(plan.along[min(len(u)-1,i+1)]-plan.along[i] for i in rows)),1),'max':round(float(lift.max()),3)}
  def apart(plan,other,beside,near):
   # what stays under its twin although only a median lies between them: a fade before a station that keeps its height, the room under a bridge
   under=[other.at(s)-plan.y[i] if s is not None and near[i] else 0. for i,s in enumerate(beside)];return [[i,j,round(max(under[i:j+1]),3)] for i,j in runs([v>TWIN_STEP for v in under])]
  return {'roads':[a.id,b.id],'alongsideMeters':round(float(sum(a.along[min(len(ua)-1,i+1)]-a.along[i] for i,v in enumerate(na) if v)),1),'lifted':{a.id:tally(a,ua),b.id:tally(b,ub)},'apart':{a.id:apart(a,b,sa,na),b.id:apart(b,a,sb,nb)}}
 # A ramp is solved again when what it is solved between has changed: the carriageway it leaves or joins, a road it follows or crosses.
 def reads(plan):bind_ramp(plan);return (tuple(sorted(plan.fixed.items())),*(tuple(v) for v in (plan.floor,plan.lift,plan.ceiling,plan.drop,plan.hold,plan.trench,plan.stiff)))
 for plan in I.ordered(ramps,leads,trunks):bind_ramp(plan)   # (a trunk reads the floors its branches were last bound with)
 known={plan.id:reads(plan) for plan in I.ordered(ramps,leads,trunks)}
 report['twins']['pairs']=[couple(a,b) for a,b in pairs_];again=set()
 if all(max(v['max'] for v in pair['lifted'].values())<=LIFTED for pair in report['twins']['pairs']):return plans,fixed,report,lidded
 for _ in range(8):
  late=False
  for plan in I.ordered(ramps,leads,trunks):
   now=reads(plan)
   if now!=known[plan.id]:
    known[plan.id]=now;report['infeasible']=[x for x in report['infeasible'] if x['road']!=plan.id];settle_ramp(plan);again.add(plan.id);late=True
    # (a ramp only ever rises with its carriageway: a station the spline lets sag beside the lift stays where it was)
    plan.y=[max(y,u) for y,u in zip(plan.y,plan.solo)]
  if not late:break
 else:raise AssertionError('the ramps of the lifted carriageways did not settle')
 report['twins']['ramps']=sorted(again)
 # the lids again under the roads as they now lie (the classification reads plan.solo)
 lidded=finish()
 return plans,fixed,report,lidded


# ---------------------------------------------------------------- decks and tunnels
runs=I.runs   # [start, end] index pairs of the True runs of a boolean list


def building_relation(plan,i,building,y=None):
 """How station i of a solved plan passes a building over its pavement: 'under' its base with the roof slab between,
 'over' its roof on a deck, or None: the two stand in each other's space. `y` is the road's height there when it is
 not plan.y[i]."""
 y=plan.y[i] if y is None else y
 if y+plan.clearance+ROOF<=building['base']-.05+1e-6:return 'under'
 if y-THICKNESS>=building['base']+building['height']+.3:return 'over'
 return None


def classify_ground(plan):
 """Which stations of a solved plan lie in a tunnel record (plan.tunnel) and which of those under cover (plan.covered).
 A tunnel record is a road below the ground it runs through, which the runtime walls and, where it is covered, roofs:
 - a stretch whose surface is under the ground and holds a station below source level 0 (with one more station at
   each end, so the record starts and ends above the ground; plan.deep), covered where the roof slab fits under the
   lowest ground across its width;
 - a station under a building of SHED metres or more whose base leaves the roof slab room over the road (`fits`),
   covered; a station with a building over its pavement that it passes neither under nor, on a deck, over
   (building_relation), open (plan.conflict: the building has to give way);
 - a station at or below source level 0 with ground WALLED over the road at either edge of its pavement: the
   cut's wall stands in the 6 m grid's reach of the roadway, so the runtime cuts the ground at the pavement edge
   instead of the grid being graded around a deck.
 A deck shorter than GAP between two such stretches stays part of them. A street landing is never part of a deep stretch;
 a street stretch (street_stretch) is the first part of the tunnel record its road goes down into.
 Every other station is a deck (plan.in_cut: one whose ground stands at its surface).
 A road is classified as it rides its own ground: once its twin may have lifted it (build), the heights read here are
 the ones it was solved with alone (plan.solo), so that bringing two carriageways level moves no record boundary."""
 n=len(plan.points);roof=plan.clearance+ROOF;y=getattr(plan,'solo',None) or plan.y;below=[y[i]<plan.high[i]+SUNK for i in range(n)];plan.tunnel=[False]*n
 for e in (0,1):
  if plan.landing[e]:
   for i in range(n):
    if (plan.along[i] if e==0 else plan.along[-1]-plan.along[i])<LANDING and y[i]>plan.high[i]-.4:below[i]=False
 for a,b in runs(below):
  if not any(plan.level[i]<0 for i in range(a,b+1)):continue
  for i in range(max(0,a-1),min(n-1,b+1)+1):plan.tunnel[i]=True
 # Short deck slivers between two tunnel stretches (a rise of a few centimetres over the ground) stay in the tunnel record.
 for a,b in runs([not t for t in plan.tunnel]):
  if a>0 and b<n-1 and plan.along[b]-plan.along[a]<30 and all(plan.level[i]<=0 for i in range(a,b+1)):
   for i in range(a,b+1):plan.tunnel[i]=True
 plan.deep=list(plan.tunnel)
 plan.conflict=[any(building_relation(plan,i,plan.buildings[j],y[i]) is None for j in plan.built[i]) for i in range(n)]
 plan.fits=[not plan.conflict[i] and any(building_relation(plan,i,plan.buildings[j],y[i])=='under' for j in plan.above[i]) for i in range(n)]
 walled=[plan.level[i]<=0 and plan.edge[i]-y[i]>=WALLED for i in range(n)]
 # Like a deep stretch, a walled or roofed one takes one more station at each end, so the decks beside it start on clear ground.
 for a,b in runs([plan.fits[i] or plan.conflict[i] or walled[i] or plan.forced[i] for i in range(n)]):
  for i in range(max(0,a-1),min(n-1,b+1)+1):plan.tunnel[i]=True
 for a,b in runs([not t for t in plan.tunnel]):
  if a>0 and b<n-1 and plan.along[b]-plan.along[a]<GAP and all(plan.level[i]<=0 for i in range(a,b+1)):
   for i in range(a,b+1):plan.tunnel[i]=True
 # Neither a tunnel stretch nor a deck between two of them is shorter than SHORT: a record of a few metres carries no traffic.
 for a,b in runs(plan.tunnel):
  while plan.along[b]-plan.along[a]<SHORT and (a>0 or b<n-1):a=max(0,a-1);b=min(n-1,b+1)
  for i in range(a,b+1):plan.tunnel[i]=True
 for a,b in runs([not t for t in plan.tunnel]):
  if (a>0 or b<n-1) and plan.along[min(n-1,b+1)]-plan.along[max(0,a-1)]<SHORT:   # (at a street landing too: a tunnel record lands with `surfaceLandings`)
   for i in range(a,b+1):plan.tunnel[i]=True
 # A walled stretch that stops within SHORT of a station where a street joins the road runs on to that station: the record
 # then ends on the junction (records leaves its walls off there) instead of leaving a deck of a few metres before it.
 for k,_ in getattr(plan,'junctions',()):
  if plan.tunnel[k]:continue
  for a,b in runs(plan.tunnel):
   lo,hi=(b,k) if b<k else (k,a)
   if a<=k<=b or plan.along[hi]-plan.along[lo]>=SHORT:continue
   for i in range(lo,hi+1):plan.tunnel[i]=True
 # A street stretch (street_stretch) belongs to the tunnel record its road goes down into, which lands on the street with
 # `surfaceLandings`: so do the stations between the two, the top of the same cut, where they span less than GAP.
 for e in (0,1):
  k=0 if e==0 else n-1;step=1 if e==0 else -1
  if not plan.street[k] or plan.tunnel[k]:continue
  i=k
  while 0<=i<n and plan.street[i]:i+=step
  j=i
  while 0<=j<n and not plan.tunnel[j]:j+=step
  if 0<=j<n and abs(float(plan.along[j]-plan.along[i-step]))<GAP and all(plan.level[q]<=0 for q in range(min(k,j),max(k,j)+1)):
   for q in range(min(k,j),max(k,j)+1):plan.tunnel[q]=True
 plan.covered=[plan.tunnel[i] and (plan.fits[i] or (plan.deep[i] and y[i]+roof<=plan.low[i]-.05)) for i in range(n)]
 plan.in_cut=[(not plan.tunnel[i]) and below[i] for i in range(n)]


def covered_intervals(plan,a,b):
 """Covered [start, end] distances along the tunnel record of stations a..b, runs of MIN_COVERED metres or more."""
 out=[];base=float(plan.along[a])
 for i,j in runs(plan.covered[a:b+1]):
  s0,s1=float(plan.along[a+i])-base,float(plan.along[a+j])-base
  if s1-s0>=MIN_COVERED:out.append([round(s0,3),round(s1,3)])
 return out


def station_layers(plan):return list(plan.level)


def piece_is_tunnel(plan,a,b):return all(plan.tunnel[i] for i in range(a,b+1))


def marks_of(plan,gores):
 """Record boundaries along a plan: gores, lane, level, name and deck/tunnel changes, then the MAX_PIECE limit on decks."""
 n=len(plan.points);marks={0,n-1}|set(gores)
 for i in range(1,n-1):
  a,b=plan.ways[plan.owner[i-1]],plan.ways[plan.owner[i]]
  if plan.lanes[i]!=plan.lanes[i-1] or plan.level[i]!=plan.level[i-1] or a['name']!=b['name']:marks.add(i)
 # A tunnel record runs from the first to the last station of its stretch; the decks beside it share those two stations.
 for a,b in runs(plan.tunnel):marks|={a,b}
 # No piece under SHORT metres where it can be helped (the traffic graph drops a record a few metres long, and its lanes with
 # it): a lane, level or name change that close to another mark moves onto it. Gores and the ends of tunnel stretches stay
 # (classify_ground keeps those SHORT apart).
 hard={0,n-1}|set(gores)|{i for run in runs(plan.tunnel) for i in run};marks=sorted(marks);k=1
 while k<len(marks):
  a,b=marks[k-1],marks[k]
  if plan.along[b]-plan.along[a]>=SHORT:k+=1
  elif b not in hard:del marks[k]
  elif a not in hard:del marks[k-1];k=max(1,k-1)
  else:k+=1
 out=[marks[0]]
 for a,b in zip(marks,marks[1:]):
  span=plan.along[b]-plan.along[a];parts=1 if piece_is_tunnel(plan,a,b) else math.ceil(span/MAX_PIECE-1e-9)
  for k in range(1,parts):out.append(int(np.argmin(np.abs(plan.along-(plan.along[a]+span*k/parts)))))
  out.append(b)
 return out




def record(plan,a,b,id,levels,name):
 """The road record of stations a..b of a solved plan: a tunnel record when every station lies in a tunnel stretch, else a deck."""
 spec=plan.spec;w=[min(20,v) for v in plan.widths[a:b+1]];n=len(plan.points)
 rec={'id':id,'name':name,'kind':spec['kind'],'points':[[round(p[0],3),round(p[1],3)] for p in plan.points[a:b+1]],'width':round(max(w),2),'oneway':1,'lanes':plan.lanes[a],
  'elevations':[round(v,3) for v in plan.y[a:b+1]],'startLevel':levels[0],'endLevel':levels[1],'deckWidths':[round(v,3) for v in w]}
 if piece_is_tunnel(plan,a,b):
  rec['tunnel']={'clearance':plan.clearance,'covered':covered_intervals(plan,a,b)}
  rec['highway']=spec['bridge']
 else:
  rec['bridge']={'id':spec['bridge'],'kind':KIND,'thickness':THICKNESS,'clearanceEstimated':True,'sourceLayer':max(plan.level[a:b+1]) if b>a else plan.level[a]}
  # The surveyed roadway beside the deck's lanes (highway_roadways.py): its edges left and right of the centre line at each station that has one.
  edges=getattr(plan,'roadway',None)
  if edges and any(edges[i] for i in range(a,b+1)):rec['roadway']=[list(edges[i]) if edges[i] else None for i in range(a,b+1)]
 return I.seam_tangents(rec,plan,a,b,n)


def landing_interval(plan,rec,a,b,e,streets):
 """The stretch of a tunnel record's street landing that lies on the street: [start, end] distances along the record
 (stations a..b of the plan, landing at its end `e`). It reaches as far as the road runs over the street's roadway (the
 reviewed `landing` of its spec, or pavement_reach) and no further than the ground stays within LANDING_LIP over it
 (plan.mid, the median across the lanes): the runtime keeps the ground whole over a landing and builds no wall beside
 it, so a landing that ran on over a road already below the ground left the ground standing over the road. Such a
 landing ends where the ground first stood LANDING_STEP over the road."""
 line=LineString(rec['points']);total=line.length;width=round(max(min(20,v) for v in plan.solved_widths[a:b+1]),2) if hasattr(plan,'solved_widths') else rec['width']   # (the width the road was solved with)
 extent=min(float(plan.spec['landing']),total) if 'landing' in plan.spec else pavement_reach(line,width,e,streets)
 if not plan.on_deck[e]:
  end=float(plan.along[a if e==0 else b]);track=[]
  for i in (range(a,b+1) if e==0 else range(b,a-1,-1)):
   d=abs(float(plan.along[i])-end);over=plan.mid[i]-plan.y[i]
   if d>extent:break
   track.append((d,over))
   if over<=LANDING_LIP or len(track)<2:continue
   # back to the last station the road was level with the ground at, and on to where the ground passes the step
   k=max(j for j,(_,o) in enumerate(track) if o<=LANDING_STEP) if track[0][1]<=LANDING_STEP else 0
   (d0,o0),(d1,o1)=track[k],track[k+1];extent=max(.5,d0+(d1-d0)*((LANDING_STEP-o0)/(o1-o0) if o0<LANDING_STEP<o1 else 0.));break
 extent=float(extent);return [0,round(extent,3)] if e==0 else [round(total-extent,3),round(total,3)]


def records(plans,neighborhoods):
 """Road records of the solved plans, decks and tunnels apart: (deck records, tunnel records, {plan id: record ids})."""
 gores={plan.id:set() for plan in plans}
 for r in plans:
  for kind in r.ends:
   if kind and kind[0] in ('gore','node') and isinstance(kind[1],I.Plan):gores[kind[1].id].add(kind[2])
 # and where a street joins a deck within JOIN of its height (a higher deck keeps its rail across the street's end)
 for plan in plans:gores[plan.id]|={k for k,h in plan.junctions if not plan.tunnel[k] and abs(plan.y[k]-h)<=JOIN}
 decks=[];tunnels=[];ids={}
 for plan in plans:
  marks=marks_of(plan,gores[plan.id]);n=len(plan.points);ids[plan.id]=[];recs=[]
  for k,(a,b) in enumerate(zip(marks,marks[1:])):
   way=plan.ways[plan.owner[a]];name=way['name']
   if plan.main:
    # (named for the place its middle lies in by its own curbs: highway_roadways.apply keeps that line of a carriageway its median then moved)
    place=I.place_name((getattr(plan,'fitted',None) or plan.points)[(a+b)//2],neighborhoods);name=name+(f' · {place}' if place else '');rid=f'{plan.id}-{k+1:02d}'
   else:rid=plan.id if k==0 else f'{plan.id}-{k+1}'
   tunnel=piece_is_tunnel(plan,a,b);ground=0;lifted=-1 if tunnel else 1
   # A landing on a street is on the ground; one on a bridge's vertex (the ramp up to the Harvard Bridge) ends lifted like the deck it meets.
   levels=(ground if plan.landing[0] and a==0 and not plan.on_deck[0] else lifted,ground if plan.landing[1] and b==n-1 and not plan.on_deck[1] else lifted)
   rec=record(plan,a,b,rid,levels,name)
   if tunnel:
    for e,flag in ((0,a==0),(1,b==n-1)):
     if flag and plan.landing[e]:rec['tunnel'].setdefault('surfaceLandings',[]).append(landing_interval(plan,rec,a,b,e,plan.ends[e][1]))
    # A walled record that ends where a street joins the road has no walls across the street's mouth.
    total=round(float(plan.along[b]-plan.along[a]),3);mouths={k for k,h in plan.junctions if abs(plan.y[k]-h)<=JOIN}
    if a in mouths:rec['tunnel'].setdefault('surfaceLandings',[]).append([0,min(MOUTH,total)])
    if b in mouths:rec['tunnel'].setdefault('surfaceLandings',[]).append([max(0,round(total-MOUTH,3)),total])
   recs.append(rec);ids[plan.id].append(rid)
  plan.pieces=[(a,b,rec['id']) for (a,b),rec in zip(zip(marks,marks[1:]),recs)]
  closed=plan.spec.get('closed')
  if closed=='end':recs[-1]['closed']='end'
  if closed=='start':recs[0]['closed']='start'
  if plan.spec.get('cap')=='start':
   assert recs[0].get('tunnel') and any(a<.01 and b>=BORE for a,b in recs[0]['tunnel']['covered']),f'{plan.id} must start under {BORE} m of roof'
   recs[0]['tunnel']['capStart']=True
  for rec in recs:(tunnels if rec.get('tunnel') else decks).append(rec)
 return decks,tunnels,ids


def warning_signs(plans,report,source):
 """Storrow Drive's posted warnings, for the sidecar's `signs` (each on a record, `station` metres along it):
 - `cars-only` where traffic comes onto the parkway: SIGN_IN metres along each carriageway from the street it
   starts on, and along every entrance ramp;
 - `clearance` SIGN_AHEAD metres before each structure a carriageway or ramp passes under: the first roofed
   station of a tunnel stretch, an existing bridge (the Harvard Bridge's approach) and its own ramps crossing
   over it. The height is the `maxheight` the OpenStreetMap way along the road posts there (STORROW_TAG_WAYS),
   10 ft where the cached extracts have no way."""
 posted=[(LineString(w['points']),w['tags']['maxheight']) for w in source['ways'] if w['id'] in STORROW_TAG_WAYS and "'" in w['tags'].get('maxheight','')]
 def height(plan,i):
  p=Point(plan.points[i]);near=sorted((line.distance(p),h) for line,h in posted if line.distance(p)<12)
  feet,_,inches=(near[0][1] if near else "10'0\"").partition("'");return f"{int(feet)}'-{int(inches.strip('\"') or 0)}\""
 def place(plan,i):
  for a,b,rid in plan.pieces:
   if a<=i<=b and (i<b or b==len(plan.points)-1):return rid,round(float(plan.along[i]-plan.along[a]),1)
 out=[]
 for plan in plans:
  if plan.spec['bridge']!='storrow':continue
  n=len(plan.points);total=float(plan.along[-1])
  if (plan.main or '-entrance-' in plan.id) and plan.landing[0] and total>SIGN_IN+10:
   rid,station=place(plan,int(np.searchsorted(plan.along,SIGN_IN)));out.append({'kind':'cars-only','road':rid,'station':station})
  marks={a for a,_ in runs(plan.covered)}
  marks|={int(np.argmin(np.abs(plan.along-c['at']))) for c in report['crossings'] if c['road']==plan.id and 'under' in c}
  marks|={plan.nearest(c['point']) for c in report['newCrossings'] if c['under']==plan.id}
  last=-math.inf
  for i in sorted(marks):
   at=float(plan.along[i])-SIGN_AHEAD
   if at<SIGN_IN or at-last<SIGN_AHEAD:continue   # one warning serves structures standing close together
   last=at;rid,station=place(plan,int(np.searchsorted(plan.along,at)));out.append({'kind':'clearance','road':rid,'station':station,'clearance':height(plan,i)})
 return out


class DeckRun:
 """The deck stations a..b of a plan, as cut_plan and cut_terrain read a plan: at the heights it has on its own ground (`alone`) or as it lies."""
 def __init__(self,plan,a,b,alone=False):
  self.id=plan.id;self.points=plan.points[a:b+1];self.y=(HR.alone(plan) if alone else plan.y)[a:b+1];self.widths=plan.widths[a:b+1];self.terrain=plan.edge[a:b+1];self.allowance=plan.allowance[a:b+1]
  self.along=np.asarray(plan.along[a:b+1])-float(plan.along[a]);self.line=LineString(self.points)


def deck_runs(plans,alone=False):
 """The deck stretches of the plans, each with the tunnel station it shares at either end (`alone`: DeckRun)."""
 out=[]
 for plan in plans:
  n=len(plan.points)
  for a,b in runs([not t for t in plan.tunnel]):
   a,b=max(0,a-1),min(n-1,b+1)
   if b>a:out.append(DeckRun(plan,a,b,alone))
 return out


def street_pavements(cut,decks,streets,lines,tree,grid,joined=frozenset()):
 """The vertices of a deck cut (cut_plan) that belong to a street beside the deck: every vertex of a cell a
 surface street's corridor passes over (as cut_terrain keeps them), outside every deck's own footprint. The cut
 lowers a shelf beside each deck edge so the 6 m grid stays out of the deck, which tilted the streets running
 along the Turnpike's cut and Storrow Drive (Back Street, Newbury Street) toward the road: a street keeps its
 corridor, and a deck whose edge the ground then stands in becomes a walled cut there. A street that joins one
 of the roads at its height (`joined`, by identity) shares its ground with it instead."""
 from north_overpasses import Window,covered,half_width
 allowed,_=cut
 if not allowed or not streets:return set()
 W=grid['width'];C=grid['cellSize'];vs=np.asarray(sorted(allowed),dtype=np.int64);gx=grid['originX']+(vs%W)*C;gz=grid['originZ']+(vs//W)*C;pts=shapely.points(gx,gz)
 _,j=tree.query(pts,predicate='dwithin',distance=max(half_width(r) for r in streets)+2*C);near=[streets[k] for k in sorted(set(j.tolist())) if id(streets[k]) not in joined]
 if not near:return set()
 win=Window(grid,(float(gx.min())-C,float(gz.min())-C,float(gx.max())+C,float(gz.max())+C));kept=win.index[covered(grid,win,near)]
 paved=np.isin(vs,kept)
 for deck in decks:
  d=shapely.line_locate_point(deck.line,pts);paved&=shapely.distance(deck.line,pts)>np.interp(d,deck.along,deck.widths)/2+.5
 return set(vs[paved].tolist())


def standing_ground(plans,ground,alone=False):
 """Deck stations whose pavement the ground still stands in after the cut (a building keeps its ground, and a
 6 m cell with one vertex under it slopes into the roadway): {plan id: stations}. `alone` reads each road at the
 height it has on its own ground (HR.alone), as the cut it follows does."""
 out={}
 for plan in plans:
  n=len(plan.points);rows=[i for i in range(n) if not plan.tunnel[i]];heights=HR.alone(plan) if alone else plan.y
  if not rows:continue
  # A deck record starts on the tunnel station beside it: where the ground stands in that one, the tunnel takes the next station.
  for i in range(n):
   if plan.tunnel[i] and any(0<=j<n and not plan.tunnel[j] for j in (i-1,i+1)):
    half=plan.widths[i]/2-.3;(x,z),(tx,tz)=plan.points[i],plan.tangents[i];lip=LANDING_LIP+.02 if plan.allowance[i]<=.999 else -.02
    if max(ground(x-tz*o,z+tx*o) for o in np.linspace(-half,half,9).tolist())>heights[i]+lip:out.setdefault(plan.id,set()).update(j for j in (i-1,i+1) if 0<=j<n and not plan.tunnel[j])
  p=np.asarray(plan.points,float)[rows];t=np.asarray(plan.tangents,float)[rows];half=np.asarray(plan.widths,float)[rows]/2-.3;y=np.asarray(heights,float)[rows]
  hit=set()
  def stands(q,d,h,height):return max(ground(float(q[0]-d[1]*o),float(q[1]+d[0]*o)) for o in np.linspace(-h,h,9).tolist())>height-.02
  for k,i in enumerate(rows):
   if plan.allowance[i]<=.999:
    # Where a ramp meets its street the two share the ground; ground LANDING_LIP over the ramp there is a bank it has gone down into.
    if stands(p[k],t[k],half[k],y[k]+LANDING_LIP+.02):hit.add(i)
    continue
   if stands(p[k],t[k],half[k],y[k]):hit.add(i)
   # and between two deck stations, where a ridge of the 6 m grid can cross the pavement
   if k+1<len(rows) and rows[k+1]==i+1 and plan.allowance[i+1]>.999:
    for f in (1/3,2/3):
     if stands(p[k]+(p[k+1]-p[k])*f,t[k],half[k]+(half[k+1]-half[k])*f,y[k]+(y[k+1]-y[k])*f):hit|={i,i+1}
  if hit:out.setdefault(plan.id,set()).update(hit)
 return {k:sorted(v) for k,v in out.items()}


FIELDS=('name','points','width','oneway','kind','lanes','closed','elevations','startLevel','endLevel','deckWidths','deckTangents','bridge','tunnel','highway','roadway')


def stage_owned(road):
 """Roads this stage adds: its records and the deck pieces carrying streets over its cuts."""
 return road['id'].startswith(PREFIXES) or road.get('bridge',{}).get('kind') in (KIND,APPROACH)


def restore(roads,heights,record):
 """Drop the roads a previous run added and put back the streets and grid vertices it changed (in place; `heights` None leaves the grid)."""
 if not record:return
 changes=record.get('roads',{});added=set(changes.get('added',[]));sources={r['id']:r for r in changes.get('sources',[])}
 if added or sources:roads[:]=[copy.deepcopy(sources[r['id']]) if r['id'] in sources else r for r in roads if r['id'] not in added]
 for item in changes.get('removed',[]):roads.insert(item['index'],copy.deepcopy(item['road']))   # (in rising order, each back at its own place)
 terrain=record.get('terrain')
 if heights is not None and terrain and terrain['vertices']:heights[np.asarray(terrain['vertices'],dtype=np.int64)]=np.asarray(terrain['heights'],dtype=heights.dtype)


def before_stage(roads,heights,record,scale=.01):
 """Copies of the package roads and graded grid as the stages before this one left them."""
 roads=copy.deepcopy(roads);restore(roads,None,record);return roads,I.staged_heights(heights,record,scale)


def before_road_stages(roads,heights,provenance,scale=.01):
 """Copies of the package roads and graded grid as the stages before the highway stages (Interstate 93, then this
 one) left them, for the checks and replays of those earlier stages on an installed package."""
 roads,heights=before_stage(roads,heights,provenance.get('bostonHighways'),scale);return I.before_stage(roads,heights,provenance.get('i93North'),scale)


def install(city,source,heights,ungraded,buildings,tunnels=(),routes=None,removed=()):
 """Build the stage on a package without it: (provenance record, the package roads with the stage's decks,
 the tunnel sidecar roads, the cut grid, the solved plans). `buildings` is the package's TileBuildings and
 `removed` the structures an earlier run took out of it (buildings_over)."""
 from water_crossings import water_inputs
 grid=city['elevation'];water=water_inputs(city);ground=I.Terrain(grid,heights);raw=I.Terrain(grid,ungraded);source_roads=city['roads'];removed=list(removed)
 # Level the street bridges over the cut first: the road beneath is then solved under the bridges as they will stand.
 pre=plans_of(source,city,ROUTES if routes is None else routes)
 for plan in pre:plan.ground=ground;measure_ground(plan,ground,raw);plan.water_polygons=[poly for poly in water[0] if poly.intersects(plan.line)]
 # (a street the segments start at level 0 on a bridge node over the road is that bridge's ramp)
 # (a second source's copy of a bridge over the road leaves the package first: the road is not solved under it)
 kept,copies=bridge_copies(source_roads,pre)
 seamed,seams,seam_notes,seam_pieces=bridge_seams(kept,pre,ground)
 levelled,flattened,overpasses=level_overpasses(seamed,pre,ground)
 # then again from a first solve: where the road lies lower than its ground suggested, the bridge comes down to what it needs
 # (each road on its own ground: a bridge is levelled over the road as its ground has it, and stays a ceiling for a carriageway its twin would lift)
 first,*_=build({**city,'roads':levelled},source,heights,ungraded,water,buildings.without(r['id'] for r in removed),tunnels,routes,twins=False)
 solved={p.id:(np.asarray(p.along,float),np.asarray(p.y,float)) for p in first};levelled,flattened,overpasses=level_overpasses(seamed,pre,ground,solved)
 # A landing of a levelled bridge in a hollow of the ground: the ground is raised to the bridge, which is then levelled once more on it.
 work,raised,lowered,hollows=raise_hollows(seamed,levelled,overpasses,pre,grid,heights)
 if hollows:
  found={r['id']:r for r in lowered};levelled,again,overpasses=level_overpasses(raised,pre,I.Terrain(grid,work),solved,{W.node_key(h['landing']) for h in hollows})
  flattened=flattened+[found.get(f['id'],f) for f in again if f['id'] not in {x['id'] for x in flattened}]
 city={**city,'roads':levelled}
 flattened=seams+[f for f in flattened if f['id'] not in {s['id'] for s in seams} and f['id'] not in seam_pieces]
 paved=[r for r in city['roads'] if not r.get('elevations') and not r.get('tunnel') and not stage_owned(r)];paved_lines=[LineString(r['points']) for r in paved];paved_tree=STRtree(paved_lines)
 # A structure the stage removes takes no part in the solve, so the build is redone without it (and a rerun, whose tiles no longer hold it, builds the same).
 for _ in range(4):
  standing_buildings=buildings.without(r['id'] for r in removed)
  plans,fixed,report,lidded=build(city,source,work,ungraded,water,standing_buildings,tunnels,routes)
  # A ramp pinned at both ends between the roads it joins may pass its grade a little; more than GRADE_SLACK is a broken profile.
  grades={p.id:max(abs(p.y[i+1]-p.y[i])/max(.5,float(p.along[i+1]-p.along[i])) for i in range(len(p.y)-1)) for p in plans}
  bad={p.id:round(grades[p.id],3) for p in plans if grades[p.id]>p.grade+GRADE_SLACK};assert not bad,f'highway profiles exceed their grade: {bad}'
  steep=[{'road':p.id,'grade':round(grades[p.id],4),'limit':p.grade} for p in plans if grades[p.id]>p.grade+1e-4]
  under=sorted({c['under'] for c in report['crossings'] if 'under' in c});by_id={p.id:p for p in plans};joined={id(r) for p in plans for r in p.joined}
  # A deck the ground still stands in becomes a walled cut there, and the grid is cut again for the decks that remain.
  result,replaced,notes,roads,runs_=stand(city,plans,grid,lidded,paved,paved_lines,paved_tree,under,joined,standing_buildings.footprints)
  over=buildings_over(plans,I.Terrain(grid,result),removed)
  if len(over['removed'])==len(removed):break
  removed=over['removed']
 else:raise AssertionError('the structures to remove did not settle')
 # The surveyed roadways: every road in the open is moved and resized to the curbs, the ground set under the decks that ride it.
 gores={plan.id:set() for plan in plans}
 for r in plans:
  for kind in r.ends:
   if kind and kind[0] in ('gore','node') and isinstance(kind[1],I.Plan):gores[kind[1].id].add(kind[2])
 measured=HR.survey(plans,source.get('curbs',[]),paved,I.Terrain(grid,lidded),raw,standing_buildings,least_width);hold={};before=I.Terrain(grid,lidded)
 # (and the two carriageways of a railed road are parted where their pavements, each fitted to its own curbs, leave less than the median barrier is wide)
 railed=[pair for pair in twin_pairs(plans) if all(HR.railed(p) for p in pair)]
 for _ in range(16):
  pairs,surveyed,medians=HR.apply(plans,measured,gores,least_width,hold,railed)
  for plan in plans:
   x=cross_sections(plan,.5);g=np.array([[before(float(a),float(b)) for a,b in row] for row in x]);plan.edge=g.max(1).tolist()
  # the cut again, under the roads as they now lie, then the ground set under the decks that ride it and brought up under every other road its twin has lifted
  result,replaced,notes,roads,runs_=cut_ground(city,plans,grid,lidded,paved,paved_lines,paved_tree,under,joined,standing_buildings.footprints)
  result=HR.grade(plans,pairs+HR.fills(plans,pairs),grid,result,paved,joined,standing_buildings.footprints,water[0],runs_,[r for r in roads if r.get('elevations') and not r.get('tunnel')],LANDING_LIP)
  left=standing_ground(plans,I.Terrain(grid,result))
  if not left:break
  # A station whose surveyed place the ground does not leave free (a street's corridor, a building) stays where it was solved,
  # and so do the stations of every road within HOLD_NEAR of it: the ground a ramp left when it moved can stand in the road beside it.
  for k,rows in left.items():
   hold.setdefault(k,set()).update(j for i in rows for j in (i-1,i,i+1))
   for i in rows:
    q=Point(by_id[k].solved_points[i])
    for other in plans:
     if other.line.distance(q)<=HR.HOLD_NEAR+1:hold.setdefault(other.id,set()).update(j for j,o in enumerate(other.solved_points) if math.dist(o,(q.x,q.y))<=HR.HOLD_NEAR)
 else:raise AssertionError(f'ground stands in the pavement of roads moved to their surveyed roadway: {left}')
 # the paving beside a deck's lanes stays only where the ground came to lie flush under the deck
 trimmed=HR.trim(plans,pairs,I.Terrain(grid,result))
 # (what the buildings over the roads need stays as it was found for the solved pavements: a station under or beside a building is not moved,
 # and a moved pavement keeps clear of every other building, highway_roadways.building_caps)
 vertices=np.flatnonzero(result!=heights);originals=heights[vertices].astype(int).tolist();vertices=vertices.tolist()
 hoods=[{'name':n['name'],'shape':Polygon(n['rings'][0],n['rings'][1:])} for n in city['neighborhoods']]
 decks,tunnel_records,ids=records(plans,hoods);signs=warning_signs(plans,report,source);pieces=[x for k in sorted(replaced) for x in replaced[k] if x.get('elevations')]
 # (what the twins left apart, by record: stations of the record and the most its twin stands over it there)
 twins={**report['twins'],'pairs':[{**pair,'apart':[{'road':rid,'stations':[max(i,a)-a,min(j,b)-a],'by':by} for k in pair['roads'] for i,j,by in pair['apart'][k] for a,b,rid in by_id[k].pieces if max(i,a)<=min(j,b)]} for pair in report['twins']['pairs']]}
 scale=grid.get('scale',.01);delta=(result.astype(np.int64)-heights.astype(np.int64))*scale
 def length(recs):return round(sum(stations(r['points'])[-1] for r in recs),1)
 summary={p.id:{'lengthMeters':round(float(p.along[-1]),1),'records':len(ids[p.id]),'tunnelMeters':round(sum(float(p.along[b]-p.along[a]) for a,b in runs(p.tunnel)),1),
  'coveredMeters':round(sum(float(p.along[b]-p.along[a]) for a,b in runs(p.covered)),1),'lanes':sorted(set(p.lanes))} for p in plans}
 record_={'method':METHOD,'routes':summary,'closed':[{'road':r['id'],'end':r['closed'],'point':r['points'][-1 if r['closed']=='end' else 0]} for r in decks+tunnel_records if r.get('closed')],
  'capped':[{'road':r['id'],'end':'start','point':r['points'][0]} for r in tunnel_records if r['tunnel'].get('capStart')],
  'crossings':report['crossings'],'newCrossings':report['newCrossings'],'atGrade':report['atGrade'],'unresolved':report['unresolved'],
  'infeasible':[{k:(float(v) if isinstance(v,np.floating) else v) for k,v in i.items()} for i in report['infeasible']],'steep':steep,'movedBeside':report['movedBeside'],'narrowed':report['narrowed'],'junctions':report['junctions'],
  'approachPieces':[{'road':p['id'],'lengthMeters':round(stations(p['points'])[-1],2)} for p in pieces],'notCarried':seam_notes+notes,'bridgeSeams':{'changed':[{'road':r['id'],'name':r['name']} for r in seams],'pieces':seam_pieces},'overpasses':overpasses,'hollows':hollows,'twins':twins,'buildings':over,'signs':signs,
  'roadways':{'method':HR.METHOD,'routes':surveyed,'trimmedMeters':trimmed,'aprons':[{k:a[k] for k in ('road','left','right')} for _,a in pairs],
   # (the medians, with what stays narrower than its lanes' least width by record: stations of the record and the most it is short there)
   'medians':[{**m,'parted':{k:{**v,'tight':[{'road':rid,'stations':[max(i,a)-a,min(j,b)-a],'by':by} for i,j,by in v['tight'] for a,b,rid in by_id[k].pieces if max(i,a)<=min(j,b)]} for k,v in m['parted'].items()}} for m in medians]},
  'deckMeters':length(decks),'tunnelMeters':length(tunnel_records),
  'roads':{'added':[r['id'] for r in decks]+seam_pieces+[p['id'] for p in pieces if p['id'] not in replaced],'tunnels':[r['id'] for r in tunnel_records],'sources':flattened+[copy.deepcopy(r) for r in source_roads if r['id'] in replaced and r['id'] not in {f['id'] for f in flattened}],'removed':copies},
  'terrain':{'vertices':[int(v) for v in vertices],'heights':[int(h) for h in originals],'maxCutMeters':round(float(-delta.min()),3) if len(vertices) else 0,'maxFillMeters':round(float(delta.max()),3) if len(vertices) else 0,
   'cutCubicMeters':round(float(-delta[delta<0].sum())*grid['cellSize']**2),'fillCubicMeters':round(float(delta[delta>0].sum())*grid['cellSize']**2)}}
 return record_,roads+decks,tunnel_records,result,plans


def replay(data_dir,city,record,source,installed=None):
 """Rerun the stage from the recorded originals; True when it rewrites the installed roads, sidecar and grid exactly.
 `installed` is the int16 graded grid the stage left (the shipped one unless a later stage changed it)."""
 from north_overpasses import load_grid
 grid=city['elevation'];roads=copy.deepcopy(city['roads']);installed=load_grid(data_dir/grid['file']) if installed is None else installed;heights=installed.copy();restore(roads,heights,record)
 again,out,tunnel_records,result,_=install({**city,'roads':roads},source,heights,load_grid(data_dir/grid['source']),tile_buildings(data_dir,city),central_artery(data_dir,city),removed=record['buildings']['removed'])
 by_id={r['id']:r for r in city['roads']};touched=set(again['roads']['added'])|{r['id'] for r in again['roads']['sources']};sidecar=json.loads((data_dir/SIDECAR).read_text())
 same=[r['id'] for r in out]==[r['id'] for r in city['roads']] and all(r.get(f)==by_id[r['id']].get(f) for r in out if r['id'] in touched for f in FIELDS)
 return same and tunnel_records==sidecar['roads'] and again['signs']==sidecar['signs'] and np.array_equal(result,installed) and all(again[k]==record.get(k) for k in ('terrain','roads','buildings','signs','closed','capped','overpasses','bridgeSeams','hollows','twins','roadways'))


def validate(data_dir,city,record,ground):
 """Check the installed stage: record fields, the Turnpike's two closed ends, that every record meets the one it
 continues (the pieces of a route each other, a ramp end a carriageway or ramp vertex, a vertex of an existing road
 at that road's height or a vertex of the Central Artery tunnel road it joins; a closed bore end, `capped`, meets
 nothing and lies under its roof), that no ground stands in a deck's
 pavement, that every surface street over a tunnel record crosses a covered stretch of it, and that the buildings
 over the roads carry what the stage recorded for them. `ground(x,z)` is the
 graded terrain. Returns counts."""
 import re,tileformat
 sidecar=json.loads((data_dir/SIDECAR).read_text());decks=[r for r in city['roads'] if r['id'].startswith(PREFIXES)];tunnels=sidecar['roads'];roads=decks+tunnels
 by={r['id']:r for r in roads};assert len(by)==len(roads),'highway record ids must be unique'
 assert [r['id'] for r in tunnels]==record['roads']['tunnels'] and set(r['id'] for r in decks)<=set(record['roads']['added']),'provenance must list the installed highway records'
 for r in roads:
  n=len(r['points']);assert n>=2 and len(r['elevations'])==n==len(r['deckWidths']) and all(math.isfinite(y) for y in r['elevations']),f"{r['id']} profile"
  assert r['oneway']==1 and isinstance(r['lanes'],int) and ((2<=r['lanes']<=5) if r['kind']=='motorway' else (r['kind']=='motorway_link' and 1<=r['lanes']<=2)),f"{r['id']} lanes"
  assert r['name'].startswith(('I-90 ','Route 1A ','Storrow Drive ')),f"{r['id']} name"
  if r.get('tunnel'):
   total=stations(r['points'])[-1];assert r.get('highway') in ('i90','route1a','storrow') and 'bridge' not in r and r['tunnel']['clearance'] in (CLEARANCE,STORROW_CLEARANCE),f"{r['id']} tunnel record"
   assert all(0<=a<b<=total+.01 for a,b in r['tunnel']['covered']+r['tunnel'].get('surfaceLandings',[])),f"{r['id']} covered intervals"
   # A landing on the ground (a record end at level 0) lies on its street: the runtime keeps the ground whole over it.
   along=stations(r['points']);t=I.tangents(r['points']);w=r['deckWidths']
   for a,b in r['tunnel'].get('surfaceLandings',[]):
    if not ((a<.01 and r['startLevel']==0) or (b>total-.01 and r['endLevel']==0)):continue
    for d in [*np.arange(a,b,1.0).tolist(),b]:
     i=min(len(along)-2,max(0,int(np.searchsorted(along,d,'right'))-1));x,z=(float(np.interp(d,along,[q[k] for q in r['points']])) for k in (0,1))
     y=float(np.interp(d,along,r['elevations']));half=float(np.interp(d,along,w))/3   # (the lanes: the middle two thirds of the pavement)
     over=float(np.median([ground(x-t[i][1]*o,z+t[i][0]*o) for o in np.linspace(-half,half,5).tolist()]))-y
     assert over<=LANDING_LIP+.05,f"the ground stands {over:.2f} m over {r['id']} inside its street landing, {d:.1f} m along it"
  else:assert r['bridge']['kind']==KIND and r['bridge']['id'] in ('i90','route1a','storrow'),f"{r['id']} bridge kind"
 assert all(r['bridge']['kind']==APPROACH for r in city['roads'] if stage_owned(r) and not r['id'].startswith(PREFIXES)),'a street deck the stage owns must be an overpass approach'
 closed=sorted((r['id'],r['closed']) for r in roads if r.get('closed'));ends=sorted((c['road'],c['end']) for c in record['closed'])
 assert closed==ends and [e for _,e in closed]==['start','end'] and closed[0][0].startswith('i90-eb-') and closed[1][0].startswith('i90-wb-'),f'highway closures: {closed}'
 # A closed bore end (a ramp whose tunnel the package does not carry) is the start of its route, under its roof, and no record ends closed that way.
 capped=[r['id'] for r in tunnels if r['tunnel'].get('capStart')];assert capped==[c['road'] for c in record.get('capped',[])] and not any(r['tunnel'].get('capEnd') for r in tunnels),f'highway bore ends: {capped}'
 for r in tunnels:
  if r['tunnel'].get('capStart'):assert r['id'] in record['routes'] and any(a<.01 and b>=BORE for a,b in r['tunnel']['covered']),f"{r['id']} must start under {BORE} m of roof"
 routes=defaultdict(list)
 for r in roads:
  m=re.fullmatch(r'(.*?)-(\d+)',r['id']);base,k=(m.group(1),int(m.group(2))) if m and m.group(1) in record['routes'] else (r['id'],1);routes[base].append((k,r))
 assert set(routes)==set(record['routes']),'every route of the stage must be installed'
 def meet(a,ia,b,ib,tol=.0002):return a['points'][ia]==b['points'][ib] and abs(a['elevations'][ia]-b['elevations'][ib])<=tol
 for base,parts in routes.items():
  chain=[r for _,r in sorted(parts,key=lambda t:t[0])];assert len(chain)==record['routes'][base]['records'],f'{base} pieces'
  for a,b in zip(chain,chain[1:]):assert meet(a,-1,b,0),f"{a['id']} does not meet {b['id']}"
 vertices=defaultdict(list)
 for r in [x for x in city['roads'] if not stage_owned(x)]+central_artery(data_dir,city):
  for i,q in enumerate(r['points']):vertices[key(q)].append((r,i))
 landings=joins=0;squeezed={x['road']:x['worst'] for x in record['infeasible']}
 for base,parts in routes.items():
  chain=[r for _,r in sorted(parts,key=lambda t:t[0])]
  for r,i in ((chain[0],0),(chain[-1],-1)):
   if r.get('closed')==('start' if i==0 else 'end') or (i==0 and r.get('tunnel',{}).get('capStart')):continue
   # (a route the stage reports as squeezed between its bounds, `infeasible`, may miss a join by what it reports)
   y=r['elevations'][i];slack=squeezed.get(base,0);own=[o for o in roads if routes_of(o,record)!=base and any(q==r['points'][i] and abs(o['elevations'][j]-y)<=.01+slack for j,q in enumerate(o['points']))]
   if own:joins+=1;continue
   there=[(o,j) for o,j in vertices.get(key(r['points'][i]),()) if abs((o['elevations'][j] if o.get('elevations') else ground(*o['points'][j]))-y)<=.1+slack]
   assert there,f"{r['id']} {'starts' if i==0 else 'ends'} at {r['points'][i]} on no carriageway, ramp or street vertex at its height";landings+=1
 # no ground in a deck's pavement, but for a landing on its street
 for r in decks:
  line=LineString(r['points']);along=np.asarray(stations(r['points']));w=np.asarray(r['deckWidths'],float);t=I.tangents(r['points'])
  chain=[x for _,x in sorted(routes[routes_of(r,record)],key=lambda q:q[0])]
  for i,(p,y) in enumerate(zip(r['points'],r['elevations'])):
   # a route's own ends meet a street or another road on shared ground
   meeting=(r is chain[0] and along[i]<I.LANDING_TAPER+3) or (r is chain[-1] and along[-1]-along[i]<I.LANDING_TAPER+3)
   half=w[i]/2-.3;assert max(ground(p[0]-t[i][1]*o,p[1]+t[i][0]*o) for o in np.linspace(-half,half,9).tolist())<=y+(LANDING_LIP+.03 if meeting else .01),f"the ground stands in the pavement of {r['id']} at {p}"
 # no surface street passes over an open stretch of a tunnel record (the runtime clips the ground over one), but for the street a record lands on
 surface=[x for x in city['roads'] if not stage_owned(x) and not x.get('elevations') and not x.get('tunnel')];slines=[LineString(x['points']) for x in surface];stree=STRtree(slines);under=0
 for r in tunnels:
  line=LineString(r['points']);along=stations(r['points']);roofed=r['tunnel']['covered']+r['tunnel'].get('surfaceLandings',[])
  for j in stree.query(line,predicate='intersects').tolist():
   for q in crossing_points(line.intersection(slines[j])):
    d=line.project(q);under+=1
    if any(a-.01<=d<=b+.01 for a,b in roofed):continue
    assert min(d,along[-1]-d)<.5 and abs(float(np.interp(d,along,r['elevations']))-ground(q.x,q.y))<=LANDING_LIP+.2,f"{surface[j]['name']} ({surface[j]['id']}) crosses an open stretch of {r['id']} at {[round(q.x,1),round(q.y,1)]}"
 over=record['buildings'];mesh={m['id']:m['roads'] for m in over['mesh']};carved={q['building'] for q in over['passages']};gone={q['id'] for q in over['removed']};seen=set()
 for k in sorted({m['tile'] for m in over['mesh']}|{q['tile'] for q in over['passages']+over['removed']}):
  for b in tile_header(data_dir,city,k)['buildings']:
   assert b['id'] not in gone,f"{b['id']} stands in the roadway; rerun build-boston-highways.py"
   if b['id'] in mesh:assert b.get('collision')=='mesh' and b.get('highwayOverlaps')==mesh[b['id']],f"{b['id']} needs exact collision over the highway; rerun building_clearance_package.py";seen.add(b['id'])
   else:assert 'highwayOverlaps' not in b,f"{b['id']} carries a stale highway overlap"
   if b['id'] in carved:
    from building_passages import passage_digest
    specs=[{k_:q[k_] for k_ in ('road','start','end','left','right','ceiling','ceilingEnd')} for q in over['passages'] if q['building']==b['id']];done=b.get('buildingPassage') or {}
    assert not done.get('highway') or done.get('digest')==passage_digest(specs),f"{b['id']} was carved for other passages; rebuild from the baseline"
 assert seen==set(mesh),'every building over the highway must be in its tile'
 # the two carriageways of a road at one height where they run alongside each other (build): a deck station whose twin's deck
 # stands more than TWIN_STEP over it with only a median between the two pavements is one the stage lists as left apart. (The
 # records lie where the curb survey put them, highway_roadways.py, a few metres from the lines the stage paired: half of
 # TWIN_MEDIAN is surely a median, and the twin's height is read within 2 m along its grade of the point the stage read.)
 level=0
 for pair in (record.get('twins') or {}).get('pairs',[]):
  listed=defaultdict(list);chains=[[x for _,x in sorted(routes[k],key=lambda q:q[0])] for k in pair['roads']]
  for e in pair['apart']:listed[e['road']].append(e['stations'])
  for mine,theirs in (chains,chains[::-1]):
   others=[x for x in theirs if not x.get('tunnel')];lines=[LineString(x['points']) for x in others]
   if not others:continue
   tree_=STRtree(lines)
   for r in mine:
    if r.get('tunnel'):continue
    pts=shapely.points(r['points']);t=I.tangents(r['points'])
    for i,j in zip(*tree_.query_nearest(pts,all_matches=False)):
     o=others[int(j)];line=lines[int(j)];s=line.project(pts[int(i)]);along=stations(o['points']);k=min(len(along)-1,max(1,int(np.searchsorted(along,s,'right'))));a,b=o['points'][k-1],o['points'][k];l=math.dist(a,b) or 1
     if not .5<s<line.length-.5 or abs((b[0]-a[0])*t[int(i)][0]+(b[1]-a[1])*t[int(i)][1])/l<PARALLEL:continue
     if line.distance(pts[int(i)])-(r['deckWidths'][int(i)]+float(np.interp(s,along,o['deckWidths'])))/2>TWIN_MEDIAN/2:continue
     level+=1;low=float(np.interp(s,along,o['elevations']))-r['elevations'][int(i)];slack=.02+2*abs(o['elevations'][k]-o['elevations'][k-1])/l
     assert low<=TWIN_STEP+slack or any(lo-2<=int(i)<=hi+2 for lo,hi in listed[r['id']]),f"{r['id']} lies {low:.2f} m under its twin {o['id']} at {r['points'][int(i)]} with only a median between them"
 # the surveyed roadways (highway_roadways.py): no pavement steps along a route, every paved roadway a surface over ground set under its deck
 surveyed=HR.check({base:[x for _,x in sorted(parts,key=lambda q:q[0])] for base,parts in routes.items()},(record.get('roadways') or {}).get('aprons',[]),{r['id']:r for r in decks},ground)
 # the medians (highway_roadways.part): no two carriageways of a road with their pavements in each other, and between those of a railed road
 # (every one but the parkway, whose decks are paved to their curbs and carry no barrier) the median barrier's footprint and room for both inner lanes
 chain=lambda k:[x for _,x in sorted(routes[k],key=lambda q:q[0])];parted={tuple(m['roads']):m for m in (record.get('roadways') or {}).get('medians',[])};listed=defaultdict(list);twins=[]
 for a,b in (pair['roads'] for pair in (record.get('twins') or {}).get('pairs',[])):
  rails=not any((r.get('highway') or r['bridge']['id'])=='storrow' for r in chain(a)+chain(b));twins.append((chain(a),chain(b),rails))
  assert rails==((a,b) in parted),f'the median between {a} and {b} must be listed as parted exactly when the road is railed'
 for m in parted.values():
  for v in m['parted'].values():
   for e in v['tight']:listed[e['road']].append(e['stations'])
 surveyed={**surveyed,**HR.median_check(twins,listed)}
 return {**surveyed,'decks':len(decks),'tunnels':len(tunnels),'routes':len(routes),'twinStations':level,'joins':joins,'streetLandings':landings,'streetsOverTunnels':under,'signs':len(sidecar['signs']),'meshBuildings':len(mesh),'passages':len(over['passages']),'removedBuildings':len(gone)}


def routes_of(road,record):
 """The route (plan id) a stage record belongs to."""
 import re
 m=re.fullmatch(r'(.*?)-(\d+)',road['id']);return m.group(1) if m and m.group(1) in record['routes'] else road['id']


def stage_records(data_dir,city):
 """The stage's records in the package: its decks among city.roads, then the tunnel records of its sidecar."""
 side=data_dir/SIDECAR;return [r for r in city['roads'] if r.get('bridge',{}).get('kind')==KIND]+(json.loads(side.read_text())['roads'] if side.exists() else [])


def package_ground(data_dir,city):
 """The graded terrain of the package: ground(x, z)."""
 from north_overpasses import load_grid
 grid=city['elevation'];return I.Terrain(grid,load_grid(data_dir/grid['file']))


def open_stretches(data_dir,city,records=None,ground=None):
 """The stretches of the stage's records that run in the open at or under the ground: (points, widths) arrays.
 A deck more than 1.5 m over the ground is a viaduct the streets pass beneath, and a roofed stretch lies under them."""
 ground=ground or package_ground(data_dir,city);records=stage_records(data_dir,city) if records is None else records;out=[]
 for r in records:
  p=np.asarray(r['points'],float);y=r['elevations'];w=np.asarray(r.get('deckWidths') or [r['width']]*len(p),float);s=stations(r['points'])
  covered=(r.get('tunnel') or {}).get('covered',[])
  keep=[not any(a-.01<=s[i]<=b+.01 for a,b in covered) and (bool(r.get('tunnel')) or y[i]-ground(float(p[i,0]),float(p[i,1]))<=1.5) for i in range(len(p))]
  out+=[(r,a,b) for a,b in runs(keep) if b>a]
 return out


def roadway_edges(data_dir,city):
 """Both pavement edges of the stage's records where they run in the open at or under the ground, as lines.
 build-street-surfaces.py measures a street's roadway up to them as it does up to a surveyed curb: the survey
 has no curb between Back Street and Storrow Drive, whose lanes the street's roadway otherwise takes in."""
 return [line for r,a,b in open_stretches(data_dir,city) for line in edge_lines(r,a,b)]


def edge_points(r):
 """The left and the right pavement edge of a record: a point of each at every station."""
 p=np.asarray(r['points'],float);w=np.asarray(r.get('deckWidths') or [r['width']]*len(p),float);t=np.asarray(I.tangents(r['points']));normal=np.stack([-t[:,1],t[:,0]],1)
 return [p+normal*(sign*w[:,None]/2) for sign in (1,-1)]


def edge_lines(r,a,b):
 """Those edges between the record's stations a and b, as lines."""
 return [LineString(side[a:b+1]) for side in edge_points(r)]


def on_street(records,streets,ground):
 """Where a record of the stage lies on a street instead of beside it: [{'vertex', 'streets', 'stations', 'lips',
 'carried'}], one entry for each vertex on which the stage's road ends at a street's surface (a ramp's landing, or
 the end of Storrow Drive on the street that carries it on), with the indices of its streets in `streets` and {index
 of a record: its stations there}.

 roadway_edges hands both pavement edges of every open stretch to build-street-surfaces.py as curbs, which is right
 beside a highway and wrong for the street a ramp ends on: layer 8 lands a ramp on the vertex of its street, so near
 that vertex the ramp's pavement is the street's own, the survey has no curb between the two, and where the ramp
 merges at a small angle its edges lie inside the street's roadway for tens of metres. Measured to them, 13 of the 86
 streets a record of the stage ends on were under 5 m wide at their narrowest and six at the measuring floor of 2.4 m
 (Frontage Road at the South Station exit, Cambridge Street at the Allston entrance, Congress Street between the
 Exit 135 landings, the Haul Road where D Street's ramp merges), a gap in the curbs beyond such a station was bridged
 from it (clean_side: the Haul Road tapered to the ramp over 33 m), the sidewalk band of such a street was drawn
 along the ramp's edge, in the asphalt, and its crosswalk stopped at the ramp.

 A record lies on a street from their common vertex on for as long as both of these hold, station by station:
 - it is flush with the ground, with nothing of its own between its lanes and the street's: a tunnel record inside a
   `surfaceLandings` interval (landing_interval: the runtime keeps the ground whole over it and builds no wall), a deck
   within STREET_FLUSH of the terrain (the runtime rails a deck that stands higher). An open cut is a slot in the
   street and a deck that has left the ground is a structure beside it: their edges bound the street, however close
   to its centre line they lie (the Dartmouth Street entrance beyond its 12 m landing, the Haul Road entrance's slot
   2.8 m from the street's line);
 - its pavement overlaps the street's own roadway: its centre line runs within half the street's class width and half
   its own width of the street's line (the measure pavement_reach lands a ramp by). A ramp that has drawn clear of
   that runs beside the street on lanes of its own, and bounds it there as any highway does, also where the survey
   shows no curb between the two (the South Station exit shares 150 m of roadway with Frontage Road, the Allston
   entrance 130 m with Cambridge Street).
 The walk carries on through the records that share an end with the one it is on (a ramp is cut at every gore and
 level change), and along the street through the records that carry it on (a street is cut at every junction:
 University Road's piece between the Storrow Drive ramps and Bay State Road is 6 m long): the streets of a vertex
 are those that hold it, with those that hold an end of one of them which the walk comes within that same reach of.
 A street vertex is matched on its source line too (`sourcePoints`: build-street-surfaces.py moves a few centre
 lines).

 A vertex the road carries on through (through) is no landing. There the street is the one that leaves or joins
 (Charlesgate off Storrow Drive East, and onto the Bowker entrance): the pavement is the road's, the street has no
 roadway of its own until it has drawn clear of the road's lanes, and its record is the wedge between the road's
 edge and its own curb, which comes to a point where the two part. Measured through the road instead, such a street
 took the carriageway whole and laid its sidewalk band along the median beyond it.

 `lips` lists the stations ([record, station, record and station beyond]) at which the walk ended because the record
 stops being flush: the mouth of a slot or the foot of a structure, which a ray along the landing would enter
 between the record's two edges (the Dartmouth Street entrance's 12 m landing leads straight into its cut).

 `carried` lists the streets that only carry the road on: one that ends on the vertex in line with every record that
 ends there (within THROUGH). Such a street lies wholly beyond the vertex, where the road's edges cannot reach into
 its roadway; its rays meet them at the seam alone, on the ends of the two edges, and there they are the street's own
 edge wherever the survey shows no curb: the pavement is one across the seam (landing_edges keeps them for it as a
 last resort). Airport Way begins that way at the Logan hotel exit, with no curb in reach across the mouth of Hotel
 Drive for 15 m, and with the ramp's edges simply left out a 43 m2 hole opened in that junction's asphalt."""
 vertex=lambda p:(round(p[0],3),round(p[1],3));held=defaultdict(list);at=defaultdict(list);flush={};widths={};lines={}
 for j,s in enumerate(streets):
  for v in sorted({vertex(p) for p in list(s['points'])+list(s.get('sourcePoints') or [])}):held[v].append(j)
 for q,r in enumerate(records):
  for i,p in enumerate(r['points']):at[vertex(p)].append((q,i))
 def level(q):
  if q not in flush:
   r=records[q];p=r['points'];widths[q]=r.get('deckWidths') or [r['width']]*len(p)
   if r.get('tunnel'):s=stations(p);landed=r['tunnel'].get('surfaceLandings',[]);flush[q]=[any(a-.01<=s[i]<=b+.01 for a,b in landed) for i in range(len(p))]
   else:flush[q]=[abs(r['elevations'][i]-ground(float(p[i][0]),float(p[i][1])))<=STREET_FLUSH for i in range(len(p))]
  return flush[q]
 def line(j):
  if j not in lines:lines[j]=LineString(streets[j]['points'])
  return lines[j]
 out=[]
 for v in sorted(set(held)&set(at)):
  start=[step for step in at[v] if level(step[0])[step[1]]]
  if not start or through(records,at[v]):continue
  on=set(held[v]);seen=set(start);queue=list(start);taken=defaultdict(set);lips=[]
  while queue:
   q,i=queue.pop(0);p=records[q]['points'][i];point=Point(p);half=widths[q][i]/2
   if not any(line(j).distance(point)<streets[j]['width']/2+half for j in sorted(on)):continue
   taken[q].add(i)
   for j in sorted(on):
    for e in (streets[j]['points'][0],streets[j]['points'][-1]):
     if math.dist(p,e)<streets[j]['width']/2+half:on|=set(held[vertex(e)])
   for step in [(q,i-1),(q,i+1)]+at[vertex(p)]:
    if not 0<=step[1]<len(records[step[0]]['points']) or step==(q,i):continue
    if not level(step[0])[step[1]]:lips.append([q,i,*step])
    elif step not in seen:seen.add(step);queue.append(step)
  arms=[];carried=[]
  for q,i in at[v]:
   if i in taken.get(q,()):t=I.tangents(records[q]['points'])[i];arms.append(t if i==0 else (-t[0],-t[1]))   # from the vertex along the record
  for j in sorted(held[v]):
   p=streets[j]['points'];first,last=vertex(p[0])==v,vertex(p[-1])==v
   if first==last or any(vertex(x)==v for x in p[1:-1]):continue
   # (its direction over its first 5 m from the vertex: a source vertex can lie a few centimetres from the end)
   end=line(j).interpolate(min(5.,line(j).length) if first else max(0.,line(j).length-5.));a=(end.x-v[0],end.y-v[1]);l=math.hypot(*a) or 1
   if arms and all((t[0]*a[0]+t[1]*a[1])/l<=-THROUGH for t in arms):carried.append(j)
  out.append({'vertex':list(v),'streets':sorted(on),'stations':{q:sorted(k) for q,k in sorted(taken.items())},'lips':sorted(lips),'carried':carried})
 return out


def through(records,steps):
 """Whether the stage's road carries on through a vertex: the vertex lies inside a record, or a record ends there and
 another starts there in line with it (within THROUGH: two pieces of one route). Two ramps that end on one street
 vertex, or one that ends where another starts off at an angle (the Storrow Drive ramps at University Road), do not."""
 ends=[];starts=[]
 for q,i in steps:
  n=len(records[q]['points'])
  if 0<i<n-1:return True
  (starts if i==0 else ends).append(I.tangents(records[q]['points'])[i])
 return any(a[0]*b[0]+a[1]*b[1]>=THROUGH for a in ends for b in starts)


def street_edges(data_dir,city,streets):
 """roadway_edges for the measuring of `streets` (the surface roads, as build-street-surfaces.py measures them): the
 same pavement edges, cut where a record stops lying on a street (landing_edges)."""
 return landing_edges(stage_records(data_dir,city),streets,package_ground(data_dir,city))


def landing_edges(records,streets,ground):
 """The pavement edges of the records' open stretches as curb lines for `streets`: (lines, skip, last, summary), with
 {index of a street: the indices of the lines that are no curb for it} (`skip`), the same for the lines that are one
 only where its ray meets nothing else (`last`), and a summary for the provenance. A piece of an edge is no curb for
 the streets its record lies on (on_street) between two stations that both lie on them; for a street that only
 carries the record on it is the last resort (`carried`); for every other street it bounds the roadway as before.
 Where a landing ends because the record leaves the ground in the open, the line across its pavement there is one
 more curb, for every street: the lip of the slot, or the foot of the structure."""
 found=on_street(records,streets,ground);free=defaultdict(set);resort=defaultdict(set)
 for entry in found:
  for q,rows in entry['stations'].items():
   for i in rows:
    if i+1 in rows:free[(q,i)]|=set(entry['streets'])-set(entry['carried']);resort[(q,i)]|=set(entry['carried'])
 index={id(r):q for q,r in enumerate(records)};lines=[];skip=defaultdict(set);last=defaultdict(set);length=0.;stretches=open_stretches(None,None,records,ground)
 for r,a,b in stretches:
  # (a street two landings reach is free of an edge if either frees it)
  q=index[id(r)];sets=[(frozenset(free.get((q,i),())),frozenset(resort.get((q,i),set())-free.get((q,i),set()))) for i in range(a,b)];i=0
  while i<len(sets):
   k=i
   while k+1<len(sets) and sets[k+1]==sets[i]:k+=1
   for j in sorted(sets[i][0]):skip[j]|={len(lines),len(lines)+1}
   for j in sorted(sets[i][1]):last[j]|={len(lines),len(lines)+1}
   if sets[i][0] or sets[i][1]:length+=sum(math.dist(r['points'][m],r['points'][m+1]) for m in range(a+i,a+k+1))
   lines+=edge_lines(r,a+i,a+k+1);i=k+1
 # (a lip closes what a freed edge opens: a landing of a single station frees none, and its lip would lie across the street's own vertex)
 vertex=lambda q,i:(round(records[q]['points'][i][0],3),round(records[q]['points'][i][1],3));freed={vertex(q,k) for q,i in list(free)+list(resort) for k in (i,i+1)}
 in_the_open={(index[id(r)],i) for r,a,b in stretches for i in range(a,b+1)};lips=sorted({(q,i) for entry in found for q,i,q2,i2 in entry['lips'] if (q2,i2) in in_the_open and vertex(q,i) in freed})
 for q,i in lips:
  left,right=edge_points(records[q]);lines.append(LineString([left[i],right[i]]))
 return lines,dict(skip),dict(last),{'landings':len(found),'streets':len(skip),'carried':len(last),'metres':round(length),'lips':len(lips)}


def open_roads(data_dir,city):
 """Those stretches as roads (`points`, `width`), for the stages that ask what a curb or a curb face belongs to."""
 return [{'id':r['id'],'points':r['points'][a:b+1],'width':r['width']} for r,a,b in open_stretches(data_dir,city)]


def central_artery(data_dir,city):
 """The Central Artery tunnel roads, which the Turnpike's ramps start and end on."""
 return json.loads((data_dir/city['tunnels']['file']).read_text())['roads']


class TileBuildings:
 """The buildings of the package tiles. buildings(bounds) lists those of every tile a box touches: id, tile, ordinal,
 name, base, height, `hull` (the stored convex footprint) and `outline()`, the plan the shell covers (roof_outline;
 the hull where a shell has no roof faces; for a shell already carved for this stage the outline kept with it, so
 a rerun routes the roads under the building as the first run did). footprints(bounds) gives the rings the terrain cut protects: the outline
 where one was asked for (a building near a road of the stage), the hull elsewhere. without(ids) is the same
 package less the buildings the stage removes."""
 def __init__(self,data_dir,city,drop=(),shared=None):
  self.dir=data_dir/city['tiles']['directory'];self.size=city['tiles']['size'];self.keys=set(city['tiles']['keys']);self.drop=set(drop)
  self.shared=shared or {'tiles':{},'outlines':{},'latest':[None,None]}
 def without(self,ids):
  other=TileBuildings.__new__(TileBuildings);other.dir,other.size,other.keys,other.shared=self.dir,self.size,self.keys,self.shared;other.drop=self.drop|set(ids);return other
 def outline(self,k,ordinal,hull,kept=None):
  outlines,latest=self.shared['outlines'],self.shared['latest']
  if (k,ordinal) not in outlines:
   import tileformat
   if kept is not None:shape=from_rings(kept)   # a shell building_passages.py has carved for this stage keeps the outline it had
   else:
    if latest[0]!=k:latest[0]=k;latest[1]=tileformat.read_tile(self.dir/f't_{k}.bin')[1]
    b=latest[1][ordinal];shape=roof_outline(b['positions'],b['roof'])
   outlines[(k,ordinal)]=hull if shape.is_empty else shape
  return outlines[(k,ordinal)]
 def tile(self,k):
  import gzip,struct
  tiles=self.shared['tiles']
  if k not in tiles:
   raw=gzip.decompress((self.dir/f't_{k}.bin').read_bytes());n=struct.unpack_from('<I',raw,4)[0];tiles[k]=[]
   for ordinal,b in enumerate(json.loads(raw[8:8+n])['buildings']):
    if len(b.get('footprint') or [])>=3 and not b.get('structure'):
     hull=Polygon(b['footprint']).buffer(0)
     if not hull.is_empty:tiles[k].append({'id':b['id'],'tile':k,'ordinal':ordinal,'name':b.get('name') or '','hull':hull,'footprint':b['footprint'],'outline':(lambda k=k,ordinal=ordinal,hull=hull,kept=(b.get('buildingPassage') or {}).get('outline'):self.outline(k,ordinal,hull,kept)),'base':b.get('baseElevation',0.0),'height':b.get('height',0.0)})
  return tiles[k]
 def each(self,bounds):
  for tx in range(math.floor(bounds[0]/self.size),math.floor(bounds[2]/self.size)+1):
   for tz in range(math.floor(bounds[1]/self.size),math.floor(bounds[3]/self.size)+1):
    k=f'{tx}_{tz}'
    if k in self.keys:
     for b in self.tile(k):
      if b['id'] not in self.drop:yield b
 def __call__(self,bounds):return [b for b in self.each(bounds) if b['height']>=.5]
 def footprints(self,bounds):
  out=[];outlines=self.shared['outlines']
  for b in self.each(bounds):
   shape=outlines.get((b['tile'],b['ordinal']))
   if shape is None:out.append(b['footprint'])
   else:out+=[list(g.exterior.coords) for g in getattr(shape,'geoms',[shape]) if g.geom_type=='Polygon' and not g.is_empty]
  return out


def tile_buildings(data_dir,city):return TileBuildings(data_dir,city)


def tile_header(data_dir,city,key):
 import gzip,struct
 raw=gzip.decompress((data_dir/city['tiles']['directory']/f't_{key}.bin').read_bytes());return json.loads(raw[8:8+struct.unpack_from('<I',raw,4)[0]])


def buildings_over(plans,ground,known=()):
 """What the buildings standing over the stage's roads need. A tunnel stretch under a building whose base leaves
 the roof slab room needs nothing. Otherwise:
 - `removed`: a structure under SHED metres, or one lying mostly inside the roadway, with a part over a pavement
   that the road does not pass under: a bridge's slab or a toll canopy the survey stores as a building. `known`
   are those an earlier run removed, whose tiles no longer hold them;
 - `passages`: a building over a stretch still too high under it for the roof slab (a ramp near its street):
   the corridor of that stretch (start, end and the offsets left and right of that chord) and the ceiling over
   the road at both ends, for building_passages.py to carve out of the shell;
 - `mesh`: a building whose stored convex footprint reaches over a pavement where its hull collider would stand
   in the road (an open stretch or a deck, or a covered one whose roof slab lies over the collider's bottom)."""
 removed={r['id']:r for r in known};conflicts=defaultdict(dict);info={};by={p.id:p for p in plans}
 for plan in plans:
  need=plan.clearance+ROOF
  for i,built in enumerate(plan.built):
   for j in built:
    b=plan.buildings[j]
    if building_relation(plan,i,b) is None:conflicts[b['id']].setdefault(plan.id,[]).append(i);info[b['id']]=b
 passages=[]
 for k in sorted(conflicts):
  b=info[k];roadway=shapely.union_all([by[q].line.buffer(max(by[q].widths)/2) for q in conflicts[k]])
  if b['height']<SHED or b['shape'].intersection(roadway).area>=.5*b['shape'].area:
   removed[k]={'id':k,'tile':b['tile'],'name':b['name'],'roads':sorted(conflicts[k])};continue
  for q in sorted(conflicts[k]):
   plan=by[q];rows=conflicts[k][q];n=len(plan.points);need=plan.clearance+ROOF+.25;spans=[[rows[0],rows[0]]]
   for i in rows[1:]:
    if i-spans[-1][1]<=3:spans[-1][1]=i
    else:spans.append([i,i])
   for a,c in spans:
    a,c=max(0,a-1),min(n-1,c+1)
    if c==a:continue
    pts=np.asarray(plan.points[a:c+1],float);start,end=pts[0],pts[-1];length=float(np.hypot(*(end-start)))
    if length<1:continue
    along=(end-start)/length;across=np.array([along[1],-along[0]]);off=(pts-start)@across;s=(pts-start)@along;half=np.asarray(plan.widths[a:c+1])/2+1.0
    h=np.asarray(plan.y[a:c+1])+need;slope=float(h[-1]-h[0])/length;c0=float(np.max(h-slope*s));start,end=start-along*2,end+along*2
    passages.append({'building':k,'tile':b['tile'],'name':b['name'],'road':q,'start':[round(float(v),3) for v in start],'end':[round(float(v),3) for v in end],
     'left':round(float(np.min(off-half)),3),'right':round(float(np.max(off+half)),3),'ceiling':round(c0-2*slope,3),'ceilingEnd':round(c0+slope*(length+2),3)})
 mesh={}
 for plan in plans:
  need=plan.clearance+ROOF;pts=shapely.points(plan.points);half=np.asarray(plan.widths)/2
  for b in plan.hulls:
   if b['id'] in removed:continue
   rows=np.flatnonzero(shapely.distance(b['hull'],pts)<=half).tolist()
   if not rows:continue
   if 'bottom' not in b:
    ring=b['hull'].exterior;b['bottom']=min([b['base'],*(ground(q.x,q.y) for q in (ring.interpolate(d) for d in np.arange(0,ring.length,4.0).tolist()))])-.5
   if any((not plan.covered[i]) or plan.y[i]+need>b['bottom'] for i in rows):mesh.setdefault(b['id'],{'id':b['id'],'tile':b['tile'],'roads':set()})['roads'].add(plan.id)
 return {'removed':[removed[k] for k in sorted(removed)],'passages':passages,'mesh':[{**mesh[k],'roads':sorted(mesh[k]['roads'])} for k in sorted(mesh)]}


def write_sidecar(data_dir,city,source,tunnel_records,signs=()):
 """The tunnel sidecar the runtime loads beside the Central Artery's: the stage's tunnel records and its signs.
 city.tunnels.files lists every sidecar; `file` stays the Central Artery's for the scripts that read it."""
 out={'version':1,'roads':tunnel_records,'landmarks':[],'signs':list(signs),
  'sources':[{'name':'Boston GIS street centerlines (layer 8): Massachusetts Turnpike, Storrow Drive and their ramps; estimated profiles','url':source['url'],'license':source['license']},
   {'name':'OpenStreetMap: the Turnpike inside Brookline, Storrow Drive lane counts and posted clearances','url':source['osm']['url'],'license':source['osm']['license']}],
  'provenance':{'profiles':f'Estimated elevations under the graded terrain; {CLEARANCE} m playable clearance ({STORROW_CLEARANCE} m in the Storrow Drive tunnel), no civil-engineering vertical survey claim'}}
 (data_dir/SIDECAR).write_text(json.dumps(out,separators=(',',':'))+'\n')
 tunnels=city['tunnels'];tunnels['files']=[tunnels['file']]+[f for f in tunnels.get('files',[]) if f not in (tunnels['file'],SIDECAR)]+[SIDECAR]
