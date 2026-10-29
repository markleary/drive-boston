"""Shared Harvard Bridge cross-sections and its continuous Boston approach.

The generic compiler lifts each source endpoint above the bare-earth DEM.
Those estimates cannot describe one bridge across the shoreline: a land-side
endpoint can be higher than the adjacent basin deck and create a false crest.
Keep the surveyed horizontal alignment and grounded street landing, then grade
the complete Boston approach to the retained flat basin deck in one operation.
"""
import math

HARVARD_BRIDGE_ROADS=['15082-0-0','11255-0-0','14557-0-1','water-link-14557-0-0','14557-0-0','osm-29328400-0','osm-1329523286-0','osm-961263635-0']

def ordered_sections(roads):
 by_id={r['id']:r for r in roads};points=[];sections=[]
 for n,id in enumerate(HARVARD_BRIDGE_ROADS):
  r=by_id[id];reverse=n==0 or math.dist(r['points'][-1],points[-1])<.02
  indexes=list(range(len(r['points'])));indexes=indexes[::-1] if reverse else indexes
  if points and math.dist(r['points'][indexes[0]],points[-1])>.002:raise ValueError(f'Harvard Bridge source join moved at {id}')
  start=len(points)-1 if points else 0
  for i in indexes:
   p=r['points'][i]
   if not points or math.dist(points[-1],p)>.001:points.append(p)
  end=len(points)-1
  if end-start+1!=len(r['points']):raise ValueError(f'Harvard Bridge has duplicate source points in {id}')
  sections.append((r,reverse,start,end))
 return points,sections

def approach_profile(points,sections):
 """Boston street landing through the three shore sections to the basin."""
 end=sections[2][3];distances=[0]
 for a,b in zip(points[:end],points[1:end+1]):distances.append(distances[-1]+math.dist(a,b))
 landing=sections[0][0]['elevations'][-1]
 basin,reverse,_,_=sections[3];deck=basin['elevations'][-1 if reverse else 0]
 return distances,[landing+(deck-landing)*d/distances[-1] for d in distances]

def harmonize_harvard(roads):
 """Share deck sections and use one straight Boston ramp across source pieces."""
 points,sections=ordered_sections(roads)
 _,profile=approach_profile(points,sections)
 for n,(r,reverse,start,end) in enumerate(sections):
  continuation=r.get('deckTangents',{}).get('end') if n==len(sections)-1 else None
  r['width']=16;r.pop('deckWidths',None);r.pop('deckTangents',None)
  if n==0:
   lengths=[0]
   for a,b in zip(r['points'],r['points'][1:]):lengths.append(lengths[-1]+math.dist(a,b))
   r['deckWidths']=[round(16-6*(d/lengths[-1])**2*(3-2*d/lengths[-1]),5) for d in lengths]
  if n<3:
   values=profile[start:end+1];r['elevations']=[round(y,4) for y in (values[::-1] if reverse else values)]
  tangents=[]
  for i in [start,end]:
   a,b=points[max(0,i-1)],points[min(len(points)-1,i+1)];t=[round((b[k]-a[k])*(-1 if reverse else 1),6) for k in [0,1]];tangents.append(t)
  r['deckTangents']={'start':tangents[1] if reverse else tangents[0],'end':tangents[0] if reverse else tangents[1]}
  if continuation:r['deckTangents']['end']=continuation

def validate_harvard_profile(roads):
 """Reject regenerated Boston crests/dips rather than silently shipping them."""
 points,sections=ordered_sections(roads);_,profile=approach_profile(points,sections)
 for r,reverse,start,end in sections[:3]:
  values=r['elevations'][::-1] if reverse else r['elevations']
  assert all(abs(y-expected)<=.000051 for y,expected in zip(values,profile[start:end+1])),f"{r['id']} must share Harvard Bridge's straight Boston approach; run restore-water-crossings.py"
