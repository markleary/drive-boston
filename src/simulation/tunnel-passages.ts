import type {Building,CityData} from '../types';
import type {TileBuildingGeometry} from './tile-format.ts';
import {clipTunnelClearance,type TunnelMesh} from './tunnels.ts';

/** The retained Zakim survey ends above the source street datum. The Merano and One Canal
 * lower shells cross the resulting three approach profiles. Adapt only their
 * finite vehicle passages; upper floors, surrounding walls and stored survey
 * bytes remain intact. The same triangles feed rendering and Rapier. */
export const TUNNEL_PASSAGE_BUILDING_IDS=new Set(['BOS-0RY4U-KSQW8-OJPEA','BOS-Q6LOF-Q1HSG-INZ97']);
export function clipBuildingTunnelPassage(city:CityData,building:Pick<Building,'id'>,mesh:TunnelMesh):TunnelMesh{
  return TUNNEL_PASSAGE_BUILDING_IDS.has(building.id)?clipTunnelClearance(city,mesh.vertices,mesh.indices):mesh;
}
export function prepareBuildingTunnelPassage(city:CityData,building:Pick<Building,'id'>,data:TileBuildingGeometry):TileBuildingGeometry{
  if(!TUNNEL_PASSAGE_BUILDING_IDS.has(building.id))return data;
  const facade=clipBuildingTunnelPassage(city,building,{vertices:data.positions,indices:Uint32Array.from(data.facade)});
  const roof=clipBuildingTunnelPassage(city,building,{vertices:data.positions,indices:Uint32Array.from(data.roof)});
  if(facade.vertices===data.positions&&roof.vertices===data.positions)return data;
  const positions=new Float32Array(facade.vertices.length+roof.vertices.length);positions.set(facade.vertices);positions.set(roof.vertices,facade.vertices.length);
  const offset=facade.vertices.length/3,roofIndices=Uint32Array.from(roof.indices,i=>i+offset);
  return{positions,facade:facade.indices,roof:roofIndices};
}
