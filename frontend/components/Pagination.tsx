"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

/** 1 … 4 5 [6] 7 8 … 20 */
function windowed(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const lo = Math.max(2, page - 1), hi = Math.min(pages - 1, page + 1);
  if (lo > 2) out.push("…");
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < pages - 1) out.push("…");
  out.push(pages);
  return out;
}

export default function Pagination({
  page, pages, total, pageSize, onPage, onPageSize, sizes = [12, 24, 48, 96], noun = "items",
}: {
  page: number; pages: number; total: number; pageSize: number;
  onPage: (p: number) => void; onPageSize: (n: number) => void; sizes?: number[]; noun?: string;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
      <p className="text-xs text-subtle" aria-live="polite">
        Showing <span className="font-medium text-fg">{from}–{to}</span> of <span className="font-medium text-fg">{total}</span> {noun}
      </p>
      <div className="flex items-center gap-1">
        <button className="btn btn-sm btn-icon" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={14} /></button>
        {windowed(page, pages).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="grid h-7 w-6 place-items-center text-xs text-subtle">…</span>
          ) : (
            <button key={p} aria-current={p === page ? "page" : undefined} onClick={() => onPage(p)}
              className={`btn btn-sm btn-icon !w-auto min-w-7 px-2 tabular-nums ${p === page ? "!border-transparent !bg-brand !text-brand-fg" : "btn-ghost"}`}>{p}</button>
          ),
        )}
        <button className="btn btn-sm btn-icon" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={14} /></button>
      </div>
      <label className="flex items-center gap-2 text-xs text-subtle">
        Per page
        <select className="input !h-7 !w-auto !py-0 text-xs" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {sizes.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </nav>
  );
}
