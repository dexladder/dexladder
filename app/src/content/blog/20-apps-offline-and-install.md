DexLadder is one HTML file. That single decision is what lets the same app be a website, an installed app on your phone, a native build and an offline notebook on a train — without four codebases quietly drifting apart.

## The web app

Open the site and you have everything: the desk, the Academy, the ledger, the bots. No sign-up, no email, no wallet connection, nothing to approve. The account is created on your device the moment you arrive, and it belongs to that device.

The site is served from two independent hosts with the identical payload, so an outage at one is a reload away from being someone else's problem.

## Install it

The app ships a web manifest, so any modern browser will offer to install it — *Add to Home Screen* on iOS, *Install* on Chrome and Edge desktop or Android. Installed, it runs standalone: its own icon, its own window, no browser chrome.

Installing changes nothing about how it works. It is the same file, the same account, the same local storage. It is just easier to open, and easier to trust as a daily habit than a tab you keep losing.

## Offline

A service worker caches the payload, so once you have loaded the app it starts without a network.

What still works offline: every lesson and lab, the whole paper-trading engine, your portfolio, the journal, the proof ledger, the backtester, and any desk whose numbers you already have. What does not: live prices, news, and any desk whose whole job is to read the outside world. The app says which is which rather than showing you a stale number as though it were current — the same rule the [data ladder](#/blog/markets-and-the-data-ladder) follows online.

This matters more than it sounds for the audience the Academy is written for. A lesson you can finish on a train, on a patchy connection, in a place where mobile data is expensive, is a lesson that actually gets finished.

## Native builds

- **Android** is packaged from *the same payload bytes* as the website. The build enforces that parity — the packaged app and the deployed site are compared, not assumed — so an Android user is never a version behind by accident.
- **iOS** has its own native application alongside the web build.

The native shells add what a browser cannot give: a real app icon in the launcher, proper background behaviour, and a start that does not depend on a tab. Underneath, the trading engine, the lessons and the ledger are the same.

## The storage rules that make this safe

Your account lives in the browser's local storage under a small set of keys that **never get renamed**. That sounds like an implementation detail and is actually the user-facing promise: a rename would orphan every existing account silently, so the key names are treated as permanent, and retired keys are evicted at boot rather than left to rot.

Because everything is local, the practical advice is short and important: **take backups.** Clearing site data, or resetting a phone, deletes a DexLadder account as thoroughly as it deletes anything else, and there is no server holding a copy — by design. Export from Portfolio; the file restores the whole account, ledger included. See [Sovereignty, the Proof Ledger & On-Device Design](#/blog/sovereignty-proof-ledger).

## One payload, checked

Every release ships as a single file whose bytes are hashed, gated and recorded. The same hash is what the Android package is checked against, what the deploy is verified by, and what the release note names.

@figure layer-stack · A pinned base, layers on top, one file out the other end.

The engineering behind that is in [How DexLadder Is Built](#/blog/how-dexladder-is-built). If you are reading this in a browser tab, the install prompt in the address bar is the whole setup process.
