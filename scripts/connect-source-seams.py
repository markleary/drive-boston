#!/usr/bin/env python3
"""Recompile source-boundary road links in an installed package before street surfaces.

First a street that both sources carry is left with one record (source_seams.source_copies:
a town way lying along Boston segments all along, or a Boston segment lying along a
town way, leaves the package and is kept in provenance.sourceCopies).

Then three kinds of join, all from the original OpenStreetMap geometry: town
streets the district clipping split at a line between two towns, carried along
their source ways to the street they meet (source_seams.town_seams), and bridges
it split there carried across as one deck (source_seams.town_bridge_joints); the water
crossings that the clipping dropped between two road ends
(source_seams.restore_clipped_spans); and the short seams where a town way meets
the Boston segment it continues (source_seams.connect_source_seams). Last, a
bridge the edge of the map cuts mid-span is held level from its landing
(source_seams.edge_bridge_stubs). Rerunning undoes all of it and computes it again."""
import argparse,gzip,importlib.util,json,pathlib
import numpy as np
from shapely.geometry import LineString,Polygon
from shapely.ops import unary_union
from source_seams import COPY_ALIGNED,COPY_REACH,EDGE_STUB_GRADE,EDGE_STUB_TOUCH,SEAM_REACH,SEAM_TOUCH,SEAM_ZONE,SPAN_COVER,SPAN_OVERLAP,SPAN_REACH,SPAN_SNAP,SPAN_WET,connect_source_seams,edge_bridge_stubs,restore_clipped_spans,restore_source_copies,source_copies,town_bridge_joints,town_seams,unrestore_clipped_spans,unrestore_town_seams
from road_tiles import refresh_road_tiles
from water_crossings import grid_sampler

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data-dir',type=pathlib.Path,default=pathlib.Path('public/data'));p.add_argument('--source-dir',type=pathlib.Path,default=pathlib.Path('data-source-cache'));a=p.parse_args()
 spec=importlib.util.spec_from_file_location('metro',pathlib.Path(__file__).with_name('build-metro.py'));metro=importlib.util.module_from_spec(spec);spec.loader.exec_module(metro)
 sources={};ways={}
 for path in sorted(a.source_dir.glob('osm-*-roads.json')):
  for e in json.loads(path.read_text())['elements']:
   points=[metro.xy(p['lon'],p['lat']) for p in e.get('geometry',[])]
   if len(points)<2:continue
   sources[str(e['id'])]=LineString(points);tags=e.get('tags',{})
   # The classes and layers build-metro.py imports as town streets.
   if e.get('type')=='way' and tags.get('highway') in metro.OSM_WIDTHS and tags.get('area')!='yes' and tags.get('tunnel') in (None,'no') and metro.source_layer(tags)>=0:ways[str(e['id'])]=(sources[str(e['id'])],tags)
 if not sources:raise SystemExit(f'No original OSM road geometry in {a.source_dir}; no package changes made.')
 path=a.data_dir/'city.json';city=json.loads(path.read_text());grid=city['elevation'];ground=grid_sampler(grid,np.frombuffer(gzip.decompress((a.data_dir/grid['file']).read_bytes()),dtype='<i2')*grid.get('scale',.01))
 # Undo the last run in reverse order: links, then spans (their terminals are the joined ends), then town seams.
 removed=[r['id'] for r in city['roads'] if r.get('sourceSeam')];city['roads']=[r for r in city['roads'] if not r.get('sourceSeam')]
 removed+=unrestore_clipped_spans(city['roads']);restored=set(unrestore_town_seams(city['roads']))
 # A street both sources carry keeps one record, before anything is joined to it (an earlier run's copies go back first, each at its place).
 provenance_path=a.data_dir/'provenance.json';provenance=json.loads(provenance_path.read_text())
 restore_source_copies(city['roads'],provenance.get('sourceCopies'));city['roads'],copies,held=source_copies(city['roads'])
 gone={c['road']['id'] for c in copies};removed+=sorted(gone)
 towns={n['name']:unary_union([Polygon(ring).buffer(0) for ring in n['rings']]) for n in city['neighborhoods'] if n.get('town')}
 joins=town_seams(city['roads'],sources,towns);decks=town_bridge_joints(city['roads'],towns)
 districts=unary_union([Polygon(ring).buffer(0) for n in city['neighborhoods'] for ring in n['rings']])
 water=unary_union([Polygon(w['rings'][0],w['rings'][1:]).buffer(0) for w in city['water']])
 spans=restore_clipped_spans(city['roads'],ways,districts,water,ground,lambda tags:metro.road_width(tags,metro.OSM_WIDTHS[tags['highway']]))
 links=connect_source_seams(city['roads'],sources,ground)
 # Last, once the spans and links have joined the ends they reach: bridges the edge of the map cuts mid-span.
 edges=edge_bridge_stubs(city['roads'],districts);changed=restored|{r['id'] for r in city['roads'] if r.get('townSeam')}
 # Roads sharing an id with a changed one (or with a copy that left) are refreshed with it, so a clipped way's other piece keeps its tiles.
 refresh_road_tiles(a.data_dir,city,spans+links+[r for r in city['roads'] if r['id'] in changed|gone],removed)
 path.write_text(json.dumps(city,separators=(',',':'))+'\n')
 crossings=[]
 for road in spans:
  record=road['clippedSpan']
  if not crossings or crossings[-1]['terminals']!=record['terminals']:crossings.append({'name':road['name'],'roads':[],'ways':record['ways'],'terminals':record['terminals'],'length':0})
  crossings[-1]['roads'].append(road['id']);crossings[-1]['length']=round(crossings[-1]['length']+LineString(road['points']).length,3)
 provenance['sourceCopies']={'method':'A street that both sources carry keeps one record: a surface OpenStreetMap town road lying within the reach of surface Boston segments all along its own length and running their way leaves the package, then a Boston segment lying the same way along the town roads still there (the stub of a town street); a copy stays, held, when a road meets it at a vertex the record it copies does not have',
  'reachMeters':COPY_REACH,'alignment':COPY_ALIGNED,'removed':copies,'held':held}
 provenance['clippedWaterSpans']={'method':'Stretches of OpenStreetMap ways that the district clipping dropped (MassGIS town outlines stop at the shores of the tidal rivers), restored as deck pieces where they form one path between two dangling road ends and cross mapped water; deck roads they join get a lifted joining end so the water-crossing step levels each bridge as one chain',
  'coverMeters':SPAN_COVER,'overlapMeters':SPAN_OVERLAP,'snapMeters':SPAN_SNAP,'reachMeters':SPAN_REACH,'wetShare':SPAN_WET,'crossings':crossings}
 provenance['townSeams']={'method':'OpenStreetMap streets that the district clipping split at a line between two towns (neighbouring town outlines leave slivers and overlaps, and pieces under 3 m are dropped), each dangling end near a shared edge carried along its source way, and the ways continuing from its end node, to the first package road the path meets: that road\'s end, or a vertex inserted into it for a junction; overlapping pieces of one way cut back to the middle of the overlap',
  'zoneMeters':SEAM_ZONE,'reachMeters':SEAM_REACH,'touchMeters':SEAM_TOUCH,'joins':joins,
  'bridgeJoints':{'method':'Two deck pieces of one OpenStreetMap bridge meeting at ground level within the zone of a shared town edge, with no other road at the joint: the joint lifted and both pieces given the straight line between their outer ends','joints':decks},
  'edgeBridges':{'method':'An OpenStreetMap deck piece ending at ground level at the edge of the districts with no other road there and a steeper average grade than the limit (a bridge the edge of the map cuts mid-span): it and the deck pieces joined to it through lifted joints back to the ground landing held level at the landing height, the edge end lifted','gradeLimit':EDGE_STUB_GRADE,'touchMeters':EDGE_STUB_TOUCH,'bridges':edges}}
 provenance_path.write_text(json.dumps(provenance,separators=(',',':'))+'\n')
 for c in copies:print('source copy out',c['road']['id'],c['road']['name'],f"{LineString(c['road']['points']).length:.1f} m, on",', '.join(c['of']))
 for h in held:print('source copy HELD (a road meets it off the record it copies)',h['road'],'on',', '.join(h['of']),'at',h['vertices'])
 print('town seams',len(joins),'joins:',', '.join(f"{k} {sum(j['kind']==k for j in joins)}" for k in ('continuation','junction','overlap')))
 for d in decks:print('bridge joint',d['road'],d['name'],d['point'],'from',d['sourceJoint'],'to',d['joint'],'m')
 for e in edges:print('edge bridge',' + '.join(e['names']),'held at',e['height'],'m from its landing; edge end was',e['sourceEdge'],'m')
 for c in crossings:print('water span',c['name'],'+'.join(c['roads']),round(c['length'],1),'m joining',' and '.join(t['road'] for t in c['terminals']))
 print(json.dumps([{'id':r['id'],**r['sourceSeam']} for r in links],indent=2))

if __name__=='__main__':main()
