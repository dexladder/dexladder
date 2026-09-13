/**
 * The blog's markdown: a small, strict subset parsed to data — never to HTML. The view renders
 * the blocks with h(), so a post can contain no markup, script or style at all; a link can only
 * point inside the app (#/…) or to https.
 *
 *   ## / ###        headings (h2 feed the table of contents)
 *   paragraphs      blank-line separated
 *   - item / 1.     lists (one level)
 *   > text          a callout
 *   ```             a fenced block, shown verbatim
 *   | a | b |       a table (first row is the header, second is the --- rule)
 *   ---             a divider
 *   @figure id · cap an illustration drawn by the app (components/domain/figures), never a file
 *   **b** *i* `code` [label](href)   inline
 */

export type Inline =
  | { readonly t: 'text'; readonly v: string }
  | { readonly t: 'b' | 'i'; readonly c: readonly Inline[] }
  | { readonly t: 'code'; readonly v: string }
  | { readonly t: 'a'; readonly href: string; readonly c: readonly Inline[] };

export type Block =
  | { readonly t: 'h2' | 'h3'; readonly id: string; readonly text: string }
  | { readonly t: 'p' | 'quote'; readonly c: readonly Inline[] }
  | { readonly t: 'ul' | 'ol'; readonly items: readonly (readonly Inline[])[] }
  | { readonly t: 'pre'; readonly v: string }
  | { readonly t: 'table'; readonly head: readonly (readonly Inline[])[]; readonly rows: readonly (readonly (readonly Inline[])[])[] }
  | { readonly t: 'hr' }
  | { readonly t: 'figure'; readonly id: string; readonly caption: string };

/** A link target the blog may use: an in-app route or an https URL. Anything else renders as text. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  return /^#\/[\w/.-]*$/.test(h) || /^https:\/\/[^\s"'<>]+$/.test(h) ? h : null;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[`*_[\]()]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

/** Inline spans: code first (its content is literal), then links, bold, italic. */
export function inline(src: string): Inline[] {
  const out: Inline[] = [];
  let i = 0, text = '';
  const flush = () => { if (text) { out.push({ t: 'text', v: text }); text = ''; } };
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^`([^`]+)`/))) { flush(); out.push({ t: 'code', v: m[1]! }); i += m[0].length; continue; }
    if ((m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/))) {
      flush();
      const href = safeHref(m[2]!);
      if (href) out.push({ t: 'a', href, c: inline(m[1]!) }); else out.push(...inline(m[1]!));
      i += m[0].length; continue;
    }
    if ((m = rest.match(/^\*\*([^*]+(?:\*(?!\*)[^*]*)*)\*\*/))) { flush(); out.push({ t: 'b', c: inline(m[1]!) }); i += m[0].length; continue; }
    if ((m = rest.match(/^\*([^*\s][^*]*)\*/))) { flush(); out.push({ t: 'i', c: inline(m[1]!) }); i += m[0].length; continue; }
    text += src[i]; i++;
  }
  flush();
  return out;
}

const cells = (row: string): string[] => row.trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim());

export function parse(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [], ids = new Set<string>();
  const id = (text: string) => { const b = slugify(text); let s = b, n = 2; while (ids.has(s)) s = b + '-' + n++; ids.add(s); return s; };
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i]!;
    if (!ln.trim()) { i++; continue; }
    let m: RegExpMatchArray | null;
    if ((m = ln.match(/^(##|###)\s+(.+)$/))) { const text = m[2]!.trim(); out.push({ t: m[1] === '##' ? 'h2' : 'h3', id: id(text), text }); i++; continue; }
    if (/^-{3,}\s*$/.test(ln)) { out.push({ t: 'hr' }); i++; continue; }
    if ((m = ln.match(/^@figure\s+([a-z0-9-]+)\s*(?:·\s*(.+))?$/))) { out.push({ t: 'figure', id: m[1]!, caption: (m[2] || '').trim() }); i++; continue; }
    if (ln.startsWith('```')) {
      const body: string[] = []; i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) body.push(lines[i++]!);
      i++; out.push({ t: 'pre', v: body.join('\n') }); continue;
    }
    if (ln.startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('|')) rows.push(lines[i++]!);
      const body = rows.filter((_, k) => k !== 1 || !/^\|?\s*:?-{3,}/.test(rows[1]!));
      out.push({ t: 'table', head: cells(body[0]!).map(inline), rows: body.slice(1).map(r => cells(r).map(inline)) });
      continue;
    }
    if (/^(-|\d+\.)\s+/.test(ln)) {
      const ordered = /^\d+\./.test(ln), items: Inline[][] = [];
      while (i < lines.length && /^(-|\d+\.)\s+/.test(lines[i]!)) {
        let item = lines[i++]!.replace(/^(-|\d+\.)\s+/, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!)) item += ' ' + lines[i++]!.trim();   // wrapped item
        items.push(inline(item));
      }
      out.push({ t: ordered ? 'ol' : 'ul', items }); continue;
    }
    if (ln.startsWith('>')) {
      const q: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) q.push(lines[i++]!.replace(/^>\s?/, ''));
      out.push({ t: 'quote', c: inline(q.join(' ')) }); continue;
    }
    const p: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(##|```|\||>|@figure\s|-{3,}\s*$|-\s|\d+\.\s)/.test(lines[i]!)) p.push(lines[i++]!.trim());
    out.push({ t: 'p', c: inline(p.join(' ')) });
  }
  return out;
}

/** Plain text of inline spans (for word counts and accessible labels). */
export function plain(c: readonly Inline[]): string {
  return c.map(x => (x.t === 'text' || x.t === 'code' ? x.v : plain(x.c))).join('');
}
