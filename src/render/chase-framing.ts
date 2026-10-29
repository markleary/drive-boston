import {Box3,Vector3,type Object3D,type PerspectiveCamera} from 'three';

/** Portrait controls occupy a band below the car, rather than its sides. */
export function portraitChaseInset(touch:boolean,width:number,height:number){
  return touch&&height>width?Math.min(220,height*.46):0;
}

export function groundChaseFraming(riding:boolean,speed:number,zoom:number,lookOffset:number,portrait:boolean){
  const distance=(riding?4.8:7.8)+Math.min(riding?2.5:5,Math.abs(speed)*.16);
  if(!portrait)return{follow:distance*zoom,height:(riding?2.1:2.8)*zoom,ahead:riding?3*Math.max(0,Math.cos(lookOffset)):9,lookHeight:riding?.65:1.5};
  // A narrow screen needs a longer boom to retain a useful horizontal view.
  // Do not let zoom-in put the chassis back beneath the player's thumbs.
  const portraitZoom=Math.max(1,zoom);
  return{follow:distance*1.55*portraitZoom,height:(riding?3.3:4.6)*portraitZoom,ahead:(riding?2:6)*Math.max(0,Math.cos(lookOffset)),lookHeight:riding?.65:1};
}

/** Shift the optical centre into the road area without cropping the canvas.
 * The same projection is used for rendering, culling and screen-space checks. */
export function applyChaseViewOffset(camera:PerspectiveCamera,width:number,height:number,bottomInset:number){
  if(bottomInset>0){
    const offset=bottomInset/2,view=camera.view;
    if(!view?.enabled||view.fullWidth!==width||view.fullHeight!==height||view.offsetY!==offset){
      camera.setViewOffset(width,height,0,offset,width,height);
    }
  }else if(camera.view?.enabled)camera.clearViewOffset();
}

/** Read-only diagnostic: conservative screen bounds of the active vehicle. */
export function vehicleScreenBounds(object:Object3D,camera:PerspectiveCamera,width:number,height:number){
  if(!object.visible)return null;
  object.updateWorldMatrix(true,true);camera.updateMatrixWorld();
  const bounds=new Box3().setFromObject(object),point=new Vector3();
  if(bounds.isEmpty())return null;
  let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
    point.set(x,y,z).project(camera);
    const screenX=(point.x+1)*width/2,screenY=(1-point.y)*height/2;
    left=Math.min(left,screenX);right=Math.max(right,screenX);top=Math.min(top,screenY);bottom=Math.max(bottom,screenY);
  }
  return{left,right,top,bottom};
}
