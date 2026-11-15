import type { Road } from '../types';
import type { NPCVehicleType } from './npc-vehicle-specs.ts';

// Survey layer 8 names these main carriageways Charlesbank Road; current OSM
// alignment identifies the Storrow east/west carriageways, not the side street.
export const STORROW_SOURCE_CARRIAGEWAYS:Record<string,'east'|'west'>={'8890-0-0':'west','13519-0-0':'west','13128-0-0':'east','13129-0-0':'east','13133-0-0':'west','13134-0-0':'east','13136-0-0':'west','8541-0-0':'west'};

// Exact source aliases/access pieces confirmed against the retained OSM parkway
// alignments. Keep their local display names at boundary junctions; only NPC
// commercial eligibility changes. Nearby local Mugar/Charles streets remain legal.
export const PARKWAY_RESTRICTED_SOURCE_IDS=new Set([
  '1797-0-0','1798-0-0','7601-0-0','13337-0-0','14322-0-0','14323-0-0','14324-0-0',
  '8457-0-0','13137-0-0','13138-0-0','9170-0-0','9171-0-0','13140-0-0','14372-0-0',
]);

/** Passenger-car parkways, including named access ramps and the
 * Embankment continuation beneath Longfellow. Charlesbank Road is a separate
 * side street and must not inherit the parkway restriction by name. The player is deliberately not
 * subject to this NPC routing rule. Word boundaries avoid unrelated Memorial
 * streets, Soldiers Field Place and commercial streets near these parkways. */
export function isCarsOnlyRoad(road: Pick<Road, 'name'> & Partial<Pick<Road, 'id'|'bridge'|'highway'>>) {
  return Object.hasOwn(STORROW_SOURCE_CARRIAGEWAYS,road.id??'') || PARKWAY_RESTRICTED_SOURCE_IDS.has(road.id??'') || road.highway === 'storrow' || road.bridge?.id === 'storrow' || /^storrow(?:-|$)/i.test(road.id ?? '') ||
    /\b(?:storrow\s+(?:drive|dr)|soldiers?\s+field\s+(?:road|rd)|memorial\s+(?:drive|dr)|embankment\s+(?:road|rd))\b/i.test(road.name);
}

export const npcRoadAllowed = (type: NPCVehicleType, road: Pick<Road, 'name'> & Partial<Pick<Road, 'id'|'bridge'|'highway'>>) => type !== 'box' || !isCarsOnlyRoad(road);
