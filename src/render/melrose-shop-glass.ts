import * as THREE from 'three';
import { seeded } from './materials.ts';

/** Daylight on sash windows across Main Street. Low rooflines, treetops and
 * blinds sit behind the geometric mullions. The entrance reflects at street level. */
export function mainStreetGlass(mobile: boolean) {
  const pane = (variant: number) => {
    const mat = new THREE.MeshStandardMaterial({ color:'#ffffff', roughness:.32, metalness:.06 });
    mat.name = variant === 3 ? 'Main Street glazed door' : 'Main Street upper sash';
    if (typeof document==='undefined') return mat;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = mobile ? 96 : 192;
    const c=canvas.getContext('2d')!, size=canvas.width, r=seeded(2054+variant*31);
    c.scale(size/192,size/192);
    const sky=c.createLinearGradient(0,0,28,192);
    sky.addColorStop(0,['#7594ae','#7693aa','#a4b9c7','#73888e'][variant]);
    sky.addColorStop(.62,variant===3?'#8c9a98':'#a8b9be');
    sky.addColorStop(1,variant===3?'#454e4b':'#6c8184');
    c.fillStyle=sky;c.fillRect(0,0,192,192);
    let x=-8;
    while (x<192) {
      const w=31+r()*40, y=(variant===3?52:113)+r()*27;
      c.fillStyle=variant===3?'#63675f':'#6a7f85';c.fillRect(x,y,w,192-y);
      c.fillStyle=variant===3?'#aaa99a':'#adbbb8';c.fillRect(x,y,w,2);
      c.fillStyle=variant===3?'#3c4e50':'#526a73';
      for(let px=x+5;px<x+w-4;px+=10) { c.fillRect(px,y+8,5,8);c.fillRect(px,y+28,5,8); }
      x+=w;
    }
    // Loose branch silhouettes break up the sky reflection at one edge.
    c.fillStyle='rgba(45,65,59,.18)';
    for(let i=0;i<50;i++) {
      const tx=163+r()*39+(r()-.5)*52, ty=94+r()*76;
      c.beginPath();c.ellipse(tx,ty,4+r()*6,3+r()*5,r()*.8,0,Math.PI*2);c.fill();
    }
    if (variant===1) {
      c.fillStyle='rgba(211,203,177,.83)';c.fillRect(0,0,192,53);
      c.fillStyle='rgba(85,88,79,.35)';
      for(let y=3;y<53;y+=4)c.fillRect(0,y,192,.9);
    } else if (variant===2) {
      const curtain=c.createLinearGradient(0,0,42,0);
      curtain.addColorStop(0,'#b4ada0');curtain.addColorStop(.34,'#e0d8c9');curtain.addColorStop(.72,'#b6b0a3');curtain.addColorStop(1,'#d5cfc3');
      c.fillStyle=curtain;c.fillRect(0,0,36,192);
    }
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
    mat.map=mat.emissiveMap=map;mat.emissive.set('#ffffff');mat.emissiveIntensity=variant===3?.08:.11;
    return mat;
  };
  const owned=[0,1,2,3].map(pane);
  const plate=new THREE.MeshPhysicalMaterial({ color:'#b8c6ca', roughness:.18, metalness:.04, transparent:true,
    opacity:.15,depthWrite:false,clearcoat:.65,clearcoatRoughness:.15 });
  plate.name='Main Street plate glass';
  return {upper:owned.slice(0,3), door:owned[3], plate, owned:[...owned,plate]};
}
export type MainStreetGlass = ReturnType<typeof mainStreetGlass>;
