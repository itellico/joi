import { useRef, useEffect } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder as cmPlaceholder,
  lineNumbers,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  HighlightStyle,
} from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { tags } from "@lezer/highlight";

// Custom dark theme matching JOI design tokens
const joiDarkTheme = EditorView.theme(
  {
    "&": {
      color: "#e0e0ec",
      backgroundColor: "#0a0a0f",
      fontSize: "13px",
      fontFamily:
        "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Menlo', monospace",
    },
    ".cm-content": {
      caretColor: "#a78bfa",
      lineHeight: "1.6",
      padding: "12px 0",
    },
    "&.cm-focused .cm-cursor": {
      borderLeftColor: "#a78bfa",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: "rgba(167, 139, 250, 0.2)",
      },
    ".cm-panels": {
      backgroundColor: "#0e0e16",
      color: "#e0e0ec",
    },
    ".cm-panels.cm-panels-top": {
      borderBottom: "1px solid #1c1c2e",
    },
    ".cm-searchMatch": {
      backgroundColor: "rgba(167, 139, 250, 0.25)",
      outline: "1px solid rgba(167, 139, 250, 0.4)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "rgba(167, 139, 250, 0.4)",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(255, 255, 255, 0.03)",
    },
    ".cm-selectionMatch": {
      backgroundColor: "rgba(167, 139, 250, 0.15)",
    },
    ".cm-gutters": {
      backgroundColor: "#0a0a0f",
      color: "#55556e",
      border: "none",
      borderRight: "1px solid #1c1c2e",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(255, 255, 255, 0.03)",
      color: "#8888a4",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "#15151f",
      color: "#8888a4",
      border: "1px solid #1c1c2e",
    },
    ".cm-tooltip": {
      border: "1px solid #1c1c2e",
      backgroundColor: "#0e0e16",
      color: "#e0e0ec",
    },
    ".cm-tooltip .cm-tooltip-arrow:before": {
      borderTopColor: "#1c1c2e",
      borderBottomColor: "#1c1c2e",
    },
    ".cm-tooltip .cm-tooltip-arrow:after": {
      borderTopColor: "#0e0e16",
      borderBottomColor: "#0e0e16",
    },
  },
  { dark: true },
);

// Syntax highlight colors matching the dark theme
const joiHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, color: "#e0e0ec", fontWeight: "700", fontSize: "1.3em" },
  { tag: tags.heading2, color: "#e0e0ec", fontWeight: "600", fontSize: "1.15em" },
  { tag: tags.heading3, color: "#e0e0ec", fontWeight: "600", fontSize: "1.05em" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], color: "#e0e0ec", fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic", color: "#c4b5fd" },
  { tag: tags.strong, fontWeight: "bold", color: "#e0e0ec" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "#8888a4" },
  { tag: tags.link, color: "#22d3ee", textDecoration: "underline" },
  { tag: tags.url, color: "#22d3ee" },
  { tag: [tags.processingInstruction, tags.monospace], color: "#a78bfa" },
  { tag: tags.quote, color: "#8888a4", fontStyle: "italic" },
  { tag: tags.keyword, color: "#c4b5fd" },
  { tag: tags.string, color: "#34d399" },
  { tag: tags.number, color: "#fbbf24" },
  { tag: tags.comment, color: "#55556e", fontStyle: "italic" },
  { tag: tags.meta, color: "#55556e" },
  { tag: tags.contentSeparator, color: "#55556e" },
]);

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onSave?: () => void;
}

export default function MarkdownEditor({
  value,
  onChange,
  placeholder = "",
  className = "",
  onSave,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!containerRef.current) return;

    const saveKeymap = onSave
      ? keymap.of([
          {
            key: "Mod-s",
            run: () => {
              onSaveRef.current?.();
              return true;
            },
          },
        ])
      : [];

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        foldGutter(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        joiDarkTheme,
        syntaxHighlighting(joiHighlightStyle),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        ...(placeholder ? [cmPlaceholder(placeholder)] : []),
        ...(Array.isArray(saveKeymap) ? saveKeymap : [saveKeymap]),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes (e.g. when loading a different doc)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentValue = view.state.doc.toString();
    if (currentValue !== value) {
      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div ref={containerRef} className={`markdown-cm-editor ${className}`} />
  );
}
