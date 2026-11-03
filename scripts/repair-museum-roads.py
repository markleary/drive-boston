#!/usr/bin/env python3
"""Join the clipped southbound dam carriageway to the Cambridge road.

Run after street-surfaces. Source centreline endpoints and measured pavement
remain fixed; a short approach within their shared road corridor fills the
missing municipal-source connection. The northbound deck tapers to the
Cambridge pavement width at the same seam.
"""
import argparse,json,pathlib,math,gzip,hashlib
import numpy as np
from road_connections import resample,stations
from road_tiles import refresh_road_tiles
from street_surfaces import unpack,write_header,encode_edges
from museum_approaches import repair_approaches,validate_approaches

ROOT=pathlib.Path(__file__).resolve().parents[1]
LINK='museum-dam-south-connection'


def repair(city):
 by_id={r['id']:r for r in city['roads']}
 north=by_id['14555-0-0'];south=by_id['14556-0-0'];dam=by_id['osm-508565737-0']
 # A node 30 m inside the Cambridge continuation gives the two Boston
 # carriageways room to merge without a sideways step at the town boundary.
 a=dam['points'][0];b=next(p for p in dam['points'][1:] if math.dist(a,p)>35)
 d=math.dist(a,b);join=[round(a[k]+(b[k]-a[k])*30/d,3) for k in (0,1)]
 if join not in dam['points']:dam['points'].insert(1,join)
 road={'id':LINK,'name':'Charles River Dam Road','kind':'tertiary_link','points':resample([join,south['points'][0]]),'width':10,'oneway':1}
 city['roads']=[r for r in city['roads'] if r['id']!=LINK]+[road]
 distances=stations(north['points']);total=distances[-1]
 north['deckWidths']=[round(north['width']+(dam['pavedWidth']-north['width'])*max(0,1-(total-s)/30),5) for s in distances]
 north.setdefault('deckTangents',{})['end']=[b[k]-a[k] for k in (0,1)]
 return road


def install(data_dir):
 path=data_dir/'city.json';city=json.loads(path.read_text());link=repair(city)
 source_path=data_dir/'museum-approaches-source.json';source=json.loads(source_path.read_text());grid=city['elevation']
 heights=np.frombuffer(gzip.decompress((data_dir/grid['file']).read_bytes()),dtype='<i2')*grid.get('scale',.01)
 approaches=repair_approaches(city,source,heights)
 validate_approaches(city,source,heights)
 changed=refresh_road_tiles(data_dir,city,[link,*approaches])
 # The small link belongs to the existing roadway; do not place new sidewalk
 # bands across either street. The existing survey sidewalks bound the join.
 points=link['points'];left=[];right=[]
 for i,p in enumerate(points):
  a=points[max(0,i-1)];b=points[min(len(points)-1,i+1)];dx=b[0]-a[0];dz=b[1]-a[1];length=math.hypot(dx,dz)
  left.append([p[0]-dz/length*5,p[1]+dx/length*5]);right.append([p[0]+dz/length*5,p[1]-dx/length*5])
 for key in ['0_-2','0_-3']:
  tile_path=data_dir/'tiles'/f't_{key}.bin';header,payload=unpack(tile_path)
  field='pavements' if key=='0_-2' else 'borderPavements'
  record={'road':LINK,'edges':encode_edges(left,right,header['tx'],header['tz'],header['size']),'walk':[1,1]}
  header[field]=[p for p in header.get(field,[]) if p['road']!=LINK]+[record]
  write_header(tile_path,header,payload)
 path.write_text(json.dumps(city,separators=(',',':'))+'\n')
 provenance_path=data_dir/'provenance.json';provenance=json.loads(provenance_path.read_text())
 provenance['museumRoadConnections']={'roads':[link['id'],*[r['id'] for r in approaches]],'sourceSHA256':hashlib.sha256(source_path.read_bytes()).hexdigest(),'method':source['policy']}
 counts=[unpack(data_dir/'tiles'/f't_{key}.bin')[0] for key in city['tiles']['keys']]
 provenance['streetSurfaces']['pavements']=sum(len(h.get('pavements',[])) for h in counts)
 provenance['streetSurfaces']['borderPavements']=sum(len(h.get('borderPavements',[])) for h in counts)
 provenance_path.write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 return {'link':link['id'],'from':link['points'][0],'to':link['points'][-1],'tiles':changed}


if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data')
 print(json.dumps(install(parser.parse_args().data_dir)))
