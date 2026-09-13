# Contributing

There is one rule here, and everything else follows from it.

## Nothing counts as fixed until a machine says so

A bug is not fixed when the symptom stops appearing. It is fixed when there is a **permanent assertion in the gate that failed before your change and passes after it.** Without that, the bug is not fixed — it is hidden, and it will come back on a build nobody is watching.

So:

**Reporting a bug.** Give us a reproduction. What you did, in order; what you expected; what happened instead; browser and version. If it depends on your saved state, export your bundle and describe the relevant part of it. A report we cannot reproduce cannot be pinned, and a bug that cannot be pinned cannot be closed honestly.

**Fixing a bug.** Write the assertion first. Run the gate and watch it fail — that failure is the proof you found the real defect and not a neighbouring one. Then fix it, and run the gate again. Your pull request should contain both: the assertion and the fix.

**Adding a feature.** Same bar. If it makes a claim — a number, a label, a state — the gate has to be able to check that claim. Anything the app asserts about itself should be verifiable without a human squinting at a screenshot.

## Before you open a pull request

```bash
npm install --prefix test
node test/gate154.js dist/index.html     # must pass with zero failures
python3 build154.py    # must produce the single-file build
```

Zero failures means zero. A skipped assertion is a failure wearing a disguise.

## Style

Match the surrounding code. The single-file build has no runtime dependencies and that is a design constraint, not an accident — a change that adds one needs to argue for itself.

Numbers on screen come from typed tool envelopes, never from prose. If your change puts a numeral in front of a user, it goes through a slot.
