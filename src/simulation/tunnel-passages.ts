import type {Building,CityData} from '../types';
import type {TileBuildingGeometry} from './tile-format.ts';
import {clipTunnelClearance,type TunnelMesh} from './tunnels.ts';

/** The retained Zakim survey ends above the source street datum. The Merano (the
 * survey's name for the parcel; the building standing there is The Beverly) and
 * One Canal shells cross the resulting three approach profiles. Over covered bores
 * only the finite vehicle passages open and the upper floors stay; over the open
 * ramps the shell is cleared to the sky (see clipTunnelClearance). Stored survey
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
  const keep=keptPieces(positions,[facade.indices,roofIndices],[[data.positions.length/3,offset],[offset+data.positions.length/3,positions.length/3]]);
  return{positions,facade:facade.indices.filter((_,i)=>keep[Math.floor(i/3)]),roof:roofIndices.filter((_,i)=>keep[facade.indices.length/3+Math.floor(i/3)])};
}
/** Connected shell pieces narrower than this that the clearance cut touched are dropped. */
export const REMNANT_SPAN=25;
/** Per triangle (facade then roof), whether its welded piece stays: a piece the
 * cut left standing beside an open ramp, open on its cut side, reads as a
 * free-standing sliver tower, while untouched rooftop units stay.
 * `added` lists each index list's range of vertices created by the cut. */
function keptPieces(positions:Float32Array,lists:Uint32Array[],added:[number,number][]){
  const weld=new Map<string,number>(),parent:number[]=[],root=(n:number):number=>parent[n]===n?n:(parent[n]=root(parent[n]));
  const node=(v:number)=>{const k=`${positions[v*3].toFixed(3)},${positions[v*3+1].toFixed(3)},${positions[v*3+2].toFixed(3)}`;let n=weld.get(k);if(n===undefined){n=parent.length;parent.push(n);weld.set(k,n);}return n;};
  const triangles:{nodes:number[];cut:boolean}[]=[];
  lists.forEach((indices,l)=>{for(let i=0;i<indices.length;i+=3){const vs=[indices[i],indices[i+1],indices[i+2]],nodes=vs.map(node);parent[root(nodes[1])]=root(nodes[0]);parent[root(nodes[2])]=root(nodes[0]);triangles.push({nodes,cut:vs.some(v=>v>=added[l][0]&&v<added[l][1])});}});
  const pieces=new Map<number,{minX:number;maxX:number;minZ:number;maxZ:number;cut:boolean}>();
  for(const [k,n] of weld){const [x,,z]=k.split(',').map(Number),r=root(n),p=pieces.get(r)??{minX:x,maxX:x,minZ:z,maxZ:z,cut:false};p.minX=Math.min(p.minX,x);p.maxX=Math.max(p.maxX,x);p.minZ=Math.min(p.minZ,z);p.maxZ=Math.max(p.maxZ,z);pieces.set(r,p);}
  for(const t of triangles)if(t.cut)pieces.get(root(t.nodes[0]))!.cut=true;
  return triangles.map(t=>{const p=pieces.get(root(t.nodes[0]))!;return !p.cut||Math.hypot(p.maxX-p.minX,p.maxZ-p.minZ)>=REMNANT_SPAN;});
}
