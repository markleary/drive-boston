#!/usr/bin/env python3
"""Prepare small, auditable Fenway detail coordinates from an offline OSM extract.

Requires the project's pinned pyproj dependency. No photographs or map tiles are
bundled. The source mesh remains the stadium's architectural shell.
"""
import argparse,json,pathlib,struct,urllib.request,xml.etree.ElementTree as ET
from pyproj import Transformer

ROOT=pathlib.Path(__file__).resolve().parents[1]
URL='https://api.openstreetmap.org/api/0.6/map?bbox=-71.1002,42.3452,-71.0945,42.3484'
ROLES={813683133:'field',813683131:'infield',1339130771:'monster-wall',813683146:'monster-seats',148755799:'bullpen',148755801:'bullpen',813683134:'bleachers',813683142:'grandstand',813683143:'grandstand',813683144:'grandstand',814360194:'lower-bowl'}
def main():
 p=argparse.ArgumentParser();p.add_argument('--source',type=pathlib.Path,default=ROOT/'data-source-cache/fenway-osm.xml');p.add_argument('--download',action='store_true');args=p.parse_args()
 if args.download or not args.source.exists():
  args.source.parent.mkdir(parents=True,exist_ok=True)
  request=urllib.request.Request(URL,headers={'User-Agent':'DriveBostonFenwayDetail/0.1'})
  with urllib.request.urlopen(request,timeout=90) as response:args.source.write_bytes(response.read())
 transform=Transformer.from_crs(4326,2249,always_xy=True)
 def xy(lon,lat):
  x,y=transform.transform(lon,lat);return[round((x-771100)*1200/3937,3),round(-(y-2952900)*1200/3937,3)]
 root=ET.fromstring(args.source.read_bytes());nodes={n.attrib['id']:xy(float(n.attrib['lon']),float(n.attrib['lat']))for n in root.findall('node')};features=[]
 for way in root.findall('way'):
  identifier=int(way.attrib['id'])
  if identifier not in ROLES:continue
  points=[nodes[n.attrib['ref']]for n in way.findall('nd')]
  if points[0]==points[-1]:points.pop()
  features.append({'id':identifier,'role':ROLES[identifier],'points':points})
 assert len(features)==len(ROLES),'Required stadium features absent from source'
 raw=(ROOT/'public/data/city.glb').read_bytes();size=struct.unpack_from('<I',raw,12)[0];gltf=json.loads(raw[20:20+size]);binary=20+size+8
 def accessor(index):
  a=gltf['accessors'][index];view=gltf['bufferViews'][a['bufferView']];start=binary+view.get('byteOffset',0)+a.get('byteOffset',0);fmt='<fff' if a['type']=='VEC3' else '<I';step=struct.calcsize(fmt)
  return[struct.unpack_from(fmt,raw,start+i*step)for i in range(a['count'])]
 roof=[];roof_buildings=[]
 for node in gltf['nodes']:
  if node.get('name') not in ['BOS-73AP7-T4BL0-O4QDM','BOS-DA4MQ-LLJZX-89MF5','BOS-2ZJZB-IWPEJ-JUBMC','BOS-0HKZL-2YJWH-V1GAU']:continue
  roof_buildings.append(node['name'])
  for primitive in gltf['meshes'][node['mesh']]['primitives']:
   if primitive['material']!=1:continue
   points=accessor(primitive['attributes']['POSITION']);indices=[p[0]for p in accessor(primitive['indices'])]
   for i in range(0,len(indices),3):roof.append([round(v,3)for j in indices[i:i+3]for v in points[j]])
 data={'features':features,'roofTriangles':roof,'roofBuildings':roof_buildings,'markers':{'rightFoulPole':nodes['14160670712'],'centerScoreboard':nodes['7607086168']},'source':{'url':URL,'license':'OpenStreetMap contributors, ODbL 1.0','retrieved':'2026-10-27'},'dimensions':{'basePath':27.432,'moundDistance':18.4404,'monsterHeight':11.329,'leftFieldDistance':94.488,'rightFieldDistance':92.0496,'source':'https://www.mlb.com/redsox/ballpark/facts-figures'},'notes':'Field/stand/Green Monster map geometry from OSM. Roof surfaces sampled from all four Boston PDDL stadium components, including the separate lower bowl. Diamond alignment and surface levels interpreted against source geometry; seat rows, signage, lights and brick artwork are original procedural details.'}
 output=ROOT/'src/data/fenway-detail.json';output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(data,separators=(',',':'))+'\n')
 print(f'Wrote {len(features)} mapped features to {output}')
if __name__=='__main__':main()
