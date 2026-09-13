#!/usr/bin/env python3
"""DexLadder poster set — Kling art plate + canonical vector overlay.

Background art: generated with Kling (gemini-3-pro-image, 4K), text-free and
logo-free by design. Mark: copied verbatim from brand/dexladder-icon.svg, its
bounding box measured at render time — never re-drawn. Type: Inter Display +
JetBrains Mono, the app's own stack. Nothing on the poster is invented: every
figure is read from the shipped artifact.
"""
import io, os, sys, pathlib, cairosvg
from PIL import Image, ImageFont, ImageFilter

PLATE  = os.path.expanduser(sys.argv[1] if len(sys.argv)>1 else "~/plates/p1.png")
OUTDIR = pathlib.Path(os.path.expanduser("~/Desktop/DexLadder-Posters")); OUTDIR.mkdir(parents=True, exist_ok=True)
GH     = pathlib.Path(os.path.expanduser("~/Desktop/DexLadder-Backup/dexladder-public/.github/social-preview.png"))

MARK = """<g transform="translate(15,0)">
  <path d="M 260 70 C 500 70, 500 420, 140 420" stroke="url(#fg)" stroke-width="34" stroke-linecap="round" fill="none"/>
  <line x1="260" y1="70" x2="260" y2="180" stroke="#00E5FF" stroke-width="10" stroke-linecap="round"/>
  <rect x="236" y="90" width="48" height="70" rx="10" fill="url(#fg)"/>
  <line x1="200" y1="190" x2="200" y2="300" stroke="#00F2D0" stroke-width="10" stroke-linecap="round"/>
  <rect x="176" y="210" width="48" height="70" rx="10" fill="url(#fg)"/>
  <line x1="140" y1="310" x2="140" y2="420" stroke="#00FFA3" stroke-width="10" stroke-linecap="round"/>
  <rect x="116" y="330" width="48" height="70" rx="10" fill="url(#fg)"/>
  <circle cx="260" cy="70" r="16" fill="#04070C" stroke="#00E5FF" stroke-width="8"/>
  <circle cx="140" cy="420" r="16" fill="#04070C" stroke="#00FFA3" stroke-width="8"/></g>"""
GRAD = ('<linearGradient id="fg" x1="0" y1="512" x2="512" y2="0" gradientUnits="userSpaceOnUse">'
        '<stop stop-color="#00FFA3"/><stop offset="1" stop-color="#00E5FF"/></linearGradient>')
INK, INK2, MUTE, A1, A2 = "#FFFFFF", "#D7DEE8", "#8595A9", "#00FFA3", "#00E5FF"

_p = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="2048" height="2048"><defs>{GRAD}</defs>{MARK}</svg>'
_im = Image.open(io.BytesIO(cairosvg.svg2png(bytestring=_p.encode()))).convert("RGBA")
_a,_b,_c,_d = _im.getbbox(); BX,BY,BW,BH = _a/4,_b/4,(_c-_a)/4,(_d-_b)/4

F = os.path.expanduser("~/.fonts/")
def w_mono(t,s): return ImageFont.truetype(F+"JetBrainsMono-Regular.ttf", int(s*4)).getlength(t)/4
def w_inter(t,s,f="Inter-Regular.ttf"): return ImageFont.truetype(F+f, int(s*4)).getlength(t)/4

TITLE = "DexLadder"
TAG1, TAG2 = "The gateway to Web 3.0.", "Every pool, every chain, one HTML file."
CAPS_T = "DEX radar · contract security · AMM & liquidity · perps · backtester · your own bots · chain forking"
CAPS  = CAPS_T.replace("&", "&amp;")
FACTS = [("MIT",A1),("one HTML file",INK2),("3,241,037 bytes",INK2),("sha256 96f28df0…d45567",INK2),("works offline",A2)]
URL   = "github.com/dexladder/dexladder"

def facts_svg(x, size, maxw, centre_in=None):
    def tot(sz): return sum(w_mono(t,sz) for t,_ in FACTS) + (len(FACTS)-1)*(2*sz*0.85 + w_mono("·",sz))
    while tot(size) > maxw and size > 6: size *= 0.985
    pad = size*0.85
    if centre_in: x = (centre_in - tot(size))/2
    out, fx = [], x
    for i,(t,c) in enumerate(FACTS):
        if i:
            fx += pad
            out.append(f'<text x="{fx:.2f}" y="0" font-family="JetBrains Mono" font-size="{size:.2f}" fill="#5A6B80">·</text>')
            fx += w_mono("·",size) + pad
        out.append(f'<text x="{fx:.2f}" y="0" font-family="JetBrains Mono" font-size="{size:.2f}" fill="{c}">{t}</text>')
        fx += w_mono(t,size)
    return "\n".join(out)

def cover(im, W, H):
    s = max(W/im.width, H/im.height)
    r = im.resize((max(W,int(im.width*s+.5)), max(H,int(im.height*s+.5))), Image.LANCZOS)
    return r.crop((0, (r.height-H)//2, W, (r.height-H)//2 + H))

def overlay(W, H, mode):
    u = min(W,H)/(640 if mode=="wide" else 1080)
    if mode == "wide":
        M   = W*0.055
        tx  = W*0.455
        mh  = 98*u; s = mh/BH
        title, tag, cap, fact, url = 84*u, 30*u, 22*u, 18*u, 20*u
        while w_inter(TAG2, tag, "Inter-Medium.ttf") > W-M-tx: tag *= 0.985
        while w_inter(CAPS_T, cap) > W-M-tx: cap *= 0.985
        o_m, o_t, o_r, o_g1, o_g2, o_c, o_f, o_u = 0, 168*u, 198*u, 270*u, 312*u, 372*u, 436*u, 494*u
        vis_top, vis_bot = -mh, o_u + 8*u
        T = (H-(vis_bot-vis_top))/2 - vis_top
        scrim = (f'<rect width="{W}" height="{H}" fill="url(#scrimx)"/>')
        body = f'''<g transform="translate(0,{T:.2f})">
<g transform="translate({tx - BX*s:.2f},{o_m - mh - BY*s:.2f}) scale({s:.5f})">{MARK}</g>
<text x="{tx:.1f}" y="{o_t:.1f}" font-family="Inter Display" font-weight="700" font-size="{title:.1f}" fill="{INK}" letter-spacing="{-0.030*title:.2f}">{TITLE}</text>
<rect x="{tx:.1f}" y="{o_r:.1f}" width="{270*u:.1f}" height="{4*u:.2f}" rx="{2*u:.2f}" fill="url(#rule)"/>
<text x="{tx:.1f}" y="{o_g1:.1f}" font-family="Inter" font-weight="500" font-size="{tag:.1f}" fill="{INK2}" letter-spacing="{-0.013*tag:.2f}">{TAG1}</text>
<text x="{tx:.1f}" y="{o_g2:.1f}" font-family="Inter" font-weight="500" font-size="{tag:.1f}" fill="{INK2}" letter-spacing="{-0.013*tag:.2f}">{TAG2}</text>
<text x="{tx:.1f}" y="{o_c:.1f}" font-family="Inter" font-weight="400" font-size="{cap:.1f}" fill="{MUTE}">{CAPS}</text>
<g transform="translate(0,{o_f:.1f})">{facts_svg(tx, fact, W-M-tx)}</g>
<text x="{tx:.1f}" y="{o_u:.1f}" font-family="JetBrains Mono" font-weight="500" font-size="{url:.1f}" fill="{A2}">{URL}</text></g>'''
    else:
        M   = W*0.085
        cx  = W/2
        mh  = 96*u; s = mh/BH
        title, tag, cap, fact, url = 104*u, 38*u, 27*u, 22*u, 24*u
        while w_inter(TAG2, tag, "Inter-Medium.ttf") > W-2*M: tag *= 0.985
        while w_inter(CAPS_T, cap) > W-2*M: cap *= 0.985
        base = H*0.60
        scrim = f'<rect width="{W}" height="{H}" fill="url(#scrimy)"/>'
        body = f'''<g transform="translate({cx - BW*s/2 - BX*s:.2f},{base - BY*s:.2f}) scale({s:.5f})">{MARK}</g>
<text x="{cx:.1f}" y="{base+mh+128*u:.1f}" text-anchor="middle" font-family="Inter Display" font-weight="700" font-size="{title:.1f}" fill="{INK}" letter-spacing="{-0.030*title:.2f}">{TITLE}</text>
<rect x="{cx-150*u:.1f}" y="{base+mh+168*u:.1f}" width="{300*u:.1f}" height="{5*u:.2f}" rx="{2.5*u:.2f}" fill="url(#rule)"/>
<text x="{cx:.1f}" y="{base+mh+258*u:.1f}" text-anchor="middle" font-family="Inter" font-weight="500" font-size="{tag:.1f}" fill="{INK2}">{TAG1}</text>
<text x="{cx:.1f}" y="{base+mh+310*u:.1f}" text-anchor="middle" font-family="Inter" font-weight="500" font-size="{tag:.1f}" fill="{INK2}">{TAG2}</text>
<text x="{cx:.1f}" y="{base+mh+382*u:.1f}" text-anchor="middle" font-family="Inter" font-weight="400" font-size="{cap:.1f}" fill="{MUTE}">{CAPS}</text>
<g transform="translate(0,{H-M-86*u:.1f})">{facts_svg(0, fact, W-2*M, centre_in=W)}</g>
<text x="{cx:.1f}" y="{H-M-24*u:.1f}" text-anchor="middle" font-family="JetBrains Mono" font-weight="500" font-size="{url:.1f}" fill="{A2}">{URL}</text>'''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<defs>{GRAD}
<linearGradient id="rule" x1="0" y1="0" x2="1" y2="0"><stop stop-color="{A1}"/><stop offset="1" stop-color="{A2}"/></linearGradient>
<linearGradient id="floor" x1="0" y1="0" x2="1" y2="0"><stop stop-color="{A1}"/><stop offset="0.55" stop-color="{A2}"/><stop offset="1" stop-color="{A1}"/></linearGradient>
<linearGradient id="scrimx" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#04070C" stop-opacity="0"/><stop offset="0.30" stop-color="#04070C" stop-opacity="0.35"/>
  <stop offset="0.44" stop-color="#04070C" stop-opacity="0.90"/><stop offset="0.58" stop-color="#04070C" stop-opacity="0.97"/>
  <stop offset="1" stop-color="#04070C" stop-opacity="0.99"/></linearGradient>
<linearGradient id="scrimy" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#04070C" stop-opacity="0"/><stop offset="0.36" stop-color="#04070C" stop-opacity="0.30"/>
  <stop offset="0.52" stop-color="#04070C" stop-opacity="0.92"/><stop offset="0.66" stop-color="#04070C" stop-opacity="0.98"/>
  <stop offset="1" stop-color="#04070C" stop-opacity="0.99"/></linearGradient></defs>
{scrim}
{body}
<rect x="0" y="{H-max(4,5*u):.1f}" width="{W}" height="{max(4,5*u):.1f}" fill="url(#floor)"/></svg>'''

art = Image.open(PLATE).convert("RGB")
JOBS = [("dexladder-poster-4K-3840x2160.png",3840,2160,"wide"),
        ("dexladder-poster-UHD-wide-5120x2560.png",5120,2560,"wide"),
        ("dexladder-x-card-2400x1200.png",2400,1200,"wide"),
        ("dexladder-poster-square-2160x2160.png",2160,2160,"stack"),
        ("dexladder-poster-vertical-2160x3840.png",2160,3840,"stack"),
        ("__gh",1280,640,"wide")]
def ss_for(W):
    # supersample small targets, render large ones natively; cap by the plate's own width
    if W >= 2400: return 1
    return 4 if W <= 1400 else 2

for name,W,H,mode in JOBS:
    k = ss_for(W)
    base = cover(art, W*k, H*k).convert("RGBA")
    ov = Image.open(io.BytesIO(cairosvg.svg2png(bytestring=overlay(W,H,mode).encode(),
                                                output_width=W*k, output_height=H*k))).convert("RGBA")
    out = Image.alpha_composite(base, ov).convert("RGB")
    if k > 1:
        out = out.resize((W,H), Image.LANCZOS)
        out = out.filter(ImageFilter.UnsharpMask(radius=1.0, percent=55, threshold=2))
    if name == "__gh":
        out.save(GH, optimize=True); print(f"  GitHub card  {W}x{H}  ss{k}  {GH.stat().st_size//1024} KB")
    else:
        p = OUTDIR/name; out.save(p, optimize=True, subsampling=0 if p.suffix=='.jpg' else -1)
        print(f"  {name}  {W}x{H}  ss{k}  {p.stat().st_size//1024} KB")
