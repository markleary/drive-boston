import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PhysicsVehicleState } from '../physics/vehicle';
import { ULTRA_BEE } from '../physics/bike.ts';

type P=[number,number,number];
/** Original, code-built Ultra Bee likeness: forged dark-cyan frame, angular
 * white/yellow shrouds, slim saddle, high mudguards and spoked knobby 19-inch wheels. */
export function createBike(){
  const group=new THREE.Group();group.name='PlayerUltraBee';
  const rider=new THREE.Group();rider.name='UltraBeeRider';group.add(rider);
  const helmet=new THREE.Group();helmet.name='UltraBeeHelmet';rider.add(helmet);
  const mat={
    frame:new THREE.MeshStandardMaterial({color:0x566f68,metalness:.7,roughness:.32}),
    black:new THREE.MeshStandardMaterial({color:0x141b1d,roughness:.65}),
    tire:new THREE.MeshStandardMaterial({color:0x111314,roughness:.96}),
    metal:new THREE.MeshStandardMaterial({color:0xbac5c5,metalness:.88,roughness:.25}),
    white:new THREE.MeshStandardMaterial({color:0xf0f1e6,roughness:.33}),
    yellow:new THREE.MeshStandardMaterial({color:0xe6ed28,roughness:.4}),
    seat:new THREE.MeshStandardMaterial({color:0x202325,roughness:.95}),
    jacket:new THREE.MeshStandardMaterial({color:0x234650,roughness:.9}),
    pants:new THREE.MeshStandardMaterial({color:0x30373c,roughness:.98}),
    faceMask:new THREE.MeshStandardMaterial({color:0x080a0c,roughness:.7,side:THREE.DoubleSide}),
    helmetRed:new THREE.MeshStandardMaterial({color:0xe52b25,roughness:.29}),
    headlight:new THREE.MeshStandardMaterial({color:0xf7f4dc,emissive:0xffedca,emissiveIntensity:.5}),
    rear:new THREE.MeshStandardMaterial({color:0x941c18,emissive:0xf52b19,emissiveIntensity:.3}),
  };
  type M=keyof typeof mat;
  const batches=new Map<THREE.Group,Map<M,THREE.BufferGeometry[]>>();
  const add=(key:M,g:THREE.BufferGeometry,parent=group)=>{if(!g.hasAttribute('uv'))g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count*2),2));let b=batches.get(parent);if(!b)batches.set(parent,b=new Map());let parts=b.get(key);if(!parts)b.set(key,parts=[]);parts.push(g.index?g.toNonIndexed():g);if(g.index)g.dispose();};
  const box=(key:M,size:P,pos:P,parent=group,rx=0)=>{const g=new THREE.BoxGeometry(...size);g.rotateX(rx);g.translate(...pos);add(key,g,parent);};
  const rod=(key:M,a:P,b:P,r=.02,parent=group,r2=r)=>{const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),d=end.clone().sub(start);const g=new THREE.CylinderGeometry(r2,r,d.length(),8);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()));g.translate(...start.add(end).multiplyScalar(.5).toArray() as P);add(key,g,parent);};
  const sphere=(key:M,pos:P,scale:P,parent=group)=>{const g=new THREE.SphereGeometry(1,14,10);g.scale(...scale);g.translate(...pos);add(key,g,parent);};
  const panel=(key:M,points:P[],parent=group)=>{
    const normal=new THREE.Vector3().crossVectors(new THREE.Vector3(...points[1]).sub(new THREE.Vector3(...points[0])),new THREE.Vector3(...points[2]).sub(new THREE.Vector3(...points[0])));
    const axis=Math.abs(normal.x)>Math.abs(normal.y)&&Math.abs(normal.x)>Math.abs(normal.z)?0:Math.abs(normal.y)>Math.abs(normal.z)?1:2;
    const contour=points.map(p=>new THREE.Vector2(p[(axis+1)%3],p[(axis+2)%3])),v:number[]=[];
    for(const [a,b,c] of THREE.ShapeUtils.triangulateShape(contour,[]))v.push(...points[a],...points[b],...points[c],...points[a],...points[c],...points[b]);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.computeVertexNormals();add(key,g,parent);
  };
  // Physics origin is above the motor, +Z is forward. Empty triangles in the
  // frame and open space above the swingarm preserve the unmistakable silhouette.
  for(const side of [-1,1]){
    const x=side*.115;
    rod('frame',[x,-.12,-.18],[x,.31,.32],.043);
    rod('frame',[x,.31,.32],[x,.34,-.38],.034);
    rod('frame',[x,.34,-.38],[x,-.12,-.18],.028);
    rod('metal',[x,-.04,-.14],[x,.11,.16],.018);
    rod('frame',[x,-.13,-.13],[side*.09,-.23,-.69],.037);
    rod('frame',[x,-.08,-.18],[side*.09,-.23,-.69],.024);
    rod('black',[x,.30,-.28],[side*.08,.38,-.70],.015);
    panel('white',[[x*1.4,.34,.35],[x*1.5,.40,.03],[x*1.55,.24,-.19],[x*1.3,.21,.05]]);
    panel('yellow',[[x*1.42,.338,.32],[x*1.52,.38,.02],[x*1.57,.29,-.13],[x*1.45,.29,.12]]);
    panel('white',[[x*1.4,.30,-.25],[x*1.1,.36,-.78],[x*1.3,.23,-.47]]);
    panel('yellow',[[x*1.42,.28,-.31],[x*1.12,.343,-.73],[x*1.32,.24,-.48]]);
    rod('metal',[x,-.13,-.08],[side*.23,-.13,-.08],.016);
    box('black',[.10,.025,.07],[side*.23,-.13,-.08]);
  }
  box('black',[.19,.36,.28],[0,.04,.035],group,-.22); // Removable battery
  box('black',[.22,.13,.20],[0,-.16,-.03]);
  rod('metal',[-.13,-.12,-.07],[.13,-.12,-.07],.085);
  box('metal',[.20,.025,.27],[0,-.245,-.01]); // Skid plate
  rod('metal',[0,-.08,-.23],[0,.25,-.36],.025);
  for(let i=0;i<9;i++){const g=new THREE.TorusGeometry(.043,.009,5,10);g.rotateX(Math.PI/2+.2);g.translate(0,-.045+i*.029,-.25-i*.01);add('yellow',g);}
  box('seat',[.205,.075,.69],[0,.35,-.26],group,.04);
  box('white',[.18,.026,.30],[0,.355,-.70],group,.13);
  box('rear',[.11,.035,.035],[0,.34,-.85]);
  // Chain runs beside the left swingarm to the rear sprocket.
  for(const y of [-.14,-.28])rod('black',[-.14,y,-.10],[-.14,y,-.69],.009);
  const front=new THREE.Group();front.name='UltraBeeSteering';front.position.set(0,.33,.34);group.add(front);
  for(const side of [-1,1]){
    rod('black',[side*.08,0,0],[side*.08,-.42,.28],.027,front);
    rod('metal',[side*.08,-.30,.20],[side*.08,-.56,.35],.018,front);
    box('white',[.045,.20,.065],[side*.09,-.43,.31],front,-.4);
    rod('metal',[0,.08,-.02],[side*.31,.25,-.09],.013,front);
    rod('black',[side*.28,.25,-.09],[side*.43,.25,-.09],.021,front);
    rod('metal',[side*.31,.23,-.04],[side*.43,.22,.01],.007,front);
  }
  box('black',[.09,.045,.07],[0,.24,-.03],front,-.25); // Instrument pod
  box('white',[.18,.16,.05],[0,-.02,.085],front,.2);
  box('headlight',[.12,.065,.025],[0,-.05,.12],front,.2);
  panel('white',[[-.105,-.19,.04],[.105,-.19,.04],[.08,-.235,.59],[-.08,-.235,.59]],front);
  panel('yellow',[[-.04,-.191,.14],[.04,-.191,.14],[.03,-.228,.51],[-.03,-.228,.51]],front);
  const wheels:{pivot:THREE.Group;spin:THREE.Group}[]=[];
  for(const [i,z] of [ULTRA_BEE.wheelbase/2,-ULTRA_BEE.wheelbase/2].entries()){
    const pivot=new THREE.Group();pivot.name=i===0?'FrontWheel':'RearWheel';(i===0?front:group).add(pivot);pivot.position.set(0,-.23,z);if(i===0)pivot.position.sub(front.position);
    const spin=new THREE.Group();pivot.add(spin);wheels.push({pivot,spin});
    const tire=new THREE.TorusGeometry(.281,.041,8,40);tire.rotateY(Math.PI/2);add('tire',tire,spin);
    for(let row=0;row<3;row++)for(let k=0;k<36;k++){
      const a=(k+row*.35)/36*Math.PI*2,g=new THREE.BoxGeometry(.035,.025,.043);
      g.rotateX(a);g.translate((row-1)*.033,Math.cos(a)*.313,Math.sin(a)*.313);add('tire',g,spin);
    }
    for(const side of [-1,1]){
      const rim=new THREE.TorusGeometry(.243,.010,5,40);rim.rotateY(Math.PI/2);rim.translate(side*.028,0,0);add('metal',rim,spin);
      for(let k=0;k<24;k++){const a=k/24*Math.PI*2;rod('metal',[side*.025,Math.cos(a)*.24,Math.sin(a)*.24],[side*.04,Math.cos(a+.25)*.042,Math.sin(a+.25)*.042],.0024,spin);}
    }
    rod('metal',[-.06,0,0],[.06,0,0],.041,spin);
    const disc=new THREE.RingGeometry(.073,.12,24);disc.rotateY(Math.PI/2);disc.translate(.055,0,0);add('metal',disc,spin);
    box('black',[.04,.075,.045],[.065,.08,-.045],pivot);
  }
  // Seated rider: knees on shrouds, boots on pegs and hands at the grips.
  const arms:{group:THREE.Group;side:number}[]=[];
  sphere('pants',[0,.49,-.30],[.14,.11,.13],rider);
  rod('jacket',[0,.50,-.31],[0,.88,-.09],.13,rider,.17);
  for(const side of [-1,1]){
    rod('pants',[side*.10,.48,-.28],[side*.20,.16,.02],.068,rider,.063);
    rod('pants',[side*.20,.16,.02],[side*.20,-.08,-.09],.052,rider,.04);
    box('black',[.10,.13,.18],[side*.20,-.10,-.055],rider,.15);
    const arm=new THREE.Group();arm.name=side<0?'LeftArm':'RightArm';rider.add(arm);arms.push({group:arm,side});
  }
  // Red Fox V1 Toxsyk-inspired motocross shell: full black face mask,
  // extended angular chin bar, black vents and white fox-head graphics.
  const shell=(key:M,phi:number,arc:number,theta:number,height:number,scale:P=[.137,.163,.157])=>{
    const g=new THREE.SphereGeometry(1,24,12,phi,arc,theta,height);g.scale(...scale);g.translate(0,1.035,-.065);add(key,g,helmet);
  };
  shell('helmetRed',0,Math.PI*2,0,1.20); // Crown meets the top of the face mask.
  shell('helmetRed',Math.PI,Math.PI,1.20,1.55); // Back, with an actual open face.
  shell('black',Math.PI,Math.PI,1.40,.56,[.138,.164,.158]); // Rear graphic band
  const crownPoint=(side:number,y:number,z:number):P=>[side*(.137*Math.sqrt(Math.max(0,1-((y-1.035)/.163)**2-((z+.065)/.157)**2))+.004),y,z];
  // One continuous opaque shield fills the opening from brow to chin. The
  // curved rows wrap into the cheek guards without a separate goggle frame.
  const maskRows=[{y:1.103,z:.075,w:.110},{y:1.079,z:.102,w:.116},{y:1.042,z:.126,w:.107},{y:1.010,z:.148,w:.087},{y:.979,z:.166,w:.063}];
  const maskPoint=(row:typeof maskRows[number],u:number):P=>[row.w*u,row.y,row.z-.028*u*u];
  const maskVertices:number[]=[],maskIndices:number[]=[],mask=new THREE.BufferGeometry();
  for(const row of maskRows)for(let i=0;i<=12;i++)maskVertices.push(...maskPoint(row,i/6-1));
  for(let row=0;row<maskRows.length-1;row++)for(let i=0;i<12;i++){
    const a=row*13+i,b=a+1,c=a+13,d=c+1;maskIndices.push(a,c,b,b,c,d);
  }
  mask.setAttribute('position',new THREE.Float32BufferAttribute(maskVertices,3));mask.setIndex(maskIndices);mask.computeVertexNormals();add('faceMask',mask,helmet);
  const maskEdges:P[]=[[.110,1.103,.002],[.126,1.079,.035],[.117,1.042,.053],[.109,1.010,.068],[.096,.979,.095]];
  for(const side of [-1,1]){
    for(let row=0;row<maskRows.length-1;row++){
      const edge=(i:number):P=>[maskEdges[i][0]*side,maskEdges[i][1],maskEdges[i][2]];
      panel('faceMask',[maskPoint(maskRows[row],side),edge(row),edge(row+1),maskPoint(maskRows[row+1],side)],helmet);
    }
    const x=side*.126;
    panel('helmetRed',[[x,1.09,-.055],[x,1.08,.035],[side*.105,.995,.075],[side*.072,.925,.176],[side*.11,.899,.038],[x,.927,-.106]],helmet);
    panel('helmetRed',[[side*.105,.995,.075],[side*.065,.984,.168],[side*.072,.925,.176]],helmet);
    panel('white',[[side*.132,1.019,-.139],[side*.134,1.044,-.106],[side*.134,1.092,-.099],[side*.134,1.070,-.062],[side*.132,1.078,-.025],[side*.130,1.033,-.040],[side*.126,1.007,.006],[side*.122,.973,.030],[side*.122,.948,-.017],[side*.129,.974,-.049],[side*.131,.980,-.098]],helmet);
    panel('black',[[side*.135,1.030,-.080],[side*.135,1.035,-.050],[side*.135,1.013,-.033],[side*.135,1.018,-.058]],helmet); // Fox eye
    panel('black',[[side*.103,.965,.110],[side*.076,.954,.165],[side*.079,.939,.165],[side*.112,.947,.080]],helmet); // Chin side vent
    rod('black',crownPoint(side,1.123,side*.035),crownPoint(side,1.103,side*.021),.0025,helmet);
    rod('black',crownPoint(side,1.103,side*.021),crownPoint(side,1.126,-side*.007),.0025,helmet); // V
    rod('black',crownPoint(side,1.124,-side*.025),crownPoint(side,1.105,-side*.027),.0025,helmet); // 1
    panel('black',[[side*.035,1.114,.066],[side*.074,1.108,.060],[side*.069,1.095,.067],[side*.031,1.102,.074]],helmet);
  }
  panel('helmetRed',[[-.065,.984,.168],[.065,.984,.168],[.072,.925,.176],[-.072,.925,.176]],helmet);
  panel('black',[[-.043,.971,.171],[.043,.971,.171],[.034,.943,.178],[-.034,.943,.178]],helmet); // Mouth intake
  for(const x of [-.02,0,.02])rod('helmetRed',[x,.945,.179],[x,.970,.173],.003,helmet);
  panel('white',[[-.065,.982,.169],[.065,.982,.169],[.047,.976,.173],[-.047,.976,.173]],helmet);
  // Build jointed arms once; posing only changes transforms, keeping gloves on grips.
  const armPoses=arms.map(({group:arm,side})=>{
    const shoulder=new THREE.Vector3(side*.15,.83,-.11),elbow=new THREE.Vector3(side*.27,.66,-.12),hand=new THREE.Vector3(side*.37,.58,.25);
    const upper=new THREE.Group(),lower=new THREE.Group(),glove=new THREE.Group();glove.name=side<0?'LeftGlove':'RightGlove';arm.add(upper,lower,glove);
    rod('jacket',[0,0,0],[0,1,0],.053,upper,.045);rod('jacket',[0,0,0],[0,1,0],.042,lower,.031);sphere('black',[0,0,0],[.045,.035,.05],glove);
    return {shoulder,elbow,hand,upper,lower,glove};
  });
  // Merge static detail by material; spokes and tread blocks cost no extra draws.
  for(const [parent,batch] of batches)for(const [key,parts] of batch){const g=mergeGeometries(parts,false)!;parts.forEach(p=>p.dispose());const mesh=new THREE.Mesh(g,mat[key]);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);}
  if(typeof document!=='undefined'){
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#f0f1e6';ctx.fillRect(0,0,512,128);ctx.fillStyle='#20282a';ctx.font='italic 900 76px sans-serif';ctx.textAlign='center';ctx.fillText('ULTRA BEE',256,88);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const decalMat=new THREE.MeshStandardMaterial({map:texture,roughness:.5});
    for(const side of [-1,1]){const m=new THREE.Mesh(new THREE.PlaneGeometry(.30,.075),decalMat);m.rotation.y=side*Math.PI/2;m.position.set(side*.176,.295,-.04);group.add(m);}
  }
  const lamp=new THREE.SpotLight(0xffedcd,0,32,.50,.6,1.5);lamp.position.set(0,.28,.49);lamp.target.position.set(0,-.4,15);group.add(lamp,lamp.target);lamp.visible=false;
  const up=new THREE.Vector3(0,1,0),joint=new THREE.Vector3(),grip=new THREE.Vector3(),direction=new THREE.Vector3(),steeringAxis=new THREE.Vector3(0,.56,-.35).normalize(),riderInverse=new THREE.Matrix4();
  const poseSegment=(part:THREE.Group,a:THREE.Vector3,b:THREE.Vector3)=>{direction.copy(b).sub(a);const length=direction.length();part.position.copy(a);part.quaternion.setFromUnitVectors(up,direction.normalize());part.scale.y=length;};
  const poseArms=(steering:number)=>{
    rider.updateMatrix();riderInverse.copy(rider.matrix).invert();
    for(const arm of armPoses){
      grip.copy(arm.hand).sub(front.position).applyAxisAngle(steeringAxis,steering).add(front.position).applyMatrix4(riderInverse);
      joint.copy(arm.elbow).addScaledVector(direction.copy(grip).sub(arm.hand),.45);
      poseSegment(arm.upper,arm.shoulder,joint);poseSegment(arm.lower,joint,grip);arm.glove.position.copy(grip);arm.glove.rotation.y=steering;
    }
  };
  poseArms(0);
  return {group,rider,helmet,
    update(s:PhysicsVehicleState,night:boolean,firstPerson=false){
      group.position.set(s.x,s.y,s.z);group.quaternion.set(s.rotation.x,s.rotation.y,s.rotation.z,s.rotation.w);
      front.quaternion.setFromAxisAngle(steeringAxis,s.steering);
      wheels.forEach((w,i)=>{w.pivot.position.y=-.06-(s.suspension[i]??.19)-(i===0?front.position.y:0);w.spin.rotation.x=s.wheelAngles[i]??0;});
      // Keep the body and hands in first person; the camera sits inside the helmet.
      helmet.visible=!firstPerson;rider.rotation.x=s.wheelie*.18;rider.rotation.z=-s.lean*.08;
      poseArms(s.steering);
      mat.headlight.emissiveIntensity=night?3:.5;mat.rear.emissiveIntensity=s.braking?4:night?1.8:.3;lamp.visible=night;lamp.intensity=night?24:0;
    },
  };
}
