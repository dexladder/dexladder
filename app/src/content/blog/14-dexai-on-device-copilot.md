Most assistants bolted onto a finance app will happily invent a number. DeXaI is built so that it structurally cannot.

## The numeric-slot law

**DeXaI never types a number.**

Every figure it shows is a fact pulled by a named tool and rendered as a slot, carrying its source and its freshness. Prose from a language model may only *reference* those facts by slot. Any bare numeral a model invents is struck out rather than shown.

This is the difference between an assistant that is usually right and one you can act on. "Ether is around 3,400" from a model is a guess dressed as a fact. The same sentence from DeXaI is either a slot filled by the price reader — with the source and the age of the reading attached — or it is not a sentence at all.

## Tools before words

Before it says anything, DeXaI reads. Every tool is an on-device reader of something the app already knows:

`coin` · `market` · `news` · `book` · `journal` · `forecast` · `weather` · `sectors` · `odds` · `learn` (the knowledge base and the Academy) · `calc` · `security` · `pool` · `supply`

So "how is my week going" is answered from your journal, not from a plausible story about a week. "Is this pool safe" runs the security reader against the contract. "What is funding" comes from the knowledge base, which has an entry for everything the app can do.

@figure slot-prose · The model writes the sentence; a named tool fills every number, with its source.

## Actions need a tap

DeXaI can compile an action — an alert, a rung, a forecast, a paper order — and show you the preview. **Nothing changes your book until you confirm it.** The compiled rule is readable before you accept it, so you are approving a specific thing rather than trusting an intention.

The alerts compiler is worth calling out: you say *tell me if this moves more than usual before Friday*, and it produces a rule you can read and edit. The compiler is deterministic on its own — a model can front it, but the app never needs one to make an alert.

## Where it runs

**Device-only by default.** The default configuration runs on your machine, which is the same answer the rest of the app gives to every question about data.

If you want a larger model, the Trust Center is the one place a gateway URL is set — **pasted by you**. The app never holds a key, and the model card states plainly what leaves the device in that configuration, what the memory window is, and which providers are in play.

## What it is good at

- **Reading a screen back to you.** A chart, a coin page, a desk or a lesson, in plain language, with every figure sourced.
- **Answering "why."** Why did this fill worse than the preview; why is this position's liquidation price moving; why is the sector ribbon green and your book red.
- **Teaching.** It knows the Academy and can point at the lab that explains what just happened to you.
- **Drafting rules.** An alert or a rung you can read before you accept it.

## What it will not do

It will not tell you what to buy. It has no view, it makes no recommendation, and there is no path where an assistant inside a paper-trading app becomes financial advice.

It will not invent a figure, as above. And it will not act on your account without a tap.

## The model card

Every claim on this page is restated in the app itself, in the Trust Center: the numeric-slot law, the tool list, the privacy modes, the memory window, and the providers. Alongside it sit DexLadder's laws in plain language and the feed diagnostics — every host the app talks to, with its health and its cooldown.

An assistant that explains a market should be at least as legible as the market. Read the [Security, Privacy and the Trust Center](#/blog/security-and-trust) piece for the rest of that, and [Sovereignty, the Proof Ledger & On-Device Design](#/blog/sovereignty-proof-ledger) for where your data actually lives.
