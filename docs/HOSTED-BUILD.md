# Hosted mobile build

The production homepage is a small learning page. It offers a risk exercise, calculators, guides, and an explicit simulator entry. It does not download or execute simulator chunks. Existing `/#/…` links redirect to `/app/#/…`, preserving the query and simulator destination.

The full simulator lives at `/app/`. Its classic scripts retain their global boundaries and order and use native deferred loading. The loader exposes readiness after the initial scripts complete and the normal load event fires. Optional production layers retain their idle order. Head and body stylesheets keep their cascade relationship to runtime-injected styles.

The single-file offline artifact remains `dist/index.html`. Package the verified source build with:

```sh
python3 tools/hosted-build.py dist /tmp/dexladder-hosted
python3 test/gate-mobile-startup.py dist/index.html
node test/gate-hosted.js /tmp/dexladder-hosted/index.html
```

The root worker keeps separate cache keys for the homepage and simulator. It warms and verifies the simulator's content-addressed chunks only after the visitor opens the app. Missing or corrupted assets cannot produce an offline-ready result. Worker cache versions include both homepage and simulator digests, so an app-only update cannot reuse the old cache group. The simulator HTML and chunks are verified before offline readiness. Hash witnesses continue to describe the actual navigation response. Unknown paths and public resource pages never fall back to either app shell.

Deploy the complete output, including `/app/`, `/assets/`, routing, headers and host-specific APIs. Asset filenames contain content hashes and receive immutable cache headers. The app retains relative icons, manifest and narration files.

Production is newer v167, while public source still builds v166. Do not deploy the public application over production. Apply and verify this bounded change in the canonical production source, preserve host-specific deployment files, and update the health baseline only after verifying both origins.
