Most apps keep your data on their servers and give you a window onto it. DexLadder does the opposite: your data stays on your device, and the app is the window. This article explains why we built it that way, what the proof ledger is, and how to back up, verify and restore everything you have done — without an account, and without trusting us.

## Why on-device

A paper-trading app does not need to know who you are. It needs prices, which are public, and your paper book, which is yours. Putting that book on a server would add risk without adding anything you need: a database to breach, a login to phish, a company that could read your trades.

So DexLadder has no backend that stores user data. Your balances, orders, journal, lesson progress, badges and certificate are saved in your browser's storage on your device. The app fetches public market data directly from public sources; it does not send your book anywhere to get it.

The trade-off is real and we state it: **there is no "forgot my password"**. If you clear your browser's site data, uninstall the installed app, or switch devices, your paper account does not follow you — unless you took a backup. The rest of this article is about making that easy.

## The proof ledger

Every paper transaction you make — a buy, a sell, a deposit of paper funds, and a few milestones such as surviving the daily challenge — is written into a small blockchain that lives on your device. We call it the **proof ledger**.

Each block holds:

- its position in the chain and the time it was written,
- what happened (the type, the asset, the amount, the value and the quote currency),
- the hash of the block before it,
- and its own SHA-256 hash, computed over all of the above.

```
hash = SHA-256( index | time | type | details | previous hash )
```

The first block is a genesis block with a fixed message. Every block after it is chained to the one before. That is the whole trick, and it is the same trick a public blockchain uses: **change any detail in any block and its hash no longer matches — and neither does every link after it.**

@figure ledger-chain · Change one detail in one block and its hash no longer matches — and neither does every link after it.

### Verifying it

In Portfolio, or from the command palette, you can **verify the proof ledger**. The app re-hashes every block and walks every link. It reports one of three results:

- everything checks out, with the number of blocks and the tip hash;
- a **link is broken** — a block's previous-hash does not match the block before it;
- a block's **content changed** — its recomputed hash differs from the one it was sealed with.

The ledger cannot stop you from editing your own browser storage. What it guarantees is that you cannot do it *quietly*. That is the "proof over promise" idea the genesis block is named for.

### Staying small

A ledger that grows forever would eventually fill your browser's storage. When the chain passes 300 blocks, DexLadder keeps the newest 120 and remembers the hash of the block just before them as the new starting point — the way a light node keeps a checkpoint instead of the whole history. If storage ever fills up anyway, the app trims older history the same way and tells you it did.

## Backups you control

There are two ways to carry your account off the device.

### A plain backup

**Download full account backup (JSON)** saves everything as a file, and **Restore a backup file** loads it back. It is simple and readable — you can open the file in any text editor. It is also unsigned, so it proves nothing on its own.

### A signed sovereign bundle

The Sovereign panel exports a **.cbundle** file: your whole account — balances, ledger, badges, progress — plus a summary (the ledger's height and tip hash, your XP, lessons completed) and a timestamp. The bundle is then **signed with a secp256k1 key that belongs to your device**, and the matching public key is included.

That signature lets anyone check two things without contacting anyone:

1. the bundle was produced by the holder of that key, and
2. not one byte of it changed since.

The Sovereign panel's **Verify a bundle** takes any .cbundle file and tells you whether its signature matches, along with its ledger height, tip and issue date. **Restore** refuses a bundle whose signature does not verify, so a tampered file cannot be loaded as your account.

> Treat a backup file like any file with personal notes in it. It holds your paper book and journal — no real funds, no keys to real wallets — but it is still yours.

## What stays private, and what does not

Being precise about this matters more than sounding reassuring.

- **Stays on your device:** your paper balances and orders, journal notes, lesson progress, XP and streaks, the proof ledger, your certificate name, your settings, and the DexLadder signing key.
- **Leaves your device as ordinary web requests:** requests for public data — prices, candles, gas, block heights — go to the public sources that publish them. Like any website, those sources see a request from your network address. They do not receive your book.
- **Never requested:** an email, a phone number, a wallet connection, a private key or a seed phrase.

The one exception you can opt into is the Local Mesh in the P2P Bazaar: a direct device-to-device WebRTC channel for exchanging a message or a proof with someone you choose. The two of you swap short beacon codes yourselves — over any messenger, or across the room — so there is no signalling server, and nothing passes through a DexLadder server. More in [P2P Bazaar, Explorer and the Rest of the Desk](#/blog/p2p-explorer-and-the-desk).

## The habit to keep

Take a signed bundle after anything you would hate to lose — finishing the lesson path, a month of journaled trades — and keep it somewhere you already back up. Then try **Verify a bundle** on it once, so you know what a good result looks like before you ever need one.

To see how a whole application manages without a server, read [How DexLadder Is Built](#/blog/how-dexladder-is-built). To start your ledger, place a paper trade in the [Terminal](#/terminal) and open [Portfolio](#/portfolio).
