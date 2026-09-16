/**
 * DESIGN TOKENS — the single source of truth for every colour, surface, elevation, radius,
 * spacing step, typeface and easing curve in the web payload.
 *
 * The build (buildlib/arch.py, pass A3) deletes every custom-property declaration from every
 * `:root` and `html[data-mode=day]` rule in the payload and emits THIS table instead, as the
 * first stylesheet in <head>. Before 2026-09-10 those two selectors were declared 11 times across
 * the payload — 97 + 42 declarations for 68 + 38 tokens — and the last one silently won (the
 * v153 "warm" palette, for one, was still declared and merely overridden further down).
 *
 * Two modes only (the product law): `night` is the default (no attribute); `day` applies under
 * html[data-mode=day] and only overrides what differs. `night: null` = the token exists in Day only.
 * Changing a value here changes the product; the contrast gates re-verify every text pair.
 */

export interface Token { readonly night: string | null; readonly day?: string }
export type TokenGroup = Readonly<Record<`--${string}`, Token>>;

export const TOKENS = {
  surface: {
    "--bg": { night: "#06090F", day: "#F5F7FB" },
    "--bg-solid": { night: "#04070C", day: "#EEF2F8" },
    "--surface": { night: "#21252E", day: "#FFFFFF" },
    "--surface-2": { night: "#1A1E26", day: "#F1F4F9" },
    "--glass": { night: "rgba(13,19,32,.66)", day: "rgba(255,255,255,.88)" },
    "--glass-2": { night: "rgba(9,14,26,.58)", day: "rgba(241,244,249,.8)" },
    "--glass-line": { night: "rgba(56,72,104,.5)", day: "rgba(13,20,33,.12)" },
    "--line": { night: "#333947", day: "#E3E8F0" },
    "--line-2": { night: "#414959", day: "#CFD7E3" },
    "--line-int": { night: null, day: "#7A879C" },
    "--grid": { night: "rgba(118,185,0,.03)", day: "rgba(13,20,33,.05)" },
    "--nv-topline": { night: "rgba(255,255,255,.055)", day: "rgba(13,20,33,.05)" },
    "--gr-hl": { night: "rgba(148,163,199,.13)", day: "rgba(13,20,33,.10)" },
    "--gr-hl2": { night: "rgba(148,163,199,.07)", day: "rgba(13,20,33,.05)" },
    "--gr-srf": { night: "rgba(255,255,255,.035)", day: "rgba(13,20,33,.028)" },
    "--gr-lift": { night: "rgba(255,255,255,.09)", day: "rgba(47,75,208,.08)" },
  },
  text: {
    "--ink": { night: "#F5F7FA", day: "#0D1421" },
    "--ink-2": { night: "#D2D8E0", day: "#3B4A63" },
    "--muted": { night: "#A6AEB9", day: "#58677E" },
    "--faint": { night: "#9098A4", day: "#5C687D" },
    "--txt-1": { night: "#F2F5FA", day: "#1C2D4A" },
    "--txt-2": { night: "var(--ink-2)" },
    "--txt-3": { night: "#9AA4B8", day: "#5C687D" },
  },
  accent: {
    "--cyan": { night: "#00E5FF", day: "#00728F" },
    "--indigo": { night: "#6D8AFF", day: "#2F4BD0" },
    "--violet": { night: "#9575F7", day: "#6D28D9" },
    "--gold": { night: "#FFB300", day: "#8A6100" },
    "--brand": { night: "linear-gradient(120deg,#00E5FF,#5B7CFF)", day: "linear-gradient(120deg,#00728F,#2F4BD0)" },
    "--brand-warm": { night: "linear-gradient(120deg,#FFB300,#FF7043)" },
    "--fa2": { night: "var(--cyan)" },
  },
  market: {
    "--up": { night: "#00E676", day: "#0B7346" },
    "--up-soft": { night: "rgba(0,230,118,.14)", day: "rgba(11,115,70,.1)" },
    "--down": { night: "#FF7A7A", day: "#C0182B" },
    "--down-soft": { night: "rgba(255,82,82,.14)", day: "rgba(192,24,43,.1)" },
  },
  elevation: {
    "--shadow-sm": { night: "0 1px 2px rgba(0,0,0,.4)", day: "0 1px 2px rgba(13,20,33,.05)" },
    "--shadow": { night: "0 10px 28px -14px rgba(0,0,0,.55)", day: "0 10px 28px -18px rgba(13,20,33,.18)" },
    "--shadow-lg": { night: "0 22px 48px -22px rgba(0,0,0,.62)", day: "0 24px 56px -24px rgba(13,20,33,.22)" },
    "--nv-e1": { night: "0 1px 2px rgba(0,0,0,.4)", day: "0 1px 2px rgba(13,20,33,.06)" },
    "--nv-e2": { night: "0 6px 24px -8px rgba(0,0,0,.55)", day: "0 6px 24px -10px rgba(13,20,33,.14)" },
    "--nv-e3": { night: "0 16px 48px -12px rgba(0,0,0,.65)", day: "0 16px 48px -16px rgba(13,20,33,.18)" },
    "--nv-glow-c": { night: "0 0 24px -6px rgba(0,229,255,.45)" },
    "--nv-glow-g": { night: "0 0 24px -6px rgba(255,179,0,.4)" },
    "--gr-shadow": { night: "0 1px 0 rgba(255,255,255,.035) inset,0 10px 28px -16px rgba(0,0,0,.6)", day: "0 1px 2px rgba(13,20,33,.05),0 10px 28px -18px rgba(13,20,33,.18)" },
  },
  radius: {
    "--r": { night: "20px" },
    "--r-sm": { night: "10px" },
    "--r-xs": { night: "8px" },
    "--gr-r-panel": { night: "16px" },
    "--gr-r-ctl": { night: "12px" },
    "--gr-r-in": { night: "9px" },
  },
  space: {
    "--sp-1": { night: "4px" },
    "--sp-2": { night: "8px" },
    "--sp-3": { night: "12px" },
    "--sp-4": { night: "16px" },
    "--sp-5": { night: "20px" },
    "--sp-6": { night: "24px" },
    "--sp-8": { night: "32px" },
    "--sp-10": { night: "40px" },
    "--sp-12": { night: "48px" },
    "--sp-16": { night: "64px" },
    "--gutter": { night: "clamp(12px,1.1vw,20px)" },
    "--measure": { night: "74ch" },
  },
  type: {
    "--ui-sans": { night: "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif" },
    "--disp": { night: "var(--ui-sans)" },
    "--body": { night: "var(--ui-sans)" },
    "--mono": { night: "\"ui-monospace\",\"SF Mono\",\"Cascadia Mono\",Menlo,Consolas,monospace" },
  },
  motion: {
    "--spring": { night: "cubic-bezier(.34,1.56,.64,1)" },
    "--smooth": { night: "cubic-bezier(.4,0,.2,1)" },
    "--swift": { night: "cubic-bezier(.2,.8,.2,1)" },
    "--gr-ease": { night: "cubic-bezier(.25,.6,.3,1)" },
  },
} as const satisfies Readonly<Record<string, TokenGroup>>;

export type TokenName = { [G in keyof typeof TOKENS]: keyof (typeof TOKENS)[G] }[keyof typeof TOKENS];

/** `var(--name)` with the name type-checked against the table. */
export const v = (name: TokenName): string => `var(${String(name)})`;

/**
 * Semantic roles for new code. Components never name a raw token for meaning — they say "gain",
 * "loss", "warn" — so a palette change is one edit here.
 */
export const ROLE = {
  gain: v('--up'), gainSoft: v('--up-soft'),
  loss: v('--down'), lossSoft: v('--down-soft'),
  warn: v('--gold'),
  info: v('--cyan'),
  ink: v('--ink'), ink2: v('--ink-2'), muted: v('--muted'), faint: v('--faint'),
  surface: v('--surface'), surface2: v('--surface-2'), line: v('--line'), line2: v('--line-2'),
} as const;

export type Status = 'good' | 'bad' | 'warn' | 'info' | 'neutral';

/** Status → foreground / background / border, for pills, badges and banners. */
export const STATUS: Readonly<Record<Status, { readonly fg: string; readonly bg: string; readonly bd: string }>> = {
  good: { fg: ROLE.gain, bg: ROLE.gainSoft, bd: `color-mix(in srgb,${ROLE.gain} 38%,transparent)` },
  bad: { fg: ROLE.loss, bg: ROLE.lossSoft, bd: `color-mix(in srgb,${ROLE.loss} 38%,transparent)` },
  warn: { fg: ROLE.warn, bg: `color-mix(in srgb,${ROLE.warn} 14%,transparent)`, bd: `color-mix(in srgb,${ROLE.warn} 38%,transparent)` },
  info: { fg: ROLE.info, bg: `color-mix(in srgb,${ROLE.info} 12%,transparent)`, bd: `color-mix(in srgb,${ROLE.info} 34%,transparent)` },
  neutral: { fg: ROLE.ink2, bg: ROLE.surface2, bd: ROLE.line },
};

/** Direction of a signed figure → status. 0 and missing data are neutral (never "gain"). */
export function signStatus(x: number | null | undefined): Status {
  return x == null || !Number.isFinite(x) || x === 0 ? 'neutral' : x > 0 ? 'good' : 'bad';
}

function block(sel: string, decls: [string, string][]): string {
  return decls.length ? sel + '{' + decls.map(([k, val]) => k + ':' + val).join(';') + '}' : '';
}

/** The token stylesheet: one :root block (Night) and one Day override block. */
export function tokenCSS(): string {
  const night: [string, string][] = [], day: [string, string][] = [];
  for (const group of Object.values(TOKENS) as TokenGroup[]) {
    for (const [name, t] of Object.entries(group)) {
      if (t.night != null) night.push([name, t.night]);
      if (t.day != null) day.push([name, t.day]);
    }
  }
  return block(':root', night) + block('html[data-mode=day]', day);
}
