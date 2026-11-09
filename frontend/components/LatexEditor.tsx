"use client";

import { DiffEditor, Editor, type BeforeMount, type DiffOnMount, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import { useTheme } from "@/app/providers";
import { usePrefs } from "@/lib/prefs";

const registerLatex: BeforeMount = (monaco) => {
  // Themes are (re)defined every mount so colours always match the app tokens.
  monaco.editor.defineTheme("hp-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8b92a7", fontStyle: "italic" },
      { token: "keyword", foreground: "c2410c", fontStyle: "bold" },
      { token: "keyword.control", foreground: "c2417a", fontStyle: "bold" },
      { token: "type.identifier", foreground: "0b7fab" },
      { token: "string", foreground: "0f9d6b" },
      { token: "number", foreground: "b7791f" },
      { token: "delimiter.bracket", foreground: "7a8199" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.lineHighlightBackground": "#f6f7fb",
      "editorLineNumber.foreground": "#b4b9ca",
      "editorLineNumber.activeForeground": "#c2410c",
      "editorGutter.background": "#ffffff",
      "editor.selectionBackground": "#c2410c33",
    },
  });
  monaco.editor.defineTheme("hp-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6d7690", fontStyle: "italic" },
      { token: "keyword", foreground: "ffb27a", fontStyle: "bold" },
      { token: "keyword.control", foreground: "ff8ac0", fontStyle: "bold" },
      { token: "type.identifier", foreground: "6cc8ee" },
      { token: "string", foreground: "3ddc97" },
      { token: "number", foreground: "f5b84b" },
      { token: "delimiter.bracket", foreground: "8a93ad" },
    ],
    colors: {
      "editor.background": "#11141d",
      "editor.lineHighlightBackground": "#171b26",
      "editorLineNumber.foreground": "#4a5169",
      "editorLineNumber.activeForeground": "#ff9a52",
      "editorGutter.background": "#11141d",
      "editor.selectionBackground": "#ff9a5240",
    },
  });

  if (monaco.languages.getLanguages().some((l: { id: string }) => l.id === "latex")) return;
  monaco.languages.register({ id: "latex" });
  monaco.languages.setMonarchTokensProvider("latex", {
    tokenizer: {
      root: [
        [/%.*$/, "comment"],
        [/\\(begin|end)(?=\{)/, "keyword.control"],
        [/\\(documentclass|usepackage|input|include|newcommand|renewcommand|newenvironment|section|subsection|item|textbf|textit|href)\b/, "keyword"],
        [/\\[a-zA-Z@]+\*?/, "type.identifier"],
        [/\\./, "string.escape"],
        [/\$\$?/, { token: "string", next: "@math" }],
        [/[{}[\]]/, "delimiter.bracket"],
      ],
      math: [
        [/\$\$?/, { token: "string", next: "@pop" }],
        [/\\[a-zA-Z]+/, "number"],
        [/[^$\\]+/, "string"],
        [/./, "string"],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration("latex", {
    comments: { lineComment: "%" },
    brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "$", close: "$" },
    ],
  });
};

const options = {
  minimap: { enabled: false },
  fontSize: 13,
  lineHeight: 21,
  fontFamily: "var(--font-jetbrains), ui-monospace, Menlo, monospace",
  fontLigatures: true,
  wordWrap: "on" as const,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  padding: { top: 14, bottom: 14 },
  renderLineHighlight: "line" as const,
  bracketPairColorization: { enabled: true },
  smoothScrolling: true,
  cursorSmoothCaretAnimation: "on" as const,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
};

const Loading = ({ what }: { what: string }) => (
  <div className="grid h-full place-items-center text-sm text-subtle">Loading {what}…</div>
);

function useEditorOptions() {
  const { prefs } = usePrefs();
  return { ...options, fontSize: prefs.editor_font_size, lineHeight: Math.round(prefs.editor_font_size * 1.6), wordWrap: prefs.editor_word_wrap ? ("on" as const) : ("off" as const), minimap: { enabled: prefs.editor_minimap } };
}

export function LatexEditor({ value, onChange, onSave }: { value: string; onChange: (v: string) => void; onSave: () => void }) {
  const { theme } = useTheme();
  const opts = useEditorOptions();
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
  };
  return (
    <Editor
      language="latex"
      theme={theme === "dark" ? "hp-dark" : "hp-light"}
      value={value}
      beforeMount={registerLatex}
      onMount={onMount}
      onChange={(v) => onChange(v ?? "")}
      options={opts}
      loading={<Loading what="editor" />}
    />
  );
}

export function LatexDiff({ original, modified }: { original: string; modified: string }) {
  const { theme } = useTheme();
  const opts = useEditorOptions();
  const editorRef = useRef<Parameters<DiffOnMount>[0] | null>(null);
  // Monaco throws "TextModel got disposed before DiffEditorWidget model got reset" if the models die first.
  // Detaching them while the widget is still alive makes the unmount order irrelevant.
  useEffect(() => () => { try { editorRef.current?.setModel(null); } catch {} }, []);
  return (
    <DiffEditor
      language="latex"
      theme={theme === "dark" ? "hp-dark" : "hp-light"}
      original={original}
      modified={modified}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={(editor) => { editorRef.current = editor; }}
      beforeMount={registerLatex}
      options={{ ...opts, readOnly: true, renderSideBySide: true }}
      loading={<Loading what="diff" />}
    />
  );
}
