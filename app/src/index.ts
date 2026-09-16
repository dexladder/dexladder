/**
 * DLAPP — the typed core of the DexLadder web payload.
 *
 * Everything here is either a pure function or a small presenter over one. The bundle is
 * injected into <head> ahead of the legacy scripts (it touches no DOM at load), so any
 * legacy call site may delegate to it. The namespace is frozen: nothing downstream can
 * rebind a formula at runtime.
 */
import * as math from './lib/math';
import * as indicators from './lib/indicators';
import * as paper from './lib/paper-engine';
import * as perpsCore from './lib/perps';
import * as perpsView from './legacy/perps-view';
import { equityUSD as perpEquity, journalNote, perpBook } from './legacy/perps';
import { usePerps } from './hooks/usePerps';
import * as backtest from './lib/backtest';
import * as botsCore from './lib/bots';
import * as botsState from './legacy/bots';
import * as botsBook from './legacy/bots-book';
import * as botsDesk from './legacy/bots-desk';
import * as botsView from './legacy/bots-view';
import { useBots } from './hooks/useBots';
import * as rewindView from './legacy/rewind-view';
import { useBacktest } from './hooks/useBacktest';
import * as algo from './lib/paper-engine/algo';
import * as legacyIndicators from './legacy/indicators';
import * as legacyPaper from './legacy/paper';
import * as legacyTicket from './legacy/ticket';
import * as ticketView from './legacy/ticket-view';
import * as historyFeed from './legacy/history-feed';
import * as blogView from './legacy/blog';
import * as algoView from './legacy/algo';
import * as blog from './lib/blog/posts';
import * as hooks from './hooks/usePaperEngine';
import { useMarketData } from './hooks/useMarketData';
import * as snapshot from './lib/snapshot';
import * as forkLib from './lib/fork';
import * as forkState from './legacy/fork-state';
import * as forkView from './legacy/fork-view';
import { bind } from './legacy/globals';
import * as ia from './nav/ia';
import * as navPresenter from './nav/presenter';
import { ROLE, STATUS, signStatus, v } from './design/tokens';
import { CX } from './design/classes';
import { h } from './components/ui/h';
import { Pill } from './components/ui/pill';
import { Badge } from './components/ui/badge';
import { Card } from './components/ui/card';
import { Stat } from './components/ui/stat';
import { TableRow } from './components/ui/table-row';
import { Modal } from './components/ui/modal';
import { Tabs } from './components/ui/tabs';
import { TradeInput, parseAmount } from './components/ui/trade-input';
import { Segmented } from './components/ui/segmented';
import { ChangePill } from './components/domain/change-pill';
import { PnlCell } from './components/domain/pnl';
import { OrderPreview } from './components/domain/order-preview';
import { SectionStrip } from './components/domain/section-strip';

export const VERSION = 'arch-1';

const DLAPP = Object.freeze({
  version: VERSION,
  math: Object.freeze({ ...math }),
  indicators: Object.freeze({ ...indicators }),
  paper: Object.freeze({ ...paper }),
  perps: Object.freeze({ ...perpsCore }),
  backtest: Object.freeze({ ...backtest }),
  bots: Object.freeze({ ...botsCore }),
  algo: Object.freeze({ ...algo }),
  hooks: Object.freeze({ ...hooks, useMarketData, usePerps, useBacktest, useBots }),
  snapshot: Object.freeze({ ...snapshot }),
  blog: Object.freeze({ POSTS: blog.POSTS, find: blog.find, article: blog.article, index: blog.index, routeOf: blog.routeOf }),
  /**
   * The Local Fork sandbox. `install` is how the payload layer hands in the ONE network function
   * the typed core is allowed to use (see legacy/fork-state.ts); everything else here is pure or a
   * presenter over it.
   */
  fork: Object.freeze({
    lib: Object.freeze({ ...forkLib }),
    install: forkState.install,
    installed: forkState.installed,
    mount: forkView.mount,
    render: forkView.render,
    node: forkView.nodeFor,
    settings: forkState.settings,
    patch: forkState.patch,
    status: forkState.nodeStatus,
    pool: forkState.forkPool,
    routed: forkState.routedVenue,
    log: forkState.lines,
  }),
  design: Object.freeze({ ROLE, STATUS, signStatus, v, CX }),
  ui: Object.freeze({ h, Segmented, Pill, Badge, Card, Stat, TableRow, Modal, Tabs, TradeInput, parseAmount, ChangePill, PnlCell, OrderPreview, SectionStrip }),
  nav: Object.freeze({ ...ia, install: navPresenter.install, sync: navPresenter.sync, go: navPresenter.go }),
  legacy: Object.freeze({
    bind,
    paper: Object.freeze({ ...legacyPaper }),
    ticket: Object.freeze({ ...legacyTicket, preview: ticketView.preview, TOLERANCES: ticketView.TOLERANCES }),
    history: Object.freeze({ ensure: historyFeed.ensure, stats: historyFeed.stats }),
    perps: Object.freeze({ ...perpsView, equityUSD: perpEquity, journalNote, book: perpBook }),
    rewind: Object.freeze({ mount: rewindView.mount, hide: rewindView.hide, mounted: rewindView.mounted }),
    /**
     * The Bots desk. `install` is how layers/45-bots.js hands in the three effects the typed core
     * may not hold — candles, the Worker that runs a user's JavaScript, and the call to a user's
     * signal endpoint; everything else here is pure or a presenter over one.
     */
    bots: Object.freeze({
      install: botsState.install, installed: botsState.installed, runs: botsState.BOTS,
      mount: botsView.mount, render: botsView.render, hide: botsView.hide, mounted: botsView.mounted,
      restore: botsState.restore, wake: botsState.wake, sleep: botsState.sleep,
      bars: botsState.bars, js: botsState.js, signal: botsState.signal, markets: botsState.markets, feeRate: botsState.feeRate, kit: botsView.kit,
      /** the kill switch: what firing would do, and firing it. The plan is pure (lib/bots/kill);
       *  applying it — cancelling, flattening, sealing one chain entry per bot — happens here. */
      halt: botsDesk.fire, haltPreview: botsDesk.preview, seal: botsState.seal,
      /** the desk-wide slippage setting, applied to BOTH the backtest and every live fill */
      slipBps: botsState.slipBps, setSlipBps: botsState.setSlipBps,
      /** a backtest, in a Worker when the page installed one, on this thread when it did not */
      backtest: botsDesk.backtest,
      /** the execution logbook and the per-bot endpoint telemetry ring */
      book: botsBook.book, ring: botsBook.ring, clearLog: botsBook.clearBook, note: botsBook.write,
    }),
    algo: Object.freeze({ step: algoView.step, placeOco: algoView.placeOco, armTwap: algoView.armTwap, ocoFilled: algoView.ocoFilled, ocoCancel: algoView.ocoCancel, rowHtml: algoView.rowHtml }),
    blog: Object.freeze({ render: blogView.render, open: blogView.open, story: blogView.story, install: blogView.install, STORY: blogView.STORY }),
    chart: Object.freeze({ ...legacyIndicators.chart }),
    core: Object.freeze({ ...legacyIndicators.core }),
  }),
});

export type DlApp = typeof DLAPP;

declare global { interface Window { DLAPP: DlApp } }

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'DLAPP', { value: DLAPP, writable: false, configurable: false, enumerable: true });
}

export default DLAPP;
