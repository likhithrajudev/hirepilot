"use client";

import { Camera, Download, FolderOpen, History, Trash2 } from "lucide-react";
import { useToast } from "@/app/providers";
import { download } from "@/lib/api";
import { useCreateVersion, useDeleteVersion, useVersions } from "@/lib/hooks";
import type { Version } from "@/lib/types";
import { useDialog } from "./Dialog";
import { Skeleton, timeAgo } from "./ui";

export default function VersionsPanel({ resumeId, latex, onOpen }: { resumeId: number; latex: string; onOpen: (v: Version) => void }) {
  const toast = useToast();
  const { confirm, prompt } = useDialog();
  const { data, isLoading } = useVersions(resumeId);
  const create = useCreateVersion(resumeId);
  const del = useDeleteVersion(resumeId);
  const dl = (v: Version, fmt: string) =>
    download(`/resumes/${resumeId}/versions/${v.id}/export?format=${fmt}`, `${v.label}.${fmt}`).catch((e) => toast(e.message, "error"));

  return (
    <div className="space-y-3 p-4">
      <button
        className="btn w-full"
        disabled={create.isPending}
        onClick={async () => {
          const label = await prompt({ title: "Snapshot current editor", body: "Saves exactly what is in the editor as a named version.", label: "Name", defaultValue: "Snapshot", confirmLabel: "Save snapshot" });
          if (label) create.mutate({ label, latex }, { onSuccess: () => toast("Snapshot saved") });
        }}
      >
        <Camera size={14} /> Snapshot current editor
      </button>

      {isLoading && [0, 1].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
      {data?.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line2 px-4 py-10 text-center">
          <History className="text-subtle" size={20} />
          <p className="text-sm font-medium">No versions yet</p>
          <p className="max-w-[220px] text-xs text-muted">Accept an AI-tailored resume and it is saved here automatically, one per job.</p>
        </div>
      )}

      <ul className="space-y-2.5">
        {data?.map((v) => (
          <li key={v.id} className="card card-hover p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium">{v.label}</div>
                <div className="text-xs text-subtle">{timeAgo(v.created_at)}</div>
              </div>
              <button
                title="Delete version" aria-label={`Delete ${v.label}`} className="btn btn-danger btn-sm !h-6 !w-6 !px-0"
                onClick={async () => (await confirm({ title: "Delete this version?", body: `"${v.label}" will be removed permanently.`, confirmLabel: "Delete", danger: true })) && del.mutate(v.id, { onSuccess: () => toast("Version deleted", "info") })}
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button className="btn btn-sm" onClick={() => onOpen(v)}><FolderOpen size={12} /> Open</button>
              {(["pdf", "tex", "zip"] as const).map((f) => (
                <button key={f} className="btn btn-sm btn-ghost uppercase" onClick={() => dl(v, f)}><Download size={11} /> {f}</button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
