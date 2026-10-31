import * as THREE from 'three';
import { geometryParts } from './car.ts';
type P=[number,number,number];

/** Original metre-scale mesh traced from GT launch photos. +Z is the nose.
 * The loft has genuine wheel openings, wide rear haunches, a long glass hatch
 * and inset air scoops. No downloaded model or photographic textures. */
export function createMcLarenGeometry(){
  const p=geometryParts();
  // z, half width, centre deck height. Catmull-Rom interpolation
  // gives continuous highlights rather than a stack of primitive body boxes.
  const controls=[[-2.3415,.83,.23],[-2.18,.94,.27],[-1.60,.965,.29],[-1.1,.94,.27],[-.45,.895,.13],[.4,.89,.14],[1.05,.95,.14],[1.45,.94,.11],[1.95,.84,.06],[2.3415,.67,-.04]];
  const curve=new THREE.CatmullRomCurve3(controls.map(c=>new THREE.Vector3(c[1],c[2],c[0])));
  const topAt=(x:number,z:number)=>{
    let low=0,high=1;
    for(let i=0;i<16;i++){const mid=(low+high)/2;if(curve.getPoint(mid).z<z)low=mid;else high=mid;}
    const c=curve.getPoint((low+high)/2),u=Math.min(1,Math.abs(x/c.x)),rise=.075+.04*Math.exp(-Math.pow((Math.abs(z)-1.35)/.55,2));
    return c.y+rise*Math.pow(u,4)-.065*Math.pow(u,16)+.006;
  };
  const onHood=(points:P[])=>points.map(([x,,z])=>[x,topAt(x,z),z] as P);
  const verts:number[]=[],indices:number[]=[],rings=180,around=40;
  const archBottom=(z:number)=>{
    let bottom=-.39;
    for(const wz of [1.3375,-1.3375]){
      const radius=wz>0?.355:.379,d=Math.abs(z-wz);
      if(d<radius)bottom=Math.max(bottom,-.23+Math.sqrt(radius*radius-d*d));
    }
    return bottom;
  };
  for(let i=0;i<=rings;i++){
    const t=i/rings,c=curve.getPoint(t),z=c.z,width=c.x,deck=c.y;
    const rise=.075+.04*Math.exp(-Math.pow((Math.abs(z)-1.35)/.55,2));
    for(let j=0;j<around;j++){
      const a=j/around*Math.PI*2,side=Math.sin(a),up=Math.cos(a),x=width*side;
      let y:number;
      if(up>=0){const u=Math.abs(side);y=deck+rise*Math.pow(u,4)-.065*Math.pow(u,16);}
      else {const b=archBottom(z);y=THREE.MathUtils.lerp(b,deck+rise-.065,Math.pow(Math.abs(side),12));}
      const endBlend=Math.max(0,1-t/.07),noseBlend=Math.max(0,(t-.92)/.08);
      const roundedZ=z+endBlend*.10*Math.pow(Math.abs(side),3)-noseBlend*.15*Math.pow(Math.abs(side),2);
      verts.push(x,y,roundedZ);
    }
  }
  for(let i=0;i<rings;i++)for(let j=0;j<around;j++){const a=i*around+j,b=i*around+(j+1)%around;indices.push(a,a+around,b,b,a+around,b+around);}
  for(const [offset,flip] of [[0,false],[rings*around,true]] as const)for(let j=1;j<around-1;j++)indices.push(offset,offset+(flip?j+1:j),offset+(flip?j:j+1));
  const body=new THREE.BufferGeometry();body.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));body.setIndex(indices);body.computeVertexNormals();p.add('paint',body);

  // Curved glazing sampled along the roof and extended rear hatch.
  const canopy=[[-1.85,.55,.305,.30],[-1.35,.71,.43,.30],[-.72,.76,.625,.28],[-.20,.75,.625,.27],[.25,.73,.61,.25],[.75,.73,.35,.23],[1.02,.72,.215,.21]];
  const canopyCurve=new THREE.CatmullRomCurve3(canopy.map(([z,w,top])=>new THREE.Vector3(w,top,z)));
  const cv:number[]=[],ci:number[]=[],across=32,canopyRings=64;
  for(let i=0;i<=canopyRings;i++){
    const c=canopyCurve.getPoint(i/canopyRings),edge=.21+Math.min(.09,(1.02-c.z)*.032);
    for(let j=0;j<=across;j++){
      const u=j/across*2-1;cv.push(u*c.x,edge+(c.y-edge)*Math.sqrt(Math.max(0,1-Math.pow(u,8))),c.z);
    }
  }
  for(let i=0;i<canopyRings;i++)for(let j=0;j<across;j++){const a=i*(across+1)+j,b=a+across+1;ci.push(a,b,a+1,b,b+1,a+1);}
  const glass=new THREE.BufferGeometry();glass.setAttribute('position',new THREE.Float32BufferAttribute(cv,3));glass.setIndex(ci);glass.computeVertexNormals();p.add('glass',glass);
  // A panoramic black roof, thin body-coloured rails and glazing seals.
  for(const side of [-1,1]){
    p.path('trim',canopy.map(([z,w,,edge])=>[side*w,edge+.004,z] as P),.011);
    const rail:P[]=[];
    for(let i=0;i<=48;i++){
      const c=canopyCurve.getPoint(i/48),edge=.21+Math.min(.09,(1.02-c.z)*.032),u=.84;
      rail.push([side*c.x*u,edge+(c.y-edge)*Math.sqrt(1-Math.pow(u,8))+.006,c.z]);
    }
    p.path('paint',rail,.014);
    p.beam('trim',[side*.755,.28,-.46],[side*.635,.60,-.46],.015);
    // Inset rear-quarter blade intakes; the outer lip sits proud of the door.
    const intake:P[]=[[side*.936,.31,-.55],[side*.956,.29,-.87],[side*.924,-.27,-.76],[side*.903,-.19,-.64]];
    p.quad('trim',intake);p.path('paint',[intake[0],[side*.962,.29,-.87],[side*.929,-.27,-.76]],.014);

    p.path('trim',[[side*.897,.19,.78],[side*.90,-.28,.55],[side*.898,-.32,-.53],[side*.943,.30,-.54]],.0035);
    p.beam('chrome',[side*.92,.24,-.48],[side*.922,.24,-.33],.008);
    p.path('trim',[[side*.95,-.37,-1.02],[side*.91,-.40,-.60],[side*.91,-.40,.65],[side*.96,-.35,.98]],.025);
    p.beam('paint',[side*.71,.27,.69],[side*.94,.28,.65],.025);
    const mirror=new THREE.SphereGeometry(.1,18,10);mirror.scale(.85,.56,1.45);mirror.translate(side*.96,.30,.65);p.add('paint',mirror);
    p.box('glass',[.13,.067,.009],[side*.96,.30,.525]);
    // Hood shut lines and swept, dark headlamp housings with two LED blades.
    p.path('trim',onHood([[side*.61,0,.99],[side*.55,0,1.52],[side*.46,0,1.96]]),.0025);
    const lamp=onHood([[side*.50,0,2.15],[side*.81,0,1.99],[side*.82,0,1.80],[side*.62,0,1.94]]);
    p.quad('trim',lamp);p.path('headlight',[lamp[0],lamp[1],lamp[2]],.012);
    p.path('headlight',onHood([[side*.60,0,1.94],[side*.75,0,1.82]]),.014);
    // Front bumper intakes follow the narrowing nose, with recessed fins.
    const scoop:P[]=[[side*.64,-.10,2.29],[side*.75,-.11,2.22],[side*.82,-.27,2.15],[side*.61,-.28,2.30]];
    p.quad('trim',scoop);p.path('trim',[...scoop,scoop[0]],.019);

    p.path('trim',[[side*.12,-.32,2.35],[side*.65,-.33,2.35],[side*.86,-.33,2.12]],.025);
    // Slim rear lamps in a recessed mesh band, not a full-width light bar.
    p.path('taillight',[[side*.32,.205,-2.432],[side*.67,.22,-2.406],[side*.82,.25,-2.331]],.012);
    p.path('chrome',[[side*.32,.18,-2.366],[side*.73,.20,-2.351],[side*.86,.235,-2.26]],.006);
    p.quad('trim',[[side*.68,-.07,-2.35],[side*.88,-.035,-2.28],[side*.91,-.30,-2.24],[side*.69,-.29,-2.36]]);
    const exhaust=new THREE.CylinderGeometry(.075,.075,.17,28,1,true);exhaust.rotateX(Math.PI/2);exhaust.translate(side*.55,-.29,-2.32);p.add('chrome',exhaust);
    const hole=new THREE.CircleGeometry(.065,24);hole.rotateY(Math.PI);hole.translate(side*.55,-.29,-2.408);p.add('trim',hole);
    p.box('taillight',[.035,.022,.12],[side*.957,-.06,-1.81]);
  }
  p.path('trim',[[-.82,.245,-2.285],[-.68,.218,-2.355],[-.34,.20,-2.378],[0,.20,-2.38],[.34,.20,-2.378],[.68,.218,-2.355],[.82,.245,-2.285]],.045);
  // Mesh-like crosshatch in the rear lamp recess and lower diffuser.
  for(let i=0;i<36;i++){const x=-.65+i*.037;p.beam('rubber',[x,.18,-2.395],[x+.025,.23,-2.395],.002,3);}
  p.quad('trim',[[-.83,-.20,-2.36],[.83,-.20,-2.36],[.78,-.42,-2.35],[-.78,-.42,-2.35]]);
  p.path('trim',[[-.83,-.20,-2.36],[0,-.22,-2.39],[.83,-.20,-2.36]],.015);
  for(const x of [-.67,-.34,0,.34,.67])p.box('trim',[.018,.12,.32],[x,-.41,-2.18]);
  p.box('trim',[.35,.19,.015],[0,-.08,-2.345]);
  p.box('taillight',[.27,.016,.018],[0,.32,-2.30]);
  p.box('chrome',[.13,.022,.012],[0,.295,-2.355]);
  p.box('chrome',[.055,.006,.07],[0,topAt(0,1.94),1.94]);
  p.quad('trim',[[-.46,-.14,2.351],[.46,-.14,2.351],[.57,-.32,2.351],[-.57,-.32,2.351]]);
  p.path('trim',[[-.84,-.34,2.13],[-.65,-.35,2.28],[0,-.35,2.375],[.65,-.35,2.28],[.84,-.34,2.13]],.02);
  for(let i=0;i<28;i++){const x=-.44+i*.033;p.beam('rubber',[x,-.17,2.357],[x,-.29,2.357],.0025,3);}
  p.box('trim',[.335,.178,.02],[0,-.215,2.369]);
  return p.finish();
}

export function createMcLarenWheelGeometry(side:number,front:boolean){
  const p=geometryParts(),radius=front?.33275:.3552,half=front?.1125:.1475,rim=front?.254:.2667;
  const tire=new THREE.LatheGeometry([new THREE.Vector2(rim,-half),new THREE.Vector2(radius-.015,-half),new THREE.Vector2(radius,-half*.7),new THREE.Vector2(radius,half*.7),new THREE.Vector2(radius-.015,half),new THREE.Vector2(rim,half)],48);
  tire.rotateZ(Math.PI/2);p.add('rubber',tire);
  const face=side*(half+.004);
  for(const r of [rim,rim-.018]){const lip=new THREE.TorusGeometry(r,.007,5,48);lip.rotateY(Math.PI/2);lip.translate(face,0,0);p.add('chrome',lip);}
  const rotor=new THREE.CylinderGeometry(rim*.82,rim*.82,.014,40);rotor.rotateZ(Math.PI/2);rotor.translate(side*(half-.034),0,0);p.add('chrome',rotor);
  for(let i=0;i<28;i++){const a=i/28*Math.PI*2;const hole=new THREE.CircleGeometry(.006,5);hole.rotateY(side*Math.PI/2);hole.translate(side*(half-.025),Math.cos(a)*rim*.66,Math.sin(a)*rim*.66);p.add('trim',hole);}
  for(let i=0;i<7;i++)for(const split of [-1,1]){const a=i/7*Math.PI*2;p.beam('chrome',[face,Math.cos(a)*.055,Math.sin(a)*.055],[face-side*.012,Math.cos(a+split*.095)*rim*.97,Math.sin(a+split*.095)*rim*.97],.009,5);}
  const hub=new THREE.CylinderGeometry(.045,.045,.018,20);hub.rotateZ(Math.PI/2);hub.translate(face,0,0);p.add('trim',hub);
  for(let i=0;i<5;i++){const a=i/5*Math.PI*2;const bolt=new THREE.SphereGeometry(.006,6,4);bolt.translate(face+side*.012,Math.cos(a)*.031,Math.sin(a)*.031);p.add('chrome',bolt);}
  return p.finish();
}
