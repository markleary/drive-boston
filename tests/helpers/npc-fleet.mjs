import {readFile} from 'node:fs/promises';
import {prepareNPCVehicles} from '../../src/render/npc-vehicles.ts';
const bytes=await readFile(new URL('../../public/models/traffic-fleet.glb',import.meta.url));
await prepareNPCVehicles(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
