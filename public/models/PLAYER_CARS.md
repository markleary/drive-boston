# Player cars

Settings → Your car selects the original Harbor S4 (the default) or the McLaren GT. The preference is stored locally in `boston-player-car-v1`, retained while riding the Ultra Bee or flying, and restored on reload. Changing the car parks it upright at the current drive surface; a blocked chassis uses the existing nearby-road recovery. Both cars use the same live Rapier body; the old controller, meshes, materials and plate texture are released when replaced.

## Original artwork

The Harbor S4 retains the original coupe silhouette, cream paint and Massachusetts plates. Clearcoat, satin pillars, window seals and body details received small refinements. Its engine controller now sustains an actual **60 mph** on level pavement; previously its nominal 27 m/s limit was undermined by an early power taper and damping.

The GT is an original procedural Three.js mesh in `src/render/mclaren-gt.ts`, built from smooth longitudinal body/canopy lofts, wheel openings, quarter-panel air scoops, thin lamps, long glazed rear hatch, splitter, diffuser, twin exhausts, mirrors, shut lines, drilled discs and split-spoke wheels. Matching front and rear Massachusetts plates use the shared player registration texture, with a front mounting bracket. Paint uses clearcoat and the game's environment reflections. The wheels steer, rotate and follow Rapier suspension independently. Body geometry is merged by material. The geometry is generated locally; no third-party model or photo textures are shipped.

Visual references inspected:

- [McLaren GT launch gallery, CAR](https://www.carmagazine.co.uk/car-news/first-official-pictures/mclaren/grand-tourer/): [side photo](https://car-images.bauersecure.com/wp-images/3390/1752x1168/mclaren_gt_053.jpg) and [rear photo](https://car-images.bauersecure.com/wp-images/3390/mclaren_gt_060.jpg).
- [Front launch photo, Autocar India](https://cdn-s3.autocarindia.com/legacy/cdni/Galleries/20190516041349_mclaren-gt-web-12.jpg).
- [McLaren GT model page](https://www.mclaren.com/cars/us_en/legacy/mclaren-gt).

## GT physics reference and approximation

Primary reference: [McLaren GT technical specification](https://images-stag.jazelc.com/uploads/mclarenlongisland-m2e/McLaren_GT_Technical_Specification_English.pdf), distributed by the McLaren retailer. This is the **GT**, not its GTS successor.

| Parameter | Reference / in-game setting |
| --- | --- |
| DIN kerb mass | 1,530 kg |
| Length / width with mirrors / height | 4.683 / 2.095 / 1.213 m reference |
| Wheelbase | 2.675 m |
| Front / rear track | 1.671 / 1.663 m |
| Front tire | 225/35 R20; .33275 m radius |
| Rear tire | 295/30 R21; .3552 m radius |
| Engine | 4.0 L twin-turbo V8; 456 kW / 612 bhp; 630 Nm reference |
| Transmission / driven wheels | Seven-speed automatic + reverse / rear-wheel drive |
| Maximum speed | 326 km/h (202.6 mph, rounded to 203) |
| 0–60 mph / 0–100 / 0–200 km/h | 3.1 / 3.2 / 9.0 seconds reference |
| 100–0 km/h braking | 32 m reference |

The four raycast wheels use distinct front/rear tire radii, GT mass, rearward centre of mass, lower ride height, stiffer springs, shorter travel, stronger damping/brakes and more tire grip. Acceleration is traction-limited at launch and power-limited at speed; rolling resistance and quadratic aero drag replace the original car's linear damping. Engine force is delivered only to the rear wheels. Gear hysteresis avoids repeated shifts around thresholds; a brief torque reduction accompanies each shift. Engine RPM and sound changes use the same physics gearbox.

Unpublished damping, inertia, tire friction, drivetrain loss, drag area, traction limit and shift points are **game calibrations**, not measured McLaren component values. The 630 Nm figure is a reference; force uses a power/traction envelope rather than an asserted factory torque curve. Rapier raycasts approximate the real double-wishbone/adaptive suspension, ABS and traction aids. This is a calibrated game simulation, not a complete engineering model. Flat-surface fixed-step tests at both 60 and 120 Hz verify acceleration, terminal speed, braking, reverse and all seven gears; hills, collisions and tire contact can change performance in Boston.

Measured after a settled launch: 0–60 in 3.13 s, 0–100 in 3.23–3.24 s, 0–200 in 8.88–8.91 s, 100–0 braking in 32.09–32.21 m. Terminal speed is approximately 326 km/h.

## Sound

Five additional [ElevenLabs-generated effects](../audio/README.md) total 22 seconds: idle, 4,000 RPM loaded engine, 7,000 RPM high engine, upshift and downshift. The loops crossfade/pitch with RPM and throttle; actual physics gear changes trigger rate-limited shift one-shots and a brief engine duck. They are synthetic interpretations of a GT V8, not recordings of an actual McLaren. Provenance, prompts and hashes are saved in `public/audio/provenance.json`. API credentials stay in local development configuration and are never shipped.
