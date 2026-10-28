import type { Building } from '../types';
import rules from '../data/building-identities.json' with {type:'json'};

/** Reviewed identities fill gaps in the untextured survey catalog. The data
 * compiler reads these same rules; neither path classifies satellite pixels. */
export const buildingIdentities:Record<string,{name:string;kind:string;landmark:string}>=rules.overrides;
const religiousName=new RegExp(rules.religiousNamePattern,'i'),nonReligiousName=new RegExp(rules.nonReligiousNamePattern,'i');
export function isReligiousBuilding(building:Building):boolean {
  const kind=buildingIdentities[building.id]?.kind??building.kind;
  if(building.amenity==='place_of_worship'||rules.religiousKinds.includes(kind??''))return true;
  return religiousName.test(building.name)&&!nonReligiousName.test(building.name);
}
export const isMissionChurch=(building?:Building)=>!!building&&buildingIdentities[building.id]?.landmark==='mission-church';
