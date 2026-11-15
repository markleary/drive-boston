import * as THREE from 'three';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import type {VehicleSurface} from './car.ts';
import type {Parts,P} from './sports-car-shapes.ts';
import type {TeslaSurfaces} from './tesla-body.ts';
type Q=[number,number];
type Project=(u:number,v:number,offset?:number)=>P;
function orientOutward(geometry:THREE.BufferGeometry){
  const position=geometry.attributes.position,normals=geometry.attributes.normal,index=geometry.index;
  let facing=0;
  for(let i=0;i<position.count;i++)facing+=normals.getX(i)*position.getX(i)+normals.getY(i)*(position.getY(i)+.25)+normals.getZ(i)*position.getZ(i);
  if(facing<0&&index){for(let i=0;i<index.count;i+=3){const b=index.getX(i+1);index.setX(i+1,index.getX(i+2));index.setX(i+2,b);}geometry.computeVertexNormals();}
}

/** Project filled, rounded lens/trim outlines onto the actual body. The result
 * has real surface area, rather than the thick pipe outlines of the first mesh. */
function patch(p:Parts,material:VehicleSurface,shape:THREE.Shape,project:Project,offset=.004,curveTolerance=Infinity,projectNormals=false){
  const points=shape.getPoints(8),faces=THREE.ShapeUtils.triangulateShape(points,[]),vertices:number[]=[],indices:number[]=[],parameters:number[]=[];
  // Long triangles would slice through rounded bumper paint. Adaptive
  // subdivision fits the lens face to the panel, not just its outer edge.
  const triangle=(a:THREE.Vector2,b:THREE.Vector2,c:THREE.Vector2,depth=0)=>{
    const lengths=[a.distanceToSquared(b),b.distanceToSquared(c),c.distanceToSquared(a)],longest=Math.max(...lengths);
    let edge=longest>.055**2&&depth<6?lengths.indexOf(longest):-1;
    if(edge<0&&Number.isFinite(curveTolerance)&&depth<10){
      const points=[a,b,c],mapped=points.map(point=>project(point.x,point.y,offset));
      const errors=points.map((point,i)=>{
        const next=points[(i+1)%3],mid=project((point.x+next.x)/2,(point.y+next.y)/2,offset);
        return Math.hypot(...mid.map((value,axis)=>value-(mapped[i][axis]+mapped[(i+1)%3][axis])/2));
      });
      const worst=Math.max(...errors);if(worst>curveTolerance)edge=errors.indexOf(worst);
    }
    if(edge>=0){
      if(edge===0){const m=a.clone().add(b).multiplyScalar(.5);triangle(a,m,c,depth+1);triangle(m,b,c,depth+1);}
      else if(edge===1){const m=b.clone().add(c).multiplyScalar(.5);triangle(a,b,m,depth+1);triangle(a,m,c,depth+1);}
      else{const m=c.clone().add(a).multiplyScalar(.5);triangle(a,b,m,depth+1);triangle(m,b,c,depth+1);}return;
    }
    const start=vertices.length/3;for(const point of [a,b,c]){vertices.push(...project(point.x,point.y,offset));if(projectNormals)parameters.push(point.x,point.y);}indices.push(start,start+1,start+2);
  };
  for(const face of faces)triangle(points[face[0]],points[face[1]],points[face[2]]);
  const source=new THREE.BufferGeometry();source.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));source.setIndex(indices);
  if(projectNormals)source.setAttribute('parameter',new THREE.Float32BufferAttribute(parameters,2));
  // Share the subdivision vertices before averaging normals. Independent
  // triangle normals otherwise turn glossy lenses into a faceted patchwork.
  const geometry=mergeVertices(source,.00001);source.dispose();geometry.computeVertexNormals();
  orientOutward(geometry);
  if(projectNormals){
    // The steep rear shoulder needs one continuous normal field independent
    // of the adaptive triangles. Edge T-junctions otherwise leave alternating
    // glossy streaks despite the lens sitting entirely outside the paint.
    const coordinates=geometry.attributes.parameter,normals=geometry.attributes.normal,positions=geometry.attributes.position,e=.003;
    for(let i=0;i<coordinates.count;i++){
      const u=coordinates.getX(i),v=coordinates.getY(i),left=project(u-e,v,offset),right=project(u+e,v,offset),down=project(u,v-e,offset),up=project(u,v+e,offset);
      const du=new THREE.Vector3(right[0]-left[0],right[1]-left[1],right[2]-left[2]),dv=new THREE.Vector3(up[0]-down[0],up[1]-down[1],up[2]-down[2]),normal=du.cross(dv).normalize();
      if(normal.x*positions.getX(i)+normal.y*(positions.getY(i)+.25)+normal.z*positions.getZ(i)<0)normal.negate();
      normals.setXYZ(i,normal.x,normal.y,normal.z);
    }
    geometry.deleteAttribute('parameter');
  }
  p.add(material,geometry);
}
function rounded(points:Q[],radius=.16){
  const shape=new THREE.Shape(),count=points.length;
  const between=(a:Q,b:Q,t:number):Q=>[THREE.MathUtils.lerp(a[0],b[0],t),THREE.MathUtils.lerp(a[1],b[1],t)];
  const first=between(points[count-1],points[0],1-radius);shape.moveTo(...first);
  for(let i=0;i<count;i++){
    const a=points[i],next=points[(i+1)%count];shape.quadraticCurveTo(a[0],a[1],...between(a,next,radius));
    shape.lineTo(...between(a,next,1-radius));
  }
  shape.closePath();return shape;
}
function line(p:Parts,material:VehicleSurface,points:Q[],project:Project,radius=.002,offset=.005,steps=40){
  ribbon(p,material,points,radius*2,project,offset,steps);
}
/** A flat luminous ribbon with smoothly changing width, retaining sharp LED
 * inner/outer edges while following the original lamp's rounded corners. */
function ribbon(p:Parts,material:VehicleSurface,points:Q[],width:number,project:Project,offset=.009,steps=64){
  const curve=new THREE.CatmullRomCurve3(points.map(([x,y])=>new THREE.Vector3(x,y,0)),false,'centripetal');
  const vertices:number[]=[],indices:number[]=[];
  for(let i=0;i<=steps;i++){
    const t=i/steps,c=curve.getPoint(t),tangent=curve.getTangent(t),half=width*.5*(.45+.55*Math.sin(Math.PI*Math.min(.5,Math.min(t,1-t)*6)));
    for(const sign of [-1,1])vertices.push(...project(c.x-tangent.y*half*sign,c.y+tangent.x*half*sign,offset));
  }
  for(let i=0;i<steps;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();orientOutward(geometry);p.add(material,geometry);
}
const offsetPoint=(point:P,axis:0|1|2,offset:number):P=>{const next:[number,number,number]=[...point];next[axis]+=offset;return next;};

/** 2025 Highland Performance details traced from the supplied reference views:
 * swept projector housings, flat LED guides, inset air curtains and a small
 * integrated carbon lip rather than separate bars attached to the body. */
export function addTeslaDetails(p:Parts,s:TeslaSurfaces){
  const cached=(project:Project):Project=>{const cache=new Map<string,P>();return(u,v,o=.004)=>{const key=`${u},${v},${o}`;let point=cache.get(key);if(!point){point=project(u,v,o);cache.set(key,point);}return point;};};
  const rear=cached((x,y,o=.004)=>offsetPoint(s.rear(x,y),2,-o));
  const front=cached((x,y,o=.004)=>offsetPoint(s.front(x,y),2,o));
  const hood=cached((x,z,o=.004)=>offsetPoint(s.hood(x,z),1,o));
  // A temporary contour table avoids a costly surface solve at every lamp
  // vertex. Interpolation selects z; the final vertex still samples the body.
  const lampX0=.42,lampX1=.89,lampZ0=1.55,lampZ1=2.20,lampColumns=32,lampRows=48;
  const lampHeights=Array.from({length:lampColumns+1},(_,column)=>Array.from({length:lampRows+1},(_,row)=>s.hood(THREE.MathUtils.lerp(lampX0,lampX1,column/lampColumns),THREE.MathUtils.lerp(lampZ0,lampZ1,row/lampRows))[1]));
  const lampContour=(x:number,y:number)=>{
    const column=THREE.MathUtils.clamp((x-lampX0)/(lampX1-lampX0)*lampColumns,0,lampColumns),left=Math.min(lampColumns-1,Math.floor(column));
    const solve=(values:number[])=>{
      let low=0,high=lampRows;
      while(high-low>1){const mid=(low+high)>>1;if(values[mid]>y)low=mid;else high=mid;}
      const t=THREE.MathUtils.clamp((values[low]-y)/(values[low]-values[high]),0,1);
      return THREE.MathUtils.lerp(lampZ0,lampZ1,(low+t)/lampRows);
    };
    return THREE.MathUtils.lerp(solve(lampHeights[left]),solve(lampHeights[left+1]),column-left);
  };

  for(const sign of [-1,1]){
    // Parameterize the lamps by elevation, then find their exact location on
    // the swept hood. This keeps the lower guide almost horizontal in front
    // view instead of accidentally tracing the much steeper fender crown.
    const lampHood=cached((x,y,o=.004)=>hood(sign*x,lampContour(x,y),o));
    const lens=rounded([[.439,.165],[.640,.207],[.867,.239],[.864,.207],[.814,.166],[.728,.156],[.505,.157]],.11);
    patch(p,'trim',lens,lampHood,.004);
    const inner=rounded([[.463,.166],[.644,.202],[.855,.231],[.851,.207],[.809,.171],[.725,.162],[.511,.163]],.12);
    patch(p,'glass',inner,lampHood,.006);
    ribbon(p,'headlight',[[.470,.165],[.588,.164],[.686,.164],[.712,.167],[.732,.163],[.802,.172],[.835,.193],[.857,.228]],.0036,lampHood,.009,54);
    // Projector chambers and subtle metallic dividers are visible under glass.
    for(const [x,y] of [[.573,.183],[.665,.191],[.758,.200]]){
      const projector=rounded([[x-.025,y-.007],[x+.025,y-.005],[x+.025,y+.008],[x-.025,y+.008]],.24);
      patch(p,'trim',projector,lampHood,.007);
      line(p,'chrome',[[x-.018,y-.003],[x+.019,y-.002]],lampHood,.0007,.008,6);
    }

    // Outboard air curtain is a pointed, smoothly curved cutout, not a block.
    const curtain=rounded([[.724,-.105],[.867,-.065],[.848,-.345],[.794,-.390],[.747,-.358]],.16);
    patch(p,'trim',curtain,(x,y,o)=>front(sign*x,y,o),.006);
    const curtainInner=rounded([[.747,-.127],[.845,-.096],[.828,-.335],[.794,-.359],[.766,-.341]],.18);
    patch(p,'rubber',curtainInner,(x,y,o)=>front(sign*x,y,o),.008);
    line(p,'paint',[[.717,-.105],[.739,-.294],[.772,-.370],[.807,-.389]],(x,y,o)=>front(sign*x,y,o),.008,.006,24);

    const side=cached((z,y,o=.004)=>offsetPoint(s.side(sign,y,z),0,sign*o));
    const frontDoor:Q[]=[[.91,.344],[.85,.11],[.74,-.32],[.61,-.427],[-.21,-.439],[-.30,-.365],[-.315,.337]];
    const backDoor:Q[]=[[-.335,.337],[-.340,.00],[-.40,-.368],[-.49,-.439],[-.81,-.425],[-1.00,-.25],[-1.10,.05],[-1.22,.331]];
    for(const door of [frontDoor,backDoor])line(p,'trim',door,side,.00155,.004,56);
    for(const z of [-.10,-.965]){
      const handle=rounded([[z+.084,.301],[z-.047,.299],[z-.076,.312],[z-.080,.330],[z-.045,.331],[z-.037,.320],[z+.081,.321]],.16);
      patch(p,'trim',handle,side,.005);
    }
    // Repeater/camera fin behind each front wheel.
    patch(p,'trim',rounded([[1.215,.285],[.973,.270],[1.014,.208],[1.053,.207]],.12),side,.006);
    patch(p,'glass',rounded([[1.087,.264],[1.013,.254],[1.033,.223],[1.061,.231]],.2),side,.009);
    line(p,'chrome',[[1.193,.278],[1.045,.271]],side,.0012,.009,9);
    // Low sill crease remains between the openings, with no beam crossing tires.
    line(p,'trim',[[1.048,-.462],[.74,-.479],[-.72,-.479],[-1.035,-.450]],side,.006,.006,40);

    // The reference has a broad red light guide contained in a dark flat lens.
    const tail:Project=(x,y,o=.004)=>rear(sign*x,y,o);
    const tailHousing=rounded([[.337,.321],[.574,.365],[.785,.363],[.851,.329],[.849,.164],[.699,.145],[.530,.160],[.548,.192],[.781,.195],[.791,.304],[.569,.318]],.17);
    patch(p,'trim',tailHousing,tail,.005,.0007);
    const led:Q[]=[[.359,.327],[.576,.347],[.773,.346],[.822,.321],[.823,.189],[.691,.167],[.550,.177]];
    ribbon(p,'taillight',led,.021,tail,.010,72);
    ribbon(p,'chrome',[[.480,.311],[.626,.320],[.783,.318],[.798,.289],[.797,.213]],.005,tail,.012,36);
    // Small clear lower reversing lamp lies within the C, not outside the shell.
    patch(p,'chrome',rounded([[.567,.210],[.768,.217],[.765,.230],[.576,.225]],.12),tail,.006);
    // Quarter-panel part of the lens wraps toward the wheel as in the references.
    const quarterLens=cached((t,y,o=.004)=>{
      // Follow the main lens's outside edge. Starting at a constant x would
      // overlap its luminous vertical return as the bumper wraps around.
      const cornerX=.842-Math.max(0,y-.318)*1.28;
      const corner=s.rear(sign*cornerX,y);
      return side(THREE.MathUtils.lerp(corner[2],-1.995,t),y,o);
    });
    patch(p,'trim',rounded([[0,.355],[1,.353],[.90,.223],[.13,.164]],.13),quarterLens,.006,.0007,true);
    patch(p,'taillight',rounded([[.20,.295],[.86,.312],[.76,.269],[.28,.252]],.12),quarterLens,.009,.0007);
    // Slim reflectors are inset into the upper border of the diffuser.
    patch(p,'taillight',rounded([[.565,-.323],[.774,-.299],[.780,-.322],[.578,-.347]],.22),tail,.013);
  }

  // Low central mouth, fitted grille slats, and a thin front splitter.
  patch(p,'trim',rounded([[-.692,-.432],[-.598,-.337],[-.504,-.321],[.504,-.321],[.598,-.337],[.692,-.432],[.660,-.476],[-.660,-.476]],.18),front,.006);
  for(const y of [-.352,-.372,-.392,-.412])line(p,'rubber',[[-.566,y],[0,y+.003],[.566,y]],front,.0035,.011,20);
  ribbon(p,'trim',[[-.858,-.453],[-.653,-.489],[0,-.492],[.653,-.489],[.858,-.453]],.025,front,.012,48);

  // Actual rounded rectangular trunk shut line and its shallow number-plate
  // pocket make the rear read as separate pressed panels instead of a slab.
  line(p,'trim',[[-.647,.157],[-.613,-.029],[-.552,-.164],[-.415,-.181],[0,-.184],[.415,-.181],[.552,-.164],[.613,-.029],[.647,.157]],rear,.0021,.004,90);
  line(p,'trim',[[-.534,.153],[0,.145],[.534,.153]],rear,.0021,.004,32);
  patch(p,'trim',rounded([[-.167,.060],[.167,.060],[.167,-.120],[-.167,-.120]],.07),rear,.005);
  // Rear camera is tucked under the trunk's horizontal lip.
  const camera=s.rear(0,.129),cameraGeo=new THREE.SphereGeometry(.010,10,6);cameraGeo.scale(1,.68,.55);cameraGeo.translate(camera[0],camera[1],camera[2]-.008);p.add('glass',cameraGeo);

  // Shaped diffuser panel rises at each end, with a restrained lower lip.
  const diffuser=rounded([[-.818,-.426],[-.756,-.347],[-.611,-.319],[-.415,-.342],[.415,-.342],[.611,-.319],[.756,-.347],[.818,-.426],[.670,-.526],[-.670,-.526]],.17);
  patch(p,'trim',diffuser,rear,.008);
  ribbon(p,'rubber',[[-.75,-.472],[-.56,-.480],[-.38,-.506],[.38,-.506],[.56,-.480],[.75,-.472]],.017,rear,.014,46);
  for(const x of [-.48,-.25,.25,.48]){
    const base=s.rear(x,-.488);p.box('trim',[.010,.044,.15],[x,-.507,base[2]+.057]);
  }
  // Small Performance emblem, including its pinstripe starburst.
  patch(p,'chrome',rounded([[.427,-.030],[.480,-.030],[.480,-.067],[.427,-.067]],.10),rear,.006);
  for(let i=0;i<7;i++){const y=-.034-i*.0046;line(p,'trim',[[.432,y],[.453,-.049],[.475,y]],rear,.00065,.008,4);}

  // The carbon lip is a solid curved laminate. Only its leading underside is
  // seated against the trunk; the swept trailing edge lifts clear, exposing
  // a real shadow gap and underside like the supplied rear-quarter views.
  const span=.835,segments=64,chordSteps=12,stride=chordSteps+1;
  const spoilerVertices:number[]=[],spoilerUvs:number[]=[],spoilerIndices:number[]=[];
  const spoilerPoint=(x:number,t:number,upper:boolean):P=>{
    const u=Math.abs(x)/span,taper=Math.max(0,1-u**6),leading=-2.245+.165*u*u;
    const chord=.022+.103*taper,z=leading-chord*t,deck=s.hood(x,z),leadingY=s.hood(x,leading)[1];
    const thickness=.0045+.001*Math.sin(Math.PI*t);
    // Lift the trailing edge in absolute height, not just relative to the
    // falling deck. Otherwise the two slopes cancel and it still looks flat.
    const foot=THREE.MathUtils.lerp(deck[1],leadingY,THREE.MathUtils.smoothstep(t,0,.35));
    const lift=.001+.030*t*t*taper;
    return [x,foot+lift+(upper?thickness:0),z];
  };
  const addSpoilerVertex=(point:P,u:number,v:number)=>{
    const index=spoilerVertices.length/3;spoilerVertices.push(...point);spoilerUvs.push(u,v);return index;
  };
  for(const upper of [true,false])for(let i=0;i<=segments;i++)for(let j=0;j<=chordSteps;j++){
    addSpoilerVertex(spoilerPoint(-span+i*span*2/segments,j/chordSteps,upper),i/segments,j/chordSteps);
  }
  const lowerOffset=(segments+1)*stride;
  for(let i=0;i<segments;i++)for(let j=0;j<chordSteps;j++){
    const a=i*stride+j,b=a+stride,c=b+1,d=a+1;
    spoilerIndices.push(a,b,c,a,c,d,a+lowerOffset,d+lowerOffset,c+lowerOffset,a+lowerOffset,c+lowerOffset,b+lowerOffset);
  }
  // Separate rim UVs keep the weave correctly scaled across the five-mm
  // laminate thickness instead of stretching the entire texture into it.
  const spoilerCap=(points:P[],uvs:Q[])=>{
    const start=spoilerVertices.length/3;points.forEach((point,i)=>addSpoilerVertex(point,...uvs[i]));
    spoilerIndices.push(start,start+1,start+2,start,start+2,start+3);
  };
  for(let i=0;i<segments;i++){
    const x0=-span+i*span*2/segments,x1=-span+(i+1)*span*2/segments,u0=i/segments,u1=(i+1)/segments;
    spoilerCap([spoilerPoint(x0,0,true),spoilerPoint(x0,0,false),spoilerPoint(x1,0,false),spoilerPoint(x1,0,true)],[[u0,0],[u0,.03],[u1,.03],[u1,0]]);
    spoilerCap([spoilerPoint(x0,1,true),spoilerPoint(x1,1,true),spoilerPoint(x1,1,false),spoilerPoint(x0,1,false)],[[u0,0],[u1,0],[u1,.03],[u0,.03]]);
  }
  for(let j=0;j<chordSteps;j++){
    const t0=j/chordSteps,t1=(j+1)/chordSteps;
    spoilerCap([spoilerPoint(-span,t0,true),spoilerPoint(-span,t1,true),spoilerPoint(-span,t1,false),spoilerPoint(-span,t0,false)],[[t0,0],[t1,0],[t1,.03],[t0,.03]]);
    spoilerCap([spoilerPoint(span,t0,true),spoilerPoint(span,t0,false),spoilerPoint(span,t1,false),spoilerPoint(span,t1,true)],[[t0,0],[t0,.03],[t1,.03],[t1,0]]);
  }
  const spoiler=new THREE.BufferGeometry();spoiler.setAttribute('position',new THREE.Float32BufferAttribute(spoilerVertices,3));
  spoiler.setAttribute('uv',new THREE.Float32BufferAttribute(spoilerUvs,2));spoiler.setIndex(spoilerIndices);spoiler.computeVertexNormals();p.add('carbon',spoiler);
  // Bonnet seam and a clean, tiny Tesla T instead of a raised badge block.
  line(p,'trim',[[-.598,1.035],[-.545,1.59],[-.418,2.104],[0,2.160],[.418,2.104],[.545,1.59],[.598,1.035]],hood,.0016,.004,98);
  ribbon(p,'chrome',[[-.039,2.058],[0,2.072],[.039,2.058]],.006,hood,.009,16);
  ribbon(p,'chrome',[[0,2.067],[0,2.009]],.007,hood,.009,8);
}
