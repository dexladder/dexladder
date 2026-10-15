# Hosted mobile build

The production homepage is a small learning page. It offers a risk exercise, calculators, guides, and an explicit simulator entry. It does not download or execute simulator chunks. Existing `/#/…` links redirect to `/app/#/…`, preserving the query and simulator destination.

The full simulator lives at `/app/`. Its core scripts use native deferred loading. After the core is usable, the remaining classic scripts retain their global boundaries and original order, with a bounded twelve-file preload window and a browser task between scripts. The English catalogue loads before modules that use it. Legacy load callbacks receive the actual saved load event; browser lifecycle events are never fabricated. Optional production layers retain their idle execution order and use the same bounded preloading. The loader distinguishes core readiness from extension readiness, and controls remain inert until the core is initialized. Requested panes are selected before first paint to avoid flashing Markets on a Terminal link. Browser Subresource Integrity covers every owned script and stylesheet, including dynamically loaded optional layers. Head and body stylesheets keep their cascade relationship to runtime-injected styles.

The single-file offline artifact remains `dist/index.html` and is published as an explicit attachment at `/downloads/dexladder-offline`, without converting that archive into a split bundle. Package the verified source build with:

```sh
npm --prefix app ci --ignore-scripts --no-audit --no-fund
python3 tools/hosted-build.py dist /tmp/dexladder-hosted
python3 test/gate-mobile-startup.py dist/index.html
node test/gate-hosted.js /tmp/dexladder-hosted/index.html
```

The root worker keeps separate cache keys for the homepage and simulator. It warms and verifies the simulator's content-addressed chunks only after the visitor opens the app. Missing or corrupted assets cannot produce an offline-ready result. Worker cache versions include both homepage and simulator digests, so an app-only update cannot reuse the old cache group. The simulator HTML and chunks are verified before offline readiness. Hash witnesses continue to describe the actual navigation response. Unknown paths and public resource pages never fall back to either app shell.

Deploy the complete output, including `/app/`, `/assets/`, routing, headers and host-specific APIs. Asset filenames contain content hashes and receive immutable cache headers. The app retains relative icons, manifest and narration files.

Production is newer v167, while public source still builds v166. Do not deploy the public application over production. Apply and verify this bounded change in the canonical production source, preserve host-specific deployment files, and update the health baseline only after verifying both origins.

Hosted assets are minified with the existing pinned esbuild dependency. Classic programs are kept separate, public identifiers are not mangled, and the downloadable source artifact is unchanged by minification. The mobile Bitcoin mark is stable from its first render. The browser gate holds an extension response and completes an actual paper trade before extensions finish, then verifies that startup preserves the trade.
