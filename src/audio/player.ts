/**
 * The player controller — the signature interaction (DESIGN §5).
 *
 * WP1 owns this file. WP2 renders against it and never touches an `<audio>`
 * element itself.
 *
 * One `<audio>` element for the whole app, because "press a line, hear the
 * second" is a single continuous instrument and two elements means two clocks.
 * The controller owns four things nothing else may own:
 *
 *  1. **Audio resolution (amendment A3).** The blob comes from IndexedDB under
 *     `audio:<interviewId>` — including the sample, which is fetched once on
 *     first play and then stored through `putAudio()` exactly like a user's own
 *     recording. That means "a week later, offline" rests on IndexedDB, the
 *     product's actual storage story, rather than on service-worker Range
 *     semantics. `null` from `getAudio` is not an error; it is the designed
 *     "the recording isn't on this device" state (dashed chips, §4.2).
 *
 *  2. **Span playback with pre-roll and post-roll.** Seek to `s − 1.0` (2.5 s
 *     when the anchor is `≈`, because an interpolated position needs more
 *     runway), play, and **stop at `e + 0.8`**. Stopping is the receipt: it
 *     plays what was claimed and gets out of the way. `keepListening()` is the
 *     only way past the stop.
 *
 *  3. **The word cursor.** `requestAnimationFrame` reading `currentTime`
 *     against the word array by binary search — never a timer, never an event.
 *     `timeupdate` fires about four times a second, which is a quarter of the
 *     resolution a spoken word needs; DESIGN §5 asks for "within one animation
 *     frame of `currentTime` crossing `word.start`" and that is only reachable
 *     from rAF.
 *
 *  4. **Seek compensation.** A VBR MP3 without a seek table lands where it
 *     likes. We check where we actually arrived and re-seek once if the browser
 *     missed by more than a quarter second. The human-facing version of this is
 *     the nudge cluster; this is the machine-facing half.
 */
import type { Anchor, Word } from '../types';
import {
  NUDGES, POST_ROLL_SEC, PRE_ROLL_APPROX_SEC, PRE_ROLL_SEC,
  SKIP_SEC, SKIP_SILENCE_HOLD_SEC, SKIP_SILENCE_MIN_GAP_SEC,
} from '../store/presets';
import { getAudio, putAudio } from '../lib/storage';
import { SAMPLE_AUDIO_URL, SAMPLE_ID } from '../sample/schema';
import { starterAudioUrl } from '../content/load';
import { usePlayer, useStore } from '../store';

export type LoadResult = 'ok' | 'missing';

export interface PlaySpanResult {
  /** ms from the call to the first frame in which audio had actually advanced. */
  latencyMs: number;
  /** where we asked to start */
  startedAt: number;
  /** where the browser actually put us, after compensation */
  landedAt: number;
}

type WordListener = (index: number) => void;

/** How far off a seek may land before we correct it (DESIGN §5, VBR note). */
const SEEK_TOLERANCE_SEC = 0.25;
/** Store writes for `currentTime` are throttled to this; `wordIndex` never is. */
const TIME_WRITE_STEP_SEC = 0.05;

export class Player {
  private el: HTMLAudioElement | null = null;
  private url: string | null = null;
  private words: Word[] = [];
  private starts: Float64Array = new Float64Array(0);
  private interviewId: string | null = null;

  private span: { s: number; e: number } | null = null;
  private mode: 'span' | 'free' = 'free';
  private stopAt = Infinity;
  private skipSilence = false;

  private raf = 0;
  private cursor = -1;
  private lastWrittenTime = -1;
  private listeners = new Set<WordListener>();

  /** Resolved by the rAF loop the first time audio genuinely advances. */
  private firstAudio: ((r: PlaySpanResult) => void) | null = null;
  private pressedAt = 0;
  private seekTarget = 0;
  private compensated = false;

  /* ------------------------------------------------------------- wiring */

  attach(el: HTMLAudioElement): void {
    if (this.el === el) return;
    this.el = el;
    el.preload = 'auto';
    el.addEventListener('ended', this.onEnded);
    el.addEventListener('pause', this.onPauseEvent);
    el.addEventListener('play', this.onPlayEvent);
  }

  /**
   * Point the player at an interview. Returns `'missing'` when the recording is
   * not on this device — a designed state, not a failure.
   *
   * Resolves only once the element can actually seek and play. That matters for
   * the 150 ms commitment in DESIGN §5: the screen mounts and loads long before
   * anyone presses a chip, so decoding the container must not be on the press's
   * critical path. A `load()` that resolved early would move that cost into the
   * press, where the user can feel it — and would hand WP2 a scrubber with no
   * duration to draw.
   */
  async load(interviewId: string, words: Word[]): Promise<LoadResult> {
    this.words = words;
    this.starts = Float64Array.from(words, (w) => w.s);
    this.cursor = -1;

    if (this.interviewId === interviewId && this.url) {
      usePlayer.getState().setPlayer({ interviewId });
      return 'ok';
    }

    // Leaving a recording remembers where it stood (v3 B11, §4.5 resume).
    this.savePosition();

    const blob = await resolveAudioBlob(interviewId);
    if (!blob) {
      this.releaseUrl();
      this.interviewId = interviewId;
      usePlayer.getState().setPlayer({ interviewId, playing: false, currentTime: 0, wordIndex: -1 });
      return 'missing';
    }

    this.releaseUrl();
    this.url = URL.createObjectURL(blob);
    this.interviewId = interviewId;
    if (this.el) {
      this.el.src = this.url;
      // `load()` is what makes the element commit to the new source now rather
      // than at the first `play()`; the 150 ms budget cannot afford that wait.
      this.el.load();
      await this.whenReady();
    }

    // Resume where the last listen stood — quietly, without playing. Deep in
    // the tape only: resuming a recording someone barely started is noise, and
    // near the end it would land on the applause.
    const saved = useStore.getState().positions[interviewId] ?? 0;
    const duration = this.el?.duration || Infinity;
    const resumeAt = saved > 8 && saved < duration - 10 ? saved : 0;
    if (this.el && resumeAt > 0) this.el.currentTime = resumeAt;

    usePlayer.getState().setPlayer({ interviewId, currentTime: resumeAt, playing: false, wordIndex: -1 });
    return 'ok';
  }

  /** Persist the playhead for §4.5's resume-listening. Never for a span press
      (a claim being checked is not "where you were"), never at zero. */
  private savePosition(): void {
    if (!this.interviewId || !this.el) return;
    if (this.mode === 'span') return;
    const t = this.el.currentTime;
    if (t > 8) useStore.getState().setPosition(this.interviewId, t);
  }

  /**
   * Settles when the element has enough data to seek and play (readyState 2).
   * Never rejects: a media file the browser cannot decode leaves the player in
   * the same place the missing-audio state does, and the screen above handles
   * that. Bounded, because an element that stalls forever must not wedge a
   * screen behind an unresolved promise.
   */
  private whenReady(timeoutMs = 15000): Promise<void> {
    const el = this.el;
    if (!el || el.readyState >= 2) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        el.removeEventListener('loadeddata', finish);
        el.removeEventListener('error', finish);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      el.addEventListener('loadeddata', finish);
      el.addEventListener('error', finish);
    });
  }

  /** True once the element can seek and play — WP2 gates the scrubber on this. */
  isReady(): boolean {
    return !!this.el && this.el.readyState >= 2;
  }

  /* ---------------------------------------------------------- playback */

  /**
   * The moment. Seek to `anchor.s − preRoll`, play, and stop at
   * `anchor.e + 0.8`. Resolves when audio has actually started, which is what
   * the 150 ms commitment in DESIGN §5 is measured against — `play()`
   * resolving only means the request was accepted.
   */
  playSpan(anchor: Anchor, preRollOverride?: number): Promise<PlaySpanResult> {
    const el = this.el;
    if (!el || !this.url) return Promise.resolve({ latencyMs: -1, startedAt: 0, landedAt: 0 });

    const preRoll = preRollOverride ?? (anchor.quality === 'word' ? PRE_ROLL_SEC : PRE_ROLL_APPROX_SEC);
    const from = Math.max(0, anchor.s - preRoll);

    this.pressedAt = performance.now();
    this.seekTarget = from;
    this.compensated = false;
    this.span = { s: anchor.s, e: anchor.e };
    this.mode = 'span';
    this.stopAt = anchor.e + POST_ROLL_SEC;

    usePlayer.getState().setPlayer({
      span: this.span,
      mode: 'span',
      currentTime: from,
    });

    const started = new Promise<PlaySpanResult>((resolve) => { this.firstAudio = resolve; });
    this.seekAndPlay(from);
    return started;
  }

  /** "Keep listening" — leaves span mode so the auto-stop no longer applies. */
  keepListening(): void {
    this.mode = 'free';
    this.stopAt = Infinity;
    usePlayer.getState().setPlayer({ mode: 'free' });
    if (this.el?.paused) void this.el.play().catch(() => {});
  }

  /** "Play again" — the same span, from its pre-roll, as if freshly pressed. */
  playAgain(): Promise<PlaySpanResult> | void {
    if (!this.span) return;
    return this.playSpan({ ...this.span, quality: 'word' });
  }

  /**
   * Nudge (DESIGN §5): −3 / −1 / +1 / +3 seconds, re-seek and replay from
   * there. The span's stop point moves with it, so a nudged span still stops —
   * nudging is a correction, not an escape from the receipt.
   */
  nudge(delta: number): void {
    const el = this.el;
    if (!el) return;
    if (!(NUDGES as readonly number[]).includes(delta)) return;
    const to = Math.max(0, Math.min(el.duration || Infinity, el.currentTime + delta));
    if (this.span) this.stopAt = Math.max(to + 1, this.stopAt + delta);
    this.seekAndPlay(to);
  }

  /** Where "Pin here" reads from — the position the human chose to trust. */
  currentTime(): number {
    return this.el?.currentTime ?? 0;
  }

  seek(t: number): void {
    const el = this.el;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration || Infinity, t));
    this.writeTime(el.currentTime, true);
  }

  /**
   * ±15 s transport skip (v3 B3, §4.2). Leaves span mode: skipping is a
   * navigation, and a span that auto-stops after being jumped away from
   * would stop somewhere the user never meant.
   */
  skip(direction: 1 | -1): void {
    const el = this.el;
    if (!el) return;
    if (this.mode === 'span') this.keepListening();
    this.seek(el.currentTime + direction * SKIP_SEC);
  }

  /**
   * Skip-silence (v3 B3, §4.2, the Apple iOS 26 table stake). The silence map
   * is the transcript itself: any between-words gap over the threshold is
   * dead air — no audio analysis, works for every transcribed recording.
   * Free-mode only: a pressed span plays exactly what its note claims.
   */
  setSkipSilence(on: boolean): void {
    this.skipSilence = on;
  }

  pause(): void {
    this.el?.pause();
  }

  resume(): void {
    if (!this.el) return;
    void this.el.play().catch(() => {});
  }

  toggle(): void {
    if (!this.el) return;
    if (this.el.paused) this.resume();
    else this.pause();
  }

  setSpeed(rate: number): void {
    if (this.el) this.el.playbackRate = rate;
  }

  /** Subscribe to word-cursor changes. Returns the unsubscribe. */
  onWord(cb: WordListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  destroy(): void {
    this.stopLoop();
    if (this.el) {
      this.el.removeEventListener('ended', this.onEnded);
      this.el.removeEventListener('pause', this.onPauseEvent);
      this.el.removeEventListener('play', this.onPlayEvent);
      this.el.pause();
    }
    this.releaseUrl();
    this.el = null;
    this.listeners.clear();
    usePlayer.getState().resetPlayer();
  }

  /* ------------------------------------------------------------ internals */

  private seekAndPlay(to: number): void {
    const el = this.el;
    if (!el) return;
    const go = () => {
      el.currentTime = to;
      void el.play().catch(() => {});
      this.startLoop();
    };
    // HAVE_CURRENT_DATA or better means seeking is immediate. Below that,
    // assigning currentTime is silently dropped by some browsers, so we wait
    // for the one event that guarantees it will stick.
    if (el.readyState >= 2) go();
    else el.addEventListener('loadeddata', go, { once: true });
  }

  private releaseUrl(): void {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }

  private onPlayEvent = () => {
    usePlayer.getState().setPlayer({ playing: true });
    this.startLoop();
  };

  private onPauseEvent = () => {
    usePlayer.getState().setPlayer({ playing: false });
    this.stopLoop();
    this.savePosition();
  };

  private onEnded = () => {
    this.stopLoop();
    usePlayer.getState().setPlayer({ playing: false });
  };

  private startLoop(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick = () => {
    this.raf = 0;
    const el = this.el;
    if (!el) return;
    const t = el.currentTime;

    // First-audio latency: the first frame where the clock has genuinely moved
    // past where we asked to start, with the element not paused. Anything
    // earlier is the browser accepting a request, not making a sound.
    if (this.firstAudio && !el.paused && t > this.seekTarget) {
      const resolve = this.firstAudio;
      this.firstAudio = null;
      resolve({
        latencyMs: performance.now() - this.pressedAt,
        startedAt: this.seekTarget,
        landedAt: t,
      });
    }

    // Seek compensation — see the header note about VBR files.
    if (!this.compensated && !el.paused && t > 0) {
      this.compensated = true;
      if (Math.abs(t - this.seekTarget) > SEEK_TOLERANCE_SEC && this.seekTarget > 0) {
        el.currentTime = this.seekTarget;
      }
    }

    if (this.mode === 'span' && t >= this.stopAt) {
      el.pause();
      // Land exactly on the stop point so the readout and the scrubber agree
      // with the receipt the user just watched.
      el.currentTime = Math.min(this.stopAt, el.duration || this.stopAt);
      this.writeTime(el.currentTime, true);
      this.setCursor(this.findWord(el.currentTime));
      usePlayer.getState().setPlayer({ playing: false });
      return;
    }

    // Skip-silence: when the playhead sits in a between-words gap longer than
    // the threshold, jump to just before the next word. A hold keeps the first
    // slice of every pause so cuts land on breaths, not mid-consonant.
    if (this.skipSilence && this.mode === 'free' && !el.paused && this.words.length) {
      const n = this.words.length;
      let lo = 0, hi = n - 1, next = n;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (this.words[mid].s > t) { next = mid; hi = mid - 1; } else lo = mid + 1;
      }
      const prevEnd = next > 0 ? this.words[next - 1].e : 0;
      if (next < n && t >= prevEnd) {
        const gap = this.words[next].s - prevEnd;
        const target = this.words[next].s - 0.12;
        if (gap >= SKIP_SILENCE_MIN_GAP_SEC && t >= prevEnd + SKIP_SILENCE_HOLD_SEC && target > t) {
          el.currentTime = target;
          this.writeTime(target, true);
          this.setCursor(this.findWord(target));
          this.raf = requestAnimationFrame(this.tick);
          return;
        }
      }
    }

    this.writeTime(t, false);
    this.setCursor(this.findWord(t));

    if (!el.paused) this.raf = requestAnimationFrame(this.tick);
  };

  private writeTime(t: number, force: boolean): void {
    if (!force && Math.abs(t - this.lastWrittenTime) < TIME_WRITE_STEP_SEC) return;
    this.lastWrittenTime = t;
    usePlayer.getState().setPlayer({ currentTime: t });
  }

  private setCursor(i: number): void {
    if (i === this.cursor) return;
    this.cursor = i;
    // Written on the same frame as the crossing, unthrottled: the karaoke
    // highlight is the one thing in this app that may not be a frame late.
    usePlayer.getState().setPlayer({ wordIndex: i });
    for (const cb of this.listeners) cb(i);
  }

  /**
   * Index of the word being spoken at `t`, or -1 in the gaps between words.
   *
   * Binary search, with a two-step fast path first: playback almost always
   * advances into the current word or the one after it, and checking those
   * costs two comparisons instead of fourteen.
   */
  findWord(t: number): number {
    const n = this.words.length;
    if (!n) return -1;

    const c = this.cursor;
    if (c >= 0 && c < n) {
      if (t >= this.words[c].s && t < this.words[c].e) return c;
      const nxt = c + 1;
      if (nxt < n && t >= this.words[nxt].s && t < this.words[nxt].e) return nxt;
    }

    // Last word whose start is <= t.
    let lo = 0;
    let hi = n - 1;
    let at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid] <= t) { at = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (at < 0) return -1;
    // Between words — nothing is being spoken, so nothing should be lit.
    return t < this.words[at].e ? at : -1;
  }
}

/* ----------------------------------------------------------- resolution */

/**
 * Amendment A3. Bundled content — the sample and every starter-library entry —
 * takes the same door as a user recording: fetch once, `putAudio`, then always
 * IndexedDB. The store is updated to say the file is kept, so Library and the
 * dashed-chip logic see the truth.
 */
export async function resolveAudioBlob(interviewId: string): Promise<Blob | null> {
  const existing = await getAudio(interviewId);
  if (existing) return existing;
  const url = interviewId === SAMPLE_ID ? SAMPLE_AUDIO_URL : starterAudioUrl(interviewId);
  if (!url) return null;

  try {
    // `base: './'` means the app can live under a Pages sub-path; resolving
    // against `baseURI` is what keeps this working there and from file://.
    const res = await fetch(new URL(url, document.baseURI).href);
    if (!res.ok) return null;
    const blob = await res.blob();
    await putAudio(interviewId, blob);
    const store = useStore.getState();
    const interview = store.interviews[interviewId];
    if (interview) {
      store.updateInterview(interviewId, { file: { ...interview.file, kept: true } });
    }
    return blob;
  } catch {
    // Offline on first run: the sample's chips go dashed and the transcript
    // still reads. Nothing errors, nothing modals (DESIGN §5).
    return null;
  }
}

/* ------------------------------------------------------------ singleton */

let instance: Player | null = null;

/** One controller, one `<audio>`, for the life of the app. */
export function getPlayer(): Player {
  if (!instance) instance = new Player();
  return instance;
}
