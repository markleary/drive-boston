import * as THREE from 'three';
import type { CityData, Point2 } from '../types';
import { buildTerrainGeometryData, sampleElevation, terrainGrid } from '../simulation/terrain.ts';

/** Subdivide across and along roads so hill crests and cross slopes remain
 * attached to the same surface used by the suspension raycasts. */
export function drapedRibbon(city:CityData,points:Point2[],width:number,offset:number,surface=(x:number,z:number)=>sampleElevation(city,x,z)){
  const positions:number[]=[],uv:number[]=[];let distance=0;
  type Vertex={p:number[];uv:number[]};
  const middle=(a:Vertex,b:Vertex):Vertex=>{const x=(a.p[0]+b.p[0])/2,z=(a.p[2]+b.p[2])/2;return{p:[x,surface(x,z)+offset,z],uv:[(a.uv[0]+b.uv[0])/2,(a.uv[1]+b.uv[1])/2]};};
  const emit=(a:Vertex,b:Vertex,c:Vertex,depth=0)=>{
    const ab=middle(a,b),bc=middle(b,c),ca=middle(c,a);
    const error=Math.max(Math.abs(ab.p[1]-(a.p[1]+b.p[1])/2),Math.abs(bc.p[1]-(b.p[1]+c.p[1])/2),Math.abs(ca.p[1]-(c.p[1]+a.p[1])/2));
    if(depth<3&&error>.007){emit(a,ab,ca,depth+1);emit(ab,b,bc,depth+1);emit(ca,bc,c,depth+1);emit(ab,bc,ca,depth+1);return;}
    for(const v of [a,b,c]){positions.push(...v.p);uv.push(...v.uv);}
  };
  const section=(i:number)=>{
    const p=points[i],before=points[Math.max(0,i-1)],after=points[Math.min(points.length-1,i+1)];
    const dx=after[0]-before[0],dz=after[1]-before[1],length=Math.hypot(dx,dz)||1;
    return[-dz/length,dx/length];
  };
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.01)continue;
    const na=section(i-1),nb=section(i),along=Math.max(1,Math.ceil(length/2)),across=Math.max(1,Math.ceil(width/2));
    const vertex=(t:number,v:number)=>{
      const nx=na[0]+(nb[0]-na[0])*t,nz=na[1]+(nb[1]-na[1])*t;
      const x=a[0]+dx*t+nx*width*(v-.5),z=a[1]+dz*t+nz*width*(v-.5);
      return {p:[x,surface(x,z)+offset,z],uv:[v*width/5,(distance+t*length)/5]};
    };
    for(let j=0;j<along;j++)for(let k=0;k<across;k++){
      const q=[vertex(j/along,k/across),vertex((j+1)/along,k/across),vertex(j/along,(k+1)/across),vertex((j+1)/along,(k+1)/across)];
      emit(q[0],q[2],q[1]);emit(q[2],q[3],q[1]);
    }
    distance+=length;
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
}

export function terrainGeometry(city:CityData){
  const data=buildTerrainGeometryData(city),g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(data.vertices,3));g.setIndex(new THREE.BufferAttribute(data.indices,1));
  const uv=new Float32Array(data.vertices.length/3*2);
  for(let i=0;i<uv.length/2;i++){uv[i*2]=data.vertices[i*3]/4;uv[i*2+1]=data.vertices[i*3+2]/4;}
  g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.computeVertexNormals();return g;
}

/** Tile only the render buffers; retain every original collision vertex/diagonal. */
export function terrainTiles(city:CityData,cellCount=64){
  const full=terrainGeometry(city),grid=terrainGrid(city);if(!grid)return[full];
  const result:THREE.BufferGeometry[]=[];
  for(let z=0;z<grid.height-1;z+=cellCount)for(let x=0;x<grid.width-1;x+=cellCount){
    const width=Math.min(cellCount,grid.width-1-x)+1,height=Math.min(cellCount,grid.height-1-z)+1;
    const tile=new THREE.BufferGeometry();
    for(const name of ['position','normal','uv']){
      const source=full.getAttribute(name),data=new Float32Array(width*height*source.itemSize);
      for(let j=0;j<height;j++)for(let i=0;i<width;i++){
        const src=((z+j)*grid.width+x+i)*source.itemSize,dst=(j*width+i)*source.itemSize;
        for(let k=0;k<source.itemSize;k++)data[dst+k]=source.array[src+k];
      }
      tile.setAttribute(name,new THREE.BufferAttribute(data,source.itemSize));
    }
    const indices=new Uint16Array((width-1)*(height-1)*6);let offset=0;
    for(let j=0;j<height-1;j++)for(let i=0;i<width-1;i++){
      const a=j*width+i,b=a+1,c=a+width,d=c+1;indices.set([a,c,b,b,c,d],offset);offset+=6;
    }
    tile.setIndex(new THREE.BufferAttribute(indices,1));tile.computeBoundingSphere();result.push(tile);
  }
  full.dispose();return result;
}

/** Preserve the original paved Back Bay courtyards while the extension gets
 * individual sidewalk strips and vegetated ground between its buildings. */
export function backBayPaving(city:CityData){
  const data=buildTerrainGeometryData(city),positions:number[]=[],uv:number[]=[];
  for(let i=0;i<data.indices.length;i+=3){
    const ids=[data.indices[i],data.indices[i+1],data.indices[i+2]],cx=ids.reduce((n,j)=>n+data.vertices[j*3],0)/3,cz=ids.reduce((n,j)=>n+data.vertices[j*3+2],0)/3;
    if(cx< -470.396||cx>356.823||cz< -432.484||cz>238.068)continue;
    for(const j of ids){const x=data.vertices[j*3],z=data.vertices[j*3+2];positions.push(x,data.vertices[j*3+1]+.005,z);uv.push(x/4,z/4);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
}

export function foundationGeometry(city:CityData){
  const positions:number[]=[];
  for(const b of city.buildings){
    const top=b.baseElevation??0;
    for(let i=0;i<b.footprint.length;i++){
      const a=b.footprint[i],end=b.footprint[(i+1)%b.footprint.length],n=Math.max(1,Math.ceil(Math.hypot(end[0]-a[0],end[1]-a[1])/4));
      for(let j=0;j<n;j++){
        const p=[a[0]+(end[0]-a[0])*j/n,a[1]+(end[1]-a[1])*j/n],q=[a[0]+(end[0]-a[0])*(j+1)/n,a[1]+(end[1]-a[1])*(j+1)/n];
        const lowA=Math.min(top,sampleElevation(city,p[0],p[1])-.15),lowB=Math.min(top,sampleElevation(city,q[0],q[1])-.15);
        if(top-Math.min(lowA,lowB)<.2)continue;
        for(const v of [[p[0],lowA,p[1]],[q[0],top,q[1]],[q[0],lowB,q[1]],[p[0],lowA,p[1]],[p[0],top,p[1]],[q[0],top,q[1]]])positions.push(...v);
      }
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();return g;
}
