"use client";

import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePrefsQuery, useSavePrefs } from "./hooks";
import type { Prefs } from "./types";

export const DEFAULT_PREFS: Prefs = {
  theme: "system", density: "comfortable", accent: "blue", smooth_scroll: true, reduce_motion: false,
  editor_font_size: 13, editor_word_wrap: true, editor_minimap: false, auto_compile: true, auto_compile_delay_ms: 1800,
  ai_strictness: "strict", ai_creativity: 0.3, ai_max_attempts: 3, ai_default_instructions: "", cover_letter_tone: "warm",
  default_roles: "backend, software engineer, platform", include_internships: true, default_min_score: 0, blocked_companies: [],
};

/** Preferences with sensible defaults while loading, plus a save() that merges a partial update. */
export function usePrefs() {
  const q = usePrefsQuery();
  const save = useSavePrefs();
  const saved = q.data ?? DEFAULT_PREFS;
  // The retired green/teal identity renders as blue without writing over stored preferences.
  const prefs = saved.accent === "green" || saved.accent === "teal" ? { ...saved, accent: "blue" as const } : saved;
  const qc = useQueryClient();
  const update = useCallback(
    (patch: Partial<Prefs>) => save.mutate({ ...((qc.getQueryData(["prefs"]) as Prefs | undefined) ?? DEFAULT_PREFS), ...patch }),
    [save, qc],
  );
  return { prefs, update, ready: q.isSuccess, saving: save.isPending };
}

/** Pushes preferences onto the document: theme, density, accent and motion. Renders nothing. */
export function PrefsApplier() {
  const { prefs } = usePrefs();
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = prefs.theme === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : prefs.theme === "dark";
      root.classList.toggle("dark", dark);
    };
    apply();
    try {
      if (prefs.theme === "system") localStorage.removeItem("hp_theme");
      else localStorage.setItem("hp_theme", prefs.theme);
    } catch {}
    if (prefs.theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [prefs.theme]);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.density = prefs.density;
    root.dataset.accent = prefs.accent;
    root.dataset.motion = prefs.reduce_motion ? "reduce" : "full";
  }, [prefs.density, prefs.accent, prefs.reduce_motion]);
  return null;
}
