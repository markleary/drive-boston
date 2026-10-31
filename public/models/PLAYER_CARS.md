# Player cars

Settings → Your car selects the original Harbor S4 (the default), McLaren GT, McLaren 720S or Toyota Supra Mk4. The preference is stored locally in `boston-player-car-v1`, retained while riding the Ultra Bee or flying, and restored on reload. Changing the car parks it upright at the current drive surface; a blocked chassis uses the existing nearby-road recovery. All cars use the same live Rapier body; the old controller, meshes, materials and plate texture are released when replaced.

Pedestrian hit detection takes its footprint from the active physics vehicle, including the GT's longer front/rear bumper reach and the bike's smaller dimensions.

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

## McLaren 720S and Toyota Supra Mk4

The metallic blue 720S coupe and red Supra Mk4 Turbo are original procedural meshes (`src/render/mclaren-720s.ts`, `src/render/supra-mk4.ts`), using shared smooth body/canopy construction in `sports-car-shapes.ts`. Neither reuses the GT body or a downloaded model. Reference photographs were inspected locally; no reference photo or photographic texture is shipped. Each model stays below 40,000 triangles, merges geometry by material, and disposes its owned materials, plate/badge textures and geometry when switched out.

The 720S has teardrop headlamp/intake recesses, the low glass Monocage canopy, double-skin door channels, rear buttresses, high twin exhaust outlets, thin rear lamps and a low raised rear aerofoil. Its 19/20-inch split-spoke wheels use 245/35 front and 305/30 rear tire dimensions. The Supra uses a longer rounded hood, three projectors per headlamp housing, a painted roof and fastback hatch, eight round rear lamp lenses, stock-style five-spoke 17-inch wheels, side brake-cooling vents and a single exhaust. Its low curved factory-style wing has matching upper supports. The solid wing panel and both uprights share the same front/rear attachment points, with a raycast regression check for gaps along either joint. The Supra lamp banks and the 720S lower bumper lenses follow the triangulated rear body surfaces and stay inside the tapered silhouette. Both have matching outward-facing Massachusetts plates front and rear (fictional registrations `7MS 720` and `2JZ 094`).

### Inspected reference photographs

- [720S front three-quarter/side, McLaren Greenwich](https://www.mclarenofgreenwich.com/imagetag/2516/main/l/Used-2019-McLaren-720S-Coupe.jpg).
- [720S rear, MVP Atlanta](https://www.mvpatl.com/imagetag/81/7/l/Used-2020-MCLAREN-720S-Performance.jpg).
- [Toyota's original Supra exterior gallery](https://media.toyota.co.uk/images/supra-exterior-1993-1996/): [front profile](https://media.toyota.co.uk/wp-content/uploads/sites/5/2015/08/Toyota-Supra-1993-1024x739.jpg), [projector/headlamp detail](https://media.toyota.co.uk/wp-content/uploads/sites/5/2015/05/1993-Supra-6.jpg).
- [Toyota launch rear/wing photograph](https://global.toyota/pages/news/older/images/1993/05/24/rendition/19930524_01_10_W610_H407.jpg).

### Physics sources and calibration

- [McLaren 720S manufacturer specifications](https://cars.mclaren.com/en/super-series/720s), with the [manufacturer brochure](https://hcollection.mx/mclaren/img/McLaren_720S_Brochure.pdf) for dimensions and weight distribution.
- [Toyota USA's Supra retrospective](https://pressroom.toyota.com/toyota-supra-icon-half-century-in-making/), and the [1997 Toyota Product Source, page 7](https://xr793.com/wp-content/uploads/2025/12/1997-Toyota-Supra-Product-Source.pdf) for the US twin-turbo six-speed hardtop, tire sizes, curb weight and performance. The hardtop's listed 3,445 lb is rounded to 1,563 kg. This is the stock 320 hp US specification, not a tuned drag car or the 280 PS Japanese model.

| Parameter | 720S | Supra Mk4 Turbo |
| --- | ---: | ---: |
| Mass | 1,419 kg DIN | 1,563 kg hardtop |
| Power | 530 kW / 720 PS | 239 kW / 320 hp |
| Wheelbase | 2.670 m | 2.550 m |
| Front/rear track | 1.674 / 1.629 m | 1.520 / 1.525 m |
| Drive | Rear wheels | Rear wheels |
| Gearbox | Seven-speed SSG approximation | Six-speed manual with automatic clutch/shift assist |
| Shift torque interruption | 60 ms | 220 ms |
| Speed cap | 341 km/h (212 mph) | 155 mph electronic limit |
| Measured 0–60 mph, 60 / 120 Hz | 2.800 / 2.808 s | 4.600 / 4.608 s |
| Measured 0–100 km/h | 2.900 / 2.908 s | 4.817 / 4.825 s |
| Measured 0–200 km/h | 7.750 / 7.775 s | 17.083 / 17.092 s |
| Measured 100–0 km/h distance | 30.11 / 30.23 m | 35.59 / 35.70 m |

Published targets include 720S 0–100 in 2.9 s, 0–200 in 7.8 s and 100–0 in 30 m, and Supra 0–60 in 4.6 s with 155 mph limiter. The Supra's 100–0 calibration corresponds approximately to Toyota's cited 109 ft 60–0 road test; its 0–200 figure above is a simulation measurement, not a claimed factory target. Level-road terminal measurements settle around 340.8 km/h and 249.45 km/h respectively.

Rapier raycast suspension uses each car's mass, footprint, wheel sizes, weight bias, suspension travel, spring/damper response, steering and grip limits. Rear-wheel traction caps launch force; wheel power, rolling resistance and quadratic aerodynamic drag govern acceleration at speed. The six/seven gear shift points, effective drivetrain efficiencies (74% / 84%), drag areas (.724 / .64 m²), traction caps, inertias and suspension coefficients are calibrated game approximations, not measured factory component values. The gearbox reports the same RPM and gear to the HUD and audio. Neither proprietary McLaren hydraulic chassis control nor a complete tire/engine simulation is claimed.

Focused tests measure acceleration/braking/top speed at both 60 and 120 Hz, all forward gears and reverse, repeated car/bike swaps, correct collision footprints, and full-speed CCD wall collisions. Geometry checks cover dimensions, finite vertices/normals, plate orientation, distinct paint, the lowered Supra wing and the triangle budget. Browser tests exercise both cars, engine/shift playback, saved choices, mode changes, cleanup, audio failure fallback and the four-car mobile settings grid.
