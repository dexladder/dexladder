"""Package the verified offline artifact as cacheable, ordered hosted assets.

Only HTMLParser-recognized script/style elements are rewritten. Source strings,
JSON-LD and the offline artifact are unchanged. Deferred classic scripts retain
separate global-script boundaries and execution order (no eval or CSP changes).
"""
from html.parser import HTMLParser
from pathlib import Path
import hashlib, json, re, shutil, sys
class Elements(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=False)
        self.text=text; self.lines=[0]; self.nodes=[]; self.current=None
        for line in text.splitlines(keepends=True): self.lines.append(self.lines[-1]+len(line))
        self.feed(text)
    def pos(self):
        line,col=self.getpos(); return self.lines[line-1]+col
    def handle_starttag(self, tag, attrs):
        if tag in ('style','script'):
            self.current=(tag,dict(attrs),self.pos(),self.pos()+len(self.get_starttag_text()))
    def handle_endtag(self,tag):
        if self.current and self.current[0]==tag:
            kind,attrs,start,body=self.current
            self.nodes.append((kind,attrs,start,self.text.index('>',self.pos())+1,self.text[body:self.pos()]))
            self.current=None

def build(source, target):
    assert source.resolve()!=target.resolve()
    shutil.copytree(source,target,dirs_exist_ok=True)
    html=(source/'index.html').read_text(); nodes=Elements(html).nodes
    replacements=[]; assets=[]; head_styles=[]; body_styles=[]; body_style_anchor=None
    assetdir=target/'assets'; assetdir.mkdir(exist_ok=True)
    def asset(body,ext):
        name=hashlib.sha256(body.encode()).hexdigest()+'.'+ext
        (assetdir/name).write_text(body)
        url='/assets/'+name
        assets.append(url)
        return url
    body_start=html.index('<body')
    for tag,attrs,start,end,body in nodes:
        if tag=='style':
            if start < body_start: head_styles.append(body)
            else:
                body_styles.append(body)
                body_style_anchor=(start,end)
            replacements.append((start,end,''))
            continue
        typ=attrs.get('type','').lower()
        if attrs.get('src') or typ not in ('','text/javascript','application/javascript','application/x-dl-deferred'): continue
        # Tiny resilience/theme setup executes before CSS to prevent a theme flash.
        if start < body_start: continue
        # The offline payload keeps optional layer source inline. The hosted
        # coordinator loads those same bytes from content-addressed files.
        if "var nodes = Array.prototype.slice.call(document.querySelectorAll('script[type=\"application/x-dl-deferred\"][data-dl-layer]'))" in body:
            old = """    script.text = node.textContent || '';
    script.setAttribute('data-dl-loaded', node.getAttribute('data-dl-layer') || '');
    document.body.appendChild(script);
    node.remove();
    window.DLIDLE.loaded = index;
    scheduleNext();"""
            new = """    script.setAttribute('data-dl-loaded', node.getAttribute('data-dl-layer') || '');
    function loaded() {
      node.remove();
      window.DLIDLE.loaded = index;
      scheduleNext();
    }
    var source = node.getAttribute('data-dl-src');
    if (source) {
      script.src = source; script.async = false; script.onload = loaded;
      script.onerror = function () { window.DLIDLE.error = node.getAttribute('data-dl-layer'); console.error('[DexLadder] Desk failed to load', source); };
    } else script.text = node.textContent || '';
    document.body.appendChild(script);
    if (!source) loaded();"""
            assert body.count(old)==1, 'Optional layer coordinator changed; review transform'
            body=body.replace(old,new)
        url=asset(body,'js')
        if typ=='application/x-dl-deferred':
            layer=attrs['data-dl-layer']
            replacement=f'<script type="application/x-dl-deferred" data-dl-layer="{layer}" data-dl-src="{url}"></script>'
        else:
            identity=' id="'+attrs['id']+'"' if 'id' in attrs else ''
            replacement=f'<script type="application/x-dl-boot"{identity} data-dl-src="{url}"></script>'
        replacements.append((start,end,replacement))
    if body_styles:
        url=asset('\n'.join(body_styles),'css')
        anchor=body_style_anchor
        replacements=[(a,b,(f'<link id="v154css" rel="stylesheet" href="{url}">' if (a,b)==anchor else r)) for a,b,r in replacements]
    for start,end,replacement in reversed(sorted(replacements)): html=html[:start]+replacement+html[end:]
    if head_styles:
        url=asset('\n'.join(head_styles),'css')
        html=html.replace('</head>',f'<link rel="stylesheet" href="{url}">\n</head>',1)
    # Body CSS stays after runtime-injected head CSS in the cascade.

    # Two animation frames leave one complete rendering opportunity before any
    # desk code executes. Dynamic classic scripts with async=false still execute
    # in insertion order, even when their downloads finish out of order.
    loader = """<script id="dl-hosted-loader">
(function(){
  function boot(){
    var nodes=Array.prototype.slice.call(document.querySelectorAll('script[type="application/x-dl-boot"]'));
    var remaining=nodes.length;
    function loaded(){if(--remaining===0){window.DLHOSTED={ready:true};window.dispatchEvent(new Event('load'));}}
    nodes.forEach(function(node){var script=document.createElement('script');script.async=false;script.src=node.getAttribute('data-dl-src');script.onload=loaded;script.onerror=function(){window.DLHOSTED={ready:false,error:script.src};console.error('[DexLadder] App code failed to load',script.src);};document.body.appendChild(script);});
  }
  requestAnimationFrame(function(){requestAnimationFrame(boot);});
})();
</script>"""
    html=html.replace('</body>',loader+'\n</body>',1)
    (target/'index.html').write_text(html)
    digest=hashlib.sha256(html.encode()).hexdigest()
    worker=(target/'sw.js').read_text()
    worker=re.sub(r"const PAYLOAD_SHA = '[a-f0-9]{64}';",f"const PAYLOAD_SHA = '{digest}';",worker)
    worker=re.sub(r'const SW_REV = (\d+);',lambda m:f'const SW_REV = {int(m[1])+1};',worker)
    # Installation is atomic: a successful new worker guarantees all desk code
    # is cached. Existing users keep their old worker until accepting the update.
    anchor="const SHELL_REQUIRED = ['./index.html'];"
    assert anchor in worker
    worker=worker.replace(anchor,anchor+'\nconst HOSTED_ASSETS = '+json.dumps(assets)+';')
    anchor2='    // missing decorative icon threw away the whole offline install.'
    # Insert before the optional loop; use the existing checked store choke point.
    mark='    for (const u of SHELL_OPTIONAL) {'
    assert mark in worker
    worker=worker.replace(mark,"    for (const u of HOSTED_ASSETS) {\n      const response = await netFetch(u, STATIC_HARD_MS);\n      if (!(await store(cache, u, response, 'static'))) throw new Error(\'asset not cacheable: \' + u);\n    }\n"+mark)
    (target/'sw.js').write_text(worker)
    headers=target/'_headers'
    headers.write_text(headers.read_text()+'\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n')
    manifest={'index_sha256':digest,'assets':assets,'offline_bytes':len((source/'index.html').read_bytes()),'hosted_html_bytes':len(html.encode())}
    (target/'hosted-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest | {'assets':len(assets)}))
if __name__=='__main__': build(Path(sys.argv[1]),Path(sys.argv[2]))
