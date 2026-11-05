"""Small, evidence-backed source reconciliations applied during generation.

Generic geometry cannot infer whether an unmatched curb outlines a lawn or
asphalt, or whether a level-zero source seam is a real landing. Keep those
decisions in a dated input with explicit bounds; fail if its topology changes.
"""
import copy,hashlib,json,math,pathlib
import shapely
from shapely.geometry import LineString,Point,Polygon
from shapely.ops import unary_union
from road_connections import share_deck_section,stations

SOURCE=pathlib.Path(__file__).resolve().parents[1]/'public/data/sullivan-square-source.json'
PROFILE_FIELDS=('points','elevations','startLevel','endLevel','deckWidths','deckTangents')


def source_inputs():return json.loads(SOURCE.read_text())
def source_hash():return hashlib.sha256(SOURCE.read_bytes()).hexdigest()


def reviewed_profiles(roads,ground,source=None):
 """Return before/after fields; never mutate input or move a true landing.

 Only complete, directed degree-two deck chains explicitly reviewed in the
 source are eligible. A changed junction or new road at an internal join requires
 another review instead of inheriting the old correction silently.
 """
 from land_approaches import taut
 source=source if source is not None else source_inputs();by={r['id']:r for r in roads};changes=[]
 for entry in source['bridgeChains']:
  present=[id in by for id in entry['roads']]
  if not any(present):continue
  assert all(present),f"{entry['id']}: reviewed chain is incomplete"
  chain=[copy.deepcopy(by[id]) for id in entry['roads']];ids=set(entry['roads'])
  assert all(r.get('elevations') and not r.get('tunnel') and r.get('bridge',{}).get('kind')=='elevated' for r in chain),f"{entry['id']}: expected generic bridge decks"
  assert all(math.dist(p,q)<.01 for p,q in zip(entry['landings'],[chain[0]['points'][0],chain[-1]['points'][-1]])),f"{entry['id']}: landings moved"
  for a,b in zip(chain,chain[1:]):
   p=a['points'][-1]
   assert p==b['points'][0],f"{entry['id']}: disconnected source pieces"
   assert not any(r['id'] not in ids and LineString(r['points']).distance(Point(p))<.1 for r in roads),f"{entry['id']}: new road at reviewed internal join"
  if entry.get('straight'):
   a,b=entry['landings'];axis=[b[k]-a[k] for k in (0,1)];length2=sum(v*v for v in axis)
   for r in chain:
    aligned=[]
    for p in r['points']:
     t=round(sum((p[k]-a[k])*axis[k] for k in (0,1))/length2,6)
     q=[round(a[k]+t*axis[k],6) for k in (0,1)]
     assert 0<=t<=1 and math.dist(p,q)<=entry['maxPlanShift'],f"{entry['id']}: alignment exceeds reviewed bounds"
     aligned.append(q)
    assert all(sum((q[k]-p[k])*axis[k] for k in (0,1))>0 for p,q in zip(aligned,aligned[1:])),f"{entry['id']}: alignment reverses"
    r['points']=aligned
  points=chain[0]['points']+[p for r in chain[1:] for p in r['points'][1:]];along=stations(points);length=along[-1]
  first,last=chain[0]['elevations'][0],chain[-1]['elevations'][-1]
  values=[max(first+(last-first)*d/length,ground(*p)+.05*min(1,d/8,(length-d)/8)) for p,d in zip(points,along)]
  assert abs(values[0]-first)<.001 and abs(values[-1]-last)<.001,f"{entry['id']}: terrain no longer meets the landing"
  values=[round(y,4) for y in taut(along,values)]
  assert all(abs(b-a)<=entry['maxGrade']*(v-u)+.0002 for a,b,u,v in zip(values,values[1:],along,along[1:])),f"{entry['id']}: reviewed span no longer fits its grade limit"
  cursor=0
  for i,r in enumerate(chain):
   n=len(r['points']);r['elevations']=values[cursor:cursor+n];cursor+=n-1
   if i:r['startLevel']=1
   if i<len(chain)-1:r['endLevel']=1
  for a,b in zip(chain,chain[1:]):share_deck_section(a,-1,b,0)
  if entry.get('straight'):
   for r in chain:
    r['deckWidths']=[entry['width']]*len(r['points'])
    r['deckTangents']={'start':axis,'end':axis}
  for r in chain:
   old={k:copy.deepcopy(by[r['id']].get(k)) for k in PROFILE_FIELDS};new={k:r.get(k) for k in PROFILE_FIELDS}
   if old!=new:changes.append({'road':r['id'],'chain':entry['id'],'source':old,'result':new})
 return changes


def install_fields(road,fields):
 for key,value in fields.items():
  if value is None:road.pop(key,None)
  else:road[key]=copy.deepcopy(value)


def restore_street_sources(headers):
 """Undo only generated row replacements, including splits and deletions."""
 restore_parking_sources(headers)
 for tile in headers.values():
  for field,changes in tile.pop('reviewedStreetSources',{}).items():
   for index,count,original in reversed(changes):tile[field][index:index+count]=[original]


def reviewed_streets(headers,roads,source=None):
 """Resolve reviewed curb/centerline disagreements before mesh compilation.

 One joined corridor supplies every section, including municipal and tile
 boundaries. Only obsolete survey pieces inside that corridor are removed.
 Keep changed source rows so rebuilding or removing the input is reversible.
 """
 import numpy as np
 from street_surfaces import encode_edges,line_parts
 from street_meshes import strip,encoded_polygons
 from shapely.geometry import box
 source=source if source is not None else source_inputs();by={r['id']:r for r in roads};sections={};shapes=[]
 restore_street_sources(headers)
 for entry in source.get('streetCorridors',[]):
  present=[id in by for id in entry['roads']]
  if not any(present):continue
  assert all(present),f"{entry['id']}: reviewed street is incomplete"
  chain=[by[id] for id in entry['roads']]
  assert all(not r.get('elevations') and not r.get('tunnel') for r in chain),f"{entry['id']}: expected surface street"
  assert [chain[0]['points'][0],chain[-1]['points'][-1]]==entry['landings'],f"{entry['id']}: street landings moved"
  assert all(a['points'][-1]==b['points'][0] for a,b in zip(chain,chain[1:])),f"{entry['id']}: disconnected street"
  points=np.asarray(chain[0]['points']+[p for r in chain[1:] for p in r['points'][1:]],float)
  directions=np.diff(points,axis=0);directions/=np.linalg.norm(directions,axis=1)[:,None]
  tangent=np.vstack([directions[0],directions[:-1]+directions[1:],directions[-1]])
  tangent/=np.linalg.norm(tangent,axis=1)[:,None];normal=np.column_stack([-tangent[:,1],tangent[:,0]])
  left=points+normal*entry['width']/2;right=points-normal*entry['width']/2;cursor=0
  for r in chain:
   n=len(r['points']);sections[r['id']]=(left[cursor:cursor+n],right[cursor:cursor+n]);cursor+=n-1;r['pavedWidth']=entry['width']
  shapes.append(strip(left,right))
 corridor=unary_union(shapes);changed=[]
 for key,tile in headers.items():
  size=tile['size'];x=tile['tx']*size;z=tile['tz']*size
  if not corridor.intersects(box(x,z,x+size,z+size)):continue
  # Fail instead of paving through a newly introduced building.
  assert not any(corridor.intersection(Polygon(b['footprint']).buffer(-.1)).area>.1 for b in tile['buildings'] if not b.get('structure')),f'{key}: reviewed street intersects a building'
  saved={}
  for field in ('pavements','borderPavements','curbs','sidewalks','islands'):
   out=[];changes=[]
   for item in tile[field]:
    replacement=[item]
    if field in ('pavements','borderPavements'):
     if item['road'] in sections:
      l,r=sections[item['road']];replacement=[{**item,'edges':encode_edges(l,r,tile['tx'],tile['tz'],size)}]
    elif field=='curbs':
     line=LineString(item)
     if line.intersects(corridor.buffer(-.15)):
      replacement=[[[round(x,3),round(z,3)] for x,z in part.coords] for part in line_parts(line.difference(corridor.buffer(-.15))) if part.length>=.5]
    else:
     rings=item['rings'] if field=='sidewalks' else item;polygon=Polygon(rings[0],rings[1:])
     if polygon.intersection(corridor).area>.0001:
      replacement=[{**item,'rings':r} if field=='sidewalks' else r for r in encoded_polygons(polygon.difference(corridor))]
    if replacement!=[item]:changes.append([len(out),len(replacement),item])
    out.extend(replacement)
   tile[field]=out
   if changes:saved[field]=changes
  if saved:tile['reviewedStreetSources']=saved;changed.append(key)
 return changed


def restore_parking_sources(headers):
 """Parking borders are applied last and must be removed before source replay."""
 for tile in headers.values():
  for field,record in tile.pop('reviewedParkingSources',{}).items():
   if record['added']:tile[field]=tile[field][:-record['added']]
   for index,count,original in reversed(record['rows']):tile[field][index:index+count]=[original]


def reviewed_parking_edges(headers,source=None):
 """Inset an even sidewalk band around each reviewed lot, with open entrances.

 The outer edge yields to the compiled carriageway; its inward offset keeps
 the whole sidewalk outside traffic lanes. Curb both sides of the band, break
 both curbs at access aisles, and cut the asphalt below the sidewalk. Store
 changed source rows and appended counts so regeneration never compounds it.
 """
 from street_meshes import encoded_polygons,parts
 from street_surfaces import clip_line,line_parts
 from shapely.geometry import box
 source=source if source is not None else source_inputs();entries=source.get('parkingSidewalks',[])
 if not entries:return []
 road=unary_union([Polygon(r[0],r[1:]) for t in headers.values() for r in t['streetPavement']])
 outlines=[];walks=[];curbs=[];paving=[];access=[];zones=[]
 for entry in entries:
  width=entry['width'];lot=Polygon(entry['ring']);assert lot.is_valid and width>0,'invalid reviewed parking perimeter'
  outer=shapely.set_precision(lot.buffer(width/2,join_style=2).difference(road.buffer(.08)),.001)
  # Replace nearby obsolete sidewalk flares on this side of the roadway only.
  zone=lot.buffer(width/2+entry.get('replaceMargin',0),join_style=2).difference(road.buffer(.08))
  zones.extend(p for p in parts(zone) if p.intersection(lot).area>1)
  inner=outer.buffer(-width,join_style=2);assert not inner.is_empty,'parking sidewalk consumes its lot'
  gates=unary_union([LineString(e['points']).buffer(e['width']/2) for e in entry['entrances']])
  access.append(gates)
  walk=outer.difference(inner).difference(gates);outlines.append(outer);walks.append(walk);paving.append(outer.difference(walk))
  curbs.extend(line_parts(outer.boundary.difference(gates)));curbs.extend(line_parts(inner.boundary.difference(gates)))
 outline=unary_union(outlines);walk=shapely.set_precision(unary_union(walks),.001);access=unary_union(access)
 edit_area=unary_union(zones).union(access)
 legacy=[]
 for t in headers.values():
  for rings in [*[w['rings'] for w in t['sidewalks']],*t['islands'],*t['streetSidewalks']]:
   polygon=Polygon(rings[0],rings[1:])
   if polygon.intersects(edit_area):legacy.append(polygon.intersection(edit_area))
 paving=shapely.set_precision(unary_union([*paving,*legacy,access]).difference(walk),.001);changed=[]
 for key,tile in headers.items():
  size=tile['size'];x=tile['tx']*size;z=tile['tz']*size;area=box(x,z,x+size,z+size)
  if not edit_area.intersects(area):continue
  assert not any(edit_area.intersection(Polygon(b['footprint']).buffer(-.1)).area>.1 for b in tile['buildings'] if not b.get('structure')),f'{key}: parking border intersects a building'
  saved={}
  for field in ('sidewalks','islands','curbs','driveways','streetSidewalks'):
   out=[];rows=[]
   for item in tile[field]:
    replacement=[item]
    if field=='curbs':
     line=LineString(item)
     if line.intersects(edit_area):replacement=[[[round(x,3),round(z,3)] for x,z in part.coords] for part in line_parts(line.difference(edit_area)) if part.length>=.5]
    else:
     rings=item['rings'] if field=='sidewalks' else item;polygon=Polygon(rings[0],rings[1:]);cut=walk if field=='driveways' else edit_area
     if polygon.intersection(cut).area>.0001:replacement=[{**item,'rings':r} if field=='sidewalks' else r for r in encoded_polygons(polygon.difference(cut))]
    if replacement!=[item]:rows.append([len(out),len(replacement),item])
    out.extend(replacement)
   additions=[]
   if field=='sidewalks':additions=[{'rings':r} for r in encoded_polygons(walk.intersection(area))]
   elif field=='curbs':additions=[p for line in curbs for p in clip_line(line.coords,area)]
   elif field=='driveways':
    existing=shapely.set_precision(unary_union([Polygon(r[0],r[1:]) for r in out]),.001)
    additions=encoded_polygons(shapely.difference(paving.intersection(area),existing,grid_size=.001))
   tile[field]=out+additions
   if rows or additions:saved[field]={'rows':rows,'added':len(additions)}
  if saved:tile['reviewedParkingSources']=saved;changed.append(key)
 return changed


def reviewed_pavement(headers,source=None):
 """Add reviewed paved envelopes, clipped around the retained survey objects.

 Keep the generated additions at the end of the driveway list, with their
 count as generation metadata. Rebuild that tail from original coverage on
 every run, so serializing/unioning it again cannot accumulate rounding drift.
 """
 from street_meshes import encoded_polygons
 from shapely.geometry import box
 source=source if source is not None else source_inputs();shapes=[Polygon(a['ring']) for a in source['pavedAreas']]
 assert all(p.is_valid and p.area>0 for p in shapes),'invalid reviewed pavement input'
 reviewed=unary_union(shapes);changed=[]
 for key,tile in headers.items():
  previous=tile.pop('reviewedDrivewayParts',0)
  assert 0<=previous<=len(tile['driveways']),'invalid reviewed driveway generation metadata'
  if previous:tile['driveways']=tile['driveways'][:-previous]
  size=tile['size'];x=tile['tx']*size;z=tile['tz']*size;area=box(x,z,x+size,z+size)
  if not reviewed.intersects(area):continue
  patch=reviewed.intersection(area)
  blockers=[Polygon(w['rings'][0],w['rings'][1:]).buffer(0) for w in tile['sidewalks']]
  blockers += [Polygon(r[0],r[1:]).buffer(0) for r in tile['islands']]
  blockers += [Polygon(b['footprint']).buffer(0) for b in tile['buildings'] if not b.get('structure')]
  # Only emit missing asphalt. Original surveyed/OSM geometry remains intact.
  patch=shapely.set_precision(patch.difference(unary_union(blockers)),.001)
  original=unary_union([Polygon(r[0],r[1:]).buffer(0) for r in tile['driveways']])
  additions=encoded_polygons(shapely.difference(patch,shapely.set_precision(original,.001),grid_size=.001))
  tile['driveways'].extend(additions);tile['reviewedDrivewayParts']=len(additions);changed.append(key)
 return changed
