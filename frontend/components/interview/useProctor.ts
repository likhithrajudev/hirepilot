"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { raw, json } from "@/lib/api";

/* Integrity monitoring for a mock interview the candidate has opted in to.
   - Browser signals: tab hidden, window blur, fullscreen exit, copy/cut/paste, context menu, extended display.
   - Camera signals (optional): face present, one face, head turned/down, eyes off-screen. Analysis runs ON THIS DEVICE with MediaPipe;
     no video or audio is recorded or uploaded. Only event types and durations are sent to our server.
   Honest limits: a web page cannot see other devices, a phone on the desk, other apps' windows, screen sharing or remote control. */

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const VIRTUAL_CAM = /obs|virtual|manycam|snap camera|xsplit|droidcam|epoccam|camo|iriun|nvidia broadcast|mmhmm/i;

export type CameraState = "off" | "starting" | "on" | "denied" | "unavailable";
export type Look = "ok" | "away" | "turned" | "none" | "multiple";
export interface Signal { type: string; ms?: number; detail?: string }
export interface DeviceReport {
  browser: boolean; online: boolean; automation: boolean; screens: "single" | "extended" | "unknown"; fullscreen: boolean;
  camera: { label: string; virtual: boolean } | null; mic: boolean; summary: string;
}

export async function inspectDevice(): Promise<DeviceReport> {
  const nav = navigator as Navigator & { deviceMemory?: number; webdriver?: boolean };
  const scr = screen as Screen & { isExtended?: boolean };
  let mic = false;
  let cam: DeviceReport["camera"] = null;
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    mic = devs.some((d) => d.kind === "audioinput");
    const c = devs.find((d) => d.kind === "videoinput");
    if (c) cam = { label: c.label || "Camera", virtual: VIRTUAL_CAM.test(c.label) };
  } catch {}
  return {
    browser: !!navigator.mediaDevices?.getUserMedia, online: navigator.onLine, automation: !!nav.webdriver,
    screens: scr.isExtended === undefined ? "unknown" : scr.isExtended ? "extended" : "single",
    fullscreen: !!document.documentElement.requestFullscreen, camera: cam, mic,
    summary: `${nav.platform || "device"} · ${nav.hardwareConcurrency ?? "?"} cores${nav.deviceMemory ? ` · ${nav.deviceMemory} GB` : ""} · ${scr.width}×${scr.height}`,
  };
}

export function useProctor(opts: { enabled: boolean; sessionId: number; live?: boolean }) {
  const { enabled, sessionId } = opts;
  const live = opts.live ?? true;   // signals only count once the interview has actually begun, not on the join screen
  const [camera, setCamera] = useState<CameraState>("off");
  const [look, setLook] = useState<Look>("ok");
  const [count, setCount] = useState(0);
  const [fullscreenLost, setFullscreenLost] = useState(false);
  const ending = useRef(false);   // set once the interview is over, so leaving full screen is not reported as a signal
  const queue = useRef<Signal[]>([]);
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const loop = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lm = useRef<{ close(): void } | null>(null);
  const open = useRef<Map<string, number>>(new Map());   // episode start times, for things with a duration
  const confirmed = useRef<Set<string>>(new Set());
  const minMs = useRef<Record<string, number>>({ no_face: 2000, gaze_away: 1800, head_turned: 1800, multiple_faces: 1000 });

  const push = useCallback((s: Signal) => { if (!enabled || !live) return; queue.current.push(s); setCount((n) => n + 1); }, [enabled, live]);

  const flush = useCallback(async () => {
    if (!enabled || !queue.current.length) return;
    const batch = queue.current.splice(0, 50);
    try { await raw(`/interviews/${sessionId}/events`, json({ events: batch.map((b) => ({ ...b, at: new Date().toISOString() })) })); }
    catch { queue.current.unshift(...batch); }
  }, [enabled, sessionId]);

  /** An episode with a duration (face missing, eyes away): only counts after it lasts long enough, reported when it ends. */
  const episode = useCallback((type: string, active: boolean, detail = "") => {
    const now = performance.now();
    const o = open.current;
    if (active) {
      if (!o.has(type)) o.set(type, now);
      if (now - (o.get(type) ?? now) >= (minMs.current[type] ?? 1500)) confirmed.current.add(type);
    } else if (o.has(type)) {
      const ms = Math.round(now - (o.get(type) as number));
      o.delete(type);
      if (confirmed.current.delete(type)) push({ type, ms, detail });
    }
  }, [push]);

  // ── browser signals. All silent: nothing here changes what the candidate sees.
  useEffect(() => {
    if (!enabled || !live) return;
    let size = { w: window.innerWidth, h: window.innerHeight };
    let hidden = { start: 0, end: 0 };
    let hiddenAt = 0, blurAt = 0, pollAt = 0, leftAt = 0, resized = false, extendedSeen = false;
    let wasFull = !!document.fullscreenElement;
    const rebase = () => setTimeout(() => { size = { w: window.innerWidth, h: window.innerHeight }; resized = false; }, 900);   // the baseline moves when we ourselves enter or leave full screen
    const rebaseTimer = rebase();

    // reloading the page mid-interview is a signal in itself
    const liveKey = `hp_iv_live_${sessionId}`;
    try { if (sessionStorage.getItem(liveKey)) push({ type: "reload" }); sessionStorage.setItem(liveKey, "1"); } catch {}

    // switching tab, minimising, or another window coming to the front
    const onVis = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt) { const end = Date.now(); push({ type: "tab_hidden", ms: end - hiddenAt }); hidden = { start: hiddenAt, end }; hiddenAt = 0; }
    };
    // clicking another app or another monitor: the page stays visible but loses focus. A blur that overlaps a hidden tab is the same event, so it is not counted twice.
    const onBlur = () => { blurAt = Date.now(); };
    const onFocus = () => {
      if (blurAt) {
        const end = Date.now(), overlapsHidden = hidden.end > 0 && hidden.start <= end && hidden.end >= blurAt - 1500;
        if (!overlapsHidden && !hiddenAt && document.visibilityState === "visible") push({ type: "window_blur", ms: end - blurAt });
      }
      blurAt = 0;
    };
    // some hand-overs fire no blur (focus moving into a browser tool, a window over a full-screen page), so focus is also checked each second;
    // the same tick notices a second display being connected mid-interview
    const poll = setInterval(() => {
      const focused = document.hasFocus();
      if (!focused && document.visibilityState === "visible" && !blurAt && !pollAt) pollAt = Date.now();
      if (focused && pollAt) { const ms = Date.now() - pollAt; pollAt = 0; if (ms >= 1500) push({ type: "focus_lost", ms }); }
      if (!extendedSeen && (screen as Screen & { isExtended?: boolean }).isExtended) { extendedSeen = true; push({ type: "multi_screen" }); }
    }, 1000);

    const onFull = () => { const f = !!document.fullscreenElement; if (wasFull && !f && !ending.current) { push({ type: "fullscreen_exit" }); setFullscreenLost(true); } if (f) setFullscreenLost(false); wasFull = f; rebase(); };
    const on = (t: string) => () => push({ type: t });
    const onCopy = on("copy"), onCut = on("cut"), onPaste = on("paste");
    const onCtx = (e: Event) => { e.preventDefault(); push({ type: "context_menu" }); };
    const onScreen = () => { if ((screen as Screen & { isExtended?: boolean }).isExtended) { extendedSeen = true; push({ type: "multi_screen" }); } };
    onScreen();

    // the pointer leaving the window for a while (towards another screen or app)
    const onLeave = (e: MouseEvent) => { if (!e.relatedTarget) leftAt = Date.now(); };
    const onEnter = () => { if (leftAt) { const ms = Date.now() - leftAt; leftAt = 0; if (ms >= 3000) push({ type: "cursor_left", ms }); } };

    // shortcuts that open tools, save, print, view source or capture the screen (copy, cut and paste are recorded by their own events)
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      const hit = e.key === "F12" || e.key === "PrintScreen" || (mod && e.shiftKey && ["i", "j", "c", "3", "4", "5"].includes(k)) || (mod && ["u", "s", "p", "f"].includes(k));
      if (hit) push({ type: "shortcut", detail: `${e.metaKey ? "cmd+" : e.ctrlKey ? "ctrl+" : ""}${e.shiftKey ? "shift+" : ""}${e.key}`.slice(0, 40) });
    };

    // the window being made much smaller or larger than it started (docked beside another window, for instance)
    let rz: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (rz) clearTimeout(rz);
      rz = setTimeout(() => {
        const big = Math.abs(window.innerWidth - size.w) / size.w > 0.2 || Math.abs(window.innerHeight - size.h) / size.h > 0.2;
        if (big && !resized) { resized = true; push({ type: "window_resized", detail: `${window.innerWidth}x${window.innerHeight}` }); } else if (!big) resized = false;
      }, 600);
    };

    // leaving or closing the page: get what is queued to the server before it goes (keepalive lets the request outlive the page)
    const onHide = () => {
      if (!queue.current.length) return;
      const batch = queue.current.splice(0, 50);
      void raw(`/interviews/${sessionId}/events`, { ...json({ events: batch.map((b) => ({ ...b, at: new Date().toISOString() })) }), keepalive: true }).catch(() => {});
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur); window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFull);
    document.addEventListener("copy", onCopy); document.addEventListener("cut", onCut); document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onCtx);
    document.documentElement.addEventListener("mouseleave", onLeave); document.documentElement.addEventListener("mouseenter", onEnter);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("pagehide", onHide);
    (screen as unknown as EventTarget).addEventListener?.("change", onScreen);
    const t = setInterval(flush, 5000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur); window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFull);
      ending.current = true; try { if (document.fullscreenElement) void document.exitFullscreen(); } catch {}   // leaving the room always releases full screen
      document.removeEventListener("copy", onCopy); document.removeEventListener("cut", onCut); document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onCtx);
      document.documentElement.removeEventListener("mouseleave", onLeave); document.documentElement.removeEventListener("mouseenter", onEnter);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pagehide", onHide);
      (screen as unknown as EventTarget).removeEventListener?.("change", onScreen);
      clearInterval(t); clearInterval(poll); clearTimeout(rebaseTimer); if (rz) clearTimeout(rz);
      void flush();
    };
  }, [enabled, live, push, flush, sessionId]);

  const stopCamera = useCallback(() => {
    if (loop.current) clearTimeout(loop.current);
    loop.current = null;
    try { lm.current?.close(); } catch {}
    lm.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    for (const t of ["no_face", "gaze_away", "head_turned", "multiple_faces"]) episode(t, false);
    setCamera("off"); setLook("ok");
  }, [episode]);

  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    video.current = el;
    if (el && stream.current && el.srcObject !== stream.current) { el.srcObject = stream.current; void el.play().catch(() => {}); }
  }, []);

  const startCamera = useCallback(async (): Promise<CameraState> => {
    setCamera("starting");
    let s: MediaStream;
    try { s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false }); }
    catch (e) { const st = (e as DOMException)?.name === "NotAllowedError" ? "denied" : "unavailable"; setCamera(st); return st; }
    stream.current = s;
    const track = s.getVideoTracks()[0];
    if (VIRTUAL_CAM.test(track.label)) push({ type: "virtual_camera", detail: track.label.slice(0, 80) });
    track.onended = () => { push({ type: "camera_off" }); stopCamera(); };
    if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}); }
    if (!enabled) { setCamera("on"); return "on"; } // plain self-view: no analysis, nothing monitored
    try {
      const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM);
      const model = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: "GPU" }, runningMode: "VIDEO", numFaces: 2,
        outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
      });
      lm.current = model;
      let lastT = -1;
      const tick = () => {
        const v = video.current;
        if (!lm.current) return;
        if (v && v.readyState >= 2 && v.currentTime !== lastT) {
          lastT = v.currentTime;
          const r = model.detectForVideo(v, performance.now());
          const faces = r.faceLandmarks.length;
          let state: Look = "ok";
          episode("no_face", faces === 0);
          episode("multiple_faces", faces > 1);
          if (faces === 0) state = "none";
          else if (faces > 1) state = "multiple";
          else {
            const m = r.facialTransformationMatrixes?.[0]?.data;
            let turned = false;
            if (m) { const yaw = Math.abs(Math.asin(Math.max(-1, Math.min(1, -m[2]))) * 57.3), pitch = Math.abs(Math.atan2(m[6], m[10]) * 57.3); turned = yaw > 28 || pitch > 30 && pitch < 150; }
            const bs = Object.fromEntries((r.faceBlendshapes?.[0]?.categories ?? []).map((c) => [c.categoryName, c.score]));
            const g = (k: string) => bs[k] ?? 0;
            const side = Math.max((g("eyeLookOutLeft") + g("eyeLookInRight")) / 2, (g("eyeLookInLeft") + g("eyeLookOutRight")) / 2);
            const up = (g("eyeLookUpLeft") + g("eyeLookUpRight")) / 2, down = (g("eyeLookDownLeft") + g("eyeLookDownRight")) / 2;
            const away = !turned && (side > 0.55 || up > 0.6 || down > 0.7);
            episode("head_turned", turned); episode("gaze_away", away);
            state = turned ? "turned" : away ? "away" : "ok";
          }
          setLook(state);
        }
        loop.current = setTimeout(tick, 200);
      };
      tick();
    } catch {
      // The model or its WASM could not be fetched (offline, blocked network). The camera preview still works, face analysis does not.
      setCamera("unavailable"); return "unavailable";
    }
    setCamera("on");
    return "on";
  }, [enabled, episode, push, stopCamera]);

  useEffect(() => () => { stopCamera(); }, [stopCamera]);

  const finalFlush = useCallback(async () => {
    try { sessionStorage.removeItem(`hp_iv_live_${sessionId}`); } catch {}
 for (const t of ["no_face", "gaze_away", "head_turned", "multiple_faces"]) episode(t, false); await flush(); }, [episode, flush, sessionId]);
  const exitFullscreen = useCallback(async () => { ending.current = true; try { if (document.fullscreenElement) await document.exitFullscreen(); } catch {} setFullscreenLost(false); }, []);
  const goFullscreen = useCallback(async () => { try { await document.documentElement.requestFullscreen(); setFullscreenLost(false); } catch {} }, []);

  return { camera, look, count, fullscreenLost, startCamera, stopCamera, attachVideo, goFullscreen, exitFullscreen, finalFlush, push };
}
