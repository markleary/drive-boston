import type * as THREE from 'three';
import { ownFarHulls, type MetroCity } from '../simulation/city-tiles.ts';
import type { FarBuilding } from '../simulation/far-format.ts';
import { buildBostonCityHall, CITY_HALL_EAST_ID, CITY_HALL_ID } from './boston-city-hall.ts';
import { buildEncore, ENCORE_ID } from './encore.ts';
import { buildIcaBoston, ICA_ID, insideIcaForecourt } from './ica-boston.ts';
import { buildFishPier, FISH_PIER_BUILDINGS, insideFishPierWorkingArea } from './fish-pier.ts';
import { buildSchrafftCenter, SCHRAFFT_ID, SCHRAFFT_FIRST } from './schrafft-center.ts';
import { buildCitgoSign } from './citgo-sign.ts';
import { buildCastleIsland } from './castle-island.ts';
import { FORT_ID, castleIslandReserved } from '../simulation/castle-island.ts';

export function addArchitecturalLandmarks(scene: THREE.Scene, city: MetroCity, mobile = false) {
  const farHulls = new Set<FarBuilding>(), replaced = new Set<string>();
  const collisions: ReturnType<typeof buildIcaBoston>['collision'][] = [];
  const install = (id: string, model: ReturnType<typeof buildIcaBoston>, hulls: FarBuilding[]) => {
    replaced.add(id);
    for (const hull of hulls) farHulls.add(hull);
    collisions.push(model.collision);
    scene.add(model.group);
  };

  // The far format has no IDs. Match the owner record by its first quantized
  // footprint vertex in the expected tile and avoid suppressing its neighbors.
  const hullAt = (key: string, x: number, z: number) => city.far.tiles.get(key)?.buildings.find(hull =>
    !hull.fragment && hull.footprint.length >= 3 && Math.hypot(hull.footprint[0][0] - x, hull.footprint[0][1] - z) < .14);

  const hall = city.landmarkBuildings.find(building => building.id === CITY_HALL_ID);
  if (hall) {
    const hulls = ownFarHulls(city, hall);
    if (hulls.length) {
      install(CITY_HALL_ID, buildBostonCityHall(city), hulls);
      // The source package records the narrow Congress Street face separately.
      const east = hullAt('1_-2', 1418.246, -1160.619);
      if (east) {
        replaced.add(CITY_HALL_EAST_ID);
        farHulls.add(east);
      }
    }
  }

  const ica = hullAt('2_-1', 2587.643, -308.28);
  if (ica) install(ICA_ID, buildIcaBoston(), [ica]);

  const resort = hullAt('0_-6', 202.779, -4898.949);
  const encore = resort && buildEncore(resort.base);
  if (encore) install(ENCORE_ID, encore, [resort]);

  const fishHulls=FISH_PIER_BUILDINGS.map(source=>hullAt(source.tile,...source.first));
  const fishPier=fishHulls.every(Boolean)?buildFishPier(city):undefined;
  if(fishPier){
    for(const [i,source] of FISH_PIER_BUILDINGS.entries()){replaced.add(source.id);farHulls.add(fishHulls[i]!);}
    collisions.push(fishPier.collision);scene.add(fishPier.group);
  }

  const fort=city.landmarkBuildings.find(b=>b.id===FORT_ID);
  const castleIsland=fort?buildCastleIsland(city):undefined;
  if(fort&&castleIsland){
    install(FORT_ID,castleIsland,ownFarHulls(city,fort));
    // The small interior magazine is included in the authored fort.
    const magazine=hullAt('5_1',5239.612,1250.377);
    if(magazine){replaced.add('BOS-MPJ4Y-KUYWX-M7XYI');farHulls.add(magazine);}
  }

  const factory = hullAt('0_-4', ...SCHRAFFT_FIRST);
  const schrafft = factory && buildSchrafftCenter(mobile);
  if (schrafft) install(SCHRAFFT_ID, schrafft, [factory]);
  // This is an addition above the restored host roof. The source record named
  // “CITGO Sign” is its six-storey building, and must remain in the world.
  const citgo = city.far.tiles.has('-2_0') ? buildCitgoSign(mobile) : undefined;
  if (citgo) { scene.add(citgo.group); collisions.push(citgo.collision); }

  // Fixed-size architectural models stay in the skyline at all detail levels.
  return { replaced, farHulls, collisions, occupied:(x:number,z:number)=>!!ica&&insideIcaForecourt(x,z)||!!fishPier&&insideFishPierWorkingArea(x,z)||!!castleIsland&&castleIslandReserved(x,z), encore, fishPier, castleIsland, schrafft, citgo };
}
