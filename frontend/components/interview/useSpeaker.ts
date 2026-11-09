"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { raw, json } from "@/lib/api";
import { splitSpeech } from "@/lib/speech";
import { interviewerProfile } from "@/lib/interviewers";

/* The interviewer's voice, built to sound like one continuous person rather than a stack of clips.
   - Neural MP3 segments are decoded before playback to preserve clarity. PCM streaming remains a fallback;
     both are scheduled on the Web Audio clock.
   - Text arrives while the model is still writing. The first sentence is spoken at once; after that the rest of the reply is sent as one piece
     (long replies in batches of three sentences), so the voice keeps one natural delivery instead of restarting its intonation every sentence.
   - If neural speech fails for a piece, the browser's own voice reads that piece, chosen to match the interviewer's gender. */

const RATE = 24000;
const FEMALE = /samantha|ava|serena|karen|moira|tessa|veena|zira|aria|jenny|female|susan|fiona|allison|victoria|raveena/i;
const MALE = /daniel|alex|fred|tom|oliver|rishi|guy|david|mark|male|ryan|george|arthur/i;

function browserVoice(gender: string): SpeechSynthesisVoice | null {
  const vs = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
  const fit = (v: SpeechSynthesisVoice) => (gender === "female" ? (FEMALE.test(v.name) ? 8 : MALE.test(v.name) ? -8 : 0) : gender === "male" ? (MALE.test(v.name) ? 8 : FEMALE.test(v.name) ? -8 : 0) : 0);
  const score = (v: SpeechSynthesisVoice) => fit(v) + (/natural|neural|enhanced|premium/i.test(v.name) ? 6 : 0) + (/en-IN/i.test(v.lang) ? 2 : /en-(US|GB)/i.test(v.lang) ? 1 : 0) + (v.localService ? 0 : 1);
  return [...vs].sort((a, b) => score(b) - score(a))[0] ?? null;
}

interface Chunk { text: string; pieces: AudioBuffer[]; done: boolean; failed: boolean; started: boolean; startAt?: number; endAt: number; instant?: boolean; waitSince?: number }

export function useSpeaker(opts: { sessionId: number; gender: string; persona?: string; enabled: boolean }) {
  const { sessionId, gender, enabled, persona } = opts;
  const [speaking, setSpeaking] = useState(false);
  const [delivery, setDelivery] = useState<"neural" | "browser" | "interrupted">("neural");
  const [busy, setBusy] = useState(false);            // a reply is being spoken (from the first request until the last sound has played)
  const [revealed, setRevealed] = useState("");       // the words spoken so far, kept in step with the audio clock
  const revealedRef = useRef("");
  const timeline = useRef<Chunk[]>([]);                // every chunk of the current reply, in order, with when each starts and ends
  const speakingRef = useRef(false);
  const endedAt = useRef(0);                        // when the interviewer last went quiet (ms), so the listener can ignore the echo tail
  const level = useRef(0);
  const shape = useRef(0.5);                        // 0 = rounded vowels (oo, oh), 1 = wide vowels (ee), from the audio spectrum; drives the lips
  const ctx = useRef<AudioContext | null>(null);
  const gain = useRef<GainNode | null>(null);
  const capture = useRef<MediaStreamAudioDestinationNode | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const raf = useRef(0);
  const nextAt = useRef(0);                         // when the next piece of audio should start, on the audio clock
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const chunks = useRef<Chunk[]>([]);               // in speaking order; the head is the one being played
  const pending = useRef<string[]>([]);             // finished sentences waiting to be sent as a pair
  const buffer = useRef("");                        // text received but not yet a whole sentence
  const replyText = useRef("");                     // the whole reply so far, so the words can be shown even if no sound can be played
  const firstSent = useRef(false);
  const ended = useRef(false);                      // the whole reply has been received
  const generation = useRef(0);                     // bumped by stop(): anything from an older reply is discarded
  const idle = useRef<(() => void) | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aborts = useRef<AbortController[]>([]);
  const fallbackBusy = useRef(false);

  const setSpk = (v: boolean) => { if (speakingRef.current !== v) { speakingRef.current = v; if (!v) endedAt.current = Date.now(); setSpeaking(v); } };

  const ensure = useCallback(() => {
    if (ctx.current) return ctx.current;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // A larger device buffer trades a few ms of delay for glitch-free sound.
    const c = new AC({ latencyHint: "playback" }); ctx.current = c;
    const g = c.createGain(); g.gain.value = 0.9; gain.current = g;
    const an = c.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = 0.4; analyser.current = an;
    g.connect(an); an.connect(c.destination);
    capture.current = c.createMediaStreamDestination(); g.connect(capture.current);
    const buf = new Float32Array(an.fftSize);
    const freq = new Uint8Array(an.frequencyBinCount);
    const loop = () => {
      an.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const target = c.currentTime < nextAt.current ? Math.min(1, Math.sqrt(sum / buf.length) * 9) : 0;
      level.current += (target - level.current) * 0.4;
      // Vowel shape: where the energy sits in the spectrum. Low (about 500 Hz) is "oo/oh", high (about 2.4 kHz) is "ee", so the lips round or spread.
      if (target > 0.04) {
        an.getByteFrequencyData(freq);
        const hz = c.sampleRate / an.fftSize; let num = 0, den = 0;
        for (let i = 2; i < 48; i++) { num += i * hz * freq[i]; den += freq[i]; }
        const centroid = den > 0 ? num / den : 1200;
        shape.current += (Math.max(0, Math.min(1, (centroid - 450) / 1900)) - shape.current) * 0.3;
      } else shape.current += (0.5 - shape.current) * 0.1;
      // Reveal text in step with the voice: each chunk's words appear across the time its audio plays.
      const heardAt = c.currentTime - Math.min(0.8, (c.outputLatency || 0) + (c.baseLatency || 0));   // what the speakers are playing right now, not what was handed to them
      const now = heardAt + 0.08, out: string[] = [];   // text leads the sound by a hair, so it never feels late
      for (const ch of timeline.current) {
        if (ch.instant) { out.push(ch.text); continue; }
        if (ch.startAt === undefined || now < ch.startAt) break;
        const words = ch.text.split(/\s+/);
        const span = Math.max(ch.endAt - ch.startAt, ch.done ? 0 : words.length * 0.36);
        const frac = span > 0 ? Math.min(1, (now - ch.startAt) / span) : 1;
        out.push(words.slice(0, Math.min(words.length, Math.ceil(frac * words.length))).join(" "));
        if (frac < 1) break;
      }
      const txt = out.join(" ");
      if (txt !== revealedRef.current) { revealedRef.current = txt; setRevealed(txt); }
      raf.current = requestAnimationFrame(loop);
    };
    loop();
    return c;
  }, []);

  const checkIdle = useCallback(() => {
    const c = ctx.current;
    if (idleTimer.current) { clearTimeout(idleTimer.current); idleTimer.current = null; }
    if (!c) return;
    const pendingWork = chunks.current.length > 0 || fallbackBusy.current || !ended.current || pending.current.length > 0 || buffer.current.trim().length > 0;
    const remaining = nextAt.current - c.currentTime;
    if (remaining > 0.02) { idleTimer.current = setTimeout(checkIdle, remaining * 1000 + 40); setSpk(true); return; }
    if (pendingWork) return;
    setSpk(false); setBusy(false);
    const f = idle.current; idle.current = null; f?.();
  }, []);

  /** Move audio from the head chunk onto the clock. Called whenever new audio arrives or a chunk finishes. */
  const pump = useCallback(() => {
    const c = ctx.current, g = gain.current;
    if (!c || !g) return;
    for (;;) {
      const head = chunks.current[0];
      if (!head) break;
      if (head.failed && head.pieces.length === 0) {
        if (fallbackBusy.current) return;                 // the browser voice is reading this piece
        const text = head.text;
        const runway = nextAt.current - c.currentTime;
        if (runway > 0.03) { setTimeout(pump, runway * 1000 + 30); setSpk(true); return; }   // never start the browser voice over audio that is still playing
        chunks.current.shift();
        head.instant = true;                                   // the browser voice cannot be timed, so its words appear at once
        if (text && "speechSynthesis" in window) {
          fallbackBusy.current = true; setDelivery("browser"); setSpk(true);
          const u = new SpeechSynthesisUtterance(text); u.rate = interviewerProfile(persona ?? "")?.rate ?? 1; const v = browserVoice(gender); if (v) { u.voice = v; u.lang = v.lang; }
          const gen = generation.current;
          const done = () => { if (gen !== generation.current) return; fallbackBusy.current = false; pump(); checkIdle(); };
          u.onend = done; u.onerror = () => { if (gen === generation.current) setDelivery("interrupted"); done(); }; speechSynthesis.speak(u);
          return;
        }
        setDelivery("interrupted");
        continue;
      }
      // Jitter buffer: if the audio already queued is about to run out, wait for ~350 ms of this piece (or its end) before starting it,
      // rather than playing in stuttering bursts as it trickles in. A timer guarantees it never waits more than about a second.
      if (!head.started && !head.done && head.pieces.length) {
        const have = head.pieces.reduce((n, p) => n + p.duration, 0);
        const runway = nextAt.current - c.currentTime;
        head.waitSince ??= performance.now();
        if (have < 0.35 && runway < 0.3 && performance.now() - head.waitSince < 1000) { setTimeout(pump, 260); setSpk(true); return; }
      }
      while (head.pieces.length) {
        const piece = head.pieces.shift()!;
        const src = c.createBufferSource(); src.buffer = piece; src.connect(g);
        const at = Math.max(c.currentTime + 0.04, nextAt.current);
        src.start(at); nextAt.current = at + piece.duration;
        if (head.startAt === undefined) head.startAt = at;
        head.endAt = nextAt.current;
        sources.current.push(src); head.started = true;
        src.onended = () => { sources.current = sources.current.filter((x) => x !== src); };
      }
      if (head.done) { chunks.current.shift(); continue; }  // everything of this chunk is scheduled: the next may follow gaplessly
      break;
    }
    setSpk(true); checkIdle();
  }, [checkIdle, gender, persona]);

  /** Stream one piece of text from the server and feed it to the head of the queue as it arrives. */
  const request = useCallback((text: string, into: Chunk, gen: number) => {
    let ac = new AbortController(); aborts.current.push(ac);
    /** One streaming attempt. Throws if it fails before any audio has been handed to the player (so it is safe to try again). */
    const streamOnce = async () => {
      const res = await raw(`/interviews/${sessionId}/speak?fmt=pcm`, { ...json({ text }), signal: ac.signal });
      const reader = res.body!.getReader();
      let carry = new Uint8Array(0), pend = new Float32Array(0);
      let first = true, gotAudio = false;
      const flush = (force: boolean) => {
        if (gen !== generation.current || !ctx.current) return;
        if (pend.length >= RATE * 0.2 || (force && pend.length)) {
          const F = 120;                                         // 5 ms fades at the start and end of each piece, so joins never click
          if (first) { for (let i = 0; i < Math.min(F, pend.length); i++) pend[i] *= i / F; first = false; }
          if (force) { for (let i = 0; i < Math.min(F, pend.length); i++) pend[pend.length - 1 - i] *= i / F; }
          const b = ctx.current.createBuffer(1, pend.length, RATE); b.copyToChannel(pend as Float32Array<ArrayBuffer>, 0);
          pend = new Float32Array(0); into.pieces.push(b); gotAudio = true; pump();
        }
      };
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value?.length) continue;
          const bytes = new Uint8Array(carry.length + value.length); bytes.set(carry); bytes.set(value, carry.length);
          const usable = bytes.length - (bytes.length % 2);
          carry = bytes.slice(usable);
          const dv = new DataView(bytes.buffer, 0, usable);
          const add = new Float32Array(usable / 2);
          for (let i = 0; i < add.length; i++) add[i] = dv.getInt16(i * 2, true) / 32768;
          const merged = new Float32Array(pend.length + add.length); merged.set(pend); merged.set(add, pend.length); pend = merged;
          flush(false);
        }
        flush(true);
      } catch (e) {
        if (gotAudio) { if (gen === generation.current) setDelivery("interrupted"); into.done = true; if (gen === generation.current) pump(); return; }   // the stream dropped late: play what arrived rather than repeat it
        throw e;
      }
      if (!gotAudio) throw new Error("empty");
      into.done = true;
      if (gen === generation.current) pump();
    };
    /** Same neural voice by another route: ask for a complete MP3 and decode it. */
    const viaMp3 = async () => {
      const res = await raw(`/interviews/${sessionId}/speak`, { ...json({ text }), signal: ac.signal });
      const buf = await ctx.current!.decodeAudioData(await res.arrayBuffer());
      if (gen !== generation.current) return;
      into.pieces.push(buf); into.done = true; pump();
    };
    // Stay with the same neural voice: three tries (complete clip, streamed, complete clip again), each with its own 20 s window and a fresh
    // connection. Only if all three fail does the browser's voice read the line, which is a last resort and not a normal path.
    void (async () => {
      const first = timeline.current[0] === into;   // the opening sentence streams, so sound starts as soon as the first bytes arrive; the rest are whole clips
      for (const route of (first ? ["pcm", "mp3", "mp3"] : ["mp3", "pcm", "mp3"]) as ("mp3" | "pcm")[]) {
        if (gen !== generation.current) return;
        ac = new AbortController(); aborts.current.push(ac);
        const timer = setTimeout(() => ac.abort(), 20000);
        try { if (route === "mp3") await viaMp3(); else await streamOnce(); return; }
        catch { if (gen !== generation.current) return; await new Promise((r) => setTimeout(r, 350)); }
        finally { clearTimeout(timer); }
      }
      if (gen !== generation.current) return;
      into.failed = true; into.done = true; pump();
    })();
  }, [pump, sessionId]);

  const enqueue = useCallback((text: string) => {
    const t = text.trim();
    if (!t || !enabled) return;
    ensure();
    for (const piece of splitSpeech(t)) {
      const chunk: Chunk = { text: piece, pieces: [], done: false, failed: false, started: false, endAt: 0 };
      chunks.current.push(chunk); timeline.current.push(chunk);
      request(piece, chunk, generation.current);
    }
  }, [enabled, ensure, request]);

  const flushPending = useCallback(() => { if (pending.current.length) { enqueue(pending.current.join(" ")); pending.current = []; } }, [enqueue]);

  /** Start a new reply. `onIdle` runs once everything has been spoken. */
  const begin = useCallback((onIdle?: () => void) => {
    setDelivery("neural"); generation.current++; buffer.current = ""; replyText.current = ""; pending.current = []; firstSent.current = false; ended.current = false; idle.current = onIdle ?? null;
    if (ctx.current?.state === "suspended") void ctx.current.resume();   // by now the candidate has typed or clicked, so the browser allows sound
    // Exactly one voice at a time: anything from a previous reply that is still playing, queued or downloading is cut off here.
    aborts.current.forEach((a) => a.abort()); aborts.current = [];
    sources.current = sources.current.filter((x) => {
      try { x.onended = null; x.stop(); } catch {}
      return false;
    });
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    fallbackBusy.current = false;
    chunks.current = []; timeline.current = []; revealedRef.current = ""; setRevealed(""); setBusy(enabled);
    nextAt.current = (ctx.current?.currentTime ?? 0);   // schedule this reply on the current audio clock
  }, [enabled]);

  /** Feed text as it streams in. */
  const push = useCallback((delta: string) => {
    buffer.current += delta; replyText.current += delta;
    for (;;) {
      const re = /([.!?…]+["')\]]*)\s+/g;
      let m: RegExpExecArray | null, cut = -1;
      while ((m = re.exec(buffer.current))) { const c = m.index + m[1].length; if (buffer.current.slice(0, c).trim().length >= 14) { cut = c; break; } }
      if (cut < 0) break;
      const sentence = buffer.current.slice(0, cut);
      buffer.current = buffer.current.slice(cut).trimStart();
      if (!firstSent.current) { firstSent.current = true; enqueue(sentence); }       // the first sentence goes out immediately
      else { pending.current.push(sentence.trim()); if (pending.current.length >= 3) flushPending(); }   // the rest of a normal reply goes out as ONE piece
    }
  }, [enqueue, flushPending]);

  /** The reply is complete: speak whatever is left. */
  const end = useCallback(() => {
    // If the browser is not letting us play sound (autoplay blocked, audio device gone), never hang waiting for audio that cannot come:
    // show the whole reply and hand the turn to the candidate straight away.
    const c = ctx.current;
    if (enabled && c && c.state !== "running") {
      void c.resume();
      generation.current++; aborts.current.forEach((a) => a.abort()); aborts.current = [];
      chunks.current = []; pending.current = []; buffer.current = ""; ended.current = true;
      const full = replyText.current.trim(); revealedRef.current = full; setRevealed(full);
      sources.current.forEach((x) => { try { x.onended = null; x.stop(); } catch {} }); sources.current = [];
      nextAt.current = c.currentTime; setSpk(false); setBusy(false);
      const f = idle.current; idle.current = null; f?.();
      return;
    }
    const rest = buffer.current.trim(); buffer.current = "";
    if (rest) pending.current.push(rest);
    flushPending();
    ended.current = true;
    pump(); checkIdle();
  }, [enabled, flushPending, pump, checkIdle]);

  /** Stop talking now (the candidate interrupted, or the interview ended). */
  const stop = useCallback(() => {
    generation.current++; buffer.current = ""; pending.current = []; chunks.current = []; ended.current = true; idle.current = null;
    aborts.current.forEach((a) => a.abort()); aborts.current = [];
    sources.current.forEach((s) => { try { s.onended = null; s.stop(); } catch {} }); sources.current = [];
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    fallbackBusy.current = false;
    nextAt.current = ctx.current?.currentTime ?? 0;
    if (idleTimer.current) { clearTimeout(idleTimer.current); idleTimer.current = null; }
    setSpk(false); setBusy(false);
  }, []);

  /** Unlock audio from a click (browsers refuse to play sound before one). */
  const unlock = useCallback(() => { const c = ensure(); void c.resume(); }, [ensure]);

  useEffect(() => () => { stop(); cancelAnimationFrame(raf.current); void ctx.current?.close(); }, [stop]);
  return { getStream: () => { ensure(); return capture.current!.stream; }, speaking, delivery, busy, revealed, speakingRef, endedAt, level, shape, begin, push, end, stop, unlock, speakWhole: (text: string, onIdle?: () => void) => { begin(onIdle); push(text); end(); } };
}
