import * as THREE from 'three';
import type { Building, CityData, Point2 } from '../types';
import { pointInside } from '../simulation/roads.ts';
import { sampleElevation } from '../simulation/terrain.ts';
import { waterHeight } from '../simulation/water-level.ts';
import { siteKit, type SiteContext, type SiteKit, type SiteModel } from './site-kit.ts';
import { SITES as CAMPUS } from './sites/campus.ts';
import { SITES as CIVIC } from './sites/civic.ts';
import { SITES as MEDFORD } from './sites/medford.ts';
import { SITES as STATIONS } from './sites/stations.ts';
import { SITES as SQUARES } from './sites/squares.ts';
import { SITES as BROOKLINE } from './sites/brookline.ts';
import { SITES as PARKS } from './sites/parks.ts';
import { SITES as MUSEUMS } from './sites/museums.ts';
import { SITES as CAMBRIDGE } from './sites/cambridge.ts';
import { SITES as SHIPS } from './sites/ships.ts';
import { SITES as GARDEN } from './sites/garden.ts';

/** The hand-built landmarks of the Places to explore list that the survey and OpenStreetMap give only as plain
 * shells (or not at all): each stands in place of its tile building's shell when the tile streams in, or is added
 * with its tile. One module per group under src/render/sites/; the kit they are written with is site-kit.ts. */
export const SITE_MODELS: SiteModel[] = [...CAMPUS, ...MEDFORD, ...CIVIC, ...STATIONS, ...SQUARES, ...BROOKLINE, ...PARKS, ...MUSEUMS, ...CAMBRIDGE, ...SHIPS, ...GARDEN];
const owners = new Map<string, SiteModel>(), hidden = new Set<string>(), additions = new Map<string, SiteModel[]>(), finishes = new Map<string, { wall?: string; roof?: string }>(), plain = new Map<string, THREE.MeshStandardMaterial>();
for (const site of SITE_MODELS) {
  if (site.building) { owners.set(site.building, site); hidden.add(site.building); }
  else additions.set(site.tile, [...additions.get(site.tile) ?? [], site]);
  for (const id of site.replaces ?? []) hidden.add(id);
  for (const [id, finish] of Object.entries(site.finish ?? {})) finishes.set(id, finish);
}
/** The plain finish a site gives a surveyed shell it keeps and dresses, or undefined for the ordinary facade rules. */
export function siteShellMaterial(b: Pick<Building, 'id'> | undefined, isRoof: boolean): THREE.Material | undefined {
  const color = b && finishes.get(b.id)?.[isRoof ? 'roof' : 'wall']; if (!color) return undefined;
  let m = plain.get(color); if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: .88 }); m.name = `site shell ${color}`; plain.set(color, m); } return m;
}
/** Ground a site model stands on or paves beyond any building footprint: nothing is planted there (the tile builder's forecourt test). */
const grounds = SITE_MODELS.flatMap(site => [...(site.at && (site.clear ?? (site.building ? 0 : 4)) > 0 ? [{ at: site.at, r: site.clear ?? 4 }] : []), ...(site.reserved ?? []).map(ring => ({ ring, at: ring[0], r: Math.max(...ring.map(p => Math.hypot(p[0] - ring[0][0], p[1] - ring[0][1]))) }))] as { at: Point2; r: number; ring?: Point2[] }[]);
export const siteReserved = (x: number, z: number) => grounds.some(g => Math.hypot(x - g.at[0], z - g.at[1]) <= g.r && (!g.ring || pointInside([x, z], g.ring)));
const exactShells = new Set(SITE_MODELS.flatMap(site => site.exact ?? []));
/** Kept shells a site opens up: exact collision and a source footing in place of the hull and its skirt. */
export const siteExactShell = (b?: Pick<Building, 'id'>) => !!b && exactShells.has(b.id);
/** Shells with a site finish take no generated windows, storefronts or rooftop plant. */
export const hasSiteFinish = (b?: Pick<Building, 'id'>) => !!b && finishes.has(b.id);
/** The tile builder skips the shell, hull collider, foundation skirt and facade detail of these buildings. */
export const replacesSiteShell = (b?: Pick<Building, 'id'>) => !!b && hidden.has(b.id);
export const siteFor = (b: Pick<Building, 'id'>) => owners.get(b.id);
/** The additions built with a tile (structures no building record stands for). */
export const siteAdditions = (tile: string) => additions.get(tile) ?? [];

export function siteContext(city: CityData, mobile: boolean, k: SiteKit = siteKit(mobile)): SiteContext {
  return {
    city, k, mobile, ground: (x, z) => sampleElevation(city, x, z),
    water: (x, z) => {
      for (const area of city.water ?? []) {
        if (!area.rings[0] || !pointInside([x, z], area.rings[0])) continue;
        const basin = area.surfaces?.find(s => s.rings[0] && pointInside([x, z], s.rings[0]));
        return basin ? basin.level : waterHeight(city, area);
      }
      return undefined;
    },
  };
}
export interface SiteLandmark { group: THREE.Group; collisions: { vertices: Float32Array; indices: Uint32Array }[]; triangles: number; }
/** A site's meshes in a group, and its collider triangles. */
export function buildSite(city: CityData, site: SiteModel, b: Building | undefined, mobile: boolean, k?: SiteKit): SiteLandmark {
  const S = site.build(siteContext(city, mobile, k), b), group = new THREE.Group(); group.name = `Site landmark ${site.name}`; group.userData.site = site.id;
  for (const mesh of S.meshes(group.name)) group.add(mesh);
  const vertices = new Float32Array(S.solid), indices = new Uint32Array(vertices.length / 3); for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { group, collisions: indices.length ? [{ vertices, indices }] : [], triangles: S.triangles };
}
