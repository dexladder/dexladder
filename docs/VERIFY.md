# Verify it yourself

DexLadder makes several specific claims: that it is one file, that it has no runtime dependencies, that it talks to no server of its own, that it passes a large suite of assertions with zero failures, and that the published build is reproducible byte-for-byte from this source.

You do not have to believe any of that. Every one of those claims is checkable in a few minutes, on your own machine, and this page tells you how.

> The build is a Python assembler (`build154.py`) and the gates are Node scripts. There is no npm build step for the app itself; `test/package.json` only carries Playwright for the gate harness.

---

## 1. Reproduce the build

```bash
git clone https://github.com/dexladder/dexladder.git
cd dexladder
npm ci --prefix test          # exact lockfile install — not `npm install`
python3 build154.py
```

The build emits one self-contained HTML file. Check it:

```bash
wc -c dist/index.html          # expect 2727228 for the published build
shasum -a 256 dist/index.html  # macOS / Linux
sha256sum dist/index.html      # Linux
```

Build it twice and hash both outputs — they should be identical:

```bash
python3 build154.py && shasum -a 256 dist/index.html
python3 build154.py && shasum -a 256 dist/index.html
```

Then compare your hash against the hash published with the release. If they match, the file you downloaded and the source in front of you are the same artifact. If they don't, that is worth reporting — see [SECURITY.md](../SECURITY.md).

The byte count is version-specific. A different release will have a different size and a different hash; what should never differ is two builds of the *same* commit.

---

## 2. Run the gates

```bash
node test/gate154.js dist/index.html
```

The gate is the project's proof. It evaluates every claim the app makes about itself and exits non-zero if a single assertion fails. The current build reports:

- **337** gate assertions
- **64** token-contrast checks
- **~20,600** rendered-contrast assertions over 21 surfaces — the exact count moves with live market content, which is why the gate asserts *zero failures* rather than a fixed total
- **40** vertical-rhythm contexts (5 widths x 2 themes)
- **0** failures

Read the output rather than the summary line. Each assertion names what it is checking, so you can find the one that covers whatever you happen to be sceptical about. Every fixed bug in this project's history has a permanent assertion in here — that is the rule contributors work under, and the suite is the accumulated record of it.

A skipped or disabled assertion counts as a failure. If you see one, say so.

---

## 3. Confirm there is no server

This is the claim that matters most, and it is the easiest to check.

**With devtools:** open the app, open the Network panel, and use it. Trade, take a lesson, export your state. You will see requests to public market-data, chain and RSS endpoints — those are the data sources, and they are named in the source. You will not see a request carrying your portfolio, your progress, or an identifier for you anywhere.

**Without any network at all:**

```bash
# Load the file, then disconnect entirely — turn off Wi-Fi, or:
# devtools → Network → Offline
```

Reload the file with the machine offline. The app opens, your saved state is there, the academy runs, and the simulator executes orders. An app that needed a backend could not do that.

**Check the storage yourself.** There are two stores. In the console:

```js
Object.keys(localStorage)               // the working desk
await DLVAULT.ready; DLVAULT.writable() // true when the archive is on
DLVAULT.stats()                         // rows archived, bytes held, quota reported
await DLVAULT.page('txns', 0, 10)       // the ten most recent fills, out of the archive
```

That is the entire footprint. Everything the app remembers about you is in there, on your disk, readable by you, deletable by you.

Watch the Network tab while you run them. Nothing is sent, because there is nowhere to send it.

**Check the export.** `DLVAULT.panel()` writes one file. Reopen it in a text editor: it is JSON, and every field is legible — the keys it carries, the archive row counts, a SHA-256 checksum over the canonical JSON of the payload, and a secp256k1 signature. Change one character of it and import it again; the app refuses the file on the checksum, before it looks at the signature at all.

---

## 4. Read the source

It is one file, so nothing is hidden behind a bundler. Open `dist/index.html` in an editor — it is large, but it is plain and searchable — or read the source modules in the repository, which is the friendlier route.

Places worth looking first:

| If you want to check… | Search for |
| --- | --- |
| That fills aren't faked | the fill engine — book construction, queue position, latency window |
| That the AI cannot invent numbers | the slot/envelope validator that rejects bare numerals |
| That one market snapshot feeds every surface | the canonical snapshot module |
| That disagreeing sources are surfaced, not averaged | the price quorum |
| That "live" means live | the read-time freshness derivation |
| What the tax estimator won't do | its published list of nine limitations |

There is no obfuscation and no minified blob doing something the readable code doesn't describe. If you find one, that is a finding, and we want it.

---

## 5. Check the state bundle

Export your state from within the app. The result is a signed bundle: a file you can open, read, diff, and re-import on another machine. Verify that what it contains is what you expect it to contain — your data and nothing else — and that a modified bundle is rejected on import rather than silently accepted.

---

*Don't trust. Verify.*
