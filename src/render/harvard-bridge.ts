import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {CityData,Point2,Road} from '../types';
import {deckEdge,roadSlabGeometry} from '../simulation/road-surfaces.ts';
import {harvardBridgeSpine,smootMarkers,SMOOT_METRES,SMOOT_TOTAL} from '../simulation/harvard-bridge.ts';

/** Procedural painted Smoots: https://mitadmissions.org/blogs/entry/repainting-the-smoots/ */
export function addHarvardBridgeDetails(scene:THREE.Object3D,city:CityData,options:{labelTexture?:THREE.Texture|null}={}){
  const group=new THREE.Group();group.name='Harvard Bridge sidewalks and painted Smoots';
  const collisions:{id:string;vertices:Float32Array;indices:Uint32Array}[]=[],spine=harvardBridgeSpine(city);
  if(!spine)return{group,collisions};
  const {road,length,distances}=spine,markers=smootMarkers(length),sidewalkWidth=2.4;
  const curb=(d:number)=>.018+.102*Math.min(1,d/8,(length-d)/8);
  const concrete=new THREE.MeshStandardMaterial({color:'#b8b3a6',roughness:.97});
  const rail=new THREE.MeshStandardMaterial({color:'#727d74',roughness:.84,metalness:.25});
  const paints=['#eacb35','#734293','#71a05a'].map(color=>new THREE.MeshStandardMaterial({color,roughness:.96}));
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const add=(g:THREE.BufferGeometry,m:THREE.Material,solid=false)=>{
    const list=batches.get(m)??[];list.push(g);batches.set(m,list);
    if(solid)collisions.push({id:'harvard-sidewalk',vertices:new Float32Array(g.getAttribute('position').array),indices:g.index?new Uint32Array(g.index.array):Uint32Array.from({length:g.getAttribute('position').count},(_,i)=>i)});
  };
  const band=(side:number,inner:number,outer:number,top:number,thickness:number,m:THREE.Material)=>{
    const inside=road.points.map((_,i)=>deckEdge(road,i,side,-inner)),outside=road.points.map((_,i)=>deckEdge(road,i,side,-outer));
    const points:Point2[]=inside.map((p,i)=>[(p[0]+outside[i][0])/2,(p[1]+outside[i][1])/2]);
    const strip:Road={id:'harvard-sidewalk',name:'Harvard sidewalk',points,width:outer-inner,oneway:0,elevations:road.elevations!.map((y,i)=>y+curb(distances[i])+top),bridge:{id:'harvard-sidewalk',thickness,clearanceEstimated:true}};
    const data=roadSlabGeometry(city,strip),count=points.length*2;
    for(let i=0;i<points.length;i++)for(const layer of [0,1])for(const edge of [0,1]){
      const p=(edge===(side>0?0:1)?inside:outside)[i],k=(layer*count+i*2+edge)*3;data.vertices[k]=p[0];data.vertices[k+2]=p[1];
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(data.vertices,3));g.setIndex(new THREE.BufferAttribute(data.indices,1));g.computeVertexNormals();add(g,m,true);
  };
  for(const side of [-1,1]){band(side,0,sidewalkWidth,0,.24,concrete);band(side,2.24,2.42,.82,.82,rail);}
  // Labels read toward Cambridge on the eastern sidewalk. Numbered marks use
  // one atlas, while short coloured ticks mark individual 1.7018 m Smoots.
  const quad=(distance:number,width:number,depth:number,across:number,uv?:number[])=>{
    const vertices:number[]=[];
    for(const d of [distance-depth/2,distance+depth/2])for(const side of [-1,1]){
      const p=spine.at(d),offset=p.width/2+across+side*width/2;vertices.push(p.x-p.tz*offset,p.y+curb(d)+.008,p.z+p.tx*offset);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex([0,1,2,1,3,2]);if(uv)g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
  };
  const start=markers[0].distance;let ticks=0;
  for(let smoot=0;smoot<=364;smoot++){
    const major=smoot%10===0;add(quad(start+smoot*SMOOT_METRES,major?2:.65,.055,1.2),paints[smoot%3]);ticks++;
  }
  add(quad(start+SMOOT_TOTAL*SMOOT_METRES,2,.08,1.2),paints[0]);ticks++;
  const texture=options.labelTexture===undefined?smootAtlas(markers):options.labelTexture;
  const labels=new THREE.MeshStandardMaterial({map:texture??null,color:'#ffffff',transparent:true,alphaTest:.25,depthWrite:false,roughness:.97,polygonOffset:true,polygonOffsetFactor:-1});
  markers.forEach((marker,i)=>{
    const col=i%8,row=Math.floor(i/8),u0=col/8,u1=(col+1)/8,v0=1-(row+1)/8,v1=1-row/8;
    add(quad(marker.distance+1.35,1.9,marker.smoot===182.2||marker.smoot===SMOOT_TOTAL?2.1:1.55,1.2,[u0,v0,u1,v0,u0,v1,u1,v1]),labels);
  });
  for(const [material,parts]of batches){
    const normalized=parts.map(g=>{const n=g.index?g.toNonIndexed():g;if(material!==labels)n.deleteAttribute('uv');return n;});const g=mergeGeometries(normalized,false)!;
    new Set([...parts,...normalized]).forEach(p=>p.dispose());const mesh=new THREE.Mesh(g,material);mesh.castShadow=material===concrete||material===rail;mesh.receiveShadow=true;group.add(mesh);
  }
  group.userData={markers:markers.map(m=>({smoot:m.smoot,label:m.label,distance:m.distance})),ticks,smootMetres:SMOOT_METRES,length,sidewalkWidth,accuracy:'Original painted interpretation of the Smoot tradition on the source bridge alignment'};
  scene.add(group);return{group,collisions};
}
function smootAtlas(markers:{smoot:number;label:string}[]){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=2048;const c=canvas.getContext('2d')!;c.textAlign='center';c.textBaseline='middle';
  markers.forEach((marker,i)=>{
    const x=(i%8)*256,y=Math.floor(i/8)*256;c.save();c.translate(x+128,y);c.lineJoin='round';c.strokeStyle='#49335a';c.lineWidth=5;
    c.font='bold 86px monospace';c.fillStyle='#f0d33a';c.strokeText(String(marker.smoot),0,78,235);c.fillText(String(marker.smoot),0,78,235);
    c.font='bold 35px monospace';c.fillStyle='#83b666';c.strokeText('SMOOTS',0,146,235);c.fillText('SMOOTS',0,146,235);
    if(marker.smoot===SMOOT_TOTAL||marker.smoot===182.2){c.font='bold 25px monospace';c.fillStyle='#e5cf3b';const text=marker.smoot===SMOOT_TOTAL?'± 1 EAR':'HALFWAY TO HELL';c.strokeText(text,0,199,238);c.fillText(text,0,199,238);}
    c.restore();
  });
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;return texture;
}
