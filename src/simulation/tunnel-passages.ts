import type {Building,CityData,Point2} from '../types';
import type {TileBuildingGeometry} from './tile-format.ts';
import {clipTunnelClearance,inOpenSkyClearance,type TunnelMesh} from './tunnels.ts';
import type {FarBuilding} from './far-format.ts';
import {pointInside} from './roads.ts';
import {orientedBox} from './oriented-box.ts';

/** The retained Zakim survey ends above the source street datum. The Merano (the
 * survey's name for the parcel; the building standing there is The Beverly) and
 * One Canal shells cross the resulting three approach profiles. Over covered bores
 * only the finite vehicle passages open and the upper floors stay; over the open
 * ramps the shell is cleared to the sky (see clipTunnelClearance). Stored survey
 * bytes remain intact. The same triangles feed rendering and Rapier. */
export const TUNNEL_PASSAGE_BUILDING_IDS=new Set(['BOS-0RY4U-KSQW8-OJPEA','BOS-Q6LOF-Q1HSG-INZ97']);
/** far.bin carries no building ids: each passage building's far hull is the
 * entry of its tile with its survey height whose hull holds its survey centre. */
export const TUNNEL_PASSAGE_FAR:{id:string;tile:string;center:Point2;height:number}[]=[
  {id:'BOS-0RY4U-KSQW8-OJPEA',tile:'1_-2',center:[1263.08,-1726.23],height:55.58},
  {id:'BOS-Q6LOF-Q1HSG-INZ97',tile:'1_-2',center:[1226.89,-1690.01],height:47.55},
];
export function isTunnelPassageFar(tile:string,building:FarBuilding){return TUNNEL_PASSAGE_FAR.some(p=>p.tile===tile&&Math.abs(p.height-building.height)<.02&&pointInside(p.center,building.footprint));}
/** The far hull of a passage building after the same open-sky cut as its shell,
 * as rectangles for the far city to box: the hull is rasterised at 2 m in its
 * own oriented frame, cells inside an open-air clearance column go, connected
 * pieces under REMNANT_SPAN go (as the detailed remnants do), and each piece is
 * cut into 4 m slabs along the long axis with one rectangle per run of kept
 * cells across each slab, so no box spans the cleared ramps. */
export function farPassageFootprints(city:Pick<CityData,'roads'>,building:FarBuilding):Point2[][]{
  const cell=2,slab=2,frame=orientedBox(building.footprint),ux=frame.ux,uz=frame.uz;
  const toU=(x:number,z:number)=>x*ux+z*uz,toV=(x:number,z:number)=>-x*uz+z*ux,world=(u:number,v:number):Point2=>[u*ux-v*uz,u*uz+v*ux];
  const us=building.footprint.map(p=>toU(...p)),vs=building.footprint.map(p=>toV(...p)),u0=Math.min(...us),v0=Math.min(...vs),nu=Math.ceil((Math.max(...us)-u0)/cell),nv=Math.ceil((Math.max(...vs)-v0)/cell);
  const kept=new Uint8Array(nu*nv),piece=new Int32Array(nu*nv).fill(-1),spans:number[]=[];
  for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const p=world(u0+(i+.5)*cell,v0+(j+.5)*cell);kept[i*nv+j]=+(pointInside(p,building.footprint)&&!inOpenSkyClearance(city,...p));}
  for(let start=0;start<kept.length;start++){
    if(!kept[start]||piece[start]>=0)continue;const id=spans.length,stack=[start];piece[start]=id;let a=nu,b=-1,c=nv,d=-1;
    while(stack.length){
      const n=stack.pop()!,i=Math.floor(n/nv),j=n%nv;a=Math.min(a,i);b=Math.max(b,i);c=Math.min(c,j);d=Math.max(d,j);
      for(const [x,y] of [[i+1,j],[i-1,j],[i,j+1],[i,j-1]])if(x>=0&&x<nu&&y>=0&&y<nv&&kept[x*nv+y]&&piece[x*nv+y]<0){piece[x*nv+y]=id;stack.push(x*nv+y);}
    }
    spans.push(Math.hypot(b-a+1,d-c+1)*cell);
  }
  const rectangles:Point2[][]=[];
  for(let s0=0;s0<nu;s0+=slab)for(let id=0;id<spans.length;id++){
    if(spans[id]<REMNANT_SPAN)continue;const s1=Math.min(nu,s0+slab);let run=-1;
    for(let j=0;j<=nv;j++){
      let any=false;if(j<nv)for(let i=s0;i<s1;i++)if(piece[i*nv+j]===id){any=true;break;}
      if(any&&run<0)run=j;
      if(!any&&run>=0){
        let i0=s1,i1=s0;for(let i=s0;i<s1;i++)for(let k=run;k<j;k++)if(piece[i*nv+k]===id){i0=Math.min(i0,i);i1=Math.max(i1,i+1);}
        const ua=u0+i0*cell,ub=u0+i1*cell,va=v0+run*cell,vb=v0+j*cell;rectangles.push([world(ua,va),world(ub,va),world(ub,vb),world(ua,vb)]);run=-1;
      }
    }
  }
  return rectangles;
}
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
