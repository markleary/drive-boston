"""Connected Harvard/Memorial interchange profile on retained OSM alignments.

Bare-earth elevations describe Memorial Drive's underpass, not Massachusetts
Avenue above it. Keep the river deck through that junction, then grade the
whole approach network to its existing outer street landings. These heights
are game estimates; no source horizontal alignment or lower road is moved.
"""
import math

UPPER_IDS=['osm-961263635-0','osm-826552799-0','osm-961263634-0','osm-379698390-0','osm-86792411-0','osm-1267768719-0','osm-1267768720-0','osm-1264680796-0','osm-1271019443-0','osm-1417967613-0','osm-1264679770-0','osm-1264679769-0','osm-1321779880-0']
SLIP_IDS=['osm-8616015-0','osm-8616018-0','osm-188046759-0','osm-1417967612-0']
CONNECTOR_ID='osm-27778682-0'
SOURCE_OVERPASSES={'osm-86792411-0','osm-1267768719-0','osm-1267768720-0'}

def resample(road):
 """Keep all original vertices; stable spacing also makes reruns idempotent."""
 points=[]
 for a,b in zip(road['points'],road['points'][1:]):
  count=max(1,math.ceil(math.dist(a,b)/3.001))
  points.extend([[round(a[k]+(b[k]-a[k])*j/count,3) for k in [0,1]] for j in range(count)])
 return points+[road['points'][-1]]

def repair_cambridge(roads,ground):
 by_id={r['id']:r for r in roads}
 # Anchors come from the retained river deck and the ground street at Amherst.
 # The northern ramp starts after both Memorial carriageways, not at a source
 # way boundary over the underpass. A common height function joins both forks.
 deck=by_id['osm-1329523286-0']['elevations'][-1]
 landing=by_id['osm-1321779880-0']['points'][-1];landing_y=ground(landing)
 ramp_z=by_id['osm-1417967613-0']['points'][-1][1]
 def upper(p):
  t=max(0,min(1,(p[1]-ramp_z)/(landing[1]-ramp_z)))
  return deck+(landing_y-deck)*t
 nodes={}
 def install(road,points,values,start,end,source_layer=None):
  road.pop('deckWidths',None)
  road['points']=points;road['elevations']=[round(y,4) for y in values]
  road['startLevel']=start;road['endLevel']=end
  road['bridge']={'id':'harvard-memorial-approach','thickness':.45,'clearanceEstimated':True,'kind':'connected-approach'}
  if source_layer is not None:road['bridge']['sourceLayer']=source_layer
 for id in UPPER_IDS:
  r=by_id[id];points=resample(r)
  install(r,points,[upper(p) for p in points],1,0 if id=='osm-1321779880-0' else 1,1 if id in SOURCE_OVERPASSES else None)
  for p in [points[0],points[-1]]:nodes[tuple(p)]=upper(p)
 for id in SLIP_IDS+[CONNECTOR_ID]:
  r=by_id[id];points=resample(r);levels=[1 if tuple(p) in nodes else 0 for p in [points[0],points[-1]]]
  ends=[nodes.get(tuple(p),ground(p)) for p in [points[0],points[-1]]]
  lengths=[0]
  for a,b in zip(points,points[1:]):lengths.append(lengths[-1]+math.dist(a,b))
  # Source width=30.5 on one-lane MassGIS-imported slips describes much more
  # than the individual carriageway. Match the compiler's lane-aware fallback.
  r['width']=5
  install(r,points,[ends[0]+(ends[1]-ends[0])*(d/lengths[-1])**2*(3-2*d/lengths[-1]) for d in lengths],*levels)
  if id in SLIP_IDS:
   # A turning vehicle needs a flared junction mouth, while the long ramp
   # remains one lane. Without it the parapet's square tip clips the turn.
   r['deckWidths']=[round(5+4*max(0,1-min(d if levels[0] else math.inf,lengths[-1]-d if levels[1] else math.inf)/20),5) for d in lengths]
 # Degree-two deck joins share one full-width end section, avoiding triangular
 # slivers even where two short OSM ways meet at a bend.
 joins={}
 for id in UPPER_IDS+SLIP_IDS+[CONNECTOR_ID]:
  r=by_id[id];r.pop('deckTangents',None)
  for i in [0,-1]:joins.setdefault(tuple(r['points'][i]),[]).append((r,i))
 for shared in joins.values():
  if len(shared)!=2 or shared[0][0]['width']!=shared[1][0]['width']:continue
  (a,ai),(b,bi)=shared;pa=a['points'][1 if ai==0 else -2];pb=b['points'][1 if bi==0 else -2]
  tangent=[round(pb[k]-pa[k],6) for k in [0,1]]
  for r,i,sign in [(a,ai,-1 if ai==0 else 1),(b,bi,1 if bi==0 else -1)]:
   r.setdefault('deckTangents',{})['start' if i==0 else 'end']=[v*sign for v in tangent]
 # The two one-way halves at a fork must open across the complete unsplit
 # carriageway. Constant-width ribbons otherwise narrow from 16 to 7.6 m at
 # their shared node and leave parapet ends across the outer through lanes.
 for shared in joins.values():
  mains=[(r,i) for r,i in shared if r['name']=='Massachusetts Avenue']
  if len(mains)!=3:continue
  wide,_=max(mains,key=lambda v:v[0]['width'])
  if wide['width']<15:continue
  for r,i in mains:
   if r is wide:continue
   distances=[0]
   for a,b in zip(r['points'],r['points'][1:]):distances.append(distances[-1]+math.dist(a,b))
   total=distances[-1];r['deckWidths']=[round(r['width']+(wide['width']-r['width'])*max(0,1-(d if i==0 else total-d)/min(15,total)),5) for d in distances]
   # Each branch retains its own direction through this planar overlap. A
   # forced parent tangent folds the inside triangle on the short curved fork.
 return UPPER_IDS+SLIP_IDS+[CONNECTOR_ID]

def validate_cambridge(roads,ground):
 by_id={r['id']:r for r in roads};selected=[by_id[id] for id in UPPER_IDS+SLIP_IDS+[CONNECTOR_ID]]
 nodes={}
 for r in selected:
  assert r.get('elevations'),f"Missing Cambridge approach profile: {r['id']}"
  for i in [0,-1]:
   p=r['points'][i];y=r['elevations'][i];key=tuple(p)
   if key in nodes:assert abs(y-nodes[key])<.0002,f"Cambridge approach height step: {r['id']}"
   nodes[key]=y
   if r['startLevel' if i==0 else 'endLevel']==0:assert abs(y-ground(p))<.006,f"Cambridge landing leaves terrain: {r['id']}"
  for a,b,ya,yb in zip(r['points'],r['points'][1:],r['elevations'],r['elevations'][1:]):
   assert abs(yb-ya)<=math.dist(a,b)*.065+.0002,f"Excessive Cambridge approach grade: {r['id']}"
 for id in SLIP_IDS:assert by_id[id]['width']==5,f"One-lane Memorial slip widened again: {id}"
 deck=by_id['osm-1329523286-0']['elevations'][-1]
 for id in SOURCE_OVERPASSES|{'osm-961263635-0'}:
  assert all(abs(y-deck)<.0002 for y in by_id[id]['elevations']),f"Cambridge overpass collapsed into bare-earth underpass: {id}"
