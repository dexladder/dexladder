# CI and production safeguards

Every pull request must pass `workflow validation` and `reproducible build + gates` before it merges into `main`. Branch protection applies to administrators too, requires the current base branch, and prohibits force pushes and branch deletion. Review approvals are not required for this single-maintainer repository.

`workflow validation` checks every workflow with actionlint 1.7.12. The official release archive is SHA-256 verified before execution. Duplicate YAML keys, invalid Actions syntax, expressions and job dependencies fail the check. Run `bash tools/check-workflows.sh` locally before committing workflow changes. The current helper supports Linux x86_64 and macOS arm64.

`verify` still checks reproducible artifacts, browser behavior and accessibility. Its runs use read-only repository permission, cancel superseded checks for the same branch, and have a 35-minute limit. A real test failure must be repaired; do not delete failure history or loosen assertions to make the dashboard green.

## Production monitoring

The `production health` workflow runs hourly at minute 43 UTC and can be dispatched manually. GitHub runs these checks independently of the owner's computer; scheduled start times are best effort. It records a JSON artifact for 14 days, uses up to three bounded attempts per check, and checks both HTTPS origins, the published payload and worker, resource pages, sitemap, genuine 404s and JSON APIs. Live network health is not a required PR check because unrelated hosting outages must not block source fixes.

Run it manually with:

```sh
python3 tools/production_health.py --output production-health.json
```

`docs/production-health-baseline.json` describes the actual production release. It is deliberately independent of this repository's `dist/index.html`: public source currently builds v166, while production is v167 with newer practice, gas, Flow Desk, onboarding and stability work. The canonical production source is `/Users/mac/Documents/ChatGPT/Dexladder/implementation/web`. Never automatically publish public `dist` over those live hosts. Preserve host-specific functions, workers, static pages, legal pages, headers and routing when releasing.

After a tested and authorized production release, verify both hosts, then update the baseline in a tested PR to its exact payload and worker digests, build and worker revision. Netlify's narrowly recognized host-owned RUM injection is removed solely for core-artifact comparison; its delivered digest is also recorded. Do not ignore arbitrary markup changes or disable TLS verification.

An hourly Codex follow-up in the deployment chat reviews CI and monitor results, stays quiet while healthy or unchanged, and surfaces confirmed failures, recovery or required action. These local follow-ups need the computer awake and the desktop app running; the GitHub hourly health checks continue independently. See [official scheduled task guidance](https://learn.chatgpt.com/docs/automations).

Health-check requests identify themselves as DexLadderProductionHealth and should not be interpreted as audience growth. Inspect current failing run logs before taking action; old Done notifications are historical evidence, not new failures.
