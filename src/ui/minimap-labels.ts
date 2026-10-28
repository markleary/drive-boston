import type {Point2,Road} from '../types';

export interface MapLabelBounds {left:number;right:number;top:number;bottom:number;}
export interface MinimapRoadLabel {name:string;text:string;x:number;y:number;angle:number;bounds:MapLabelBounds;}
export interface MinimapLabelView {
  center:Point2; scale:number; width:number; height:number;
  measureText:(text:string)=>number; fontSize?:number; maxLabels?:number;
  reserved?:{x:number;y:number;radius:number}[];
}
type Path={points:Point2[];stations:number[];length:number};
type Anchor={name:string;text:string;path:Path;station:number;point:Point2;priority:number};
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const nodeKey=(p:Point2)=>`${Math.round(p[0]*10)},${Math.round(p[1]*10)}`;

export function abbreviateRoadName(name:string){
  return name.replace(/\bStreet\b/g,'St').replace(/\bAvenue\b/g,'Ave').replace(/\bBoulevard\b/g,'Blvd')
    .replace(/\bParkway\b/g,'Pkwy').replace(/\bRoad\b/g,'Rd').replace(/\bPlace\b/g,'Pl')
    .replace(/\bSquare\b/g,'Sq').replace(/\bTerrace\b/g,'Ter');
}

function at(path:Path,station:number):Point2{
  let low=1,high=path.stations.length-1;
  while(low<high){const mid=(low+high)>>1;if(path.stations[mid]<station)low=mid+1;else high=mid;}
  const a=path.points[low-1],b=path.points[low],t=clamp((station-path.stations[low-1])/(path.stations[low]-path.stations[low-1]),0,1);
  return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
}

/** Join contiguous GIS fragments of one named road. Branches favor the straight
 * continuation, so a name follows the street rather than a short side spur. */
function paths(roads:Road[]):Path[]{
  const edges=roads.filter(r=>r.points.length>1).map(road=>({points:road.points,used:false}));
  const endpoints=new Map<string,number[]>();
  edges.forEach((edge,i)=>{for(const p of [edge.points[0],edge.points.at(-1)!]){const key=nodeKey(p),list=endpoints.get(key)??[];list.push(i);endpoints.set(key,list);}});
  const result:Path[]=[];
  for(const edge of edges){
    if(edge.used)continue;edge.used=true;const points=[...edge.points];
    const extend=()=>{for(;;){
      const end=points.at(-1)!,previous=points.at(-2)!,dx=end[0]-previous[0],dz=end[1]-previous[1],length=Math.hypot(dx,dz)||1;
      let best=-1,bestDot=-.2,reverse=false;
      for(const i of endpoints.get(nodeKey(end))??[]){const candidate=edges[i];if(candidate.used)continue;
        const flipped=nodeKey(candidate.points[0])!==nodeKey(end),next=candidate.points[flipped?candidate.points.length-2:1];
        const distance=Math.hypot(next[0]-end[0],next[1]-end[1]);if(distance<.001)continue;
        const dot=((next[0]-end[0])*dx+(next[1]-end[1])*dz)/length/distance;
        if(dot>bestDot){best=i;bestDot=dot;reverse=flipped;}
      }
      if(best<0)break;const next=edges[best];next.used=true;points.push(...(reverse?[...next.points].reverse():next.points).slice(1));
    }};
    extend();points.reverse();extend();
    const clean=points.filter((p,i)=>i===0||Math.hypot(p[0]-points[i-1][0],p[1]-points[i-1][1])>.001);
    const stations=[0];for(let i=1;i<clean.length;i++)stations.push(stations[i-1]+Math.hypot(clean[i][0]-clean[i-1][0],clean[i][1]-clean[i-1][1]));
    if(stations.at(-1)!>1)result.push({points:clean,stations,length:stations.at(-1)!});
  }
  return result;
}

/** Build stable world-space anchors once. Layout only visits nearby buckets;
 * screen-space exclusions keep text clear of markers and the circular edge. */
export function createMinimapLabeler(roads:Road[]){
  const groups=new Map<string,Road[]>(),buckets=new Map<string,Anchor[]>(),cell=128;
  for(const road of roads){
    if(!road.name||road.width<7||/alley|unnamed|private|service/i.test(road.name))continue;
    const group=groups.get(road.name)??[];group.push(road);groups.set(road.name,group);
  }
  for(const [name,group]of groups){
    const chains=paths(group),length=chains.reduce((sum,p)=>sum+p.length,0),width=Math.max(...group.map(r=>r.width));
    if(width<8&&length<350)continue;
    const priority=width*2+Math.log1p(length)*3,text=abbreviateRoadName(name);
    for(const path of chains){
      const count=Math.max(1,Math.ceil(path.length/36));
      for(let i=0;i<count;i++){
        const station=(i+.5)*path.length/count,point=at(path,station),anchor={name,text,path,station,point,priority};
        const key=`${Math.floor(point[0]/cell)},${Math.floor(point[1]/cell)}`,list=buckets.get(key)??[];list.push(anchor);buckets.set(key,list);
      }
    }
  }
  return ({center,scale,width,height,measureText,fontSize=11,maxLabels=width<160?4:6,reserved=[]}:MinimapLabelView):MinimapRoadLabel[]=>{
    if(scale<=0||Math.min(width,height)<60)return[];
    const cx=width/2,cy=height/2,radius=Math.min(cx,cy)-6,worldRadius=(radius+10)/scale;
    const candidates:{anchor:Anchor;x:number;y:number;distance:number}[]=[];
    for(let x=Math.floor((center[0]-worldRadius)/cell);x<=Math.floor((center[0]+worldRadius)/cell);x++)
      for(let z=Math.floor((center[1]-worldRadius)/cell);z<=Math.floor((center[1]+worldRadius)/cell);z++)
        for(const anchor of buckets.get(`${x},${z}`)??[]){
          const px=(anchor.point[0]-center[0])*scale+cx,py=(anchor.point[1]-center[1])*scale+cy,distance=Math.hypot(px-cx,py-cy);
          if(distance<radius)candidates.push({anchor,x:px,y:py,distance});
        }
    candidates.sort((a,b)=>(b.anchor.priority-b.distance*.04)-(a.anchor.priority-a.distance*.04)||a.anchor.name.localeCompare(b.anchor.name)||a.anchor.station-b.anchor.station);
    const labels:MinimapRoadLabel[]=[],names=new Set<string>(),measurements=new Map<string,number>();
    const exclusions=[{x:cx,y:cy,radius:width<160?16:20},{x:cx,y:14,radius:12},...reserved];
    for(const candidate of candidates){
      const {anchor,x,y}=candidate;if(names.has(anchor.name))continue;
      const textWidth=measurements.get(anchor.text)??measureText(anchor.text);measurements.set(anchor.text,textWidth);
      const half=textWidth/2+3,high=fontSize/2+3,reach=half/scale;
      if(anchor.station<reach||anchor.path.length-anchor.station<reach)continue;
      const a=at(anchor.path,anchor.station-reach),b=at(anchor.path,anchor.station+reach);
      let angle=Math.atan2(b[1]-a[1],b[0]-a[0]);if(angle>Math.PI/2)angle-=Math.PI;if(angle< -Math.PI/2)angle+=Math.PI;
      const cos=Math.cos(angle),sin=Math.sin(angle);
      // Reject hairpins or strongly curved spans: straight text must still sit
      // on the mapped street throughout its length.
      if(Math.hypot(b[0]-a[0],b[1]-a[1])*scale<half*1.8)continue;
      if([-.5,0,.5].some(t=>{const p=at(anchor.path,anchor.station+reach*t);return Math.abs(-(p[0]-anchor.point[0])*sin+(p[1]-anchor.point[1])*cos)*scale>4;}))continue;
      const corners=[-1,1].flatMap(u=>[-1,1].map(v=>[x+cos*half*u-sin*high*v,y+sin*half*u+cos*high*v] as Point2));
      if(corners.some(p=>Math.hypot(p[0]-cx,p[1]-cy)>radius))continue;
      if(exclusions.some(p=>{const dx=p.x-x,dy=p.y-y,rx=Math.abs(dx*cos+dy*sin),ry=Math.abs(-dx*sin+dy*cos);return Math.hypot(Math.max(0,rx-half),Math.max(0,ry-high))<p.radius;}))continue;
      const bounds={left:Math.min(...corners.map(p=>p[0])),right:Math.max(...corners.map(p=>p[0])),top:Math.min(...corners.map(p=>p[1])),bottom:Math.max(...corners.map(p=>p[1]))};
      if(labels.some(label=>bounds.left<label.bounds.right+3&&bounds.right>label.bounds.left-3&&bounds.top<label.bounds.bottom+3&&bounds.bottom>label.bounds.top-3))continue;
      labels.push({name:anchor.name,text:anchor.text,x,y,angle,bounds});names.add(anchor.name);if(labels.length>=maxLabels)break;
    }
    return labels;
  };
}
