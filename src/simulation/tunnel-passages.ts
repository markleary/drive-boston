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
 * pieces under REMNANT_SPAN are omitted at this distant level of detail, and each piece is
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
export function prepareBuildingTunnelPassage(city:CityData,building:Pick<Building,'id'|'baseElevation'>,data:TileBuildingGeometry):TileBuildingGeometry{
  if(!TUNNEL_PASSAGE_BUILDING_IDS.has(building.id))return data;
  const facade=clipBuildingTunnelPassage(city,building,{vertices:data.positions,indices:Uint32Array.from(data.facade)});
  const roof=clipBuildingTunnelPassage(city,building,{vertices:data.positions,indices:Uint32Array.from(data.roof)});
  if(facade.vertices===data.positions&&roof.vertices===data.positions)return data;
  const positions=new Float32Array(facade.vertices.length+roof.vertices.length);positions.set(facade.vertices);positions.set(roof.vertices,facade.vertices.length);
  const offset=facade.vertices.length/3,roofIndices=Uint32Array.from(roof.indices,i=>i+offset);
  // A shell cut is a solid-model operation. Clipping its existing triangles
  // only opens a surface: it cannot supply the newly exposed walls. Removing
  // connected fragments afterward is also unsafe because survey triangles and
  // clipped faces meet at T-junctions, not necessarily shared vertices.
  const clipped={positions,facade:facade.indices,roof:roofIndices};
  return closeOpenSkyCuts(city,building,clipped);
}
/** The far approximation drops pieces smaller than one small building. */
export const REMNANT_SPAN=25;

/** Close the vertical cut faces below retained roofs. Every edge is tested on
 * both sides against the clearance union, so interior triangulation edges and
 * the boundaries between overlapping ramp volumes do not grow extra walls.
 * A centimetre into the retained solid avoids coplanar subtraction tolerances;
 * the same finite bore cut then opens the lower part of each reveal as needed.
 * Source roof tiers retain their own heights, including sloping roof edges,
 * and surveyed soffits bound the bottom of an elevated wing. */
export function closeOpenSkyCuts(city:CityData,building:Pick<Building,'id'|'baseElevation'>,data:TileBuildingGeometry):TileBuildingGeometry{
  const p=data.positions,base=building.baseElevation??0,reveals:number[]=[],seen=new Set<string>();
  const floors:number[][]=[];
  for(let i=0;i<data.roof.length;i+=3){
    const a=data.roof[i]*3,b=data.roof[i+1]*3,c=data.roof[i+2]*3;
    if((p[b+2]-p[a+2])*(p[c]-p[a])-(p[b]-p[a])*(p[c+2]-p[a+2])< -1e-5)floors.push([a,b,c]);
  }
  const bottom=(x:number,z:number,top:number)=>{
    let y=base;
    for(const [a,b,c] of floors){
      const bx=p[b]-p[a],bz=p[b+2]-p[a+2],cx=p[c]-p[a],cz=p[c+2]-p[a+2],det=bx*cz-bz*cx;
      const u=((x-p[a])*cz-(z-p[a+2])*cx)/det,v=(bx*(z-p[a+2])-bz*(x-p[a]))/det;
      if(u< -1e-5||v< -1e-5||u+v>1+1e-5)continue;
      const floor=p[a+1]+u*(p[b+1]-p[a+1])+v*(p[c+1]-p[a+1]);
      if(floor<top-.03)y=Math.max(y,floor);
    }
    return y;
  };
  for(let i=0;i<data.roof.length;i+=3){
    const ids=[data.roof[i],data.roof[i+1],data.roof[i+2]];
    const a=ids[0]*3,b=ids[1]*3,c=ids[2]*3;
    // A downward soffit or nearly vertical source face cannot support a new wall.
    const up=(p[b+2]-p[a+2])*(p[c]-p[a])-(p[b]-p[a])*(p[c+2]-p[a+2]);
    if(up<1e-5)continue;
    for(let j=0;j<3;j++){
      const a=ids[j]*3,b=ids[(j+1)%3]*3,dx=p[b]-p[a],dz=p[b+2]-p[a+2],length=Math.hypot(dx,dz);
      if(length<.01||Math.min(p[a+1],p[b+1])<=base+.03)continue;
      const mx=(p[a]+p[b])/2,mz=(p[a+2]+p[b+2])/2,nx=-dz/length,nz=dx/length;
      const left=inOpenSkyClearance(city,mx+nx*.025,mz+nz*.025),right=inOpenSkyClearance(city,mx-nx*.025,mz-nz*.025);
      if(left===right)continue;
      const key=[a,b].map(n=>[p[n],p[n+1],p[n+2]].map(v=>v.toFixed(3)).join(',')).sort().join('|');
      if(seen.has(key))continue;seen.add(key);
      // Face toward the removed volume, with its back just inside the solid.
      const sign=left?1:-1,ox=-nx*sign*.01,oz=-nz*sign*.01;
      const va=[p[a]+ox,bottom(p[a]+ox,p[a+2]+oz,p[a+1]),p[a+2]+oz],vb=[p[b]+ox,bottom(p[b]+ox,p[b+2]+oz,p[b+1]),p[b+2]+oz],vc=[p[b]+ox,p[b+1],p[b+2]+oz],vd=[p[a]+ox,p[a+1],p[a+2]+oz];
      if(sign>0)reveals.push(...va,...vb,...vc,...va,...vc,...vd);
      else reveals.push(...va,...vc,...vb,...va,...vd,...vc);
    }
  }
  if(!reveals.length)return data;
  const vertices=new Float32Array(reveals),cut=clipTunnelClearance(city,vertices,Uint32Array.from({length:vertices.length/3},(_,i)=>i));
  const positions=new Float32Array(p.length+cut.vertices.length);positions.set(p);positions.set(cut.vertices,p.length);
  const facade=new Uint32Array(data.facade.length+cut.indices.length);facade.set(data.facade);facade.set(Uint32Array.from(cut.indices,i=>i+p.length/3),data.facade.length);
  return{positions,facade,roof:data.roof};
}
