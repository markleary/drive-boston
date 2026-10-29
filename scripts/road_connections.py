"""Join estimated decks where Boston GIS and OSM split the same road.

The town boundary clips the two sources at one horizontal point, but their
level fields mean different things. Boston's F/T_ZLEV lifts a wet bridge end;
OSM's relative layer does not. A horizontal snap alone therefore left a 6.4 m
step in BU Bridge and several Muddy River crossings. Reconcile only an
unambiguous degree-two, same-name continuation, never a coincident crossing.
The retained Boston deck is the shared datum; the town approach reaches its
existing outer landing. These are estimated game profiles, not survey heights.
"""
import math
from collections import defaultdict

CONNECTION_KIND='connected-source-approach'


def resample(points):
 """Retain source vertices and use stable spacing on repeated compilation."""
 result=[]
 for a,b in zip(points,points[1:]):
  count=max(1,math.ceil(math.dist(a,b)/3.001))
  result.extend([[round(a[k]+(b[k]-a[k])*j/count,3) for k in (0,1)] for j in range(count)])
 return result+[points[-1]]


def stations(points):
 result=[0]
 for a,b in zip(points,points[1:]):result.append(result[-1]+math.dist(a,b))
 return result


def share_deck_section(a,ai,b,bi):
 """Match the tangent and width at a degree-two join, with a tapered approach."""
 pa=a['points'][1 if ai==0 else -2];pb=b['points'][1 if bi==0 else -2]
 tangent=[round(pb[k]-pa[k],6) for k in (0,1)]
 for road,index,sign in [(a,ai,-1 if ai==0 else 1),(b,bi,1 if bi==0 else -1)]:
  road.setdefault('deckTangents',{})['start' if index==0 else 'end']=[v*sign for v in tangent]
 widths=a.get('deckWidths');width=widths[ai] if widths else a['width']
 distances=stations(b['points']);total=distances[-1]
 b['deckWidths']=[round(width+(b['width']-width)*(d/total if bi==0 else 1-d/total),5) for d in distances]


def source_connections(roads):
 ends=defaultdict(list)
 for road in roads:
  for i in (0,-1):ends[tuple(road['points'][i])].append((road,i))
 for shared in ends.values():
  if len(shared)!=2:continue
  boston=[v for v in shared if not v[0]['id'].startswith(('osm-','water-link-'))]
  town=[v for v in shared if v[0]['id'].startswith('osm-')]
  if len(boston)!=1 or len(town)!=1:continue
  (a,ai),(b,bi)=boston[0],town[0]
  if a['name']!=b['name'] or a['name'].startswith('Unnamed') or not a.get('elevations'):continue
  if a.get('startLevel' if ai==0 else 'endLevel')!=1:continue
  def away(road,i):
   p=road['points'][i];q=road['points'][1 if i==0 else -2];length=math.dist(p,q)
   return [(q[k]-p[k])/length for k in (0,1)] if length else (0,0)
  av,bv=away(a,ai),away(b,bi)
  if sum(x*y for x,y in zip(av,bv))>-.8:continue
  yield a,ai,b,bi


def repair_source_connections(roads,ground):
 """Repair only identified source seams; retain all other profile topology."""
 repaired=[]
 for a,ai,b,bi in source_connections(roads):
  deck=a['elevations'][ai]
  existing=b['elevations'][bi] if b.get('elevations') else ground(b['points'][bi])
  owned=b.get('bridge',{}).get('kind')==CONNECTION_KIND
  if not owned and deck-existing<.2:continue
  other=-1 if bi==0 else 0
  outer=b['elevations'][other] if b.get('elevations') else ground(b['points'][other])
  outer_level=b.get('endLevel' if bi==0 else 'startLevel',0)
  # Use the graded terrain when the far end is an ordinary street landing.
  # Recompute owned profiles too, so a subsequent datum correction propagates.
  if outer_level==0:outer=ground(b['points'][other])
  points=resample(b['points']);distances=stations(points);total=distances[-1]
  first,last=(deck,outer) if bi==0 else (outer,deck)
  b['points']=points;b['elevations']=[round(first+(last-first)*d/total,4) for d in distances]
  b['startLevel'],b['endLevel']=(1,outer_level) if bi==0 else (outer_level,1)
  bridge=dict(b.get('bridge',{}));bridge.update({'id':f"source-connection-{b['id']}",'kind':CONNECTION_KIND,'thickness':bridge.get('thickness',.45),'clearanceEstimated':True})
  b['bridge']=bridge
  share_deck_section(a,ai,b,bi)
  repaired.append({'sourceRoad':a['id'],'approachRoad':b['id'],'point':a['points'][ai]})
 return repaired


def validate_source_connections(roads,ground):
 """A compiler gate for these continuations, without flattening crossings."""
 for a,ai,b,bi in source_connections(roads):
  height=b['elevations'][bi] if b.get('elevations') else ground(b['points'][bi])
  assert abs(a['elevations'][ai]-height)<.2,f"Unreconciled mixed-source deck step: {a['id']} / {b['id']}"
  if b.get('bridge',{}).get('kind')!=CONNECTION_KIND:continue
  assert abs(a['elevations'][ai]-b['elevations'][bi])<.0002,f"Mixed-source deck step: {a['id']} / {b['id']}"
  outer=-1 if bi==0 else 0
  if b.get('endLevel' if bi==0 else 'startLevel')==0:
   assert abs(b['elevations'][outer]-ground(b['points'][outer]))<.006,f"Mixed-source approach leaves terrain: {b['id']}"
  width=a.get('deckWidths',[a['width']]*len(a['points']))[ai]
  assert abs(width-b['deckWidths'][bi])<.00001,f"Mixed-source deck width step: {b['id']}"
  for p,q,yp,yq in zip(b['points'],b['points'][1:],b['elevations'],b['elevations'][1:]):
   assert abs(yq-yp)<=math.dist(p,q)*.12+.0002,f"Excessive boundary approach grade: {b['id']}"
