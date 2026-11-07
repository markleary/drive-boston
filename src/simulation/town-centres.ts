import type { Point2 } from '../types';

/** The commercial cores of the northern towns, as capsules around their main
 * streets (world metres): Main Street from Wyoming Avenue to Emerson Street in
 * downtown Melrose, Pleasant Street from Malden Center station to Main Street,
 * Medford Square, and Broadway through Everett Square. Shopfront forecourts
 * (render/town-frontages.ts) and street activity (activity.ts) use them. */
export const TOWN_CENTRES: { name: string; a: Point2; b: Point2; radius: number }[] = [
  { name: 'Downtown Melrose', a: [549, -11261], b: [902, -12073], radius: 110 },
  { name: 'Malden Center', a: [60, -8580], b: [640, -8475], radius: 140 },
  { name: 'Medford Square', a: [-2905, -7555], b: [-2905, -7555], radius: 220 },
  { name: 'Everett Square', a: [1500, -6230], b: [1660, -6480], radius: 130 },
];

export function inTownCentre(p: Point2) {
  return TOWN_CENTRES.some(({ a, b, radius }) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t) <= radius;
  });
}
