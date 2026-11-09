"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, json, raw } from "@/lib/api";

/** Keeps the microphone and synthesized AI audio on one timeline. Browser speech
 * synthesis cannot be captured by Web Audio; the UI discloses that fallback. */
export function useRecording(sessionId: number) {
  const [state, setState] = useState<"idle" | "recording" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const context = useRef<AudioContext | null>(null);
  const rid = useRef("");
  const queue = useRef<Blob[]>([]);
  const sequence = useRef(0);
  const draining = useRef<Promise<void> | null>(null);
  const stopWait = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const finalizing = useRef<Promise<void> | null>(null);

  const drain = useCallback((): Promise<void> => {
    if (draining.current) return draining.current;
    const job = async () => {
      while (queue.current.length) {
        const part = queue.current[0];
        let saved = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await raw(`/interviews/${sessionId}/recordings/${rid.current}/parts/${sequence.current}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: part });
            saved = true; break;
          } catch (e) { if (attempt === 2) throw e; }
        }
        if (saved) { queue.current.shift(); sequence.current++; }
      }
    };
    const promise = job().finally(() => { draining.current = null; });
    draining.current = promise;
    return promise;
  }, [sessionId]);

  const fail = useCallback(() => {
    if (mounted.current) { setState("error"); setError("Audio could not be saved. Keep this page open and retry saving before leaving."); }
  }, []);

  const start = useCallback(async (mic: MediaStream | null, ai: MediaStream) => {
    if (recorder.current) return;
    try {
      if (typeof MediaRecorder === "undefined") throw new Error("Recording is unavailable in this browser");
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m));
      if (!mime) throw new Error("Recording is unavailable in this browser");
      const c = new AudioContext(); context.current = c;
      const mix = c.createMediaStreamDestination();
      if (mic) c.createMediaStreamSource(mic).connect(mix);
      c.createMediaStreamSource(ai).connect(mix);
      await c.resume();
      const rec = new MediaRecorder(mix.stream, { mimeType: mime, audioBitsPerSecond: 64000 });
      const capture = await api<{ id: string }>(`/interviews/${sessionId}/recordings`, json({ mime }));
      rid.current = capture.id; recorder.current = rec;
      rec.ondataavailable = (event) => {
        if (!event.data.size) return;
        queue.current.push(event.data);
        // Bound local memory if the connection is down for a long time.
        if (queue.current.reduce((total, part) => total + part.size, 0) > 64 * 1024 * 1024 && rec.state !== "inactive") rec.stop();
        void drain().then(() => {
          if (mounted.current && rec.state === "recording") { setState("recording"); setError(""); }
        }).catch(fail);
      };
      stopWait.current = new Promise<void>((resolve) => rec.addEventListener("stop", () => resolve(), { once: true }));
      rec.onerror = fail;
      rec.start(3000);
      if (mounted.current) { setState("recording"); setError(""); }
    } catch (e) {
      void context.current?.close(); context.current = null;
      if (mounted.current) { setState("error"); setError(e instanceof Error ? `Audio recording did not start: ${e.message}` : "Audio recording did not start"); }
    }
  }, [sessionId, drain, fail]);

  const finish = useCallback((): Promise<void> => {
    if (finalizing.current) return finalizing.current;
    const rec = recorder.current;
    if (!rec) return Promise.resolve();
    const save = async () => {
      if (mounted.current) { setState("saving"); setError(""); }
      if (rec.state !== "inactive") rec.stop();
      await stopWait.current;
      // An in-flight upload may have failed; retry its retained chunk in order.
      await draining.current?.catch(() => {});
      await drain();
      await api(`/interviews/${sessionId}/recordings/${rid.current}/complete`, { method: "POST" });
      const c = context.current; context.current = null;
      await c?.close();
      if (mounted.current) setState("saved");
    };
    finalizing.current = save().catch((e) => { finalizing.current = null; fail(); throw e; });
    return finalizing.current;
  }, [sessionId, drain, fail]);

  const retry = useCallback(async () => {
    if (recorder.current?.state !== "recording") return finish();
    try {
      await drain();
      if (mounted.current) { setState("recording"); setError(""); }
    } catch (e) { fail(); throw e; }
  }, [drain, fail, finish]);

  useEffect(() => {
    mounted.current = true;
    const warn = (e: BeforeUnloadEvent) => { if (recorder.current?.state === "recording" || queue.current.length) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => {
      mounted.current = false; window.removeEventListener("beforeunload", warn);
      const rec = recorder.current;
      if (rec?.state === "recording") { rec.addEventListener("stop", () => { void drain().catch(() => {}); void context.current?.close(); }, { once: true }); rec.stop(); }
      else void context.current?.close();
    };
  }, [drain]);
  return { state, error, start, finish, retry };
}
