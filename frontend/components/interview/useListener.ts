"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { maySubmitAfterSilence, COMPLETION_CHECK_TIMEOUT_MS, END_OF_ANSWER, hasConfidentTranscript } from "@/lib/interviewTiming";
import { json, raw } from "@/lib/api";

/* Automatic turn capture with a bounded completion check and a fast final-transcript path. */

export type Patience = "patient" | "normal" | "quick";
export const PATIENCE_MS: Record<Patience, number> = { patient: 3000, normal: 1800, quick: 1100 };
const UNFINISHED = /\b(and|so|but|because|then|like|um+|uh+|the|a|to|of|that|which|with|also|or|if)\s*[,.]?\s*$|,\s*$/i;
const MAX_TURN_MS = 8 * 60_000;
const MIN_VOICED_MS = 900;     // real speech needed before a turn can even be considered; shorter bursts are noise (a cough, a door, a keyboard)
const RUN_TICKS = 4;           // voice-like sound must last this many 50 ms ticks in a row (200 ms) to count; clicks and bumps are shorter
const SPEECH_RATIO = 0.62;     // share of the sound's energy that must sit in the speech band (300 Hz to 3.4 kHz); fans, hum and hiss fail this
// Phrases transcription models invent when given silence or noise. Dropped when the clip had little real speech.
const PHANTOM = /^(thank you for watching|thanks for watching|please subscribe|subtitles? by .*|amara\.org.*|www\..*|\.+)[.!\s]*$/i;
// How much quiet must pass before the app even considers that you have finished. A person needs a few seconds of breathing room, and an
// interviewer who jumps in the instant you pause feels rude, so the gap is deliberate.
const QUICK_PAUSE_MS: Record<Patience, number> = { patient: 1500, normal: 900, quick: 650 };
const ECHO_GAP_MS = 500;           // ignore the first half second after the interviewer stops: that is its own voice fading in the room

interface Rec {
  lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null;
}
const recCtor = (): (new () => Rec) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
const words = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2);
/** True when most of what was "said" is already in the interviewer's last line: speaker echo, not the candidate. */
function isEcho(heard: string, spoken: string): boolean {
  const h = words(heard), sp = new Set(words(spoken));
  if (h.length < 6 || sp.size < 6) return false;
  return h.filter((w) => sp.has(w)).length / h.length >= 0.85;
}
const calibrated = (): number => { try { return Number(localStorage.getItem("hp_mic_rms")) || 0; } catch { return 0; } };   // your own voice level, measured in the system check
const pickMime = () => ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";

export type ListenState = "off" | "idle" | "hearing" | "transcribing";

export function useListener(opts: { sessionId: number; patience: Patience; autoSubmit?: boolean; onTurn: (text: string) => void; onBargeIn?: () => void; speakingRef?: React.RefObject<boolean>; endedAt?: React.RefObject<number>; getSpoken?: () => string; allowBarge?: boolean }) {
  const { sessionId, patience } = opts;
  const [state, setState] = useState<ListenState>("off");
  const [partial, setPartial] = useState("");
  const [muted, setMutedState] = useState(false);
  const [error, setError] = useState("");
  const level = useRef(0);                       // 0..1, read by the visuals every frame without re-rendering
  const onTurn = useRef(opts.onTurn); onTurn.current = opts.onTurn;
  const onBarge = useRef(opts.onBargeIn); onBarge.current = opts.onBargeIn;
  const automatic = useRef(opts.autoSubmit ?? false); automatic.current = opts.autoSubmit ?? false;
  const deferUntil = useRef(0);
  const patienceRef = useRef(patience); patienceRef.current = patience;
  const barge = useRef(!!opts.allowBarge); barge.current = !!opts.allowBarge;
  const spokenRef = useRef(opts.getSpoken); spokenRef.current = opts.getSpoken;
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const cleanStream = useRef<MediaStream | null>(null);   // what gets transcribed: your voice only, with rumble, hiss and room noise filtered out
  const gateNode = useRef<GainNode | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const sr = useRef<Rec | null>(null);
  const srText = useRef("");
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const listening = useRef(false);
  const floor = useRef(0.006);
  const voiced = useRef(0);
  const lastVoice = useRef(0);
  const turnStart = useRef(0);
  const loud = useRef(0);                        // ms of sustained speech while the interviewer is talking (barge-in)
  const busy = useRef(false);
  const run = useRef(0);                         // consecutive ticks of voice-like sound
  const checking = useRef(false);                // a "has this person finished?" check is in flight
  const completionAbort = useRef<AbortController | null>(null);
  const checkStarted = useRef(0);
  const srFinal = useRef(false);
  const textChangedAt = useRef(0);
  const turnVersion = useRef(0);
  const transcriptionAbort = useRef<AbortController | null>(null);
  const spec = useRef<{ stamp: number; version: number; ctl: AbortController; promise: Promise<string> } | null>(null);   // a transcription started during a pause, ready if you do not speak again
  const specCount = useRef(0);
  const checkedFor = useRef(0);                  // the pause (identified by when you last spoke) that was already checked

  /** Start transcribing what has been said so far while the pause is still running, so the text is ready the moment the pause turns out to be the end. */
  const speculate = () => {
    const rec = recorder.current;
    if (!rec || rec.state !== "recording") return;
    const stamp = voiced.current, version = turnVersion.current, ms = Date.now() - turnStart.current, ctl = new AbortController();
    const promise = (async () => {
      try { rec.requestData(); } catch {}
      await new Promise((r) => setTimeout(r, 90));
      const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
      if (blob.size < 1500) return "";
      const r = await raw(`/interviews/${sessionId}/transcribe?ms=${ms}&voiced=${stamp}`, { method: "POST", body: blob, headers: { "Content-Type": blob.type.split(";")[0] || "audio/webm" }, signal: ctl.signal });
      return ((await r.json()) as { text: string }).text.trim();
    })();
    promise.catch(() => {});
    spec.current = { stamp, version, ctl, promise }; specCount.current++;
  };

  const finish = useCallback(async (explicit = false) => {
    if (!listening.current || busy.current) return;
    busy.current = true; listening.current = false;
    const version = turnVersion.current;
    completionAbort.current?.abort();
    const rec = recorder.current;
    const ms = Date.now() - turnStart.current;
    const heardMs = voiced.current;
    const sp = spec.current; spec.current = null;
    const live = srText.current.trim();
    const finalLive = srFinal.current;
    const explicitEnd = END_OF_ANSWER.test(live);
    const confidentLive = hasConfidentTranscript(live, finalLive, heardMs);
    try { sr.current?.abort(); } catch {}
    sr.current = null;
    const blob = await new Promise<Blob | null>((resolve) => {
      if (!rec || rec.state === "inactive") return resolve(chunks.current.length ? new Blob(chunks.current, { type: rec?.mimeType || "audio/webm" }) : null);
      rec.onstop = () => resolve(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }));
      rec.stop();
    });
    recorder.current = null; chunks.current = [];
    if (heardMs < MIN_VOICED_MS && !confidentLive && !((explicit || explicitEnd) && heardMs >= 250 && live.length >= 2)) { busy.current = false; setPartial(""); setState("idle"); startRec(); return; }   // not enough real speech: ignore it, keep listening
    setState("transcribing");
    let text = "";
    const controller = new AbortController(); transcriptionAbort.current = controller;
    const timeout = setTimeout(() => controller.abort(), live ? 6000 : 12000);
    try {
      // The server model hears accents and technical words far better than the browser's recogniser, so it is the primary transcript; the browser text is only a fallback.
      let ready = "";
      if (sp && sp.version === version && sp.stamp === heardMs) { try { ready = await Promise.race([sp.promise, new Promise<string>((_, no) => setTimeout(() => no(new Error("slow")), 6000))]); } catch { ready = ""; } }
      if (ready) text = ready;     // already transcribed during the pause: no waiting now
      else if (blob && blob.size > 1500) {
        const r = await raw(`/interviews/${sessionId}/transcribe?ms=${ms}&voiced=${heardMs}`, { method: "POST", body: blob, headers: { "Content-Type": blob.type.split(";")[0] || "audio/webm" }, signal: controller.signal });
        text = ((await r.json()) as { text: string }).text.trim();
      } else text = live;
    } catch {
      text = live; // transcription unavailable: fall back to what the browser heard so the answer is not lost
      if (!text) setError("Could not transcribe that. Say it again, or switch to typing.");
    }
    finally { clearTimeout(timeout); if (transcriptionAbort.current === controller) transcriptionAbort.current = null; }
    if (version !== turnVersion.current) { busy.current = false; return; }
    // Only a near word-for-word copy of the interviewer's last line counts as speaker echo; anything else is the candidate and is kept.
    let dropped = false;
    if (!explicit && text && isEcho(text, spokenRef.current?.() ?? "")) { text = ""; dropped = true; }
    busy.current = false;
    setPartial("");
    if (!explicit && PHANTOM.test(text.trim()) && heardMs < 2500) { text = ""; dropped = true; }   // caption leftovers invented from silence or noise
    if (text.replace(/[^\p{L}\p{N}]/gu, "").length < 2) { if (dropped) setError("I didn't catch that. Please say it again."); setState("idle"); startRec(); return; } // noise or a cough: keep listening
    setState("idle");
    onTurn.current(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const startRec = useCallback(() => {
    const s = stream.current;
    if (!s || listening.current || busy.current) return;
    turnVersion.current++; completionAbort.current?.abort();
    srFinal.current = false; textChangedAt.current = 0;
    spec.current?.ctl.abort(); spec.current = null; specCount.current = 0;
    chunks.current = []; srText.current = ""; voiced.current = 0; lastVoice.current = 0; checkedFor.current = 0; checking.current = false; deferUntil.current = 0; turnStart.current = Date.now();
    try {
      const mime = pickMime();
      const source = cleanStream.current && ctx.current?.state === "running" ? cleanStream.current : s;   // the raw mic is the safety net if the clean path is not running
      const rec = new MediaRecorder(source, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 96000 });
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.start(500);
      recorder.current = rec;
    } catch { setError("Recording is not supported in this browser."); return; }
    const C = recCtor();
    if (C) {
      try {
        const r = new C(); r.lang = "en-IN"; r.continuous = true; r.interimResults = true;
        let previousSegments = "";
        r.onresult = (e) => {
          if (!listening.current || sr.current !== r) return;
          let fin = "", interim = "";
          for (let i = 0; i < e.results.length; i++) { const res = e.results[i]; if (res.isFinal) fin += res[0].transcript + " "; else interim += res[0].transcript; }
          const next = (previousSegments + fin + interim).trim();
          if (next !== srText.current) {
            textChangedAt.current = Date.now();
            // Recognized words are speech evidence even when a soft voice misses the energy threshold.
            if (next.length >= 2 && !(opts.speakingRef?.current ?? false)) { voiced.current = Math.max(voiced.current, 250); lastVoice.current = Date.now(); setState("hearing"); }
          }
          srText.current = next; srFinal.current = !interim.trim() && !!fin.trim();
          setPartial(srText.current);
        };
        r.onend = () => { if (listening.current) { previousSegments = srText.current.trim() + " "; try { r.start(); } catch {} } };  // Chrome stops after silence: keep it going while we still listen
        r.onerror = () => {};
        r.start(); sr.current = r;
      } catch {}
    }
    listening.current = true;
    setState("idle");
  }, []);

  /** Open the mic and start the detector. Call from a click so the browser allows audio. */
  const open = useCallback(async () => {
    if (stream.current) return true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 } });
      stream.current = s;
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const c = new AC(); ctx.current = c;
      const a = c.createAnalyser(); a.fftSize = 1024; const src = c.createMediaStreamSource(s); src.connect(a); analyser.current = a; void c.resume();
      // Clean path for transcription: cut rumble (below 90 Hz) and hiss (above 7.6 kHz), hold the sound back a quarter of a second, and close a gate
      // whenever no voice is present. The delay lets the gate open just before a word arrives so no word is clipped; the closed gate leaves
      // near-silence between words, which is what stops the transcriber from inventing words out of background noise.
      const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 90;
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 7600;
      const lead = c.createDelay(0.5); lead.delayTime.value = 0.25;
      const gate = c.createGain(); gate.gain.value = 0.03;
      const cleanDest = c.createMediaStreamDestination();
      src.connect(hp); hp.connect(lp); lp.connect(lead); lead.connect(gate); gate.connect(cleanDest);
      gateNode.current = gate; cleanStream.current = cleanDest.stream;
      const buf = new Float32Array(a.fftSize);
      const freq = new Uint8Array(a.frequencyBinCount);
      const hz = c.sampleRate / a.fftSize, binLo = Math.max(1, Math.round(300 / hz)), binHi = Math.round(3400 / hz), binTop = Math.round(8000 / hz);
      const mine = calibrated();                                      // how loud you were in the system check
      let calib = 0, calibSum = 0;
      tick.current = setInterval(() => {
        a.getFloatTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        level.current = Math.min(1, rms * 9);
        if (calib < 14) { calib++; calibSum += rms; floor.current = Math.max(0.004, calibSum / calib); return; } // first ~0.7 s: learn the room's noise
        const speakingNow = opts.speakingRef?.current ?? false;
        // Quiet background sound, and other people talking further away, are quieter than your own voice at the mic: require a fraction of it.
        const hi = Math.max(speakingNow ? 0.05 : 0.014, floor.current * (speakingNow ? 9 : 3.2), mine * 0.35), lo = Math.max(0.009, floor.current * 2, mine * 0.2);
        const echoTail = Date.now() - (opts.endedAt?.current ?? 0) < ECHO_GAP_MS;
        // Is it shaped like a voice? Most of the energy of speech sits between 300 Hz and 3.4 kHz; keyboards, fans, clicks and hiss do not.
        a.getByteFrequencyData(freq);
        let sp = 0, tot = 0;
        for (let i = 1; i < binTop && i < freq.length; i++) { const m = 10 ** ((freq[i] / 255 * 70 - 100) / 20); tot += m; if (i >= binLo && i <= binHi) sp += m; }
        const speechLike = tot > 0 && sp / tot >= (listening.current && voiced.current > 0 ? SPEECH_RATIO - 0.1 : SPEECH_RATIO);
        const loudEnough = rms > hi || (rms > lo && Date.now() - lastVoice.current < 600);
        { const open = !echoTail && !speakingNow && ((rms > lo && speechLike) || (Date.now() - lastVoice.current < 450 && rms > lo * 0.7)); gateNode.current?.gain.setTargetAtTime(open ? 1 : 0.03, c.currentTime, open ? 0.012 : 0.1); }
        run.current = !echoTail && loudEnough && speechLike ? run.current + 1 : Math.max(0, run.current - 2);
        const voice = run.current >= RUN_TICKS || (run.current > 0 && Date.now() - lastVoice.current < 500 && loudEnough && speechLike);
        if (!loudEnough) floor.current = floor.current * 0.985 + rms * 0.015;
        if (speakingNow && !listening.current) {
          if (!barge.current) return;                                  // interrupting is off unless the candidate asked for it (it needs headphones)
          loud.current = voice ? loud.current + 50 : 0;
          if (loud.current >= 900) { loud.current = 0; onBarge.current?.(); startRec(); }   // you started talking over the interviewer: they stop, you have the floor
          return;
        }
        if (!listening.current) return;
        if (voice) { if (spec.current) { spec.current.ctl.abort(); spec.current = null; } voiced.current += 50; lastVoice.current = Date.now(); setState((st) => (st === "hearing" ? st : "hearing")); }
        const now = Date.now(), silent = lastVoice.current ? now - lastVoice.current : 0;
        const words = srText.current.trim().split(/\s+/).filter(Boolean).length;
        const hasLive = words > 0;
        // Without live words to judge, fall back to plain silence, capped so it never feels sluggish.
        const finished = END_OF_ANSWER.test(srText.current);
        const maxWait = finished ? 650 : PATIENCE_MS[patienceRef.current] + (UNFINISHED.test(srText.current) ? 1600 : 0);
        if (automatic.current && (voiced.current >= MIN_VOICED_MS || hasConfidentTranscript(srText.current, srFinal.current, voiced.current) || finished && voiced.current >= 250) && lastVoice.current) {
          const pauseKey = textChangedAt.current || lastVoice.current;
          if (silent >= 550 && voiced.current >= MIN_VOICED_MS && !spec.current && specCount.current < 4) speculate();
          if (!finished && hasLive && words >= 3 && silent >= QUICK_PAUSE_MS[patienceRef.current] && !checking.current && checkedFor.current !== pauseKey && !UNFINISHED.test(srText.current)) {
            const stamp = pauseKey, version = turnVersion.current;
            const controller = new AbortController(); completionAbort.current = controller;
            const deadline = setTimeout(() => controller.abort(), COMPLETION_CHECK_TIMEOUT_MS);
            checking.current = true; checkStarted.current = now; checkedFor.current = stamp;
            void raw(`/interviews/${sessionId}/turn-check`, { ...json({ text: srText.current }), signal: controller.signal })
              .then((r) => r.json() as Promise<{ complete: boolean; available?: boolean }>)
              .then((d) => {
                if (controller.signal.aborted || version !== turnVersion.current || !automatic.current || !listening.current || (textChangedAt.current || lastVoice.current) !== stamp) return;
                if (d.complete && Date.now() - lastVoice.current >= 400) void finish();
                else if (!d.complete && d.available !== false) deferUntil.current = lastVoice.current + (patienceRef.current === "patient" ? 6500 : patienceRef.current === "quick" ? 2800 : 4000);
              })
              .catch(() => {})
              .finally(() => { clearTimeout(deadline); if (completionAbort.current === controller) { checking.current = false; completionAbort.current = null; } });
          }
          if (maySubmitAfterSilence({ automatic: automatic.current, silentMs: silent, requiredMs: maxWait, now, deferUntil: finished ? 0 : deferUntil.current, checking: finished ? false : checking.current, checkingMs: now - checkStarted.current })) void finish();
        }
        if (now - turnStart.current > MAX_TURN_MS) void finish();
      }, 50);
      setState("idle");
      return true;
    } catch (e) {
      setError((e as DOMException)?.name === "NotAllowedError" ? "Microphone permission was denied." : "No microphone found.");
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finish, startRec]);

  const startListening = useCallback(() => { setError(""); startRec(); }, [startRec]);
  const stopListening = useCallback(() => {
    listening.current = false; turnVersion.current++;
    completionAbort.current?.abort(); transcriptionAbort.current?.abort(); spec.current?.ctl.abort(); spec.current = null;
    try { recorder.current?.state !== "inactive" && recorder.current?.stop(); } catch {}
    try { sr.current?.abort(); } catch {}
    recorder.current = null; sr.current = null; chunks.current = [];
    setPartial(""); setState((s) => (s === "off" ? s : "idle"));
  }, []);
  const close = useCallback(() => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null; stopListening();
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    void ctx.current?.close(); ctx.current = null; analyser.current = null;
    setState("off");
  }, [stopListening]);
  const setMuted = useCallback((m: boolean) => { stream.current?.getAudioTracks().forEach((t) => { t.enabled = !m; }); setMutedState(m); }, []);
  useEffect(() => () => close(), [close]);
  return { getStream: () => stream.current, finishAnswer: () => finish(true), state, partial, muted, error, level, open, close, startListening, stopListening, setMuted, clearError: () => setError("") };
}
