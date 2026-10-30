import * as THREE from 'three';
import type {Road} from '../types';
import type {TunnelMesh} from '../simulation/tunnels.ts';
import {roadProjection} from '../simulation/road-surfaces.ts';

const REPEAT_METRES=4.8;
const PANEL_WIDTH=.6,PANEL_LENGTH=1.2;

/** One shared material for the suspended ceiling panels. The color and relief
 * maps include recessed joints, slightly beveled panel edges and restrained
 * concrete variation; no individual panel meshes or downloaded images. */
export function createTunnelCeilingMaterial(){
  const size=512,color=new Uint8Array(size*size*4),relief=new Uint8Array(size*size);
  const hash=(x:number,y:number)=>{
    let value=Math.imul(x+1,374761393)^Math.imul(y+1,668265263);
    value=Math.imul(value^(value>>>13),1274126177);return(value^(value>>>16))>>>0;
  };
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const across=(x+.5)/size*REPEAT_METRES,along=(y+.5)/size*REPEAT_METRES;
    const u=across%PANEL_WIDTH,v=along%PANEL_LENGTH,edge=Math.min(u,PANEL_WIDTH-u,v,PANEL_LENGTH-v);
    const expansion=Math.min(across%2.4,2.4-across%2.4,along%2.4,2.4-along%2.4)<.023;
    const grout=edge<.014||expansion,bevel=Math.min(1,Math.max(0,(edge-.014)/.025));
    const variation=(hash(Math.floor(across/PANEL_WIDTH),Math.floor(along/PANEL_LENGTH))%11)-5;
    const grain=(hash(x,y)%7)-3,stain=Math.sin(across*7+along*3)*Math.cos(along*5)*1.6;
    const level=grout?84:135+bevel*22+variation+grain+stain,n=(y*size+x)*4;
    color[n]=level;color[n+1]=level+2;color[n+2]=level-5;color[n+3]=255;
    relief[y*size+x]=grout?74:Math.round(185+bevel*58+grain);
  }
  const map=new THREE.DataTexture(color,size,size),bumpMap=new THREE.DataTexture(relief,size,size,THREE.RedFormat);
  for(const texture of [map,bumpMap]){
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.magFilter=THREE.LinearFilter;
    texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.anisotropy=4;texture.needsUpdate=true;
  }
  map.name='Tunnel ceiling concrete panels';map.colorSpace=THREE.SRGBColorSpace;bumpMap.name='Tunnel ceiling recessed panel joints';
  const material=new THREE.MeshStandardMaterial({map,bumpMap,bumpScale:.018,roughness:.94,emissiveMap:map,emissive:'#ffffff',emissiveIntensity:.18});
  material.name='Tiled tunnel ceiling';return material;
}

/** Apply metre-scaled panel UVs to the exact shared roof shell. Keeping the
 * original buffers preserves the physical clearance and every junction cut. */
export function tiledTunnelCeiling(data:TunnelMesh,road:Road){
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(data.vertices,3));geometry.setIndex(new THREE.BufferAttribute(data.indices,1));
  const distances=[0];for(let i=1;i<road.points.length;i++)distances.push(distances[i-1]+Math.hypot(road.points[i][0]-road.points[i-1][0],road.points[i][1]-road.points[i-1][1],(road.elevations?.[i]??0)-(road.elevations?.[i-1]??0)));
  const uv=new Float32Array(data.vertices.length/3*2);
  for(let i=0;i<data.vertices.length/3;i++){
    const x=data.vertices[i*3],z=data.vertices[i*3+2],hit=roadProjection(road,x,z),a=road.points[hit.index],b=road.points[hit.index+1]??a;
    const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz)||1,across=((x-hit.x)*dz-(z-hit.z)*dx)/length;
    const edgeA=road.deckEdgeElevations?.[hit.index],edgeB=road.deckEdgeElevations?.[hit.index+1]??edgeA;
    const widthA=road.deckWidths?.[hit.index]??road.width,widthB=road.deckWidths?.[hit.index+1]??road.width;
    const width=widthA+(widthB-widthA)*hit.t,crossfall=edgeA&&edgeB?((edgeA[0]-edgeA[1])+(edgeB[0]-edgeB[1]-edgeA[0]+edgeA[1])*hit.t)/width:0;
    uv[i*2]=across*Math.hypot(1,crossfall)/REPEAT_METRES;
    uv[i*2+1]=(distances[hit.index]+((distances[hit.index+1]??distances[hit.index])-distances[hit.index])*hit.t)/REPEAT_METRES;
  }
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry;
}
