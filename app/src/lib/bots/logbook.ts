/**
 * The execution logbook: what a bot did, in order, in sentences. It is the only record of the
 * decisions between two fills — a bot that held for six hours has nothing in its wallet to show
 * for it, and "why did it not buy" is the question every bot owner asks first.
 *
 * Append-only and bounded. The cap is the honest trade: a live 1m bot writes several entries a
 * minute, and this sits in the same localStorage as the user's trade history and proof ledger, so
 * an unbounded log would eventually cost them the thing the log was written to explain. What the
 * cap costs is stated, not hidden — `dropped` counts every entry evicted, and the desk prints it,
 * because a log that silently forgets its first hour is worse than one that admits it.
 *
 * Pure: the clock and the text arrive as arguments, every function returns a new value, and a
 * viewer reads through `slice` so a 2,000-row log never has to exist as 2,000 DOM rows.
 */

export type LogEventKind = 'tick' | 'eval' | 'dispatch' | 'fill' | 'halt' | 'error';
export type LogEventLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  /** monotonic and never reused, so a virtualised viewer can key a row that scrolls out and back */
  readonly seq: number;
  readonly bot: string;
  readonly t: number;
  readonly kind: LogEventKind;
  readonly level: LogEventLevel;
  /** a finished sentence, shown to the user verbatim */
  readonly text: string;
}

/** what the caller supplies; seq is the book's to assign, level is derived unless it is given */
export interface LogDraft {
  readonly bot: string;
  readonly t: number;
  readonly kind: LogEventKind;
  readonly text: unknown;
  readonly level?: LogEventLevel;
}

export interface Logbook {
  readonly events: readonly LogEvent[];
  /** the seq the next entry gets */
  readonly next: number;
  /** entries pushed out by the cap — the desk says this out loud */
  readonly dropped: number;
}

/** entries kept. Roughly a day of a 1h bot, or two hours of a 1m bot talking at every tick. */
export const LOGBOOK_CAP = 600;

/** the most rows one `slice` will hand back, however much a viewer asks for */
export const MAX_WINDOW = 300;

/** longest a sentence may be before it is cut — a log line that wraps five times is not readable */
export const TEXT_CAP = 240;

export const emptyBook = (): Logbook => ({ events: [], next: 1, dropped: 0 });

/** the level an entry gets when the caller does not name one */
export const levelOf = (kind: LogEventKind): LogEventLevel =>
  kind === 'error' ? 'error' : kind === 'halt' ? 'warn' : kind === 'tick' ? 'debug' : 'info';

const FALLBACK: Readonly<Record<LogEventKind, string>> = {
  tick: 'A bar closed and the bot looked at it.',
  eval: 'The bot evaluated its conditions and said nothing about why.',
  dispatch: 'The bot sent an order.',
  fill: 'An order filled.',
  halt: 'The bot was halted.',
  error: 'Something failed and no reason came back with it.',
};

/**
 * Whatever the caller passed, as a sentence. The vanilla layer hands this strings built from the
 * Worker's and the endpoint's answers, and those are user data — an object slipping through would
 * print "[object Object]" into the one panel that exists to be read, so anything that is not
 * usable text is replaced by a sentence that at least says what happened.
 */
export function finish(text: unknown, kind: LogEventKind): string {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw || raw === '[object Object]' || raw === 'undefined' || raw === 'null') return FALLBACK[kind];
  const cut = raw.length > TEXT_CAP ? raw.slice(0, TEXT_CAP - 1).trimEnd() + '…' : raw;
  return /[.!?…·)]$/.test(cut) ? cut : cut + '.';
}

export function append(book: Logbook, e: LogDraft): Logbook {
  const event: LogEvent = { seq: book.next, bot: e.bot, t: e.t, kind: e.kind, level: e.level ?? levelOf(e.kind), text: finish(e.text, e.kind) };
  const events = [...book.events, event];
  const over = events.length - LOGBOOK_CAP;
  return {
    events: over > 0 ? events.slice(over) : events,
    next: book.next + 1,
    dropped: book.dropped + (over > 0 ? over : 0),
  };
}

/** Append several at once — one new book, not one per entry. */
export function appendAll(book: Logbook, es: readonly LogDraft[]): Logbook {
  return es.reduce(append, book);
}

/**
 * A window for a virtualised viewer: index 0 is the OLDEST entry kept, which is the order the log
 * reads in. Only the window is copied, so scrolling a long book never materialises it.
 */
export function slice(book: Logbook, from: number, count: number): readonly LogEvent[] {
  const start = Math.max(0, Math.min(Math.floor(from) || 0, book.events.length));
  const n = Math.max(0, Math.min(Math.floor(count) || 0, MAX_WINDOW));
  return book.events.slice(start, start + n);
}

export interface LogQuery {
  readonly level?: LogEventLevel;
  readonly kind?: LogEventKind;
  readonly bot?: string;
}

/** An empty query matches everything, so the desk's "all" filter needs no special case. */
export function filter(book: Logbook, q: LogQuery): readonly LogEvent[] {
  return book.events.filter(e =>
    (q.level === undefined || e.level === q.level) &&
    (q.kind === undefined || e.kind === q.kind) &&
    (q.bot === undefined || e.bot === q.bot));
}

/** What the cap has cost so far, in words, for the line above the log. */
export function capNote(book: Logbook): string {
  return book.dropped
    ? 'Showing the last ' + book.events.length + ' of ' + (book.events.length + book.dropped).toLocaleString('en-US') + ' events — ' + book.dropped.toLocaleString('en-US') + ' older one(s) were dropped to keep this bot inside its storage budget.'
    : book.events.length + ' event(s) · nothing dropped yet (the log keeps the last ' + LOGBOOK_CAP + ').';
}
