#!/usr/bin/env python3
"""Recompile road/sidewalk polygons from installed curb measurements.

Fresh builds do this automatically in build-street-surfaces.py. This entrypoint
updates an existing package without re-downloading surveys or building meshes.
"""
import argparse,json,pathlib
from street_surfaces import unpack,write_header
from street_meshes import compile_headers
from deck_contacts import packaged_contacts
from roadway_buildings import prune_package

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data-dir',type=pathlib.Path,default=pathlib.Path('public/data'));a=p.parse_args()
 city=json.loads((a.data_dir/'city.json').read_text());headers={};payloads={}
 for key in city['tiles']['keys']:headers[key],payloads[key]=unpack(a.data_dir/'tiles'/f't_{key}.bin')
 contacts,contact_roads=packaged_contacts(city,a.data_dir)
 stats=compile_headers(headers,city['roads'],contacts);stats['deckContactRoads']=len(contact_roads)
 for key,header in headers.items():write_header(a.data_dir/'tiles'/f't_{key}.bin',header,payloads[key])
 path=a.data_dir/'provenance.json';provenance=json.loads(path.read_text());provenance['streetMeshes']={'version':1,**stats}
 removed=prune_package(a.data_dir,city,headers,provenance)
 (a.data_dir/'city.json').write_text(json.dumps(city,separators=(',',':'))+'\n')
 for field,key in (('sidewalks','sidewalkParts'),('islands','islandParts'),('driveways','drivewayParts')):provenance['streetSurfaces'][key]=sum(len(t[field]) for t in headers.values())
 path.write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 print(json.dumps({**stats,'removedRoadwayBuildings':removed},indent=2))

if __name__=='__main__':main()
