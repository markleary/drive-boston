# CI validation

Pull requests and pushes to `main` run these independent jobs in parallel:

- TypeScript checking and the production build.
- Four balanced shards of runtime tests, including driving physics, collision,
  highway/tunnel geometry, road clearance, traffic and streaming regressions.
- Every Python generator unit test, a fast integrity check of every shipped map
  package, and the road-generation audit against its checked-in baseline.

The final `validate` status requires all jobs to pass. A new PR commit cancels
validation of the superseded commit. Pages deployment still waits for validation
and uses its build artifact, avoiding a second install and build.

`scripts/run-ci-tests.mjs` discovers new `tests/*.test.mjs` files automatically.
Its explicit exclusions are limited to crosswalk paint placement, facade UVs,
building identity/style, neighborhood landmark decoration and State House
materials. The full test command remains unchanged; no test files were removed.

## Exhaustive checks

The **Exhaustive map validation** workflow is available through Actions → Run
workflow. It runs three independent jobs: the entire Node suite, exact map
generation replay, and the whole-map street furniture/pedestrian audit. Run it
after substantial map regeneration or changes to the excluded visual details.
These checks remain available locally:

```sh
npm run test:physics
npm run validate:data
npm run audit:furniture
```

The normal workflow deliberately does not replay every generator or sample every
pedestrian route. Its map checks still reject malformed packages and new findings
in the road audit. Exhaustive shell winding, far-massing reconstruction,
building/road overlap, spawn/destination geometry and source-replay checks remain
in the manual workflow; this is reduced coverage, not a substitute for those
audits after major map changes.

To reproduce an individual CI shard or inspect its file list:

```sh
npm run test:ci -- --shard 1/4
npm run test:ci -- --shard 1/4 --list
npm run validate:package
```

The previous sequential CI run for PR #139 took about 29 minutes: 16m27s for map
replay, 9m03s for Node tests, 1m29s for Python tests, 1m20s for the furniture audit
and 20s for the road audit. Those timings motivated separating exhaustive checks
and splitting the retained tests; they are a baseline, not a guaranteed runtime.
