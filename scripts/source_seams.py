"""Reconnect clipped GIS/OSM continuations, with source geometry as evidence.

Only mutually nearest dangling endpoints of the same named street qualify.
Both bearings and one-way flow must agree, and the missing corridor must lie
on the original, unclipped OSM way. A nearby crossing or parallel carriageway
is never enough evidence to join roads.
"""
import copy,math,re
from collections import Counter,defaultdict
from shapely.geometry import LineString,Point
from shapely.ops import substring,unary_union
from shapely.prepared import prep
from shapely.strtree import STRtree

MAX_GAP=50
ALIGNMENT=.95


# ---- one street carried by both sources
COPY_REACH=3.0    # two sources' lines of one street lie this close all along (half a carriageway); two roadways never do
COPY_ALIGNED=.9   # ...and run the same way there (cosine): a street crossing another lies within reach of it too
COPY_STEP=2.0     # stations at which that is checked
COPY_MIN=2*COPY_REACH/math.sqrt(1-COPY_ALIGNED**2)   # a shorter piece can cross a line at a slant and pass both tests (13.8 m)


def boston_segment(road):
 """A Boston GIS street segment (build-metro.py: `<OBJECTID>-<path>-<piece>`), not a town's OpenStreetMap way or a road a later stage built."""
 return re.fullmatch(r'\d+-\d+-\d+',road['id']) is not None


def source_copies(roads):
 """Records of a street that both sources carry, and the road list without them.

 build-metro.py clips each town's OpenStreetMap ways to the town outline less a 4 m strip of Boston, so that a
 boundary street is drawn once. Where the two outlines disagree by more than the strip the street arrives twice:
 Saint Mary's Street, the line between Boston and Brookline, was Boston's segments and six pieces of Brookline's
 ways on one roadway on both sides of the Turnpike bridge: two records for traffic, lane paint, street names and
 GPS, and the town's 12.2 m curb outline drawn round Boston's surveyed 8 m roadway.
 A surface record that lies within COPY_REACH of the other source's surface lines all along its own length, runs
 their way there (COPY_ALIGNED, at stations COPY_STEP apart) and is at least COPY_MIN long (a shorter piece can
 cross them at a slant inside the reach) is the copy:
 - first the town records that lie along Boston segments (where both lie along each other all along, Boston's
   record stays: the survey curbs are its street's);
 - then the Boston segments that lie along the town records still there (the stub of a town street that the
   segments carry into the town: Thornton Road, Saint Paul's Avenue), but for the segments a town record was
   found to copy.
 A copy leaves only when every road that meets it still meets a record it copies: a vertex another road shares must
 be a vertex of one of those records. Otherwise it is held back and reported, and both records stay (the package
 has none; such a street first needs its junction moved onto the record that stays).
 Records with heights or in a tunnel are neither copies nor references here: a second source's copy of a bridge
 belongs to the stage that levels the bridge (boston_highways.bridge_copies).
 Returns (the roads without the copies, [{index, road, of}] with each copy's place in `roads`, [{road, of,
 vertices}] held back)."""
 surface=[k for k,r in enumerate(roads) if not (r.get('elevations') or r.get('tunnel')) and len(r['points'])>=2]
 lines={k:LineString(r.get('sourcePoints') or r['points']) for k,r in ((k,roads[k]) for k in surface)}
 key=lambda p:(round(p[0],2),round(p[1],2));at=defaultdict(set);copies={};held=[]
 for k,r in enumerate(roads):
  for p in r['points']:at[key(p)].add(k)
 def heading(line,d):
  # (the chord over the reach each way: a way's end was snapped up to 10 m onto the segment's end, which kinks its last metre)
  a=line.interpolate(max(0,d-COPY_REACH));b=line.interpolate(min(line.length,d+COPY_REACH));length=math.hypot(b.x-a.x,b.y-a.y) or 1;return (b.x-a.x)/length,(b.y-a.y)/length
 def along(k,others,tree):
  """The records of `others` that road k lies along all along (the nearest one running its way at each station), or None."""
  own=lines[k]
  if own.length<COPY_MIN:return None
  near=[j for j in sorted({others[int(i)] for i in tree.query(own.buffer(COPY_REACH))}) if lines[j].distance(own)<=COPY_REACH]
  if not near or not unary_union([lines[j] for j in near]).buffer(COPY_REACH).covers(own):return None
  nearest=[];n=max(1,math.ceil(own.length/COPY_STEP))
  for s in range(n+1):
   d=own.length*s/n;p=own.interpolate(d);t=heading(own,d);gaps={}
   for j in near:
    gap=lines[j].distance(p)
    if gap>COPY_REACH:continue
    w=heading(lines[j],lines[j].project(p))
    if abs(t[0]*w[0]+t[1]*w[1])>=COPY_ALIGNED:gaps[j]=gap
   if not gaps:return None
   nearest.append({j for j,gap in gaps.items() if gap<=min(gaps.values())+.01})
  # At a node two records are equally near: the one the road lies along elsewhere is the one it copies there.
  used={j for tied in nearest if len(tied)==1 for j in tied}
  for tied in nearest:
   if not tied&used:used.add(min(tied))
  return sorted(used)
 def take(group,others):
  """Take the copies among `group` out; returns the records of `others` that one of them, taken or held, lies along."""
  if not group or not others:return set()
  tree=STRtree([lines[j] for j in others]);found={}
  for k in group:
   ref=along(k,others,tree)
   if ref is not None:found[k]=ref
  copied={j for ref in found.values() for j in ref}
  # A copy another road would be left hanging from stays, and then counts as a road meeting its neighbours.
  while True:
   loose={}
   for k,ref in found.items():
    stays={key(p) for j in ref for p in roads[j]['points']}
    hanging=[list(p) for p in roads[k]['points'] if key(p) not in stays and at[key(p)]-set(found)-set(copies)-{k}]
    if hanging:loose[k]=hanging
   if not loose:break
   for k in sorted(loose):held.append({'road':roads[k]['id'],'of':sorted(roads[j]['id'] for j in found.pop(k)),'vertices':loose[k]})
  for k in sorted(found):copies[k]={'index':k,'road':copy.deepcopy(roads[k]),'of':sorted(roads[j]['id'] for j in found[k])}
  return copied
 town=[k for k in surface if roads[k]['id'].startswith('osm-')];boston=[k for k in surface if boston_segment(roads[k])]
 copied=take(town,boston)
 take([k for k in boston if k not in copied],[k for k in town if k not in copies])
 return [r for k,r in enumerate(roads) if k not in copies],[copies[k] for k in sorted(copies)],held


def restore_source_copies(roads,record):
 """Put the copies an earlier run took out (`record`, provenance.sourceCopies) back at their places in `roads`,
 in place, so a rerun starts from the same list. Returns their ids."""
 removed=(record or {}).get('removed',[])
 for item in removed:roads.insert(item['index'],copy.deepcopy(item['road']))   # (in rising order, each back at its own place)
 return [item['road']['id'] for item in removed]


def seam_candidates(roads,sources):
 vertices=Counter((round(p[0],1),round(p[1],1)) for r in roads for p in r['points'])
 ends=[]
 for r in roads:
  if r.get('tunnel') or r['name'].startswith('Unnamed'):continue
  for i in (0,-1):
   p=r['points'][i]
   if vertices[(round(p[0],1),round(p[1],1))]!=1:continue
   q=r['points'][1 if i==0 else -2];length=math.dist(p,q)
   if length:ends.append((r,i,p,[(p[k]-q[k])/length for k in (0,1)]))
 tree=STRtree([Point(e[2]) for e in ends]);best={};pairs={}
 for j,(r,i,p,t) in enumerate(ends):
  for k in tree.query(Point(p).buffer(MAX_GAP)):
   k=int(k)
   if k<=j:continue
   s,ii,q,tt=ends[k];osm=r['id'].startswith('osm-');other_osm=s['id'].startswith('osm-')
   if osm==other_osm or r['name']!=s['name']:continue
   d=math.dist(p,q)
   if not .1<d<=MAX_GAP:continue
   direction=[(q[a]-p[a])/d for a in (0,1)]
   if sum(a*b for a,b in zip(t,direction))<ALIGNMENT or -sum(a*b for a,b in zip(tt,direction))<ALIGNMENT:continue
   flow=r.get('oneway',0)*(1 if i==-1 else -1);other_flow=s.get('oneway',0)*(1 if ii==-1 else -1)
   if bool(flow)!=bool(other_flow) or (flow and flow==other_flow):continue
   if bool(r.get('elevations'))!=bool(s.get('elevations')):continue
   town=r if osm else s;source=sources.get(town['id'].split('-')[1])
   if source is None or not source.buffer(6).covers(LineString([p,q])):continue
   pair=(j,k);pairs[pair]=(d,r,i,s,ii)
   for a,b in ((j,k),(k,j)):
    if a not in best or (d,b)<best[a]:best[a]=(d,b)
 return [pairs[(a,b)] for a,b in sorted(pairs) if best[a][1]==b and best[b][1]==a]


def connect_source_seams(roads,sources,ground):
 links=[]
 for distance,a,ai,b,bi in seam_candidates(roads,sources):
  # Keep original road coordinates/ownership; one explicitly generated segment
  # bridges the omitted source interval, so both original endpoints remain pins.
  p=a['points'][ai];q=b['points'][bi];n=max(1,math.ceil(distance/2))
  points=[[round(p[k]+(q[k]-p[k])*i/n,3) for k in (0,1)] for i in range(n+1)]
  points[0]=list(p);points[-1]=list(q)
  flow=a.get('oneway',0)*(1 if ai==-1 else -1)
  link={'id':f"source-seam-{a['id']}-{b['id']}",'name':a['name'],'points':points,'width':min(a['width'],b['width']),'oneway':flow,'sourceSeam':{'roads':[a['id'],b['id']],'gap':round(distance,3)}}
  if a.get('elevations'):
   start=a['elevations'][ai];end=b['elevations'][bi]
   ys=[round(start+(end-start)*i/n,4) for i in range(n+1)]
   # A source-confirmed horizontal gap with an impossible vertical profile
   # needs a connected approach design, not an invented cliff.
   if abs(end-start)>distance*.12 or any(ground(*p)>y+.1 for p,y in zip(points,ys)):continue
   wa=(a.get('deckWidths') or [a['width']]*len(a['points']))[ai];wb=(b.get('deckWidths') or [b['width']]*len(b['points']))[bi]
   link.update(elevations=ys,startLevel=a.get('startLevel' if ai==0 else 'endLevel',0),endLevel=b.get('startLevel' if bi==0 else 'endLevel',0),bridge={'id':link['id'],'kind':'source-boundary-link','thickness':.45,'clearanceEstimated':True},deckWidths=[round(wa+(wb-wa)*i/n,4) for i in range(n+1)])
   for parent,pi,li in ((a,ai,0),(b,bi,-1)):
    before=parent['points'][1 if pi==0 else -2];after=link['points'][1 if li==0 else -2];tangent=[round(after[k]-before[k],6) for k in (0,1)]
    parent.setdefault('deckTangents',{})['start' if pi==0 else 'end']=[v*(-1 if pi==0 else 1) for v in tangent]
    link.setdefault('deckTangents',{})['start' if li==0 else 'end']=[v*(1 if li==0 else -1) for v in tangent]
  links.append(link)
 roads.extend(links)
 return links



# ---- water spans the district clipping dropped
SPAN_COVER=1.5    # a source way this close to a package road is drawn there
SPAN_OVERLAP=6    # ...but only by a road running along it this far (a road crossing beneath does not count)
SPAN_SNAP=2.5     # a dropped stretch starts at a dangling road end this close to where the cover stops
SPAN_REACH=400    # longest crossing restored (the Wellington Bridge carriageways are 190 m)
SPAN_WET=.3       # share of a crossing over mapped water (3 m margin) that makes it a water crossing
SPAN_STEP=3       # deck stations, as build-metro.py samples its decks


def label(tags):
 kind=tags['highway'];return tags.get('name') or ('Unnamed lane' if kind=='living_street' else f"Unnamed {kind.replace('_link',' ramp').replace('_',' ')}")


def clipped_spans(roads,sources,districts,water):
 """Water crossings of source ways that the district clipping dropped.

 The MassGIS town outlines stop at the shores of the tidal rivers, so a way
 crossing the Malden or Mystic River between two towns (the Revere Beach
 Parkway's Woods Memorial Bridge, the Fellsway's Wellington Bridge) or inside
 one (the Mystic Valley Parkway over the Mystic, Medford Street over the
 Malden) is clipped to its two banks and loses the span between them. A
 stretch of a source way counts as dropped where no road runs along it for
 SPAN_OVERLAP and at least half of it lies outside every district. Each end
 of a stretch is a dangling road end within SPAN_SNAP along the way, or a
 source junction shared with other dropped stretches. Stretches joined that
 way form a crossing when they make one path between two road ends no longer
 than SPAN_REACH with at least SPAN_WET of it over mapped water; a group with
 an open end (a way leaving the package, a junction inside a road) is left
 out. `sources` maps an OSM way id to (LineString, tags). Returns [(path,
 terminals)]: path lists (way, tags, points, forward) from the first terminal
 to the second, points in source order with the terminal ends exact, and
 terminals holds the two (road, index) ends joined."""
 vertices=Counter((round(p[0],1),round(p[1],1)) for r in roads for p in r['points'])
 ends=[(r,i) for r in roads for i in (0,-1) if vertices[(round(r['points'][i][0],1),round(r['points'][i][1],1))]==1]
 end_tree=STRtree([Point(r['points'][i]) for r,i in ends]);lines=[LineString(r['points']) for r in roads];tree=STRtree(lines)
 interior=prep(districts.buffer(-.5));wet_zone=water.buffer(3);parts=[]
 for way,(line,tags) in sorted(sources.items()):
  if interior.contains(line):continue
  near=[j for j in tree.query(line.buffer(SPAN_COVER)) if roads[j]['id'].startswith(f'osm-{way}-') or lines[j].buffer(SPAN_COVER).intersection(line).length>=SPAN_OVERLAP]
  rest=line.difference(unary_union([lines[j].buffer(SPAN_COVER) for j in near])) if near else line
  for piece in ([rest] if rest.geom_type=='LineString' else list(getattr(rest,'geoms',[]))):
   if piece.geom_type!='LineString' or piece.length<.5 or piece.difference(districts).length<piece.length*.5:continue
   t=sorted(line.project(Point(p)) for p in (piece.coords[0],piece.coords[-1]));nodes=[]
   for k,toward in ((0,-1),(1,1)):
    if t[k]<.01 or t[k]>line.length-.01:p=line.coords[0] if t[k]<.01 else line.coords[-1];nodes.append(('n',round(p[0],1),round(p[1],1)));continue
    best=None
    for j in end_tree.query(line.interpolate(t[k]).buffer(SPAN_SNAP)):
     r,i=ends[j];p=Point(r['points'][i]);s=line.project(p);gap=(s-t[k])*toward
     if line.distance(p)<.5 and 0<=gap<=SPAN_SNAP and (best is None or gap<best[0]):best=(gap,j,s)
    if best is None:nodes.append(('open',way,k));continue
    t[k]=best[2];nodes.append(('e',best[1]))
   if t[1]-t[0]>=.5:parts.append({'way':way,'tags':tags,'line':line,'t':t,'nodes':nodes})
 by_node=defaultdict(list)
 for n,part in enumerate(parts):
  for node in part['nodes']:by_node[node].append(n)
 seen=set();spans=[]
 for start in range(len(parts)):
  if start in seen:continue
  group=[];stack=[start];seen.add(start)
  while stack:
   n=stack.pop();group.append(n)
   for node in parts[n]['nodes']:
    for m in by_node[node]:
     if m not in seen:seen.add(m);stack.append(m)
  count=Counter(node for n in group for node in parts[n]['nodes']);terminals=sorted((node for node in count if node[0]=='e'),key=lambda node:(ends[node[1]][0]['id'],ends[node[1]][1],ends[node[1]][0]['points'][ends[node[1]][1]]))
  if any(node[0]=='open' or (node[0]=='n' and v!=2) or (node[0]=='e' and v!=1) for node,v in count.items()) or len(terminals)!=2:continue
  if ends[terminals[0][1]][0] is ends[terminals[1][1]][0]:continue
  path=[];node=terminals[0];left=set(group)
  while True:
   n=next((m for m in by_node[node] if m in left),None)
   if n is None:break
   left.discard(n);part=parts[n];forward=part['nodes'][0]==node;coords=[list(p) for p in substring(part['line'],*part['t']).coords]
   for k,end in ((0,part['nodes'][0]),(-1,part['nodes'][1])):
    if end[0]=='e':r,i=ends[end[1]];coords[k]=list(r['points'][i])
   path.append((part['way'],part['tags'],coords,forward));node=part['nodes'][1] if forward else part['nodes'][0]
  length=sum(LineString(c).length for _,_,c,_ in path)
  if left or node!=terminals[1] or length>SPAN_REACH:continue
  if sum(LineString(c).intersection(wet_zone).length for _,_,c,_ in path)<length*SPAN_WET:continue
  spans.append((path,[ends[terminals[0][1]],ends[terminals[1][1]]]))
 return spans


def resample(points,step=SPAN_STEP):
 out=[list(points[0])]
 for a,b in zip(points,points[1:]):
  n=max(1,math.ceil(math.dist(a,b)/step))
  out.extend([round(a[0]+(b[0]-a[0])*j/n,3),round(a[1]+(b[1]-a[1])*j/n,3)] for j in range(1,n+1))
 out[-1]=list(points[-1]);return out


def restore_clipped_spans(roads,sources,districts,water,ground,width_of):
 """Add the dropped water crossings (`clipped_spans`) as deck pieces.

 Each stretch becomes a road of its own way (name, class, width_of(tags) and
 one-way flow from the source tags, in source order) sampled every
 SPAN_STEP, bridge kind `restored-water-span`, lifted where stretches meet.
 A deck road it joins gets its joining end lifted too, so
 level-water-crossings.py, which runs next, levels the bank pieces and the
 span as one chain; a surface road it joins is an at-grade landing. Until
 then heights run straight between the two ends. Each piece carries a
 `clippedSpan` record (the source ways and the terminal ends with their
 original levels) so `unrestore_clipped_spans` can undo it before a rerun.
 Returns the added roads."""
 added=[];names=Counter()
 for path,terminals in clipped_spans(roads,sources,districts,water):
  heights=[r['elevations'][i] if r.get('elevations') else ground(*r['points'][i]) for r,i in terminals]
  levels=[1 if r.get('elevations') else 0 for r,_ in terminals]
  record={'ways':[way for way,_,_,_ in path],'terminals':[{'road':r['id'],'point':list(r['points'][i]),'level':r.get('startLevel' if i==0 else 'endLevel')} for r,i in terminals]}
  total=sum(LineString(c).length for _,_,c,_ in path);along=0
  for k,(way,tags,coords,forward) in enumerate(path):
   points=resample(coords);stations=[0]
   for a,b in zip(points,points[1:]):stations.append(stations[-1]+math.dist(a,b))
   ys=[round(heights[0]+(heights[1]-heights[0])*(along+(d if forward else stations[-1]-d))/total,4) for d in stations];along+=stations[-1]
   # The first terminal begins the path, the second ends it; a stretch walked backwards keeps its source order.
   begin=0 if k==0 else None;finish=1 if k==len(path)-1 else None;first,last=(begin,finish) if forward else (finish,begin)
   names[way]+=1;road_id=f"osm-{way}-span"+(str(names[way]-1) if names[way]>1 else '')
   added.append({'id':road_id,'name':label(tags),'points':points,'width':width_of(tags),'oneway':1 if tags.get('oneway') in ('yes','true','1') else -1 if tags.get('oneway')=='-1' else 0,'kind':tags['highway'],
    'elevations':ys,'startLevel':1 if first is None else levels[first],'endLevel':1 if last is None else levels[last],
    'bridge':{'id':f'source-seam-{road_id}','thickness':.75,'clearanceEstimated':True,'kind':'restored-water-span'},'clippedSpan':record})
  for r,i in terminals:
   if r.get('elevations'):r['startLevel' if i==0 else 'endLevel']=1
 roads.extend(added)
 return added


def unrestore_clipped_spans(roads):
 """Remove restored crossings and put their terminal roads' levels back. Returns the removed ids."""
 spans=[r for r in roads if r.get('clippedSpan')];kept=[r for r in roads if not r.get('clippedSpan')];by_end=defaultdict(list)
 for r in kept:
  for i in (0,-1):by_end[(r['id'],tuple(r['points'][i]))].append((r,i))
 for span in spans:
  for terminal in span['clippedSpan']['terminals']:
   for r,i in by_end[(terminal['road'],tuple(terminal['point']))]:
    key='startLevel' if i==0 else 'endLevel'
    if terminal['level'] is None:r.pop(key,None)
    else:r[key]=terminal['level']
 roads[:]=kept
 return [r['id'] for r in spans]


# ---- streets split at a line between two towns
SEAM_ZONE=20      # a dangling end this close to an edge two town outlines share was clipped there
SEAM_REACH=20     # farthest a clipped street is carried along its source way to the street it meets
SEAM_TOUCH=.35    # a package road this close to the carried way is the street it meets
SEAM_STEP=.25


def town_lines(towns):
 """The edges two town outlines share (each outline's boundary within 5 m of the other town)."""
 names=sorted(towns);lines=[]
 for k,a in enumerate(names):
  for b in names[k+1:]:
   if towns[a].distance(towns[b])>5:continue
   lines+=[g for g in (towns[a].boundary.intersection(towns[b].buffer(5)),towns[b].boundary.intersection(towns[a].buffer(5))) if not g.is_empty]
 return unary_union(lines) if lines else None


def town_seams(roads,sources,towns):
 """Join OpenStreetMap streets that the district clipping split at a line between two towns.

 Each town's ways are clipped to its own outline, neighbouring outlines do not
 share their edges exactly (slivers and overlaps of a few metres) and pieces
 under 3 m are dropped, so a street crossing a town line stops short of its
 continuation, of the street its end node meets, or overlaps the piece across
 the line. A dangling end of a surface OSM road within SEAM_ZONE of a shared
 edge is carried along its own source way (and on along the source ways that
 continue from that way's end node), at most SEAM_REACH in all, to the first
 package road within SEAM_TOUCH of the path: it takes that road's end when the
 path reaches one (the continuation, or the next way of the street) or a
 vertex inserted into it (a junction across the line). Two pieces of one way
 that overlap are both cut back to the middle of the overlap. Roads with
 heights or per-point records are never changed. Each changed road keeps its
 original points in a `townSeam` record so `unrestore_town_seams` can undo the
 join before a rerun. Returns the joins."""
 seams=town_lines(towns)
 if seams is None:return []
 zone=prep(seams.buffer(SEAM_ZONE));key=lambda p:(round(p[0],1),round(p[1],1))
 vertices=Counter(key(p) for r in roads for p in r['points'])
 lines=[LineString(r['points']) for r in roads];tree=STRtree(lines)
 node_ways=defaultdict(list)
 for way_id,way in sources.items():
  for e,c in ((0,way.coords[0]),(1,way.coords[-1])):node_ways[(round(c[0],2),round(c[1],2))].append((way_id,e))
 plain=lambda r:not (r.get('elevations') or r.get('tunnel') or r.get('deckWidths') or r.get('sourcePoints') or r.get('clippedSpan') or r.get('sourceSeam'))
 def keep(r):r.setdefault('townSeam',{'points':[list(p) for p in r['points']]})
 def cut(n,i,m):
  """Trim end i of road n back to point m on its line."""
  r=roads[n];line=lines[n];at=line.project(Point(m));pts=r['points'];keep(r)
  if i==0:r['points']=[[round(m[0],3),round(m[1],3)]]+[p for p in pts if line.project(Point(p))>at+.05]
  else:r['points']=[p for p in pts if line.project(Point(p))<at-.05]+[[round(m[0],3),round(m[1],3)]]
  lines[n]=LineString(r['points'])
 def walk(n,way_id,at,out,budget,path,depth=0):
  """The first package road the source path meets: (road index, distance walked, point, source vertices passed)."""
  way=sources[way_id];limit=min(budget,(way.length-at) if out>0 else at)
  steps=[k*SEAM_STEP for k in range(int(limit/SEAM_STEP)+1)]
  if steps[-1]<limit-1e-9:steps.append(limit)
  for walked in steps:
   q=way.interpolate(at+out*walked)
   near=[int(m) for m in tree.query(q.buffer(SEAM_TOUCH)) if int(m)!=n and lines[int(m)].distance(q)<=SEAM_TOUCH]
   if near:
    passed=[c for c in way.coords if 0.05<out*(way.project(Point(c))-at)<walked-.05];passed.sort(key=lambda c:out*way.project(Point(c)))
    return min(near,key=lambda m:lines[m].distance(q)),budget-limit+(limit-walked),q,path+passed
  if depth>=3 or limit>=budget-1e-9:return None
  # The way ends inside the reach: go on along the ways that leave its end node.
  c=way.coords[-1] if out>0 else way.coords[0];passed=[c2 for c2 in way.coords if 0.05<out*(way.project(Point(c2))-at)<limit-.05];passed.sort(key=lambda c2:out*way.project(Point(c2)))
  for other,e in node_ways[(round(c[0],2),round(c[1],2))]:
   if other==way_id:continue
   found=walk(n,other,0 if e==0 else sources[other].length,1 if e==0 else -1,budget-limit,path+passed+[c],depth+1)
   if found:return found
  return None
 ends=[]
 for n,r in enumerate(roads):
  if not r['id'].startswith('osm-') or not plain(r) or len(r['points'])<2:continue
  way_id=r['id'].split('-')[1];way=sources.get(way_id)
  if way is None:continue
  for i in (0,-1):
   p=r['points'][i]
   if vertices[key(p)]!=1 or not zone.contains(Point(p)) or way.distance(Point(p))>.5:continue
   at=way.project(Point(p));inner=way.project(Point(r['points'][1 if i==0 else -2]))
   if abs(at-inner)>1e-6:ends.append((n,i,way_id,at,1 if at>inner else -1))
 joins=[]
 for n,i,way_id,at,out in ends:
  r=roads[n];p=r['points'][i]
  if vertices[key(p)]!=1:continue
  found=walk(n,way_id,at,out,SEAM_REACH,[])
  if found is None:continue
  m,left,q,passed=found;walked=SEAM_REACH-left;other=roads[m];line=lines[m];points=other['points'];way=sources[way_id]
  near_end=[k for k in (0,-1) if math.dist(points[k],(q.x,q.y))<=SEAM_TOUCH+.3]
  overlap=[k for k in (0,-1) if math.dist(points[k],p)<=SEAM_REACH and lines[n].distance(Point(points[k]))<=SEAM_TOUCH and vertices[key(points[k])]==1] if walked<1e-9 and other['id'].split('-')[1]==way_id and plain(other) else []
  if overlap:
   # Two pieces of one way overlapping across the line: both end at the middle of the overlap.
   f=points[overlap[0]];mid=way.interpolate((way.project(Point(p))+way.project(Point(f)))/2);m2=[mid.x,mid.y]
   cut(n,i,m2);cut(m,overlap[0],m2);meet=roads[n]['points'][i];roads[m]['points'][overlap[0]]=list(meet);lines[m]=LineString(roads[m]['points'])
   vertices[key(meet)]+=2;joins.append({'road':r['id'],'end':'start' if i==0 else 'end','to':other['id'],'kind':'overlap','point':list(meet),'carried':0.0})
   continue
  if near_end:target=list(points[near_end[0]]);kind='continuation'
  else:
   if not plain(other):continue
   t=line.interpolate(line.project(q));s=min(range(len(points)-1),key=lambda k:LineString(points[k:k+2]).distance(t))
   vertex=next((v for v in points if math.dist(v,(t.x,t.y))<.05),None)
   if vertex is None:keep(other);vertex=[round(t.x,3),round(t.y,3)];other['points']=points[:s+1]+[vertex]+points[s+1:];lines[m]=LineString(other['points'])
   target=list(vertex);kind='junction'
  # Follow the source vertices passed between the end and the street it meets.
  between=[[round(c[0],3),round(c[1],3)] for c in passed if math.dist(c,target)>.05 and math.dist(c,p)>.05]
  keep(r)
  if i==0:r['points']=[target]+between[::-1]+r['points']
  else:r['points']=r['points']+between+[target]
  lines[n]=LineString(r['points']);vertices[key(target)]+=1;vertices[key(p)]-=1
  joins.append({'road':r['id'],'end':'start' if i==0 else 'end','to':other['id'],'kind':kind,'point':target,'carried':round(LineString([p]+between+[target]).length,3)})
 return joins


def town_bridge_joints(roads,towns):
 """Carry an OpenStreetMap bridge that the district clipping split at a town line as one deck.

 The ends the clipping makes are ground level to build-metro.py, so where a
 town line crosses a bridge the two deck pieces meet at a joint in mid-span
 that the profile drops to the ground beneath it (Boston Avenue over the
 Mystic River at the Medford/Somerville line dipped 3.3 m to the river).
 Where exactly two deck pieces of one way meet within SEAM_ZONE of an
 edge two town outlines share, both at ground level there and with no other
 road at the joint, the joint is lifted and both pieces take the straight
 line between their outer ends. Each piece keeps its original profile and
 levels in its `townSeam` record. Returns the joints."""
 seams=town_lines(towns)
 if seams is None:return []
 zone=prep(seams.buffer(SEAM_ZONE));key=lambda p:(round(p[0],3),round(p[1],3));count=Counter(key(p) for r in roads for p in r['points']);at=defaultdict(list)
 level=lambda r,i:r.get('startLevel' if i==0 else 'endLevel') or 0
 for r in roads:
  if r['id'].startswith('osm-') and r.get('elevations') and not (r.get('tunnel') or r.get('clippedSpan') or r.get('sourceSeam') or r.get('townSeam')):
   for i in (0,-1):at[key(r['points'][i])].append((r,i))
 joints=[]
 for k in sorted(at):
  pair=at[k]
  if len(pair)!=2 or count[k]!=2:continue
  (a,ai),(b,bi)=pair
  # A piece already carried at its other end keeps that record: one change per piece, so the undo restores the source.
  if a is b or a['id']!=b['id'] or a.get('townSeam') or b.get('townSeam') or level(a,ai) or level(b,bi) or not zone.contains(Point(k)):continue
  # From a's outer end through the joint to b's outer end.
  pa=a['points'] if ai==-1 else a['points'][::-1];pb=b['points'] if bi==0 else b['points'][::-1]
  ea=a['elevations'] if ai==-1 else a['elevations'][::-1];eb=b['elevations'] if bi==0 else b['elevations'][::-1]
  along=[0.0]
  for u,v in zip(pa+pb[1:],(pa+pb[1:])[1:]):along.append(along[-1]+math.dist(u,v))
  if along[-1]<=0:continue
  h=[round(ea[0]+(eb[-1]-ea[0])*d/along[-1],4) for d in along];joint=h[len(pa)-1]
  for r,i,heights in ((a,ai,h[:len(pa)]),(b,bi,h[len(pa)-1:])):
   r['townSeam']={'points':[list(p) for p in r['points']],'elevations':list(r['elevations']),'startLevel':r.get('startLevel'),'endLevel':r.get('endLevel')}
   own=heights if (r is a)==(i==-1) else heights[::-1];r['elevations']=own;r['startLevel' if i==0 else 'endLevel']=1
  joints.append({'road':a['id'],'name':a.get('name',''),'point':list(a['points'][ai]),'joint':joint,'sourceJoint':ea[-1],'outer':[ea[0],eb[-1]],'length':round(along[-1],3)})
 return joints


EDGE_STUB_GRADE=.25  # a deck piece cut at the map edge that averages a steeper grade was cut mid-span
EDGE_STUB_TOUCH=1.0  # an end this close to the edge of the districts was cut there


def edge_bridge_stubs(roads,districts):
 """Hold a bridge that the edge of the map cuts mid-span level from its landing.

 To build-metro.py the end the clipping makes is ground level, so a bridge
 leaving the map over a river climbs to the 6.4 m lift at its last joint inside
 the map and drops to the bank at the edge (High Street over the Mystic at the
 Arlington line: 3.5 m up over 14 m, then 6.3 m down over its 4 m Medford
 Street stub). Where an OpenStreetMap deck piece ends within EDGE_STUB_TOUCH of
 the districts' edge at ground level, no other road there, and averages a
 steeper grade than EDGE_STUB_GRADE, it and the deck pieces joined to it end to
 end through lifted joints back to the bridge's ground landing are held level at
 the landing's height, and the edge end is lifted. Each piece keeps its original
 profile and levels in its `townSeam` record. Returns the bridges."""
 edge=districts.boundary;key=lambda p:(round(p[0],3),round(p[1],3));count=Counter(key(p) for r in roads for p in r['points'])
 level=lambda r,i:r.get('startLevel' if i==0 else 'endLevel') or 0
 decks=[r for r in roads if r['id'].startswith('osm-') and r.get('elevations') and not (r.get('tunnel') or r.get('clippedSpan') or r.get('sourceSeam') or r.get('townSeam'))]
 ends=defaultdict(list)
 for r in decks:
  for i in (0,-1):ends[key(r['points'][i])].append((r,i))
 bridges=[]
 for r in decks:
  for i in (0,-1):
   p=r['points'][i];length=LineString(r['points']).length
   if r.get('townSeam') or count[key(p)]!=1 or level(r,i) or edge.distance(Point(p))>EDGE_STUB_TOUCH or length<=0 or abs(r['elevations'][-1]-r['elevations'][0])/length<=EDGE_STUB_GRADE:continue
   # Inward from the edge: through each lifted joint two deck ends share alone, to a ground landing.
   chain=[(r,i)];cur,entry=r,i
   while chain:
    out=-1 if entry==0 else 0;q=key(cur['points'][out])
    if not level(cur,out):break
    joined=[(o,k) for o,k in ends[q] if o is not cur]
    if len(joined)!=1 or count[q]!=2 or len(chain)>8 or any(o is joined[0][0] for o,_ in chain):chain=[];break
    cur,entry=joined[0];chain.append((cur,entry))
   if not chain or any(o.get('townSeam') for o,_ in chain):continue
   landing=cur['elevations'][out]
   for o,_ in chain:
    o['townSeam']={'points':[list(v) for v in o['points']],'elevations':list(o['elevations']),'startLevel':o.get('startLevel'),'endLevel':o.get('endLevel')};o['elevations']=[landing]*len(o['points'])
   r['startLevel' if i==0 else 'endLevel']=1
   bridges.append({'roads':[o['id'] for o,_ in chain],'names':[o.get('name','') for o,_ in chain],'edge':list(p),'landing':list(cur['points'][out]),'height':landing,'sourceEdge':chain[0][0]['townSeam']['elevations'][i]})
 return bridges


def unrestore_town_seams(roads):
 """Put every road a town seam changed back to its original points (and a
 bridge joint's pieces back to their original profile and levels). Returns their ids."""
 changed=[]
 for r in roads:
  record=r.pop('townSeam',None)
  if not record:continue
  r['points']=record['points'];changed.append(r['id'])
  if 'elevations' in record:
   r['elevations']=record['elevations']
   for field in ('startLevel','endLevel'):
    if record[field] is None:r.pop(field,None)
    else:r[field]=record[field]
 return changed
