import * as THREE from 'three';
import type { Building } from '../types';
import { canvasTexture, seeded } from './materials.ts';
export { isMissionChurch } from '../simulation/building-identities.ts';

// Frame measured from the bundled Tremont Street facade. Both catalog meshes
// depict this church; address-only names do not convey its Romanesque identity.
export const MISSION_CHURCH={x:-2082.4,z:1937.3,tx:.907,tz:.421,width:32,height:72};
type Surface='stone'|'front'|'side'|'annex'|'roof';
export function missionChurchFrame(x:number,z:number){
  const f=MISSION_CHURCH,dx=x-f.x,dz=z-f.z;
  return {u:dx*f.tx+dz*f.tz,v:-dx*f.tz+dz*f.tx};
}

/** Material/UV partition only: keep every measured position and normal. Tall
 * stone spires have no tiled windows; the front gets a rose and round arches. */
export function splitMissionChurchShell(geometry:THREE.BufferGeometry,building:Building,isRoof:boolean){
  const source=geometry.index?geometry.toNonIndexed():geometry,p=source.getAttribute('position'),n=source.getAttribute('normal');
  const groups=new Map<Surface,number[]>(),base=building.baseElevation??15.74;
  for(let i=0;i<p.count;i+=3){
    const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
    const y=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3-base,{u,v}=missionChurchFrame(x,z);
    const front=-n.getX(i)*MISSION_CHURCH.tz+n.getZ(i)*MISSION_CHURCH.tx>.94;
    // The source front towers reach 50m; their pointed stone caps continue to
    // 71m. Treat sloped stone caps as stone even when the tile calls them roof.
    const kind:Surface=y>49&&v>-13?'stone':isRoof?'roof':front&&v>-3&&Math.abs(u)<16?'front':Math.abs(u)<24&&y<49?'side':y<25?'annex':'stone';
    const indices=groups.get(kind)??[];indices.push(i,i+1,i+2);groups.set(kind,indices);
  }
  const parts=[...groups].map(([kind,indices])=>{
    const part=new THREE.BufferGeometry();
    for(const [name,attribute]of Object.entries(source.attributes)){
      const values=new Float32Array(indices.length*attribute.itemSize);
      indices.forEach((index,j)=>{for(let k=0;k<attribute.itemSize;k++)values[j*attribute.itemSize+k]=attribute.getComponent(index,k);});
      part.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize));
    }
    const uv=part.getAttribute('uv'),pp=part.getAttribute('position');
    for(let i=0;i<pp.count;i++){
      const {u}=missionChurchFrame(pp.getX(i),pp.getZ(i)),y=pp.getY(i)-base;
      if(kind==='front')uv.setXY(i,(u+16)/32,y/72);
      else if(kind==='side')uv.setXY(i,uv.getX(i)*6/8,y/54);
      else if(kind==='annex')uv.setXY(i,uv.getX(i),y/18);
      // The plain stone texture is a metric 6m tile, retaining the stable UVs.
    }
    return {kind,geometry:part};
  });
  if(source!==geometry)source.dispose();return parts;
}

/** Original procedural artwork guided by the user's exterior references.
 * Photographs are not shipped. No office-room shader is applied to the church. */
export function createMissionChurchMaterials(){
  function masonry(width:number,height:number,pixelsX:number,pixelsY:number){
    const canvas=document.createElement('canvas');canvas.width=pixelsX;canvas.height=pixelsY;
    const c=canvas.getContext('2d')!,sx=pixelsX/width,sy=pixelsY/height,random=seeded(15451565);
    c.fillStyle='#77776b';c.fillRect(0,0,pixelsX,pixelsY);
    const colors=['#92917e','#a6a28a','#858b7f','#b1a68c','#9c9987','#7f867c','#a8a58f'];
    for(let y=0,row=0;y<height;y+=.4,row++)for(let x=-1;x<width;x+=.85){
      c.fillStyle=colors[Math.floor(random()*colors.length)];
      c.fillRect((x+(row%2)*.425)*sx+1,y*sy+1,.85*sx-2,.4*sy-2);
      c.fillStyle='#e5dfc01a';c.fillRect((x+(row%2)*.425)*sx+2,y*sy+2,.85*sx-4,1);
    }
    const x=(u:number)=>(u+width/2)*sx,y=(h:number)=>pixelsY-h*sy;
    function arch(u:number,bottom:number,w:number,h:number,door=false){
      const xx=x(u),yy=y(bottom),ww=w*sx,hh=h*sy,rx=ww/2,ry=w/2*sy;
      c.beginPath();c.moveTo(xx-rx,yy);c.lineTo(xx-rx,yy-hh+ry);c.ellipse(xx,yy-hh+ry,rx,ry,0,Math.PI,0);c.lineTo(xx+rx,yy);c.closePath();
      c.fillStyle=door?'#34362c':'#253a3c';c.fill();c.strokeStyle='#c1b798';c.lineWidth=.26*sx;c.stroke();
      c.strokeStyle='#7b7b68';c.lineWidth=.10*sx;c.beginPath();c.moveTo(xx,yy);c.lineTo(xx,yy-hh);c.stroke();
      if(!door){c.strokeStyle='#a5a591';c.lineWidth=.055*sx;for(let k=1;k<4;k++){c.beginPath();c.moveTo(xx-rx,yy-hh*k/4);c.lineTo(xx+rx,yy-hh*k/4);c.stroke();}}
    }
    function band(bottom:number,u:number,w:number,h=.22){c.fillStyle='#b6b09a';c.fillRect(x(u-w/2),y(bottom+h),w*sx,h*sy);}
    return {canvas,c,sx,sy,x,y,arch,band};
  }
  const stone=masonry(6,6,512,512),front=masonry(32,72,1024,2048),side=masonry(8,54,256,2048),annex=masonry(6,18,256,1024);
  // Bell openings are confined to the actual belfry band, rather than repeated
  // at office-floor intervals. Each twin tower has two tall, round arches.
  for(const tower of [-9.1,9.1]){
    for(const offset of [-1.4,1.4])front.arch(tower+offset,33.3,1.9,10.4);
    for(const offset of [-1.3,1.3])front.arch(tower+offset,45.3,1.5,3.3);
    front.arch(tower,16.5,2.1,5);front.arch(tower,3.4,1.3,3.2);
    for(const h of [11.2,26.8,31.7,44.4,49.2])front.band(h,tower,7.5,.32);
  }
  for(const u of [-3,0,3])front.arch(u,1,2.4,5.6,true);
  for(let u=-4.5;u<=4.5;u+=1.5)front.arch(u,9.2,.95,1.85);
  for(const u of [-2,0,2])front.arch(u,26.8,1,2.5);
  for(const h of [7.6,12.1,25.6])front.band(h,0,12,.32);
  const {c,x,y,sx,sy}=front,cy=19.6;
  c.beginPath();c.ellipse(x(0),y(cy),3.35*sx,3.35*sy,0,0,Math.PI*2);c.fillStyle='#b8ac8d';c.fill();
  c.beginPath();c.ellipse(x(0),y(cy),2.92*sx,2.92*sy,0,0,Math.PI*2);c.fillStyle='#344d58';c.fill();
  // Stone tracery, a central roundel and twelve petal lights.
  for(let k=0;k<12;k++){
    const a=k*Math.PI/6,u=Math.cos(a)*2.05,h=cy+Math.sin(a)*2.05;
    c.beginPath();c.ellipse(x(u),y(h),.48*sx,.48*sy,0,0,Math.PI*2);c.fillStyle=k%3?'#617379':'#99895c';c.fill();c.strokeStyle='#bcb18f';c.lineWidth=.15*sx;c.stroke();
  }
  c.beginPath();c.ellipse(x(0),y(cy),.85*sx,.85*sy,0,0,Math.PI*2);c.strokeStyle='#c6b997';c.lineWidth=.18*sx;c.stroke();
  for(const bottom of [5.3,18])side.arch(0,bottom,2.1,5.6);
  for(const u of [-1.4,1.4])side.arch(u,33.3,1.9,10.4);
  for(const h of [2.1,14.5,28.5,31.7,44.4,49.2])side.band(h,0,8,.25);
  for(const bottom of [2.2,6.2,10.2,14.2])for(const u of [-1.5,1.5])annex.arch(u,bottom,1.1,2.2);
  const material=(canvas:HTMLCanvasElement,repeat=false)=>new THREE.MeshStandardMaterial({map:canvasTexture(canvas,repeat),roughness:.93,metalness:0});
  return {stone:material(stone.canvas,true),front:material(front.canvas),side:material(side.canvas,true),annex:material(annex.canvas,true),roof:new THREE.MeshStandardMaterial({color:'#545d5e',roughness:.88,metalness:.08})};
}
