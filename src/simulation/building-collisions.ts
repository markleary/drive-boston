import type { Building } from '../types';

/** Complex survey meshes whose convex footprint fills a real street or courtyard.
 * Use their original triangles for collision, preserving concave openings. */
export const meshBuildingIds = new Set([
  'BOS-KBIA4-2XA04-WNETP', // Prudential complex across Huntington Avenue
  'BOS-Q6TUK-T7ZG3-2SJKK', // 145 Dartmouth / Back Bay approach
  'BOS-73AP7-T4BL0-O4QDM', // Fenway's open field and surrounding stands
  'BOS-2E9SM-83L3W-UVT08', // Zakim Bridge with its Charlestown viaduct: a structure, driven under
  'BOS-4WO5X-6OJI5-G5S26', // Logan terminals and garages around the terminal road loop
  'BOS-HO11N-VJBYE-3RDXF', // BUMC ambulatory care center: an overhead link across Massachusetts Avenue
  'BOS-3R76C-CGBE8-V3V1H', // NEXUS at the Allston Innovation Corridor: an L around Western Avenue
  'BOS-0RY4U-KSQW8-OJPEA', // The Merano: concave survey around the Central Artery approaches
  'BOS-Q6LOF-Q1HSG-INZ97', // One Canal podium alongside the southbound tunnel approach
]);

/** Compiled road-overlap metadata extends the hand-reviewed legacy exceptions. */
export function usesExactBuildingCollision(building: Pick<Building, 'id' | 'collision'>): boolean {
  return building.collision === 'mesh' || meshBuildingIds.has(building.id);
}
