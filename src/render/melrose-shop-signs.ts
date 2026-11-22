import * as THREE from 'three';
import { MAIN_STREET_FRONTAGES, type MainStreetShop } from './melrose-main-street-data.ts';
import type { Shapes, WallFrame } from './site-kit.ts';

export const EASTMAN_DIRECTORY: MainStreetShop = {
  name:'EASTMAN BUILDING', weight:1, signColor:'#383b36', letterColor:'#ddcda7',
};

/** The painted boards on this block share one tile-owned sign sheet. */
export function mainStreetSigns(mobile: boolean) {
  const shops = [...Object.values(MAIN_STREET_FRONTAGES).flatMap(front => front.shops), EASTMAN_DIRECTORY];
  const columns = 2, rows = Math.ceil(shops.length / columns);
  const width = mobile ? 256 : 512, height = mobile ? 40 : 80;
  const material = new THREE.MeshStandardMaterial({ roughness: .74 });
  material.name = 'Main Street shop lettering';
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = columns * width;
    canvas.height = rows * height;
    const ctx = canvas.getContext('2d')!;
    for (const [i, shop] of shops.entries()) {
      const x = (i % columns) * width, y = Math.floor(i / columns) * height;
      ctx.fillStyle = shop.signColor;
      ctx.fillRect(x, y, width, height);
      if (shop.name==='TURNER’S') {
        ctx.fillStyle='#494e42';
        ctx.beginPath();ctx.ellipse(x+width/2,y+height*.35,width*.19,height*.26,0,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=shop.letterColor;ctx.lineWidth=height*.022;ctx.stroke();
        for (const offset of [.14,.86]) {
          const mx=x+width*offset, my=y+height*.5;
          ctx.beginPath();ctx.moveTo(mx-width*.063,my);ctx.lineTo(mx,my-height*.17);
          ctx.lineTo(mx+width*.063,my);ctx.lineTo(mx,my+height*.17);ctx.closePath();ctx.stroke();
        }
      }
      if (shop.name.includes('BARBER')) {
        for (const offset of [.055,.945]) {
          ctx.save();ctx.translate(x+width*offset,y+height*.2);
          ctx.fillStyle='#e8e7d9';ctx.fillRect(-6,0,12,height*.60);
          ctx.beginPath();ctx.rect(-6,0,12,height*.60);ctx.clip();
          ctx.lineWidth=4;
          for(let n=-1;n<5;n++) {
            ctx.strokeStyle=n%2?'#a4534b':'#56768c';
            ctx.beginPath();ctx.moveTo(-7,n*height*.17);ctx.lineTo(7,(n+.6)*height*.17);ctx.stroke();
          }
          ctx.restore();
        }
      }
      ctx.fillStyle = ctx.strokeStyle = shop.letterColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const traditional = /Turner|Barber|Buckalew|Seafood|Bakery|Homes|Wine|Florist|Bagels/i.test(shop.name);
      ctx.font = `${traditional ? 600 : 650} ${Math.round(height * (shop.subline ? .49 : .62))}px ${traditional ? 'Georgia, serif' : 'Arial, sans-serif'}`;
      ctx.fillText(shop.name, x + width / 2, y + height * (shop.subline ? .38 : .52), width * .93);
      if (shop.subline) {
        ctx.font = `600 ${Math.round(height * .23)}px Arial, sans-serif`;
        ctx.fillText(shop.subline, x + width / 2, y + height * .77, width * .9);
      }
      if (traditional) {
        ctx.globalAlpha = .62;
        ctx.lineWidth = Math.max(1, height * .018);
        ctx.strokeRect(x + 4, y + 3, width - 8, height - 6);
        ctx.globalAlpha = 1;
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    material.map = texture;
  }
  return {
    material,
    board(S: Shapes, f: WallFrame, shop: MainStreetShop, centre: number, y: number, w: number, h: number, depth: number) {
      const index = shops.indexOf(shop);
      const col = index % columns, row = Math.floor(index / columns);
      // Half a texel inside the painted background prevents a neighbour's letters bleeding into the border.
      const u0 = (col + 1 / width) / columns, u1 = (col + 1 - 1 / width) / columns;
      const v0 = 1 - (row + 1 - 1 / height) / rows, v1 = 1 - (row + 1 / height) / rows;
      const [ax, az] = f.at(centre - w / 2, depth), [bx, bz] = f.at(centre + w / 2, depth);
      const a: [number, number, number] = [ax, y - h / 2, az], b: typeof a = [bx, y - h / 2, bz];
      const c: typeof a = [bx, y + h / 2, bz], d: typeof a = [ax, y + h / 2, az];
      S.tri(material, a, b, c, [u0,v0], [u1,v0], [u1,v1], false);
      S.tri(material, a, c, d, [u0,v0], [u1,v1], [u0,v1], false);
    },
  };
}
export type MainStreetSigns = ReturnType<typeof mainStreetSigns>;
