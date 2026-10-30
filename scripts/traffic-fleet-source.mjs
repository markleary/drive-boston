// Approved traffic-fleet artwork. Authoring only; baked by build-traffic-fleet.mjs.
// Dimensions are meters, +Z forward, Y=0 at the tire contact patch.
import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import {createVehicleWheelGeometry,createMassachusettsPlateMaterial} from '../src/render/car.ts';
const S={};
function mat(color,roughness=.5,metalness=0){return new T.MeshStandardMaterial({color,roughness,metalness,side:T.DoubleSide});}
function add(g,m,group=S.car){const a=new T.Mesh(g,m);a.castShadow=true;a.receiveShadow=false;group.add(a);return a;}
function box(m,size,p,r=0,group=S.car){const g=r?new RoundedBoxGeometry(...size,3,r):new T.BoxGeometry(...size);const mesh=add(g,m,group);mesh.position.set(...p);return mesh;}
function tube(m,points,r=.008,group=S.car){const c=new T.CurvePath();for(let i=1;i<points.length;i++)c.add(new T.LineCurve3(new T.Vector3(...points[i-1]),new T.Vector3(...points[i])));return add(new T.TubeGeometry(c,Math.max(4,points.length*6),r,12,false),m,group);}
function quad(m,points,group=S.car){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([0,1,2,0,2,3].flatMap(i=>points[i]),3));g.computeVertexNormals();return add(g,m,group);}
function cyl(m,r1,r2,len,pos,rotation=[0,0,0],segments=32){const a=add(new T.CylinderGeometry(r1,r2,len,segments),m);a.position.set(...pos);a.rotation.set(...rotation);return a;}
function flatShape(m,pts,z,group=S.car){const shape=new T.Shape();shape.moveTo(...pts[0]);pts.slice(1).forEach(p=>shape.lineTo(...p));shape.closePath();const g=new T.ShapeGeometry(shape,8);g.translate(0,0,z);if(S.c){const p=g.attributes.position;for(let i=0;i<p.count;i++)p.setZ(i,warpZ(z,p.getX(i),S.c));g.computeVertexNormals();}return add(g,m,group);}
function sample(profile,z){
 let i=1;while(i<profile.length-1&&z>profile[i][0])i++;
 const a=profile[i-1],b=profile[i],t=T.MathUtils.clamp((z-a[0])/(b[0]-a[0]),0,1),dx=b[0]-a[0];
 return a.slice(1).map((v,j)=>{
  const k=j+1,slopes=profile.slice(1).map((p,n)=>(p[k]-profile[n][k])/(p[0]-profile[n][0]));
  const tangent=n=>{if(n===0)return slopes[0];if(n===profile.length-1)return slopes.at(-1);const l=slopes[n-1],r=slopes[n];return l*r<=0?0:2*l*r/(l+r);};
  return (2*t**3-3*t*t+1)*v+(t**3-2*t*t+t)*dx*tangent(i-1)+(-2*t**3+3*t*t)*b[k]+(t**3-t*t)*dx*tangent(i);
 });
}
function grid(n,m,fn,material,reverse=false){const ps=[],uvs=[],inds=[];for(let i=0;i<=n;i++)for(let j=0;j<=m;j++){ps.push(...fn(i/n,j/m));uvs.push(i/n,j/m);}for(let i=0;i<n;i++)for(let j=0;j<m;j++){const a=i*(m+1)+j;const tris=[a,a+1,a+m+2,a,a+m+2,a+m+1];if(reverse)tris.reverse();inds.push(...tris);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(ps,3));g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));g.setIndex(inds);g.computeVertexNormals();return add(g,material);}

const fleet=[
 {id:'compact',name:'Compact car',ref:'2025 Honda Civic sedan',L:4.67,W:1.80,H:1.42,wb:2.73,r:.316,front:1.35,rear:-1.38,belt:.84,roof:1.42,fb:.9,ft:.24,rt:-.85,rb:-1.55,paint:'#a3b0bb',palette:[['Pearl white','#ececea'],['Silver','#aeb4b9'],['Charcoal','#555d64'],['Black','#161b21'],['Deep blue','#1f4c78'],['Rally red','#a7242b']]},
 {id:'sedan',name:'Full-size sedan',ref:'2022 Toyota Avalon',L:4.98,W:1.85,H:1.45,wb:2.87,r:.33,front:1.39,rear:-1.48,belt:.88,roof:1.45,fb:.97,ft:.24,rt:-.87,rb:-1.69,paint:'#8a333b',palette:[['Pearl white','#edede7'],['Silver','#a8b1ba'],['Graphite','#555b61'],['Black','#191c20'],['Burgundy','#793038'],['Navy','#25394e']]},
 {id:'minivan',name:'Minivan',ref:'2025 Toyota Sienna',L:5.17,W:1.99,H:1.78,wb:3.06,r:.354,front:1.5,rear:-1.56,belt:1.00,roof:1.76,fb:1.31,ft:.45,rt:-2.00,rb:-2.41,paint:'#77908b',palette:[['Pearl white','#eaece6'],['Silver','#adb5b8'],['Gray','#626c71'],['Black','#1a2024'],['Muted green','#77908b'],['Deep blue','#2c4a63']]},
 {id:'pickup',name:'Pickup truck',ref:'2025 Ford F-150 · crew cab / short bed',L:5.89,W:2.03,H:1.96,wb:3.69,r:.405,front:1.75,rear:-1.94,belt:1.20,roof:1.96,fb:1.27,ft:.75,rt:-.95,rb:-1.14,paint:'#9f3035',palette:[['Oxford white','#e9eae5'],['Silver','#a8afb3'],['Carbon gray','#555c62'],['Black','#181c1f'],['Dark blue','#294c65'],['Deep red','#8a2c32']]},
 {id:'box',name:'Light-duty box truck',ref:'2025 Ford E-350 · cutaway box body',L:6.6,W:2.12,H:3.15,wb:3.65,r:.385,front:2.12,rear:-1.53,belt:1.18,roof:2.07,fb:2.10,ft:1.49,rt:.57,rb:.44,paint:'#eceddf',palette:[['Fleet white','#eceddf'],['Silver','#adb5bb'],['Dark blue','#284e78'],['Service red','#a93130'],['Fleet yellow','#d6ab35']]}
];
function materials(color){return {
paint:new T.MeshPhysicalMaterial({color,metalness:.28,roughness:.26,clearcoat:.75,clearcoatRoughness:.19,side:T.DoubleSide}),
glass:new T.MeshPhysicalMaterial({color:'#142b35',metalness:.36,roughness:.11,clearcoat:1,clearcoatRoughness:.09,side:T.DoubleSide}),black:mat('#151b1e',.48,.24),rubber:mat('#171a1b',.94),chrome:mat('#b8bec0',.21,.9),rim:mat('#9fa7af',.28,.78),darkRim:mat('#3e454c',.38,.62),
lamp:new T.MeshStandardMaterial({color:'#dde5df',emissive:'#ffedce',emissiveIntensity:.45,roughness:.2,side:T.DoubleSide}),
red:new T.MeshStandardMaterial({color:'#8e1d16',emissive:'#e5281d',emissiveIntensity:.35,roughness:.27,metalness:.15,side:T.DoubleSide}),amber:mat('#bd7023',.3),white:mat('#e4e6dd',.5),seam:mat('#26323a',.65),box:mat('#e5e5dc',.57,.12)};}

function warpZ(z,x,c){if(c.id==='pickup'||c.id==='box')return z;const front=Math.exp(-Math.abs(z-c.L/2)/.22),rear=Math.exp(-Math.abs(z+c.L/2)/.22);return z+(.04*rear-.04*front)*Math.min(1,Math.abs(x/(c.W/2)))**4;}
// Use physical panel height to shape the side. Arch cutouts never change this
// surface; they only trim it. This avoids pinching every row toward the tire.
function sideWidth(z,y,offset=0){
 const {c,profile,base}=S.body,[ww,h]=sample(profile,z);
 const v=T.MathUtils.clamp((y-base)/(h-.030-base),0,1);
 const skin=ww*(.948+.022*v+.045*Math.sin(Math.PI*v));
 const archZone=Math.max(...[c.front,c.rear].map(axle=>Math.exp(-(((z-axle)/.48)**4))));
 return skin+.009*archZone*Math.sin(Math.PI*v)+offset;
}
function panelPoint(side,y,z,offset=.0015){const x=side*sideWidth(z,y,offset);return [x,y,warpZ(z,x,S.body.c)];}
function deckHeight(x,z){
 const {c,profile}=S.body,[ww,h]=sample(profile,z),q=Math.min(1,Math.abs(x)/(.97*ww));
 const crown=c.id==='pickup'?.010:c.id==='box'?.009:.014;
 const shoulder=T.MathUtils.clamp((q-.76)/.24,0,1);
 return h+crown*(1-q*q)-.030*(1-Math.sqrt(Math.max(0,1-shoulder*shoulder)));
}
function polygonShape(points){const shape=new T.Shape();shape.moveTo(...points[0]);points.slice(1).forEach(p=>shape.lineTo(...p));shape.closePath();return shape;}
// Subdivide before projection so the complete lens follows the curved fascia,
// including its interior vertices. Corner-only projection produces flat fins.
function endSurface(material,shape,z,offset=0){
 const source=new T.ShapeGeometry(shape),flat=source.toNonIndexed(),points=flat.attributes.position,vertices=[];
 const emit=(a,b,c,depth=0)=>{
  const dist=(p,q)=>(p[0]-q[0])**2+(p[1]-q[1])**2;
  if(depth<6&&Math.max(dist(a,b),dist(b,c),dist(c,a))>.075**2){
   const mid=(p,q)=>[(p[0]+q[0])/2,(p[1]+q[1])/2],ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);
   emit(a,ab,ca,depth+1);emit(ab,b,bc,depth+1);emit(ca,bc,c,depth+1);emit(ab,bc,ca,depth+1);
  }else for(const p of [a,b,c])vertices.push(p[0],p[1],warpZ(z,p[0],S.c)+Math.sign(z)*offset);
 };
 for(let i=0;i<points.count;i+=3)emit([points.getX(i),points.getY(i)],[points.getX(i+1),points.getY(i+1)],[points.getX(i+2),points.getY(i+2)]);
 source.dispose();flat.dispose();const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.computeVertexNormals();return add(g,material);
}
function endPatch(material,points,z,offset=.001){return endSurface(material,polygonShape(points),z,offset);}
function roundedGlazing(m,points,radius=.035,bow=.018){
 const p=points.map(p=>new T.Vector3(...p)),normal=p[1].clone().sub(p[0]).cross(p[3].clone().sub(p[0])).normalize();
 const meanX=points.reduce((n,p)=>n+p[0],0)/4;
 if(Math.abs(normal.x)>.8&&normal.x*meanX<0)normal.negate();
 const ru=Math.min(.09,radius/p[0].distanceTo(p[1])),rv=Math.min(.12,radius/p[0].distanceTo(p[3]));
 const shape=new T.Shape();shape.moveTo(ru,0);shape.lineTo(1-ru,0);shape.quadraticCurveTo(1,0,1,rv);shape.lineTo(1,1-rv);shape.quadraticCurveTo(1,1,1-ru,1);shape.lineTo(ru,1);shape.quadraticCurveTo(0,1,0,1-rv);shape.lineTo(0,rv);shape.quadraticCurveTo(0,0,ru,0);
 const at=(u,v)=>p[0].clone().lerp(p[1],u).lerp(p[3].clone().lerp(p[2],u),v).addScaledVector(normal,.003+bow*Math.sin(u*Math.PI)*Math.sin(v*Math.PI)).toArray();
 quad(m.paint,points);
 const raw=new T.ShapeGeometry(shape,8),flat=raw.toNonIndexed(),pos=flat.attributes.position,vertices=[];
 const tri=(a,b,c,depth=0)=>{
  const len=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2;
  const edges=[len(a,b),len(b,c),len(c,a)],long=Math.max(...edges),mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
  if(long>.012&&depth<10){const i=edges.indexOf(long);if(i===0){const q=mid(a,b);tri(a,q,c,depth+1);tri(q,b,c,depth+1);}else if(i===1){const q=mid(b,c);tri(a,b,q,depth+1);tri(a,q,c,depth+1);}else{const q=mid(c,a);tri(a,b,q,depth+1);tri(q,b,c,depth+1);}}
  else for(const [u,v] of [a,b,c])vertices.push(...at(u,v));
 };
 for(let i=0;i<pos.count;i+=3)tri([pos.getX(i),pos.getY(i)],[pos.getX(i+1),pos.getY(i+1)],[pos.getX(i+2),pos.getY(i+2)]);
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.computeVertexNormals();add(g,m.glass);raw.dispose();flat.dispose();
 tube(m.black,shape.getPoints(10).map(p=>at(p.x,p.y)),.010);
}
function lampLayouts(c){
 if(c.id==='pickup'||c.id==='box')return [];
 const result=[],w=c.W/2;
 for(const front of [true,false]){
  const z=(front?1:-1)*c.L/2,[,h]=sample(S.body.profile,z);
  for(const side of [-1,1]){
   const inner=w*(front?.43:.37),outer=w*(front?.88:.89),top=h-.025;
   const points=front?[[inner,top-.025],[outer-.03,top],[outer,top-.011],[outer-.028,top-.072],[inner+.025,top-.067]]:
    [[inner,top-.017],[outer-.016,top],[outer,top-.012],[outer-.012,top-.089],[inner+.03,top-.070]];
   result.push({front,side,z,top,inner,outer,points:points.map(([x,y])=>[side*x,y])});
  }
 }
 return result;
}
function passengerLights(c,m){
 for(const lamp of S.lights){
  const {points,z,front,side,top,inner,outer}=lamp;
  // The original body surface has a matching hole. Black walls sit inside it;
  // the lens face stays two millimeters behind the surrounding sheet metal.
  endPatch(m.black,points,z,-.007);
  for(let i=0;i<points.length;i++){
   const a=points[i],b=points[(i+1)%points.length],p=(v,d)=>[...v,warpZ(z,v[0],c)+Math.sign(z)*d];
   quad(m.black,[p(a,0),p(b,0),p(b,-.007),p(a,-.007)]);
  }
  const cx=points.reduce((n,p)=>n+p[0],0)/points.length,cy=points.reduce((n,p)=>n+p[1],0)/points.length;
  const lens=points.map(([x,y])=>[cx+(x-cx)*.955,cy+(y-cy)*.84]);
  endPatch(front?m.darkRim:m.red,lens,z,-.002);
  const map=ps=>ps.map(([x,y])=>[side*x,y]);
  if(front){
   endPatch(m.lamp,map([[inner+.025,top-.031],[outer-.035,top-.010],[outer-.017,top-.018],[inner+.026,top-.041]]),z,-.001);
   for(const x of [inner+.09,inner+.20])endPatch(m.lamp,map([[x-.029,top-.045],[x+.029,top-.040],[x+.029,top-.058],[x-.029,top-.060]]),z,-.001);
   endPatch(m.amber,map([[outer-.034,top-.025],[outer-.012,top-.022],[outer-.023,top-.060],[outer-.041,top-.060]]),z,-.001);
  }else{
   endPatch(m.red,map([[inner+.032,top-.025],[outer-.024,top-.012],[outer-.025,top-.026],[inner+.032,top-.039]]),z,-.001);
   endPatch(m.white,map([[inner+.048,top-.049],[inner+.105,top-.046],[inner+.105,top-.060],[inner+.048,top-.062]]),z,-.001);
  }
 }
 if(c.id==='sedan'){
  const z=-c.L/2,[,h]=sample(S.body.profile,z);
  endPatch(m.red,[[-.34,h-.047],[.34,h-.047],[.34,h-.059],[-.34,h-.059]],z,.006);
 }
}
function grilleShapes(c){
 const w=c.W/2,van=c.id==='minivan',n=c.L/2,gy=van?.43:.46;
 const topW=c.id==='sedan'?.56:van?.61:.62,baseW=c.id==='sedan'?.81:van?.82:.72;
 const capTop=sample(S.body.profile,n)[1],top=Math.min(gy+(c.id==='sedan'?.26:.15),capTop-.10),upperW=c.W*.20;
 return {gy,top,baseW,lower:[[-baseW,gy-.20],[baseW,gy-.20],[baseW*.96,gy+.02],[topW,top],[-topW,top],[-baseW*.96,gy+.02]],upper:[[-upperW,capTop-.040],[upperW,capTop-.040],[upperW,capTop-.091],[-upperW,capTop-.091]],vents:c.id==='compact'?[-1,1].map(s=>[[s*.735,.36],[s*.805,.36],[s*.805,.48],[s*.735,.48]]):[]};
}
function body(c,m){
 const truck=c.id==='pickup',boxTruck=c.id==='box',van=c.id==='minivan',nose=c.L/2,tail=-c.L/2,w=c.W/2;
 let profile=boxTruck?[[.4,w*.96,1.12],[.7,w,1.18],[1.6,w,1.18],[2.4,w*.99,1.10],[2.9,w*.92,1.02],[nose,w*.87,.91]]:
 [[tail,w*.96,c.belt-(van?.02:.16)],[tail+.12,w*.99,c.belt-(van?0:.06)],[tail+.45,w,c.belt],[c.rear,w,c.belt+.015],[-.3,w,c.belt],[.7,w,c.belt],[c.front,w*.995,c.belt-.015],[nose-.38,w*.96,c.belt-.10],[nose-.13,w*.96,c.belt-.17],[nose,w*.95,c.belt-.21]];
 if(truck)profile=[[tail,w*.96,1.22],[tail+.1,w,1.26],[-1.16,w,1.26],[-1.1,w,1.23],[.7,w,1.23],[1.8,w,1.19],[nose-.2,w*.96,1.12],[nose,w*.94,1.07]];
 const start=profile[0][0],end=profile.at(-1)[0],base=truck?.45:boxTruck?.40:.23;
 S.body={c,profile,base};
 S.lights=lampLayouts(c);
 const lower=z=>Math.max(base,...[c.front,c.rear].map(axle=>{const d=Math.abs(z-axle),rr=c.r+.055;return d<rr?c.r+Math.sqrt(rr*rr-d*d):base}));
 for(const s of [-1,1])grid(140,18,(u,v)=>{const z=T.MathUtils.lerp(start,end,u),[,h]=sample(profile,z),lo=lower(z),y=T.MathUtils.lerp(lo,h-.030,v);return panelPoint(s,y,z,0);},m.paint,s<0);
 // Nearly flat sheet metal with a small crown and a rolled shoulder, rather
 // than the previous 95 mm dome stretching across every hood and trunk.
 grid(90,36,(u,v)=>{const z=T.MathUtils.lerp(truck?-1.13:start,end,u),[ww]=sample(profile,z),x=(v*2-1)*ww*.97;return [x,deckHeight(x,z),warpZ(z,x,c)];},m.paint,true);
 if(truck){ // carve the visual bed with a recessed dark liner and painted rails.
   box(m.black,[1.77,.055,1.53],[0,.88,-2.02],.025);
   for(const side of [-1,1])box(m.black,[.035,.39,1.56],[side*.848,1.10,-2.02],.008);box(m.black,[1.7,.38,.04],[0,1.10,-1.25],.008);
   for(const s of [-1,1]){box(m.paint,[.16,.42,1.75],[s*.93,1.16,-2.05],.025);box(m.black,[.17,.04,1.76],[s*.93,1.39,-2.05],.012);}
   box(m.paint,[1.86,.39,.12],[0,1.17,tail+.06],.025);box(m.black,[1.83,.035,.13],[0,1.39,tail+.05],.01);
   for(let x=-.72;x<=.73;x+=.18)box(m.darkRim,[.015,.012,1.40],[x,.912,-2.04],.003);
 }
 for(const z of [start,end]){
  if(S.lights.length){
   const [,h]=sample(profile,z),outer=[];
   outer.push([-sideWidth(z,base),base],[sideWidth(z,base),base]);
   for(let i=1;i<=24;i++){const y=T.MathUtils.lerp(base,h-.03,i/24);outer.push([sideWidth(z,y),y]);}
   const topWidth=sample(profile,z)[0]*.97;
   for(let i=1;i<=40;i++){const x=T.MathUtils.lerp(topWidth,-topWidth,i/40);outer.push([x,deckHeight(x,z)]);}
   for(let i=23;i>0;i--){const y=T.MathUtils.lerp(base,h-.03,i/24);outer.push([-sideWidth(z,y),y]);}
   const shape=polygonShape(outer);
   for(const lamp of S.lights.filter(lamp=>lamp.z===z))shape.holes.push(polygonShape(lamp.points));
   if(z===end){const faces=grilleShapes(c);for(const points of [faces.lower,faces.upper,...faces.vents])shape.holes.push(polygonShape(points));}
   endSurface(m.paint,shape,z);
  }else{const [,h]=sample(profile,z);grid(36,20,(u,v)=>{const x=(u*2-1)*sideWidth(z,T.MathUtils.lerp(base,h-.03,v));const y=T.MathUtils.lerp(base,deckHeight(x,z),v);return [x,y,warpZ(z,x,c)];},m.paint,z===end);}
 }
 box(m.black,[c.W*.80,.09,(end-start)*.82],[0,base-.02,(start+end)/2],.02);
 for(const s of [-1,1]){
   const sillStart=boxTruck?.6:c.rear+.42,sillEnd=c.front-.38;
   box(m.paint,[.07,.105,sillEnd-sillStart],[s*(w-.035),base+.035,(sillStart+sillEnd)/2],.025);
   for(const z of [c.front,c.rear]){
     if(boxTruck&&z===c.rear)continue;
     const rr=c.r+.055;
     // A narrow fender return follows the undistorted body and rolls slightly
     // outward at the cut edge. Only the hidden wheel-well lining turns inward.
     grid(80,5,(u,v)=>{const a=u*Math.PI,r=rr+.026*(1-v),zz=z-r*Math.cos(a),y=c.r+r*Math.sin(a);return panelPoint(s,y,zz,.005*Math.sin(v*Math.PI/2));},truck?m.black:m.paint,s<0);
     grid(80,3,(u,v)=>{const a=u*Math.PI,zz=z-rr*Math.cos(a),y=c.r+rr*Math.sin(a),p=panelPoint(s,y,zz,.004);p[0]-=s*v*.045;return p;},m.black,s<0);
     for(const sign of [-1,1]){const zz=z+sign*rr;const p0=panelPoint(s,base,zz,.002),p1=panelPoint(s,c.r,zz,.002);tube(truck?m.black:m.paint,[p0,p1],truck?.010:.005);}
   }
 }
 return profile;
}

function cabin(c,m){
 const w=c.W/2,bw=w*.91,tw=w*(c.id==='pickup'?.82:c.id==='box'?.87:.77),y=c.belt+.02,top=c.roof-.045;
 const {fb,ft,rt,rb}=c;
 // Roof is a curved opaque panel and all glass is bounded by real pillars.
 grid(30,22,(u,v)=>{const z=T.MathUtils.lerp(rt-.025,ft+.025,u),x=(v*2-1)*tw;return [x,top+.045*(1-(x/tw)**2)+.016*Math.sin(u*Math.PI),z];},m.paint,true);
 const wind=[[-bw,y,fb],[bw,y,fb],[tw,top,ft],[-tw,top,ft]];
 roundedGlazing(m,wind,.045,.026);
 for(const s of [-1,1])tube(m.paint,[[s*bw,y,fb],[s*(tw+.02),top,ft]],c.id==='minivan'?.043:.034);
 const back=[[bw,y,rb],[-bw,y,rb],[-tw,top,rt],[tw,top,rt]];
 roundedGlazing(m,back,.040,.021);
 const backNormal=new T.Vector3().subVectors(new T.Vector3(...back[1]),new T.Vector3(...back[0])).cross(new T.Vector3().subVectors(new T.Vector3(...back[3]),new T.Vector3(...back[0]))).normalize();
 const backPoint=(u,v)=>new T.Vector3(...back[0]).lerp(new T.Vector3(...back[1]),u).lerp(new T.Vector3(...back[3]).lerp(new T.Vector3(...back[2]),u),v).addScaledVector(backNormal,.004+.021*Math.sin(u*Math.PI)*Math.sin(v*Math.PI)).toArray();
 if(c.id==='compact'||c.id==='sedan')for(let i=1;i<6;i++){const v=.12+i*.12;tube(m.seam,Array.from({length:17},(_,j)=>backPoint(.08+j*.84/16,v)),.0015);}
 if(c.id==='minivan')tube(m.black,[backPoint(.49,.13),backPoint(.38,.15),backPoint(.27,.15)],.008);
 const pillarWidth=c.id==='box'?.065:c.id==='pickup'?.07:.09;
 for(const s of [-1,1]){
   const lower=c.id==='minivan'?[fb-.09,-.15,-1.51,rb+.12]:c.id==='box'?[fb-.06,rb+.12]:[fb-.09,-.22,rb+.10];
   const upper=c.id==='minivan'?[ft-.05,-.15,-1.48,rt+.13]:c.id==='box'?[ft-.04,rt+.11]:[ft-.05,-.22,rt+.10];
   for(let i=0;i<lower.length-1;i++){
     const pts=[[s*bw,y+.035,lower[i]-(i?.04:0)],[s*bw,y+.035,lower[i+1]+.04],[s*tw,top-.035,upper[i+1]+.04],[s*tw,top-.035,upper[i]-(i?.04:0)]];
     roundedGlazing(m,pts,.025,.009);
   }
   tube(m.paint,[[s*bw,y,rb],[s*(tw+.025),top,rt]],c.id==='minivan'?.075:c.id==='pickup'?.06:.045);
   // Painted belt rail and chrome window surround.
   tube(c.id==='compact'||c.id==='pickup'||c.id==='box'?m.black:m.chrome,[[s*(bw+.009),y+.005,rb],[s*(bw+.009),y+.005,fb]],.012);
   if(c.id==='sedan'||c.id==='minivan')tube(m.chrome,[[s*bw,y+.02,rb],[s*tw,top+.006,rt],[s*tw,top+.008,ft]],.009);
   for(let i=1;i<lower.length-1;i++)quad(m.black,[[s*(bw+.003),y,lower[i]-.045],[s*(bw+.003),y,lower[i]+.045],[s*(tw+.004),top,upper[i]+.045],[s*(tw+.004),top,upper[i]-.045]]);
   // Mirror pedestal and rounded paint cap with black lower housing.
   const mz=fb-.18,my=y+.11;
   tube(m.black,[[s*bw,my-.03,mz],[s*(w+.09),my-.01,mz-.04]],.026);
   box(m.black,[.23,.115,.28],[s*(w+.085),my,mz-.03],.045);
   box(c.id==='box'?m.black:m.paint,[.22,.08,.27],[s*(w+.09),my+.035,mz-.02],.035);
   box(m.chrome,[.17,.075,.008],[s*(w+.09),my+.012,mz-.17],.015);
   if(c.id!=='box')tube(m.lamp,[[s*(w+.155),my+.025,mz+.085],[s*(w+.055),my+.025,mz+.12]],.007);
 }
 for(const x of [-.45,.28])tube(m.black,[[x,y+.022,fb+.012],[x+.34,y+.032,fb-.035]],.008);
 if(c.id==='minivan')for(const s of [-1,1]){
   tube(m.black,[[s*.70,c.roof+.005,-1.6],[s*.70,c.roof+.075,-1.37],[s*.70,c.roof+.075,.1],[s*.70,c.roof+.01,.3]],.024);
 }
 if(c.id!=='box'&&c.id!=='pickup'){
  const fin=add(new T.ConeGeometry(.065,.12,4),m.paint);fin.scale.set(.5,1,1.5);fin.position.set(0,c.roof+.055,rt+.1);
  box(m.red,[.27,.018,.025],[0,y+.04,rb-.015],.006);
 }
}

function details(c,m,profile){
 const n=c.L/2,t=-c.L/2,w=c.W/2,truck=c.id==='pickup',boxTruck=c.id==='box',van=c.id==='minivan';
 // Door shut lines remain subtle at normal driving distance.
 for(const s of [-1,1]){
   const zFront=c.fb-.13,zSplit=boxTruck?.62:truck?-.30:-.28,zRear=van?-1.65:truck?-1.08:-1.20;
   const seamY=c.belt-.12,base=truck?.51:boxTruck?.44:.30;
   for(const [a,b] of boxTruck?[[zFront,zSplit]]:[[zFront,zSplit],[zSplit-.04,zRear]]){
    const pts=[[s*(w+.008),seamY,a],[s*(w+.011),base+.07,a-.1],[s*(w+.011),base,b+.08],[s*(w+.008),seamY,b]];
    tube(m.seam,pts.map(p=>panelPoint(s,p[1],p[2])),.002);
    box(m.black,[.012,.028,.17],panelPoint(s,seamY-.03,b+.24,.006),.008);
    box(truck?m.black:m.paint,[.022,.020,.15],panelPoint(s,seamY-.025,b+.24,.014),.007);
   }
   tube(m.paint,[[c.belt-.10,c.rear+.2],[c.belt-.07,.6],[c.belt-.12,c.front+.1]].map(([y,z])=>panelPoint(s,y,z,.001)),.004);
   if(van)tube(m.chrome,[[s*(w+.013),.86,-1.92],[s*(w+.013),.86,-.42]],.008);
   if(truck)box(m.black,[.20,.075,2.42],[s*(w+.06),.42,.04],.03);
   const fuelZ=truck?-2.2:van?-1.70:-1.86,fw=sample(profile,T.MathUtils.clamp(fuelZ,profile[0][0],profile.at(-1)[0]))[0];
   if(s===-1&&!boxTruck)tube(m.seam,[[c.belt-.06,fuelZ-.09],[c.belt-.20,fuelZ-.09],[c.belt-.20,fuelZ+.09],[c.belt-.06,fuelZ+.09],[c.belt-.06,fuelZ-.09]].map(([y,z])=>panelPoint(s,y,z)),.002);
 }
 // Tail and hood seams / recognizable lamps and grille geometry.
 const fz=n+.05;
 if(truck||boxTruck){
   const gy=boxTruck?.78:.87,gw=boxTruck?1.22:1.32,gh=boxTruck?.47:.45;
   box(m.chrome,[gw+.085,gh+.08,.08],[0,gy,fz],.035);box(m.black,[gw,gh,.09],[0,gy,fz+.025],.025);
   for(let i=0;i<4;i++)box(m.chrome,[gw-.03,.025,.025],[0,gy-gh*.37+i*gh*.245,fz+.085],.008);
   for(const s of [-1,1]){
    box(m.chrome,[.31,gh+.05,.055],[s*(w-.19),gy,fz-.04],.035);
    box(m.darkRim,[.25,gh-.04,.065],[s*(w-.19),gy,fz-.006],.025);for(const yy of [-.1,.1])box(m.lamp,[.19,.065,.023],[s*(w-.19),gy+yy,fz+.039],.012);
    box(m.black,[.26,.018,.025],[s*(w-.19),gy,fz+.04],.003);
    box(m.amber,[.255,.035,.02],[s*(w-.19),gy-.03,fz+.045],.006);
    if(truck)tube(m.lamp,[[s*(w-.10),gy+.20,fz+.045],[s*(w-.31),gy+.20,fz+.045],[s*(w-.31),gy-.18,fz+.045],[s*(w-.10),gy-.18,fz+.045]],.012);
   }
   box(m.chrome,[c.W*.96,.19,.13],[0,.46,fz-.04],.045);
   box(m.black,[c.W*.90,.13,.15],[0,.32,fz-.025],.035);
   box(m.black,[.75,.15,.025],[0,.48,fz+.045],.015);
 }else{
   const faces=grilleShapes(c);endPatch(m.black,faces.lower,n,-.004);endPatch(m.black,faces.upper,n,-.004);
   for(let i=0;i<6;i++){const yy=faces.gy-.16+i*.043;if(yy+.006>faces.top)continue;const width=faces.baseW*2-i*.035;endPatch(m.darkRim,[[-width/2,yy],[width/2,yy],[width/2,yy+.008],[-width/2,yy+.008]],n,-.001);}
   passengerLights(c,m);
   for(const vent of faces.vents)endPatch(m.black,vent,n,-.003);

 }
 for(const s of [-1,1])tube(m.seam,[[s*.65,c.fb+.03],[s*.62,c.front+.1],[s*.58,n-.2]].map(([x,z])=>[x,deckHeight(x,z)+.0015,warpZ(z,x,c)]),.0018);
 if(!boxTruck){
  if(truck){
   for(const s of [-1,1]){box(m.black,[.21,.45,.045],[s*.88,1.06,t-.012],.025);box(m.red,[.17,.39,.03],[s*.88,1.08,t-.041],.023);box(m.lamp,[.15,.05,.016],[s*.88,.98,t-.06],.006);}
   box(m.chrome,[c.W*.96,.17,.16],[0,.55,t-.04],.035);box(m.black,[.34,.08,.035],[0,1.28,t-.07],.012);
  }else{
   for(const s of [-1,1]){
    endPatch(m.red,[[s*.54,.31],[s*.74,.31],[s*.74,.33],[s*.54,.33]],t,.006);
    tube(m.seam,[[s*.69,c.rb-.1],[s*.67,t+.16]].map(([x,z])=>[x,deckHeight(x,z)+.0015,warpZ(z,x,c)]),.0018);
   }
   box(m.black,[c.W*.89,.12,.095],[0,.25,t+.015],.025);
   if(van){box(m.paint,[1.60,.07,.18],[0,c.roof-.045,c.rt-.04],.025);box(m.red,[.42,.025,.025],[0,c.roof-.05,c.rt-.135],.006);}
  }
 }
 // US-size plate texture; enough contrast to survive gameplay distance.
 const plateMat=createMassachusettsPlateMaterial(c.id==='box'?'B34 072':'4BK 026');
 const frontPlate=add(new T.PlaneGeometry(.305,.1524),plateMat);frontPlate.position.set(0,truck||boxTruck?.46:.40,fz+.10);
 if(boxTruck){const rear=add(new T.PlaneGeometry(.305,.1524),plateMat);rear.rotation.y=Math.PI;rear.position.set(0,.51,t-.09);box(m.black,[.34,.18,.028],[0,.51,t-.065],.009);}
 if(!boxTruck){const rear=add(new T.PlaneGeometry(.305,.1524),plateMat);rear.rotation.y=Math.PI;rear.position.set(0,truck?.53:van?.74:.54,t-.095);box(m.black,[.34,.18,.028],[0,rear.position.y,t-.07],.009);}
}

function wheels(c,m){
 const car=S.car,surfaces={rubber:m.rubber,trim:m.black,chrome:m.chrome};
 for(const [axle,z] of [c.front,c.rear].entries())for(const [side,s] of [-1,1].entries()){
  const pivot=new T.Group();pivot.name=`wheel-${axle*2+side}`;pivot.position.set(s*(c.W/2-.14),c.r,z);car.add(pivot);
  if(c.id!=='box'){
   for(const [surface,g] of createVehicleWheelGeometry(s)){g.scale(c.r/.34,c.r/.34,c.r/.34);add(g,surfaces[surface]||m.rim,pivot);}
   continue;
  }
  S.car=pivot;
  const dual=z===c.rear;
  for(let wheel=0;wheel<(dual?2:1);wheel++){
   const center=s*(c.W/2-.14-(dual?wheel*.25:0)),r=c.r,depth=c.id==='pickup'?.275:.225;
   const points=[[r*.69,-depth*.50],[r*.82,-depth*.55],[r*.95,-depth*.45],[r,-depth*.24],[r,depth*.24],[r*.95,depth*.45],[r*.82,depth*.55],[r*.69,depth*.50]].map(p=>new T.Vector2(...p));
   const tire=add(new T.LatheGeometry(points,48),m.rubber);tire.rotation.z=Math.PI/2;tire.position.set(center,r,z);
   const face=center+s*(depth*.55+.003);
   cyl(m.darkRim,r*.72,r*.72,.045,[face-s*.025,r,z],[0,0,Math.PI/2],40);
   const rim=add(new T.TorusGeometry(r*.71,.012,6,48),m.rim);rim.rotation.y=Math.PI/2;rim.position.set(face,r,z);
   const inner=add(new T.TorusGeometry(r*.63,.009,5,40),m.rim);inner.rotation.y=Math.PI/2;inner.position.set(face,r,z);
   cyl(m.rim,r*.16,r*.16,.045,[face,r,z],[0,0,Math.PI/2],20);
   const spokes=c.id==='sedan'?10:c.id==='box'?8:5;
   if(c.id==='box')cyl(m.white,r*.67,r*.67,.015,[face-s*.01,r,z],[0,0,Math.PI/2],40);
   for(let j=0;j<spokes;j++){
    const a=j/spokes*Math.PI*2;
    if(c.id==='box'){
      cyl(m.black,r*.11,r*.11,.017,[face+s*.002,r+Math.cos(a)*r*.47,z+Math.sin(a)*r*.47],[0,0,Math.PI/2],12);
    }else for(const offset of [-.037,.037]){
     tube(m.rim,[[face,r+Math.cos(a)*r*.15,z+Math.sin(a)*r*.15],[face-s*.015,r+Math.cos(a+offset+.1)*r*.69,z+Math.sin(a+offset+.1)*r*.69]],c.id==='pickup'?.022:.016);
    }
   }
   for(let j=0;j<5;j++){const a=j/5*Math.PI*2;cyl(m.darkRim,.008,.008,.014,[face+s*.027,r+Math.cos(a)*r*.105,z+Math.sin(a)*r*.105],[0,0,Math.PI/2],6);}
   for(const d of [-.055,.055]){const g=add(new T.TorusGeometry(r-.002,.003,3,60),m.black);g.rotation.y=Math.PI/2;g.position.set(center+d,r,z);}
   if(c.id==='pickup'||c.id==='box')for(let j=0;j<42;j++){
    const a=j/42*Math.PI*2;const block=box(m.rubber,[depth*.78,.011,.032],[center,r+Math.cos(a)*r,z+Math.sin(a)*r],.004);block.rotation.x=a;
   }
  }
  // Box-truck authoring above uses vehicle coordinates; keep the pair of rear
  // tires on one local axle pivot so both spin together.
  for(const mesh of pivot.children)mesh.position.sub(pivot.position);
  S.car=car;
 }
}
function cargo(c,m){
 const rear=-c.L/2,front=.42,cy=1.91,ww=c.W/2+.025;
 box(m.box,[ww*2,2.45,front-rear],[0,cy,(front+rear)/2],.025);
 for(const s of [-1,1]){
  for(const z of [rear+.035,front-.035])box(m.chrome,[.055,2.46,.055],[s*ww,cy,z],.008);
  for(const y of [.705,3.125])box(m.chrome,[.045,.06,front-rear],[s*(ww+.01),y,(front+rear)/2],.009);
  for(let z=rear+.2;z<front-.1;z+=.37)for(const y of [.79,1.40,2.02,2.65,3.035]){
   const rivet=add(new T.SphereGeometry(.008,5,4),m.chrome);rivet.position.set(s*(ww+.028),y,z);
  }
  for(let z=rear+.18;z<front-.15;z+=.40)box(m.red,[.012,.045,.17],[s*(ww+.032),.80,z],.003);
 }
 box(m.chrome,[2.08,.06,.06],[0,3.13,rear-.02],.009);
 box(m.chrome,[2.08,.06,.06],[0,.71,rear-.02],.009);
 box(m.white,[1.96,2.26,.025],[0,1.91,rear-.035],.009);
 for(let y=.87;y<3.0;y+=.16)box(m.chrome,[1.90,.011,.016],[0,y,rear-.055],.002);
 for(const s of [-1,1]){
  box(m.chrome,[.04,2.32,.035],[s*1.02,1.91,rear-.045],.005);
  box(m.black,[.16,.22,.06],[s*.82,.53,rear-.02],.015);
  cyl(m.red,.058,.058,.022,[s*.82,.55,rear-.06],[Math.PI/2,0,0]);
  box(m.black,[.65,.10,.17],[s*.58,.36,rear-.06],.015);
  for(const y of [.85,3.02])box(m.red,[.075,.035,.03],[s*.97,y,rear-.075],.005);
  box(m.amber,[.06,.035,.03],[s*1.01,3.05,front+.025],.008);
 }
 tube(m.chrome,[[0,.78,rear-.065],[0,1.03,rear-.065],[.20,1.03,rear-.065]],.013);
 box(m.black,[1.83,.13,.24],[0,.28,rear-.05],.015);
 // Chassis and rear mudflaps stay visible under the body.
 for(const s of [-1,1])box(m.rubber,[.43,.44,.04],[s*.93,.35,c.rear-.43],.008);
 box(m.black,[1.35,.22,3.1],[0,.52,-1.32],.02);
}

function roundBodywork(c){
 const w=c.W/2,nose=c.L/2,tail=-c.L/2,base=S.body.base;
 const frontHeight=sample(S.body.profile,nose)[1],rearHeight=sample(S.body.profile,tail)[1];
 const endRound=c.id==='pickup'?.16:c.id==='box'?.20:.22;
 const tailRound=c.id==='pickup'?.14:.20;
 const bell=(d,r)=>Math.exp(-((d/r)**2));
 const deform=p=>{
  let [x,y,z]=p;
  const front=bell(z-nose,.34),rear=c.id==='box'?0:bell(z-tail,.32);
  const corner=r=>{const q=T.MathUtils.clamp((Math.abs(x)-(w-r))/r,0,.985);return r*(1-Math.sqrt(1-q*q));};
  const capHeight=front>rear?frontHeight:rearHeight;
  const v=(y-base)/Math.max(.2,capHeight-base);
  const vertical=.043*T.MathUtils.smoothstep(v,.73,1.02)+.035*(1-T.MathUtils.smoothstep(v,0,.25));
  z-=front*(corner(endRound)+vertical)-rear*(corner(tailRound)+vertical);
  // Roll the roof perimeter into the screen and rear pillars. This transform
  // moves roof, glazing, frames, and trim together, preserving their fit.
  const upper=T.MathUtils.smoothstep(y,c.belt+.13,c.roof-.02);
  const frontRoof=bell(p[2]-(c.ft+.025),.15),rearRoof=bell(p[2]-(c.rt-.025),.15);
  const roofWidth=w*(c.id==='pickup'?.82:c.id==='box'?.87:.77);
  y-=upper*(.045*(frontRoof+rearRoof)+.018*T.MathUtils.smoothstep(Math.abs(x),roofWidth-.09,roofWidth+.02));
  z-=upper*.027*(frontRoof-rearRoof);x*=1-upper*.018*(frontRoof+rearRoof);
  return [x,y,z];
 };
 const mappedNormal=(p,n,d)=>{
  const e=.0001;
  const dx=deform([p[0]+e,p[1],p[2]]).map((v,i)=>(v-d[i])/e),dy=deform([p[0],p[1]+e,p[2]]).map((v,i)=>(v-d[i])/e),dz=deform([p[0],p[1],p[2]+e]).map((v,i)=>(v-d[i])/e);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],a=cross(dy,dz),b=cross(dz,dx),cc=cross(dx,dy);
  const out=a.map((v,i)=>n[0]*v+n[1]*b[i]+n[2]*cc[i]),len=Math.hypot(...out)||1;return out.map(v=>v/len);
 };
 for(const mesh of [...S.car.children]){
  if(!mesh.isMesh)continue;
  mesh.updateMatrix();const original=mesh.geometry,source=original.clone().applyMatrix4(mesh.matrix),flat=source.index?source.toNonIndexed():source;
  const pos=flat.attributes.position,normal=flat.attributes.normal,uv=flat.attributes.uv,positions=[],normals=[],uvs=[];
  const point=i=>({p:[pos.getX(i),pos.getY(i),pos.getZ(i)],n:[normal.getX(i),normal.getY(i),normal.getZ(i)],uv:uv?[uv.getX(i),uv.getY(i)]:null});
  const dist=(a,b)=>a.p.reduce((sum,v,i)=>sum+(v-b.p[i])**2,0);
  const mid=(a,b)=>({p:a.p.map((v,i)=>(v+b.p[i])/2),n:a.n.map((v,i)=>(v+b.n[i])/2),uv:uv?a.uv.map((v,i)=>(v+b.uv[i])/2):null});
  const tri=(a,b,c,depth=0)=>{
   const edges=[dist(a,b),dist(b,c),dist(c,a)],long=Math.max(...edges);
   const center=a.p.map((v,i)=>(v+b.p[i]+c.p[i])/3),nearEnd=Math.min(Math.abs(center[2]-nose),Math.abs(center[2]-tail))<.65,nearRoof=center[1]>S.body.c.belt+.13&&Math.min(Math.abs(center[2]-S.body.c.ft),Math.abs(center[2]-S.body.c.rt))<.30;
   const edge=(nearEnd&&Math.abs(center[0])>w-.35)||nearRoof?.08:.16;
   if(long>edge**2&&depth<11){const i=edges.indexOf(long);if(i===0){const q=mid(a,b);tri(a,q,c,depth+1);tri(q,b,c,depth+1);}else if(i===1){const q=mid(b,c);tri(a,b,q,depth+1);tri(a,q,c,depth+1);}else{const q=mid(c,a);tri(a,b,q,depth+1);tri(q,b,c,depth+1);}}
   else for(const v of [a,b,c]){const d=deform(v.p);positions.push(...d);normals.push(...mappedNormal(v.p,v.n,d));if(uv)uvs.push(...v.uv);}
  };
  for(let i=0;i<pos.count;i+=3)tri(point(i),point(i+1),point(i+2));
  const raw=new T.BufferGeometry();raw.setAttribute('position',new T.Float32BufferAttribute(positions,3));raw.setAttribute('normal',new T.Float32BufferAttribute(normals,3));if(uv)raw.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
  const smooth=mergeVertices(raw,.00001);mesh.geometry=smooth;
  mesh.position.set(0,0,0);mesh.rotation.set(0,0,0);mesh.scale.set(1,1,1);mesh.updateMatrix();
  original.dispose();source.dispose();if(flat!==source)flat.dispose();raw.dispose();
 }
}


export const sourceFleet=fleet;
export function createTrafficVehicleSource(index){
 const c=fleet[index];S.c=c;S.car=new T.Group();S.car.name=c.id;
 const m=materials('#ffffff');for(const [name,material] of Object.entries(m))material.name=name;
 const profile=body(c,m);cabin(c,m);details(c,m,profile);roundBodywork(c);wheels(c,m);if(c.id==='box')cargo(c,m);
 S.car.traverse(mesh=>{if(mesh.isMesh&&!mesh.material.name)mesh.material.name='registration';});
 return S.car;
}
