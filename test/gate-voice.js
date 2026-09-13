// v156-V film narration gate — the film series speaks with recorded clips slaved to the film
// clock, never with speechSynthesis. Exit code = number of failures.
//   node test/gate-voice.js [dist/index.html]
'use strict';
const fs = require('fs'), path = require('path');
const { launch } = require('./harness');
const file = process.argv[2] || path.join(__dirname, '..', 'dist', 'index.html');
const results = [];
function ok(name, cond, detail) {
  results.push({ name, ok: !!cond });
  console.log(cond ? '  ✓' : '  ✗', name, !cond && detail !== undefined ? JSON.stringify(detail) : '');
}
const FILMS = ['doublespend', 'mining', 'keys', 'merkle', 'halving', 'difficulty', 'mempool', 'attack51'];

(async () => {
  const src = fs.readFileSync(file, 'utf8');
  const cine = src.slice(src.indexOf('var LEAD=3.6,TAIL=3.4'), src.indexOf('var LEAD=3.6,TAIL=3.4') + 60000);
  console.log('== source');
  ok('the film player has no synthetic voice left', cine.length > 1000 && !/speechSynthesis|SpeechSynthesisUtterance/.test(cine));
  ok('the player plays recorded clips from voice/<film>-<scene>.mp3', /"voice\/"\+id\+"-"\+\(n\+1\)\+"\.mp3"/.test(cine));
  const vdir = path.join(path.dirname(file), 'voice');
  const clips = FILMS.flatMap(f => [1, 2, 3, 4].map(n => `${f}-${n}.mp3`));
  const missing = clips.filter(c => !fs.existsSync(path.join(vdir, c)));
  ok('all 32 clips ship beside the payload', !missing.length, missing);

  const h = await launch(file);
  const { page } = h;
  await page.waitForTimeout(3500);
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const reqs = [];
  page.on('request', r => { if (/\/voice\//.test(r.url())) reqs.push(r.url().split('/voice/')[1]); });

  // record every <audio>, and any attempt to use the synthetic voice
  await ev(() => {
    window.__va = []; window.__tts = 0;
    const P = HTMLMediaElement.prototype, play = P.play;
    P.play = function () { if (window.__va.indexOf(this) < 0) window.__va.push(this); return play.apply(this, arguments); };
    if (window.speechSynthesis) { const s = speechSynthesis.speak.bind(speechSynthesis); speechSynthesis.speak = function (u) { window.__tts++; return s(u); }; }
  });

  console.log('== every clip decodes and fits its scene');
  const fit = await ev(async (films) => {
    const bad = [], lens = {};
    for (const id of films) {
      const ep = EP.filter(e => e.id === id)[0];
      if (!ep) { bad.push(id + ': film missing'); continue; }
      for (let i = 0; i < 4; i++) {
        const s = ep.scenes[i], k = id + '-' + (i + 1);
        const d = await new Promise(res => { const a = new Audio('voice/' + k + '.mp3'); a.preload = 'metadata'; a.onloadedmetadata = () => res(a.duration); a.onerror = () => res(-1); setTimeout(() => res(-2), 8000); });
        lens[k] = d;
        if (!(d > 2)) bad.push(k + ': does not decode (' + d + ')');
        else if (d > (s.t1 - s.t0) - 0.35 + 0.05) bad.push(k + ': ' + d.toFixed(2) + 's overruns its ' + (s.t1 - s.t0) + 's scene');
        if (!s.say) bad.push(k + ': scene has no say line');
      }
    }
    return { bad, n: Object.keys(lens).length };
  }, FILMS);
  ok('32 clips decode, each inside its scene (lead .35 s)', fit.n === 32 && !fit.bad.length, fit.bad);

  console.log('== player');
  reqs.length = 0;   // only what the player itself fetches from here on
  await ev(() => CINE.open('mining'));
  await page.waitForTimeout(400);
  await page.click('#cine-voice');
  await page.waitForTimeout(300);
  ok('narration button reports its state', await ev(() => document.getElementById('cine-voice').getAttribute('aria-pressed')) === 'true');
  // scrub into scene 3 of "How a Block Gets Mined" (film t 26 → player t 29.6): T = 33 → clip offset 3.05 s
  await ev(() => { const sb = document.getElementById('cine-scrub'), dur = 46 + 7; sb.value = Math.round(33 / dur * 1e3); sb.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(900);
  const st = () => ev(() => { const a = window.__va.filter(x => /^blob:/.test(x.src)).pop(); return a ? { paused: a.paused, t: a.currentTime, rate: a.playbackRate, dur: a.duration } : null; });
  let a = await st();
  ok('seeking mid-scene plays that scene\'s clip', reqs.some(r => /^mining-3\.mp3/.test(r)) && a && !a.paused, { reqs, a });
  ok('the clip is positioned at the scene offset, not from the top', a && a.t > 2.6 && a.t < 5.2, a);
  ok('a film\'s four clips are prefetched when narration is switched on', ['mining-1', 'mining-2', 'mining-3', 'mining-4'].every(k => reqs.some(r => r.indexOf(k) === 0)), reqs);
  await page.click('#cine-spd');   // 1× → 1.5×
  await page.waitForTimeout(800);
  a = await st();
  ok('playback speed follows the speed button', a && Math.abs(a.rate - 1.5) < 1e-6, a);
  await page.click('#cine-spd'); await page.click('#cine-spd');   // back to 1×
  await page.click('#cine-play');  // pause
  await page.waitForTimeout(300);
  a = await st();
  const tPause = a && a.t;
  ok('pause stops the narration', a && a.paused, a);
  await page.click('#cine-play');  // resume
  await page.waitForTimeout(700);
  a = await st();
  ok('resume continues mid-sentence', a && !a.paused && a.t >= tPause - 0.5 && a.t > 2, { tPause, a });
  await page.click('#cine-voice');
  await page.waitForTimeout(250);
  a = await st();
  ok('switching narration off silences it', a && a.paused, a);
  await page.click('#cine-voice');
  await page.waitForTimeout(700);
  await ev(() => CINE.close());
  await page.waitForTimeout(300);
  a = await st();
  ok('closing the film silences it', a && a.paused, a);
  ok('speechSynthesis was never called', await ev(() => window.__tts) === 0);
  ok('no page errors', !h.errors.length, h.errors.slice(0, 3));

  await h.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`${results.length - failed} passed, ${failed} failed`);
  process.exit(failed);
})().catch(e => { console.error(e); process.exit(99); });
