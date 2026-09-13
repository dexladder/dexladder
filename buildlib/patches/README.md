# Architecture patch bodies

Each `*.js` file here is the COMPLETE replacement text for one legacy function or module in the
payload. `buildlib/arch.py` cuts the original out by brace matching, checks the original's
sha256 against the pin in `arch.py` (so a legacy change can never be silently overwritten), and
splices the file in. The app's parity tests (`web/app/test/*.parity.test.ts`) load these same
files next to the original legacy code and prove they behave identically.

Keep them to one expression or one function each; logic belongs in `web/app/src`.
