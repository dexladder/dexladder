/**
 * What the desk remembers about its bots while the page is open: one execution logbook for all of
 * them, and one telemetry ring per bot that polls an endpoint.
 *
 * Neither is persisted, and that is deliberate. The save file (`S.dlsim.bots`) keeps a bot's
 * DEFINITION and its WALLET — the two things a bot cannot be rebuilt without. A 600-entry log and
 * a 100-poll ring per bot would multiply the size of the user's save by the number of bots they
 * have ever run, for records that describe a session rather than a position; and the stored shape
 * is asserted key-for-key by the bots gate, so widening it would be a silent contract change.
 * Both start empty on a reload and say so.
 *
 * The cores do the thinking: `lib/bots/logbook` caps, numbers and filters the entries;
 * `lib/bots/telemetry` bounds the ring and reads the vitals. This file is the box they live in.
 */
import { append, emptyBook, type LogDraft, type Logbook } from '../lib/bots/logbook';
import { emptyRing, push, type Exchange, type Ring, type Sample } from '../lib/bots/telemetry';

let BOOK: Logbook = emptyBook();
const RINGS = new Map<string, Ring>();

/** The whole book, for the viewer. It is a value: reading it never copies the events. */
export const book = (): Logbook => BOOK;

/** One line into the log. Returns the new book so a caller can repaint off the same value. */
export function write(e: LogDraft): Logbook {
  BOOK = append(BOOK, e);
  return BOOK;
}

/** Forget everything logged so far — the user's own "clear", never automatic. */
export function clearBook(): Logbook {
  BOOK = emptyBook();
  return BOOK;
}

/** This bot's poll ring, empty until its first call. Never undefined, so no caller branches. */
export const ring = (id: string): Ring => RINGS.get(id) || emptyRing();

/**
 * Record one poll of one bot's endpoint. `raw` is the request and the response as text; the ring
 * keeps only the newest of each, so passing it on every poll costs a bounded amount forever.
 */
export function record(id: string, s: Sample, raw?: Exchange): Ring {
  const next = push(ring(id), s, raw);
  RINGS.set(id, next);
  return next;
}

/** A bot that is gone should not leave a ring behind. */
export function forget(id: string): void { RINGS.delete(id); }

/** Which bots have ever polled — the desk only draws a telemetry panel for these. */
export const polled = (): readonly string[] => [...RINGS.keys()];
