import * as THREE from 'three';
import type { Point2 } from '../../types';
import { course, door, frame, inset, rectPoly, rectWalls, Shapes, signBoard, slope, wallFrames, type SiteModel, type V3, type WallFrame } from '../site-kit.ts';

/** The Harvard Square kiosk (Blackall, Clapp & Whittemore with the Boston Elevated, 1927-28; rebuilt 1984, restored
 * 2020-25 as the Cambridge KiOSK): two glazed pavilions in line under one broad copper roof of crossing barrel
 * vaults with flat corners and deep eaves. The roof is the surveyed one: its 9.3 by 13.5 m plan with rounded corners,
 * the long vault (4.5 m span) and the cross vault over the old passage (2.8 m span, 6.3 m from the south edge), both
 * rising 0.75 m, are read off the packaged shell, and they agree with the published plan (pavilions 3.66 and 4.57 m
 * long, 4.72 m wide, 2.76 m apart). The survey has the roof only 1.1 m over the ground; the eave height (2.85 m to
 * the soffit), the banded piers, the glazing bars and the HARVARD SQUARE lunettes (the historic signs in the roof
 * arches) are drawn from descriptions and are interpretive in their measures. */
const kiosk: SiteModel = {
  id: 'harvard-square-kiosk', name: 'Harvard Square kiosk', place: 'harvard-square', tile: '-4_-3', building: 'CAM_Z61NZ-WO25L-ZDCZ1', replaces: ['CAM_IPPEA-H2A6C-SZ85F', 'CAM_0C034-FUS1X-X99UL'],
  note: 'Blackall, Clapp & Whittemore, 1927-28 subway headhouse (Out of Town News 1984-2019, Cambridge KiOSK 2025); copper cross-vaulted roof on the surveyed plan, published pavilion plan; eave height, piers, glazing and lunette signs interpretive',
  build({ k, mobile }, b) {
    const S = new Shapes(), base = b!.baseElevation ?? 0, foot = base - 1.5, y = (h: number) => base + h;
    // South-west corner of the roof, u east across it (9.31 m), v north along it (13.53 m).
    const f = frame([-3655.94, -2582.25], [-3647.21, -2579.03], [-3651.26, -2594.95]), W = 9.31, L = 13.53, soffit = 2.85, eave = 3.15, rise = .75, r = .85;
    const copper = k.tint('copper', '#76523d'), copperTrim = k.tint('copperPlain', '#6a4937'), wood = k.tint('paleDeck', '#a07a4e'), rafter = k.tint('timber', '#6e4d33'), brick = k.tint('darkBrick', '#703a33'), stone = k.limestone, stoneTrim = k.tint('trim', '#d6cdb8'), granite = k.tint('granite', '#5f6064'), sash = k.tint('blackPaint', '#27302c');
    const outline: Point2[] = [];
    for (const [cu, cv, a0] of [[r, r, Math.PI], [W - r, r, Math.PI * 1.5], [W - r, L - r, 0], [r, L - r, Math.PI / 2]]) for (let i = 0; i <= 4; i++) { const a = a0 + i / 4 * Math.PI / 2; outline.push(f.W(cu + Math.cos(a) * r, cv + Math.sin(a) * r)); }
    // The roof: a flat copper deck at the eaves, the fascia with its dentils, the beadboard soffit.
    S.prism(copper, outline, y(soffit), y(eave), { top: null });
    S.poly(copper, outline.map(p => [p[0], y(eave), p[1]] as V3), [0, 1, 0], p => [f.vOf([p[0], p[2]]) / 2, f.uOf([p[0], p[2]]) / 2], true);
    S.cap(wood, outline, y(soffit), false, false);
    course(S, copperTrim, outline, y(eave) - .02, .09, .05); course(S, copperTrim, outline, y(soffit) + .03, .06, .03);
    for (const w of wallFrames(outline)) if (w.length > 2) for (let s = .15; s < w.length - .05; s += .3) { const [x, z] = w.at(s, .035); S.box(copperTrim, .14, .09, .07, x, y(soffit) + .12, z, w.yaw); }
    // Two barrel vaults of one height cross over the passage: circular segments cut at the levels where they meet.
    const cu = W / 2, cv = 6.3, aL = 2.25, aT = 1.4, RL = (aL * aL + rise * rise) / (2 * rise), RT = (aT * aT + rise * rise) / (2 * rise), n = 8, phi = Math.asin(aT / RT);
    const hL = (u: number) => Math.max(0, Math.sqrt(Math.max(0, RL * RL - (u - cu) ** 2)) - (RL - rise)), hT = (v: number) => Math.max(0, Math.sqrt(Math.max(0, RT * RT - (v - cv) ** 2)) - (RT - rise));
    const wL = (h: number) => Math.sqrt(Math.max(0, RL * RL - (h + RL - rise) ** 2)), wT = (h: number) => Math.sqrt(Math.max(0, RT * RT - (h + RT - rise) ** 2));
    const levels = Array.from({ length: n + 1 }, (_, i) => i === n ? rise : i === 0 ? 0 : RT * Math.cos(phi * (1 - i / n)) - (RT - rise));
    for (let i = 0; i < n; i++) for (const side of [-1, 1]) {
      const h0 = levels[i], h1 = levels[i + 1];
      for (const [end, dir] of [[0, -1], [L, 1]]) slope(S, copper, [f.W(cu + side * wL(h0), end), f.W(cu + side * wL(h1), end), f.W(cu + side * wL(h1), cv + dir * wT(h1)), f.W(cu + side * wL(h0), cv + dir * wT(h0))], p => y(eave) + hL(f.uOf(p)), f.V, [0, 1, 0]);
      for (const [end, dir] of [[0, -1], [W, 1]]) slope(S, copper, [f.W(end, cv + side * wT(h0)), f.W(end, cv + side * wT(h1)), f.W(cu + dir * wL(h1), cv + side * wT(h1)), f.W(cu + dir * wL(h0), cv + side * wT(h0))], p => y(eave) + hT(f.vOf(p)), f.U, [0, 1, 0]);
    }
    // The lunettes closing the four vault ends at the roof's edge: back-lit signs, red letters on a light ground.
    const edge = rectWalls(f, { u0: 0, u1: W, v0: 0, v1: L }), px = mobile ? 96 : 160;
    const lunette = (w: WallFrame, mid: number, a: number, R: number, tw: number, th: number, tb: number) => {
      const sign = k.sign('HARVARD SQUARE', { color: '#a3261d', background: '#ece3cc', aspect: tw / th, font: `600 ${Math.round(px * .5)}px Georgia, serif`, lit: true }), ph = Math.asin(a / R);
      const P = (i: number, out: number, up = 0): V3 => { const t = ph * (1 - i / 8), [x, z] = w.at(mid + R * Math.sin(t), out); return [x, y(eave) + R * Math.cos(t) - (R - rise) + up, z]; };
      S.poly(sign, Array.from({ length: 17 }, (_, i) => P(i, .02)), [w.n[0], 0, w.n[1]], p => [((p[0] - w.a[0]) * w.t[0] + (p[2] - w.a[1]) * w.t[1] - (mid - tw / 2)) / tw, (p[1] - y(eave) - tb) / th]);
      for (let i = 0; i < 16; i++) S.beam(copperTrim, P(i, .03, .03), P(i + 1, .03, .03), .16, .1);
    };
    lunette(edge.front, cu, aL, RL, 3.6, .6, .02); lunette(edge.back, cu, aL, RL, 3.6, .6, .02); lunette(edge.right, cv, aT, RT, 2.5, .42, .06); lunette(edge.left, L - cv, aT, RT, 2.5, .42, .06);
    // The enclosure: a polished granite base, a low brick wall with a limestone sill, glass to the roof.
    const E = { u0: cu - 2.36, u1: cu + 2.36, v0: 1.27, v1: 12.26 }, ep = rectPoly(f, E), ew = rectWalls(f, E), sill = .9, head = 2.62;
    S.prism(granite, ep, foot, y(.28), { top: null }); S.prism(brick, inset(ep, -.04), y(.28), y(sill - .06), { top: null }); course(S, stoneTrim, inset(ep, -.04), y(sill - .03), .07, .05);
    S.solidBox(E.u1 - E.u0, E.v1 - E.v0, ...f.W(cu, (E.v0 + E.v1) / 2), foot, y(soffit), f.yaw);
    const bay = (w: WallFrame, s0: number, s1: number, doors: boolean) => {
      const mid = (s0 + s1) / 2, bottom = doors ? .04 : sill, [gx, gz] = w.at(mid, -.08), [hx, hz] = w.at(mid, -.04), panes = Math.max(2, Math.round((s1 - s0) / .92));
      S.place(k.shopGlass, new THREE.PlaneGeometry(s1 - s0, head - bottom), gx, y((bottom + head) / 2), gz, w.yaw);
      S.box(copperTrim, s1 - s0, soffit - head, .14, hx, y((head + soffit) / 2), hz, w.yaw);
      for (let i = 0; i <= panes; i++) { const [x, z] = w.at(s0 + (s1 - s0) * i / panes, -.05); S.box(sash, .05, head - bottom, .07, x, y((bottom + head) / 2), z, w.yaw); }
      for (const h of [bottom + .03, 2.12, head - .03]) S.box(sash, s1 - s0, .05, .07, hx, y(h), hz, w.yaw);
      if (doors) door(S, k, w, mid, y(.04), 1.7, 2.08, { glazed: true, leaf: sash, frame: sash });
    };
    // Piers at the corners of both pavilions: waterstruck brick banded with limestone on a granite foot.
    const pier = .5, stations = [E.v0, 4.93 - pier, 7.69, E.v1 - pier];
    for (const v of stations) for (const u of [E.u0 - .02, E.u1 - pier + .02]) {
      const [x, z] = f.W(u + pier / 2, v + pier / 2); S.block(granite, pier + .06, pier + .06, x, z, foot, y(.3), f.yaw);
      for (let h = .3, i = 0; h < soffit - .01; i++) { const top = Math.min(soffit, h + (i % 2 ? .19 : .33)); S.block(i % 2 ? stone : brick, pier + (i % 2 ? .03 : 0), pier + (i % 2 ? .03 : 0), x, z, y(h), y(top), f.yaw, { top: null }); h = top; }
    }
    for (const w of [ew.left, ew.right]) { const along = (v: number) => w === ew.right ? v - E.v0 : E.v1 - v, span = (a: number, c: number, doors: boolean) => bay(w, Math.min(along(a), along(c)), Math.max(along(a), along(c)), doors); span(E.v0 + pier, 4.93 - pier, false); span(4.93, 7.69, true); span(7.69 + pier, E.v1 - pier, false); }
    for (const w of [ew.front, ew.back]) bay(w, pier, w.length - pier, false);
    // Shallow rafters under the eaves and the pendant lamps of the overhang.
    const under = y(soffit) - .04, R3 = (u: number, v: number): V3 => { const [x, z] = f.W(u, v); return [x, under, z]; };
    for (let v = 1.1; v < L - 1; v += .9) { S.beam(rafter, R3(E.u0, v), R3(.06, v), .07, .08); S.beam(rafter, R3(E.u1, v), R3(W - .06, v), .07, .08); }
    for (let u = E.u0 + .3; u < E.u1; u += .9) { S.beam(rafter, R3(u, E.v0), R3(u, .06), .07, .08); S.beam(rafter, R3(u, E.v1), R3(u, L - .06), .07, .08); }
    for (const [u, v, eu, ev] of [[.3, .3, E.u0, E.v0], [W - .3, .3, E.u1, E.v0], [W - .3, L - .3, E.u1, E.v1], [.3, L - .3, E.u0, E.v1]]) S.beam(rafter, R3(eu, ev), R3(u, v), .07, .08);
    for (const [u, v] of [[1.15, 3.1], [1.15, cv], [1.15, 9.9], [W - 1.15, 3.1], [W - 1.15, cv], [W - 1.15, 9.9], [cu, .62], [cu, L - .62]]) { const [x, z] = f.W(u, v); S.rod(k.iron, [x, y(soffit), z], [x, y(soffit) - .28, z], .015); S.place(k.bulb, new THREE.SphereGeometry(.11, 10, 8), x, y(soffit) - .36, z); S.place(k.iron, new THREE.ConeGeometry(.16, .1, 10), x, y(soffit) - .25, z); }
    return S;
  },
};
/** Porter Square station headhouse (Cambridge Seven Associates, about 1982, opened 1984): a glass shed on a white steel
 * frame over the escalators. The massing is the surveyed shell's: a ridge 16.5 m long and 6.8 m high, the main glazed
 * roof falling south from it at 33 degrees to a 2.9 m eave over a plan cut off diagonally toward the avenue, and a
 * 3 m lean-to falling north from the western half of the ridge. Glazing bars, the concrete plinth, the doors on
 * the lean-to and the station sign are interpretive. */
const porter: SiteModel = {
  id: 'porter-square-headhouse', name: 'Porter Square station headhouse', place: 'porter-square', tile: '-4_-5', building: 'CAM_63FZX-979GG-TMKCL',
  note: 'Cambridge Seven Associates, about 1982 (station opened 1984): glass and concrete headhouse; two opposed single-pitch glazed roofs on the surveyed outline and heights; frame, doors and sign interpretive',
  build({ k, mobile, ground }, b) {
    const S = new Shapes(), base = b!.baseElevation ?? 0, foot = base - 1.5, y = (h: number) => base + h;
    // East end of the ridge, u west-north-west along it (16.46 m), v south down the main roof (5.98 m).
    const f = frame([-3664.24, -4232.44], [-3678.94, -4239.84], [-3666.93, -4227.1]), R = 16.46, D = 5.98, N = 2.97, J = 8.18, C = 10.92, top = 6.76, plinth = .9;
    const glass = k.curtainWall, steel = k.whitePaint, concrete = k.concrete, roofH = (v: number) => v >= 0 ? top - (top - 2.9) * v / D : top + (top - 4.6) * v / N;
    const P = (u: number, v: number, h = roofH(v)): V3 => { const [x, z] = f.W(u, v); return [x, y(h), z]; };
    // The walls in order round the plan: a concrete plinth, glass above it, white mullions and transoms, a steel edge beam.
    const corners: [number, number][] = [[0, 0], [0, D], [C, D], [R, 0], [R, -N], [J, -N], [J, 0]], plan = corners.map(([u, v]) => f.W(u, v)), frames = wallFrames(plan);
    frames.forEach((w, i) => {
      const va = corners[i][1], vb = corners[(i + 1) % corners.length][1], flip = Math.hypot(w.a[0] - plan[i][0], w.a[1] - plan[i][1]) > .01, h0 = roofH(flip ? vb : va), h1 = roofH(flip ? va : vb), hs = (s: number) => h0 + (h1 - h0) * s / w.length;
      S.wall(concrete, w.a, w.b, foot, y(plinth), y(plinth), w.n); S.wall(glass, w.a, w.b, y(plinth), y(h0), y(h1), w.n);
      const at = (s: number, h: number, out = .06): V3 => { const [x, z] = w.at(s, out); return [x, y(h), z]; }, bays = Math.max(1, Math.round(w.length / 1.4));
      for (let j = 0; j <= bays; j++) { const s = w.length * j / bays; S.beam(steel, at(s, plinth), at(s, hs(s)), .09, .12); }
      for (const level of [2.75, 4.7]) { const s = [0, w.length].map(e => hs(e) >= level ? e : (level - h0) / (h1 - h0) * w.length); if (Math.abs(s[1] - s[0]) > .3 && Math.max(h0, h1) > level + .2) S.beam(steel, at(s[0], level), at(s[1], level), .1, .08); }
      S.beam(steel, at(0, h0 - .08, .04), at(w.length, h1 - .08, .04), .2, .22); S.beam(concrete, at(0, plinth, .03), at(w.length, plinth, .03), .1, .08);
    });
    // Both roofs: glass on white rafters and purlins, the ridge beam between them.
    S.poly(glass, [P(0, 0), P(R, 0), P(C, D), P(0, D)], [0, 1, 0], undefined, true); S.poly(glass, [P(J, 0), P(R, 0), P(R, -N), P(J, -N)], [0, 1, 0], undefined, true);
    const lift = (p: V3, h = .06): V3 => [p[0], p[1] + h, p[2]];
    for (let j = 0; j <= 12; j++) { const u = R * j / 12, v = u <= C ? D : D * (R - u) / (R - C); if (v > .2) S.beam(steel, lift(P(u, 0)), lift(P(u, v)), .09, .12); if (u >= J - .01) S.beam(steel, lift(P(u, 0)), lift(P(u, -N)), .09, .12); }
    for (const v of [D / 3, D * 2 / 3]) S.beam(steel, lift(P(0, v)), lift(P(R - (R - C) * v / D, v)), .08, .1);
    S.beam(steel, lift(P(J, -N / 2)), lift(P(R, -N / 2)), .08, .1); S.beam(steel, lift(P(0, 0), .1), lift(P(R, 0), .1), .24, .22);
    S.beam(steel, lift(P(C, D)), lift(P(R, 0)), .16, .16); S.beam(steel, lift(P(0, D)), lift(P(C, D)), .16, .16); S.beam(steel, lift(P(J, -N)), lift(P(R, -N)), .16, .16);
    // The entrance on the lean-to, facing the plaza, under the station's name.
    const north = frames[4], px = mobile ? 96 : 160, sill = Math.max(...[.3, .7].map(t => ground(...north.at(north.length * t, .4)))) + .03 - base;
    for (const s of [north.length * .3, north.length * .7]) door(S, k, north, s, y(sill), 1.8, 2.3, { glazed: true, leaf: k.steel, frame: k.steel });
    signBoard(S, k, north, north.length / 2, y(sill + 3), 3.4, .5, 'PORTER', { color: '#ffffff', background: '#1b1b1b', font: `700 ${Math.round(px * .62)}px Helvetica, Arial, sans-serif`, out: .14, frame: k.blackPaint });
    { const [x, z] = north.at(north.length / 2, .16); S.box(k.redPaint, 3.4, .1, .04, x, y(sill + 2.67), z, north.yaw); }
    return S;
  },
};

/** "Gift of the Wind" (Susumu Shingu, commissioned 1983 for Arts on the Line, unveiled 1985) on the station plaza: a
 * slender white pole carrying three red wings that tumble about their own axes while the head turns with the wind.
 * Published: 46 ft by 23 ft overall (14 m high, the head 7 m across), steel and aluminium, three half-disk wings on
 * one plane twisted to different angles. The pole's taper, the tilt of the head and the wings' outline are
 * interpretive, as is the exact spot (the brief's coordinates to four decimals, kept clear of the avenue's sidewalk);
 * it is drawn in its intended red, not the faded paint of 2026, and it does not turn. */
const gift: SiteModel = {
  id: 'gift-of-the-wind', name: 'Gift of the Wind', place: 'porter-square', tile: '-4_-5', at: [-3682.5, -4246],
  note: 'Susumu Shingu, 1983-85, kinetic sculpture of the MBTA Arts on the Line: white pole 10.5 m to the hub, three red half-disk wings, 14 m by 7 m overall as published; wing outline, tilt and exact position interpretive; static',
  build({ k, ground }) {
    const S = new Shapes(), [x, z] = gift.at!, base = ground(x, z), y = (h: number) => base + h, white = k.whitePaint, red = k.tint('redPaint', '#b9251c'), hubY = 10.5;
    S.drum(k.granite, x, z, .6, .6, base - 1.5, y(.18), 16); S.rod(white, [x, y(.18), z], [x, y(hubY - .5), z], .2, .1, 16); S.rod(white, [x, y(.18), z], [x, y(.5), z], .27, .22, 16); S.solidBox(.45, .45, x, z, base - 1.5, y(hubY));
    // The head: its plane leans back 25 degrees from the vertical and faces west-south-west down the avenue.
    const lean = 65 * Math.PI / 180, heading = -1.9, hx = Math.sin(heading), hz = Math.cos(heading), Nn = new THREE.Vector3(Math.sin(lean) * hx, Math.cos(lean), Math.sin(lean) * hz), A = new THREE.Vector3(hz, 0, -hx), B = new THREE.Vector3().crossVectors(Nn, A).normalize();
    if (B.y < 0) B.negate();
    const hub = new THREE.Vector3(x, y(hubY), z).addScaledVector(Nn, .45), v3 = (p: THREE.Vector3): V3 => [p.x, p.y, p.z];
    S.rod(white, [x, y(hubY - .5), z], [x, y(hubY - .1), z], .1, .09, 12); S.rod(white, [x, y(hubY - .12), z], v3(hub), .09, .08, 10); S.place(white, new THREE.SphereGeometry(.2, 12, 10), hub.x, hub.y, hub.z);
    const twists = [.2, 1.0, -.75];
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + .3 + i * Math.PI * 2 / 3, d = A.clone().multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a)), across = new THREE.Vector3().crossVectors(Nn, d).normalize(), p = across.clone().multiplyScalar(Math.cos(twists[i])).addScaledVector(Nn, Math.sin(twists[i])), n = new THREE.Vector3().crossVectors(d, p);
      S.rod(white, v3(hub), v3(hub.clone().addScaledVector(d, 3.5)), .06, .04, 8);
      // A half disk 3.1 m long on the arm, its straight edge drawn in a little so that both ends come to points.
      const wing = new THREE.Shape(); wing.moveTo(-1.55, -.12); wing.absarc(0, -.12, 1.55, Math.PI, 0, true); wing.quadraticCurveTo(0, .5, -1.55, -.12);
      const g = new THREE.ExtrudeGeometry(wing, { depth: .05, bevelEnabled: false, curveSegments: 20 }); g.translate(0, 0, -.025);
      g.applyMatrix4(new THREE.Matrix4().makeBasis(d, p, n).setPosition(hub.clone().addScaledVector(d, 1.95))); S.place(red, g, 0, 0, 0);
      for (const t of [.42, 3.48]) { const c = hub.clone().addScaledVector(d, t); S.place(white, new THREE.SphereGeometry(.09, 8, 6), c.x, c.y, c.z); }
    }
    return S;
  },
};
/** The Kendall/MIT Gateway headhouse on the south side of Main Street (NADAAA with Perkins&Will, opened 2023): a
 * wing-like canopy, a fibre-reinforced shell with a keel-like spine, on a field of slender steel columns over
 * prismatic glass enclosures. The plan (48.4 m tip to tip, 9.9 m across the rounded middle), the rim 8.1 m and the
 * crown 9.3 m over the plaza are the surveyed shell's, as are the places of the tall elevator enclosure by the east
 * rim and the low one at the north tip; the published length is 48.5 m and the columns about 7.9 m. Where each column
 * stands, the third (escalator) enclosure, their cant and the soffit's light strips are interpretive. */
const kendall: SiteModel = {
  id: 'kendall-mit-gateway', name: 'Kendall/MIT Gateway headhouse', place: 'kendall-square', tile: '-1_-2', building: 'CAM_418Y5-9YD7C-S0P76',
  note: 'NADAAA with Perkins&Will, 2023: monocoque canopy on slender steel columns over three fritted glass enclosures; canopy plan and heights from the surveyed shell (48.4 m long, as published); columns and enclosures partly interpretive',
  build({ k }, b) {
    const S = new Shapes(), base = b!.baseElevation ?? 0, foot = base - 1.5, y = (h: number) => base + h;
    // South tip, u north-north-east along the spine to the tip by Main Street (48.4 m), v east.
    const f = frame([-952.25, -1300.94], [-936.87, -1346.9], [-939.6, -1323.3]), Ln = 48.4, mid = 24.2, rim = 8.13, under = 7.8, crown = 9.33;
    const shell = k.tint('whitePaint', '#e3e5e4'), soffit = k.tint('whiteSash', '#bcc3c6'), steel = k.tint('whitePaint', '#cdd1d2'), glass = k.tint('whiteSash', '#c3d2d3'), P = (u: number, v: number, h: number): V3 => { const [x, z] = f.W(u, v); return [x, y(h), z]; };
    // Rim half-widths west and east at stations along the spine, read off the shell (straight flanks, a rounded middle).
    const U = [0, 4.7, 9.4, 14.1, 18.8, 21.4, 24.2, 27, 29.6, 34.3, 39, 43.7, Ln], west = [0, 1.13, 2.26, 3.39, 4.5, 4.85, 5, 4.72, 4.25, 3.19, 2.13, 1.06, 0], east = [0, 1.02, 2.04, 3.05, 4.07, 4.65, 4.9, 4.75, 4.33, 3.25, 2.17, 1.08, 0];
    const spine = (u: number) => rim + (crown - rim) * (1 - ((u - mid) / mid) ** 2), inner = (u: number, v: number): [number, number] => [mid + (u - mid) * .95, v * .82];
    for (const [side, w] of [[-1, west], [1, east]] as [number, number[]][]) for (let i = 0; i + 1 < U.length; i++) {
      const a = P(U[i], side * w[i], rim), c = P(U[i + 1], side * w[i + 1], rim), sa = P(U[i], 0, spine(U[i])), sc = P(U[i + 1], 0, spine(U[i + 1]));
      if (i + 2 < U.length) S.poly(shell, [a, c, sc], [0, 1, 0], undefined, true); if (i > 0) S.poly(shell, [a, sc, sa], [0, 1, 0], undefined, true);
      // The thin edge and the bevel under it down to the flat belly.
      const a0 = P(U[i], side * w[i], rim - .1), c0 = P(U[i + 1], side * w[i + 1], rim - .1), ia = P(...inner(U[i], side * w[i]), under), ic = P(...inner(U[i + 1], side * w[i + 1]), under), out: V3 = [f.V[0] * side, 0, f.V[1] * side];
      S.poly(shell, [a0, c0, c, a], out); S.poly(soffit, [ia, ic, c0, a0], [out[0], -1.5, out[2]]);
    }
    S.poly(soffit, [...U.map((u, i) => P(...inner(u, -west[i]), under)), ...U.slice(1, -1).reverse().map((u, i) => P(...inner(u, east[U.length - 2 - i]), under))], [0, -1, 0]);
    for (const [u0, u1, v] of [[6, 43, 0], [14, 35, -2.3], [14, 35, 2.3]]) S.beam(k.lamp, P(u0, v, under - .02), P(u1, v, under - .02), .1, .03);
    // The field of columns, stouter toward the middle.
    for (const [u, v, r] of [[5.5, 0, .09], [9, .9, .1], [9.5, -1.2, .1], [13, 1.7, .11], [17.5, 2.6, .12], [20.5, 1, .14], [23.6, -3.6, .14], [24.3, .3, .16], [24.6, 3.6, .14], [28, -2.8, .14], [28.6, -.1, .15], [33.5, -1.7, .12], [34.6, 1.8, .12], [38.6, .6, .1], [43, .5, .09]]) {
      const [x, z] = f.W(u, v); S.rod(steel, [x, foot, z], [x, y(under), z], r, r, 12); S.solidBox(r * 2.2, r * 2.2, x, z, foot, y(under), f.yaw);
    }
    // The glass enclosures of elevator, stair and escalator: canted prisms with steel edges.
    const prismatic = (plan: [number, number][], tops: number[], cant: [number, number]) => {
      const low = plan.map(([u, v]) => P(u, v, 0)), high = plan.map(([u, v], i) => P(u + cant[0], v + cant[1], tops[i])), cu = plan.reduce((t, p) => t + p[0], 0) / plan.length, cv = plan.reduce((t, p) => t + p[1], 0) / plan.length;
      for (let i = 0; i < plan.length; i++) {
        const j = (i + 1) % plan.length, [mx, mz] = f.W((plan[i][0] + plan[j][0]) / 2 - cu, (plan[i][1] + plan[j][1]) / 2 - cv), [ox, oz] = f.W(0, 0), out: V3 = [mx - ox, 0, mz - oz], a: V3 = [low[i][0], foot, low[i][2]], c: V3 = [low[j][0], foot, low[j][2]];
        S.poly(glass, [a, c, high[j]], out, undefined, true); S.poly(glass, [a, high[j], high[i]], out, undefined, true);
        S.beam(steel, low[i], high[i], .08, .08); S.beam(steel, high[i], high[j], .08, .08); S.beam(k.concrete, low[i], low[j], .16, .3);
      }
      for (let i = 1; i + 1 < plan.length; i++) S.poly(glass, [high[0], high[i], high[i + 1]], [0, 1, 0], undefined, true);
    };
    prismatic([[26.2, 1.4], [31.8, 1], [32.1, 4.6], [26.2, 5.8]], [6.2, 6.2, 6.2, 6.2], [.35, -.25]);
    prismatic([[37, -2.7], [46.6, -5], [47.6, -.3], [39, -1.9]], [2.76, 2.76, 3.36, 2.2], [-.2, .25]);
    prismatic([[11, -2.3], [22, -3.6], [22.4, -.2], [11.4, .3]], [1.5, 3.6, 3.6, 1.5], [.2, .2]);
    return S;
  },
};
export const SITES: SiteModel[] = [kiosk, porter, gift, kendall];
