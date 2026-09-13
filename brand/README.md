# Brand assets

- `art-plate-ladder-4k.jpg` — the poster art plate — concentric on-chain liquidity-pool basins, a market-depth stack and cross-chain network filaments in the brand palette. Generated with Kling
  (`gemini-3-pro-image`, 4K, 16:9) from a prompt that explicitly excludes text,
  letters and logos, so no generated glyph or logotype ever reaches a poster.
  Everything legible on a DexLadder poster is vector type and the canonical
  mark, composited on top by `tools/posters.py`.

The mark itself is **not** here — it lives in the private brand repo. The path
data embedded in `tools/posters.py` is copied verbatim from
`brand/dexladder-icon.svg` with the rounded tile removed, and its bounding box
is measured at render time rather than assumed, so the artwork is never
re-drawn or re-traced.

Regenerate the whole poster set:

```bash
pip install cairosvg pillow      # fonts: Inter (rsms/inter) + JetBrains Mono
python3 tools/posters.py brand/art-plate-onchain-4k.jpg
```
