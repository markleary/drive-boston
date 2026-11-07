"""Static Orange Line and Haverhill Line track for the northern extension.

The tracks are explicit OpenStreetMap way chains: Orange Line tracks 1 and 2
(railway=subway, railway:track_ref 1/2) from the Charlestown portal to the
Oak Grove bumper, the express (`Test Track`) to its Wellington bumper, the
Haverhill Line (`Western Route`) from just south of the Austin Street bridge
through Melrose to the coverage edge (two more tracks to Community College
and Sullivan Square, the second Melrose track from the Fells junction) and
the Wellington yard. Each chain is resampled every STEP metres and clipped to
the package coverage.

Heights are top of rail (TOR). A track starts on the raw DEM
(elevation-source.bin keeps the embankments and cuts that the street grader
flattens), plus the tie and rail above the ballast surface the DEM measured.
OSM bridge and tunnel spans and mapped water are bridged linearly, dips and
bumps narrower than a train's vertical curve are closed and opened away, and
the result is smoothed. A portal end (the Charlestown tunnel) instead keeps
its approach cut: its last 40 m never rise toward the portal and the tunnel
beyond holds the cut floor, and the DEM's portal structure that still buries
the first metres is covered as tunnel. Constraints follow: the rails clear a
street passing under an embankment by UNDER_ROAD and a track passing under a
flyover by UNDER_TRACK, and the bed is lifted out of graded terrain it would sink into
(spikes narrower than NARROW are left to poke through, by at most LIFT_CAP).
Bed buried deeper than LIFT_LIMIT where a street crosses (the street's dam or
its bridge's abutment fill) becomes a covered underpass reaching under the
street, hidden by the renderer behind a portal on each face, like an OSM
tunnel. Parallel tracks follow the tracks processed before them where they run
within 30 m at a similar height, so shared embankments and decks agree; ends
that join another track take its height; level crossings hold the road surface
with approaches no steeper than LEVEL_GRADE. Bridges are the runs where
something passes under (a road, water, another track, an OSM bridge) and the
rail stands BRIDGE_GAP above the graded terrain; they carry piers on long spans
and abutments at both ends. Estimated game profiles, not survey.
"""
import hashlib,json,math
import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import LineString,Point,Polygon
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely.strtree import STRtree

FT=1200/3937
STEP=2.0
OUT=4.0
BED=.25              # TOR above the ballast surface the DEM measured
CLOSE=101;OPEN=51    # morphological windows (m): narrower dips and bumps are not followed
SIGMA=10             # Gaussian smoothing (m)
UNDER_ROAD=4.2       # TOR above a street passing under the track (3.4 m under a .8 m deck)
UNDER_TRACK=6.6      # TOR above a track passing under a flyover
CONE=.03             # grade of the clearance ramps
LIFT=.02             # grade of the ramps that lift the bed out of graded terrain
LIFT_LIMIT=1.5       # deeper burial under a road or tunnel cover is a covered span
SHALLOW=.3           # burial runs that never reach this depth are ignored
NARROW=21            # terrain spikes narrower than this (m) are not lifted over
LIFT_CAP=3.0         # the most the bed is lifted out of graded terrain
LEVEL_GRADE=.025     # steepest approach to a level crossing
BRIDGE_GAP=1.2       # TOR above the graded terrain where a deck takes over
PIER=26              # maximum pier spacing (m)
GAUGE=1.435
PLATFORM={'orange':1.0,'high':1.22,'low':.2}
HIGH_LEVEL={539916684,1494141849}   # Malden Center and Oak Grove commuter platforms
SOUTH_CLIP=42.3716   # Haverhill tracks stop just south of the Austin Street bridge
YARD_BOX=(42.3975,42.4050,-71.0800,-71.0766)

ORANGE_1=[574638743,696026139,561695540,1425093879,539916698,539916690,539916685,539916686,539916687,539916688,539916667,539916671,539916674,539916676,539916677,539916680,539916681,539916682,832328933,832328932,1205210360,321679346,1425101473]
ORANGE_2=[550842944,82329805,82329828,1425093878,80789363,80789362,81275274,81275271,48807709,48807706,48807719,48807716,48807721,48807713,48807727,48807724,48807729,321679347,832328930,832328931,1205210361,80675805]
EXPRESS=[1418822718,163831971,163831972,1425093880,163831973,163831970]
HAVERHILL=[761064347,562246020,761064343,549931130,82329770,761064334,82332096,761064332,761064333,761064331,562258497,50524763,48807687,48807682,568548786,81275248,1195031188,48807711,48807705,48807717,48807715,48807722,48807712,48807725,48807723,48807728,570404420,570404421,80726870,81275224,549057472,570404423,570404427,81275217,81275202,81275201,81275194,795435533,570404434]
MELROSE_EAST=[81275227,549057474,570404424,80729059,80729058,80729063,80729052,795435534,570404438]
SULLIVAN_EAST=[562246022,761064349,761064351,761064350,549931132,1291875341,82329816,93141719,795418940]
COLLEGE_MIDDLE=[562246021,761064348,761064353,761064352,549931131]
TRACKS=[
 {'id':'orange-1','line':'orange','name':'Orange Line track 1','ways':ORANGE_1,'thirdRail':1},
 {'id':'orange-2','line':'orange','name':'Orange Line track 2','ways':ORANGE_2,'thirdRail':-1},
 {'id':'express','line':'express','name':'Orange Line express track','ways':EXPRESS,'thirdRail':1},
 {'id':'haverhill-1','line':'commuter','name':'Haverhill Line','ways':HAVERHILL,'south':SOUTH_CLIP},
 {'id':'haverhill-2','line':'commuter','name':'Haverhill Line Melrose track 2','ways':MELROSE_EAST},
 {'id':'haverhill-3','line':'commuter','name':'Haverhill Line Sullivan Square track','ways':SULLIVAN_EAST,'south':SOUTH_CLIP},
 {'id':'haverhill-4','line':'commuter','name':'Haverhill Line Community College track','ways':COLLEGE_MIDDLE,'south':SOUTH_CLIP},
]
# Stations without an OSM platform polygon: an island between Orange tracks 1 and 2
# centred on the stop position, its length the mapped platform line where one exists.
SYNTHETIC_PLATFORMS=[
 {'id':'community-college','name':'Community College','way':1492454235,'center':(42.37402,-71.07069),'length':150},
 {'id':'assembly','name':'Assembly','center':(42.39245,-71.07723),'length':150},
]

_PROJECT=Transformer.from_crs(4326,2249,always_xy=True)
def world(lon,lat):
 x,y=_PROJECT.transform(lon,lat);return (x-771100)*FT,-(y-2952900)*FT

def smoothstep(t):t=np.clip(t,0,1);return t*t*(3-2*t)
def r2(v):return round(float(v),2)


class Grid:
 """Vectorized terrain sample, the same triangle split as sampleElevation()."""
 def __init__(self,meta,heights):
  self.ox=meta['originX'];self.oz=meta['originZ'];self.cell=meta['cellSize'];self.w=meta['width'];self.h=meta['height']
  self.v=np.asarray(heights,float).reshape(self.h,self.w)
 def __call__(self,x,z):
  x=np.asarray(x,float);z=np.asarray(z,float)
  fx=np.clip((x-self.ox)/self.cell,0,self.w-1);fz=np.clip((z-self.oz)/self.cell,0,self.h-1)
  i=np.minimum(self.w-2,np.floor(fx).astype(int));j=np.minimum(self.h-2,np.floor(fz).astype(int));tx=fx-i;tz=fz-j
  a=self.v[j,i];b=self.v[j,i+1];c=self.v[j+1,i];d=self.v[j+1,i+1]
  return np.where(tx+tz<=1,a+(b-a)*tx+(c-a)*tz,d+(c-d)*(1-tx)+(b-d)*(1-tz))


def osm_index(data):
 """Ways as world polylines with their node ids and tags, and every node's position and tags."""
 ways={};nodes={}
 for e in data['elements']:
  if e['type']=='way' and e.get('geometry'):
   keep=[(n,g) for n,g in zip(e['nodes'],e['geometry']) if g]
   if len(keep)<2:continue
   x,y=_PROJECT.transform([g['lon'] for _,g in keep],[g['lat'] for _,g in keep])
   ways[e['id']]={'id':e['id'],'nodes':[n for n,_ in keep],'points':[((a-771100)*FT,-(b-2952900)*FT) for a,b in zip(x,y)],'tags':e.get('tags',{})}
  elif e['type']=='node':nodes[e['id']]={'point':world(e['lon'],e['lat']),'tags':e.get('tags',{})}
 return ways,nodes


def chain(ways,ids):
 """Join ways end to end through shared nodes, the first one oriented toward the second.
 Returns the polyline, its node ids and each way's (tags, first vertex, last vertex)."""
 points=[];nodes=[];marks=[]
 for k,i in enumerate(ids):
  w=ways[i];ns=list(w['nodes']);ps=list(w['points'])
  if not nodes:
   if len(ids)>1 and ns[0] in (ways[ids[1]]['nodes'][0],ways[ids[1]]['nodes'][-1]):ns.reverse();ps.reverse()
   start=0
  else:
   if ns[-1]==nodes[-1]:ns.reverse();ps.reverse()
   if ns[0]!=nodes[-1]:raise ValueError(f'way {i} does not continue way {ids[k-1]}')
   start=len(points)-1;ns=ns[1:];ps=ps[1:]
  points+=ps;nodes+=ns;marks.append((w['tags'],start,len(points)-1))
 return points,nodes,marks


def window(v,n,op):
 h=n//2;return op(np.lib.stride_tricks.sliding_window_view(np.pad(v,h,mode='edge'),2*h+1),axis=1)
def closing(v,n):return window(window(v,n,np.max),n,np.min)
def opening(v,n):return window(window(v,n,np.min),n,np.max)
def gaussian(v,sigma):
 r=max(1,int(3*sigma));k=np.exp(-.5*(np.arange(-r,r+1)/sigma)**2);k/=k.sum()
 return np.convolve(np.pad(v,r,mode='edge'),k,mode='valid')
def cone_up(bound,step,grade):
 """The least profile at or above `bound` whose rise toward any bound point is at most `grade`."""
 f=bound.copy();b=bound.copy();drop=grade*step
 for k in range(1,len(f)):f[k]=max(f[k],f[k-1]-drop)
 for k in range(len(b)-2,-1,-1):b[k]=max(b[k],b[k+1]-drop)
 return np.maximum(f,b)
def interpolate(v,s,a,b):
 """Replace v over [a,b] by the straight line between its values at the ends."""
 m=(s>=a)&(s<=b)
 if m.any():v[m]=np.interp(s[m],[a,b],[np.interp(a,s,v),np.interp(b,s,v)])
 return v
def runs(mask):
 """(first, last) index pairs of the True runs of a boolean array."""
 d=np.diff(np.concatenate([[0],mask.astype(int),[0]]));return list(zip(np.flatnonzero(d==1),np.flatnonzero(d==-1)-1))
def merge(spans,gap=0):
 out=[]
 for a,b,*rest in sorted(spans,key=lambda s:(s[0],s[1])):
  if out and a<=out[-1][1]+gap:out[-1][1]=max(out[-1][1],b);out[-1][2]|=set(rest[0]) if rest else set()
  else:out.append([a,b,set(rest[0]) if rest else set()])
 return out


class Track:
 def __init__(self,spec,points,nodes,marks):
  self.spec=spec;self.id=spec['id'];self.line=spec['line']
  p=np.asarray(points,float);seg=np.hypot(*np.diff(p,axis=0).T);vertex=np.concatenate([[0],np.cumsum(seg)])
  self.vertex=vertex;self.nodes={n:vertex[i] for i,n in enumerate(nodes)};self.node_list=nodes
  self.osm_spans=[(vertex[a],vertex[b],'tunnel' if t.get('tunnel')=='yes' else 'bridge') for t,a,b in marks if t.get('bridge') in ('yes','viaduct','movable') or t.get('tunnel')=='yes']
  n=max(1,int(math.ceil(vertex[-1]/STEP)));self.s=np.linspace(0,vertex[-1],n+1)
  self.x=np.interp(self.s,vertex,p[:,0]);self.z=np.interp(self.s,vertex,p[:,1]);self.offset=0.0;self.ends=['open','open'];self.joins=[None,None]
  self.frame()
 def frame(self):
  dx=np.gradient(self.x);dz=np.gradient(self.z);l=np.hypot(dx,dz);l[l==0]=1;self.tx=dx/l;self.tz=dz/l
  self.rx=-self.tz;self.rz=self.tx;self.length=self.s[-1];self._line=None
  self.chord=np.concatenate([[0],np.cumsum(np.hypot(np.diff(self.x),np.diff(self.z)))])
 def clip(self,keep):
  """Keep samples [k0,k1]; distances restart at zero."""
  k0,k1=keep;s0=self.s[k0];s1=self.s[k1]
  self.s=self.s[k0:k1+1]-s0;self.x=self.x[k0:k1+1];self.z=self.z[k0:k1+1];self.offset+=s0
  self.nodes={n:d-s0 for n,d in self.nodes.items() if s0-.01<=d<=s1+.01}
  self.osm_spans=[(max(a,s0)-s0,min(b,s1)-s0,k) for a,b,k in self.osm_spans if b>s0 and a<s1]
  self.frame()
 def at(self,d):
  d=np.clip(d,0,self.length);return np.interp(d,self.s,self.x),np.interp(d,self.s,self.z)
 def height(self,d):return np.interp(np.clip(d,0,self.length),self.s,self.tor)
 def path(self):
  if self._line is None:self._line=LineString(np.column_stack([self.x,self.z]))
  return self._line
 def locate(self,points):
  """Distance along the track of the nearest point to each point."""
  return np.interp(shapely.line_locate_point(self.path(),points),self.chord,self.s)
 def lateral(self,offsets,sampler):
  return np.max([sampler(self.x+self.rx*o,self.z+self.rz*o) for o in offsets],axis=0)


def load_tracks(ways,coverage,city):
 """The main tracks and the Wellington yard, chained, resampled and clipped to coverage."""
 tracks=[]
 specs=list(TRACKS)
 lat0,lat1,lon0,lon1=YARD_BOX
 x0,z1=world(lon0,lat0);x1,z0=world(lon1,lat1)
 yard=sorted(i for i,w in ways.items() if w['tags'].get('railway')=='subway' and w['tags'].get('service')=='yard' and not w['tags'].get('tunnel') and all(x0<=x<=x1 and z0<=z<=z1 for x,z in w['points']))
 specs+=[{'id':f'yard-{i}','line':'yard','name':'Wellington yard','ways':[i]} for i in yard]
 b=city['bounds']
 for spec in specs:
  points,nodes,marks=chain(ways,spec['ways']);t=Track(spec,points,nodes,marks)
  inside=np.array([coverage.contains(Point(x,z)) for x,z in zip(t.x,t.z)])&(t.x>b['minX'])&(t.x<b['maxX'])&(t.z>b['minZ'])&(t.z<b['maxZ'])
  if 'south' in spec:inside&=t.z<=world(-71.069,spec['south'])[1]
  r=max(runs(inside),key=lambda r:r[1]-r[0],default=None)
  if r is None or r[1]-r[0]<3:continue
  edge=[r[0]>0,r[1]<len(t.s)-1]
  t.clip(r)
  for k in (0,1):
   if edge[k]:t.ends[k]='edge'
  tracks.append(t)
 return tracks


def crossings(track,roads,lines,tree,ground):
 """Road centrelines crossing the track: distance, road, road height, deck flag, sine of the angle."""
 line=track.path();out=[]
 for k in tree.query(line,predicate='intersects'):
  road=roads[k];shape=line.intersection(lines[k])
  for p in (shape.geoms if hasattr(shape,'geoms') else [shape]):
   if p.geom_type!='Point':continue
   d=float(track.locate(p));tx,tz=float(np.interp(d,track.s,track.tx)),float(np.interp(d,track.s,track.tz))
   pts=road['points'];best=None
   for i,(a,b) in enumerate(zip(pts,pts[1:])):
    dx,dz=b[0]-a[0],b[1]-a[1];l2=dx*dx+dz*dz or 1;u=max(0,min(1,((p.x-a[0])*dx+(p.y-a[1])*dz)/l2))
    dist=math.hypot(p.x-a[0]-dx*u,p.y-a[1]-dz*u)
    if best is None or dist<best[0]:best=(dist,i,u,dx/math.sqrt(l2),dz/math.sqrt(l2))
   _,i,u,ux,uz=best;deck=bool(road.get('elevations'))
   h=road['elevations'][i]+(road['elevations'][i+1]-road['elevations'][i])*u if deck else float(ground(p.x,p.y))
   out.append({'s':d,'road':road,'height':h,'deck':deck,'sine':max(.2,abs(tx*uz-tz*ux)),'point':(p.x,p.y),'yaw':math.atan2(ux,uz)})
 return sorted(out,key=lambda c:c['s'])


def base_profile(t,raw,water):
 """Raw DEM under the rails, OSM spans and water bridged, narrow dips and bumps removed, smoothed."""
 h=t.lateral((-.7,0,.7),raw)+BED;s=t.s
 wet=np.array([water.contains(Point(x,z)) for x,z in zip(t.x,t.z)]) if water else np.zeros(len(s),bool)
 spans=[(a,b) for a,b,_ in t.osm_spans]+[(s[a]-6,s[b]+6) for a,b in runs(wet)]
 for a,b,_ in merge(spans):
  # The ends come from the bank just outside the span, not the DEM's sloping edge.
  pa=(s>=a-10)&(s<a);pb=(s>b)&(s<=b+10)
  va=np.median(h[pa]) if pa.any() else np.interp(a,s,h);vb=np.median(h[pb]) if pb.any() else np.interp(b,s,h)
  m=(s>=a)&(s<=b);h[m]=np.interp(s[m],[a,b],[va,vb])
 t.wet=wet
 # A portal end descends into its approach cut over its last 40 m (the DEM's portal structure
 # removed) and the tunnel beyond holds the cut floor, so the closing does not fill the cut.
 n=int(CLOSE/STEP)|1;near=min(len(h),max(1,int(40/STEP)))
 if t.ends[0]=='portal':h[:near]=np.minimum.accumulate(h[:near][::-1])[::-1]
 if t.ends[1]=='portal':h[-near:]=np.minimum.accumulate(h[-near:])
 lead=np.full(n if t.ends[0]=='portal' else 0,h[0]);tail=np.full(n if t.ends[1]=='portal' else 0,h[-1])
 h=gaussian(opening(closing(np.concatenate([lead,h,tail]),n),int(OPEN/STEP)|1),SIGMA/STEP)
 return h[len(lead):len(lead)+len(s)]


def alongside(t,refs):
 """Each reference track's nearest point to every sample: lateral distance, distance along it, height, direction cosine."""
 pts=shapely.points(t.x,t.z);out=[]
 for r in refs:
  dl=shapely.distance(pts,r.path());sr=r.locate(pts)
  rtx=np.interp(sr,r.s,r.tx);rtz=np.interp(sr,r.s,r.tz);cos=np.abs(t.tx*rtx+t.tz*rtz)/np.maximum(np.hypot(rtx,rtz),1e-9)
  out.append((r,dl,sr,r.height(sr),cos))
 return out


def harmonize(t,tor,refs,report):
 """Follow the tracks already profiled where they run alongside at a similar height: the weighted
 mean of their heights, the change smoothed so a hand-over between references never steps."""
 if not refs:return tor
 W=np.zeros(len(t.s));num=np.zeros(len(t.s));den=np.zeros(len(t.s))
 for r,dl,sr,hr,cos in alongside(t,refs):
  # A reference that stops (a bumper, a junction) hands over gradually; one clipped by coverage does not stop.
  reach=np.minimum(sr if r.ends[0]!='edge' else 1e9,r.length-sr if r.ends[1]!='edge' else 1e9)
  w=(1-smoothstep((dl-12)/18))*smoothstep((cos-.9)/.07)*(1-smoothstep((np.abs(tor-hr)-.4)/.8))*smoothstep(reach/40)
  num+=w*hr;den+=w;W=np.maximum(W,w)
 if W.max()<=0:return tor
 target=np.where(den>0,num/np.maximum(den,1e-9),tor)
 report.setdefault('tracks',{}).setdefault(t.id,{})['follows']=r2((W>.5).sum()*STEP)
 return tor+gaussian(W*(target-tor),5/STEP)


def profile(t,tracks,done,graded,roads,lines,tree,report,level_crossings):
 """Final top-of-rail profile and the constraint record the structures need."""
 s=t.s;t.tor=t.base.copy();rec=report.setdefault('tracks',{}).setdefault(t.id,{})
 t.crossings=crossings(t,roads,lines,tree,graded)
 # Level crossings: the OSM node on this chain, matched to the nearest road the chain crosses.
 t.level=[]
 for node,d in t.nodes.items():
  if node not in level_crossings:continue
  near=[c for c in t.crossings if not c['deck'] and abs(c['s']-d)<15]
  if not near:continue
  c=min(near,key=lambda c:abs(c['s']-d));half=c['road']['width']/2/c['sine']+2
  t.level.append({'s':c['s'],'half':half,'height':c['height']+.04,'road':c['road'],'point':c['point'],'yaw':c['yaw'],'sine':c['sine']})
 # The least TOR that keeps the ties above the graded terrain under them.
 gc=graded(t.x,t.z);ge=t.lateral((-1.3,-.7,.7,1.3),graded);t.gc=gc;need=np.maximum(gc+.22,ge+.15)
 tunnel=np.zeros(len(s),bool);pinned=np.zeros(len(s),bool)
 for a,b,k in t.osm_spans:
  if k=='tunnel':tunnel|=(s>=a)&(s<=b)
 for l in t.level:pinned|=np.abs(s-l['s'])<=l['half']+4
 # Bed buried deeper than LIFT_LIMIT where a street crosses (the street's dam or the abutment
 # fill of its bridge) is covered, never lifted. Other burial lifts the bed at LIFT, ignoring
 # spikes narrower than NARROW (the terrain pokes through there) and by at most LIFT_CAP.
 near_road=np.zeros(len(s),bool)
 for c in t.crossings:
  if not any(abs(c['s']-l['s'])<1 for l in t.level):near_road|=np.abs(s-c['s'])<=c['road']['width']/2/c['sine']+12
 depth=need-t.base;deep=np.zeros(len(s),bool)
 for a,b in runs(depth>SHALLOW):
  if depth[a:b+1].max()>LIFT_LIMIT and near_road[a:b+1].any():deep[a:b+1]=True
 deep&=~pinned;free=~(deep|tunnel|pinned)
 want=np.minimum(opening(need,int(NARROW/STEP)|1),t.base+LIFT_CAP)
 bound=np.full(len(s),-1e9)
 def lift(center,half,height):np.maximum(bound,np.where(np.abs(s-center)<=half,height,-1e9),out=bound)
 t.under=[]
 for c in t.crossings:
  # A street under an embankment: the rails clear it, ramping at CONE.
  if c['deck'] or any(abs(c['s']-l['s'])<1 for l in t.level):continue
  if t.height(c['s'])-c['height']>2.0:
   half=c['road']['width']/2/c['sine'];lift(c['s'],half+1,c['height']+UNDER_ROAD);t.under.append(('road',c['s'],c['road']['name'],half))
 for other in tracks:
  # Over a track: only where this chain's OSM way is the bridge and the other's is not,
  # against the other's unconstrained profile (every base is known before any constraint).
  if other is t:continue
  inter=t.path().intersection(other.path())
  for p in (inter.geoms if hasattr(inter,'geoms') else [inter]):
   if p.geom_type!='Point':continue
   d=float(t.locate(p));od=float(other.locate(p))
   mine=any(a<=d<=b and k=='bridge' for a,b,k in t.osm_spans);theirs=any(a<=od<=b and k=='bridge' for a,b,k in other.osm_spans)
   if mine and not theirs:lift(d,3,float(np.interp(od,other.s,other.base))+UNDER_TRACK);t.under.append(('track',d,other.id,2.5))
 lower=np.maximum(cone_up(bound,STEP,CONE),cone_up(np.where(free,want,-1e9),STEP,LIFT))
 tor=np.maximum(t.base,lower)
 tor=np.maximum(gaussian(np.maximum(harmonize(t,tor,done,report),lower),2/STEP),lower)
 # Ends that join a track already profiled take its height there.
 for e,node in ((0,t.node_list[0]),(1,t.node_list[-1])):
  if t.ends[e]=='edge':continue
  for other in done:
   if node in other.nodes:
    hp=float(other.height(other.nodes[node]));dist=s if e==0 else t.length-s
    tor=hp+(tor-hp)*smoothstep(dist/60);t.ends[e]='join';t.joins[e]=other.id;break
 # Level crossings hold the road surface; the approaches ramp at no more than LEVEL_GRADE.
 if t.level:
  lo=np.full(len(s),-1e9);hi=np.full(len(s),1e9)
  for l in t.level:
   d=np.maximum(0,np.abs(s-l['s'])-l['half']);lo=np.maximum(lo,l['height']-LEVEL_GRADE*d);hi=np.minimum(hi,l['height']+LEVEL_GRADE*d)
  tor=np.minimum(np.maximum(tor,lo),hi);tor=np.minimum(np.maximum(gaussian(tor,4/STEP),lo),hi)
  for l in t.level:tor[np.abs(s-l['s'])<=l['half']]=l['height']
 t.tor=tor
 # Covered spans: OSM tunnels and the deep burials the final profile leaves. A burial beside a
 # road deck is the road's abutment fill: the span reaches under the deck, one underpass.
 buried=deep&(need-tor>SHALLOW)
 spans=[[a,b,{'tunnel'}] for a,b,k in t.osm_spans if k=='tunnel']+[[s[a],s[b],set()] for a,b in runs(buried)]
 # The DEM's portal structure buries the first metres of a portal end: they are tunnel.
 for e,k in ((0,0),(1,len(s)-1)):
  if t.ends[e]=='portal' and need[k]-tor[k]>SHALLOW:
   a,b=next(r for r in runs(need-tor>SHALLOW) if r[0]<=k<=r[1]);spans.append([s[a]-(e==1),s[b]+(e==0),{'tunnel'}])
 spans=merge([(max(0,a-1.5),min(t.length,b+1.5),k) for a,b,k in spans],gap=10)
 for sp in spans:
  if 'tunnel' in sp[2]:continue
  for c in t.crossings:
   if c['deck'] and sp[0]-40<=c['s']<=sp[1]+40 and c['height']>t.height(c['s'])+2:
    half=c['road']['width']/2/c['sine']+1;sp[0]=max(0,min(sp[0],c['s']-half));sp[1]=min(t.length,max(sp[1],c['s']+half))
 t.covered=[]
 for a,b,kind in merge([tuple(sp) for sp in spans],gap=10):
  if b-a<2:continue
  over=sorted({c['road']['name'] for c in t.crossings if a-12<=c['s']<=b+12})
  t.covered.append({'start':a,'end':b,'kind':'tunnel' if 'tunnel' in kind else 'underpass','roads':over})
 for c in t.covered:t.tor=interpolate(t.tor,s,c['start'],c['end'])
 grade=np.abs(np.diff(t.tor))/STEP;hidden=np.zeros(len(s),bool)
 for c in t.covered:hidden|=(s>=c['start'])&(s<=c['end'])
 rec['buried']=[(r2(s[a]),r2(s[b]),r2((need-t.tor)[a:b+1].max())) for a,b in runs((need-t.tor>SHALLOW)&~hidden&~pinned)]
 rec.update({'length':r2(t.length),'maxGrade':r2(grade.max()*100) if len(grade) else 0,'maxGradeAt':r2(s[int(np.argmax(grade))]) if len(grade) else 0,'ends':list(t.ends),
  'covered':[(r2(c['start']),r2(c['end']),c['kind'],c['roads']) for c in t.covered],'under':[(u[0],r2(u[1]),u[2]) for u in t.under],'level':[(r2(l['s']),l['road']['name']) for l in t.level]})


def bridges(t,others,water):
 """Decked runs: something passes under and the rail stands BRIDGE_GAP over the graded terrain."""
 s=t.s;high=(t.tor-t.gc>BRIDGE_GAP)
 for c in t.covered:high&=(s<c['start'])|(s>c['end'])
 out=[]
 for a,b in runs(high):
  a0,b0=s[a],s[b]
  osm=[(x,y) for x,y,k in t.osm_spans if k=='bridge' and y>a0-4 and x<b0+4]
  under=[u for u in t.under if a0-4<=u[1]<=b0+4]
  wet=t.wet[a:b+1].any()
  if not(osm or under or wet):continue
  if osm:a0=min([a0]+[x for x,_ in osm]);b0=max([b0]+[y for _,y in osm])
  out.append([max(0,a0-1),min(t.length,b0+1),set()])
 spans=[]
 for a,b,_ in merge(out,gap=6):
  length=b-a;piers=[]
  if length>36:
   n=int(math.ceil(length/PIER))
   for k in range(1,n):
    for shift in (0,2,-2,4,-4,6,-6):
     d=a+length*k/n+shift
     if clear_pier(t,d,others):piers.append(r2(d));break
  under=[u for u in t.under if a<=u[1]<=b]
  spans.append({'start':a,'end':b,'piers':piers,'kind':'deck' if length>40 else 'through','over':sorted({u[2] for u in under})+(['water'] if t.wet[(s>=a)&(s<=b)].any() else [])})
 return spans


def clear_pier(t,d,others):
 """A pier stands clear of the streets and tracks passing under the deck."""
 x,z=t.at(d);y=t.height(d);p=Point(float(x),float(z))
 for kind,ud,name,half in t.under:
  if kind=='road' and abs(ud-d)<half+1.5:return False
 for o in others:
  if o is t:continue
  dist=o.path().distance(p)
  if dist<3.0 and o.height(float(o.locate(p)))<y-2:return False
 return True


def neighbours(t,others,a,b):
 """Median lateral gap to a parallel track at the deck's height on each side (None when open)."""
 ds=np.arange(a,b+.01,4.0);sides={-1:[],1:[]}
 for d in ds:
  x,z=t.at(d);k=min(len(t.s)-1,int(d/STEP));rx,rz=t.rx[k],t.rz[k];y=t.height(d)
  for o in others:
   if o is t:continue
   p=Point(float(x),float(z));dist=o.path().distance(p)
   if dist>7:continue
   od=float(o.locate(p));ox,oz=o.at(od)
   if abs(o.height(od)-y)>.6:continue
   side=1 if (ox-x)*rx+(oz-z)*rz>0 else -1;sides[side].append(dist)
 return {k:(float(np.median(v)) if len(v)>=max(1,len(ds)//2) else None) for k,v in sides.items()}


def portal_record(t,d,facing,graded):
 """A portal face at distance d, facing out of the covered span (+1 along the track)."""
 x,z=t.at(d);k=min(len(t.s)-1,int(round(d/STEP)));tx,tz=t.tx[k],t.tz[k];yaw=math.atan2(tx*facing,tz*facing)
 u=np.arange(0,10.1,1.0);top=float(np.max(graded(x-facing*tx*u,z-facing*tz*u)))+.6;bottom=float(t.height(d))-.5
 return {'x':float(x),'z':float(z),'yaw':yaw,'bottom':bottom,'top':max(top,bottom+2.5),'tor':float(t.height(d)),'track':t,'d':d,'facing':facing}


def merge_portals(raw,kinds):
 """One portal across the parallel tracks entering the same covered span face."""
 groups=[]
 for p in raw:
  for g in groups:
   q=g[0];same=math.cos(p['yaw']-q['yaw'])>.9 and math.hypot(p['x']-q['x'],p['z']-q['z'])<16
   if same:g.append(p);break
  else:groups.append([p])
 out=[]
 for g in groups:
  yaw=math.atan2(sum(math.sin(p['yaw']) for p in g),sum(math.cos(p['yaw']) for p in g));fx,fz=math.sin(yaw),math.cos(yaw);ax,az=-fz,fx
  cx=sum(p['x'] for p in g)/len(g);cz=sum(p['z'] for p in g)/len(g)
  across=[(p['x']-cx)*ax+(p['z']-cz)*az for p in g];along=sum((p['x']-cx)*fx+(p['z']-cz)*fz for p in g)/len(g)
  mid=(min(across)+max(across))/2;cx+=ax*mid+fx*along;cz+=az*mid+fz*along
  for p in g:
   # Snap each track's covered end onto the shared face.
   t=p['track'];k=min(len(t.s)-1,int(round(p['d']/STEP)));cosine=t.tx[k]*fx+t.tz[k]*fz
   if abs(cosine)>.3 and p['d']>.01:
    shift=((cx-p['x'])*fx+(cz-p['z'])*fz)/cosine
    for c in t.covered:
     if abs(c['start']-p['d'])<.01:c['start']=max(0,c['start']+shift)
     if abs(c['end']-p['d'])<.01:c['end']=min(t.length,c['end']+shift)
  kind='tunnel' if any(kinds.get((p['track'].id,round(p['d'],2)))=='tunnel' for p in g) else 'underpass'
  out.append({'x':r2(cx),'z':r2(cz),'yaw':round(yaw,4),'width':r2(max(across)-min(across)+4.6),'bottom':r2(min(p['bottom'] for p in g)),'top':r2(max(p['top'] for p in g)),'tor':r2(min(p['tor'] for p in g)),'kind':kind,'tracks':sorted({p['track'].id for p in g})})
 return out


def platforms(osm_ways,tracks,report):
 """Mapped platform areas beside the main tracks plus the synthesized islands."""
 main=[t for t in tracks if t.line!='yard'];shapes=[]
 for w in osm_ways.values():
  tags=w['tags']
  if tags.get('railway')!='platform' or w['nodes'][0]!=w['nodes'][-1] or len(w['points'])<4:continue
  poly=Polygon(w['points']).buffer(0)
  if poly.is_empty or poly.geom_type!='Polygon' or not any(t.path().distance(poly)<4 for t in main):continue
  shapes.append((f"osm-{w['id']}",poly,tags,w['id']))
 for spec in SYNTHETIC_PLATFORMS:
  o1=next(t for t in main if t.id=='orange-1');o2=next(t for t in main if t.id=='orange-2')
  cx,cz=world(spec['center'][1],spec['center'][0]);c=Point(cx,cz)
  if o1.path().distance(c)>12:continue
  d1=float(o1.locate(c));left=[];right=[]
  for d in np.linspace(d1-spec['length']/2,d1+spec['length']/2,16):
   x1,z1=o1.at(d);p=Point(float(x1),float(z1));d2=float(o2.locate(p));x2,z2=o2.at(d2);gap=math.hypot(x2-x1,z2-z1)
   if gap<6:continue
   ux,uz=(x2-x1)/gap,(z2-z1)/gap
   right.append((float(x1+ux*1.55),float(z1+uz*1.55)));left.append((float(x2-ux*1.55),float(z2-uz*1.55)))
  if len(left)<4:report.setdefault('skippedPlatforms',[]).append(spec['id']);continue
  shapes.append((spec['id'],Polygon(right+left[::-1]).buffer(0),{'name':spec['name'],'subway':'yes'},None))
 out=[]
 for pid,poly,tags,wid in sorted(shapes,key=lambda s:s[0]):
  poly=poly.simplify(.05)
  ring=list(poly.exterior.coords)[:-1]
  if Polygon(ring).exterior.is_ccw:ring=ring[::-1]
  near=[(t,t.path().distance(poly)) for t in main];near=[t for t,d in near if d<3.5]
  if not near:continue
  c=poly.centroid;heights=[float(t.height(float(t.locate(c)))) for t in near]
  line='orange' if any(t.line in ('orange','express') for t in near) and tags.get('train')!='yes' else 'commuter'
  level='orange' if line=='orange' else 'high' if wid in HIGH_LEVEL else 'low'
  top=sum(heights)/len(heights)+PLATFORM[level]
  edges=[]
  for i in range(len(ring)):
   a,b=ring[i],ring[(i+1)%len(ring)];m=Point((a[0]+b[0])/2,(a[1]+b[1])/2)
   if math.dist(a,b)>2 and any(1.0<t.path().distance(m)<2.6 for t in near):edges.append(i)
  rect=poly.minimum_rotated_rectangle;rc=list(rect.exterior.coords)[:4]
  e0=math.dist(rc[0],rc[1]);e1=math.dist(rc[1],rc[2])
  if e0>=e1:a=((rc[0][0]+rc[3][0])/2,(rc[0][1]+rc[3][1])/2);b=((rc[1][0]+rc[2][0])/2,(rc[1][1]+rc[2][1])/2);width=e1
  else:a=((rc[0][0]+rc[1][0])/2,(rc[0][1]+rc[1][1])/2);b=((rc[3][0]+rc[2][0])/2,(rc[3][1]+rc[2][1])/2);width=e0
  length=math.dist(a,b);canopy=None
  if tags.get('tunnel')!='yes' and width>=2.4:
   share=.8 if tags.get('covered')=='yes' else .6 if level!='low' else min(1,14/length)
   t0=.5-share/2;t1=.5+share/2
   canopy=[r2(a[0]+(b[0]-a[0])*t0),r2(a[1]+(b[1]-a[1])*t0),r2(a[0]+(b[0]-a[0])*t1),r2(a[1]+(b[1]-a[1])*t1),r2(max(2,width-.8))]
  out.append({'id':pid,'name':tags.get('name',''),'line':line,'level':level,'ring':[[r2(x),r2(z)] for x,z in ring],'top':r2(top),'edges':edges,'canopy':canopy,'island':len(near)>=2,'covered':tags.get('tunnel')=='yes'})
 return out


def third_rail(t,plats):
 """[start, end, side] runs of the Orange Line contact rail, away from every platform edge."""
 side=t.spec.get('thirdRail',0)
 if not side:return []
 shapes=[prep(Polygon(p['ring']).buffer(1.0)) for p in plats]
 sides=np.zeros(len(t.s),int)
 for k in range(len(t.s)):
  for sd in (side,-side):
   p=Point(t.x[k]+t.rx[k]*sd*1.5,t.z[k]+t.rz[k]*sd*1.5)
   if not any(sh.contains(p) for sh in shapes):sides[k]=sd;break
 for c in t.covered:sides[(t.s>=c['start'])&(t.s<=c['end'])]=0
 out=[]
 for sd in (-1,1):
  for a,b in runs(sides==sd):
   a0,b0=t.s[a]+(3 if a>0 else 0),t.s[b]-(3 if b<len(t.s)-1 else 0)
   if b0-a0>=10:out.append([r2(a0),r2(b0),sd])
 return sorted(out)


def level_crossing_records(tracks):
 """One record per street crossed at grade (pieces of one street within 25 m are one street):
 centre on the road, its direction, the extent across the tracks and the road's half width."""
 groups=[]
 for t in tracks:
  for l in t.level:
   name=l['road'].get('name','')
   for g in groups:
    if g[0][1]['road'].get('name','')==name and any(math.dist(l['point'],m['point'])<25 for _,m in g):g.append((t,l));break
   else:groups.append([(t,l)])
 out=[]
 for items in groups:
  road=items[0][1]['road'];yaw=items[0][1]['yaw'];ux,uz=math.sin(yaw),math.cos(yaw)
  pts=[l['point'] for _,l in items];cx=sum(p[0] for p in pts)/len(pts);cz=sum(p[1] for p in pts)/len(pts)
  along=[(p[0]-cx)*ux+(p[1]-cz)*uz for p in pts];mid=(min(along)+max(along))/2;cx+=ux*mid;cz+=uz*mid
  out.append({'name':road.get('name',''),'x':r2(cx),'z':r2(cz),'yaw':round(yaw,4),'half':r2((max(along)-min(along))/2+2.4),'road':r2(max(l['road']['width'] for _,l in items)/2),'y':r2(sum(l['height'] for _,l in items)/len(items)),'tracks':sorted({t.id for t,_ in items})})
 return sorted(out,key=lambda c:(c['name'],c['x'],c['z']))


def package_digest(city,graded_bytes,raw_bytes):
 """sha256 of everything build_rail reads from the package (streets, water, coverage, both
 grids). rail.json records it, so validate-city.py can tell a stale rail.json without the OSM extract."""
 roads=[[r['id'],r.get('name',''),r['points'],r['width'],r.get('elevations'),bool(r.get('tunnel'))] for r in city['roads']]
 meta={k:city['elevation'].get(k) for k in ('originX','originZ','cellSize','width','height','scale')}
 head=json.dumps({'roads':roads,'water':[w['rings'] for w in city.get('water',[])],'coverage':city.get('coverage'),'bounds':city['bounds'],'elevation':meta},sort_keys=True,separators=(',',':'))
 return hashlib.sha256(head.encode()+bytes(graded_bytes)+bytes(raw_bytes)).hexdigest()


def build_rail(city,graded_heights,raw_heights,osm,report=None):
 """The deterministic rail document for one package."""
 report=report if report is not None else {}
 meta=city['elevation'];graded=Grid(meta,graded_heights);raw=Grid(meta,raw_heights)
 ways,nodes=osm_index(osm)
 coverage=prep(unary_union([Polygon(r).buffer(0) for r in city.get('coverage') or [[[city['bounds']['minX'],city['bounds']['minZ']],[city['bounds']['maxX'],city['bounds']['minZ']],[city['bounds']['maxX'],city['bounds']['maxZ']],[city['bounds']['minX'],city['bounds']['maxZ']]]]]))
 water_shapes=[Polygon(w['rings'][0],w['rings'][1:]).buffer(0) for w in city.get('water',[])]
 water=prep(unary_union(water_shapes)) if water_shapes else None
 roads=[r for r in city['roads'] if len(r['points'])>=2 and not r.get('tunnel')];lines=[LineString(r['points']) for r in roads];tree=STRtree(lines)
 level_nodes={i for i,n in nodes.items() if n['tags'].get('railway')=='level_crossing'}
 buffers={i for i,n in nodes.items() if n['tags'].get('railway')=='buffer_stop'}
 tracks=load_tracks(ways,coverage,city)
 for t in tracks:
  if t.id in ('orange-1','orange-2') and t.offset<1:t.ends[0]='portal'
  t.base=base_profile(t,raw,water)
 # Every track's raw profile is known before any constraint, so a flyover can clear the track under it.
 done=[]
 for t in tracks:
  for e,node in ((0,t.node_list[0]),(1,t.node_list[-1])):
   if t.ends[e]!='edge' and node in buffers and node in t.nodes:t.ends[e]='buffer'
  t.tor=t.base
  profile(t,tracks,done,graded,roads,lines,tree,report,level_nodes);done.append(t)
 plats=platforms(ways,tracks,report)
 kinds={};raw_portals=[]
 for t in tracks:
  for c in t.covered:
   for d,facing in ((c['start'],-1),(c['end'],1)):
    if d<=.01 or d>=t.length-.01:continue
    kinds[(t.id,round(d,2))]=c['kind'];raw_portals.append(portal_record(t,d,facing,graded))
  if t.ends[0]=='portal' and not any(c['start']<=.01 for c in t.covered):
   kinds[(t.id,0.0)]='tunnel';raw_portals.append(portal_record(t,0.0,1,graded))
 portals=merge_portals(raw_portals,kinds)
 doc_tracks=[]
 for t in tracks:
  spans=bridges(t,tracks,water)
  for b in spans:
   n=neighbours(t,tracks,b['start'],b['end']);b['half']=[r2(n[-1]/2) if n[-1] else 2.2,r2(n[1]/2) if n[1] else 2.2];b['walls']=[int(n[-1] is None),int(n[1] is None)]
  n=max(1,int(math.ceil(t.length/OUT)));d=np.linspace(0,t.length,n+1);x,z=t.at(d);y=t.height(d)
  rec={'id':t.id,'line':t.line,'name':t.spec['name'],'length':r2(t.length),'points':[[r2(a),r2(b),r2(c)] for a,b,c in zip(x,z,y)],'ends':t.ends,
   'bridges':[{'start':r2(b['start']),'end':r2(b['end']),'piers':b['piers'],'kind':b['kind'],'half':b['half'],'walls':b['walls'],'over':b['over']} for b in spans],
   'covered':[{'start':r2(c['start']),'end':r2(c['end']),'kind':c['kind']} for c in t.covered if c['end']-c['start']>.01],
   'crossings':[{'start':r2(l['s']-l['half']+1),'end':r2(l['s']+l['half']-1)} for l in t.level],
   'thirdRail':third_rail(t,plats)}
  doc_tracks.append(rec)
  report.setdefault('tracks',{}).setdefault(t.id,{})['bridges']=[(r2(b['start']),r2(b['end']),b['kind'],len(b['piers']),b['over']) for b in spans]
 bumpers=[]
 for t in tracks:
  for e in (0,1):
   if t.ends[e]!='buffer':continue
   d=0.0 if e==0 else t.length;x,z=t.at(d);k=0 if e==0 else len(t.s)-1;f=-1 if e==0 else 1
   bumpers.append({'x':r2(x),'z':r2(z),'yaw':round(math.atan2(t.tx[k]*f,t.tz[k]*f),4),'y':r2(t.height(d)),'track':t.id})
 return {'version':1,'gauge':GAUGE,
  'notes':'Static Orange Line and Haverhill Line track from the OpenStreetMap railway extract. Heights are top of rail, estimated from the raw DEM with smoothing and clearance constraints; not a survey.',
  'tracks':doc_tracks,'platforms':plats,'portals':portals,'crossings':level_crossing_records(tracks),'bumpers':sorted(bumpers,key=lambda b:b['track'])}
