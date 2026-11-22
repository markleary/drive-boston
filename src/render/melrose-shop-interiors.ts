import * as THREE from 'three';
import { hash, seeded } from './materials.ts';

type Room = 'dining' | 'coffee' | 'gifts' | 'barber' | 'florist' | 'office' | 'pharmacy' | 'wine' | 'studio' | 'boutique';

function shopRoom(name: string): Room {
  if (/BARBER/i.test(name)) return 'barber';
  if (/TURNER|RISING EAGLE|TENOCH|BIG FIN/i.test(name)) return 'dining';
  if (/NERO|BRUEGGER|PLANTED|STARBUCKS/i.test(name)) return 'coffee';
  if (/BUCKALEW|Lilah/i.test(name)) return 'gifts';
  if (/PEPPERBERRY|Affairs to Remember/i.test(name)) return 'florist';
  if (/Victoria Hill/i.test(name)) return 'wine';
  if (/CVS/i.test(name)) return 'pharmacy';
  if (/btone/i.test(name)) return 'studio';
  if (/RADA|beauty cafe/i.test(name)) return 'boutique';
  return 'office';
}

/** Original elevations behind the display glass. Furniture near the window is
 * larger than the displays along the back wall. Each theme shares one texture
 * across the tile and has no lettering, so adjacent panes can mirror it. */
function paintRoom(c: CanvasRenderingContext2D, room: Room, seed: number) {
  const rand = seeded(seed);
  const rect = (color: string, x: number, y: number, w: number, h: number) => {
    c.fillStyle = color; c.fillRect(x, y, w, h);
  };
  const poly = (color: string, points: number[][]) => {
    c.fillStyle = color; c.beginPath(); c.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points.slice(1)) c.lineTo(x, y);
    c.closePath(); c.fill();
  };
  const oval = (color: string, x: number, y: number, rx: number, ry: number) => {
    c.fillStyle = color; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
  };
  const frame = (x: number, y: number, w: number, h: number, color: string) => {
    rect('#524b3e',x,y,w,h); rect('#dfcfa7',x+2,y+2,w-4,h-4);
    rect(color,x+4,y+4,w-8,h-8);
  };
  const pendant = (x: number, y: number) => {
    rect('#40382a',x-1,0,2,y);
    poly('#a1804a',[[x-13,y+6],[x-5,y-3],[x+5,y-3],[x+13,y+6]]);
    oval('#fbe8b1',x,y+6,12,2);
  };
  const plant = (x: number, y: number, size: number, flowers = false) => {
    poly('#926a52',[[x-size*.25,y-size*.35],[x+size*.25,y-size*.35],[x+size*.18,y],[x-size*.18,y]]);
    for (let i=0;i<9;i++) {
      const px=x+(rand()-.5)*size*.9, py=y-(.4+rand()*.6)*size;
      poly('#597153',[[x-1,y-size*.31],[px,py],[x+1,y-size*.31]]);
      oval(i%2 ? '#698061' : '#496647',px,py,size*.12,size*.077);
      if (flowers) oval(['#cd9476','#ddcda7','#c27877','#d6ad57'][i%4],px,py-3,size*.086,size*.065);
    }
  };
  const wood = '#916947', iron = '#433e36';
  const wall = room==='barber' ? '#aa4d3d' : room==='studio' ? '#a0afa3' : room==='dining' ? '#93846a' : '#b2a793';
  rect(wall,0,0,480,240);
  poly('#b8aa8e',[[0,0],[480,0],[414,35],[69,35]]);
  poly('#79725e',[[0,240],[480,240],[416,166],[69,166]]);
  poly('rgba(56,45,31,.16)',[[0,0],[69,35],[69,166],[0,240]]);
  poly('rgba(58,48,34,.23)',[[480,0],[414,35],[414,166],[480,240]]);
  for (let x=-120;x<650;x+=73) {
    poly('rgba(44,38,31,.23)',[[x,240],[197+x*.20,167],[x+1,240]]);
  }

  if (room==='dining' || room==='coffee') {
    // Hanging lamps, a back banquette and several fully set cafe tables.
    for (const x of [100,154,208]) {
      frame(x,53,39,32,'#829493');
      poly('#596c60',[[x+4,79],[x+18,64],[x+25,70],[x+35,63],[x+35,80]]);
    }
    rect('#645449',69,100,202,58);
    rect(room==='dining'?'#86614b':'#6e7761',69,103,202,32);
    rect('#493d33',69,135,202,7);
    rect('#baa280',279,69,117,57); rect('#594d3e',285,73,103,42);
    for (let i=0;i<11;i++) {
      const x=287+i*9, y=106-rand()*10;
      rect(['#99a18d','#95654d','#ae966c'][i%3],x,y,4,114-y);
    }
    pendant(118,58); pendant(230,47); pendant(348,55);
    for (const [x,y,scale] of [[93,160,.7],[229,169,.85],[367,192,1.05],[70,222,1.15]]) {
      const w=65*scale;
      for(const side of [-1,1]) {
        const chair=x+side*w*.64;
        rect(iron,chair-7*scale,y-20*scale,3*scale,42*scale);
        rect(iron,chair+8*scale,y-20*scale,3*scale,42*scale);
        rect('#856749',chair-8*scale,y-21*scale,21*scale,13*scale);
        rect('#695444',chair-8*scale,y+3*scale,21*scale,4*scale);
      }
      rect(iron,x-2,y-7*scale,4,31*scale); oval(iron,x,y+23*scale,14*scale,3*scale);
      oval('#ad865f',x,y-9*scale,w*.61,6*scale);
      oval('#ddd5bc',x-w*.26,y-9*scale,7*scale,2*scale);
      rect('#d7d2b3',x+8*scale,y-20*scale,3*scale,10*scale);
    }
    if (room==='coffee') {
      rect('#785f49',300,132,156,49); rect('#c4b299',293,126,175,8);
      rect('#4c5c59',334,105,29,20); rect('#b9b7a8',337,108,19,5);
      for (let i=0;i<4;i++) oval('#b18b54',386+10*i,123,7,4);
    }
  } else if (room==='barber') {
    for (const x of [78,206,330]) {
      frame(x,42,67,64,'#8daba9'); rect('#c6d1c3',x+9,49,12,47);
      rect('#513e33',x-9,112,87,8); rect('#7b5740',x+10,120,60,16);
      // Upholstered chair, chrome footrest and hydraulic pedestal.
      oval('#4d5150',x+32,186,24,5); rect('#b2b3a6',x+29,148,6,37);
      rect('#322e2b',x+10,117,43,32); oval('#403a35',x+32,118,22,6);
      rect('#685249',x+8,145,47,12); rect('#9c9c91',x+2,140,8,6);
      rect('#9c9c91',x+52,140,8,6); rect('#a6a69a',x+35,177,28,4);
    }
  } else if (room==='gifts' || room==='pharmacy' || room==='wine') {
    const paper = room==='pharmacy' ? ['#bccad1','#e4e2d7','#bdbfa4','#93aea3','#bd9080']
      : ['#b17d56','#84968b','#b6a05b','#bd805e','#5f7b83','#a693a5'];
    for (const [left,width] of [[51,120],[182,106],[302,128]]) {
      rect(room==='pharmacy'?'#acae9f':'#6f5844',left,41,width,127);
      for(let row=0;row<4;row++) {
        const shelf=73+row*27;
        for(let x=left+4; x<left+width-8;) {
          const w=room==='wine'?6:4+rand()*12, h=9+rand()*13;
          const color=room==='wine'?['#4e5840','#756044','#565843'][row%3]:paper[Math.floor(rand()*paper.length)];
          rect(color,x,shelf-h,w,h);
          if (room==='wine') { rect(color,x+w*.31,shelf-h-5,w*.38,6); rect('#d9c8a4',x+.5,shelf-8,w-1,5); }
          else rect('#ded4bd',x+1,shelf-h+3,Math.max(1,w-2),1.5);
          x+=w+2+rand()*3;
        }
        rect('#b29b79',left,shelf,width,3);
      }
    }
    if (room==='gifts') {
      rect(wood,32,182,149,10); rect(wood,40,193,6,35); rect(wood,167,193,6,35);
      for(let i=0;i<8;i++) rect(paper[i%paper.length],41+i*15,165+(i%3)*4,13,17-(i%3)*4);
      plant(204,190,42,true);
    }
  } else if (room==='florist') {
    for (const [x,y,size] of [[88,135,52],[139,143,64],[203,135,48],[295,145,77],[375,135,63],[417,159,55]]) plant(x,y,size,true);
    rect(wood,34,147,410,8);
    for(const [x,y,size] of [[45,207,63],[120,218,76],[239,190,62],[339,219,84],[444,211,68]]) plant(x,y,size,true);
  } else if (room==='studio' || room==='boutique') {
    frame(97,47,108,78,'#a8b8ad'); frame(218,47,163,78,'#a1b2a8');
    rect('#d2d1b8',106,56,9,57);
    for(let i=0;i<6;i++) {
      const x=73+i*64;
      if (room==='studio') {
        rect('#58635c',x,154,42,8); rect(iron,x+4,161,3,13); rect(iron,x+33,161,3,13);
      } else {
        rect('#51463b',x+13,92,2,11);
        poly(['#8e6e63','#b2a695','#70818b'][i%3],[[x,110],[x+9,102],[x+18,102],[x+29,110],[x+24,119],[x+20,117],[x+24,144],[x+4,144],[x+8,117],[x+5,119]]);
      }
    }
    if (room==='boutique') rect(iron,58,92,365,3);
  } else {
    for(const x of [98,183,272]) frame(x,55,61,45,'#83958a');
    for(const x of [75,236]) {
      rect('#695d51',x,145,125,9); rect('#74695a',x+4,154,5,36); rect('#74695a',x+113,154,5,36);
      rect('#404e4d',x+37,116,38,24); rect('#a7ada2',x+53,140,5,5);
    }
    plant(409,175,64);
  }

  // Diffuse reflections of windows, a cornice and the trees across the street.
  const sky = c.createLinearGradient(0,0,0,240);
  sky.addColorStop(0,'rgba(170,200,212,.30)'); sky.addColorStop(.53,'rgba(197,208,208,.09)'); sky.addColorStop(1,'rgba(203,197,168,.08)');
  c.fillStyle=sky; c.fillRect(0,0,480,240);
  poly('rgba(204,203,185,.14)',[[0,27],[480,84],[480,92],[0,33]]);
  for(let i=0;i<8;i++) {
    const x=i*66-16, y=42+i*7;
    poly('rgba(65,93,100,.14)',[[x,y],[x+26,y+3],[x+26,y+39],[x,y+36]]);
  }
  for(let i=0;i<140;i++) {
    const x=rand()*480, y=rand()*60+(x/480)*24;
    if(Math.sin(x/53)+Math.sin(y/17)*.7>.2) oval('rgba(60,81,58,.10)',x,y,2+rand()*7,2+rand()*4);
  }
}

export function makeMainStreetInteriors(mobile: boolean) {
  const themes = new Map<Room,THREE.MeshStandardMaterial>();
  const owned: THREE.Material[] = [];
  function forShop(name: string) {
    const room = shopRoom(name), shared = themes.get(room);
    if (shared) return shared;
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .87 });
    material.name = `Main Street ${room} interior`;
    if (typeof document !== 'undefined') {
      const canvas=document.createElement('canvas'); canvas.width=mobile?256:512; canvas.height=canvas.width/2;
      const c=canvas.getContext('2d')!; c.scale(canvas.width/480,canvas.height/240);
      paintRoom(c, room, 911 + hash(room));
      const texture=new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace; texture.anisotropy=4;
      material.map=material.emissiveMap=texture;
      material.emissive.set(0xffffff); material.emissiveIntensity=.25;
    }
    themes.set(room,material); owned.push(material);
    return material;
  }
  return { owned, forShop };
}
