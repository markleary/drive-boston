/** Rotating-calipers rectangle: the hull edge direction giving the least area. */
export function orientedBox(points: readonly [number, number][]) {
  let best = { area: Infinity, cx: 0, cz: 0, ux: 1, uz: 0, half: 0, halfPerp: 0 };
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz); if (length < .05) continue;
    const ux = dx / length, uz = dz / length; let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, z] of points) { const u = x * ux + z * uz, v = -x * uz + z * ux; minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) { const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2; best = { area, cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, ux, uz, half: (maxU - minU) / 2, halfPerp: (maxV - minV) / 2 }; }
  }
  return best;
}
