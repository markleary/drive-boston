import * as THREE from 'three';
import type { CityData, Point2 } from '../types';
import { buildTerrainGeometryData, sampleElevation, terrainGrid } from '../simulation/terrain.ts';
import { TriangleWriter, type TriangleSink } from './geometry-writer.ts';
import { clipTunnelPortals,tunnelPortalBoundsIntersect } from '../simulation/tunnels.ts';

/** Ground layers share the physical portal subtraction. Rebuilt metre UVs
 * keep asphalt, park paving and the coarse terrain from covering a ramp. */
export function clipPortalSurface(city:CityData,geometry:THREE.BufferGeometry){
  const positions=geometry.getAttribute('position');if(!positions?.count)return geometry;
  const indexed=!!geometry.index,vertices=positions.array as Float32Array,indices=geometry.index?Uint32Array.from(geometry.index.array):Uint32Array.from({length:positions.count},(_,i)=>i);
  const clipped=clipTunnelPortals(city,vertices,indices);if(clipped.vertices===vertices)return geometry;
  for(const name of Object.keys(geometry.attributes))geometry.deleteAttribute(name);
  const uv=new Float32Array(clipped.vertices.length/3*2);
  for(let i=0;i<uv.length/2;i++){uv[i*2]=clipped.vertices[i*3]/4;uv[i*2+1]=clipped.vertices[i*3+2]/4;}
  geometry.setAttribute('position',new THREE.BufferAttribute(clipped.vertices,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));geometry.setIndex(new THREE.BufferAttribute(clipped.indices,1));geometry.computeVertexNormals();geometry.computeBoundingSphere();
  if(!indexed){const expanded=geometry.toNonIndexed();geometry.copy(expanded);expanded.dispose();}
  return geometry;
}

/** Subdivide across and along roads so hill crests and cross slopes remain
 * attached to the same surface used by the suspension raycasts. The triangles
 * go into `sink`, so a tile's roads, dashes and crossings accumulate into a
 * few buffers instead of thousands of geometries. Flat-shaded ribbon triangles
 * would draw every grid crease across the asphalt as a shading line, so the
 * ribbon is collected first and written with the face normals of coincident
 * vertices averaged, as an indexed mesh would shade. */
export function drapedRibbonInto(sink:TriangleSink,city:CityData,points:Point2[],width:number,offset:number,surface?:(x:number,z:number)=>number){
  const section=(i:number)=>{
    const p=points[i],before=points[Math.max(0,i-1)],after=points[Math.min(points.length-1,i+1)];
    const dx=after[0]-before[0],dz=after[1]-before[1],length=Math.hypot(dx,dz)||1;
    return[-dz/length,dx/length];
  };
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const [x,z]of points){minX=Math.min(minX,x-width);maxX=Math.max(maxX,x+width);minZ=Math.min(minZ,z-width);maxZ=Math.max(maxZ,z+width);}
  drapedSurfaceInto(sink,city,offset,surface,[minX,maxX,minZ,maxZ],(corner,quad)=>{
    let distance=0;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.01)continue;
      const na=section(i-1),nb=section(i),along=Math.max(1,Math.ceil(length/2)),across=Math.max(1,Math.ceil(width/2));
      const vertex=(slot:number,t:number,v:number)=>{
        const nx=na[0]+(nb[0]-na[0])*t,nz=na[1]+(nb[1]-na[1])*t;
        corner(slot,a[0]+dx*t+nx*width*(v-.5),a[1]+dz*t+nz*width*(v-.5),v*width/5,(distance+t*length)/5);
      };
      for(let j=0;j<along;j++)for(let k=0;k<across;k++){vertex(0,j/along,k/across);vertex(5,(j+1)/along,k/across);vertex(10,j/along,(k+1)/across);vertex(15,(j+1)/along,(k+1)/across);quad();}
      distance+=length;
    }
  });
}
/** A surface between two measured edge polylines (station pairs `left[i]`,
 * `right[i]`, left being the ribbon's +normal side, [-dz, dx] of the direction
 * of travel): the curb-bounded roadway of scripts/street_surfaces.py and its
 * sidewalk bands. Draped, wound and shaded exactly like a ribbon. */
export function drapedStripInto(sink:TriangleSink,city:CityData,left:Point2[],right:Point2[],offset:number,surface?:(x:number,z:number)=>number){
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const edge of [left,right])for(const [x,z]of edge){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
  drapedSurfaceInto(sink,city,offset,surface,[minX,maxX,minZ,maxZ],(corner,quad)=>{
    let distance=0;
    for(let i=1;i<Math.min(left.length,right.length);i++){
      const l0=left[i-1],l1=left[i],r0=right[i-1],r1=right[i];
      const length=Math.hypot((l1[0]+r1[0]-l0[0]-r0[0])/2,(l1[1]+r1[1]-l0[1]-r0[1])/2);if(length<.01)continue;
      const width=Math.max(Math.hypot(l0[0]-r0[0],l0[1]-r0[1]),Math.hypot(l1[0]-r1[0],l1[1]-r1[1]));
      const along=Math.max(1,Math.ceil(length/2)),across=Math.max(1,Math.ceil(width/2));
      const vertex=(slot:number,t:number,v:number)=>{
        const lx=l0[0]+(l1[0]-l0[0])*t,lz=l0[1]+(l1[1]-l0[1])*t,rx=r0[0]+(r1[0]-r0[0])*t,rz=r0[1]+(r1[1]-r0[1])*t;
        corner(slot,rx+(lx-rx)*v,rz+(lz-rz)*v,v*width/5,(distance+t*length)/5);
      };
      for(let j=0;j<along;j++)for(let k=0;k<across;k++){vertex(0,j/along,k/across);vertex(5,(j+1)/along,k/across);vertex(10,j/along,(k+1)/across);vertex(15,(j+1)/along,(k+1)/across);quad();}
      distance+=length;
    }
  });
}
/** Shared draping: `fill` places each quad's four corners (slots 0, 5, 10, 15:
 * near-left, far-left, near-right, far-right, as x, z, u, v) and calls `quad`;
 * the corners are lifted onto the ground, split where the ground bends more
 * than 7 mm between them, clipped out of tunnel portals and written with the
 * averaged normals of coincident vertices. */
function drapedSurfaceInto(sink:TriangleSink,city:CityData,offset:number,surface:((x:number,z:number)=>number)|undefined,extent:[number,number,number,number],fill:(corner:(slot:number,x:number,z:number,u:number,v:number)=>void,quad:()=>void)=>void){
  const heightAt=surface??((x:number,z:number)=>sampleElevation(city,x,z));
  const v:number[]=[];
  // Vertices travel as plain numbers (x, y, z, u, v): no objects per vertex or midpoint.
  const emit=(ax:number,ay:number,az:number,au:number,av:number,bx:number,by:number,bz:number,bu:number,bv:number,cx:number,cy:number,cz:number,cu:number,cv:number,depth:number)=>{
    const abx=(ax+bx)/2,abz=(az+bz)/2,aby=heightAt(abx,abz)+offset,abu=(au+bu)/2,abv=(av+bv)/2;
    const bcx=(bx+cx)/2,bcz=(bz+cz)/2,bcy=heightAt(bcx,bcz)+offset,bcu=(bu+cu)/2,bcv=(bv+cv)/2;
    const cax=(cx+ax)/2,caz=(cz+az)/2,cay=heightAt(cax,caz)+offset,cau=(cu+au)/2,cav=(cv+av)/2;
    const error=Math.max(Math.abs(aby-(ay+by)/2),Math.abs(bcy-(by+cy)/2),Math.abs(cay-(cy+ay)/2));
    if(depth<3&&error>.007){
      emit(ax,ay,az,au,av,abx,aby,abz,abu,abv,cax,cay,caz,cau,cav,depth+1);emit(abx,aby,abz,abu,abv,bx,by,bz,bu,bv,bcx,bcy,bcz,bcu,bcv,depth+1);
      emit(cax,cay,caz,cau,cav,bcx,bcy,bcz,bcu,bcv,cx,cy,cz,cu,cv,depth+1);emit(abx,aby,abz,abu,abv,bcx,bcy,bcz,bcu,bcv,cax,cay,caz,cau,cav,depth+1);return;
    }
    v.push(ax,ay,az,au,av,bx,by,bz,bu,bv,cx,cy,cz,cu,cv);
  };
  const q=new Float64Array(20);
  const corner=(slot:number,x:number,z:number,u:number,w:number)=>{q[slot]=x;q[slot+1]=heightAt(x,z)+offset;q[slot+2]=z;q[slot+3]=u;q[slot+4]=w;};
  const quad=()=>{emit(q[0],q[1],q[2],q[3],q[4],q[10],q[11],q[12],q[13],q[14],q[5],q[6],q[7],q[8],q[9],0);emit(q[10],q[11],q[12],q[13],q[14],q[15],q[16],q[17],q[18],q[19],q[5],q[6],q[7],q[8],q[9],0);};
  fill(corner,quad);
  if(!surface&&tunnelPortalBoundsIntersect(city,extent[0],extent[1],extent[2],extent[3])){
    const vertices=new Float32Array(v.length/5*3);for(let i=0;i<v.length/5;i++)vertices.set(v.slice(i*5,i*5+3),i*3);
    const clipped=clipTunnelPortals(city,vertices,Uint32Array.from({length:vertices.length/3},(_,i)=>i));
    if(clipped.vertices!==vertices){v.length=0;for(const i of clipped.indices){const x=clipped.vertices[i*3],y=clipped.vertices[i*3+1],z=clipped.vertices[i*3+2];v.push(x,y,z,x/5,z/5);}}
  }
  const n=v.length/5,sums=new Map<string,number[]>(),keys=new Array<string>(n);
  for(let i=0;i<n;i+=3){
    const ax=v[i*5],ay=v[i*5+1],az=v[i*5+2],bx=v[i*5+5],by=v[i*5+6],bz=v[i*5+7],cx=v[i*5+10],cy=v[i*5+11],cz=v[i*5+12];
    const abx=ax-bx,aby=ay-by,abz=az-bz,cbx=cx-bx,cby=cy-by,cbz=cz-bz;
    let nx=cby*abz-cbz*aby,ny=cbz*abx-cbx*abz,nz=cbx*aby-cby*abx;const length=Math.hypot(nx,ny,nz);if(length>0){nx/=length;ny/=length;nz/=length;}
    for(let k=i;k<i+3;k++){const key=keys[k]=`${Math.round(v[k*5]*50)},${Math.round(v[k*5+2]*50)}`,s=sums.get(key);if(s){s[0]+=nx;s[1]+=ny;s[2]+=nz;}else sums.set(key,[nx,ny,nz]);}
  }
  sink.reserve(n);
  for(let k=0;k<n;k++){const s=sums.get(keys[k])!,l=Math.hypot(s[0],s[1],s[2])||1;sink.vertex(v[k*5],v[k*5+1],v[k*5+2],s[0]/l,s[1]/l,s[2]/l,v[k*5+3],v[k*5+4]);}
}
export function drapedRibbon(city:CityData,points:Point2[],width:number,offset:number,surface?:(x:number,z:number)=>number){
  const sink=new TriangleWriter();drapedRibbonInto(sink,city,points,width,offset,surface);return sink.geometry();
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
  const full=terrainGeometry(city),grid=terrainGrid(city);if(!grid)return[clipPortalSurface(city,full)];
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
    tile.setIndex(new THREE.BufferAttribute(indices,1));tile.computeBoundingSphere();result.push(clipPortalSurface(city,tile));
  }
  full.dispose();return result;
}

export const BACK_BAY_PAVING={minX:-470.396,maxX:356.823,minZ:-432.484,maxZ:238.068};
/** Preserve the original paved Back Bay courtyards while the extension gets
 * individual sidewalk strips and vegetated ground between its buildings. The
 * grid cells are walked directly (optionally a streamed tile's cell range) with
 * the terrain mesh's own diagonal, so the paving sits exactly on the ground. */
export function backBayPaving(city:CityData,cells?:{i0:number;i1:number;j0:number;j1:number}){
  const grid=terrainGrid(city),positions:number[]=[],uv:number[]=[];
  const g=new THREE.BufferGeometry();
  if(!grid)return g;
  const box=BACK_BAY_PAVING,cs=grid.cellSize;
  const i0=Math.max(cells?.i0??0,Math.floor((box.minX-grid.originX)/cs)-1),i1=Math.min(cells?.i1??grid.width-1,Math.ceil((box.maxX-grid.originX)/cs)+1,grid.width-1);
  const j0=Math.max(cells?.j0??0,Math.floor((box.minZ-grid.originZ)/cs)-1),j1=Math.min(cells?.j1??grid.height-1,Math.ceil((box.maxZ-grid.originZ)/cs)+1,grid.height-1);
  const vertex=(i:number,j:number):[number,number,number]=>[grid.originX+i*cs,grid.heights[j*grid.width+i]+.005,grid.originZ+j*cs];
  for(let j=j0;j<j1;j++)for(let i=i0;i<i1;i++){
    const a=vertex(i,j),b=vertex(i+1,j),c=vertex(i,j+1),d=vertex(i+1,j+1);
    for(const tri of [[a,c,b],[b,c,d]]){
      const cx=(tri[0][0]+tri[1][0]+tri[2][0])/3,cz=(tri[0][2]+tri[1][2]+tri[2][2])/3;
      if(cx<box.minX||cx>box.maxX||cz<box.minZ||cz>box.maxZ)continue;
      for(const v of tri){positions.push(...v);uv.push(v[0]/4,v[2]/4);}
    }
  }
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
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
