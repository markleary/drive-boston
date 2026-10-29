import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Original procedural interpretation of the silver-and-green articulated fleet.
// One vehicle is one car: three independently posed sections and two flexible joints.
// +Z is forward; dimensions match the existing transit physics adapter.
const SILVER=0xdaddd7,GREEN=0x28523f,ROOF=0xe1e3dc;
const END_LENGTH=7.7,CENTER_LENGTH=6.25;
type Surface='paint'|'dark'|'rubber'|'metal'|'glass'|'windscreen'|'head'|'tail';
type Side=1|-1;
type Face=Side|'cab';

function roundRect(w:number,h:number,r:number){
  const s=new THREE.Shape(),x=-w/2,y=-h/2;
  s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);
  s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);
  s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;
}

// Glazing, trim and markings follow the same bowed and raked cab face.
function cabZ(x:number,y:number){return 3.83-.34*THREE.MathUtils.smoothstep(y,2.61,3.31)-.16*(Math.abs(x)/1.27)**5;}
function panel(w:number,h:number,r:number,face:Face,u:number,y:number,offset=.014){
  const g:THREE.BufferGeometry=face==='cab'?new THREE.PlaneGeometry(w,h,w>1?24:6,h>.7?14:4):new THREE.ShapeGeometry(roundRect(w,h,r),6);
  const pos=g.getAttribute('position'),uv=g.getAttribute('uv');
  for(let i=0;i<pos.count;i++){
    let a=pos.getX(i);const b=pos.getY(i);
    if(face==='cab'){
      const corner=Math.max(0,Math.abs(b)-(h/2-r));
      a*=(w/2-r+Math.sqrt(Math.max(0,r*r-corner*corner)))/(w/2);
    }
    uv.setXY(i,a/w+.5,b/h+.5);
    if(face==='cab')pos.setXYZ(i,a+u,b+y,cabZ(a+u,b+y)+offset);
    else pos.setXYZ(i,face*(1.27+offset),b+y,u-face*a);
  }
  g.computeVertexNormals();return g;
}

let windowMap:THREE.CanvasTexture|undefined;
function windowTexture(){
  if(typeof document==='undefined')return null;if(windowMap)return windowMap;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const c=canvas.getContext('2d')!,gradient=c.createLinearGradient(0,0,0,256);
  gradient.addColorStop(0,'#475b60');gradient.addColorStop(.38,'#2c4147');gradient.addColorStop(1,'#15262c');
  c.fillStyle=gradient;c.fillRect(0,0,256,256);
  c.fillStyle='#192e35';for(const x of [24,156]){c.beginPath();c.roundRect(x,161,74,95,13);c.fill();}
  c.fillStyle='#968666';c.fillRect(230,10,3,242);
  c.fillStyle='rgba(204,223,219,.13)';c.beginPath();c.moveTo(0,43);c.lineTo(256,8);c.lineTo(256,34);c.lineTo(0,69);c.fill();
  windowMap=new THREE.CanvasTexture(canvas);windowMap.colorSpace=THREE.SRGBColorSpace;return windowMap;
}

const materials=new Map<Surface,THREE.MeshStandardMaterial>();
function material(kind:Surface){
  let result=materials.get(kind);if(result)return result;
  const styles:Record<Surface,THREE.MeshStandardMaterialParameters>={
    paint:{color:0xffffff,roughness:.39,metalness:.24},dark:{color:0x252b2b,roughness:.61,metalness:.13},
    rubber:{color:0x121917,roughness:.87},metal:{color:0x919d9b,roughness:.32,metalness:.76},
    glass:{color:0xffffff,map:windowTexture(),roughness:.19,metalness:.31},
    windscreen:{color:0x24383d,roughness:.12,metalness:.42},
    head:{color:0xf4f1d9,emissive:0xffedba,emissiveIntensity:.45,roughness:.17},
    tail:{color:0xb92419,emissive:0xd42616,emissiveIntensity:.35,roughness:.25},
  };
  result=new THREE.MeshStandardMaterial({...styles[kind],vertexColors:true});materials.set(kind,result);return result;
}
function builder(){
  const parts=new Map<Surface,THREE.BufferGeometry[]>();
  const add=(kind:Surface,g:THREE.BufferGeometry,color=0xffffff)=>{
    const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();const count=n.getAttribute('position').count;
    if(!n.getAttribute('uv'))n.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(count*2),2));
    const rgb=new THREE.Color(color),colors=new Float32Array(count*3);for(let i=0;i<count;i++)rgb.toArray(colors,i*3);
    n.setAttribute('color',new THREE.BufferAttribute(colors,3));const list=parts.get(kind)??[];list.push(n);parts.set(kind,list);
  };
  const box=(kind:Surface,w:number,h:number,d:number,x:number,y:number,z:number,r=.025,color=0xffffff)=>{
    // Sub-pixel grille bars, seams and trim do not need rounded-box tessellation.
    const g=r&&Math.min(w,h,d)>.08?new RoundedBoxGeometry(w,h,d,1,Math.min(r,w/2,h/2,d/2)):new THREE.BoxGeometry(w,h,d);add(kind,g.translate(x,y,z),color);
  };
  const beam=(kind:Surface,a:number[],b:number[],radius=.023)=>{
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start),g=new THREE.CylinderGeometry(radius,radius,delta.length(),8);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));add(kind,g.translate(...start.add(end).multiplyScalar(.5).toArray()));
  };
  const finish=()=>{
    const group=new THREE.Group();for(const [kind,geometries]of parts){
      const geometry=mergeGeometries(geometries,false)!;geometries.forEach(g=>g.dispose());const mesh=new THREE.Mesh(geometry,material(kind));mesh.name=kind;
      mesh.castShadow=!['glass','windscreen','head','tail'].includes(kind);mesh.receiveShadow=true;group.add(mesh);
    }return group;
  };
  return{add,box,beam,finish};
}
type Builder=ReturnType<typeof builder>;

function shell(p:Builder,length:number,cab:boolean){
  // Continuous shoulder and tapered cab skin, rather than overlapping roof boxes.
  const levels=[{y:.36,x:1.24},{y:1.30,x:1.27},{y:2.66,x:1.27},{y:2.79,x:1.25},{y:3.19,x:1.09},{y:3.29,x:.98}];
  const rings=levels.map(({x:hw,y})=>{
    const radius=.12,ring:number[][]=[];
    for(const [cx,cz,start]of [[hw-radius,length/2-radius,0],[-hw+radius,length/2-radius,Math.PI/2],[-hw+radius,-length/2+radius,Math.PI],[hw-radius,-length/2+radius,Math.PI*1.5]]){
      for(let j=0;j<=5;j++){
        const angle=start+j*Math.PI/10,x=cx+Math.cos(angle)*radius;let z=cz+Math.sin(angle)*radius;
        if(cab)z-=THREE.MathUtils.smoothstep(z,2.8,length/2)*(length/2-cabZ(x,y));ring.push([x,y,z]);
      }
    }return ring;
  });
  for(let row=0;row<rings.length-1;row++){
    const vertices:number[]=[];for(let i=0;i<rings[row].length;i++){
      const j=(i+1)%rings[row].length,a=rings[row][i],b=rings[row][j],c=rings[row+1][j],d=rings[row+1][i];vertices.push(...a,...d,...b,...b,...d,...c);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.computeVertexNormals();p.add('paint',g,row===1?GREEN:row>=2?ROOF:SILVER);
  }
  const roof=new THREE.Shape(rings.at(-1)!.map(([x,,z])=>new THREE.Vector2(x,-z)));
  p.add('paint',new THREE.ShapeGeometry(roof).rotateX(-Math.PI/2).translate(0,3.29,0),ROOF);p.box('dark',2.02,.20,length-.45,0,.36,0,.04);
  for(const side of [-1,1]as const){
    p.box('metal',.025,.045,length-.36,side*1.247,.39,0,.009);
    p.beam('metal',[side*1.10,3.20,-length/2+.12],[side*1.10,3.20,length/2-(cab?.57:.12)],.023);
  }
}
function sideWindow(p:Builder,side:Side,z:number,w:number,h=1.04,y=2.06){
  p.add('rubber',panel(w+.08,h+.08,.075,side,z,y,.017));p.add('glass',panel(w,h,.055,side,z,y,.024));
}
function door(p:Builder,side:Side,z:number){
  p.add('rubber',panel(1.34,2.23,.025,side,z,1.51,.016));
  for(const dz of [-.323,.323]){
    p.add('paint',panel(.615,2.17,.017,side,z+dz,1.51,.025),SILVER);p.add('paint',panel(.615,1.36,.01,side,z+dz,1.915,.030),GREEN);
    p.add('rubber',panel(.30,1.12,.06,side,z+dz,1.95,.037));p.add('glass',panel(.245,1.05,.045,side,z+dz,1.95,.044));
    p.add('rubber',panel(.29,.35,.045,side,z+dz,.78,.037));p.add('windscreen',panel(.235,.30,.025,side,z+dz,.78,.044));
  }
  p.box('metal',.025,.042,1.33,side*1.31,.41,z,.008);p.box('paint',.026,.020,1.27,side*1.326,.45,z,.004,0xd8b643);
  p.add('metal',new THREE.CircleGeometry(.06,12).rotateY(side*Math.PI/2).translate(side*1.31,1.54,z+.81));
  p.add('paint',new THREE.CircleGeometry(.043,12).rotateY(side*Math.PI/2).translate(side*1.315,1.54,z+.81),0x406c49);
}
function sides(p:Builder,length:number,cab:boolean){
  for(const side of [-1,1]as const){
    if(cab){
      for(const [z,w]of [[-2.85,1.24],[.15,1.12],[1.40,1.10]])sideWindow(p,side,z,w);door(p,side,-1.32);
      p.add('rubber',panel(.78,2.23,.035,side,2.58,1.51,.014));p.add('paint',panel(.73,2.18,.025,side,2.58,1.51,.023),SILVER);
      p.add('paint',panel(.73,1.33,.02,side,2.58,1.935,.028),GREEN);p.add('rubber',panel(.49,1.32,.075,side,2.58,1.88,.035));
      p.add('glass',panel(.43,1.25,.055,side,2.58,1.88,.042));p.add('rubber',panel(.44,.40,.06,side,2.58,.76,.035));
      p.add('windscreen',panel(.38,.34,.04,side,2.58,.76,.042));sideWindow(p,side,3.26,.37,.91,2.10);
      p.box('dark',.02,.019,.17,side*1.32,1.28,2.81,.003);
      for(const z of [-3.15,.40,1.42]){
        p.add('dark',panel(.69,.48,.018,side,z,.82,.006));p.add('paint',panel(.67,.46,.015,side,z,.82,.010),SILVER);p.box('metal',.015,.018,.10,side*1.288,1.01,z+.22,.003);
      }
    }else{
      for(const [z,w]of [[-2.14,1.15],[2.14,1.15]])sideWindow(p,side,z,w,1.16,1.99);door(p,side,0);
      for(const z of [-1.23,1.23])p.add('dark',panel(.035,2.20,.004,side,z,1.48,.009));
    }
    for(const z of [-length/2+.45,length/2-.68]){
      p.add('metal',new THREE.SphereGeometry(.043,8,6).scale(.3,1,1).translate(side*1.243,2.84,z));
      p.add('tail',new THREE.SphereGeometry(.025,8,6).scale(.3,1,1).translate(side*1.259,2.84,z));
    }
  }
}
function runningGear(p:Builder,cab:boolean){
  // One bogie per section, recessed behind the skirts.
  const center=cab?1.4:0;p.box('dark',1.94,.25,1.95,0,.37,center,.035);
  for(const z of [center-.69,center+.69]){
    p.beam('metal',[-.91,.33,z],[.91,.33,z],.09);
    for(const side of [-1,1]){
      p.add('dark',new THREE.CylinderGeometry(.33,.33,.15,20).rotateZ(Math.PI/2).translate(side*.88,.33,z));
      p.add('metal',new THREE.CylinderGeometry(.26,.26,.018,20).rotateZ(Math.PI/2).translate(side*.965,.33,z));
      p.add('dark',new THREE.CylinderGeometry(.105,.105,.028,12).rotateZ(Math.PI/2).translate(side*.98,.33,z));
    }
  }
}
function roofEquipment(p:Builder,cab:boolean){
  const centers=cab?[-2.60,-.62,1.05]:[-2.05,1.84];
  for(const [i,z]of centers.entries()){
    const depth=cab?(i===2?1.0:1.35):1.18;
    p.box('dark',1.72,.12,depth+.13,0,3.35,z,.015);p.box('metal',1.48,.27,depth,0,3.51,z,.035);p.box('dark',1.39,.025,depth-.11,0,3.66,z,.004);
    for(let j=0;j<9;j++)p.box('metal',1.30,.014,.026,0,3.68,z-depth/2+.11+j*(depth-.22)/8,.003);
    for(const side of [-1,1])for(let j=0;j<7;j++)p.box('dark',.022,.14,.035,side*.748,3.51,z-depth/2+.10+j*(depth-.20)/6,.002);
  }
  if(cab){
    p.box('paint',1.63,.19,.78,0,3.40,2.61,.085,ROOF);for(let j=0;j<17;j++)p.box('dark',.035,.09,.014,-.66+j*.083,3.38,3.005,.002);
    p.box('dark',.45,.23,.64,.56,3.43,-1.69,.018);p.box('dark',.48,.18,.70,-.53,3.42,-1.67,.015);
    p.beam('rubber',[-.72,3.33,-3.55],[-.72,3.33,1.72],.032);
  }else{
    p.box('dark',1.18,.13,1.04,0,3.39,-.34,.02);
    for(const side of [-1,1]){
      for(const z of [-.70,.03]){
        p.add('paint',new THREE.CylinderGeometry(.10,.10,.17,10).translate(side*.45,3.49,z),0x8c7560);
        for(const y of [3.45,3.51,3.57])p.add('metal',new THREE.CylinderGeometry(.12,.12,.023,10).translate(side*.45,y,z));
      }
      p.beam('dark',[side*.28,3.60,-.64],[side*.28,4.57,.40],.056);p.beam('dark',[side*.28,4.57,.40],[side*.65,5.49,-.59],.043);
      p.beam('metal',[side*.66,5.49,-.61],[side*.66,5.58,-.72],.025);
    }
    p.beam('metal',[-.36,4.57,.40],[.36,4.57,.40],.07);p.beam('metal',[-.27,3.62,-.46],[-.27,4.55,.50],.018);
    // Contact height 5.62 + the simulation's .11 m rail datum = 5.73 m wire.
    p.box('metal',1.78,.055,.22,0,5.57,-.72,.014);p.box('dark',1.71,.025,.07,0,5.6075,-.72,.005);
    for(const side of [-1,1])p.beam('metal',[side*.86,5.59,-.72],[side*.99,5.46,-.72],.018);
  }
}
function cab(p:Builder){
  p.add('dark',panel(2.30,1.42,.10,'cab',0,2.01,.016));p.add('windscreen',panel(2.19,1.30,.075,'cab',0,2.015,.033));
  p.add('metal',panel(2.18,.028,.006,'cab',0,1.375,.049));
  const apron=new THREE.Shape();apron.moveTo(-.59,.48);apron.lineTo(.59,.48);apron.lineTo(.77,1.27);apron.lineTo(-.77,1.27);apron.closePath();
  const g=new THREE.ShapeGeometry(apron,1),pos=g.getAttribute('position');for(let i=0;i<pos.count;i++)pos.setZ(i,cabZ(pos.getX(i),pos.getY(i))+.025);g.computeVertexNormals();p.add('paint',g,GREEN);
  for(const side of [-1,1]){
    p.add('dark',panel(.47,.82,.045,'cab',side*.96,.85,.019));
    for(const [dx,y,r]of [[0,.79,.103],[-.10,1.08,.061],[.10,1.08,.061]]){
      const x=side*(.96+dx),z=cabZ(x,y);p.add('metal',new THREE.CylinderGeometry(r+.026,r+.026,.040,20).rotateX(Math.PI/2).translate(x,y,z+.049));
      p.add('head',new THREE.SphereGeometry(r,16,10).scale(1,1,.35).translate(x,y,z+.076));
    }
    for(const dx of [-.11,.11]){
      const x=side*(.83+dx),y=3.03,z=cabZ(x,y);p.add('metal',new THREE.SphereGeometry(.065,12,8).scale(1,1,.35).translate(x,y,z+.029));
      p.add('head',new THREE.SphereGeometry(.042,12,8).scale(1,1,.35).translate(x,y,z+.052));
    }
    p.beam('dark',[side*1.15,2.70,3.47],[side*1.49,2.55,3.65],.025);p.box('dark',.12,.32,.17,side*1.49,2.43,3.65,.035);
    p.box('metal',.09,.26,.013,side*1.49,2.43,3.558,.018);
  }
  p.add('dark',panel(1.53,.45,.020,'cab',0,2.85,.019));
  const point=(x:number,y:number)=>[x,y,cabZ(x,y)+.074];p.beam('dark',point(.68,2.59),point(.12,1.99),.025);
  p.beam('rubber',point(-.88,1.78),point(.54,2.20),.028);p.beam('metal',point(.12,1.99),point(-.18,1.98),.014);
  p.add('rubber',panel(1.95,.13,.030,'cab',0,.43,.040));for(const y of [.455,.50])p.add('dark',panel(1.86,.019,.003,'cab',0,y,.052));
  p.box('dark',.36,.17,.40,0,.27,3.88,.018);p.box('metal',.60,.24,.22,0,.26,4.035,.016);p.box('dark',.25,.14,.03,0,.26,4.16,.008);
  for(const x of [-.29,.29])p.box('dark',.08,.28,.24,x,.26,4.04,.012);
}
function makeEnd(){const p=builder();shell(p,END_LENGTH,true);sides(p,END_LENGTH,true);runningGear(p,true);roofEquipment(p,true);cab(p);return p.finish();}
function makeCenter(){const p=builder();shell(p,CENTER_LENGTH,false);sides(p,CENTER_LENGTH,false);runningGear(p,false);roofEquipment(p,false);return p.finish();}
function makeBellows(){
  const p=builder();for(let i=0;i<9;i++){
    p.box('rubber',2.42+(i%2?.02:-.06),2.86,.052,0,1.82,(i-4)*.073,.065);
    if(i%2===0){for(const side of [-1,1])p.box('dark',.023,2.70,.025,side*1.205,1.81,(i-4)*.073,.008);p.box('dark',2.33,.023,.030,0,3.24,(i-4)*.073,.009);}
  }return p.finish();
}

let endTemplate:THREE.Group|undefined,centerTemplate:THREE.Group|undefined,bellowsTemplate:THREE.Group|undefined;
let markingsTemplate:THREE.Mesh|undefined,displayGeometry:THREE.BufferGeometry|undefined;
const displays=new Map<string,THREE.Mesh>();
function fleetMarkings(){
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;const c=canvas.getContext('2d')!;c.textAlign='center';c.textBaseline='middle';
  c.fillStyle='#e4e8e1';c.beginPath();c.arc(128,128,116,0,Math.PI*2);c.fill();c.lineWidth=10;c.strokeStyle='#18271f';c.stroke();
  c.fillStyle='#18271f';c.font='bold 178px Arial';c.fillText('T',128,141);c.fillStyle='#e3e8df';c.font='84px Arial';c.fillText('3914',512,64);
  c.font='26px Arial';c.fillStyle='#344a40';c.fillText('MASSACHUSETTS BAY',512,162);c.fillText('TRANSPORTATION AUTHORITY',512,197);
  c.fillStyle='#1c598c';c.fillRect(768,0,128,128);c.fillStyle='#fff';c.font='92px Arial';c.fillText('♿',832,65);
  // Original small destination posters rather than copied photographs.
  c.fillStyle='#d1e0d8';c.fillRect(0,256,512,256);c.fillStyle='#254c3e';c.fillRect(0,433,512,79);
  c.fillStyle='#638e83';for(let i=0;i<10;i++)c.fillRect(25+i*47,340-(i%4)*20,31,93+(i%4)*20);
  c.fillStyle='#eef4df';c.font='bold 31px Arial';c.fillText('EXPLORE BOSTON',256,472);
  c.fillStyle='#d6c292';c.fillRect(512,256,512,256);c.fillStyle='#365d4c';c.font='bold 46px Arial';c.fillText('GO GREEN',768,342);c.font='24px Arial';c.fillText('A city worth exploring.',768,399);c.fillRect(545,446,446,9);
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;const geometries:THREE.BufferGeometry[]=[];
  const decal=(rect:number[],w:number,h:number,face:Face,u:number,y:number,offset=.041)=>{
    const g=panel(w,h,.003,face,u,y,offset),uv=g.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setXY(i,(rect[0]+uv.getX(i)*rect[2])/1024,1-(rect[1]+(1-uv.getY(i))*rect[3])/512);geometries.push(g);
  };
  decal([256,0,512,128],.42,.105,'cab',0,.93);decal([0,0,256,256],.21,.21,'cab',.94,1.28,.042);
  for(const side of [-1,1]as const){
    decal([0,0,256,256],.24,.24,side,1.50,1.37,.035);decal([256,0,512,128],.36,.09,side,2.00,2.78,.023);
    decal([768,0,128,128],.14,.14,side,-.49,1.41);decal([0,256,512,256],1.29,.645,side,.12,.91,.025);decal([512,256,512,256],1.18,.59,side,-2.83,.92,.025);
  }
  const geometry=mergeGeometries(geometries,false)!;geometries.forEach(g=>g.dispose());
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({map,transparent:true,alphaTest:.1,roughness:.51,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));mesh.name='Green Line fleet markings';return mesh;
}
function destinationDisplay(destination:string){
  let display=displays.get(destination);if(display)return display;
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;const c=canvas.getContext('2d')!;
  c.fillStyle='#0b100d';c.fillRect(0,0,1024,256);c.textBaseline='middle';
  const match=destination.match(/^([BCDE])\s+(.*)$/i),branch=match?.[1].toUpperCase()??'',terminus=match?.[2]??destination;
  c.fillStyle='#d9e6c6';c.textAlign='center';c.font='bold 112px monospace';c.fillText(branch,90,130,150);c.font='bold 65px monospace';c.fillText(terminus.toUpperCase(),596,130,800);
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
  if(!displayGeometry){
    const geometries=[panel(1.43,.34,.008,'cab',0,2.85,.032),panel(.96,.19,.006,-1,1.41,2.38,.039),panel(.96,.19,.006,1,1.41,2.38,.039)];
    displayGeometry=mergeGeometries(geometries,false)!;geometries.forEach(g=>g.dispose());
  }
  display=new THREE.Mesh(displayGeometry,new THREE.MeshStandardMaterial({map,emissive:0xffffff,emissiveMap:map,emissiveIntensity:.65,roughness:.55}));display.name='Green Line destination displays';displays.set(destination,display);return display;
}

/** Shared fleet templates keep geometry, materials and painted atlases bounded
 * as branches are added. Only section and joint transforms are per vehicle. */
export function createGreenLine(destination:string){
  endTemplate??=makeEnd();centerTemplate??=makeCenter();bellowsTemplate??=makeBellows();
  const group=new THREE.Group();group.name=`Green Line single articulated trolley ${destination}`;
  const offsets=[7.35,0,-7.35],sections:THREE.Group[]=[],bellows:THREE.Group[]=[];
  for(let i=0;i<3;i++){
    const section=new THREE.Group();section.name=['Leading cab','Pantograph section','Trailing cab'][i];section.position.z=offsets[i];
    const body=(i===1?centerTemplate:endTemplate).clone();
    if(i===2){body.rotation.y=Math.PI;const lamps=body.getObjectByName('head') as THREE.Mesh;lamps.material=material('tail');}
    if(i!==1&&typeof document!=='undefined'){markingsTemplate??=fleetMarkings();body.add(markingsTemplate.clone());body.add(destinationDisplay(destination).clone());}
    section.add(body);sections.push(section);group.add(section);
  }
  for(let i=0;i<2;i++){const joint=bellowsTemplate.clone();joint.name='Flexible articulation bellows';joint.position.z=i===0?3.32:-3.32;bellows.push(joint);group.add(joint);}
  return{group,sections,bellows,offsets,length:22.5};
}
