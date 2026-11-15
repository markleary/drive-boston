"""Retire the former survey-datum Museum ramps.

The retained source documents why those roads were wrong: its level -1
Science Park segments were raised onto an unrelated survey slab. Their full
source chains are now storrow-leverett-east/west in boston_highways.py, solved
with the other highways, terrain and buildings. The active north branch is
already leverett-connector-north; a second elevated copy must not be emitted.
"""
KIND='museum-survey-approach'


def repair_approaches(city,source,heights):
 city['roads']=[r for r in city['roads'] if r.get('bridge',{}).get('kind')!=KIND]
 return []


def validate_approaches(city,source,heights):
 assert not any(r.get('bridge',{}).get('kind')==KIND for r in city['roads']),'Rebuild the Museum roads from their source levels'
 # The highway stage may split each source route at its tunnel portals.
 for prefix in ('storrow-leverett-east','storrow-leverett-west'):
  assert any(r['id']==prefix or r['id'].startswith(prefix+'-') for r in city['roads']),f'Missing source-correct Museum connection {prefix}'
