"""Reconnect clipped GIS/OSM continuations, with source geometry as evidence.

Only mutually nearest dangling endpoints of the same named street qualify.
Both bearings and one-way flow must agree, and the missing corridor must lie
on the original, unclipped OSM way. A nearby crossing or parallel carriageway
is never enough evidence to join roads.
"""
import math
from collections import Counter
from shapely.geometry import LineString,Point
from shapely.strtree import STRtree

MAX_GAP=50
ALIGNMENT=.95


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
