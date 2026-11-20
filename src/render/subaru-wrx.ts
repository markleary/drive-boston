import * as THREE from 'three';
import { geometryParts, type VehicleSurface } from './car.ts';
import { ellipsoid, exhaust, type P, type Parts } from './sports-car-shapes.ts';
import { PLAYER_CARS } from '../simulation/player-cars.ts';

type Pair = [number, number];
type Surface = (u: number, v: number) => P;
const lerp = THREE.MathUtils.lerp;
const smooth = THREE.MathUtils.smoothstep;
const rear = -2.34, front = 2.329, sill = -.476;
const axle = 1.336, wheelY = -.304;
const interpolate = (rows: Pair[], z: number) => {
  const i = rows.findIndex(([key]) => key > z);
  if (i === 0) return rows[0][1];
  if (i === -1) return rows[rows.length - 1][1];
  const [a, b] = [rows[i - 1], rows[i]];
  return lerp(a[1], b[1], (z - a[0]) / (b[0] - a[0]));
};

// All body details use the same surfaces as the shell. The bumper corners roll
// back towards the flanks, including the sweeping ends of the head and tail lamps.
const widths: Pair[] = [[rear,.866],[-1.85,.905],[-axle,.91],[-.67,.884],[.4,.881],[axle,.91],[1.87,.899],[front,.858]];
const decks: Pair[] = [[rear,.332],[-2.16,.357],[-1.65,.383],[-1,.389],[-.1,.371],[.88,.337],[1.37,.301],[1.9,.224],[front,.211]];
const width = (z:number) => interpolate(widths,z);
const deck = (z:number) => interpolate(decks,z);
const crown = (u:number) => {
  const t=Math.abs(u);
  return .023*(1-t*t)+.032*smooth(t,.45,.81)-.095*(Math.max(0,t-.82)/.18)**1.7;
};
function warp(z:number,x:number,y:number) {
  const edge=Math.abs(x)/.90;
  // Round the nose under the leading edge of the hood, and tuck the valance
  // under the trunk. The number-plate pocket is stamped into the tail panel.
  const nose=.415*edge**5+.107*smooth(y,-.16,.20)+.094*(1-smooth(y,sill,-.27));
  const recess=.060*(1-smooth(Math.abs(x),.26,.54))*smooth(y,-.19,-.075)*(1-smooth(y,.09,.19));
  const tail=.414*edge**5+.065*smooth(y,.19,.39)+.095*(1-smooth(y,sill,-.23))+recess;
  return z+tail*(1-smooth(z,rear,-1.46))-nose*smooth(z,1.48,front);
}
const top: Surface = (u,z) => {
  const x=u*width(z),y=deck(z)+crown(u);
  return [x,y,warp(z,x,y)];
};
const arch = (z:number) => {
  const distance = Math.abs(Math.abs(z)-axle);
  const radius = .365;
  if (distance >= radius) return sill;
  return wheelY + Math.sqrt(radius**2 - distance**2);
};
const flank = (s:number, y:number, z:number, offset=0):P => {
  const u = (deck(z)+crown(1)-y)/(deck(z)+crown(1)-sill);
  const shape = interpolate([[0,0],[.09,.009],[.18,.015],[.27,.001],[.57,.010],[.73,-.009],[.86,-.015],[1,-.045]],u);
  const x = s*(width(z)+shape);
  return [x+s*offset,y,warp(z,x,y)];
};
function face(sign:number, x:number, y:number, offset=0):P {
  const z = sign > 0 ? front : rear;
  const rounded = warp(z,x,y);
  return [x,y,rounded+sign*offset];
}
export const wrxPlatePositions = {
  front: face(1,0,-.225,.042),
  rear: face(-1,0,.012,.033),
  wordmark: face(-1,-.45,.078,.014),
};

function patch(parts:Parts, material:VehicleSurface, columns:number, rows:number, point:Surface, reverse=false) {
  const vertices:number[] = [], indices:number[] = [];
  for (let j=0;j<=rows;j++) for (let i=0;i<=columns;i++) vertices.push(...point(i/columns,j/rows));
  for (let j=0;j<rows;j++) for (let i=0;i<columns;i++) {
    const a=j*(columns+1)+i, b=a+columns+1;
    if (reverse) indices.push(a,b,a+1,a+1,b,b+1);
    else indices.push(a,a+1,b,a+1,b+1,b);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  g.setIndex(indices); g.computeVertexNormals(); parts.add(material,g);
}

/** Join cross sections with curved, surface-following bands. Each row is
 * [height, left edge, right edge], ordered from the base upwards. */
function facePanel(p:Parts, material:VehicleSurface, sign:number, rows:[number,number,number][], depth=.005) {
  for (let j=1;j<rows.length;j++) {
    const [a,b] = [rows[j-1],rows[j]];
    patch(p,material,28,Math.max(1,Math.ceil((b[0]-a[0])/.018)),(u,v)=>face(sign,lerp(lerp(a[1],a[2],u),lerp(b[1],b[2],u),v),lerp(a[0],b[0],v),depth),sign<0);
  }
}

function shell(p:Parts) {
  const bottom = (z:number) => arch(z);
  for (const s of [-1,1]) {
    // Leave an opening under the greenhouse so the seats and dashboard can be
    // seen through the glass. A narrow shelf supports the windshield edges.
    patch(p,'paint',20,80,(u,v)=>{
      const z=lerp(rear,front,v);
      const opening=.75*smooth(z,-1.65,-1.50)*(1-smooth(z,.88,1.00));
      return top(s*lerp(opening,1,u),z);
    },s>0);
    patch(p,'paint',100,8,(u,v)=>{
      const z=lerp(rear,front,u);
      return flank(s,lerp(bottom(z),deck(z)+crown(1),v),z);
    },s>0);
    patch(p,'trim',120,2,(u,v)=>{
      const z=lerp(rear,front,u), [x,y,end]=flank(s,bottom(z),z);
      return [lerp(x,s*.55,v),y-.008*v,end];
    },s<0);
    // Angular molded fender flares over the round wheel openings, including a
    // visible inner lip and a vertical return at each end of the arch.
    for (const center of [-axle,axle]) {
      const stations:Pair[]=[[-.405,sill],[-.415,wheelY-.01],[-.393,wheelY+.13],[-.292,wheelY+.32],[-.185,wheelY+.415],[.175,wheelY+.415],[.292,wheelY+.32],[.397,wheelY+.115],[.415,wheelY-.02],[.405,sill]];
      const angles=[-Math.PI,-Math.PI,-2.80,-2.33,-2.04,-1.10,-.79,-.30,0,0];
      const inner=(i:number):Pair=>[.353*Math.cos(angles[i]),i===0||i===9?sill:wheelY-.353*Math.sin(angles[i])];
      for(let i=1;i<stations.length;i++) {
        const [a,b]=[stations[i-1],stations[i]], [c,d]=[inner(i-1),inner(i)];
        patch(p,'trim',4,3,(u,v)=>{
          const dz=lerp(lerp(c[0],d[0],u),lerp(a[0],b[0],u),v);
          const y=lerp(lerp(c[1],d[1],u),lerp(a[1],b[1],u),v);
          return flank(s,y,center+dz,.005+.022*(1-v));
        },s>0);
        patch(p,'rubber',4,1,(u,v)=>{
          const [x,y,z]=flank(s,lerp(c[1],d[1],u),center+lerp(c[0],d[0],u),.027);
          return [x-s*v*.16,y,z];
        },s<0);
      }
    }
    patch(p,'trim',14,3,(u,v)=>flank(s,lerp(sill,-.345+.036*Math.cos((u-.5)*Math.PI),v),lerp(-.957,.955,u),.012),s>0);
    const line=(coordinates:Pair[],r:number)=>{
      const points:P[]=[];
      for(let i=1;i<coordinates.length;i++){
        const [a,b]=[coordinates[i-1],coordinates[i]],steps=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])/.045);
        for(let j=0;j<=steps;j++){
          if(i>1&&j===0)continue;
          points.push(flank(s,lerp(a[1],b[1],j/steps),lerp(a[0],b[0],j/steps),.0035));
        }
      }
      p.path('trim',points,r);
    };
    line([[.88,deck(.88)+crown(1)],[.88,.04],[.83,-.28],[.74,-.318],[-.20,-.318],[-.235,-.25],[-.235,deck(-.235)+crown(1)]],.0045);
    line([[-.20,-.318],[-.72,-.318],[-.79,-.27],[-.97,.004],[-1.23,.185],[-1.35,deck(-1.35)+crown(1)]],.0045);
    for(const z of [-1.04,-.095]) {
      ellipsoid(p,'trim',flank(s,.232,z,.004),[.011,.016,.081]);
      ellipsoid(p,'paint',flank(s,.239,z,.015),[.015,.014,.077]);
    }
    // Pair of shallow gills in the trailing edge of the front flares.
    for (const y of [-.135,-.19]) p.beam('rubber',flank(s,y,.93,.018),flank(s,y+.014,.98,.03),.008);
    const stem=flank(s,.349,.70); p.beam('trim',stem,[s*.916,.393,.63],.028);
    ellipsoid(p,'trim',[s*.905,.405,.62],[.102,.054,.122]);
    ellipsoid(p,'paint',[s*.905,.431,.624],[.101,.045,.121]);
    ellipsoid(p,'glass',[s*.905,.411,.536],[.084,.040,.025]);
  }
  for (const sign of [-1,1]) {
    const z=sign>0?front:rear;
    patch(p,'paint',52,32,(u,v)=>{
      const t=2*u-1,edge=flank(1,lerp(sill,deck(z)+crown(1),v),z)[0];
      const y=lerp(sill,deck(z)+crown(t),v); return face(sign,t*edge,y);
    },sign<0);
  }
}

const cabinHeights:Pair[]=[[-1.72,.394],[-1.54,.487],[-1.25,.625],[-.94,.756],[-.71,.797],[-.42,.816],[-.12,.817],[.17,.787],[.31,.758],[.59,.577],[.91,.372],[.98,.349]];
const cabinWidths:Pair[]=[[-1.72,.71],[-1.24,.68],[-.88,.627],[-.35,.643],[.26,.628],[.65,.704],[.98,.764]];
const belt=(z:number)=>.357+.037*(1-smooth(z,-1,.85));
const cabinTop=(u:number,z:number):P=>[u*interpolate(cabinWidths,z), interpolate(cabinHeights,z)+.023*(1-u*u), z+.072*(1-u*u)*Math.sign(z)*smooth(Math.abs(z),.28,.98)];
const cabinSide=(s:number,z:number,v:number):P=>{
  const [x,y]=cabinTop(s,z);
  return [lerp(s*(.825-.023*smooth(Math.abs(z),.55,1.7)),x,v),lerp(belt(z),y,v),z];
};
function cabin(p:Parts) {
  for(const [start,end,material] of [[-1.72,-1.64,'paint'],[-1.64,-.896,'cabinGlass'],[-.896,.26,'paint'],[.26,.926,'cabinGlass'],[.926,.98,'trim']] as const) {
    patch(p,material,16,20,(u,v)=>cabinTop(2*u-1,lerp(start,end,v)),true);
    if (material==='cabinGlass') {
      for(const z of [start,end]) p.path('trim',Array.from({length:17},(_,i)=>cabinTop(i/8-1,z)),.009);
    }
  }
  for(const s of [-1,1]) {
    p.box('trim',[.06,.24,2.15],[s*.784,.237,-.22]);
    for(const [start,end,material] of [[-1.72,-1.31,'paint'],[-1.31,-.94,'cabinGlass'],[-.94,-.907,'trim'],[-.907,-.242,'cabinGlass'],[-.242,-.158,'trim'],[-.158,.81,'cabinGlass'],[.81,.98,'paint']] as const) {
      patch(p,material,18,5,(u,v)=>cabinSide(s,lerp(start,end,u),v),s>0);
    }
    const rail=(v:number,start:number,end:number)=>Array.from({length:31},(_,i)=>cabinSide(s,lerp(start,end,i/30),v));
    p.path('trim',rail(.015,-1.34,.83),.011);
    p.path('trim',rail(.98,-1.34,.83),.016);
    p.path('paint',rail(1,-1.69,.95),.022);
    p.beam('trim',cabinSide(s,.53,.015),cabinSide(s,.78,.26),.012);
  }
  // A pillar-mounted rear-view mirror and steering wheel are visible across the glass.
  p.box('trim',[1.58,.085,2.46],[0,.055,-.18]);
  p.box('trim',[1.51,.12,.42],[0,.291,.645],[-.07,0,0]);
  p.box('trim',[.075,.032,.046],[0,.676,.35]);
  p.box('trim',[.224,.065,.028],[0,.654,.314]);
  for(const z of [.08,-.88]) for (const x of [-.395,.395]) {
    ellipsoid(p,'trim',[x,.255,z-.16],[.225,.25,.102]);
    ellipsoid(p,'rubber',[x,.505,z-.18],[.10,.087,.061]);
  }
  const wheel=new THREE.TorusGeometry(.16,.014,6,28);
  wheel.rotateX(-.3); wheel.translate(-.387,.354,.43); p.add('rubber',wheel);
  p.beam('trim',[-.53,.36,.425],[-.245,.36,.425],.012);
  p.path('trim',[[-.58,.371,.95],[-.42,.417,.84],[-.09,.424,.84]],.009);
  p.path('trim',[[.08,.375,.95],[.19,.409,.87],[.53,.411,.86]],.009);
  // Body-colour shark fin on the rear of the roof.
  const fin=new THREE.ConeGeometry(1,1,10); fin.scale(.040,.092,.093);
  fin.rotateX(-.34); fin.translate(0,.844,-.72); p.add('paint',fin);
}

function bonnet(p:Parts) {
  const hood=(x:number,z:number,rise=0):P=>{
    const [px,y,pz]=top(x/width(z),z); return [px,y+rise,pz];
  };
  for (const s of [-1,1]) {
    p.path('trim',[[.64,.92],[.68,1.33],[.66,1.75],[.52,2.12],[.46,2.28]].map(([x,z])=>hood(s*x,z,.003)),.004);
  }
  // The intake has a dark recessed throat, raised trailing ramp, cheek pieces,
  // and a thin leading edge which casts a real shadow over the opening.
  const lip=(u:number)=>1.60-.074*u**4;
  const cover=(u:number,v:number):P=>{
    const z=lerp(.996,lip(u),v), x=u*lerp(.263,.357,v);
    return hood(x,z,.004+smooth(v,0,1)*(.076-.043*u**4));
  };
  patch(p,'paint',20,12,(u,v)=>cover(u*2-1,v),true);
  const opening=(u:number,v:number):P=>{
    const [x,y,z]=cover(u,1);
    return [x,lerp(hood(x,lip(u))[1]+.011,y-.009,v),z-.038];
  };
  patch(p,'trim',20,2,(u,v)=>opening(u*2-1,v));
  for(const s of [-1,1]) patch(p,'paint',12,2,(u,v)=>{
    const [x,y,z]=cover(s,u); return [x+s*.067*(1-v),lerp(hood(x,z)[1]+.002,y,v*v),z];
  },s>0);
  for(const u of [-.57,-.19,.19,.57]) p.beam('rubber',opening(u,0),opening(u,1),.004,4);
  p.path('paint',Array.from({length:17},(_,i)=>cover(i/8-1,1)),.009);
}

function badge(p:Parts,s:number,y:number) {
  const [, ,z]=face(s,0,y,.026);
  ellipsoid(p,'chrome',[0,y,z],[.065,.034,.008]);
  ellipsoid(p,'glass',[0,y,z+s*.005],[.060,.029,.007]);
  for(const [x,dy,r] of [[-.024,.004,.011],[.006,.011,.005],[.033,.012,.005],[.019,0,.005],[.038,-.008,.006],[.003,-.01,.005]]) {
    const star=(dx:number,h:number):P=>[s*(x+dx),y+dy+h,z+s*.012];
    p.quad('plate',[star(-1.4*r,0),star(0,-.28*r),star(1.4*r,0),star(0,.28*r)]);
    p.quad('plate',[star(-.25*r,0),star(0,-.85*r),star(.25*r,0),star(0,.85*r)]);
  }
}
// A single lens runs across the end cap and around the quarter. Both segments
// meet at precisely the shell's outer edge, with a small normal offset for the lens.
function wrapLens(sign:number,s:number,u:number,v:number,high:number,low:number,inner:number,sideZ:number,offset:number):P{
  const z=sign>0?front:rear, t=.77, y=lerp(low,high,v);
  const corner=flank(s,y,z),normalAngle=smooth(u,.38,t)*Math.PI*.5;
  if(u<t){
    const x=lerp(s*inner,corner[0],u/t),p=face(sign,x,y,offset*Math.cos(normalAngle));
    p[0]+=s*offset*Math.sin(normalAngle);return p;
  }
  return flank(s,y,lerp(z,sideZ,(u-t)/(1-t)),offset);
}
const hexCorners:Pair[]=[[-1,0],[-.5,-1],[.5,-1],[1,0],[.5,1],[-.5,1]];
/** Cut edge cells to the inside of the stamped grille rim. Interpolate the
 * bevel depth along each cut so partial cells meet the surround cleanly. */
function clipToRim(points:P[], rim:Pair[]) {
  for(let edge=0;edge<rim.length&&points.length;edge++){
    const [x,y]=rim[edge],[nx,ny]=rim[(edge+1)%rim.length];
    const distance=([px,py]:P)=>(nx-x)*(py-y)-(ny-y)*(px-x);
    const result:P[]=[];
    let a=points.at(-1)!, da=distance(a);
    for(const b of points){
      const db=distance(b);
      if((da>0)!==(db>0)){
        const t=da/(da-db);
        result.push([lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)]);
      }
      if(db>0)result.push(b);
      a=b;da=db;
    }
    points=result;
  }
  return points;
}
/** Each hex bevel slopes back into its opening. Adjacent cells share a ridge. */
function grilleCell(p:Parts,x:number,y:number,rx:number,ry:number,point:(u:number,v:number,ridge:number)=>P,rim?:Pair[]){
  const vertices:number[]=[];
  for(let i=0;i<6;i++){
    const a=hexCorners[i],b=hexCorners[(i+1)%6];
    const bevel:P[]=[[x+rx*a[0],y+ry*a[1],1],[x+rx*b[0],y+ry*b[1],1],
      [x+rx*.86*b[0],y+ry*.75*b[1],0],[x+rx*.86*a[0],y+ry*.75*a[1],0]];
    const face=(rim?clipToRim(bevel,rim):bevel).map(([u,v,d])=>point(u,v,d));
    for(let j=1;j+1<face.length;j++)vertices.push(...face[0],...face[j],...face[j+1]);
  }
  if(!vertices.length)return;
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.computeVertexNormals();p.add('trim',g);
}
function fascias(p:Parts) {
  // The stock grille has a single emblem bar across a shallow hexagonal mesh.
  const grille:Pair[]=[[-.122,.322],[-.108,.357],[.042,.473],[.066,.477],[.141,.413]];
  facePanel(p,'rubber',1,grille.map(([y,w])=>[y,-w,w]),.007);
  const rim:Pair[]=grille.map(([y,w])=>[w,y]);
  rim.push(...grille.map(([y,w]):Pair=>[-w,y]).reverse());
  for(let i=0;i<rim.length;i++){
    const a=rim[i],b=rim[(i+1)%rim.length];
    patch(p,'trim',Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.032),2,(u,v)=>
      face(1,lerp(a[0],b[0],u)*(1-.025*v),lerp(a[1],b[1],u)*(1-.062*v),.009+.007*v));
  }
  const innerRim=rim.map(([x,y]):Pair=>[x*.978,y*.95]);
  for(let col=-6;col<=6;col++) for(let row=-1;row<7;row++){
    const x=col*.0795, y=-.11+(row+Math.abs(col%2)*.5)*.046;
    grilleCell(p,x,y,.053,.023,(px,py,ridge)=>face(1,px,py,.009+.007*ridge),innerRim);
  }
  facePanel(p,'trim',1,[[.028,-.383,.383],[.045,-.455,.455],[.067,-.439,.439]],.021);
  facePanel(p,'trim',1,[[-.468,-.75,.75],[-.434,-.81,.81],[-.353,-.82,.82],[-.322,-.72,.72],[-.309,-.53,.53],[-.192,-.423,.423]]);
  for(const y of [-.361,-.319,-.279,-.242]) for(const s of [-1,1]) {
    p.path('rubber',Array.from({length:9},(_,i)=>face(1,s*(.169+.244*i/8),y,.014)),.006);
  }
  for (const s of [-1,1]) {
    const lens=(x:number,y:number,d=.012)=>face(1,s*x,y,d);
    const lamp=(u:number,v:number,offset=.011):P=>{
      const high=interpolate([[0,.103],[.32,.122],[.68,.167],[.81,.149],[1,.150]],u);
      const low=interpolate([[0,.093],[.14,.089],[.18,.036],[.58,.050],[.79,.078],[1,.146]],u);
      return wrapLens(1,s,u,v,high,low,.527,2.03,offset);
    };
    patch(p,'glass',40,4,lamp,s<0);
    // The signature turns down at the outer end of the housing. Keep the
    // daytime light guide and projector optics seated under that same lens.
    patch(p,'headlight',20,1,(u,v)=>lamp(.04+u*.64,.82+.11*v,.016),s<0);
    patch(p,'headlight',3,4,(u,v)=>lamp(.61+.075*u-.045*(1-v),.17+.68*v,.017),s<0);
    patch(p,'chrome',14,1,(u,v)=>lamp(.19+u*.432,.125+.041*v,.017),s<0);
    patch(p,'chrome',8,4,(u,v)=>lamp(.33+.15*u,.37+(.12+.23*Math.sin(Math.PI*u))*v,.019),s<0);
    patch(p,'headlight',7,3,(u,v)=>lamp(.355+.093*u,.41+(.08+.13*Math.sin(Math.PI*u))*v,.020),s<0);
    p.path('amber',Array.from({length:7},(_,i)=>lamp(.81+.125*i/6,.55,.017)),.007);
    // Rounded fog pockets flare into the lower intake. The small lamp sits
    // down in its bezel with short ventilation ribs above it.
    const pocket=(u:number,v:number,offset=.012):P=>{
      const x=lerp(.434,.811,u);
      const upper=interpolate([[0,-.232],[.18,-.185],[.45,-.145],[.85,-.127],[1,-.161]],u);
      const lower=interpolate([[0,-.242],[.34,-.324],[.45,-.340],[.94,-.341],[1,-.317]],u);
      return lens(x,lerp(lower,upper,v),offset);
    };
    patch(p,'trim',20,5,pocket,s<0);
    patch(p,'rubber',15,2,(u,v)=>pocket(.18+.75*u,.54+.34*v,.017),s<0);
    for(let col=0;col<5;col++) for(let row=0;row<2;row++){
      const u=.255+.14*col,v=.618+.147*row+(col%2)*.073;
      grilleCell(p,u,v,.093,.073,(px,py,ridge)=>pocket(px,py,.018+.005*ridge));
    }
    patch(p,'rubber',13,4,(u,v)=>pocket(.55+.27*u,.13+(.30+.10*Math.sin(Math.PI*u))*v,.023),s<0);
    patch(p,'chrome',10,3,(u,v)=>pocket(.595+.17*u,.20+(.15+.09*Math.sin(Math.PI*u))*v,.026),s<0);
    patch(p,'headlight',7,3,(u,v)=>pocket(.625+.11*u,.21+(.14+.06*Math.sin(Math.PI*u))*v,.027),s<0);
  }
  badge(p,1,.039);
  // Rear valance rises under each corner, leaving the plate in the painted trunk.
  const valanceHeight=(x:number)=>-.150+.109*smooth(Math.abs(x),.43,.76);
  const skirt=(sign:number,t:number,v:number):P=>{
    const end=sign>0?front:rear;
    const upper=sign>0?-.408+.110*smooth(Math.abs(t),.65,1):valanceHeight(t*.85);
    const y=lerp(sill,upper,v);
    const [edge]=flank(1,y,end);
    const a=smooth(Math.abs(t),.55,1)*Math.PI*.5,offset=.012;
    const point=face(sign,t*edge,y,offset*Math.cos(a));
    point[0]+=Math.sign(t)*offset*Math.sin(a);
    return point;
  };
  for(const sign of [-1,1]) patch(p,'trim',48,9,(u,v)=>skirt(sign,2*u-1,v),sign<0);
  for(const s of [-1,1]) {
    for(const [sign,start,end] of [[-1,rear,-1.68],[1,1.68,front]]) {
      patch(p,'trim',32,8,(u,v)=>{
        const z=lerp(start,end,u), toEnd=sign>0?u:1-u;
        const height=sign>0?lerp(-.365,-.298,toEnd):lerp(-.345,valanceHeight(.86),smooth(toEnd,.11,.77));
        const base=arch(z);
        const y=lerp(base,Math.max(base,height),v);
        return flank(s,y,z,.012);
      },s>0);
    }
  }
  facePanel(p,'glass',-1,[[.172,-.74,.74],[.207,-.76,.76]],.008);
  for(const s of [-1,1]){
    const lens=(x:number,y:number,d=.014)=>face(-1,s*x,y,d);
    const lamp=(u:number,v:number,offset=.011):P=>{
      const high=interpolate([[0,.202],[.38,.245],[.74,.253],[.85,.229],[1,.240]],u);
      const low=interpolate([[0,.185],[.20,.175],[.38,.111],[.64,.121],[.80,.165],[.88,.191],[1,.231]],u);
      return wrapLens(-1,s,u,v,high,low,.320,-1.78,offset);
    };
    patch(p,'glass',45,4,lamp,s>0);
    const led=(u:number,v:number)=>lamp(u,v,.019);
    patch(p,'taillight',38,2,(u,v)=>led(u,.67+.26*v),s>0);
    patch(p,'taillight',20,2,(u,v)=>led(.34+.58*u,.08+.22*v),s>0);
    patch(p,'taillight',8,3,(u,v)=>led(.62+.125*u,.18+.56*v),s>0);
    patch(p,'plate',8,1,(u,v)=>led(.39+.18*u,.38+.12*v),s>0);
    for(let i=0;i<7;i++){
      const u=.54+i*.032;
      p.beam('taillight',led(u,.23),led(u+.011,.65),.003,4);
    }
    p.path('taillight',[lens(.712,-.236,.025),lens(.803,-.205,.025)],.014);
    for(const x of [.609,.728]) exhaust(p,s*x,-.352,face(-1,s*x,-.352)[2]+.045,.052);
  }
  badge(p,-1,.207);
  const spoiler=(u:number,v:number):P=>{
    const x=u*.757,z=lerp(-2.155+.07*u*u,-2.301+.16*u*u,v);
    const y=top(x/width(z),z)[1]+.009+.034*v*(1-.59*u*u);return [x,y,warp(z,x,y)];
  };
  patch(p,'paint',28,5,(u,v)=>spoiler(2*u-1,v));
  patch(p,'paint',28,2,(u,v)=>{
    const [x,y,z]=spoiler(2*u-1,1);return [x,y-v*.042,z+.023*v];
  },true);
  for(const sign of [-1,1]) {
    const y=sign>0?wrxPlatePositions.front[1]:wrxPlatePositions.rear[1];
    const plate=sign>0?wrxPlatePositions.front:wrxPlatePositions.rear;
    p.box('trim',[.325,.170,.028],[0,y,plate[2]-.016*sign]);
  }
}
export function createWrxGeometry() {
  const p=geometryParts();
  shell(p); cabin(p); bonnet(p); fascias(p);
  return p.finish();
}

export function createWrxWheelGeometry(s:number) {
  const p=geometryParts(), rim=.2286, radius=PLAYER_CARS['subaru-wrx'].wheelRadius, half=.1225;
  const rubber=new THREE.LatheGeometry([[rim,-half+.011],[.282,-half],[radius-.014,-half+.011],[radius,-half+.032],[radius,half-.032],[radius-.014,half-.011],[.282,half],[rim,half-.011]].map(([r,x])=>new THREE.Vector2(r,x)),40);
  rubber.rotateZ(Math.PI/2); p.add('rubber',rubber);
  const barrel=new THREE.CylinderGeometry(rim-.005,rim-.005,.195,40,1,true);
  barrel.rotateZ(Math.PI/2);p.add('trim',barrel);
  const ring=new THREE.TorusGeometry(rim-.003,.008,6,40);
  ring.rotateY(Math.PI/2);ring.translate(s*(half-.011),0,0);p.add('trim',ring);
  const rotor=new THREE.CylinderGeometry(.156,.156,.019,32);
  rotor.rotateZ(Math.PI/2);rotor.translate(s*.05,0,0);p.add('chrome',rotor);
  const point=(r:number,a:number,depth:number):P=>[s*depth,r*Math.cos(a),r*Math.sin(a)];
  // Split, angular graphite spokes have a shallow dished hub and a ridge that
  // catches the light. Build each fork as two faces to retain the forged profile.
  for(let i=0;i<10;i++){
    const angle=i*Math.PI/5,split=i%2===0?1:-1;
    for(const edge of [-1,1]) {
      patch(p,'trim',2,5,(u,v)=>{
        const r=lerp(.045,rim-.005,v);
        const a=angle+split*lerp(.13,.025,v)+edge*u*lerp(.19,.065,v);
        return point(r,a,.081+.030*v+.004*(1-u));
      },s*edge<0);
    }
  }
  const hub=new THREE.CylinderGeometry(.057,.057,.020,32);
  hub.rotateZ(Math.PI/2);hub.translate(s*.081,0,0);p.add('trim',hub);
  for(let i=0;i<5;i++) ellipsoid(p,'chrome',point(.041,i*Math.PI*2/5,.092),[.005,.006,.006]);
  ellipsoid(p,'glass',[s*.093,0,0],[.006,.026,.026]);
  return p.finish();
}
