#!/usr/bin/env python3
"""Level the estimated water-crossing decks of an installed metro package.

Run after merge-metro-extension.py (whose retained baseline roads carry the
per-segment profiles) and before the dedicated bridge builders. Idempotent:
a second run changes nothing. See water_crossings.py for the method.
"""
import argparse,gzip,json,pathlib,sys
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from water_crossings import DECK,TERRAIN_RISE,WATER_REACH,grid_sampler,level_water_crossings,water_inputs


def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data');p.add_argument('--check',action='store_true',help='report without writing');a=p.parse_args()
 city=json.loads((a.data_dir/'city.json').read_text());grid=city['elevation']
 heights=np.frombuffer(gzip.decompress((a.data_dir/grid['file']).read_bytes()),dtype='<i2')*grid.get('scale',.01)
 polygons,water_level=water_inputs(city)
 report=level_water_crossings(city['roads'],polygons,grid_sampler(grid,heights),water_level,apply=not a.check)
 for chain in report['chains']:print('deck',chain['deck'],'lifts',chain['lifts'],'water',chain['waterLevel'],'junctions',chain['junctions'],', '.join(chain['names']),'changed',len(chain['changed']),'of',len(chain['roads']))
 for skipped in report['skipped']:print('skipped',skipped['reason'],', '.join(skipped['names']),skipped.get('by',''),skipped.get('farthestLiftedNodeMeters',''))
 print(f"{len(report['changedRoads'])} roads changed across {len(report['chains'])} water crossings; {len(report['skipped'])} chains left to their builders")
 for chain in report['chains']:
  for crossing in chain['unresolvedCrossings']:print('unresolved',', '.join(chain['names']),'crossed by',crossing['road'],'at the pinned landing, share',crossing['share'])
 if a.check:return
 (a.data_dir/'city.json').write_text(json.dumps(city,separators=(',',':'))+'\n')
 provenance_path=a.data_dir/'provenance.json';provenance=json.loads(provenance_path.read_text())
 provenance['waterCrossingDecks']={'method':'One deck surface per water-crossing chain of lifted nodes: the inverse-distance blend of the chain\'s own at-grade junction heights along the chain, each junction raised as far as the terrain and water under the deck, the terrain under its ramps and any road crossing beneath need on its side; ramps keep their pinned ground landings and never sink into the terrain','deckAboveWaterMeters':DECK,'deckAboveTerrainMeters':TERRAIN_RISE,'liftedNodeReachMeters':WATER_REACH,'heightAccuracy':'Estimated game profiles, not surveyed bridge decks',
  'chains':[{'names':c['names'],'deck':c['deck'],'lifts':c['lifts'],'waterLevel':c['waterLevel'],'roads':c['roads'],**({'unresolvedCrossings':c['unresolvedCrossings']} if c['unresolvedCrossings'] else {})} for c in report['chains']],'skipped':report['skipped']}
 provenance_path.write_text(json.dumps(provenance,separators=(',',':'))+'\n')


if __name__=='__main__':main()
