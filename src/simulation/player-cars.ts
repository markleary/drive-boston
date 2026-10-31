/** Metres, kilograms, newtons and watts. GT dimensions/performance: McLaren's
 * GT technical specification; unreported tire/drag/damper values are calibrated
 * game approximations, documented in public/models/PLAYER_CARS.md. */
export type PlayerCarId = 'harbor-s4' | 'mclaren-gt';
export const DEFAULT_CAR: PlayerCarId = 'harbor-s4';
export const PLAYER_CARS = {
  'harbor-s4': {
    name:'Harbor S4', description:'Everyday coupe · 60 mph',
    mass:1240, wheelRadius:.34, rearWheelRadius:.34, wheelbase:2.66, track:1.72, rearTrack:1.72,
    suspensionRest:.31, spawnHeight:.78, maxForwardSpeed:60*.44704, maxReverseSpeed:8,
    maxSteering:.52, maxLateralAcceleration:8.5, halfWidth:.85, halfLength:2.02,
    stiffness:32, compression:4.4, relaxation:5.2, travel:.16, friction:1.5,
    linearDamping:.13, brakeForce:12500, power:125000, traction:8400,
  },
  'mclaren-gt': {
    name:'McLaren GT', description:'Twin-turbo V8 · 203 mph · 0–60 in 3.1 s',
    mass:1530, wheelRadius:.33275, rearWheelRadius:.3552, wheelbase:2.675, track:1.671, rearTrack:1.663,
    suspensionRest:.20, spawnHeight:.66, maxForwardSpeed:326/3.6, maxReverseSpeed:10,
    maxSteering:.48, maxLateralAcceleration:11.6, halfWidth:.945, halfLength:2.3415,
    stiffness:58, compression:5.4, relaxation:7.4, travel:.10, friction:2.5,
    linearDamping:0, brakeForce:17900, power:456000, traction:13800,
  },
} as const;
export const isPlayerCarId = (value:unknown):value is PlayerCarId => typeof value==='string'&&Object.hasOwn(PLAYER_CARS,value);

/** Seven speed automatic, with hysteresis. Shift points approximate the SSG;
 * these are calibration points, not claimed factory gear ratios. */
const GT_SHIFT_SPEEDS = [0,22,34,47,60,72,84,104];
export function gtGear(speed:number,previous:number){
  let gear=Math.max(1,Math.min(7,previous));
  while(gear<7&&speed>GT_SHIFT_SPEEDS[gear])gear++;
  while(gear>1&&speed<GT_SHIFT_SPEEDS[gear-1]-3)gear--;
  return gear;
}
export const gtRpm=(speed:number,gear:number,pedal:number)=>Math.min(8500,Math.max(850+Math.abs(pedal)*550,Math.abs(speed)/GT_SHIFT_SPEEDS[gear<0?1:gear]*7800));
