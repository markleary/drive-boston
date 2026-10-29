import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Original procedural 40-foot MBTA interpretation. Dimensions and +Z forward
// match the existing transit collider; mirrors and the folded rack are trim.
const WHITE=0xe5e7e3, YELLOW=0xe9ac16, TEAL=0x218ea2;
const WHEEL_Z=[-3.64,3.64], WHEEL_R=.5, ARCH_R=.635;
type Surface='paint'|'dark'|'rubber'|'metal'|'glass'|'windscreen'|'head'|'tail'|'amber';
type Face='front'|'rear'|1|-1;

function roundedRect(w:number,h:number,r:number){
  const s=new THREE.Shape(),x=-w/2,y=-h/2;
  s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);
  s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);
  s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);
  return s;
}

// The front glass, sign, wipers and fascia share the body's rake and bow.
function frontZ(x:number,y:number){return 5.85-.19*THREE.MathUtils.clamp((y-1.2)/1.8,0,1)-.13*(x/1.25)**6;}
function panel(w:number,h:number,r:number,face:Face,u:number,y:number,offset=.012){
  // Curved front panels need interior vertices: a perimeter-only triangulation
  // would cut through the bowed shell between its corners.
  const g:THREE.BufferGeometry=face==='front'?new THREE.PlaneGeometry(w,h,w>1?24:6,h>.5?16:3):new THREE.ShapeGeometry(roundedRect(w,h,r),8);
  const pos=g.getAttribute('position'),uv=g.getAttribute('uv');
  for(let i=0;i<pos.count;i++){
    let a=pos.getX(i);const b=pos.getY(i);
    if(face==='front'){
      const cornerY=Math.max(0,Math.abs(b)-(h/2-r));
      const halfWidth=w/2-r+Math.sqrt(Math.max(0,r*r-cornerY*cornerY));
      a*=halfWidth/(w/2);
    }
    uv.setXY(i,a/w+.5,b/h+.5);
    if(face==='front')pos.setXYZ(i,a+u,b+y,frontZ(a+u,b+y)+offset);
    else if(face==='rear')pos.setXYZ(i,-a+u,b+y,-5.85-offset);
    else pos.setXYZ(i,face*(1.25+offset),b+y,u-face*a);
  }
  g.computeVertexNormals();return g;
}

function windowTexture(){
  if(typeof document==='undefined')return null;
  const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d')!;
  const tint=ctx.createLinearGradient(0,0,0,256);
  tint.addColorStop(0,'#344954');tint.addColorStop(.28,'#23363e');tint.addColorStop(.34,'#1b2a31');tint.addColorStop(1,'#101c23');
  ctx.fillStyle=tint;ctx.fillRect(0,0,256,256);
  // Subtle silhouettes inside opaque tinted glazing, avoiding transparent sorting.
  ctx.fillStyle='#111f29';for(const x of [35,155]){ctx.beginPath();ctx.roundRect(x,155,66,88,12);ctx.fill();}
  ctx.fillStyle='#6c6951';ctx.fillRect(233,12,3,235);
  ctx.fillStyle='rgba(177,203,211,.08)';ctx.beginPath();ctx.moveTo(0,45);ctx.lineTo(256,9);ctx.lineTo(256,26);ctx.lineTo(0,62);ctx.fill();
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}

function builder(){
  const parts=new Map<Surface,THREE.BufferGeometry[]>();
  const add=(kind:Surface,g:THREE.BufferGeometry,color?:number)=>{
    const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();
    const count=n.getAttribute('position').count;
    if(!n.getAttribute('uv'))n.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(count*2),2));
    const rgb=new THREE.Color(color??0xffffff),colors=new Float32Array(count*3);
    for(let i=0;i<count;i++)rgb.toArray(colors,i*3);
    n.setAttribute('color',new THREE.BufferAttribute(colors,3));
    const list=parts.get(kind)??[];list.push(n);parts.set(kind,list);
  };
  const box=(kind:Surface,w:number,h:number,d:number,x:number,y:number,z:number,r=.035,color?:number)=>{
    add(kind,new RoundedBoxGeometry(w,h,d,2,Math.min(r,w/2,h/2,d/2)).translate(x,y,z),color);
  };
  const beam=(kind:Surface,a:number[],b:number[],r=.02)=>{
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);
    const g=new THREE.CylinderGeometry(r,r,delta.length(),8);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));
    add(kind,g.translate(...start.add(end).multiplyScalar(.5).toArray()));
  };
  const finish=()=>{
    const group=new THREE.Group();
    const styles:Record<Surface,THREE.MeshStandardMaterialParameters>={
      paint:{color:0xffffff,roughness:.34,metalness:.18},dark:{color:0x20272b,roughness:.65},
      rubber:{color:0x171b1e,roughness:.88},metal:{color:0xa3adb0,roughness:.31,metalness:.78},
      glass:{color:0xffffff,map:windowTexture(),roughness:.19,metalness:.32},
      windscreen:{color:0x1b3039,roughness:.12,metalness:.38},
      head:{color:0xf5f2de,emissive:0xf2dfb8,emissiveIntensity:.3,roughness:.2},
      tail:{color:0xa42019,emissive:0xc92b21,emissiveIntensity:.3,roughness:.22},
      amber:{color:0xe99217,emissive:0xc97709,emissiveIntensity:.25,roughness:.25},
    };
    for(const [kind,geometries]of parts){
      const geometry=mergeGeometries(geometries,false)!;geometries.forEach(g=>g.dispose());
      const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({...styles[kind],vertexColors:true}));
      mesh.name=kind;mesh.castShadow=!['glass','windscreen','head','tail','amber'].includes(kind);mesh.receiveShadow=true;group.add(mesh);
    }
    return group;
  };
  return{add,box,beam,finish};
}
type Builder=ReturnType<typeof builder>;

// Rounded plan-view stations soften both ends; cross-section stations roll the
// roof edge inward. This is one continuous shell, not an overlapping roof box.
function body(p:Builder){
  const levels=[{y:1.16,x:1.25},{y:1.40,x:1.25},{y:1.445,x:1.25},{y:2.76,x:1.25},{y:2.91,x:1.235},{y:3.015,x:1.17},{y:3.065,x:1.06}];
  const rings=levels.map(({x:hw,y})=>{
    const radius=.24,points:number[][]=[];
    for(const [cx,cz,start]of [[hw-radius,5.85-radius,0],[-hw+radius,5.85-radius,Math.PI/2],[-hw+radius,-5.85+radius,Math.PI],[hw-radius,-5.85+radius,Math.PI*1.5]]){
      for(let j=0;j<=8;j++){
        const a=start+j*Math.PI/16,x=cx+Math.cos(a)*radius,z=cz+Math.sin(a)*radius;
        const front=THREE.MathUtils.smoothstep(z,4.7,5.85);
        points.push([x,y,z-front*(5.85-frontZ(x,y))]);
      }
    }return points;
  });
  const normalAt=(row:number,i:number)=>{
    const n=rings[row].length,lo=rings[Math.max(0,row-1)][i],hi=rings[Math.min(rings.length-1,row+1)][i];
    const before=rings[row][(i+n-1)%n],after=rings[row][(i+1)%n];
    return new THREE.Vector3().subVectors(new THREE.Vector3(...hi),new THREE.Vector3(...lo))
      .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...after),new THREE.Vector3(...before))).normalize().toArray();
  };
  for(let row=0;row<rings.length-1;row++){
    const vertices:number[]=[],normals:number[]=[];
    for(let i=0;i<rings[row].length;i++){
      const j=(i+1)%rings[row].length,a=rings[row][i],b=rings[row][j],c=rings[row+1][j],d=rings[row+1][i];
      vertices.push(...a,...d,...b,...b,...d,...c);
      normals.push(...normalAt(row,i),...normalAt(row+1,i),...normalAt(row,j),...normalAt(row,j),...normalAt(row+1,i),...normalAt(row+1,j));
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    // Smooth only the curved corners, preserving the long flat side panels.
    p.add('paint',g,row===0?YELLOW:row===1?TEAL:WHITE);
  }
  const roof=new THREE.Shape(rings.at(-1)!.map(([x,,z])=>new THREE.Vector2(x,-z)));
  p.add('paint',new THREE.ShapeGeometry(roof).rotateX(-Math.PI/2).translate(0,3.065,0),WHITE);
  // Front and rear lower faces; the side skirts below have genuine arch cutouts.
  p.box('paint',2.49,.81,.35,0,.755,5.61,.12,YELLOW);
  p.box('paint',2.49,.81,.35,0,.755,-5.61,.12,YELLOW);
  p.box('dark',1.96,.10,10.7,0,.37,0,.04);
  for(const side of [-1,1]as const){
    const s=new THREE.Shape();s.moveTo(-5.61,1.16);s.lineTo(-5.61,.34);
    for(const wz of WHEEL_Z){
      s.lineTo(wz-ARCH_R,.34);s.lineTo(wz-ARCH_R,WHEEL_R);
      for(let i=0;i<=24;i++){const a=Math.PI-i*Math.PI/24;s.lineTo(wz+Math.cos(a)*ARCH_R,WHEEL_R+Math.sin(a)*ARCH_R);}
      s.lineTo(wz+ARCH_R,.34);
    }
    s.lineTo(5.61,.34);s.lineTo(5.61,1.16);s.closePath();
    const skirt=new THREE.ExtrudeGeometry(s,{depth:.055,bevelEnabled:false,curveSegments:12});
    skirt.rotateY(side*Math.PI/2).translate(side*1.195,0,0);p.add('paint',skirt,WHITE);
    const belt=new THREE.Shape();belt.moveTo(-5.61,1.16);belt.lineTo(-5.61,.98);
    for(const wz of WHEEL_Z){
      const angle=Math.asin((.98-WHEEL_R)/ARCH_R);
      belt.lineTo(wz-Math.cos(angle)*ARCH_R,.98);
      for(let i=0;i<=16;i++){const a=Math.PI-angle-i*(Math.PI-2*angle)/16;belt.lineTo(wz+Math.cos(a)*ARCH_R,WHEEL_R+Math.sin(a)*ARCH_R);}
    }
    belt.lineTo(5.61,.98);belt.lineTo(5.61,1.16);belt.closePath();
    p.add('paint',new THREE.ShapeGeometry(belt,16).rotateY(side*Math.PI/2).translate(side*1.256,0,0),YELLOW);
    for(const wz of WHEEL_Z){
      const arch=new THREE.Shape();arch.absarc(wz,WHEEL_R,ARCH_R+.055,0,Math.PI,false);
      arch.absarc(wz,WHEEL_R,ARCH_R,Math.PI,0,true);arch.closePath();
      const g=new THREE.ShapeGeometry(arch,24);g.rotateY(side*Math.PI/2).translate(side*1.258,0,0);p.add('rubber',g);
      // Inset wheel-well backing keeps the arch dark from low chase cameras.
      p.add('rubber',new THREE.CircleGeometry(ARCH_R,32,0,Math.PI).rotateY(side*Math.PI/2).translate(side*.99,.5,-side*wz));
    }
    for(const z of [-2.82,-.02,2.8])p.box('dark',.012,.62,.012,side*1.253,.69,z,.005);
    // Rear engine cooling grilles and panel seams.
    p.box('dark',.018,.54,1.18,side*1.258,.69,-4.83,.008);
    for(let i=0;i<8;i++)p.box('metal',.022,.018,1.10,side*1.271,.46+i*.065,-4.83,.005);
    p.box('dark',.018,.48,.24,side*1.256,2.34,-5.48,.012);
    for(let i=0;i<7;i++)p.box('metal',.022,.018,.20,side*1.27,2.14+i*.063,-5.48,.004);
  }
}

function windowsAndDoors(p:Builder){
  const driver=[[-5.24,-4.04],[-3.96,-2.68],[-2.60,-1.32],[-1.24,.04],[.12,1.40],[1.48,2.76],[2.84,4.12],[4.20,5.32]];
  const curb=[[-5.24,-4.04],[-3.96,-2.68],[-2.60,-2.16],[-.84,.40],[.48,1.72],[1.80,3.04],[3.12,4.10]];
  for(const side of [-1,1]as const){
    for(const [a,b]of side===-1?curb:driver){
      const w=b-a,z=(a+b)/2;
      p.add('dark',panel(w,1.23,.075,side,z,2.10,.009));
      p.add('glass',panel(w-.065,1.155,.055,side,z,2.10,.018));
      p.box('dark',.014,.023,w-.04,side*1.274,2.41,z,.006);
    }
    p.box('metal',.016,.023,10.62,side*1.267,2.765,0,.006);
  }
  for(const z of [4.78,-1.5]){
    p.add('dark',panel(1.22,2.24,.035,-1,z,1.47,.022));
    for(const dz of [-.303,.303]){
      p.add('paint',panel(.574,2.17,.025,-1,z+dz,1.47,.031),WHITE);
      p.add('glass',panel(.46,1.37,.065,-1,z+dz,1.82,.041));
      p.add('windscreen',panel(.46,.54,.04,-1,z+dz,.80,.041));
    }
    p.box('metal',.035,.055,1.21,-1.295,.385,z,.008);
    p.box('paint',.038,.025,1.14,-1.316,.424,z,.007,YELLOW);
  }
  p.add('dark',panel(2.36,1.29,.16,'front',0,2.065));
  p.add('windscreen',panel(2.24,1.16,.14,'front',0,2.065,.024));
  p.beam('dark',[0,1.5,frontZ(0,1.5)+.039],[0,2.63,frontZ(0,2.63)+.039],.017);
  for(const x of [-.56,.56]){
    const end=x+(x<0?.18:-.18);
    p.beam('dark',[x,1.51,frontZ(x,1.51)+.055],[end,2.29,frontZ(end,2.29)+.055],.022);
    p.beam('rubber',[end-.04,1.89,frontZ(end-.04,1.89)+.075],[end+.01,2.39,frontZ(end+.01,2.39)+.075],.025);
  }
  p.add('dark',panel(2.20,.37,.065,'front',0,2.825,.017));
}

function wheels(p:Builder){
  for(const side of [-1,1])for(const z of WHEEL_Z){
    const profile=[[.29,-.15],[.45,-.15],[.49,-.115],[.5,-.075],[.5,.075],[.49,.115],[.45,.15],[.29,.15]].map(([r,y])=>new THREE.Vector2(r,y));
    const wheelX=side*1.13;
    p.add('rubber',new THREE.LatheGeometry(profile,32).rotateZ(-side*Math.PI/2).translate(wheelX,.5,z));
    const rim=[[0,.065],[.12,.065],[.16,.035],[.235,.065],[.28,.14],[.293,.15]].reverse().map(([r,y])=>new THREE.Vector2(r,y));
    p.add('metal',new THREE.LatheGeometry(rim,32).rotateZ(-side*Math.PI/2).translate(wheelX,.5,z));
    p.add('dark',new THREE.CylinderGeometry(.105,.12,.09,20).rotateZ(Math.PI/2).translate(side*1.245,.5,z));
    for(let i=0;i<10;i++){
      const a=i*Math.PI/5;
      p.add('metal',new THREE.CylinderGeometry(.014,.014,.021,6).rotateZ(Math.PI/2).translate(side*1.27,.5+Math.cos(a)*.164,z+Math.sin(a)*.164));
      if(i%2===0)p.add('dark',new THREE.CircleGeometry(.032,12).rotateY(side*Math.PI/2).translate(side*1.274,.5+Math.cos(a+.2)*.236,z+Math.sin(a+.2)*.236));
    }
    // The rear axle has a second tire inboard of each visible outer wheel.
    if(z<0)p.add('rubber',new THREE.LatheGeometry(profile,24).rotateZ(-side*Math.PI/2).translate(side*.81,.5,z));
  }
}

function fittings(p:Builder){
  for(const end of [-1,1]){
    p.box('rubber',2.49,.235,.30,0,.425,end*5.79,.08);
    p.box('metal',2.25,.055,.035,0,.58,end*5.92,.012);
  }
  for(const side of [-1,1]as const){
    p.add('dark',panel(.43,.24,.04,'front',side*.91,.805,.027));
    p.add('head',panel(.28,.13,.025,'front',side*.86,.81,.037));
    p.add('amber',panel(.085,.15,.018,'front',side*1.075,.81,.04));
    for(const [y,kind]of [[1.38,'tail'],[1.13,'amber'],[.88,'head']]as const){
      p.add('dark',new THREE.CircleGeometry(.094,20).rotateY(Math.PI).translate(side*1.055,y,-5.87));
      p.add(kind,new THREE.CircleGeometry(.068,20).rotateY(Math.PI).translate(side*1.055,y,-5.878));
    }
    p.add('amber',panel(.14,.055,.012,side,4.02,1.25,.027));
    p.add('tail',panel(.14,.055,.012,side,-5.4,1.25,.027));
    const mountY=side===-1?2.72:2.38,headY=side===-1?2.32:2.11;
    p.beam('dark',[side*1.15,mountY,5.36],[side*1.52,mountY-.10,5.68],.032);
    p.beam('dark',[side*1.52,mountY-.10,5.68],[side*1.52,headY,5.68],.027);
    p.box('dark',.15,.39,.22,side*1.52,headY,5.68,.06);
    p.box('metal',.115,.31,.015,side*1.52,headY,5.558,.024);
    // Clearance lights follow the white roof brow.
    p.add('amber',panel(.105,.052,.012,'front',side*1.00,2.99,.02));
    p.add('tail',panel(.105,.052,.012,'rear',side*1.00,2.99));
  }
  for(const x of [-.2,0,.2]){
    p.add('amber',panel(.09,.045,.01,'front',x,3.005));
    p.add('tail',panel(.09,.045,.01,'rear',x,3.005));
  }
  // Engine hatch, recessed upper grille and separate stamped silver louvers.
  p.add('dark',panel(1.84,1.18,.05,'rear',0,2.18,.006));
  p.add('paint',panel(1.78,1.12,.035,'rear',0,2.18,.012),WHITE);
  p.add('dark',panel(1.48,.68,.025,'rear',0,2.37,.018));
  for(let i=0;i<8;i++)p.box('metal',1.43,.035,.042,0,2.08+i*.085,-5.884,.009);
  p.box('metal',.024,.67,.045,0,2.375,-5.91,.006);
  // A low, rounded cooling pod, roof vents and radio aerial.
  p.box('paint',1.82,.235,3.45,0,3.16,-2.85,.11,WHITE);
  p.box('dark',1.34,.028,1.32,0,3.285,-3.0,.014);
  for(let i=0;i<9;i++)p.box('metal',1.24,.018,.025,0,3.305,-3.56+i*.14,.006);
  p.box('paint',.70,.07,.78,.28,3.115,1.5,.03,WHITE);
  p.beam('dark',[-.75,3.08,-4.8],[-.75,3.48,-4.87],.012);
  // Folded front bicycle rack, with two cradles, hinge arms and uprights.
  for(const x of [-.56,.56])p.beam('metal',[x,.61,5.94],[x,1.16,6.025],.027);
  for(const y of [.70,1.13])p.beam('metal',[-.60,y,6.015],[.60,y,6.015],.022);
  for(const x of [-.33,.16]){
    p.beam('dark',[x,.71,6.04],[x,1.07,6.04],.018);
    p.beam('dark',[x+.16,.71,6.04],[x+.16,1.07,6.04],.018);
    p.beam('dark',[x,1.07,6.04],[x+.16,1.07,6.04],.018);
  }
}

// Fleet geometry, materials and the markings atlas are shared by every route.
// Each headsign gets one shared display texture; only transforms are per bus.
let busTemplate:THREE.Group|undefined;
let fleetMarkingsTemplate:THREE.Mesh|undefined;
let displayGeometry:THREE.BufferGeometry|undefined;
const destinationDisplays=new Map<string,THREE.Mesh>();
function createFleetMarkings(){
  const atlas=document.createElement('canvas');atlas.width=1024;atlas.height=512;const c=atlas.getContext('2d')!;
  c.textAlign='center';c.textBaseline='middle';
  c.fillStyle='#f5f5ee';c.beginPath();c.arc(128,128,119,0,Math.PI*2);c.fill();
  c.lineWidth=11;c.strokeStyle='#171b1d';c.stroke();c.fillStyle='#171b1d';c.font='bold 178px Arial';c.fillText('T',128,140);
  c.font='bold 88px Arial';c.fillText('0743',512,68);
  c.font='32px Arial';c.fillText('MASSACHUSETTS BAY',512,160);c.fillText('TRANSPORTATION AUTHORITY',512,201);
  c.fillStyle='#eeeede';c.fillRect(768,0,256,128);c.fillStyle='#9b2927';c.font='bold 23px Arial';c.fillText('MASSACHUSETTS',896,25);c.font='bold 54px monospace';c.fillText('MB 0743',896,77);
  c.fillStyle='#205b95';c.fillRect(768,256,128,128);c.fillStyle='#fff';c.font='94px Arial';c.fillText('♿',832,320);
  const texture=new THREE.CanvasTexture(atlas);texture.colorSpace=THREE.SRGBColorSpace;
  const decals:THREE.BufferGeometry[]=[];
  const decal=(rect:number[],w:number,h:number,face:Face,u:number,y:number,offset=.035)=>{
    const g=panel(w,h,.003,face,u,y,offset),uv=g.getAttribute('uv');
    for(let i=0;i<uv.count;i++)uv.setXY(i,(rect[0]+uv.getX(i)*rect[2])/1024,1-(rect[1]+(1-uv.getY(i))*rect[3])/512);
    decals.push(g);
  };
  for(const face of ['front','rear']as const){decal([0,0,256,256],.30,.30,face,face==='front'?.04:0,1.265);decal([256,0,512,128],.40,.10,face,-.53,1.25);}
  for(const side of [-1,1]as const){
    decal([0,0,256,256],.29,.29,side,3.0,1.29);
    decal([256,0,512,128],.42,.105,side,2.8,2.91);
    decal([256,128,512,128],1.90,.30,side,.9,.83);
  }
  decal([768,0,256,128],.31,.155,'rear',-.60,.69);
  decal([768,256,128,128],.15,.15,-1,4.02,1.29);
  const geometry=mergeGeometries(decals,false)!;decals.forEach(g=>g.dispose());
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({map:texture,transparent:true,alphaTest:.1,roughness:.55,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
  mesh.name='MBTA fleet markings';return mesh;
}

function createDestinationDisplay(destination:string){
  const signs=document.createElement('canvas');signs.width=1024;signs.height=256;const s=signs.getContext('2d')!;
  s.fillStyle='#0a100e';s.fillRect(0,0,1024,256);s.fillStyle='#f4b540';s.textAlign='center';s.textBaseline='middle';
  const route=destination.split(' ')[0];s.font='bold 60px monospace';s.fillText(destination.toUpperCase(),512,65,985);
  s.font='bold 86px monospace';s.fillText(route,128,194,230);
  const signTexture=new THREE.CanvasTexture(signs);signTexture.colorSpace=THREE.SRGBColorSpace;
  if(!displayGeometry){
    const labels:THREE.BufferGeometry[]=[];
    const label=(w:number,h:number,face:Face,u:number,y:number,rear=false)=>{
      const g=panel(w,h,.012,face,u,y,face==='front'?.033:.04),uv=g.getAttribute('uv');
      for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*(rear?.25:1),uv.getY(i)*.5+(rear?0:.5));labels.push(g);
    };
    label(2.06,.265,'front',0,2.825);label(.52,.24,'rear',0,1.84,true);label(1.03,.18,-1,3.58,2.49);
    displayGeometry=mergeGeometries(labels,false)!;labels.forEach(g=>g.dispose());
  }
  const display=new THREE.Mesh(displayGeometry,new THREE.MeshStandardMaterial({map:signTexture,emissive:0xffffff,emissiveMap:signTexture,emissiveIntensity:.75,roughness:.6}));
  display.name='Route destination displays';return display;
}

export function createTransitBus(destination:string){
  if(!busTemplate){
    const p=builder();body(p);windowsAndDoors(p);wheels(p);fittings(p);busTemplate=p.finish();
  }
  const group=busTemplate.clone();group.name=`MBTA-style bus ${destination}`;
  if(typeof document!=='undefined'){
    fleetMarkingsTemplate??=createFleetMarkings();group.add(fleetMarkingsTemplate.clone());
    let display=destinationDisplays.get(destination);
    if(!display){display=createDestinationDisplay(destination);destinationDisplays.set(destination,display);}
    group.add(display.clone());
  }
  return group;
}
