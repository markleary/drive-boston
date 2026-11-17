# Hatch Memorial Shell

The dedicated model in `src/render/hatch-shell.ts` replaces surveyed building
`BOS-E8BPX-5IKAI-U40PV`, including its generic facade, roof, foundation, collision
and far hull. The original tiled survey stays unchanged. The first footprint
vertex `[71.725, -796.081]` identifies its far hull in tile `0_-1`; nearby
buildings are retained. The opening follows the survey's south-southwest front
plane, centered at approximately `[88.06, -791.29]`.

## References

Reviewed November 17, 2026:

- The user's frontal photograph supplies the principal visual reference: warm
  geometric wood inlay, a thin pale stone arch with dark borders, a recessed
  performance area, broad pink-gray base, low side wings and black speakers.
- [Hatch Shell history and design](https://www.hatchshell.com/history.php)
  publishes a 110-foot width, 40-foot height and 160-foot stair base, and
  identifies rustic terrazzo and bronze composer lettering. Those dimensions
  guide the model's scale; the survey fixes its placement and stage elevation.
- [Boston Preservation Alliance: dome rehabilitation](https://www.bostonpreservation.org/advocacy-project/edward-hatch-memorial-shell-dome-rehabilitation)
  documents the rustic terrazzo panel finish and the replacement panel system.
- [Preservation Massachusetts: 2024 award](https://www.preservationmass.org/single-post/edward-a-hatch-memorial-shell-receives-2024-robert-h-kuehn-jr-award)
  describes the dome cladding's history, bronze doors and preservation approach.
- [DCR's 2022 repair application](https://search.boston.gov/sites/default/files/file/2022/10/Hatch%20Shell%20RDA%20-%20revised%20-%209-22-2022.pdf)
  describes granite and terracotta stage surfaces and dressing rooms below the
  upper stage. Its indexed text and cover description were available; the
  full drawing sheets could not be retrieved for direct measurement.

## Interpretation and runtime

This is an original procedural game model, not a measured architectural replica.
The concave shell uses two quarter-ellipsoid skins with opposing normals and an
open mouth. The smooth curve, individual terrazzo joints, herringbone wood,
granite terrace, terracotta-colored orchestra tiers, side stairs, low service
enclosure, bronze doors and speaker cabinets approximate the reference.
Specific panel layouts, depth, wing details and the selection/arrangement of
composer names are interpreted. No reference photograph is distributed as a
texture; all textures are generated locally and deterministically.

The model is persistent and batched by material, so streaming and graphics
quality changes do not bring back an office facade. Exact triangle collision
leaves the opening empty and makes the platform, stairs, shell and wings solid.
The reserved apron and central audience oval prevent generated trees and
furniture from obstructing the architecture and concert sightline. Perimeter
trees and the separate curved building behind the shell remain. A small
time-of-day-dependent material fill approximates daylight reflected into the
wood lining, fading at night; it adds no dynamic lights.

Validation: `node --test tests/hatch-shell.test.mjs` checks surveyed identity,
collision openings and stairs, winding, finite geometry and the geometry budget.
`npx playwright test tests/hatch-shell.spec.ts` captures the lawn, oblique,
on-stage, rear, balanced-quality and mobile-emulation views, and exercises stage
walking and travel away/back. Mobile emulation is not a physical-device test.
