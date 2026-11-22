import * as THREE from 'three';
import type { Building, CityData, Point2 } from '../types.ts';
import { sampleElevation } from '../simulation/terrain.ts';
import { band, inset, outward, rectWindow, wallFrame, wallFrames, Shapes, siteKit, type SiteKit, type V3, type WallFrame } from './site-kit.ts';
import type { MainStreetFrontage, MainStreetShop } from './melrose-main-street-data.ts';
import { EASTMAN_DIRECTORY, mainStreetSigns, type MainStreetSigns } from './melrose-shop-signs.ts';
import { mainStreetGlass, type MainStreetGlass } from './melrose-shop-glass.ts';
import { makeMainStreetInteriors } from './melrose-shop-interiors.ts';

function point(f: WallFrame, s: number, y: number, depth = 0): V3 {
  const [x, z] = f.at(s, depth);
  return [x, y, z];
}

/** A moulding, pier, or fitting whose long axis follows the frontage. */
function part(S: Shapes, m: THREE.Material, f: WallFrame, s: number, y: number, depth: number, w: number, h: number, d: number) {
  const [x, z] = f.at(s, depth);
  S.box(m, w, h, d, x, y, z, f.yaw);
}

function face(S: Shapes, m: THREE.Material, f: WallFrame, s0: number, s1: number, y0: number, y1: number, depth: number, solid = false, u0 = 0, u1 = 1) {
  const a = point(f, s0, y0, depth), b = point(f, s1, y0, depth);
  const c = point(f, s1, y1, depth), d = point(f, s0, y1, depth);
  S.tri(m, a, b, c, [u0,0], [u1,0], [u1,1], solid);
  S.tri(m, a, c, d, [u0,0], [u1,1], [u0,1], solid);
}

function canopy(S: Shapes, k: SiteKit, f: WallFrame, shop: MainStreetShop, s0: number, s1: number, y: number, style: MainStreetFrontage['style']) {
  const m = k.tint('canvas', shop.awning!);
  const projection = style === 'seafood' ? .82 : 1.1, fall = style === 'seafood' ? .3 : .43;
  const start = s0 + .12, end = s1 - .12, width = end - start;
  const stripes = shop.stripe ? Math.round(width / (style === 'tavern' ? .15 : .28)) : 1;
  for (let i = 0; i < stripes; i++) {
    const left = start + width * i / stripes, right = start + width * (i + 1) / stripes;
    const cloth = shop.stripe && i % 2 ? k.tint('canvas', shop.stripe) : m;
    S.poly(cloth, [point(f,left,y,.05), point(f,right,y,.05), point(f,right,y-fall,projection), point(f,left,y-fall,projection)], [0,1,0]);
  }
  face(S, m, f, start, end, y - fall - .19, y - fall, projection);
  for (const edge of [start,end]) {
    S.poly(m, [point(f,edge,y,.05), point(f,edge,y-fall,projection), point(f,edge,y-fall,.05)], edge === start ? [-f.t[0],0,-f.t[1]] : [f.t[0],0,f.t[1]]);
    S.beam(k.iron, point(f,edge,y-.69,.03), point(f,edge,y-fall-.02,projection), .028);
  }
}

/** The upper oriels project their own splayed cheek windows over the sidewalk. */
function oriel(S: Shapes, k: SiteKit, f: WallFrame, at: number, width: number, base: number, top: number, trim: THREE.Material, stacked: boolean, glass: MainStreetGlass) {
  const half = width / 2, proud = .72;
  const plan = [f.at(at-half,-.04), f.at(at-half+.45,proud), f.at(at+half-.45,proud), f.at(at+half,-.04)];
  const frames = S.prism(trim, plan, base, top, { top: k.deck, bottom: trim, solid: false });
  const floors = stacked ? 2 : 1, storey = (top-base)/floors;
  for (let n=0; n<floors; n++) {
    const bottom = base+n*storey;
    for (const side of frames.slice(0,3)) {
      rectWindow(S,k,side,side.length/2,bottom+.44,side.length-.15,storey-.75, {
        glass:glass.upper[(n+frames.indexOf(side))%3], frame:trim, sill:null, panes:[side.length>1.65?2:1,2],
      });
      band(S,trim,side,-.045,side.length+.045,bottom+.18,.18,.11);
      band(S,trim,side,-.09,side.length+.09,bottom+storey-.07,.14,.2);
    }
  }
}

/** Set back the upper deck along each edge of the two slate mansards. */
function mansard(S: Shapes, k: SiteKit, footprint: Point2[], lower: number, top: number) {
  const deck = inset(footprint,-1.12);
  for (let i=0; i<footprint.length; i++) {
    const j=(i+1)%footprint.length, n=outward(footprint,i), a=footprint[i], b=footprint[j], c=deck[j], d=deck[i];
    S.poly(k.slate, [[a[0],lower,a[1]],[b[0],lower,b[1]],[c[0],top,c[1]],[d[0],top,d[1]]], [n[0],.4,n[1]],
      p=>[(p[0]*n[1]-p[2]*n[0])/2, (p[1]-lower)*Math.hypot(1.12,top-lower)/(top-lower)/2],true);
  }
  S.cap(k.deck,deck,top);
}

function upperFacade(S: Shapes, k: SiteKit, f: WallFrame, cfg: MainStreetFrontage, base: number, eave: number, top: number, trim: THREE.Material, glazing: MainStreetGlass) {
  const { style } = cfg, L=f.length;
  const sash = style === 'mansard' ? k.whiteSash : k.tint('sash','#363d3d');
  const glass = glazing.upper[0];
  band(S,trim,f,-.08,L+.08,eave-.08,.16,.34);
  band(S,trim,f,0,L,eave-.30,.12,.17);
  if (style === 'oriels' || style === 'clapboard' || style === 'florist') {
    const count = style === 'clapboard' ? Math.max(4,Math.round(L/4.7)) : 2;
    const spacing=L/count;
    for (let i=0; i<count; i++) {
      const at=(i+.5)*spacing;
      if (style === 'oriels' || (style === 'florist' ? i===1 : i===0 || i===count-2)) {
        oriel(S,k,f,at,Math.min(3.45,spacing*.8),base+3.85,top-.14,trim,style==='oriels',glazing);
      } else {
        rectWindow(S,k,f,at,base+4.35,Math.min(1.25,spacing*.6),2.36,{frame:sash,glass:glazing.upper[i%3],sill:trim,panes:[1,2]});
      }
    }
    return;
  }
  if (style === 'bank') {
    // The brick bank has a deep concrete brow and a single strip of clerestory glass.
    face(S,glass,f,L*.09,L*.9,eave-1.65,eave-1.04,.04);
    band(S,k.castStone,f,-.12,L+.12,eave-.45,.40,.63);
    return;
  }
  if (style === 'shop-row' || style === 'seafood' || style === 'bagel' || style === 'pharmacy') return;

  const modern = style==='modern', eastman=style==='eastman', dormers=style==='mansard';
  const count = Math.max(2,Math.round(L/(eastman ? 6.3 : modern ? 2.75 : dormers ? 3.15 : 3.7)));
  const step=L/count;
  for (let i=0;i<count;i++) {
    const at=step*(i+.5), narrow=eastman && i%3===1;
    const w=modern ? step*.70 : narrow ? 1.05 : eastman ? step*.65 : Math.min(step*.64,2.08);
    const sill=base+(modern ? 4.16 : dormers ? 4.52 : 4.30);
    rectWindow(S,k,f,at,sill,w,modern ? 3.3 : dormers ? 1.90 : 2.32, {
      glass:glazing.upper[i%3], frame:sash, head:modern ? undefined : k.castStone,
      sill:modern ? trim : k.castStone, panes:[eastman && !narrow ? 3 : modern ? 2 : 1,2],
    });
    if (modern) {
      band(S,trim,f,at-w/2,at+w/2,sill+.67,.065,.20);
      for(let u=at-w/2+.12;u<at+w/2;u+=.22) part(S,trim,f,u,sill+.35,.15,.025,.66,.035);
    }
    if (dormers && i % 2 === 0) {
      const dormer = wallFrame(f.at(at-.63,-.02),f.at(at+.63,-.02),f.n);
      part(S,k.trim,f,at,eave+1.27,-.55,1.38,2.14,1.0);
      rectWindow(S,k,dormer,.63,eave+.53,.94,1.49,{glass,frame:k.whiteSash,sill:k.trim,panes:[1,2]});
      part(S,k.trim,f,at,eave+2.38,-.55,1.6,.16,1.15);
      const peak=point(f,at,eave+2.73,.035);
      S.poly(k.trim,[point(f,at-.76,eave+2.41,.035),point(f,at+.76,eave+2.41,.035),peak],[f.n[0],0,f.n[1]]);
      for (const side of [-1,1]) S.beam(k.whitePaint,point(f,at+side*.82,eave+2.42,.07),peak,.12,.095);
    }
  }
  if (modern) {
    band(S,trim,f,-.2,L+.2,eave-.12,.24,.62);
    // A recessed penthouse canopy shades the balcony behind the top cornice.
    const width=L*.89;
    part(S,k.deck,f,L/2,top-.38,-3.05,width,.78,4);
    part(S,k.tint('seam','#777d78'),f,L/2,top+.08,-2.55,width+.9,.14,5.2);
  }
  if (eastman) {
    // The relief between the grouped sashes is a centrepiece in the long brick front.
    const s=step*Math.floor(count/2), tile=k.tint('brick','#875146');
    part(S,tile,f,s,base+5.65,.07,.90,1.78,.14);
    part(S,k.castStone,f,s,base+6.59,.1,1.04,.12,.2);
    for (let x=.28;x<L;x+=.40) part(S,trim,f,x,eave-.25,.09,.14,.12,.18);
  }
}

function shopBay(S: Shapes, k: SiteKit, signs: MainStreetSigns, f: WallFrame, shop: MainStreetShop, cfg: MainStreetFrontage,
  left: number, right: number, floor: number, cornice: number, index: number, trim: THREE.Material, glazing: MainStreetGlass, interior: THREE.Material) {
  const {style}=cfg, centre=(left+right)/2, width=right-left, pier=style==='shop-row'?.32:.19;
  const frame=style==='mansard'? k.whitePaint : style==='shop-row' ? k.tint('sash','#493e38') : trim;
  const entranceWidth=width>9 ? 1.62 : 1.06, entrance=left+width*(index%2 ? .66 : .36);
  const doorLeft=entrance-entranceWidth/2, doorRight=entrance+entranceWidth/2;
  const top=cornice-.68, sill=floor+(style==='modern' ? .19 : .39);

  // Framed plate glass on either side of a recessed, glazed entrance. Behind it
  // the room painting and near counter are on different planes for parallax.
  for (const [a,b] of [[left+pier/2,doorLeft-.09],[doorRight+.09,right-pier/2]]) {
    const span=b-a, mid=(a+b)/2;
    const visible=Math.min(1,span/(2.25*(top-sill)));
    const start=a<entrance ? 0 : 1-visible;
    face(S,interior,f,a,b,sill,top,-.43,false,start,start+visible);
    part(S,frame,f,mid,(floor-1.0+sill)/2,-.15,span,sill-floor+1.0,.42);
    part(S,k.castStone,f,mid,sill-.025,-.06,span,.085,.4);
    const bays=Math.max(1,Math.round(span/2.6));
    for (let i=1;i<bays;i++) part(S,frame,f,a+span*i/bays,(sill+top)/2,.03,.073,top-sill,.12);
    part(S,frame,f,mid,top-.47,.035,span,.065,.12);
    for (const jamb of [a,b]) part(S,frame,f,jamb,(sill+top)/2,-.17,.09,top-sill,.56);
    face(S,glazing.plate,f,a,b,sill,top,.009,true);
    if (style==='eastman' || style==='clapboard') {
      part(S,k.bronze,f,mid,floor+.18,.073,Math.max(.16,span-.23),.026,.035);
    }
  }
  const doorBottom=floor+.035, doorTop=Math.min(floor+2.45,top-.1);
  for (const jamb of [doorLeft,doorRight]) part(S,frame,f,jamb,(floor+top)/2,-.15,.12,top-floor,.59);
  face(S,glazing.door,f,doorLeft,doorRight,doorBottom,top,-.46,true);
  part(S,frame,f,entrance,doorTop,-.42,entranceWidth,.10,.14);
  part(S,frame,f,entrance,doorBottom+.13,-.42,entranceWidth,.26,.13);
  part(S,k.steel,f,doorRight-.17,floor+1.13,-.34,.035,.34,.045);
  part(S,k.castStone,f,entrance,floor+.006,-.24,entranceWidth,.035,.56);
  if (entranceWidth>1.5) part(S,frame,f,entrance,(doorBottom+doorTop)/2,-.42,.06,doorTop-doorBottom,.14);
  for (const edge of [left+pier/2,right-pier/2]) part(S,trim,f,edge,(floor+cornice)/2,-.04,pier,cornice-floor+.09,.30);

  const signY = style==='shop-row' || style==='seafood' || style==='bagel' || style==='pharmacy' ? cornice+.24 : cornice-.29;
  const fascia=style==='mansard' ? k.greenPaint : style==='shop-row' ? k.tint('stucco',cfg.wallColor) : frame;
  band(S,fascia,f,left+.035,right-.035,cornice-.31,.68,.23);
  if (shop.name) {
    const signHeight = style==='bagel' || style==='seafood' || style==='shop-row' ? .81 : .56;
    const signWidth = style==='seafood' || style==='bank' ? width*.9 : Math.min(width*.92, Math.max(2.6,shop.name.length*.36));
    if (style==='seafood') band(S,trim,f,left,right,signY,1.02,.22);
    signs.board(S,f,shop,centre,signY,signWidth,signHeight,.245);
  }
  if (style==='seafood' || style==='bagel' || style==='shop-row' || style==='eastman' && index>0) {
    const count=Math.max(2,Math.round(width/2.8)), y=signY+.53;
    for (let i=0;i<count;i++) {
      const s=left+(i+.5)*width/count;
      const neck=point(f,s,y+.22,.31), rim=point(f,s,y+.09,.47);
      S.beam(k.iron,point(f,s,y+.1,.03),neck,.025);
      S.beam(k.iron,neck,rim,.025);
      S.place(k.iron,new THREE.ConeGeometry(.112,.09,8),rim[0],rim[1]-.03,rim[2]);
    }
  }
  if (shop.awning) canopy(S,k,f,shop,left,right,top+.12,style);
  if (style==='shop-row') {
    const red=k.tint('brick','#986651');
    for (const h of [cornice-.28,cornice+.78]) band(S,red,f,left,right,h,.13,.12);
  }
  if (style==='bank') {
    const atm=left+width*.19;
    part(S,k.redPaint,f,atm,floor+1.16,.085,1.0,1.60,.18);
    part(S,k.iron,f,atm,floor+1.38,.20,.53,.37,.09);
    part(S,k.steel,f,atm,floor+1.02,.22,.68,.105,.22);
  }
}

/** One mapped footprint, with the display bays built into its Main Street wall.
 * All buildings append to one set of per-material buffers for this tile. */
function addMainStreetFrontage(S: Shapes, city: CityData, k: SiteKit, signs: MainStreetSigns, building: Building, cfg: MainStreetFrontage, glazing: MainStreetGlass, interiorFor: (shopName: string) => THREE.Material) {
  const fp=building.footprint, frames=wallFrames(fp), f=frames[cfg.edgeIndex];
  const ground=(s:number,depth:number)=>sampleElevation(city,...f.at(s,depth));
  const base=ground(f.length/2,.06), top=base+cfg.height;
  const mansarded=cfg.style==='mansard' || cfg.style==='oriels';
  const eave=top-(mansarded ? 3.05 : cfg.style==='modern' ? 1.10 : 0);
  const cornice=base+(cfg.style==='shop-row' || cfg.style==='seafood' || cfg.style==='bagel' ? 3.83 : 3.76);
  const wall=k.tint(cfg.style==='clapboard' ? 'clapboard' : cfg.style==='pharmacy' || cfg.style==='shop-row' ? 'stucco' : 'brick', cfg.wallColor);
  const trim=k.tint('sash',cfg.trimColor);
  const bottom=Math.min(...fp.map(([x,z])=>sampleElevation(city,x,z)))-1.0;
  for (const [i,side] of frames.entries()) {
    S.wall(wall,side.a,side.b,i===cfg.edgeIndex ? cornice-.61 : bottom,eave,eave,side.n);
  }
  // End returns and a backing close the continuous retail opening at the back of the glass.
  S.wall(k.opening,f.at(0,-.55),f.at(f.length,-.55),bottom,cornice,cornice,f.n);
  for (const s of [0,f.length]) S.wall(wall,f.at(s,0),f.at(s,-.56),bottom,cornice,cornice,s===0?[-f.t[0],-f.t[1]]:f.t);
  if (mansarded) mansard(S,k,fp,eave,top);
  else S.cap(k.deck,fp,eave);
  upperFacade(S,k,f,cfg,base,eave,top,trim,glazing);
  const weights=cfg.shops.reduce((total,shop)=>total+shop.weight,0);
  const lobbyWidth=cfg.style==='eastman' ? 1.55 : 0;
  const retailWidth=f.length-2*lobbyWidth;
  let left=0;
  for (const [index,shop] of cfg.shops.entries()) {
    const right=left+retailWidth*shop.weight/weights;
    const entrance=left+(right-left)*(index%2 ? .66 : .36);
    shopBay(S,k,signs,f,shop,cfg,left,right,ground(entrance,.06)+.05,cornice,index,trim,glazing,interiorFor(shop.name));
    left=right;
    if (lobbyWidth && (index===0 || index===2)) {
      const s=left+lobbyWidth/2, floor=ground(s,.06)+.05;
      face(S,glazing.door,f,left,left+lobbyWidth,floor,cornice-.65,-.28,true);
      part(S,trim,f,s,floor+.22,-.23,lobbyWidth,.44,.12);
      part(S,trim,f,s,floor+2.23,-.23,lobbyWidth,.09,.12);
      part(S,k.bronze,f,s+.42,floor+1.1,-.15,.045,.35,.055);
      part(S,k.castStone,f,s,floor+.005,-.12,lobbyWidth,.04,.32);
      band(S,trim,f,left,left+lobbyWidth,cornice-.30,.72,.24);
      signs.board(S,f,EASTMAN_DIRECTORY,s,cornice-.28,lobbyWidth-.07,.22,.25);
      left+=lobbyWidth;
    }
  }
}

// A dozen painted trim colours still use the same finish. Record runs of
// colour in the original triangle stream so mobile submits one draw per
// finish without a second copy of the geometry during tile assembly.
const vertexPaint = new WeakMap<THREE.Material,THREE.MeshStandardMaterial>();
class MainStreetShapes extends Shapes {
  readonly kit: SiteKit;
  private readonly tinted = new Map<THREE.Material,THREE.MeshStandardMaterial>();
  private readonly runs = new Map<THREE.Material,{start:number; color:THREE.Color}[]>();
  constructor(mobile: boolean) {
    super();
    const shared=siteKit(mobile);
    this.kit=Object.create(shared) as SiteKit;
    this.kit.tint=(family,color)=>{
      const tint=shared.tint(family,color), source=shared[family];
      let batch=vertexPaint.get(source);
      if (!batch) {
        batch=source.clone();
        batch.name=`Main Street painted ${family}`;
        // Normalised textures in the site kit use linear tints up to 2.
        batch.color.setRGB(2,2,2); batch.vertexColors=true;
        vertexPaint.set(source,batch);
      }
      this.tinted.set(tint,batch);
      return tint;
    };
  }
  override writer(material: THREE.Material) {
    const batch=this.tinted.get(material);
    if (!batch) return super.writer(material);
    const w=super.writer(batch), color=(material as THREE.MeshStandardMaterial).color;
    let runs=this.runs.get(batch);
    if (!runs) this.runs.set(batch,runs=[]);
    if (runs.at(-1)?.color!==color) runs.push({start:w.count,color});
    return w;
  }
  override meshes(name: string) {
    const meshes=super.meshes(name);
    for (const mesh of meshes) {
      const runs=this.runs.get(mesh.material as THREE.Material);
      if (!runs) continue;
      const count=mesh.geometry.getAttribute('position').count, colors=new Uint16Array(count*3);
      for (const [i,{start,color}] of runs.entries()) {
        const end=runs[i+1]?.start??count;
        const r=Math.round(color.r*32767.5), g=Math.round(color.g*32767.5), b=Math.round(color.b*32767.5);
        for (let j=start;j<end;j++) { colors[3*j]=r; colors[3*j+1]=g; colors[3*j+2]=b; }
      }
      mesh.geometry.setAttribute('color',new THREE.BufferAttribute(colors,3,true));
    }
    return meshes;
  }
}

/** Geometry is grouped by finish across the block. The lettering, room art
 * and glazing belong to its tile and are released on eviction or cancellation. */
export function mainStreetBlock(mobile: boolean, owned: THREE.Material[]) {
  const shapes=new MainStreetShapes(mobile), signs=mainStreetSigns(mobile);
  const glazing=mainStreetGlass(mobile), interiors=makeMainStreetInteriors(mobile);
  owned.push(signs.material,...glazing.owned);
  return {
    shapes,
    add(city: CityData, building: Building, cfg: MainStreetFrontage) {
      const previous=interiors.owned.length;
      addMainStreetFrontage(shapes,city,shapes.kit,signs,building,cfg,glazing,interiors.forShop);
      owned.push(...interiors.owned.slice(previous));
    },
  };
}
