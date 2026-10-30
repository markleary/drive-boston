import * as THREE from 'three';
import type {CityData,Road} from '../types';
import {bridgeEdgeSections,roadDeckGeometry,roadProjection,sampleRoadElevation} from '../simulation/road-surfaces.ts';
import {tunnelGeometry,tunnelStations,tunnelCoveredAt,tunnelAt,tunnelPointAt} from '../simulation/tunnels.ts';
import {PartBatches,box} from './geometry-writer.ts';

/** Procedural wall tilework is shared by every bore. Metre UVs keep the tile
 * joints and the green guidance band aligned to the local, sloping floor. */
function wallTexture(){
  const size=256,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const h=y/size*6,u=x/size*6,grout=(u%.45<.012||h%.3<.009),noise=((x*17+y*37)%13)-6;
    const base=h<.7?[99,105,102]:h>1.25&&h<1.56?[35,89,73]:[184,193,185];
    const shade=grout?.79:1,offset=(y*size+x)*4;
    for(let c=0;c<3;c++)data[offset+c]=Math.max(0,Math.min(255,base[c]*shade+noise));data[offset+3]=255;
  }
  const texture=new THREE.DataTexture(data,size,size);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}
function asphaltTexture(){
  const size=128,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4;let seed=Math.imul(x+1,374761393)^Math.imul(y+1,668265263);seed=Math.imul(seed^(seed>>>13),1274126177);const n=((seed^(seed>>>16))>>>0)%9-4;
    data[i]=70+n;data[i+1]=73+n;data[i+2]=73+n;data[i+3]=255;
  }
  const texture=new THREE.DataTexture(data,size,size);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.needsUpdate=true;return texture;
}

type MeshData={vertices:Float32Array;indices:Uint32Array};
function buffer(data:MeshData){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(data.vertices,3));geometry.setIndex(new THREE.BufferAttribute(data.indices,1));geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry;}
function tiledWall(data:MeshData,road:Road,city:CityData){
  const geometry=buffer(data),stations=tunnelStations(road),uv=new Float32Array(data.vertices.length/3*2);
  for(let i=0;i<data.vertices.length/3;i++){
    const x=data.vertices[i*3],y=data.vertices[i*3+1],z=data.vertices[i*3+2],hit=roadProjection(road,x,z);
    const s=stations[hit.index]+((stations[hit.index+1]??stations[hit.index])-stations[hit.index])*hit.t;
    uv[i*2]=s/6;uv[i*2+1]=(y-sampleRoadElevation(city,road,x,z))/6;
  }
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));return geometry;
}

function signMaterial(lines:string[],warning=false){
  // Headless geometry tests do not need a canvas; the game always has one.
  if(typeof document==='undefined')return new THREE.MeshBasicMaterial({color:warning?'#d5a94f':'#17634e'});
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;const ctx=canvas.getContext('2d')!;
  ctx.fillStyle=warning?'#242823':'#12563f';ctx.fillRect(0,0,1024,256);ctx.strokeStyle=warning?'#f2ba4a':'#e1e9d9';ctx.lineWidth=7;ctx.strokeRect(12,12,1000,232);
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=warning?'#ffcf69':'#f2f4e6';
  for(let i=0;i<lines.length;i++){ctx.font=`600 ${lines.length>2?43:i===0?56:48}px Arial, sans-serif`;ctx.fillText(lines[i],512,lines.length===1?128:62+i*(140/(lines.length-1)),966);}
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({map,toneMapped:false});
}
function destination(road:Road){
  const north=/north/i.test(road.name),south=/south/i.test(road.name);
  if(road.tunnel?.capStart||road.tunnel?.capEnd)return north?['I-93  NORTH','Zakim Bridge  ↑']:['I-93  SOUTH','South Station  ↑'];
  if(/entrance/i.test(road.name))return [`I-93  ${south?'SOUTH':'NORTH'}`,north?'Zakim Bridge  ↑':'South Station  ↑'];
  const target=road.name.split('·')[0].trim(),parts=target.split('/').map(s=>s.trim());
  return parts.length>1?['EXIT  ↗',parts[0],parts.slice(1).join(' / ')]:['EXIT  ↗',target];
}

/** Match each mapped exit to its bore or parent exit ramp at the start. Height is
 * essential: north/south bores sometimes overlap in plan at different levels. */
export function tunnelExitSigns(city:CityData){
  const parents=city.roads.filter(r=>r.tunnel&&(r.tunnel.capStart||r.tunnel.capEnd||/exit/i.test(r.name))),signs:{road:Road;station:number;lines:string[];rampId:string}[]=[];
  for(const ramp of city.roads){
    if(!ramp.tunnel||!ramp.elevations||!/exit/i.test(ramp.name))continue;
    const start=tunnelPointAt(ramp,0);let best:{road:Road;station:number;score:number}|undefined;
    for(const road of parents){
      if(road===ramp)continue;const projection=roadProjection(road,start.x,start.z),stations=tunnelStations(road),station=stations[projection.index]+(stations[projection.index+1]-stations[projection.index])*projection.t;
      const p=tunnelPointAt(road,station),height=Math.abs(p.y-start.y);
      if(projection.distance>p.width/2+ramp.width/2+.5||height>.8||station<45)continue;
      const score=projection.distance+height*4;if(!best||score<best.score)best={road,station,score};
    }
    if(!best)continue;
    const branch=tunnelPointAt(ramp,Math.min(35,tunnelStations(ramp).at(-1)!)),p=tunnelPointAt(best.road,best.station+30);
    const right=-(branch.x-p.x)*Math.cos(p.yaw)+(branch.z-p.z)*Math.sin(p.yaw),target=ramp.name.split('·')[0].trim(),parts=target.split('/').map(s=>s.trim());
    signs.push({road:best.road,station:best.station-40,lines:[`EXIT ${right>=0?'↗':'↖'}`,...parts.slice(0,2)],rampId:ramp.id});
  }
  return signs;
}

/** Source-aligned bores, portals and terminal closures. Geometry comes from
 * simulation/tunnels, so a visible wall cannot close a physically open merge. */
export function addTunnels(scene:THREE.Object3D,city:CityData){
  const roads=city.roads.filter(r=>r.tunnel&&r.elevations),group=new THREE.Group();group.name='Central Artery tunnels';
  const tunnelRoads={...city,roads};
  const tiles=wallTexture(),paving=asphaltTexture();
  const walls=new THREE.MeshStandardMaterial({map:tiles,emissiveMap:tiles,emissive:'#ffffff',emissiveIntensity:.35,roughness:.9});
  const asphalt=new THREE.MeshStandardMaterial({map:paving,emissiveMap:paving,emissive:'#ffffff',emissiveIntensity:.2,roughness:.95});
  const ceiling=new THREE.MeshStandardMaterial({color:'#414a49',emissive:'#66716e',emissiveIntensity:.22,roughness:.97});
  const concrete=new THREE.MeshStandardMaterial({color:'#b1b2a7',emissive:'#999c91',emissiveIntensity:.13,roughness:.96});
  const black=new THREE.MeshBasicMaterial({color:0x000000,fog:false});
  const white=new THREE.MeshStandardMaterial({color:'#ede9ca',emissive:'#e9e6c9',emissiveIntensity:.25,roughness:.88});
  const amber=new THREE.MeshBasicMaterial({color:'#e7b74b'}),darkMetal=new THREE.MeshStandardMaterial({color:'#394342',roughness:.8,metalness:.3});
  const lightMaterial=new THREE.MeshBasicMaterial({color:'#fff1c9',toneMapped:false}),batches=new PartBatches(180),matrix=new THREE.Matrix4();
  let fixtures=0,signs=0,closures=0,metres=0;
  const mesh=(geometry:THREE.BufferGeometry,material:THREE.Material,name:string)=>{
    if(!geometry.attributes.position?.count){geometry.dispose();return;}const object=new THREE.Mesh(geometry,material);object.name=name;object.receiveShadow=true;object.castShadow=material!==black;group.add(object);
  };
  const place=(material:THREE.Material,w:number,h:number,d:number,p:{x:number;y:number;z:number;yaw:number},rise=0,across=0,slope=0)=>{
    matrix.makeRotationFromEuler(new THREE.Euler(-slope,p.yaw,0,'YXZ'));matrix.setPosition(p.x+Math.cos(p.yaw)*across,p.y+rise,p.z-Math.sin(p.yaw)*across);batches.part(box(w,h,d),material,matrix);
  };
  const signPanel=(width:number,height:number,lines:string[],warning=false)=>{
    // Highway signs have one printed face. A solid metal panel hides that
    // texture from drivers approaching the rear, including wrong-way travel.
    const face=new THREE.Mesh(new THREE.PlaneGeometry(width,height),signMaterial(lines,warning));
    face.userData.tunnelSignFace=true;
    const back=new THREE.Mesh(new THREE.BoxGeometry(width,height,.08),darkMetal);
    back.name='Tunnel sign backing';back.position.z=-.055;face.add(back);
    return face;
  };
  const sign=(road:Road,s:number,lines:string[],warning=false,backwards=false)=>{
    const p=tunnelPointAt(road,s),width=Math.min(road.width-1,lines[0]==='BOSTON LURE'?2.6:6.6),height=width/4;
    const object=signPanel(width,height,lines,warning);object.name=lines.join(' / ');
    object.userData.roadId=road.id;object.userData.station=s;object.userData.backwards=backwards;
    object.position.set(p.x,p.y+road.tunnel!.clearance-height/2-.28,p.z);object.rotation.y=p.yaw+(backwards?0:Math.PI);group.add(object);signs++;
    place(darkMetal,tunnelCoveredAt(road,s)?width+.15:p.width+.9,.08,.12,p,road.tunnel!.clearance-.2);
    if(!tunnelCoveredAt(road,s))for(const side of [-1,1])place(darkMetal,.14,road.tunnel!.clearance,.14,p,road.tunnel!.clearance/2,side*(p.width/2+.35));
  };
  const paint=(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number},width:number)=>{
    const dx=b.x-a.x,dz=b.z-a.z,dy=b.y-a.y,length=Math.hypot(dx,dz);
    const middle={x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2,yaw:Math.atan2(dx,dz)};
    // Merges can have crossfall: every painted stripe follows its own part of
    // the deck instead of floating at the road centerline's elevation.
    place(white,width,.018,Math.hypot(length,dy),middle,.04,0,Math.atan2(dy,length));
  };
  const stripe=(road:Road,start:number,end:number,width:number,across:(width:number)=>number)=>{
    const endpoint=(s:number)=>{const p=tunnelPointAt(road,s),offset=across(p.width),x=p.x+Math.cos(p.yaw)*offset,z=p.z-Math.sin(p.yaw)*offset;return{x,z,y:sampleRoadElevation(city,road,x,z)};};
    paint(endpoint(start),endpoint(end),width);
  };
  for(const road of roads){
    const length=tunnelStations(road).at(-1)??0;metres+=length;
    const geometry=tunnelGeometry(city,road),deck=roadDeckGeometry(city,road,road.width,.018),floor=buffer(deck);floor.setAttribute('uv',new THREE.BufferAttribute(deck.uv,2));mesh(floor,asphalt,`${road.name} roadway`);
    mesh(tiledWall(geometry.walls,road,city),walls,`${road.name} tile walls`);mesh(buffer(geometry.roof),ceiling,`${road.name} ceiling`);
    mesh(buffer(geometry.barriers),concrete,`${road.name} concrete closure`);mesh(buffer(geometry.caps),black,`${road.name} black void`);
    const lanes=Math.max(1,Math.round((road.width-1.4)/3.5));
    // An edge inside a joined carriageway is no longer a road border. Retain
    // exterior lines and independent stacked roads, but leave merges open.
    for(const edge of bridgeEdgeSections(tunnelRoads,road,.7,.7,.15)){
      const endpoint=(p:[number,number])=>({x:p[0],z:p[1],y:sampleRoadElevation(city,road,...p)});
      paint(endpoint(edge.a),endpoint(edge.b),.13);
    }
    for(let s=2;s<length-2;s+=6){
      if(Math.floor(s/6)%2===0)for(let lane=1;lane<lanes;lane++)stripe(road,s,Math.min(length,s+3),.14,width=>-width/2+lane*width/lanes);
    }
    for(let s=8;s<length-5;s+=14){
      if(!tunnelCoveredAt(road,s))continue;const p=tunnelPointAt(road,s),clearance=road.tunnel!.clearance;
      for(const side of [-1,1]){
        const across=side*(p.width/2-1.05);place(darkMetal,.34,.11,3.3,p,clearance-.1,across);place(lightMaterial,.23,.035,2.9,p,clearance-.17,across);fixtures++;
      }
      // Reflector studs and service niches provide scale at driving height.
      if(Math.floor(s/14)%4===0)for(const side of [-1,1])place(amber,.09,.13,.19,p,.54,side*(p.width/2-.1));
    }
    // Portal headers and retaining faces come from the shared collision shell.
    // Separate decorative posts could otherwise close an adjoining ramp.
    for(let s=70;s<length-50;s+=400)if(tunnelCoveredAt(road,s))sign(road,s,destination(road));
    if(length<200&&length>45)sign(road,length*.55,destination(road));
    for(const atStart of [true,false]){
      if(!(atStart?road.tunnel!.capStart:road.tunnel!.capEnd))continue;closures++;
      const station=atStart?5:length-5,p=tunnelPointAt(road,station),yaw=p.yaw+(atStart?0:Math.PI);
      const face={...p,x:p.x+Math.sin(yaw)*.59,z:p.z+Math.cos(yaw)*.59,yaw};
      sign(road,atStart?19:length-19,['ROAD CLOSED','DO NOT ENTER'],true,atStart);
      for(let side=-p.width/2+.6;side<p.width/2;side+=1.1)place(amber,.5,.12,.025,face,.82,side);
      const lure=tunnelPointAt(road,atStart?1.2:length-1.2),object=signPanel(2.3,.58,['BOSTON LURE'],true);
      object.name='Boston Lure easter egg';object.position.set(lure.x+Math.cos(yaw)*(lure.width/2-1.7),lure.y+1.7,lure.z-Math.sin(yaw)*(lure.width/2-1.7));object.rotation.y=yaw;group.add(object);
    }
  }
  const exits=tunnelExitSigns(city);for(const exit of exits)sign(exit.road,exit.station,exit.lines);
  for(const object of batches.meshes()){object.name='Tunnel fixtures and markings';object.castShadow=false;object.receiveShadow=true;group.add(object);}
  const fill=new THREE.PointLight('#fff1d3',0,52,1.4);fill.name='Nearby tunnel light';group.add(fill);
  group.userData={roads:roads.length,metres:Math.round(metres),fixtures,signs,advanceExitSigns:exits.length,closures,alignment:'Boston official surveyed street centerlines',heights:'Estimated drivable profiles; not engineering survey'};
  scene.add(group);
  return{group,update(position:{x:number;y:number;z:number}){const inside=tunnelAt(city,position.x,position.z,position.y);fill.visible=!!inside?.covered;fill.intensity=fill.visible?38:0;fill.position.set(position.x,inside?Math.min(inside.ceiling-.4,position.y+2):position.y,position.z);}};
}
