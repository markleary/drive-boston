import * as THREE from 'three';

export interface PedestrianAppearance {
  id:number; position:THREE.Vector3; yaw:number; height:number; width:number; speed:number;
  bag:boolean; scarf:boolean; outfit?:number;
  /** Full body orientation of a tumbling or lying actor; replaces `yaw` while set. */
  orientation?:THREE.Quaternion;
  /** 0..1 limp posture: arms flung out, legs splayed, eyes shut, as after a knock-down. */
  sprawl?:number;
}
type Point = [number,number,number];
type Section = [number,number,number]; // height, half width, half depth

/** Cloth sections carry UVs and welded seam normals, so grazing light reads
 * as a continuous garment instead of revealing the procedural ring boundary. */
function tailored(sections:Section[],segments=16){
  const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
  for(const [y,x,z] of sections)for(let j=0;j<=segments;j++){
    const angle=j/segments*Math.PI*2;positions.push(Math.sin(angle)*x,y,Math.cos(angle)*z);uvs.push(j/segments,y+.5);
  }
  for(let k=1;k<sections.length;k++)for(let j=0;j<segments;j++){
    const a=(k-1)*(segments+1)+j,b=a+segments+1;indices.push(a,a+1,b,b,a+1,b+1);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
  smoothSeam(geometry,segments+1);return geometry;
}
function smoothSeam(geometry:THREE.BufferGeometry,row:number){
  const normal=geometry.attributes.normal,v=new THREE.Vector3();
  for(let i=0;i<normal.count;i+=row){
    v.set(normal.getX(i)+normal.getX(i+row-1),normal.getY(i)+normal.getY(i+row-1),normal.getZ(i)+normal.getZ(i+row-1)).normalize();
    normal.setXYZ(i,v.x,v.y,v.z);normal.setXYZ(i+row-1,v.x,v.y,v.z);
  }
}
const headSections:Section[]=[[-.51,0,0],[-.48,.13,.20],[-.41,.27,.29],[-.29,.36,.35],[-.12,.42,.41],[.08,.45,.445],[.25,.44,.44],[.39,.36,.37],[.47,.22,.25],[.5,0,0]];
function headSection(y:number){
  let i=1;while(i<headSections.length-1&&headSections[i][0]<y)i++;
  const a=headSections[i-1],b=headSections[i],before=headSections[Math.max(0,i-2)],after=headSections[Math.min(headSections.length-1,i+1)];
  const span=b[0]-a[0],t=THREE.MathUtils.clamp((y-a[0])/span,0,1),t2=t*t,t3=t2*t;
  return [1,2].map(axis=>Math.max(0,(2*t3-3*t2+1)*a[axis]+(t3-2*t2+t)*span*(b[axis]-before[axis])/(b[0]-before[0])
    +(-2*t3+3*t2)*b[axis]+(t3-t2)*span*(after[axis]-a[axis])/(after[0]-a[0])));
}
const gaussian=(x:number,y:number,cx:number,cy:number,rx:number,ry:number)=>Math.exp(-(((x-cx)/rx)**2)-((y-cy)/ry)**2);
function headGeometry(rings=40,segments=48){
  const vertices:number[]=[],uvs:number[]=[],indices:number[]=[];
  for(let k=0;k<=rings;k++){
    const y=-.51+k/rings*1.01,[width,depth]=headSection(y);
    for(let j=0;j<=segments;j++){
      const angle=j/segments*Math.PI*2-Math.PI,x=Math.sin(angle)*width,front=Math.max(0,Math.cos(angle));
      let z=Math.cos(angle)*depth;
      // Brow ridge, recessed orbits, nasal bridge/tip, cheeks, lips and chin.
      // Features are part of the surface rather than loose decorative beads.
      z+=front**8*(
        .065*(gaussian(x,y,-.18,.20,.12,.075)+gaussian(x,y,.18,.20,.12,.075))
        -.048*(gaussian(x,y,-.18,.10,.105,.065)+gaussian(x,y,.18,.10,.105,.065))
        +.085*gaussian(x,y,0,.06,.060,.20)+.095*gaussian(x,y,0,-.065,.080,.065)
        +.035*(gaussian(x,y,-.085,-.105,.042,.035)+gaussian(x,y,.085,-.105,.042,.035))
        +.048*(gaussian(x,y,-.25,-.06,.10,.12)+gaussian(x,y,.25,-.06,.10,.12))
        +.037*gaussian(x,y,0,-.235,.15,.043)+.050*gaussian(x,y,0,-.385,.17,.07));
      vertices.push(x,y,z);uvs.push(j/segments,(y+.51)/1.01);
    }
  }
  for(let k=1;k<=rings;k++)for(let j=0;j<segments;j++){
    const a=(k-1)*(segments+1)+j,b=a+segments+1;indices.push(a,a+1,b,b,a+1,b+1);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();smoothSeam(geometry,segments+1);return geometry;
}
/** A neutral complexion atlas multiplies each actor's skin color. Shadows and
 * small color changes supply eyelids, brows, nostrils and lips without decals. */
function faceTexture(){
  const size=256,data=new Uint8Array(size*size*4);
  for(let row=0;row<size;row++)for(let col=0;col<size;col++){
    const y=(row+.5)/size*1.01-.51,angle=((col+.5)/size)*Math.PI*2-Math.PI,[width]=headSection(y);
    const x=Math.sin(angle)*width,front=Math.max(0,Math.cos(angle))**12;
    const socket=gaussian(x,y,-.18,.10,.13,.09)+gaussian(x,y,.18,.10,.13,.09);
    const cheeks=gaussian(x,y,-.25,-.08,.11,.12)+gaussian(x,y,.25,-.08,.11,.12);
    const nostril=gaussian(x,y,-.065,-.117,.023,.014)+gaussian(x,y,.065,-.117,.023,.014);
    const browY=.205-.20*Math.max(0,Math.abs(x)-.14);
    const brows=Math.exp(-(((Math.abs(x)-.18)/.105)**6)-((y-browY)/.014)**2);
    const lipLine=-.236+.024*(Math.abs(x)/.15)**2;
    const lips=Math.exp(-((x/.145)**6)-((y-lipLine)/.022)**2);
    const mouth=Math.exp(-((x/.128)**6)-((y-lipLine+.004)/.0045)**2);
    const noise=((Math.imul(col+row*size,374761393)>>>20)%31)/31-.5;
    const base=.985-front*(socket*.08+nostril*.48+brows*.58+mouth*.28)+noise*.004;
    const offset=(row*size+col)*4;
    data[offset]=Math.round(255*Math.max(0,base-front*lips*.12));
    data[offset+1]=Math.round(255*Math.max(0,base-front*(cheeks*.045+lips*.29)));
    data[offset+2]=Math.round(255*Math.max(0,base-front*(cheeks*.055+lips*.27)));data[offset+3]=255;
  }
  const texture=new THREE.DataTexture(data,size,size);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}
function fabricTexture(){
  const size=64,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const noise=((Math.imul(x+y*size,1597334677)>>>18)%23)/23;
    const weave=((x%4<2)===(y%4<2)?1:0),value=224+Math.round(weave*15+noise*15),offset=(y*size+x)*4;
    data[offset]=data[offset+1]=data[offset+2]=value;data[offset+3]=255;
  }
  const texture=new THREE.DataTexture(data,size,size);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(12,10);texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}
function hairGeometry(style:number){
  const positions:number[]=[],uvs:number[]=[],indices:number[]=[],rings=14,segments=32;
  for(let k=0;k<=rings;k++)for(let j=0;j<=segments;j++){
    const angle=j/segments*Math.PI*2-Math.PI,front=Math.max(0,Math.cos(angle));
    const hairline=.25+.06*front-.40*Math.max(0,-Math.cos(angle))-.20*Math.abs(Math.sin(angle))-(style===1?.04*Math.sin(angle+.6):0);
    const y=THREE.MathUtils.lerp(.515,hairline,k/rings),[width,depth]=headSection(Math.min(.499,y));
    const volume=style===1?.035+.06*Math.max(0,-Math.sin(angle))*(1-k/rings):style===2?.04:.025;
    const strand=.004*Math.sin(angle*39+y*16)+.003*Math.sin(angle*71-y*23);
    positions.push((k===0?0:Math.sin(angle)*(width+volume+strand)),y+(style===1?.045:.01)*(1-k/rings),(k===0?0:Math.cos(angle)*(depth+volume+strand)));uvs.push(j/segments,k/rings);
  }
  for(let k=1;k<=rings;k++)for(let j=0;j<segments;j++){
    const a=(k-1)*(segments+1)+j,b=a+segments+1;indices.push(a,b,a+1,b,b+1,a+1);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();smoothSeam(geometry,segments+1);return geometry;
}
function hairTexture(){
  const width=256,height=64,data=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const strand=Math.sin(x*2.37+Math.sin(y*.08+x*.05)*.7),value=205+Math.round(strand*20+Math.sin(x*6.31+y*.04)*12),i=(y*width+x)*4;
    data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
  }
  const texture=new THREE.DataTexture(data,width,height);texture.wrapS=THREE.RepeatWrapping;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}
const coats=[0x354753,0x80634d,0x4f5547,0x3f4245,0x7b403b,0xa29379,0x42656a,0x5d4d61];
const trousers=[0x343b40,0x283b4c,0x4c4940,0x5c5b53];
const skins=[0xb28165,0xd6a789,0x8f624b,0x654636,0xc39976,0xe0b69a];
const hairs=[0x302b26,0x544231,0x837059,0x29282a,0x8e8b80];

/** Shared instanced parts keep the entire sidewalk population at a fixed draw
 * count. Appearance and posing are independent of sidewalk routing. */
export function createPedestrianModel(group:THREE.Group,people:PedestrianAppearance[],materials:Set<THREE.Material>){
  const count=people.length,batches:THREE.InstancedMesh[]=[];
  function batch(name:string,geometry:THREE.BufferGeometry,multiplier=1,roughness=.9,capacity=count*multiplier){
    const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness});materials.add(material);
    const mesh=new THREE.InstancedMesh(geometry,material,capacity);mesh.name=name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;
    group.add(mesh);batches.push(mesh);return mesh;
  }
  const sphere=new THREE.SphereGeometry(.5,10,8);
  const torso=batch('Tailored jackets',tailored([[-.5,0,0],[-.5,.46,.51],[-.25,.44,.48],[.05,.47,.49],[.27,.51,.47],[.40,.45,.39],[.49,.22,.26],[.50,0,0]],16));
  const pelvis=batch('Trouser hips',tailored([[-.5,0,0],[-.47,.42,.40],[0,.50,.48],[.45,.47,.44],[.5,0,0]]));
  // One tube spans each whole limb. The vertex shader bends its sections
  // around the elbow/knee, keeping the fabric continuous at the joint. The
  // same deformation is installed on depth/distance passes for matching shadows.
  function articulated(name:string,sections:Section[]){
    const mesh=batch(name,tailored(sections),2);
    for(const attribute of ['limbStart','limbJoint','limbEnd'])mesh.geometry.setAttribute(attribute,new THREE.InstancedBufferAttribute(new Float32Array(count*2*3),3).setUsage(THREE.DynamicDrawUsage));
    const declarations=`
      attribute vec3 limbStart;
      attribute vec3 limbJoint;
      attribute vec3 limbEnd;
      mat3 limbFrame(float t) {
        vec3 lower=normalize(limbJoint-limbStart),upper=normalize(limbEnd-limbJoint);
        vec3 up=normalize(mix(lower,upper,smoothstep(.36,.64,t)));
        vec3 right=normalize(cross(up,vec3(0.,0.,1.)));
        return mat3(right,up,cross(right,up));
      }
    `;
    const deform=(shader:THREE.WebGLProgramParametersWithUniforms)=>{
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+declarations)
        .replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nobjectNormal = limbFrame(position.y+.5) * objectNormal;')
        .replace('#include <begin_vertex>',`float limbT = position.y+.5;
          vec3 limbCenter = limbT < .5 ? mix(limbStart,limbJoint,limbT*2.) : mix(limbJoint,limbEnd,(limbT-.5)*2.);
          vec3 transformed = limbCenter + limbFrame(limbT) * vec3(position.x,0.,position.z);`);
    };
    const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}),distance=new THREE.MeshDistanceMaterial();
    for(const material of [mesh.material as THREE.Material,depth,distance]){
      material.onBeforeCompile=deform;material.customProgramCacheKey=()=>'continuous-pedestrian-limb-v1';materials.add(material);
    }
    mesh.customDepthMaterial=depth;mesh.customDistanceMaterial=distance;
    // GTAO's global normal override cannot reproduce per-instance bending.
    // Omit these tubes from that buffer to avoid an unposed ghost silhouette.
    mesh.userData.noAO=true;return mesh;
  }
  const arms=articulated('Continuous jacket sleeves',[[-.5,0,0],[-.5,.044,.043],[-.36,.048,.047],[-.16,.054,.053],[0,.057,.056],[.16,.065,.064],[.32,.074,.070],[.44,.067,.064],[.5,.045,.044],[.5,0,0]]);
  const legs=articulated('Continuous trousers',[[-.5,0,0],[-.5,.045,.050],[-.33,.051,.057],[-.17,.059,.065],[0,.062,.068],[.16,.070,.078],[.33,.083,.089],[.42,.083,.087],[.5,0,0]]);
  const heads=batch('Faces',headGeometry(),1,.82),distantHeads=batch('Distant faces',headGeometry(14,20),1,.82);
  let nearHeadCount=0,farHeadCount=0;
  const skin=batch('Necks hands and ears',sphere,5,.82);
  const hair=['Short cropped hair','Side parted hair','Fuller hair'].map((name,style)=>batch(name,hairGeometry(style),1,.78,people.filter((_,i)=>i%3===style).length));
  const longHair=batch('Long hairstyles',sphere);
  // Rounded shoes retain a flat outsole, with a higher heel and a tapered toe.
  const shoeGeometry=new THREE.SphereGeometry(.5,12,8),shoePositions=shoeGeometry.attributes.position;
  for(let i=0;i<shoePositions.count;i++){
    const x=shoePositions.getX(i),y=shoePositions.getY(i),z=shoePositions.getZ(i);
    shoePositions.setXYZ(i,x*(z>0?.92:1),Math.max(-.32,y)*(z>0?.85:1),z);
  }
  shoeGeometry.computeVertexNormals();
  const shoes=batch('Shoes',shoeGeometry,2,.72),soles=batch('Shoe soles',shoeGeometry,2);
  // Cache the actual outsole support height across the small foot-roll range.
  // Interpolation avoids a vertex scan per actor per frame and keeps the stance
  // sole on the ground even though the shoe is rounded rather than a box.
  const contact=new Float32Array(257);
  for(let k=0;k<contact.length;k++){
    const angle=k/256*.5-.35;let bottom=Infinity;
    for(let j=0;j<shoePositions.count;j++)bottom=Math.min(bottom,shoePositions.getY(j)*.028*Math.cos(angle)-shoePositions.getZ(j)*.26*Math.sin(angle));
    contact[k]=.031-bottom;
  }
  const strapPath=new THREE.CatmullRomCurve3([[0,1.05,.125],[0,1.18,.138],[0,1.30,.112],[0,1.35,.06],[0,1.32,-.105],[0,1.15,-.18]].map(p=>new THREE.Vector3(...p)));
  const bags=batch('Backpacks',sphere),straps=batch('Backpack straps',new THREE.TubeGeometry(strapPath,16,.011,5,false),2);
  const scarves=batch('Scarves',tailored([[-.5,0,0],[-.48,.46,.44],[.35,.5,.48],[.5,.43,.4]]));
  const collar=batch('Shirts and collars',tailored([[-.5,0,0],[-.49,.5,.46],[.4,.45,.41],[.5,0,0]]));
  const coatHem=batch('Skirts',tailored([[-.5,0,0],[-.49,.5,.48],[.30,.43,.42],[.5,.40,.40]]));
  const eyeWhites=batch('Eyes',new THREE.SphereGeometry(.5,10,6),2,.5),irises=batch('Irises',new THREE.CircleGeometry(.5,12),2,.65);
  eyeWhites.castShadow=irises.castShadow=false;
  const seamPath=new THREE.CatmullRomCurve3([[0,-.44,.509],[0,-.24,.487],[0,.05,.497],[0,.26,.481],[0,.40,.402]].map(p=>new THREE.Vector3(...p)));
  const seams=batch('Jacket seams',new THREE.TubeGeometry(seamPath,20,.004,4,false));seams.castShadow=false;
  const pockets=batch('Pocket welts',new THREE.BoxGeometry(1,1,1),2);pockets.castShadow=false;
  const cloth=fabricTexture(),face=faceTexture(),strands=hairTexture();
  for(const mesh of [torso,pelvis,arms,legs,coatHem,pockets]){
    const material=mesh.material as THREE.MeshStandardMaterial;material.map=cloth;material.bumpMap=cloth;material.bumpScale=.00065;
  }
  for(const mesh of [heads,distantHeads])(mesh.material as THREE.MeshStandardMaterial).map=face;
  for(const mesh of [...hair,longHair]){const material=mesh.material as THREE.MeshStandardMaterial;material.map=strands;material.bumpMap=strands;material.bumpScale=.0004;material.roughness=.78;}
  const color=new THREE.Color();
  function tint(mesh:THREE.InstancedMesh,index:number,value:number){mesh.setColorAt(index,color.setHex(value));}
  people.forEach((person,i)=>{
    const coat=coats[i%coats.length],pants=trousers[(i*3)%trousers.length],complexion=skins[i%skins.length],hairstyle=hairs[i%hairs.length];
    tint(torso,i,coat);tint(pelvis,i,pants);tint(heads,i,complexion);tint(hair[i%3],Math.floor(i/3),hairstyle);tint(longHair,i,hairstyle);
    tint(collar,i,[0xd3d2c5,0x9daeb2,0x383a42][i%3]);tint(coatHem,i,person.outfit===1?pants:coat);
    tint(bags,i,i%2?0x574538:0x273638);tint(scarves,i,i%2?0x8b6e4d:0x4d6770);
    tint(seams,i,color.setHex(coat).multiplyScalar(.65).getHex());
    for(let j=0;j<2;j++){
      tint(arms,i*2+j,coat);tint(legs,i*2+j,pants);
      tint(shoes,i*2+j,i%3===0?0x645248:0x252b2e);tint(soles,i*2+j,i%3?0x777971:0x282b29);tint(straps,i*2+j,0x373c3a);tint(eyeWhites,i*2+j,0xa6a096);tint(irises,i*2+j,[0x3f3329,0x4b5955,0x5c5141,0x303434][i%4]);
      tint(pockets,i*2+j,color.setHex(coat).multiplyScalar(.78).getHex());
    }
    for(let j=0;j<5;j++)tint(skin,i*5+j,complexion);
  });
  const actor=new THREE.Matrix4(),local=new THREE.Matrix4(),world=new THREE.Matrix4();
  const position=new THREE.Vector3(),scale=new THREE.Vector3(),rotation=new THREE.Quaternion(),euler=new THREE.Euler();
  const blend=new Float32Array(count).fill(1),visualTime=new Float32Array(count);
  function place(mesh:THREE.InstancedMesh,index:number,p:Point,s:Point,rx=0,ry=0,rz=0){
    rotation.setFromEuler(euler.set(rx,ry,rz));local.compose(position.set(...p),rotation,scale.set(...s));world.multiplyMatrices(actor,local);mesh.setMatrixAt(index,world);
  }
  function limb(mesh:THREE.InstancedMesh,index:number,a:Point,b:Point,c:Point){
    mesh.setMatrixAt(index,actor);
    (mesh.geometry.getAttribute('limbStart') as THREE.InstancedBufferAttribute).setXYZ(index,...a);
    (mesh.geometry.getAttribute('limbJoint') as THREE.InstancedBufferAttribute).setXYZ(index,...b);
    (mesh.geometry.getAttribute('limbEnd') as THREE.InstancedBufferAttribute).setXYZ(index,...c);
  }
  function lerpContact(index:number,t:number){return THREE.MathUtils.lerp(contact[index],contact[Math.min(index+1,256)],t);}
  function pose(i:number,person:PedestrianAppearance,distance:number,walking:number,dt:number,detailed=true){
    if(i===0){nearHeadCount=0;farHeadCount=0;}
    blend[i]=THREE.MathUtils.damp(blend[i],walking,10,Math.max(0,Math.min(.1,dt)));
    const amount=blend[i],stride=1.12,cycle=distance/(stride*person.height),gait=cycle*Math.PI*2;
    const bob=Math.cos((cycle-.31)*Math.PI*4)*.020*amount+(1-amount)*.045,sway=Math.sin(gait)*.012*amount;
    const sprawl=THREE.MathUtils.clamp(person.sprawl??0,0,1);
    if(person.orientation)rotation.copy(person.orientation);else rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,person.yaw);
    actor.compose(person.position,rotation,scale.set(person.width*person.height,person.height,person.height));
    const hipY=.895+bob,bodyY=1.14+bob,twist=Math.sin(gait)*.035*amount;
    const longCoat=person.outfit===3,build=.94+(i%7)*.018;
    place(torso,i,[sway,bodyY-(longCoat?.055:0),.012],[.425*build,longCoat?.70:.59,.285*(.97+i%3*.03)],.025*amount,twist,-sway*.6);
    place(pelvis,i,[sway,hipY+.015,0],[.32,.22,.245],0,-twist);
    place(collar,i,[sway,1.442+bob,.006],[.122,.033,.112],0,twist);
    place(seams,i,[sway,bodyY-(longCoat?.055:0),.012],[.425*build,longCoat?.70:.59,.285*(.97+i%3*.03)],.025*amount,twist,-sway*.6);
    const headY=1.623+bob,headTurn=THREE.MathUtils.lerp(Math.sin(distance*.29+i*1.7)*.085,(i%2?.42:-.42),sprawl);
    const faceWidth=.176*(.96+(i%5)*.02),headSize:Point=[faceWidth,.232,.202];
    const headMesh=detailed?heads:distantHeads,headIndex=detailed?nearHeadCount++:farHeadCount++;
    place(headMesh,headIndex,[sway,headY,.014],headSize,0,headTurn);tint(headMesh,headIndex,skins[i%skins.length]);
    place(skin,i*5,[sway,1.478+bob,.006],[.108,.135,.10]);
    place(hair[i%3],Math.floor(i/3),[sway,headY,.014],headSize,0,headTurn);
    place(longHair,i,[sway,1.532+bob,-.062],i%4===1?[.177,.24,.12]:[0,0,0],0,headTurn);
    place(bags,i,[sway,1.17+bob,-.165],person.bag?[.255,.35,.15]:[0,0,0],.06);
    place(scarves,i,[sway,1.463+bob,.008],person.scarf?[.143,.055,.13]:[0,0,0]);
    place(coatHem,i,[sway,.79+bob,.005],person.outfit===1?[.37,.30,.225]:[0,0,0],0,twist);
    visualTime[i]+=Math.max(0,dt);
    const blinkPhase=(visualTime[i]+i*.71)%(3.7+(i%5)*.43),blink=(blinkPhase<.16?1-.94*Math.sin(blinkPhase/.16*Math.PI):1)*(1-sprawl*.9);
    for(let sideIndex=0;sideIndex<2;sideIndex++){
      const side=sideIndex===0?-1:1,index=i*2+sideIndex;
      const step=((cycle+sideIndex*.5)%1+1)%1,stance=.62,extent=stride*stance*.5;
      let footZ:number,lift=0,pitch=0;
      if(step<stance){footZ=extent-stride*step;pitch=.10*(1-step/stance)-.12*Math.pow(step/stance,5);}
      else{
        const t=(step-stance)/(1-stance),smooth=t*t*(3-2*t);
        // Hermite endpoints match stance velocity, so the foot eases through
        // toe-off and heel strike without the sinusoidal treadmill slide.
        footZ=-extent+2*extent*smooth-stride*(1-stance)*(2*t*t*t-3*t*t+t);
        lift=Math.pow(Math.sin(t*Math.PI),1.5)*.075;pitch=-Math.sin(t*Math.PI)*.28;
      }
      footZ*=amount;lift*=amount;pitch*=amount;
      const contactIndex=THREE.MathUtils.clamp((pitch+.35)/.5*256,0,256),lower=Math.floor(contactIndex);
      // A limp body splays its legs: one knee drawn up, the other leg trailing.
      const footX=THREE.MathUtils.lerp(side*.09,side*.27,sprawl),shoeY=THREE.MathUtils.lerp(lerpContact(lower,contactIndex-lower)+lift,.06+sideIndex*.1,sprawl);
      footZ=THREE.MathUtils.lerp(footZ,sideIndex?.28:-.22,sprawl);
      const hip:Point=[side*.088+sway,hipY,0],ankle:Point=[footX,shoeY+.045,footZ-.015];
      const dy=ankle[1]-hip[1],dz=ankle[2]-hip[2],length=Math.hypot(dy,dz),bone=.430;
      const bend=Math.sqrt(Math.max(0,bone*bone-length*length*.25));
      const knee:Point=[side*.092+sway*.4,hip[1]+dy*.5+dz/length*bend,dz*.5-dy/length*bend];
      limb(legs,index,ankle,knee,hip);
      place(shoes,index,[footX,shoeY,footZ+.043],[.117,.105,.255],pitch);
      place(soles,index,[footX,shoeY-.031,footZ+.043],[.12,.028,.26],pitch);
      const phase=gait+sideIndex*Math.PI,armSwing=-Math.cos(phase)*(.24+(i%4)*.015)*amount;
      const shoulder:Point=[side*.181*build+sway,1.366+bob,.005];
      const elbow:Point=[side*.222+sway,shoulder[1]-Math.cos(armSwing)*.277,.005+Math.sin(armSwing)*.277];
      const elbowBend=.18+.12*(.5+.5*Math.sin(phase+.7))*amount;
      const hand:Point=[side*.216+sway,elbow[1]-Math.cos(armSwing+elbowBend)*.254,elbow[2]+Math.sin(armSwing+elbowBend)*.254];
      if(sprawl>0){
        // Arms flung outward and slightly up, as a body thrown off balance.
        const flungElbow:Point=[side*.44+sway,1.33+sideIndex*.05,.09-sideIndex*.12],flungHand:Point=[side*.66+sway,1.27+sideIndex*.12,.2-sideIndex*.3];
        for(let axis=0;axis<3;axis++){elbow[axis]=THREE.MathUtils.lerp(elbow[axis],flungElbow[axis],sprawl);hand[axis]=THREE.MathUtils.lerp(hand[axis],flungHand[axis],sprawl);}
      }
      limb(arms,index,hand,elbow,shoulder);
      place(skin,i*5+1+sideIndex,[hand[0],hand[1]-.024,hand[2]+.005],[.060,.108,.038],armSwing+elbowBend);
      place(skin,i*5+3+sideIndex,[side*.079+sway,headY-.008,.008],[.024,.046,.030],0,headTurn);
      const faceX=side*.18*faceWidth,faceZ=.080;
      const eyeX=sway+faceX*Math.cos(headTurn)+faceZ*Math.sin(headTurn),eyeZ=.014+faceZ*Math.cos(headTurn)-faceX*Math.sin(headTurn);
      place(eyeWhites,index,[eyeX,headY+.023,eyeZ],[.023,.0065*blink,.007],0,headTurn,side*.045);
      place(irises,index,[eyeX+Math.sin(headTurn)*.004,headY+.023,eyeZ+Math.cos(headTurn)*.004],[.009,.006*blink,1],0,headTurn);
      place(pockets,index,[side*.107+sway,1.03+bob,.115],person.outfit===1?[0,0,0]:[.070,.006,.005],0,twist,side*.10);
      place(straps,index,[side*.106+sway,bob+.065,-.012],person.bag?[1,1,1]:[0,0,0]);
    }
  }
  return {pose,dispose(){
    for(const mesh of batches){const material=mesh.material as THREE.MeshStandardMaterial;material.map=null;material.bumpMap=null;}
    cloth.dispose();face.dispose();strands.dispose();
  },flush(){heads.count=nearHeadCount;distantHeads.count=farHeadCount;
    for(const mesh of [heads,distantHeads])if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    for(const mesh of batches)mesh.instanceMatrix.needsUpdate=true;
    for(const mesh of [arms,legs])for(const attribute of ['limbStart','limbJoint','limbEnd'])mesh.geometry.getAttribute(attribute).needsUpdate=true;
  }};
}
