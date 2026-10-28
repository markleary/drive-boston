# Drive Boston — a connected city

A single-player, free-roaming browser driving prototype built with Three.js, TypeScript, Vite, and Rapier. Explore a continuous section of Boston from Mission Hill and Fenway through Back Bay, Beacon Hill, Downtown, and Chinatown in an ivory coupe or an inspection helicopter. Streets and building models come from Boston's public data; an offline USGS elevation grid supplies the real terrain. Desktop is the primary target; touch devices start in the lighter Balanced graphics mode.

## Run

Node.js 24 LTS is recommended.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite, then select **Start driving**. No API keys, accounts, or runtime map services are needed. All geographic assets ship with the application. The bundled city geometry and geographic metadata total approximately 66 MB before transfer compression, so the first load takes longer than the original Back Bay slice. Subsequent visits can reuse the browser cache.

```sh
npm run build
npm run preview
```

The `dist/` directory is a static site. Vite uses a relative base so it can be hosted at a GitHub Pages repository path. This checkout has not been published or deployed.

## Play

Open **M** to browse the atlas and choose a starting point near Fenway Park, Kenmore Square, the State House, Downtown Crossing, Chinatown Gate, Boston Common, or the Public Garden. **Mission Hill · Parker Hill** starts on an uphill stretch of Parker Hill Avenue, and **Brigham Circle** explores the Huntington Avenue approach. You can also drive continuously from Back Bay along Huntington Avenue; the road connection to Brigham Circle is approximately 3 km. The Mission Hill summit is about 59 m (193 ft) above the original Boylston starting point.

Neighborhood names and boundaries follow the [City of Boston neighborhood GIS layer](https://gisportal.boston.gov/arcgis/rest/services/Basemaps/Boston_Basemap_Cached_WM/MapServer/16). That layer calls the Fenway/Kenmore area **Fenway** and identifies **Longwood**, **Bay Village**, and **Leather District** separately; they are included to make the requested districts one continuous area. Boston Common and the Public Garden are included explicitly as parks. The GIS layer places both within Beacon Hill, while the city's park directory describes them as Downtown; the game consistently uses the GIS polygons for atlas and HUD labels.

| Input | Action |
| --- | --- |
| 1 / 2 | Drive / helicopter |
| W / Up | Accelerate |
| S / Down | Brake, then reverse |
| A / D or Left / Right | Steer |
| Space | Handbrake |
| C | Chase, hood, or aerial camera |
| Mouse drag / wheel | Look around / camera distance |
| M | Open or close the city atlas |
| R | Reset the active vehicle to the Boylston starting point |
| F / N | Horn / sound toggle |
| H | Hide the HUD |
| P | Toggle performance stats |
| Backtick (&#96;) | Toggle debug/location stats |
| Escape | Pause / settings |

In **helicopter mode**, W/S fly forward/backward, A/D move sideways, Q/E turn, **Space rises**, and **Shift descends**. Forward flight reaches about **120 MPH**; releasing the controls brings the aircraft into a hover. The HUD control hints stay visible throughout driving and flight while the HUD is enabled. C switches between chase, cockpit, and overhead views; drag vertically to tilt the aerial inspection view and use the wheel for distance. The instruments display speed in MPH and altitude in feet above the terrain directly below the helicopter. Flight stays inside the prototype boundary, at least 4 meters above terrain and below a ceiling 350 meters above the highest terrain point, with conservative rotor clearance around buildings and continuous collision checks against bridge decks and detailed building openings. This is assisted exploration flight; landing and aerodynamic damage are not simulated.

Switching to helicopter launches above your car. Switching back returns to that car, which stays in the shared traffic/physics world with its brakes held while you fly. Map destinations reposition the active vehicle. The saved browser position is always the car's location.

Touch controls appear on touch devices, including extra helicopter lift and turn buttons. A standard gamepad supports left-stick steering, right trigger acceleration, left trigger braking, A handbrake, and B reverse. For flight, the gamepad left stick moves horizontally, the right stick turns, and right/left triggers raise/lower the helicopter. The map includes real building footprints, street labels, City of Boston neighborhood boundaries, parks and water, landmarks, pan/zoom, and safe starting points near each landmark. Desktop places appear in a scrolling side panel; phones use a compact scrolling grid below the map. The overview fits the complete connected area, and the target button zooms to your current location. Map/settings screens pause the simulation. Position is saved locally in the browser.

Open **Escape → Graphics** to switch between **Detailed** (contact shading, subtle bloom, frequent local reflection updates) and **Balanced** (lighter shadows and rendering). Both retain the same buildings, streets, traffic, and controls.

Press **P** for performance stats or **backtick (`)** for the debug/location panel; WASD steering remains unchanged. **Copy debug report** captures the active car or helicopter's world coordinates, nearest road name and ID, neighborhood, heading, terrain clearance, view settings, and rendering stats for reporting a problem. Coordinates are meters in the game's local world: X increases east, Z increases south, and Y is height above the local datum, not latitude/longitude or elevation above sea level. Render totals include shadows, reflections, and postprocessing; frame time is a measured frame interval rather than GPU execution time.

## Included

- 3,763 source building or connected-building meshes across 10.02 km² of continuous coverage, retaining all 1,973 models from the Back Bay–Mission Hill version. Nine official neighborhood polygons cover Mission Hill, Longwood, Fenway, Back Bay, Beacon Hill, Downtown, Chinatown, Bay Village, and Leather District.
- 2,259 road paths, 3,248 mapped curb paths, 265 signal locations, and 14 map destinations, all connected to the original starting area through the road network.
- A bundled 6 m terrain grid from USGS 3DEP. Road-specific grading levels streets across their width and smooths local DEM dips while preserving their longitudinal hills. The rendered terrain, Rapier collision mesh, sidewalks, traffic, pedestrians, and helicopter clearance share the corrected grid; road meshes subdivide across slopes and crests.
- Sixteen procedural façade styles: brownstone, redbrick rowhouse, limestone, terracotta, loft, office, modern panel treatments, church masonry/lancets, and five clapboard palettes. Stabilized wall UVs and shallow material relief keep window lines and reflections from rippling across source triangles.
- Mission Hill triple-decker interpretations on 206 candidate source houses, selected from measured height/footprint, detachedness, the official neighborhood boundary, and residential frontage. Three-floor window trim, cornices, and stacked porches use compatible source walls and setbacks. These are inferred architectural types, not address-verified classifications; the original building shapes stay intact.
- A bounded budget of projecting window surrounds, arches, pediments, cornices, brownstone stoops, railings, and storefronts, distributed across the expanded area and checked against source walls. Building geometry is grouped into spatial chunks for visibility culling.
- Additional architectural details aligned to Boston Public Library, Trinity Church, and 200 Clarendon, including BPL's Boylston-facing arches. The Massachusetts State House has a dedicated red-brick central façade, pale stone wings, tall sash windows, an arcaded entrance, white columns, cornices, and balustrades beneath the retained gold dome.
- A gold State House dome treatment aligned to the source model and an original Chinatown Gate at its mapped position and orientation. Fenway Park combines the measured stadium shell with mapped field/stand outlines, a regulation diamond, Green Monster, foul poles, bullpens, thousands of instanced seats, scoreboards, lights, and street signage. Decorative details are original interpretations.
- Boston Common, Public Garden, and Back Bay Fens with mapped open-space boundaries, water bodies, and pedestrian paths, plus procedural planting and furnishings. The full area contains 231 open-space polygon parts, 21 water bodies, and 600 park paths. Copley Square retains its raised grove, fountain jets, and seating interpretation. Maple, elm, honey-locust, and white-pine silhouettes have species-specific cutout foliage, branching, subtle wind, and three distance levels; their placements and species are procedural.
- Grass uses small-scale blade texture and relief, broad color/mowing variation, and nearby geometric tufts that avoid mapped paths, buildings, and water. Occasional shallow roadside puddles reflect the local environment; these are decorative wet patches, not a weather or drainage simulation.
- A Rapier raycast vehicle with suspension, braking, reverse, tire slip, and building/traffic collisions.
- An original helicopter with curved canopy, skids, animated main/tail rotors, assisted flight, swept building/roof clearance, and chase/cockpit/overhead views.
- Rooftop mechanical details placed only where the actual source mesh provides a flat clearance area; readable front and back street signs.
- A detailed player coupe; a bounded fleet of up to 64 sedans, crossovers, hatchbacks, and vans. Commercial neighborhoods such as Back Bay, Downtown, and Chinatown target 48 local cars, Fenway/Longwood target 32, and residential areas target 18. Front/rear Massachusetts plates use fictional registrations; parked cars have colliders and meters. No NYC taxi or autonomous-taxi models.
- Two MBTA-style Route 39 buses and two articulated Green Line E trolleys on bundled mapped routes, with rail/catenary detail, station dwells, traffic signals, and player avoidance. The **Huntington · Museum of Fine Arts** destination offers a convenient view of both services. Speeds and frequency are game settings, not live MBTA operations.
- Articulated pedestrians with varied clothing, hair, proportions, bags, and shoes. A pool of up to 112 walkers targets 72 local pedestrians in commercial neighborhoods, 44 in mixed districts, and 26 in residential areas. They follow clearance-checked, terrain-grounded sidewalk routes and pause near moving player vehicles. Ordinary travel relocates only distant actors; map destinations populate the new view immediately. These are game density settings, not measured traffic counts.
- Atmospheric sky, local street reflections, contact shading, directional shadows, selectable golden-hour/day/night lighting, and multi-lens signal heads.
- Seven generated ElevenLabs sound effects: idle/driving engine layers, city ambience, rolling tires, horn, tire scrub, and a helicopter rotor loop. Flight and driving sounds crossfade when switching vehicles. Engine pitch/load and gear changes respond to driving; pause and mute fade all sounds.
- Desktop, touch, and gamepad input; a larger minimap with angled, abbreviated nearby major-road labels, plus the full city atlas with neighborhood labels derived from the official boundary polygons.

## Scope and fidelity

This is a free-roaming exploration prototype with a deliberately limited connected area. The driving surface uses sampled bare-earth terrain with procedural street grading. Source-mapped Bowker/Charlesgate decks and ramps, plus the lower Commonwealth Avenue bridges over the Muddy River, have independent collision surfaces and estimated elevations; other nonzero-level roads and tunnels remain excluded. Bridge guardrails and edge markings follow exposed deck edges, with openings at overlapping ramps and merges; visible barriers and collisions use the same clipped geometry. Road cuts and fine curb ramps are not individually engineered. Raised curb faces and landscaping remain visual detail. Buildings are seated level on their sampled footprint high point, with retaining foundations where needed; this is an approximation on steep sites. Road widths and markings are approximate, and façades and street furniture are artistic interpretations. Storefront labels are fictional; signals use a simplified shared cycle. Pedestrians remain on sidewalk routes and are ambient characters. Most source building surveys date to 2011; the June 2026 model package is not a fresh survey. Most building collisions use conservative convex footprints and can close off courtyards. The Prudential complex, 145 Dartmouth, and Fenway Park instead use their original source triangles, preserving real street and field openings. The map offers landmark repositioning, not turn-by-turn navigation. There are no missions, multiplayer, enterable interiors, or citywide streaming.

The real model geometry is retained, with its vertical placement reconciled to the terrain; the game does not bundle photographic façades. Fenway is a detailed exterior/aerial landmark. Its source stadium collision preserves the open field, but the generated field, seats, and stands are decorative and do not establish a playable stadium interior. House façades, porches, planting, and pedestrians are procedural interpretations rather than a record of each real address or tree. See [DATA_SOURCES.md](DATA_SOURCES.md) for exact sources, licenses, filtering, source dates, coordinate conversion, and asset regeneration.

Reviewing unable12’s Slop San Francisco informed the shared-terrain and draped-road architecture used for the Mission Hill expansion. The implementation and procedural art here are original; its source code was not copied.

## Sound assets

The seven shipped MP3s total 47 seconds and approximately 760 KB. They are generated assets, not recordings of the real neighborhood. Playback is entirely local; the browser never calls ElevenLabs or receives an API key. [Audio notes and provenance](public/audio/README.md) describe generation and runtime behavior.

```sh
node scripts/generate-audio.mjs             # Preview; no provider requests
node scripts/generate-audio.mjs --generate  # Generate missing clips only
```

Generation uses `ELEVENLABS_API_KEY` from the local ignored `.env` or shell environment. Existing audio is never overwritten. Normal play and builds do not require a key.

## Validation

```sh
npm run validate:data
npm run test:physics
npm test
npm run build
```

Browser tests use Playwright with the installed Google Chrome channel and automatically build and serve an isolated production preview. Physics tests check actual-city driving, braking/reverse, fixed-step consistency, collisions, reset behavior, road adherence, player avoidance, signal stops, sidewalk routes, and parked-car collisions. Flight tests additionally check hover, climb, turn, translation, height/boundary limits, reset, and continuous building clearance. Geometry tests check preserved survey vertices/UV continuity, candidate house classification, and Fenway diamond dimensions. Pedestrian tests exercise relocation to Mission Hill, protected nearby actors, route/terrain adherence, stance-foot grounding, and pausing/resuming near a moving car. Browser tests exercise real driving and flight input, vehicle switching, maps, settings, cameras, mobile layout, graphics modes, recorded audio, pause/mute/horn behavior, and WebGL errors. The city expansion flow visits all seven new destinations, drives in Fenway, Beacon Hill, and Chinatown, checks the official neighborhood HUD labels, and inspects Boston Common by helicopter. A phone flow verifies every destination remains reachable in the scrolling atlas. Additional regressions drive onto and under the actual Bowker overpass, preserve deck resets, fly against its deck edges, keep the Huntington/Dartmouth passages open, verify directional signal clearance and transit dwell/avoidance, and exercise the integrated MBTA services in the browser.

## Structure

- `scripts/`: reproducible GIS and OBJ-to-GLB preprocessing.
- `public/data/`: compact city geometry and source provenance.
- `src/physics/`: Rapier simulation.
- `src/render/`: scene, materials, landmark details, and player vehicle.
- `src/simulation/`: traffic, road helpers, and sound.
- `src/ui/`: DOM interface and Canvas maps.

The simulation uses a fixed 60 Hz step and remains separate from the Three.js view. Current work focuses on visual polish and free-roaming driving within this map. Future improvements can refine street grades, junctions, and district landmarks without replacing the shared terrain foundation.
