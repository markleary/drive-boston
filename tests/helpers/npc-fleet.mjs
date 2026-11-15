import {readFile} from 'node:fs/promises';
import {prepareNPCVehicles} from '../../src/render/npc-vehicles.ts';
const bytes=await readFile(new URL('../../public/models/traffic-fleet.glb',import.meta.url));
await prepareNPCVehicles(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
/** The matrix a traffic car is drawn with: the fleet places only the level of detail it shows (near first when
 * neither is shown, as for a car that left the network). */
export function trafficMatrix(scene,index,matrix,surface='paint',part=0){
  const group=scene.getObjectByName('AmbientTraffic'),meshes=['near','far'].map(detail=>group.getObjectByName(`NPC ${detail} ${surface}`));
  const shown=meshes.find(mesh=>{const id=mesh.userData.npcInstances[index][part];return id>=0&&mesh.getVisibleAt(id);})??meshes[0];
  return shown.getMatrixAt(shown.userData.npcInstances[index][part],matrix);
}
