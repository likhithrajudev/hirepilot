"use client";

import { Camera, Check, Loader2, Mic, MonitorSmartphone, RefreshCw, ShieldCheck, TriangleAlert, Volume2, Wifi, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { inspectDevice, type DeviceReport } from "./useProctor";
import { raw } from "@/lib/api";

/* A real pre-flight, not a checklist of assumptions. For a voice interview these must pass before you can start:
   browser support, a network that can carry the call, a microphone that actually picks up your voice, and speakers you can hear.
   The camera is required in monitored mode and optional otherwise. Nothing here is recorded or sent anywhere. */

type S = "idle" | "running" | "pass" | "fail" | "warn";
export interface CheckResult { ok: boolean; camera: MediaStream | null; cameraSkipped: boolean }

const Row = ({ s, icon, title, children, action }: { s: S; icon: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) => (
  <li className="flex gap-3 rounded-lg border border-line bg-surface p-3.5">
    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md ${s === "pass" ? "bg-ok-soft text-ok" : s === "fail" ? "bg-bad-soft text-bad" : s === "warn" ? "bg-warn-soft text-warn" : "bg-surface2 text-muted"}`}>
      {s === "running" ? <Loader2 size={16} className="animate-spin" /> : s === "pass" ? <Check size={16} /> : s === "fail" ? <X size={16} /> : s === "warn" ? <TriangleAlert size={16} /> : icon}
    </span>
    <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{title}</div><div className="mt-0.5 text-[13px] text-muted">{children}</div></div>
    {action && <div className="shrink-0 self-center">{action}</div>}
  </li>
);

export default function SystemCheck({ voice, proctored, onReady }: { voice: boolean; proctored: boolean; onReady: (ok: boolean) => void }) {
  const [browser, setBrowser] = useState<{ s: S; msg: string }>({ s: "running", msg: "Checking…" });
  const [net, setNet] = useState<{ s: S; msg: string }>({ s: "running", msg: "Measuring…" });
  const [mic, setMic] = useState<{ s: S; msg: string }>({ s: "idle", msg: "We will listen for your voice. Nothing is recorded." });
  const [spk, setSpk] = useState<{ s: S; msg: string }>({ s: "idle", msg: "Play a short sound and confirm you can hear it." });
  const [cam, setCam] = useState<{ s: S; msg: string }>({ s: "idle", msg: proctored ? "Required for monitored interviews." : "Optional. Shows you on screen like a meeting." });
  const [camSkipped, setCamSkipped] = useState(false);
  const [dev, setDev] = useState<DeviceReport | null>(null);
  const [meter, setMeter] = useState(0);
  const micStop = useRef<(() => void) | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const camStream = useRef<MediaStream | null>(null);

  // ── browser + automation
  useEffect(() => {
    void inspectDevice().then((d) => {
      setDev(d);
      const missing = [!d.browser && "camera/microphone access", typeof MediaRecorder === "undefined" && "audio recording", typeof AudioContext === "undefined" && typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext === "undefined" && "Web Audio", !window.isSecureContext && "a secure (https or localhost) page"].filter(Boolean);
      if (d.automation) setBrowser({ s: "fail", msg: "Browser automation detected. Use a normal browser window." });
      else if (voice && missing.length) setBrowser({ s: "fail", msg: `This browser lacks ${missing.join(", ")}. Use current Chrome, Edge or Safari.` });
      else setBrowser({ s: "pass", msg: d.summary });
    });
  }, [voice]);

  // ── network: five round trips to our own server
  const runNet = useCallback(async () => {
    setNet({ s: "running", msg: "Measuring…" });
    if (!navigator.onLine) return setNet({ s: "fail", msg: "You appear to be offline." });
    const t: number[] = [];
    try {
      for (let i = 0; i < 5; i++) { const a = performance.now(); const r = await fetch(`/api/billing/plans?x=${i}`, { cache: "no-store" }); if (!r.ok) throw new Error(); await r.arrayBuffer(); t.push(performance.now() - a); }
      t.sort((a, b) => a - b); const med = Math.round(t[2]), worst = Math.round(t[4]);
      if (med > 2000) setNet({ s: "fail", msg: `Too slow (${med} ms). The interviewer would lag. Move closer to your router or switch networks.` });
      else if (med > 800) setNet({ s: "warn", msg: `Slow (${med} ms median). It will work, but replies may feel delayed.` });
      else setNet({ s: "pass", msg: `Good: ${med} ms median, ${worst} ms worst.` });
    } catch { setNet({ s: "fail", msg: "Could not reach HirePilot. Check your connection." }); }
  }, []);
  useEffect(() => { void runNet(); }, [runNet]);

  // ── microphone: must hear real speech, not just permission
  const runMic = useCallback(async () => {
    micStop.current?.();
    setMic({ s: "running", msg: "Say “hello, this is a test” in your normal voice…" });
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { return setMic({ s: "fail", msg: (e as DOMException)?.name === "NotAllowedError" ? "Microphone permission was denied. Allow it in the address bar, then retry." : "No microphone found. Plug one in, then retry." }); }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC(); const an = ctx.createAnalyser(); an.fftSize = 1024; ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    let floor = 0, n = 0, voiced = 0, done = false, vsum = 0, vn = 0;
    const start = Date.now();
    const stop = () => { done = true; clearInterval(iv); stream.getTracks().forEach((x) => x.stop()); void ctx.close(); setMeter(0); };
    micStop.current = stop;
    const iv = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      setMeter(Math.min(1, rms * 9));
      if (n < 8) { floor = (floor * n + rms) / (n + 1); n++; return; }
      if (rms > Math.max(0.02, floor * 3.5)) { voiced += 50; vsum += rms; vn++; }
      if (!done && voiced >= 600) { stop(); try { localStorage.setItem("hp_mic_rms", String(vsum / Math.max(1, vn))); } catch {} setMic({ s: "pass", msg: "We hear you clearly. In the interview, quieter background sounds will be ignored." }); }
      else if (!done && Date.now() - start > 14000) { stop(); setMic({ s: "fail", msg: "We could not hear you. Check the mic is not muted and the right device is selected in your system settings, then retry." }); }
    }, 50);
  }, []);

  // ── speakers: a soft three-note chime (heard even if the voice service is down), then the interviewer's real voice; you confirm you heard them
  const playChime = useCallback(async () => {
    setSpk({ s: "running", msg: "Playing a short chime…" });
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    let ctx: AudioContext | null = null;
    try {
      ctx = new AC(); await ctx.resume();                               // started from a click, so the browser allows sound
      const c = ctx, t0 = c.currentTime + 0.05;
      const master = c.createGain(); master.gain.value = 0.2; master.connect(c.destination);
      // A gentle bell: each note is a sine with two quiet overtones and a soft attack that rings out, rising E, G, C.
      [[659.25, 0], [783.99, 0.2], [1046.5, 0.4]].forEach(([f, at]) => {
        [[1, 1], [2, 0.28], [3, 0.1]].forEach(([mult, vol]) => {
          const o = c.createOscillator(), g = c.createGain();
          o.type = "sine"; o.frequency.value = f * mult;
          g.gain.setValueAtTime(0.0001, t0 + at);
          g.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 1.5);
          o.connect(g); g.connect(master); o.start(t0 + at); o.stop(t0 + at + 1.6);
        });
      });
      const voiceReady = raw("/interviews/voice-check", { method: "POST" }).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b));   // fetched while the chime rings
      await new Promise((r) => setTimeout(r, 1500));
      setSpk({ s: "running", msg: "Loading the interviewer's voice…" });
      const buf = await voiceReady;
      const src = c.createBufferSource(); src.buffer = buf; src.connect(c.destination); src.start();
      setSpk({ s: "running", msg: "Did you hear a soft chime, then “Hi, I’m your AI interviewer. Can you hear me clearly?”" });
      src.onended = () => setTimeout(() => void c.close(), 300);
    } catch (e) {
      void ctx?.close();
      const detail = e instanceof Error ? e.message : "";
      setSpk({ s: "fail", msg: `The interviewer's voice could not be loaded${detail ? ` (${detail.slice(0, 90)})` : ""}. If you heard the chime your speakers work; check your OpenAI key in Settings, then try again, or switch to a typed interview.` });
    }
  }, []);

  // ── camera
  const runCam = useCallback(async () => {
    setCam({ s: "running", msg: "Asking for the camera…" });
    camStream.current?.getTracks().forEach((t) => t.stop());
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false });
      camStream.current = s; setCamSkipped(false);
      if (video.current) { video.current.srcObject = s; void video.current.play().catch(() => {}); }
      const label = s.getVideoTracks()[0]?.label ?? "";
      if (/obs|virtual|manycam|snap camera|xsplit|droidcam|epoccam|camo|iriun|nvidia broadcast|mmhmm/i.test(label)) setCam({ s: proctored ? "fail" : "warn", msg: `Virtual camera detected (${label}). ${proctored ? "Not allowed in monitored interviews." : "Fine for practice."}` });
      else setCam({ s: "pass", msg: label || "Camera is working." });
    } catch (e) { setCam({ s: proctored ? "fail" : "warn", msg: (e as DOMException)?.name === "NotAllowedError" ? "Camera permission was denied. Allow it in the address bar, then retry." : "No camera found." }); }
  }, [proctored]);

  useEffect(() => () => { micStop.current?.(); camStream.current?.getTracks().forEach((t) => t.stop()); }, []);

  const needVoice = voice;
  const required: S[] = [browser.s, net.s === "warn" ? "pass" : net.s, ...(needVoice ? [mic.s, spk.s] : []), ...(proctored ? [cam.s] : [])];
  const ok = required.every((s) => s === "pass") && (!proctored || cam.s === "pass") && !(dev?.automation);
  useEffect(() => { onReady(ok); }, [ok, onReady]);

  const retry = (f: () => void) => <button className="btn btn-sm" onClick={f}><RefreshCw size={12} /> Retry</button>;
  return (
    <div className="space-y-3">
      <ul className="space-y-2.5">
        <Row s={browser.s} icon={<MonitorSmartphone size={16} />} title="Browser and device">{browser.msg}</Row>
        <Row s={net.s} icon={<Wifi size={16} />} title="Connection" action={net.s !== "running" && net.s !== "pass" ? retry(runNet) : undefined}>{net.msg}</Row>
        {needVoice && (
          <Row s={mic.s} icon={<Mic size={16} />} title="Microphone"
            action={mic.s === "idle" ? <button className="btn btn-sm btn-primary" onClick={runMic}>Test microphone</button> : mic.s === "fail" ? retry(runMic) : undefined}>
            {mic.msg}
            {mic.s === "running" && <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-surface2"><span className="block h-full rounded-full bg-brand transition-[width] duration-75" style={{ width: `${Math.round(meter * 100)}%` }} /></span>}
          </Row>
        )}
        {needVoice && (
          <Row s={spk.s} icon={<Volume2 size={16} />} title="Speakers or headphones"
            action={spk.s === "idle" || spk.s === "fail" ? <button className="btn btn-sm btn-primary" onClick={playChime}>Play sound</button>
              : spk.s === "running" ? <span className="flex gap-1.5"><button className="btn btn-sm btn-primary" onClick={() => setSpk({ s: "pass", msg: "Sound confirmed." })}>I heard it</button><button className="btn btn-sm" onClick={() => setSpk({ s: "fail", msg: "No sound? Raise the volume, check the output device, then play it again." })}>I did not</button></span> : undefined}>
            {spk.msg}
          </Row>
        )}
        <Row s={cam.s} icon={<Camera size={16} />} title={`Camera${proctored ? "" : " (optional)"}`}
          action={cam.s === "idle" ? <button className="btn btn-sm" onClick={runCam}>Test camera</button> : cam.s === "fail" || cam.s === "warn" ? retry(runCam) : undefined}>
          {cam.msg}
          {(cam.s === "pass" || cam.s === "warn") && camStream.current && <video ref={video} muted playsInline className="mt-2 h-24 w-36 rounded-md bg-black object-cover [transform:scaleX(-1)]" />}
        </Row>
        {proctored && dev && (
          <Row s={dev.screens === "extended" ? "warn" : "pass"} icon={<ShieldCheck size={16} />} title="Display">
            {dev.screens === "extended" ? "More than one display detected. This will be flagged in your integrity report." : "Single display."}
          </Row>
        )}
      </ul>
      {!ok && <p className="text-[13px] text-muted">{needVoice ? "Every required check must pass before you can start, so the interview is not ruined by a muted mic or silent speakers." : "The required checks must pass before you can start."}</p>}
      {ok && <p className="flex items-center gap-2 text-[13px] font-medium text-ok"><Check size={15} /> Your system is ready.</p>}
    </div>
  );
}
