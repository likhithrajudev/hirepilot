"use client";

import { useEffect, useState } from "react";
import { Headphones, Loader2, Trash2 } from "lucide-react";
import { api, raw } from "@/lib/api";
import { dateTime } from "@/lib/portal";
import { useDialog } from "@/components/Dialog";

type Recording = { id: string; created_at: string; mime: string; bytes: number; completed: boolean };

export default function Recordings({ sessionId }: { sessionId: number }) {
  const [items, setItems] = useState<Recording[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const dialog = useDialog();
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    api<Recording[]>(`/interviews/${sessionId}/recordings`).then((data) => { if (!cancelled) setItems(data); }).catch(() => { if (!cancelled) setError("Could not load recordings. Refresh to try again."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId]);
  const remove = async (id: string) => {
    if (!await dialog.confirm({ title: "Delete this audio recording?", body: "The saved audio will be permanently removed. Your written transcript and report will remain.", confirmLabel: "Delete recording", danger: true })) return;
    try { await api(`/interviews/${sessionId}/recordings/${id}`, { method: "DELETE" }); setItems((rows) => rows.filter((r) => r.id !== id)); }
    catch { setError("Could not delete recording. Try again."); }
  };
  return <section className="card no-print space-y-4 p-5"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><Headphones size={16} className="text-brand" /> Interview audio</h2><p className="mt-1 text-xs leading-relaxed text-muted">Automatically recorded on joining. Available to you and authorized platform admins. Rejoins appear as separate recordings. Device voice fallbacks are included only in the transcript.</p></div>{error && <p role="alert" className="text-xs text-bad">{error}</p>}{loading ? <Loader2 size={16} className="animate-spin text-muted" /> : !items.length ? <p className="text-xs text-muted">No saved audio is available for this interview.</p> : items.map((r) => <div key={r.id} className="space-y-2 border-t border-line pt-3"><div className="flex items-center justify-between gap-3"><p className="text-xs text-muted">{dateTime(r.created_at)} · {(r.bytes / 1024 / 1024).toFixed(1)} MB{!r.completed && " · Partial recording"}</p><button className="btn btn-ghost btn-sm text-bad" aria-label="Delete audio recording" onClick={() => void remove(r.id)}><Trash2 size={13} /> Delete</button></div>{r.bytes > 0 ? <Player sessionId={sessionId} recording={r} /> : <p className="text-xs text-muted">Audio has not been uploaded.</p>}</div>)}</section>;
}

function Player({ sessionId, recording }: { sessionId: number; recording: Recording }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const load = async () => {
    setBusy(true); setError("");
    try { const r = await raw(`/interviews/${sessionId}/recordings/${recording.id}/audio`); setUrl(URL.createObjectURL(await r.blob())); }
    catch { setError("Could not load audio. Try again."); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (recording.bytes > 0) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [recording.id]);
  return <div className="space-y-2">{url ? <><audio controls preload="metadata" src={url} className="w-full" aria-label="Interview audio recording" /><a className="text-xs text-brand underline" href={url} download={`interview-${sessionId}-${recording.id}.${recording.mime.includes("mp4") ? "m4a" : recording.mime.includes("ogg") ? "ogg" : "webm"}`}>Download audio</a></> : <button className="btn btn-sm" disabled={busy} onClick={() => void load()}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Headphones size={13} />} Load audio</button>}{error && <p role="alert" className="text-xs text-bad">{error}</p>}</div>;
}
