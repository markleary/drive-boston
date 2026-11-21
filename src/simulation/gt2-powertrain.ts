/** Maserati GT2 Stradale: the Nettuno V6, its eight-speed dual-clutch gearbox and its aerodynamics, from Maserati's
 * press kit. See public/models/PLAYER_CARS.md for the sources and for what is calibrated instead of published. */
export const GT2 = {
  wheelRadius: .3455, // 305/30 R20, the driven tyre
  ratios: [2.905, 1.759, 1.220, .878, .653, .508, .397, .329],
  reverse: 2.632,
  finalDrive: 5.174,
  shiftRpm: 7800,
  redline: 8000,
  idle: 900,
  power: 471000, // 640 PS at 7,500 rpm
  powerRpm: 7500,
  peakTorque: 720, // Nm from 3,000 to 5,500 rpm
  plateau: [3000, 5500],
  /** Downforce (N) per (m/s)^2: 500 kg at 280 km/h with the wing in its high position, 130 kg of it on the front axle. */
  downforce: 500 * 9.81 / (280 / 3.6) ** 2,
  frontShare: 130 / 500,
  /** Front and rear overhang (m): the body is 4.669 m long on a 2.700 m wheelbase. */
  overhang: [1.076, .893],
} as const;
const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));

/** Engine rpm per m/s of road speed with a clutch closed. */
export function gt2Gearing(gear: number) {
  const ratio = gear < 0 ? GT2.reverse : GT2.ratios[clamp(gear, 1, 8) - 1];
  return ratio * GT2.finalDrive * 60 / (2 * Math.PI * GT2.wheelRadius);
}

/** The gearbox left to itself. A light pedal takes the next gear early and lets the revs fall low; a full one runs
 * to the shift lights and kicks down until the engine is above 5,000 rpm; a lift holds the gear for engine braking. */
export function gt2Gear(speed: number, previous: number, pedal: number) {
  let gear = clamp(previous, 1, 8);
  const load = clamp(pedal), upRpm = load > .05 ? 1900 + (GT2.shiftRpm - 1900) * load ** 1.6 : GT2.shiftRpm, downRpm = 1200 + 3800 * load ** 1.5;
  while (gear < 8 && speed * gt2Gearing(gear) > upRpm) gear++;
  while (gear > 1 && speed * gt2Gearing(gear) < downRpm && speed * gt2Gearing(gear - 1) < upRpm - 450) gear--;
  return gear;
}

/** Engine speed: the road's through the gear, or what the clutch slips at when the car moves off. */
export function gt2Rpm(speed: number, gear: number, pedal: number) {
  const slipping = GT2.idle + (gear <= 1 ? 2700 * Math.abs(pedal) : 0);
  return Math.min(GT2.redline, Math.max(slipping, Math.abs(speed) * gt2Gearing(gear)));
}

/** Fraction of full boost. The two turbochargers follow the exhaust flow: nothing below 1,400 rpm, all of it from
 * 2,800, a fifth of a second to build and less to fall when the pedal lifts. A gear change does not drop it. */
export function gt2Boost(previous: number, rpm: number, load: number, dt: number) {
  const target = clamp((rpm - 1400) / 1400) * clamp((load - .12) / .88);
  return previous + (target - previous) * (1 - Math.exp(-dt / (target > previous ? .17 : .09)));
}

/** Nm at full pedal. The published plateau runs from 3,000 to 5,500 rpm; above it the curve passes through the rated
 * power at 7,500 rpm and falls away to the limiter. Off boost the 3.0 litres give about half. */
export function gt2Torque(rpm: number, boost: number) {
  const [from, to] = GT2.plateau, atPower = GT2.power / (GT2.powerRpm * Math.PI / 30);
  const full = rpm < from ? GT2.peakTorque * (.62 + .38 * clamp((rpm - 1200) / (from - 1200)))
    : rpm <= to ? GT2.peakTorque
    : rpm <= GT2.powerRpm ? GT2.peakTorque + (atPower - GT2.peakTorque) * (rpm - to) / (GT2.powerRpm - to)
    : atPower - 70 * (rpm - GT2.powerRpm) / (GT2.redline - GT2.powerRpm);
  return full * (.5 + .5 * clamp(boost));
}

/** Aerodynamic load (N) pressing the car onto the road at a speed (m/s). */
export const gt2Downforce = (speed: number) => GT2.downforce * speed * speed;
