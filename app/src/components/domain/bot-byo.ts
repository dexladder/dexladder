import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Button, Select, TextArea, TextField } from '../ui/fields';
import { Segmented } from '../ui/segmented';
import { Section } from './fork-facts';
import { Pill } from '../ui/pill';
import { INTERVALS } from '../../lib/bots/validate';
import type { BotKind, Health } from '../../lib/bots/types';

export interface ByoProps {
  readonly kind: Exclude<BotKind, 'rules'>;
  readonly name: string;
  readonly sym: string;
  readonly coins: readonly string[];
  readonly interval: string;
  readonly stake: string;
  readonly code: string;
  readonly url: string;
  readonly errors: readonly string[];
  readonly busy: string;
  readonly health: Health | null;
  /** what the last dry-run said, verbatim */
  readonly out: { readonly status: 'good' | 'bad' | 'warn' | 'info'; readonly text: string } | null;
  readonly kit: string;
  onKind(k: Exclude<BotKind, 'rules'>): void;
  onField(k: 'name' | 'sym' | 'interval' | 'stake' | 'code' | 'url', v: string): void;
  onExample(): void;
  onKit(id: string): void;
  onDryRun(): void;
  onLaunch(): void;
}

const KITS = [{ value: 'py', label: 'Python (standard library only)' }, { value: 'node', label: 'Node (no dependencies)' }, { value: 'curl', label: 'What DexLadder sends' }];

/** Bring Your Own Bot: your JavaScript in a sandbox, or your own process answering one URL. */
export function BotByo(p: ByoProps): HTMLElement {
  const js = p.kind === 'js';
  return h('div', { class: [CX.perp], id: 'botByo' },
    Section('How your bot decides', p.health ? Pill({ status: p.health.ok ? 'good' : 'bad', text: p.health.text }) : null,
      Segmented({ id: 'byKind', label: 'Source', value: p.kind, onChange: v => p.onKind(v as 'js' | 'signal'),
        options: [{ value: 'js', label: 'JavaScript in a sandbox', title: 'paste a strategy — it runs in a Worker with no network and no page access' },
          { value: 'signal', label: 'My own bot at a URL', title: 'any language — DexLadder asks your process once per closed bar' }] }),
      h('div', { class: [CX.forkKey] }, js
        ? 'Your code runs inside a Worker this page spawns: no network, no DOM, no storage, no timers. It gets the bars and the wallet, and answers buy, sell or hold. Nothing leaves your device.'
        : 'Your bot runs wherever you run it. DexLadder GETs your URL once per closed bar with the market and the wallet in the query string, and fills whatever it answers. No key, no account — your endpoint just needs Access-Control-Allow-Origin: *.')),
    Section('The bot', null,
      h('div', { class: [CX.perpGrid] },
        TextField({ id: 'byName', label: 'Name', value: p.name, placeholder: 'My bot', onInput: v => p.onField('name', v) }),
        Select({ id: 'bySym', label: 'Market', value: p.sym, options: p.coins.map(s => ({ value: s, label: s + '/USDT' })), onChange: v => p.onField('sym', v) }),
        Select({ id: 'byIv', label: 'Bar size', value: p.interval, options: INTERVALS.map(i => ({ value: i, label: i })), onChange: v => p.onField('interval', v) }),
        TextField({ id: 'byCash', label: 'Paper stake (USDT)', value: p.stake, placeholder: '10000', onInput: v => p.onField('stake', v) }))),
    js
      ? Section('Your strategy', Button({ label: 'Load the example', onClick: p.onExample }),
        TextArea({ id: 'byCode', label: 'function onBar(ctx) { … } — return "buy", "sell", "hold", or { action, size, reason }', value: p.code, placeholder: 'function onBar(ctx) { return "hold"; }', onInput: v => p.onField('code', v) }))
      : Section('Your endpoint', null,
        TextField({ id: 'byUrl', label: 'Signal URL', value: p.url, placeholder: 'http://127.0.0.1:8787/signal', wide: true, onInput: v => p.onField('url', v) }),
        Select({ id: 'byKit', label: 'Starter kit', value: p.kit, options: KITS, onChange: p.onKit }),
        h('code', { class: [CX.forkFix], id: 'byKitCode' }, kitText(p.kit)),
        h('div', { class: [CX.forkKey] }, 'Run it, then dry-run below: DexLadder calls your URL once and shows the raw answer.')),
    p.out ? h('div', { class: [CX.forkOut, CX[p.out.status]], id: 'byOut' }, p.out.text) : null,
    p.errors.length ? Section('Before it can run', null, ...p.errors.map(e => h('div', { class: [CX.forkFind, CX.bad] }, e))) : null,
    h('div', { class: [CX.forkBar] },
      Button({ label: p.busy === 'dry' ? 'checking…' : 'Dry-run on the last bar', disabled: !!p.busy || !!p.errors.length, onClick: p.onDryRun }),
      Button({ label: 'Run it live', primary: true, disabled: !!p.busy || !!p.errors.length, onClick: p.onLaunch })));
}

/** The smallest server that answers DexLadder correctly, in three flavours. */
export function kitText(id: string): string {
  if (id === 'node') return `// node bot.js  — answers DexLadder on http://127.0.0.1:8787/signal
require('http').createServer((req, res) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const closes = (q.get('c') || '').split(',').map(Number);
  const px = +q.get('px'), holding = +q.get('qty') > 0;
  const sma = closes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, closes.length);
  const out = !holding && px > sma ? { action: 'buy', size: 0.5, reason: 'price above the 20-bar mean' }
            : holding && px < sma ? { action: 'sell', reason: 'price back under the mean' } : { action: 'hold', reason: 'waiting' };
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(out));
}).listen(8787, '127.0.0.1');`;
  if (id === 'curl') return `GET http://127.0.0.1:8787/signal?sym=BTC&iv=1h&i=412&t=1789…&px=61240.5
    &qty=0&avg=0&cash=10000&eq=10000&last=hold&c=60980,61010,…   (the last 120 closes)

answer 200 application/json, with  Access-Control-Allow-Origin: *
{ "action": "buy" | "sell" | "hold", "size": 0.5, "reason": "why, in a sentence" }`;
  return `# python3 bot.py — answers DexLadder on http://127.0.0.1:8787/signal
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
import json

class Bot(BaseHTTPRequestHandler):
    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        closes = [float(x) for x in q.get('c', [''])[0].split(',') if x]
        px, holding = float(q['px'][0]), float(q['qty'][0]) > 0
        sma = sum(closes[-20:]) / max(1, len(closes[-20:]))
        if not holding and px > sma: out = {'action': 'buy', 'size': 0.5, 'reason': 'price above the 20-bar mean'}
        elif holding and px < sma:   out = {'action': 'sell', 'reason': 'price back under the mean'}
        else:                        out = {'action': 'hold', 'reason': 'waiting'}
        body = json.dumps(out).encode()
        self.send_response(200); self.send_header('content-type', 'application/json')
        self.send_header('access-control-allow-origin', '*'); self.send_header('content-length', str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass

HTTPServer(('127.0.0.1', 8787), Bot).serve_forever()`;
}
