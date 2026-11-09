"use client";

import { interviewerProfile } from "@/lib/interviewers";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, CameraOff, Captions, CaptionsOff, Keyboard, Loader2, MessagesSquare, Mic, MicOff, Play, Send, Settings2, ShieldCheck, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/app/providers";
import { useDialog } from "@/components/Dialog";
import { useOverlay } from "@/components/overlay";
import { useMenuKeys, usePopover } from "@/components/popover";
import { api, ApiError, raw, json } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { keys } from "@/lib/hooks";
import type { Interview } from "@/lib/types";
import { VoiceGlyph, type Presence } from "./VoiceWave";
import { Caption, LiveWords, MicBars, ROOM, RoomWave } from "./RoomParts";
import Brand from "@/components/Brand";
import { LiveTranscript } from "./LiveTranscript";
import EndingOverlay from "./EndingOverlay";
import { PATIENCE_MS, useListener, type Patience } from "./useListener";
import { useProctor } from "./useProctor";
import { useSpeaker } from "./useSpeaker";
import { useRecording } from "./useRecording";
import CodingPanel from "./CodingPanel";

const KIND_LABEL = { behavioral: "Behavioral", technical: "Technical", resume: "Resume deep dive", system_design: "System design", coding: "Coding" } as const;
const clock = (s: number) => `${String(Math.floor(Math.abs(s) / 60)).padStart(2, "0")}:${String(Math.abs(s) % 60).padStart(2, "0")}`;
const store = {
  get: (k: string, d: string) => { try { return localStorage.getItem(`hp_iv_${k}`) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`hp_iv_${k}`, v); } catch {} },
};

/** The server removes the machine-readable block from a reply. This is a second line of defence, so even a misbehaving model can never put
 *  it on screen or into the speech: cut everything from the first marker-like text. */
const MARK = /=+\s*META\b|\bMETA\s*=+|\bMETA\s*(?=\{)|\{\s*"kind"\s*:/;
const clean = (t: string) => { const m = MARK.exec(t); return m ? t.slice(0, m.index).replace(/[\s=]+$/, "") : t; };

/** Text whose words fade in one by one. All words are laid out up front (invisible until shown), so lines never reflow or jump.
 *  With `shown`, the first `shown` words are visible (used to follow the voice); without it, every new word animates in as it arrives. */
function Words({ text, shown }: { text: string; shown?: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          {shown === undefined ? <span className="word-in">{w}</span> : <span className="word" data-on={i < shown ? "1" : "0"}>{w}</span>}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

/** Reads an audio level ref every frame and moves the bars directly, so a loud room never re-renders React. */
function LevelBars({ level, active }: { level: React.RefObject<number>; active: boolean }) {
  const bars = useRef<HTMLSpanElement[]>([]);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const l = active ? (level.current ?? 0) : 0;
      bars.current.forEach((b, i) => { if (b) b.style.height = `${18 + Math.min(1, l * (0.55 + i * 0.28)) * 82}%`; });
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [level, active]);
  return (
    <span className="flex h-4 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => <span key={i} ref={(el) => { if (el) bars.current[i] = el; }} className="w-[3px] rounded-full bg-white/80 transition-[height] duration-75" style={{ height: "18%" }} />)}
    </span>
  );
}

export default function Room({ iv, onFinished }: { iv: Interview; onFinished: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const dialog = useDialog();
  const { user } = useAuth();
  const panel = useRef<HTMLDivElement>(null);
  const roomHeader = useRef<HTMLDivElement>(null);
  useOverlay({ open: true, onClose: () => {}, panel, dismissable: false, initialFocus: "[data-autofocus]" }); // the room is a modal space: focus stays inside, the page behind is locked

  const [begun, setBegun] = useState(false);
  // The room owns the whole screen: lock the page behind it so its scrollbar (a light bar down the side that also takes up width) never shows,
  // and paint the page black so no edge can flash white while the room is open.
  useEffect(() => {
    const h = document.documentElement, b = document.body;
    const was = { ho: h.style.overflow, hb: h.style.background, bo: b.style.overflow, bb: b.style.background, cs: h.style.colorScheme, sg: h.style.scrollbarGutter };
    h.style.overflow = "hidden"; b.style.overflow = "hidden"; h.style.background = "#000"; b.style.background = "#000"; h.style.colorScheme = "dark"; h.style.scrollbarGutter = "auto";
    return () => { h.style.overflow = was.ho; b.style.overflow = was.bo; h.style.background = was.hb; b.style.background = was.bb; h.style.colorScheme = was.cs; h.style.scrollbarGutter = was.sg; };
  }, []);
  const joining = useRef(false);
  const [joinPending, setJoinPending] = useState(false);
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [voiceOn, setVoiceOn] = useState(true);
  const [transcriptOpen, setTranscriptOpen] = useState(true);   // the conversation transcript is shown by default
  const [patience, setPatience] = useState<Patience>("normal");
  const [barge, setBarge] = useState(false);            // let the candidate talk over the interviewer (needs headphones, or the speakers feed back)
  const [live, setLive] = useState("");                 // the interviewer's reply as it streams in
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState("");
  const [typing, setTypingState] = useState(false);
  const setTyping = (v: boolean) => { typingRef.current = v; setTypingState(v); };
  const [captions, setCaptions] = useState(true);       // the text that appears on screen as the interviewer speaks: on or off, nothing else
  const [elapsed, setElapsed] = useState(0);
  const [ending, setEnding] = useState(false);
  const [endStep, setEndStep] = useState(-1);   // -1: not ending; otherwise which step of the wrap-up the app is on (drives the blurred loader)
  const [err, setErr] = useState("");
  const [joinErr, setJoinErr] = useState("");
  const codingFlush = useRef<() => Promise<void>>(async () => {});
  const registerCodingFlush = useCallback((fn: () => Promise<void>) => { codingFlush.current = fn; }, []);
  const sending = useRef(false);
  const opened = useRef(false);
  const typingRef = useRef(false);
  const modeRef = useRef(mode); modeRef.current = mode;
  const doneRef = useRef(false);

  useEffect(() => {
    const el = roomHeader.current;
    if (!begun || !el) return;
    const measure = () => panel.current?.style.setProperty("--room-top", `${Math.ceil(el.getBoundingClientRect().height) + 12}px`);
    measure(); const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, [begun]);

  const turns = iv.turns;
  const lastIv = [...turns].reverse().find((t) => t.who === "interviewer");
  const spokenText = useRef(""); spokenText.current = lastIv?.text ?? "";
  const answered = turns.filter((t) => t.who === "candidate" && !t.smalltalk).length; // small talk and non-answers do not count
  const active = iv.status === "active";
  const name = iv.interviewer.name;
  const character = interviewerProfile(name);
  const initials = (user?.name || user?.email || "You").split(/[\s@]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

  const proctor = useProctor({ enabled: iv.proctored, sessionId: iv.id, live: begun });
  const speaker = useSpeaker({ sessionId: iv.id, persona: name, gender: iv.interviewer.gender, enabled: voiceOn });
  const recording = useRecording(iv.id);
  const afterSpeech = useRef<() => void>(() => {});

  const submit = useCallback(async (text: string) => {
    if (sending.current || !text.trim()) return;
    sending.current = true; setThinking(true); setErr(""); setLive("");
    qc.setQueryData<Interview>(keys.interview(iv.id), (c) => c && { ...c, turns: [...c.turns, { who: "candidate", text }] });
    const rollback = (msg: string) => {
      qc.setQueryData<Interview>(keys.interview(iv.id), (c) => c && { ...c, turns: c.turns.slice(0, -1) });
      setDraft(text); setErr(msg); setThinking(false); sending.current = false;
      if (modeRef.current === "voice") afterSpeech.current();
    };
    let started = false;
    try {
      await codingFlush.current();
      // Server-sent events: text arrives as the interviewer writes it, and each finished sentence is spoken straight away.
      const res = await raw(`/interviews/${iv.id}/answer/stream`, { ...json({ text }), headers: { Accept: "text/event-stream" } });
      const reader = res.body!.getReader(); const dec = new TextDecoder();
      let buf = "", acc = "", pushed = 0, doneEv: { say: string; kind: string; done: boolean; coding_enabled?: boolean; progress: Interview["progress"] } | null = null, failed = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!line.startsWith("data: ")) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.t === "delta") {
            if (!started) { started = true; setThinking(false); speaker.begin(() => afterSpeech.current()); }
            acc += ev.text;
            const vis = clean(acc);                                  // only what is safe to show and speak, never the marker block
            if (vis.length > pushed) { speaker.push(vis.slice(pushed)); pushed = vis.length; }
            setLive(vis);
          } else if (ev.t === "done") doneEv = ev;
          else if (ev.t === "error") failed = ev.message;
        }
      }
      if (failed || !doneEv) { speaker.stop(); setLive(""); return rollback(failed || "The interviewer lost the connection. Your answer is kept: send it again."); }
      const say = clean(doneEv.say).trim();
      if (!started || say.replace(/\s+/g, " ") !== clean(acc).trim().replace(/\s+/g, " ")) { speaker.stop(); speaker.begin(() => afterSpeech.current()); speaker.push(say); } // keep spoken words aligned with the server-validated question
      speaker.end();
      const d = doneEv;
      qc.setQueryData<Interview>(keys.interview(iv.id), (c) => c && {
        ...c, status: d.done ? "done" : "active", progress: d.progress, coding_enabled: d.coding_enabled ?? c.coding_enabled,
        turns: [...c.turns.map((t, i) => (i === c.turns.length - 1 && d.kind === "chat" ? { ...t, smalltalk: true } : t)), { who: "interviewer", text: say }],
      });
      setLive(""); setThinking(false); sending.current = false;
      if (!voiceOn) afterSpeech.current();
    } catch (e) {
      speaker.stop();
      rollback(e instanceof ApiError && !e.paywall ? e.message : "Could not reach the interviewer. Your answer is kept: send it again.");
    }
  }, [iv.id, qc, speaker, voiceOn]);

  const listener = useListener({ autoSubmit: true,
    sessionId: iv.id, patience, onTurn: (t) => void submit(t), onBargeIn: () => speaker.stop(), speakingRef: speaker.speakingRef,
    endedAt: speaker.endedAt, getSpoken: () => spokenText.current, allowBarge: barge,
  });

  // When the interviewer finishes talking, it is your turn: open the recorder (voice) or just wait for typing.
  afterSpeech.current = () => {
    if (doneRef.current) return;
    if (modeRef.current === "voice" && !listener.muted && !typingRef.current) listener.startListening();
  };

  useEffect(() => {
    setVoiceOn(store.get("speak", "1") === "1"); setPatience(store.get("patience_v2", "normal") as Patience);
    setCaptions(store.get("captions", "1") === "1"); setBarge(store.get("barge", "0") === "1");
  }, []);
  useEffect(() => {
    if (!begun) return;
    const start = new Date(/Z|[+-]\d\d:?\d\d$/.test(iv.created_at) ? iv.created_at : iv.created_at + "Z").getTime();
    const t = setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000))), 1000);
    return () => clearInterval(t);
  }, [begun, iv.created_at]);

  // Speak the current question once when the interview starts (or when someone rejoins one in progress).
  useEffect(() => {
    if (!begun || !lastIv || opened.current) return;
    opened.current = true;
    if (voiceOn) { speaker.begin(() => afterSpeech.current()); speaker.push(clean(lastIv.text)); speaker.end(); } else afterSpeech.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [begun, lastIv?.text]);

  // Finished: let the goodbye be spoken to the end, then build the report. (The candidate has already had the floor at the wrap-up.)
  useEffect(() => {
    if (iv.status !== "done" || !begun || speaker.busy) return;
    doneRef.current = true; listener.stopListening();
    const t = setTimeout(async () => { try { setEndStep(0); await codingFlush.current(); setEndStep(1); await recording.finish(); setEndStep(2); await proctor.finalFlush(); proctor.stopCamera(); await proctor.exitFullscreen(); listener.close(); speaker.stop(); setEndStep(3); onFinished(); } catch { setEndStep(-1); /* Recording banner offers a retry before leaving. */ } }, voiceOn ? 1400 : 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iv.status, begun, speaker.busy]);

  const join = useCallback(async () => {
    if (joining.current) return;
    joining.current = true; setJoinPending(true);
    try {
    setJoinErr("");
    speaker.unlock();
    const m = store.get(`mode_${iv.id}`, "voice") as "voice" | "text";
    if (m === "voice") {
      const ok = await listener.open();
      if (!ok) { setJoinErr("Your microphone is not available. Fix it and try again, or continue by typing."); return; }
    }
    await recording.start(listener.getStream(), speaker.getStream());
    setMode(m);
    void proctor.startCamera();
    if (iv.proctored) void proctor.goFullscreen();
    setBegun(true);
    } finally { joining.current = false; setJoinPending(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iv.id, iv.proctored]);

  // Arriving from the setup page: the system check already passed and the browser has our click, so join straight away.
  useEffect(() => {
    try { if (sessionStorage.getItem(`hp_iv_go_${iv.id}`)) { sessionStorage.removeItem(`hp_iv_go_${iv.id}`); void join(); } } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typeInstead = () => { listener.stopListening(); setTyping(true); };
  const sendTyped = () => { const t = draft.trim(); if (!t || thinking) return; setDraft(""); void submit(t); };
  const endNow = async () => {
    if (ending) return;
    if (answered === 0 && !iv.coding_enabled) { if (!(await dialog.confirm({ title: "Leave without a report?", body: "You have not answered anything yet, so there is nothing to score. This interview will stay in your list.", confirmLabel: "Leave", danger: true }))) return; try { await recording.finish(); } catch { return; } speaker.stop(); listener.close(); proctor.stopCamera(); await proctor.exitFullscreen(); onFinished(); return; }
    if (!(await dialog.confirm({ title: "End the interview now?", body: "You will get a report on what has been covered so far.", confirmLabel: "End and get report", danger: true }))) return;
    setEnding(true); setEndStep(0); speaker.stop();
    try { await codingFlush.current(); setEndStep(1); await recording.finish(); listener.close(); setEndStep(2); await proctor.finalFlush(); proctor.stopCamera(); await proctor.exitFullscreen(); setEndStep(3); await api(`/interviews/${iv.id}/finish`, { method: "POST" }); await qc.invalidateQueries({ queryKey: keys.interview(iv.id) }); qc.invalidateQueries({ queryKey: keys.interviews }); onFinished(); }
    catch (e) { setEnding(false); setEndStep(-1); toast(e instanceof ApiError ? e.message : "Could not build the report", "error"); }
  };

  // Between the first words arriving and the first sound playing the interviewer is still "thinking", never "your turn".
  const replying = thinking || live.length > 0 || (speaker.busy && !speaker.speaking);
  const presence: Presence = speaker.speaking ? "speaking" : replying ? "thinking" : listener.state === "hearing" ? "listening" : "idle";
  const status = ending ? "Wrapping up…" : speaker.speaking ? "" : replying ? `${name} is thinking…` : listener.state === "transcribing" ? "Transcribing what you said…"
    : listener.state === "hearing" ? "Listening… Take your time." : mode === "voice" && !listener.muted && active ? "Your turn" : active ? "Your turn" : "";
  // With the voice on, the words appear as they are spoken (kept in step with the audio); otherwise they stream as they are written.
  const capEl = useRef<HTMLParagraphElement>(null);
  const synced = voiceOn && speaker.busy;
  const caption = clean(live || lastIv?.text || "");   // the whole line is laid out up front; only its visibility follows the voice
  const shownWords = synced ? speaker.revealed.split(/\s+/).filter(Boolean).length : undefined;
  // The transcript panel follows the voice too: the reply being spoken is cut to the words already heard, in the streaming line and in the saved turn.
  const heard = (t: string) => shownWords === undefined ? t : t.split(/\s+/).filter(Boolean).slice(0, shownWords).join(" ");
  const lastIvIdx = turns.map((t) => t.who).lastIndexOf("interviewer");
  const turnsShown = synced && !live && lastIvIdx >= 0 ? turns.map((t, i) => i === lastIvIdx ? { ...t, text: heard(clean(t.text)) } : t).filter((t, i) => i !== lastIvIdx || t.text) : turns;
  const liveShown = heard(clean(live));
  useEffect(() => { const el = capEl.current; if (el && el.scrollHeight > el.clientHeight) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); }, [shownWords, caption]);
  const settings = usePopover();
  const menu = useMenuKeys(settings.open, settings.close);

  const dockBtn = (on = false, danger = false) => `grid h-10 w-10 place-items-center rounded-lg border transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9bbcff] ${danger ? "border-red-400/25 bg-red-500/15 text-red-200" : on ? "border-[#96b8ff]/30 bg-[#96b8ff]/10 text-[#b3cbff]" : "border-white/10 bg-[#11151b] text-white/75"}`;
  const cameraTile = <figure className="relative h-full w-full overflow-hidden rounded-2xl border border-white/[.06] bg-black shadow-[0_16px_70px_#0005]">
    {proctor.camera === "on" || proctor.camera === "unavailable" || proctor.camera === "starting"
      ? <video ref={proctor.attachVideo} muted playsInline aria-label="Your camera" className="h-full w-full object-cover [transform:scaleX(-1)]" />
      : <div className="flex h-full min-h-28 flex-col items-center justify-center gap-3 text-white/25"><CameraOff size={28} strokeWidth={1.2} /><span className="text-xs">{initials} · Camera off</span></div>}
    <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/55 to-transparent px-4 pb-3 pt-8 text-[11px] text-white/70"><span>You</span><LevelBars level={listener.level} active={mode === "voice" && !listener.muted} /></figcaption>
  </figure>;
  const currentTranscript = (compact = false) => <div className={`flex min-h-0 min-w-0 flex-col ${compact ? "gap-2" : "gap-3"}`}>
    <div className="flex items-center gap-2 text-[#8eb8ff]"><VoiceGlyph /><span className="text-[10px] font-medium tracking-wide text-white/40">{name} · AI interviewer</span></div>
    {captions && <p ref={compact ? undefined : capEl} className={`${compact ? "max-h-20 text-[13px]" : "max-h-60 text-[clamp(16px,1.4vw,21px)] italic"} overflow-y-auto whitespace-pre-wrap break-words leading-relaxed text-white/70`} aria-live="polite" data-lenis-prevent><Words text={caption} shown={shownWords} /></p>}
    {captions && mode === "voice" && listener.partial && <p className="max-h-14 overflow-y-auto text-[13px] leading-relaxed text-white/40" data-lenis-prevent>{listener.partial}</p>}
    <p className="min-h-4 text-[11px] text-white/35" role="status">{status || (speaker.speaking ? "Speaking" : "")}</p>
  </div>;

  const transcriptInner = <LiveTranscript turns={turnsShown} name={name} initials={initials || "ME"} startedAt={iv.created_at} live={liveShown} partial={mode === "voice" ? listener.partial : ""} onClose={() => setTranscriptOpen(false)} />;
  const transcriptEl = <div className="h-full min-h-[200px] overflow-hidden rounded-2xl border border-[#2B2B2B] bg-[#141414]">{transcriptInner}</div>;
  const pill = ending ? { label: "Wrapping up", cls: "bg-[#1F1F1F] text-[#A3A3A3]" }
    : speaker.speaking ? { label: "Speaking", cls: "bg-[#8A75FF]/15 text-[#8A75FF]" }
    : replying ? { label: "Thinking", cls: "bg-[#FF8AE6]/15 text-[#FF8AE6]" }
    : listener.state === "transcribing" ? { label: "Transcribing", cls: "bg-[#FF8AE6]/15 text-[#FF8AE6]" }
    : listener.state === "hearing" ? { label: "Listening to you", cls: "bg-[#3DDC84]/15 text-[#3DDC84]" }
    : active ? { label: "Your turn", cls: "bg-[#3DDC84]/15 text-[#3DDC84]" } : { label: "Finished", cls: "bg-[#1F1F1F] text-[#A3A3A3]" };
  const camOn = proctor.camera === "on" || proctor.camera === "unavailable" || proctor.camera === "starting";
  const waitingReply = thinking && !live;                       // your answer is in, nothing has come back yet
  const showUser = captions && mode === "voice" && listener.state === "hearing" && !!listener.partial;

  if (!begun) {
    return (
      <div ref={panel} className="fixed inset-0 z-[80] grid place-items-center bg-[#0A0A0A] p-6 text-white">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="flex justify-center text-white"><Brand /></div>
          <div>
            {character && <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.15em] text-[#a0bcff]">{character.style}</p>}
            <h1 className="text-xl font-semibold">{KIND_LABEL[iv.kind]} interview{iv.company ? ` · ${iv.company}` : ""}</h1>
            <p className="mt-1 text-sm text-white/65">{iv.role} · {iv.kind === "coding" ? `${iv.planned_questions} coding problems` : `${iv.duration_min} minutes`} · with {name}, your AI interviewer</p>
          </div>
          <ul className="space-y-1.5 text-left text-[13px] text-white/65">
            <li>• Explain your reasoning at your pace. The interviewer detects when your answer is complete.</li>
            <li>• Each answer supports up to eight minutes. Adjust pause sensitivity in settings.</li>
            <li>• Interview audio is automatically recorded when you join and is accessible to you and authorized admins in the report. You can delete it. Camera footage is not recorded.</li>
            {iv.proctored && <li>• Integrity checks are on for this interview: tab switches, pasting and, with your camera, face and eye position. Analysis stays on your device, and the result appears only in your report.</li>}
          </ul>
          {joinErr && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">{joinErr}</p>}
          <div className="flex flex-col items-center gap-2">
            <button data-autofocus className="btn btn-primary h-11 px-7 text-[14px]" disabled={joinPending} onClick={() => void join()}><Play size={16} /> {answered > 0 ? "Rejoin interview" : "Join interview"}</button>
            {joinErr && <button className="btn btn-ghost text-white/75 hover:!bg-white/10" onClick={() => { store.set(`mode_${iv.id}`, "text"); void join(); }}><Keyboard size={15} /> Continue by typing</button>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={panel} className="fixed inset-0 z-[80] flex flex-col overflow-hidden bg-[#0A0A0A] text-white">
      {endStep >= 0 && <EndingOverlay step={endStep} />}
      <div ref={roomHeader} className="relative z-40 max-h-[35vh] shrink-0 overflow-y-auto bg-[#0A0A0A]">
      <header className="flex min-h-[68px] flex-wrap items-center gap-3.5 border-b border-[#2B2B2B] px-4 py-3 sm:px-6">
        <Brand compact />
        <div className="min-w-[10rem] flex-1">
          <h1 className="truncate text-[15px] font-semibold">{KIND_LABEL[iv.kind]} interview <span className="font-serif text-[17px] font-normal italic text-[#A3A3A3]">for</span> {iv.role}</h1>
          <p className="truncate text-[13px] text-[#A3A3A3]">{iv.company ? `${iv.company} · ` : ""}with {name}, AI interviewer</p>
        </div>
        <span aria-label="Elapsed interview time" className="inline-flex h-9 items-center gap-2.5 rounded-lg border border-[#2B2B2B] px-3 font-mono text-[13px] font-medium tabular-nums">
          <span title={recording.state === "recording" ? "Audio is being recorded" : "Not recording"} className="h-2 w-2 rounded-full" style={{ background: recording.state === "recording" ? ROOM.bad : ROOM.muted, animation: recording.state === "recording" ? "hp-live 1.4s ease-out infinite" : undefined }} />
          LIVE {clock(elapsed)}{iv.kind !== "coding" && <span className="hidden text-[#A3A3A3] sm:inline">/ {iv.duration_min}:00</span>}
        </span>
        <button className="h-10 rounded-[10px] bg-[#e33e59] px-4 text-[13px] font-semibold text-white transition hover:bg-[#f04b66] disabled:opacity-50" onClick={() => void endNow()} disabled={ending}>{ending ? "Ending…" : "End interview"}</button>
      </header>

      {recording.error && <div role="alert" className="mx-4 mb-2 rounded-lg border border-amber-400/30 bg-[#202a40] p-3 text-xs text-amber-100">{recording.error}<button className="ml-2 underline" onClick={() => void (async () => { try { if (!active) { await codingFlush.current(); await recording.finish(); onFinished(); } else await recording.retry(); } catch {} })()}>Retry saving</button></div>}
      {voiceOn && speaker.delivery !== "neural" && <div role="status" className="mx-4 mb-2 flex flex-wrap items-center justify-center gap-2 rounded-lg border border-white/15 bg-[#202a40] px-3 py-2 text-xs text-white/85"><span>{speaker.delivery === "browser" ? "Using your device’s voice while the voice service is unavailable. This fallback voice cannot be included in the audio recording; its words remain in the transcript." : "Audio was interrupted. The complete reply is available in captions."}</span>{speaker.delivery === "interrupted" && <button className="font-semibold text-[#a0bcff] underline" onClick={() => speaker.speakWhole(clean(lastIv?.text ?? ""), () => afterSpeech.current())}>Replay reply</button>}</div>}
      {(err || listener.error) && (
        <p role="alert" className={`mx-4 mb-2 rounded-xl border px-3 py-2 text-center text-[13px] ${err ? "border-red-400/30 bg-red-950/85 text-red-200" : "border-amber-400/30 bg-amber-950/85 text-amber-100"}`}>{err || listener.error}</p>
      )}

      </div>

      {!iv.coding_enabled && (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <section aria-label="Interviewer" className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-6 sm:px-10 sm:py-7" data-lenis-prevent>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#8A75FF] text-[18px] font-bold text-[#0A0A0A]">{name.slice(0, 1).toUpperCase()}</span>
                <div>
                  <p className="font-mono text-[11px] font-semibold tracking-[.12em] text-[#A3A3A3]">AI INTERVIEWER</p>
                  <p className="text-[16px] font-semibold">{name}{character && <span className="font-normal text-[#A3A3A3]"> · {character.title.replace(/^The /, "")}</span>}</p>
                </div>
              </div>
              <span role="status" className={`inline-flex h-[34px] items-center gap-2 rounded-full px-3.5 font-semibold ${pill.cls}`}><span className="h-2 w-2 rounded-full bg-current" />{pill.label}</span>
            </div>

            <RoomWave state={presence} output={speaker.level} input={listener.level} />

            <div className="flex min-h-0 flex-1 flex-col justify-center">
              {waitingReply && (
                <p className="mb-3.5 flex items-center gap-2.5 font-semibold text-[#FF8AE6]"><span className="inline-flex gap-1">{[0, 0.15, 0.3].map((d) => <span key={d} className="h-[7px] w-[7px] rounded-full bg-current" style={{ animation: `hp-dot 1s ${d}s infinite` }} />)}</span>{name} is considering your answer</p>
              )}
              {captions && !waitingReply && (showUser ? (
                <>
                  <p className="mb-3 font-mono text-[11px] font-semibold tracking-[.12em] text-[#3DDC84]">YOU · LIVE CAPTION</p>
                  <p aria-live="polite" className="max-h-[46vh] max-w-[900px] overflow-y-auto text-[clamp(22px,2.6vw,36px)] font-medium leading-[1.32] tracking-[-0.015em]" data-lenis-prevent><LiveWords text={listener.partial} /><span aria-hidden="true" className="ml-1 inline-block h-[.9em] w-[3px] bg-[#3DDC84] align-[-0.1em]" style={{ animation: "hp-blink 1s steps(1) infinite" }} /></p>
                </>
              ) : caption ? (
                <>
                  <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[.12em] text-[#8A75FF]">{name}</p>
                  <p ref={capEl} aria-live="polite" className="max-h-[46vh] max-w-[900px] overflow-y-auto text-[clamp(22px,2.6vw,36px)] font-medium leading-[1.32] tracking-[-0.015em]" data-lenis-prevent><Caption text={caption} shown={shownWords} /></p>
                </>
              ) : null)}
            </div>

            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex items-center gap-3.5 rounded-2xl border border-[#2B2B2B] bg-[#141414] p-2.5 pr-4">
                <span className="relative grid h-20 w-[120px] shrink-0 place-items-center overflow-hidden rounded-[10px] bg-[#1F1F1F] text-xl font-bold">
                  {camOn ? <video ref={proctor.attachVideo} muted playsInline aria-label="Your camera" className="h-full w-full object-cover [transform:scaleX(-1)]" /> : (initials || "ME")}
                  {mode === "voice" && listener.muted && <span className="absolute right-1.5 top-1.5 rounded bg-[#FF5C6C] px-1.5 py-px text-[10px] font-bold text-[#0A0A0A]">MUTED</span>}
                </span>
                <div>
                  <p className="font-semibold">You</p>
                  <p className="mb-1.5 text-xs text-[#A3A3A3]">Camera {camOn ? "on" : "off"}{mode === "voice" ? ` · mic ${listener.muted ? "muted" : "live"}` : ""}</p>
                  <MicBars level={listener.level} active={mode === "voice" && !listener.muted} />
                </div>
              </div>
              <p className="flex items-center gap-2 text-[13px] text-[#A3A3A3]"><ShieldCheck size={15} aria-hidden="true" />Audio is recorded with your consent and saved to your report</p>
            </div>
          </section>
          {transcriptOpen && <aside aria-label="Transcript" className="flex h-[40%] min-h-0 shrink-0 flex-col border-t border-[#2B2B2B] bg-[#141414] lg:h-auto lg:w-[400px] lg:border-l lg:border-t-0">{transcriptInner}</aside>}
        </div>
      )}
      {iv.coding_enabled && <main aria-label="Coding interview stage" className={`absolute inset-x-4 top-[var(--room-top,80px)] z-10 flex min-h-0 flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-5 ${typing || mode === "text" ? "bottom-[210px]" : "bottom-[130px]"}`}>
        <div className="min-h-0 min-w-0 flex-1"><CodingPanel sessionId={iv.id} active={active && !ending} proctored={iv.proctored} onFlush={registerCodingFlush} onDiscuss={(text) => { listener.stopListening(); speaker.stop(); void submit(text); }} onAdvance={() => { listener.stopListening(); speaker.stop(); opened.current = false; void qc.invalidateQueries({ queryKey: keys.interview(iv.id) }); }} /></div>
        <aside aria-label="Call and conversation" className="hidden min-h-0 flex-col gap-6 lg:flex"><div className="aspect-[16/10] w-full shrink-0">{cameraTile}</div><div className="min-h-0 flex-1 overflow-y-auto">{transcriptOpen ? transcriptEl : currentTranscript(true)}</div></aside>
        <section aria-label="Current conversation" className={`${transcriptOpen ? "h-36" : "max-h-28"} shrink-0 overflow-y-auto lg:hidden`}>{transcriptOpen ? transcriptEl : currentTranscript(true)}</section>
      </main>}
      <div className="relative z-20 flex shrink-0 flex-col items-center gap-3 border-t border-[#2B2B2B] bg-[#0A0A0A] px-4 py-3">
        {(typing || mode === "text") && active && (
          <div className="flex w-full max-w-xl items-end gap-2 rounded-2xl border border-white/15 bg-black/85 p-2 backdrop-blur">
            <textarea
              data-autofocus className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2 text-[14px] text-white outline-none placeholder:text-white/40" rows={2} placeholder="Type your answer. Enter to send, Shift+Enter for a new line."
              value={draft} disabled={thinking} aria-label="Your answer" maxLength={20000} onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => { if (iv.proctored) { e.preventDefault(); toast("Pasting is turned off in this interview", "info"); } }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTyped(); } }}
            />
            <button className="btn btn-primary h-10" onClick={sendTyped} disabled={!draft.trim() || thinking} aria-label="Send answer">{thinking ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}</button>
          </div>
        )}
        <div className="relative flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/90 p-2 shadow-xl backdrop-blur" role="toolbar" aria-label="Call controls" ref={settings.root}>
          <button className={dockBtn(transcriptOpen)} aria-label={transcriptOpen ? "Hide conversation history" : "Show conversation history"} aria-pressed={transcriptOpen} onClick={() => setTranscriptOpen((v) => !v)}><MessagesSquare size={18} /></button>
          {mode === "voice" && (
            <button className={dockBtn(false, listener.muted)} title={listener.muted ? "Unmute" : "Mute"} aria-pressed={listener.muted} aria-label={listener.muted ? "Unmute microphone" : "Mute microphone"}
              onClick={() => { const m = !listener.muted; listener.setMuted(m); if (m) listener.stopListening(); else if (!speaker.speaking && active && !thinking) listener.startListening(); }}>
              {listener.muted ? <MicOff size={19} /> : <Mic size={19} />}
            </button>
          )}
          <button className={dockBtn()} title={iv.proctored ? "The camera stays on in this interview" : "Camera"} aria-label={proctor.camera === "on" ? "Turn camera off" : "Turn camera on"} disabled={iv.proctored && proctor.camera === "on"}
            onClick={() => (proctor.camera === "on" ? proctor.stopCamera() : void proctor.startCamera())}>
            {proctor.camera === "on" ? <Camera size={19} /> : <CameraOff size={19} className="text-white/60" />}
          </button>
          <button data-popover-trigger className={dockBtn(settings.open)} title="Settings" aria-label="Interview settings" aria-expanded={settings.open} aria-haspopup="menu" onClick={() => settings.setOpen((o) => !o)}><Settings2 size={19} /></button>
          {settings.open && (
            <div ref={menu} role="menu" aria-label="Interview settings" className="absolute bottom-16 right-0 w-72 rounded-2xl border border-white/10 bg-[#0c0c0c] p-2 text-[13px] shadow-2xl">
              <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-white/50">Pause before replying</p>
              {(["patient", "normal", "quick"] as Patience[]).map((p) => (
                <button key={p} role="menuitemradio" aria-checked={patience === p} onClick={() => { setPatience(p); store.set("patience_v2", p); }}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left hover:bg-white/10 ${patience === p ? "text-white" : "text-white/70"}`}>
                  <span className="capitalize">{p}{patience === p ? " ✓" : ""}</span><span className="text-xs text-white/45">~{PATIENCE_MS[p] / 1000}s pause</span>
                </button>
              ))}
              <div className="my-1 border-t border-white/10" />
              <button role="menuitemcheckbox" aria-checked={typing || mode === "text"} disabled={mode === "text"} onClick={() => { if (typing) setTyping(false); else typeInstead(); settings.close(); }} className="flex w-full items-center justify-between rounded-md p-2 text-left text-white/80 hover:bg-white/10"><span>Type an answer</span><Keyboard size={15} /></button>
              <button role="menuitemcheckbox" aria-checked={captions} onClick={() => { const value = !captions; setCaptions(value); store.set("captions", value ? "1" : "0"); }} className="flex w-full items-center justify-between rounded-md p-2 text-left text-white/80 hover:bg-white/10"><span>Live captions</span>{captions ? <Captions size={15} /> : <CaptionsOff size={15} />}</button>
              <button role="menuitemcheckbox" aria-checked={voiceOn} onClick={() => { const v = !voiceOn; setVoiceOn(v); store.set("speak", v ? "1" : "0"); if (!v) speaker.stop(); }} className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-white/80 hover:bg-white/10">
                <span>{name}’s voice</span>{voiceOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
              </button>
              <button role="menuitemcheckbox" aria-checked={barge} onClick={() => { const v = !barge; setBarge(v); store.set("barge", v ? "1" : "0"); }} className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-white/80 hover:bg-white/10">
                <span>Let me interrupt<span className="block text-[11px] text-white/45">Use headphones, or the speakers feed back</span></span><span className="text-xs">{barge ? "On" : "Off"}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
