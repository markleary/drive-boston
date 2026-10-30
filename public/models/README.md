# Traffic fleet

`traffic-fleet.glb` is original procedural artwork based on the five vehicle
previews approved in this chat: Honda Civic sedan, Toyota Avalon, Toyota Sienna,
Ford F-150 crew cab, and an E-350 cutaway box truck. No manufacturer meshes or
photographs are included in the game. The player coupe is unchanged.

Regenerate with `npm run build:traffic`. The editable artwork lives in
`scripts/traffic-fleet-source.mjs`; `scripts/build-traffic-fleet.mjs` merges each
material, simplifies with meshoptimizer, preserves registration UVs, and writes
both the GLB and `traffic-fleet-stats.json`. Units are meters, +Z is forward, and
Y=0 is the tire contact patch. Nodes use `<type>-near` and `<type>-far` names.
The normal detail switches to the simpler version at 110 m, back at 90 m.
Moving and parked pools share their immutable model buffers. Material batches
contain all five silhouettes, so more types do not require
five independent draw calls for every surface. Only paint receives instance
colors; glass, trim, lamps, commercial cargo bodies, and plates retain their
own materials. Registration lettering uses the existing player-car canvas art. Every moving
and parked vehicle gets a unique random fictional Massachusetts registration
(excluding the player's number), shared by its front and rear plate faces. A
padded texture atlas keeps the plates crisp without a material/draw call per
vehicle; registrations and paint remain stable through impacts and recovery.

## Physics

`src/simulation/npc-vehicle-specs.ts` owns dimensions, paint palettes, axle
locations and representative **unladen** masses. These are reference variants,
not a claim that every trim or real delivery load has the same mass.

| Type | Mass (kg) | Basis |
| --- | ---: | --- |
| Compact | 1,330 | Civic Sport, approximately 2,935 lb |
| Sedan | 1,676 | Avalon Limited, 3,695 lb |
| Minivan | 2,091 | Sienna LE FWD, 4,610 lb |
| Pickup | 2,241 | F-150 XLT SuperCrew 4WD short bed, 4,941 lb |
| Box truck | 3,126 | E-350 cab/chassis, about 2,226 kg, plus an estimated 900 kg empty box/upfit |

Reference specifications: [Honda](https://hondanews.com/en-US/releases/release-c28e8d1efb94e520fef21ff3f800cb30-2025-honda-civic-sedan-specifications-features),
[Toyota Avalon brochure](https://www.toyota.com/content/dam/toyota/brochures/pdf/2022/avalon_ebrochure.pdf),
[Toyota Sienna](https://www.toyota.com/sienna/2025/compare/summary/),
[F-150 trim specifications](https://www.edmunds.com/ford/f-150/2025/supercrew/features-specs/),
[E-350 chassis specifications](https://www.bartowford.com/new-Bartow-2025-Ford-E%2B350SD-12%2BBOX%2BTRUCK%2BCutaway-1FDWE3FN1SDD25926).

Rapier computes center of mass and rotational inertia from each compound body:
lower-body/cabin hulls, tires, bumper beams, and a separate box-truck cargo
collider. Mass shares put most passenger-car weight in the lower body. The
pickup bed is open above its sides; the cargo box is tall and solid. Vertical
bumper and rocker collision faces prevent the lower body acting as a ramp.
CCD is enabled. AI lane keepers become dynamic before an impact, retain their
compound shape/mass during the collision, apply axle tire forces while upright,
then recover to their lane when clear. Parked cars are sleeping dynamic bodies
and can be moved by an impact. These are rigid-body approximations, with no
crumpling or separately simulated wheel suspension on NPCs.

Traffic keeps a fixed pool of 77 vehicles (previously 64). Local population
targets are 58/38/22 for busy/mixed/residential districts (previously 48/32/18).
The fleet mix favors compact cars and sedans; seven of the 77 are box trucks.
Paint is sampled from each type's realistic palette and remains stable for
that vehicle. Pedestrian density is unchanged.
