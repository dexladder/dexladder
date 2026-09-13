# Security

## Reporting

Open a GitHub security advisory on this repository (Security → Report a vulnerability), or a private report through the same tab. Include a reproduction: what you did, what happened, and what an attacker gains. We would rather receive a noisy report than not receive a real one.

Please don't post an exploitable finding in a public issue before it is fixed.

## The threat model is unusual — start here

DexLadder is a client-side application. There is no server, no API to authenticate against, no accounts, no user database, and no session tokens. Most of the classic surface simply does not exist here.

**It handles no real money, and it holds no keys that can spend anything.** There is no deposit path, no withdrawal path, no custody, and no wallet connection that could sign a value-bearing transaction. A total compromise of this app cannot move funds, because there are no funds for it to move.

## In scope

- Cross-site scripting or any injection into the rendered app, including through imported state bundles, pasted content, or third-party feed data (RSS, market data, chain data).
- Anything that causes data to leave the device when the app's stated behaviour is that it does not.
- Forgery or tampering affecting the signed state bundle or the signed proof-of-work certificate.
- Flaws in the WebRTC peer-transfer path — including anything that lets a remote peer write state the local user did not accept.
- A supply-chain or build-integrity issue: a way to produce a build that does not match its source, or to break the byte-for-byte reproducibility of the single-file output.
- Anything that lets untrusted content reach the screen as an authoritative number outside a typed slot.

## Out of scope

- Simulated balances, simulated positions, and simulated P2P trades. They are not real; manipulating your own numbers is not a vulnerability, it is a text editor.
- A user modifying their own `localStorage`. It is their browser and their data.
- Missing server-side controls, rate limits, or headers on infrastructure that does not exist.
- Availability or configuration of third-party data sources.
- Automated scanner output with no demonstrated impact.

## What we will do

Confirm the report, reproduce it, and — per this project's contribution rule — pin it with a permanent gate assertion so the same defect cannot return silently. We will credit you if you want credit and stay quiet if you don't.
