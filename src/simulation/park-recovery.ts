import type { ParkPath } from '../types';

export interface ParkRecoverySpot {
  x: number;
  z: number;
  yaw: number;
  distance: number;
  path: ParkPath;
}

/** Local path centers, including a little room either side of a blocked
 * projection. Paths are supplied by the currently loaded terrain tiles. */
export function parkRecoveryCandidates(paths: Iterable<ParkPath>, x: number, z: number, reach = 200): ParkRecoverySpot[] {
  const candidates: ParkRecoverySpot[] = [];
  for (const path of paths) {
    if (path.width < 1) continue;
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      if (length < .01) continue;
      const along = Math.max(0, Math.min(length, ((x - a[0]) * dx + (z - a[1]) * dz) / length));
      const px = a[0] + dx * along / length, pz = a[1] + dz * along / length;
      if (Math.hypot(px - x, pz - z) > reach) continue;
      for (const offset of [0, -2, 2, -5, 5]) {
        const d = along + offset;
        if (d < 0 || d > length) continue;
        const sx = a[0] + dx * d / length, sz = a[1] + dz * d / length, distance = Math.hypot(sx - x, sz - z);
        if (distance <= reach) candidates.push({ x: sx, z: sz, yaw: Math.atan2(dx, dz), distance, path });
      }
    }
  }
  return candidates.sort((a, b) => a.distance - b.distance);
}
