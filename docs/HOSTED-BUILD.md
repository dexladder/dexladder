# Hosted mobile build

The offline download remains `dist/index.html`. The hosted packager splits that verified artifact into content-addressed scripts and two stylesheets, without changing the desk engines. Classic scripts retain their order and global script boundaries. Optional production layers retain their idle loading order. Body styles remain after dynamically injected head styles in the cascade.

Run after the source build and browser checks:

```sh
python3 tools/hosted-build.py dist /tmp/dexladder-hosted
python3 test/gate-mobile-startup.py dist/index.html
node test/gate-hosted.js /tmp/dexladder-hosted/index.html
```

The hosted worker is minted for the hosted HTML and caches every asset before installation completes. A missing or invalid response rejects installation, so the previous worker can remain usable. Keep all assets, `_headers`, routing rules, legal pages and host-specific APIs together when packaging. `/assets/*` files are immutable because their names contain their content hashes.

The production source is newer than the public source in this repository. Do not deploy this repository's older application over production. Apply and verify the same bounded change in the canonical production source, then package the existing host-specific deployment artifacts. Update the production-health baseline only after both origins and their hosted assets have been verified.
