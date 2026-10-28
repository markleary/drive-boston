export type Point2 = [number, number];
export interface Road { id: string; name: string; points: Point2[]; width: number; oneway: number; elevations?:number[]; startLevel?:number; endLevel?:number; bridge?:{id:string;thickness:number;clearanceEstimated:boolean}; }
export interface Building { id: string; name: string; center: Point2; height: number; footprint: Point2[]; landmark?: string; baseElevation?: number; }
export interface Landmark { id: string; name: string; position: Point2; description: string; driveStart?: {x:number;z:number;yaw:number;roadId?:string}; }
export interface CityArea { id: string; name: string; rings: Point2[][]; }
export interface ParkPath { id: string; points: Point2[]; width: number; bridge?: boolean; }
export interface CityData {
  origin: { xFeet: number; yFeet: number; longitude: number; latitude: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  roads: Road[]; buildings: Building[]; landmarks: Landmark[];
  curbs: Point2[][]; signals: Point2[];
  spawn: { x: number; z: number; yaw: number };
  sources: { name: string; url: string; license: string }[];
  elevation?: { width:number; height:number; cellSize:number; originX:number; originZ:number; heights:number[] };
  coverage?: Point2[][];
  neighborhoods?: CityArea[];
  parks?: CityArea[];
  water?: CityArea[];
  parkPaths?: ParkPath[];
}
export interface DriveInput { throttle: number; brake: number; steer: number; handbrake: boolean; }
export interface VehicleState { x: number; y: number; z: number; yaw: number; speed: number; steering: number; }
export type LightingMode = 'golden' | 'day' | 'night';
export type CameraMode = 'chase' | 'hood' | 'aerial';
export type TravelMode = 'drive' | 'helicopter';
