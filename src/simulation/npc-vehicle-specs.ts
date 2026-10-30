/** Shared visual dimensions, collision geometry and representative unladen masses.
 * Passenger masses follow the reference trims; the box truck includes a 900 kg
 * box/upfit allowance above the E-350 cab/chassis, not its GVWR or payload rating.
 * Sources and assumptions are recorded in public/models/README.md. */
export type NPCVehicleType='compact'|'sedan'|'minivan'|'pickup'|'box';
export interface NPCVehicleSpec {
  type:NPCVehicleType;length:number;width:number;height:number;mass:number;wheelRadius:number;
  frontAxle:number;rearAxle:number;belt:number;frontGlass:number;frontRoof:number;rearRoof:number;rearGlass:number;
  colors:readonly number[];
}
export const NPC_VEHICLES:readonly NPCVehicleSpec[]=[
  {type:'compact',length:4.67,width:1.80,height:1.42,mass:1330,wheelRadius:.316,frontAxle:1.35,rearAxle:-1.38,belt:.84,frontGlass:.9,frontRoof:.24,rearRoof:-.85,rearGlass:-1.55,colors:[0xececea,0xaeb4b9,0x555d64,0x161b21,0x1f4c78,0xa7242b]},
  {type:'sedan',length:4.98,width:1.85,height:1.45,mass:1676,wheelRadius:.33,frontAxle:1.39,rearAxle:-1.48,belt:.88,frontGlass:.97,frontRoof:.24,rearRoof:-.87,rearGlass:-1.69,colors:[0xedede7,0xa8b1ba,0x555b61,0x191c20,0x793038,0x25394e]},
  {type:'minivan',length:5.17,width:1.99,height:1.78,mass:2091,wheelRadius:.354,frontAxle:1.5,rearAxle:-1.56,belt:1,frontGlass:1.31,frontRoof:.45,rearRoof:-2,rearGlass:-2.41,colors:[0xeaece6,0xadb5b8,0x626c71,0x1a2024,0x77908b,0x2c4a63]},
  {type:'pickup',length:5.89,width:2.03,height:1.96,mass:2241,wheelRadius:.405,frontAxle:1.75,rearAxle:-1.94,belt:1.2,frontGlass:1.27,frontRoof:.75,rearRoof:-.95,rearGlass:-1.14,colors:[0xe9eae5,0xa8afb3,0x555c62,0x181c1f,0x294c65,0x8a2c32]},
  {type:'box',length:6.6,width:2.17,height:3.15,mass:3126,wheelRadius:.385,frontAxle:2.12,rearAxle:-1.53,belt:1.18,frontGlass:2.10,frontRoof:1.49,rearRoof:.57,rearGlass:.44,colors:[0xeceddf,0xadb5bb,0x284e78,0xa93130,0xd6ab35]},
];
/** Favor everyday passenger cars; keep seven box trucks in a 77-vehicle fleet. */
const MIX=[0,1,0,2,1,3,0,1,2,3,4];
export const NPC_BODY_LIFT=.65;
export const TRAFFIC_CAPACITY=77;
export function npcVehicleAt(index:number){return NPC_VEHICLES[MIX[index%MIX.length]];}
export function npcPaint(spec:NPCVehicleSpec,random= Math.random){return spec.colors[Math.min(spec.colors.length-1,Math.floor(random()*spec.colors.length))];}
