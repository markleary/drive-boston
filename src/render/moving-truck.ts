import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {PLAYER_CARS} from '../simulation/player-cars.ts';
import {createMassachusettsPlateMaterial} from './car.ts';
import type {VehicleState} from '../types';

type P=[number,number,number];
type Surface='cab'|'box'|'aluminum'|'steel'|'black'|'rubber'|'glass'|'rust'|'headlight'|'taillight'|'amber';
type State=VehicleState&{rotation?:{x:number;y:number;z:number;w:number};wheelAngles?:number[];suspension?:number[];braking?:boolean;storrowDamage?:number;storrowDirection?:number};

/** Original medium-duty truck artwork, in meters, with +Z forward. The cab is
 * a continuous pressed-metal shell with real wheel openings. All cargo pieces
 * share a rest-space deformation, so rivets, lettering and seams crumple with
 * the aluminum instead of floating above the damaged box. */
function parts(){
  const buckets=new Map<Surface,THREE.BufferGeometry[]>();
  const add=(surface:Surface,g:THREE.BufferGeometry)=>{const list=buckets.get(surface)??[];list.push(g);buckets.set(surface,list);};
  const box=(surface:Surface,size:P,position:P,rotation?:P,segments:P=[1,1,1])=>{
    const g=new THREE.BoxGeometry(...size,...segments);
    if(rotation)g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    g.translate(...position);add(surface,g);
  };
  const beam=(surface:Surface,a:P,b:P,r=.012,sides=6)=>{
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),d=end.clone().sub(start);
    const g=new THREE.CylinderGeometry(r,r,d.length(),sides);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(THREE.Object3D.DEFAULT_UP,d.normalize()));
    g.translate(...start.add(end).multiplyScalar(.5).toArray() as P);add(surface,g);
  };
  const quad=(surface:Surface,p:P[])=>{
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,1,2,0,2,3].flatMap(i=>p[i]),3));g.computeVertexNormals();add(surface,g);
  };
  const finish=()=>{
    const result=new Map<Surface,THREE.BufferGeometry>();
    for(const [surface,gs] of buckets){const normalized=gs.map(g=>{const n=g.index?g.toNonIndexed():g;n.deleteAttribute('uv');if(n!==g)g.dispose();return n;});const merged=mergeGeometries(normalized,false)!;normalized.forEach(g=>g.dispose());result.set(surface,merged);}
    return result;
  };
  return {add,box,beam,quad,finish};
}

/** Closed pressed-steel fender sides join the bonnet/cab at their upper edge.
 * Their lower edges flare into a genuine wheel opening, with a full-width dark
 * liner behind them. Keeping this independent makes the steering envelope and
 * the continuous cab attachment testable. */
export function createMovingTruckFenderGeometry(side:number){
  const positions:number[]=[],indices:number[]=[],columns=64,rows=4;
  const lower=(z:number)=>{const d=z-2.20;return Math.abs(d)<.64?Math.max(-.35,-.38+Math.sqrt(.64*.64-d*d)):-.35;};
  for(let layer=0;layer<2;layer++)for(let i=0;i<=columns;i++){
    const z=1.25+i/columns*2.45,hood=z<2.78?.72:.72-.18*Math.pow((z-2.78)/.92,1.4),bottom=lower(z),flare=.115*Math.exp(-Math.pow((z-2.20)/.83,4));
    for(let j=0;j<=rows;j++){
      const t=j/rows,x=1.055+flare*Math.pow(1-t,1.5)-(layer?.075:0);
      positions.push(side*x,THREE.MathUtils.lerp(bottom,hood,t),z);
    }
  }
  const stride=rows+1,layerSize=(columns+1)*stride;
  const face=(a:number,b:number,c:number,d:number,flip=false)=>{if((side>0)!==flip)indices.push(a,c,b,a,d,c);else indices.push(a,b,c,a,c,d);};
  for(let layer=0;layer<2;layer++)for(let i=0;i<columns;i++)for(let j=0;j<rows;j++){
    const a=layer*layerSize+i*stride+j;face(a,a+stride,a+stride+1,a+1,layer===1);
  }
  for(let i=0;i<columns;i++){
    const a=i*stride,b=(i+1)*stride;face(a,layerSize+a,layerSize+b,b);
    face(a+rows,b+rows,layerSize+b+rows,layerSize+a+rows);
  }
  for(let j=0;j<rows;j++){
    face(j,j+1,layerSize+j+1,layerSize+j);
    const a=columns*stride+j;face(a,layerSize+a,layerSize+a+1,a+1);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

function wheelWellLiner(side:number){
  const p=parts(),v:number[]=[],idx:number[]=[],segments=48;
  for(const x of [.58,1.153])for(let i=0;i<=segments;i++){const a=i/segments*Math.PI;v.push(side*x,-.38+Math.sin(a)*.628,2.20+Math.cos(a)*.628);}
  for(let i=0;i<segments;i++){const a=i,b=i+segments+1;idx.push(a,b,a+1,b,b+1,a+1);}
  const tunnel=new THREE.BufferGeometry();tunnel.setAttribute('position',new THREE.Float32BufferAttribute(v,3));tunnel.setIndex(idx);tunnel.computeVertexNormals();p.add('black',tunnel);
  const back=new THREE.CircleGeometry(.628,48,0,Math.PI);back.rotateY(side*Math.PI/2);back.translate(side*.58,-.38,2.20);p.add('black',back);
  return p.finish();
}

function cabGeometry(){
  const p=parts(),vertices:number[]=[],indices:number[]=[],rings=90,around=32;
  // A rounded steel front clip with a raised hood and relieved wheel wells.
  for(let i=0;i<=rings;i++){
    const z=1.25+i/rings*2.45,hood=z<2.78?.72:.72-.18*Math.pow((z-2.78)/.92,1.4),width=1.055-.07*Math.pow(Math.max(0,(z-3.35)/.35),2);
    const d=Math.abs(z-2.20),bottom=d<.66?-.37+Math.sqrt(.66*.66-d*d):-.37;
    for(let j=0;j<around;j++){
      const a=j/around*Math.PI*2,x=Math.sin(a)*width,u=Math.abs(Math.sin(a));
      const y=Math.cos(a)>=0?hood+.055*(1-u*u):THREE.MathUtils.lerp(bottom,hood-.025,Math.pow(u,12));
      vertices.push(x,y,z);
    }
  }
  for(let i=0;i<rings;i++)for(let j=0;j<around;j++){const a=i*around+j,b=i*around+(j+1)%around;indices.push(a,a+around,b,b,a+around,b+around);}
  for(const [off,reverse] of [[0,false],[rings*around,true]] as const)for(let j=1;j<around-1;j++)indices.push(off,off+(reverse?j+1:j),off+(reverse?j:j+1));
  const shell=new THREE.BufferGeometry();shell.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));shell.setIndex(indices);shell.computeVertexNormals();p.add('cab',shell);
  // Cab rear, crown, inset windscreen and separately outlined doors.
  p.box('cab',[1.99,.98,.09],[0,1.10,1.30]);
  const roof=new THREE.SphereGeometry(1,36,14,0,Math.PI*2,0,Math.PI/2);roof.scale(1.015,.15,.72);roof.translate(0,1.57,1.99);p.add('cab',roof);
  p.box('cab',[1.99,.07,1.34],[0,1.57,1.99]);
  const wind:P[]=[[-.93,.79,2.86],[.93,.79,2.86],[.86,1.53,2.57],[-.86,1.53,2.57]];
  p.quad('glass',wind);
  for(let i=0;i<4;i++)p.beam('black',wind[i],wind[(i+1)%4],.026);
  p.beam('black',[0,.79,2.865],[0,1.53,2.575],.012);
  for(const side of [-1,1]){
    const glass:P[]=[[side*1.006,.79,1.45],[side*1.015,.79,2.68],[side*.875,1.53,2.53],[side*.95,1.53,1.45]];
    p.quad('glass',side>0?glass:[...glass].reverse());
    for(let i=0;i<4;i++)p.beam('black',glass[i],glass[(i+1)%4],.018);
    p.beam('cab',[side*1.015,.76,2.72],[side*.89,1.56,2.55],.035);
    p.beam('cab',[side*1.01,.76,1.41],[side*.96,1.56,1.41],.032);
    p.beam('cab',[side*1.01,.80,2.38],[side*.92,1.52,2.34],.014);
    p.beam('black',[side*1.064,.70,1.43],[side*1.064,-.32,1.43],.0045);
    p.beam('black',[side*1.067,.70,2.76],[side*1.067,.27,2.78],.0045);
    p.box('black',[.016,.075,.23],[side*1.067,.61,1.70]);
    p.box('aluminum',[.025,.026,.19],[side*1.079,.635,1.70]);
    // Paired tubular mirror braces, rectangular convex mirror and rubber surround.
    for(const y of [.82,1.25])p.beam('steel',[side*1.02,y,2.66],[side*1.39,y,2.60],.016);
    p.beam('steel',[side*1.39,.82,2.60],[side*1.39,1.25,2.60],.014);
    p.box('black',[.16,.38,.07],[side*1.39,1.16,2.59]);
    p.box('glass',[.132,.34,.009],[side*1.39,1.16,2.55]);
    p.box('black',[.13,.13,.055],[side*1.39,.87,2.59]);
    p.box('glass',[.11,.105,.009],[side*1.39,.87,2.555]);
    // The step ends behind the wheel opening, with brackets into the chassis.
    p.box('steel',[.30,.065,.70],[side*1.08,-.36,1.20]);
    for(let i=0;i<12;i++)p.box('aluminum',[.24,.009,.018],[side*1.08,-.322,.90+i*.055]);
    for(const z of [.98,1.43])p.beam('steel',[side*.63,-.26,z],[side*1.08,-.38,z],.032);
    p.beam('black',[side*.79,.765,2.83],[side*.79,.605,3.58],.005);
    for(let i=0;i<5;i++)p.box('black',[.012,.025,.10],[side*1.045,.56,2.98+i*.115]);
    p.box('amber',[.025,.075,.13],[side*1.065,.43,3.40]);
    p.box('black',[.48,.31,.04],[side*.72,.30,3.712]);
    p.box('headlight',[.28,.20,.05],[side*.72,.33,3.739]);
    p.box('amber',[.13,.08,.052],[side*.94,.20,3.72]);
    // Genuine chassis rails, leaf springs, axle and underbody fuel tanks.
    p.box('steel',[.12,.22,6.66],[side*.63,-.20,-.28]);
    for(const z of [-2.20,2.20])for(let leaf=0;leaf<4;leaf++)p.box('steel',[.08,.014,1.05-leaf*.16],[side*.65,-.40-leaf*.017,z]);
    const tank=new THREE.CylinderGeometry(.26,.26,.94,20);tank.rotateX(Math.PI/2);tank.translate(side*.88,-.22,.34);p.add('aluminum',tank);
    for(const z of [.04,.64]){const band=new THREE.TorusGeometry(.265,.016,5,24);band.translate(side*.88,-.22,z);p.add('steel',band);}
  }
  p.box('black',[.87,.42,.065],[0,.26,3.715]);
  for(let y=.10;y<.45;y+=.06)p.box('aluminum',[.90,.022,.026],[0,y,3.755]);
  p.box('aluminum',[.075,.36,.032],[0,.28,3.775]);
  p.box('steel',[2.22,.18,.17],[0,-.085,3.735]);
  for(const x of [-.91,.91])p.box('black',[.12,.22,.20],[x,-.085,3.73]);
  p.box('black',[.45,.10,.035],[0,-.29,3.72]);
  for(const x of [-.56,.53])p.beam('black',[x,.81,2.873],[x-.29,1.02,2.795],.010);
  // Five incandescent roof markers, an aged exhaust and visible differential.
  for(const x of [-.83,-.40,0,.40,.83])p.box('amber',[.075,.055,.12],[x,1.705,2.32]);
  for(const z of [-2.20,2.20])p.beam('steel',[-1,-.47,z],[1,-.47,z],.070,10);
  const diff=new THREE.SphereGeometry(.20,14,10);diff.scale(1.1,.9,1);diff.translate(0,-.45,-2.20);p.add('steel',diff);
  p.beam('steel',[0,-.31,1.55],[0,-.45,-2.20],.052,10);
  p.beam('rust',[-.70,-.27,1.3],[-.70,-.29,-1.48],.045,10);p.beam('rust',[-.70,-.29,-1.48],[-1.17,-.30,-1.63],.045,10);
  p.box('black',[.5,.23,.60],[.83,-.18,-.52]);
  // Surface chips on the bumper and step stay on their planar steel panels.
  for(let i=0;i<24;i++)p.box('rust',[.018+(i%5)*.012,.012+(i%3)*.006,.003],[-1.01+i*.087,-.15+(i%2)*.025,3.822]);
  return p.finish();
}

function cargoGeometry(){
  const p=parts();
  // Subdivided sheet panels, not one rigid cuboid: roof impacts fold the metal.
  for(const side of [-1,1])p.box('box',[.025,2.54,4.86],[side*1.195,1.425,-1.205],undefined,[1,12,24]);
  p.box('aluminum',[2.42,.035,4.89],[0,2.7025,-1.205],undefined,[12,1,24]);
  p.box('box',[2.39,2.54,.03],[0,1.425,1.225],undefined,[12,12,1]);
  p.box('steel',[2.36,.11,4.88],[0,.13,-1.205]);
  for(const side of [-1,1]){
    for(const y of [.19,2.66])p.box('aluminum',[.065,.10,4.94],[side*1.19,y,-1.205],undefined,[1,1,36]);
    for(const z of [-3.62,1.21])p.box('aluminum',[.07,2.54,.07],[side*1.19,1.425,z],undefined,[1,16,1]);
    for(let z=-3.45;z<=1.10;z+=.38){
      p.box('aluminum',[.012,2.41,.018],[side*1.212,1.425,z],undefined,[1,16,1]);
      for(const y of [.24,.36,2.48,2.60]){const g=new THREE.SphereGeometry(.013,5,4);g.scale(.45,1,1);g.translate(side*1.222,y,z);p.add('steel',g);}
    }
    p.box('aluminum',[.034,.11,4.80],[side*1.216,.53,-1.205],undefined,[1,1,36]);
    for(let i=0;i<9;i++)p.box(i%2?'aluminum':'taillight',[.009,.038,.24],[side*1.236,.54,-3.27+i*.51]);
    for(const z of [-3.38,1.01])p.box(z>0?'amber':'taillight',[.035,.07,.11],[side*1.24,.30,z]);
    p.box('black',[.47,.65,.04],[side*1.00,-.37,-2.77]);
    p.box('aluminum',[.44,.025,.055],[side*1.00,-.685,-2.79]);
    for(let i=0;i<16;i++)p.box('rust',[.006,.02+(i%4)*.006,.035+(i%5)*.013],[side*1.23,.15+(i%2)*.05,-3.5+i*.28]);
  }
  // Roll-up rear door, curved exposed tracks, hardware and full underride step.
  p.box('aluminum',[2.23,2.43,.025],[0,1.425,-3.655],undefined,[12,12,1]);
  for(let y=.30;y<2.63;y+=.20)p.box('steel',[2.21,.011,.011],[0,y,-3.675],undefined,[20,1,1]);
  for(const x of [-1.15,1.15]){
    p.box('aluminum',[.07,2.51,.075],[x,1.425,-3.67],undefined,[1,16,1]);
    for(const y of [.46,1.07,1.68,2.29])p.box('steel',[.11,.07,.035],[x*.92,y,-3.694]);
  }
  for(const x of [-.69,.69])p.box('steel',[.025,1.81,.024],[x,1.24,-3.699],undefined,[1,14,1]);
  p.box('steel',[.38,.045,.06],[0,.44,-3.714]);
  p.box('black',[.17,.07,.015],[0,.54,-3.692]);
  p.box('steel',[2.38,.13,.30],[0,-.04,-3.65]);
  for(const x of [-.91,.91]){
    p.box('steel',[.12,.40,.11],[x,-.27,-3.49]);
    p.box('black',[.39,.19,.05],[x,.12,-3.70]);
    for(const dx of [-.1,.1]){const lamp=new THREE.CylinderGeometry(.066,.066,.028,20);lamp.rotateX(Math.PI/2);lamp.translate(x+dx,.12,-3.742);p.add(dx<0?'taillight':'amber',lamp);}
  }
  p.box('steel',[2.18,.10,.15],[0,-.48,-3.64]);
  for(const x of [-.78,-.39,0,.39,.78])p.box('taillight',[.19,.035,.012],[x,-.46,-3.72]);
  return p.finish();
}

function wheelGeometry(side:number,rear:boolean){
  const p=parts(),offsets=rear?[0,-side*.27]:[0];
  for(const offset of offsets){
    const tire=new THREE.LatheGeometry([new THREE.Vector2(.29,-.12),new THREE.Vector2(.425,-.13),new THREE.Vector2(.47,-.085),new THREE.Vector2(.47,.085),new THREE.Vector2(.425,.13),new THREE.Vector2(.29,.12)],40);
    tire.rotateZ(Math.PI/2);tire.translate(offset,0,0);p.add('rubber',tire);
    for(const x of [-.055,.055]){const groove=new THREE.TorusGeometry(.469,.006,4,40);groove.rotateY(Math.PI/2);groove.translate(offset+x,0,0);p.add('black',groove);}
    for(let i=0;i<40;i++){const a=i/40*Math.PI*2;p.box('rubber',[.21,.009,.028],[offset,Math.cos(a)*.468,Math.sin(a)*.468],[a,side*.12,0]);}
    const face=offset+side*.133,rim=new THREE.CylinderGeometry(.294,.294,.05,32);rim.rotateZ(Math.PI/2);rim.translate(face-side*.032,0,0);p.add('aluminum',rim);
    const lip=new THREE.TorusGeometry(.288,.017,6,40);lip.rotateY(Math.PI/2);lip.translate(face,0,0);p.add('aluminum',lip);
    for(let i=0;i<8;i++){
      const a=i/8*Math.PI*2,hole=new THREE.CircleGeometry(.039,10);hole.rotateY(side*Math.PI/2);hole.translate(face+side*.001,Math.cos(a)*.207,Math.sin(a)*.207);p.add('black',hole);
      const bolt=new THREE.CylinderGeometry(.013,.013,.024,6);bolt.rotateZ(Math.PI/2);bolt.translate(face+side*.022,Math.cos(a)*.102,Math.sin(a)*.102);p.add('steel',bolt);
    }
    const hub=new THREE.CylinderGeometry(rear?.078:.063,rear?.078:.063,rear?.15:.09,16);hub.rotateZ(Math.PI/2);hub.translate(face+side*(rear?.055:.025),0,0);p.add(rear?'steel':'aluminum',hub);
  }
  return p.finish();
}

/** Decals are original canvas artwork; no third-party logos or source photos. */
function liveryTexture(rear:boolean){
  if(typeof document==='undefined')return null;
  const canvas=document.createElement('canvas');canvas.width=rear?1024:1536;canvas.height=768;
  const ctx=canvas.getContext('2d')!,w=canvas.width,h=canvas.height;
  ctx.fillStyle='#cdb058';ctx.fillRect(0,0,w,h);
  const grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,'rgba(255,251,218,.20)');grad.addColorStop(.35,'rgba(255,251,218,0)');grad.addColorStop(1,'rgba(59,39,19,.22)');ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
  ctx.fillStyle='#29494d';ctx.fillRect(0,h*.13,w,h*.045);ctx.fillRect(0,h*.80,w,h*.055);
  ctx.textAlign='center';ctx.fillStyle='#29494d';ctx.font=`italic 900 ${rear?125:166}px Georgia`;ctx.fillText('Storrow',w/2,h*.43,w*.88);
  ctx.font=`900 ${rear?94:110}px Arial`;ctx.fillText('MOVERS',w/2,h*.60,w*.75);
  ctx.font=`bold ${rear?32:36}px Arial`;ctx.fillText('BOSTON  •  SINCE 1987',w/2,h*.72,w*.85);
  ctx.fillStyle='#f0dfad';ctx.font=`bold ${rear?28:30}px Arial`;ctx.fillText(rear?'WE MAKE BIG MOVES.':'YOU PACK IT. WE HAUL IT.',w/2,h*.84,w*.89);
  if(rear){
    // Lettering is painted across the roll-up door's individual slats.
    for(let y=0;y<h;y+=h/12){ctx.fillStyle='rgba(31,35,30,.38)';ctx.fillRect(0,y,w,2);ctx.fillStyle='rgba(255,244,206,.28)';ctx.fillRect(0,y+2,w,1);}
  }else{
    for(let x=0;x<w;x+=w/13){ctx.fillStyle='rgba(45,43,29,.14)';ctx.fillRect(x,0,1,h);for(const y of [16,45,h-17,h-45]){ctx.fillStyle='#827c5c';ctx.beginPath();ctx.arc(x,y,2.2,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ded4a5';ctx.fillRect(x-1,y-1,1,1);}}
  }
  // Faded paint, rubbed edges, rain streaks and small irregular rust blooms.
  let seed=18271;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<2600;i++){const x=rand()*w,y=rand()*h;ctx.fillStyle=i%3?'rgba(244,228,186,.17)':'rgba(89,69,38,.08)';ctx.fillRect(x,y,rand()*9+1,rand()*2+1);}
  for(let i=0;i<80;i++){const x=rand()*w;ctx.fillStyle='rgba(59,44,25,.08)';ctx.fillRect(x,0,1+rand()*3,20+rand()*h*.8);}
  for(let i=0;i<125;i++){const x=rand()*w,y=rand()>.5?rand()*h*.055:h-rand()*h*.08;ctx.fillStyle=i%2?'rgba(115,62,27,.62)':'rgba(238,222,172,.52)';ctx.beginPath();ctx.ellipse(x,y,2+rand()*14,1+rand()*5,rand(),0,Math.PI*2);ctx.fill();}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
}

export function createMovingTruck(){
  const spec=PLAYER_CARS['moving-truck'],group=new THREE.Group();group.name='PlayerStorrowMovers';group.userData.carId='moving-truck';
  const materials:Record<Surface,THREE.MeshStandardMaterial>={
    cab:new THREE.MeshPhysicalMaterial({color:0xd9d3b9,metalness:.24,roughness:.52,clearcoat:.18,clearcoatRoughness:.4,side:THREE.DoubleSide}),
    box:new THREE.MeshStandardMaterial({color:0xcdb058,metalness:.20,roughness:.72,side:THREE.DoubleSide}),
    aluminum:new THREE.MeshStandardMaterial({color:0xb0afa2,metalness:.72,roughness:.45,side:THREE.DoubleSide}),
    steel:new THREE.MeshStandardMaterial({color:0x4c514d,metalness:.55,roughness:.58}),
    black:new THREE.MeshStandardMaterial({color:0x1b211f,roughness:.82,side:THREE.DoubleSide}),
    rubber:new THREE.MeshStandardMaterial({color:0x222521,roughness:.96}),
    glass:new THREE.MeshPhysicalMaterial({color:0x24393b,metalness:.33,roughness:.16,clearcoat:.8,side:THREE.DoubleSide}),
    rust:new THREE.MeshStandardMaterial({color:0x885432,roughness:.96,side:THREE.DoubleSide}),
    headlight:new THREE.MeshStandardMaterial({color:0xd9d8b6,emissive:0xffd38d,emissiveIntensity:.35,roughness:.35}),
    taillight:new THREE.MeshStandardMaterial({color:0x8f211c,emissive:0xe82e17,emissiveIntensity:.25,roughness:.45}),
    amber:new THREE.MeshStandardMaterial({color:0xbd7929,emissive:0xf5a229,emissiveIntensity:.18,roughness:.40}),
  };
  const deformed:{geometry:THREE.BufferGeometry;rest:Float32Array}[]=[];
  const addParts=(destination:THREE.Group,geometries:Map<Surface,THREE.BufferGeometry>,damage=false)=>{
    for(const [surface,geometry] of geometries){const mesh=new THREE.Mesh(geometry,materials[surface]);mesh.castShadow=true;mesh.receiveShadow=true;destination.add(mesh);if(damage)deformed.push({geometry,rest:Float32Array.from(geometry.attributes.position.array)});}
  };
  addParts(group,cabGeometry());
  for(const side of [-1,1]){
    const fender=new THREE.Mesh(createMovingTruckFenderGeometry(side),materials.cab);fender.name=side<0?'MovingTruckLeftFender':'MovingTruckRightFender';fender.castShadow=true;fender.receiveShadow=true;group.add(fender);
    const liner=new THREE.Group();liner.name=side<0?'MovingTruckLeftWheelWell':'MovingTruckRightWheelWell';group.add(liner);addParts(liner,wheelWellLiner(side));
  }
  const cargo=new THREE.Group();cargo.name='MovingTruckCargoBox';group.add(cargo);addParts(cargo,cargoGeometry(),true);
  for(const side of [-1,1]){
    const geometry=new THREE.PlaneGeometry(4.78,2.35,36,18);geometry.rotateY(side*Math.PI/2);geometry.translate(side*1.224,1.435,-1.205);
    const mat=new THREE.MeshStandardMaterial({map:liveryTexture(false),color:typeof document==='undefined'?0xcdb058:0xffffff,roughness:.77,metalness:.12,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
    const mesh=new THREE.Mesh(geometry,mat);mesh.name=side<0?'StorrowMoversLeft':'StorrowMoversRight';mesh.receiveShadow=true;cargo.add(mesh);deformed.push({geometry,rest:Float32Array.from(geometry.attributes.position.array)});
  }
  const rearGeometry=new THREE.PlaneGeometry(2.14,2.29,20,18);rearGeometry.rotateY(Math.PI);rearGeometry.translate(0,1.435,-3.681);
  const rearMaterial=new THREE.MeshStandardMaterial({map:liveryTexture(true),color:typeof document==='undefined'?0xcdb058:0xffffff,roughness:.78,metalness:.15,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  const rear=new THREE.Mesh(rearGeometry,rearMaterial);rear.name='StorrowMoversRear';rear.receiveShadow=true;cargo.add(rear);deformed.push({geometry:rearGeometry,rest:Float32Array.from(rearGeometry.attributes.position.array)});
  const plateMat=createMassachusettsPlateMaterial('SM 1987'),plates=[];
  for(const [z,y] of [[3.83,-.08],[-3.82,-.18]]){const g=new THREE.PlaneGeometry(.305,.1524);if(z<0)g.rotateY(Math.PI);g.translate(z<0?-.38:0,y,z);plates.push(g);}
  const plateGeometry=mergeGeometries(plates,false)!;plates.forEach(g=>g.dispose());const plateMesh=new THREE.Mesh(plateGeometry,plateMat);plateMesh.name='PlayerMassachusettsPlates';group.add(plateMesh);
  const wheels:{pivot:THREE.Group;spin:THREE.Group}[]=[];
  for(const z of [spec.wheelbase/2,-spec.wheelbase/2])for(const side of [-1,1]){
    const pivot=new THREE.Group(),spin=new THREE.Group();pivot.name=`MovingTruck${z>0?'Front':'Rear'}${side<0?'Left':'Right'}Wheel`;pivot.position.set(side*(z>0?spec.track:spec.rearTrack)/2,-.08-spec.suspensionRest,z);pivot.add(spin);group.add(pivot);addParts(spin,wheelGeometry(side,z<0));wheels.push({pivot,spin});
  }
  // Peeled aluminum tabs reveal dark voids at the torn upper leading edge.
  const tears=new THREE.Group();tears.name='MovingTruckTornRoof';tears.visible=false;cargo.add(tears);
  for(let i=0;i<9;i++){
    const g=new THREE.PlaneGeometry(.25,.65,1,3),pos=g.attributes.position;
    for(let v=0;v<pos.count;v++)pos.setZ(v,.12*Math.sin(v*2.7+i));g.computeVertexNormals();
    const mesh=new THREE.Mesh(g,materials.aluminum);mesh.position.set(-1.03+i*.258,2.17,.61+(i%3)*.09);mesh.rotation.set(-.35+(i%3)*.22,0,(i%2?1:-1)*.28);mesh.castShadow=true;tears.add(mesh);
  }
  let currentDamage=0,currentDirection=1;
  function setDamage(amount:number,direction=1){
    amount=THREE.MathUtils.clamp(amount,0,1);direction=direction<0?-1:1;if(amount===currentDamage&&direction===currentDirection)return;
    currentDamage=amount;currentDirection=direction;group.userData.storrowDamage=amount;
    for(const {geometry,rest} of deformed){
      const attr=geometry.attributes.position;
      for(let i=0;i<attr.count;i++){
        const x=rest[i*3],y=rest[i*3+1],z=rest[i*3+2],edge=direction>0?1.24:-3.65;
        const fromFront=(edge-z)*direction,zone=THREE.MathUtils.clamp(1-fromFront/2.25,0,1),upper=THREE.MathUtils.smoothstep(y,1.40,2.68),fold=zone*zone*upper*amount;
        const ripple=Math.sin(fromFront*13.5+x*.9)*.10*zone*upper*amount;
        attr.setXYZ(i,x+Math.sign(x)*fold*.23,y-fold*.76+ripple,z-direction*fold*.78);
      }
      attr.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.computeBoundingBox();
    }
    tears.visible=amount>.08;tears.scale.set(1,amount,1);tears.position.z=direction>0?0:-2.41;tears.rotation.y=direction>0?0:Math.PI;
  }
  const lights:THREE.SpotLight[]=[];
  for(const x of [-.72,.72]){const light=new THREE.SpotLight(0xffd69a,0,58,.41,.68,1.5);light.position.set(x,.33,3.80);light.target.position.set(x,-.40,29);light.visible=false;group.add(light,light.target);lights.push(light);}
  const bodyParts=group.children.filter(o=>!(o instanceof THREE.Light)&&!lights.some(l=>l.target===o)),bounds=new THREE.Box3().setFromObject(group).expandByScalar(.22),localCamera=new THREE.Vector3();let bodyVisible=true,wheelAngle=0;
  function setCameraPosition(position:THREE.Vector3){const visible=!bounds.containsPoint(group.worldToLocal(localCamera.copy(position)));if(visible===bodyVisible)return;bodyVisible=visible;for(const part of bodyParts)part.visible=visible;}
  return {
    group,setCameraPosition,setDamage,get bodyVisible(){return bodyVisible;},
    update(state:VehicleState,night:boolean,dt=1/60){
      const s=state as State;group.position.set(s.x,s.y,s.z);if(s.rotation)group.quaternion.set(s.rotation.x,s.rotation.y,s.rotation.z,s.rotation.w);else group.rotation.set(0,s.yaw,0);
      wheelAngle+=s.speed*Math.min(dt,.1)/spec.wheelRadius;
      wheels.forEach((w,i)=>{w.pivot.rotation.y=i<2?s.steering:0;w.pivot.position.y=-.08-(s.suspension?.[i]??spec.suspensionRest);w.spin.rotation.x=s.wheelAngles?.[i]??wheelAngle;});
      if(s.storrowDamage!==undefined)setDamage(s.storrowDamage,s.storrowDirection);
      materials.headlight.emissiveIntensity=night?2.5:.35;materials.taillight.emissiveIntensity=s.braking?3.8:night?1.5:.25;materials.amber.emissiveIntensity=night?.8:.18;
      for(const light of lights){light.intensity=night?44:0;light.visible=night;}
    },
    dispose(){
      const geometries=new Set<THREE.BufferGeometry>(),mats=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
      group.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])mats.add(m);}});
      geometries.forEach(g=>g.dispose());for(const m of mats){const map=(m as THREE.MeshStandardMaterial).map;if(map)textures.add(map);m.dispose();}textures.forEach(t=>t.dispose());
    },
  };
}
