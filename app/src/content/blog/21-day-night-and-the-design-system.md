An app you look at for hours has to be comfortable in a dark room at midnight and on a phone in sunlight. DexLadder has exactly two appearances — Day and Night — and one rule that governs every colour in both.

## Two modes, and only two

Night is the default. Day is warm rather than white: a paper background, brown-black ink, orange accents.

**Your first visit is seeded from your operating system.** The choice is resolved in the document head before the first paint, so the app never flashes the wrong appearance at you. After that, your own choice is stored, and the operating system is never consulted again — because a person who chose Day at 9pm meant it.

The toggle is a two-state switch, not a menu. Choices sync across tabs. Native form controls follow the mode, so a dropdown in Day mode is a Day dropdown. The transition is a 280-millisecond cross-fade, which `prefers-reduced-motion` switches off along with every other animation in the app.

## What was removed, and why it is worth telling you

Earlier versions had more: a cybernetic palette, a warm-grey dark mode, a display-mode dropdown, a high-contrast overlay and an accent cycler. All of them are gone, along with 151 CSS selectors and 136 rules physically stripped from the payload.

The accent cycler is the instructive one. It wrote accent colours as inline styles on the root element — which outranks every stylesheet — so it silently overrode **both** themes, and that is why, for a while, every call-to-action in the app rendered green regardless of what the design system said. Inline styles on the root element beat everything, and a second appearance axis multiplies the number of combinations anyone has to check.

Two modes can be tested exhaustively. Six cannot.

## Contrast is gated, not reviewed

Every text token — ink, secondary ink, muted, faint — must measure **4.5:1 or better against its background in both modes**, and a gate fails the build if one does not. That is how Day's faintest text was caught at 3.70:1 and fixed.

Beyond the tokens, a render gate walks real screens in both appearances and reports failing foreground-and-background pairs as they actually paint, including inside components that compose their own colours. A blog article is walked as its own surface. The published number is zero failing pairs.

Accessibility that is reviewed at the end of a release decays. Accessibility that fails the build does not.

## The rest of the discipline

- **Test at 393, 800 and 1440 pixels, in both modes.** Six screenshots for every change, not one.
- **No orphan voids on mobile.** A rhythm gate measures empty space and fails a layout that strands a card beside a hole — the failure a three-card strip on a two-column grid produces the moment anything is appended after it.
- **No inline styles.** The architecture gate ratchets against them, which is what caught a legacy layout balancer quietly rewriting article layout with inline style attributes.
- **Colour is never the only signal.** Gains and losses carry shape and sign, not just green and red.
- **Motion is decorative or it is off.** The opening animation is inert to the accessibility tree, has no strobe and no flash frame, and removes itself from the document when it is done.

@figure mode-pair · One layout, two appearances, the same contrast floor in both.

## Figures are drawn, not photographed

Every illustration in this blog — every cover, every diagram — is inline SVG painted from the design tokens at render time. No image files, no colour baked in. That is why they are correct in Day and Night, why they stay sharp at any size, and why the content-security policy can forbid remote images without any of them going blank.

The gates and the architecture behind all of this are in [How DexLadder Is Built](#/blog/how-dexladder-is-built); the policy side is in [Security, Privacy and the Trust Center](#/blog/security-and-trust).
