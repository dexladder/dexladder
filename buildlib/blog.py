# -*- coding: utf-8 -*-
"""The Blog (2026-09-11) — wiring the typed Blog (web/app/src/lib/blog, legacy/blog.ts) into the
legacy router and chrome. Every find string is count-asserted, like every other patch.

  page      #page-blog, a plain page the legacy nav() can show (Academy section "Blog")
  route     #/blog and #/blog/<slug> open the Blog; the slug survives the router (nav() alone
            would rewrite the hash to #/blog)
  nav       nav("blog") renders the pending post or the front page
  footer    Blog links under the brand blurb (every page)
  what's new the v156 banner and the What's New sheet link the release's story
"""

BLOG_PAGE = '<main id="page-blog" class="page"><div class="wrap section"><div id="dlBlog" aria-live="polite"></div></div></main>\n'

PATCHES = [
    ('page', '<main id="page-discover" class="page">', BLOG_PAGE + '<main id="page-discover" class="page">', 1),
    ('route', 'if("terminal"===h)return void nav("coin");',
     'if("terminal"===h)return void nav("coin");if("blog"===h||h.startsWith("blog/"))return void DLAPP.legacy.blog.open(h.slice(5).replace(/\\/$/,""));', 1),
    ('nav', 'else if("community"===view)try{renderCommunity()}catch(_e){}',
     'else if("community"===view)try{renderCommunity()}catch(_e){}else if("blog"===view)try{DLAPP.legacy.blog.render()}catch(_e){}', 1),
    ('footer', '<p style="margin:0">A paper-trading crypto tracker for learning. Live prices in, no real money out.</p>',
     '<p style="margin:0">A paper-trading crypto tracker for learning. Live prices in, no real money out.</p>'
     '<p class="dl-foot-blog"><a href="#/blog">Blog</a> · <a href="#/blog/what-is-dexladder">What is DexLadder?</a> · '
     '<a href="#/blog/advanced-execution-engine">The execution engine</a> · <a href="#/blog/how-dexladder-is-built">How it is built</a></p>', 1),
    ('whatsnew-banner', '<button class="go" onclick="DLTOUR.news()">See what’s new</button>',
     '<button class="go" onclick="DLAPP.legacy.blog.story()">Read the story</button><button class="go" onclick="DLTOUR.news()">See what’s new</button>', 1),
    ('whatsnew-sheet', """<button class="btn ghost" onclick="closeModal();try{DLTRUST.open(\\'changelog\\')}catch(e){}">Full changelog</button>""",
     """<button class="btn ghost" onclick="closeModal();DLAPP.legacy.blog.story()">Read the story on the Blog</button>"""
     """<button class="btn ghost" onclick="closeModal();try{DLTRUST.open(\\'changelog\\')}catch(e){}">Full changelog</button>""", 1),
]


def apply(out):
    for pid, find, rep, n in PATCHES:
        c = out.count(find)
        assert c == n, f'blog/{pid}: expected {n} occurrence(s), found {c}'
        out = out.replace(find, rep)
    assert out.count('id="page-blog"') == 1 and out.count('DLAPP.legacy.blog.') >= 4
    print('blog: #page-blog (Academy → Blog), #/blog + #/blog/<slug> routes, footer links, What’s New → the v156 story')
    return out
