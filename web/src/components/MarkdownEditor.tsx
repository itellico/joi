import { useRef, useEffect, useCallback } from "react";
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

// ─── Formatting commands ───

/** Wrap selection with markers (bold, italic, strikethrough, inline code) */
function wrapSelection(view: EditorView, before: string, after: string) {
  const { state } = view;
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);

  // If already wrapped, unwrap
  const bLen = before.length;
  const aLen = after.length;
  if (
    from >= bLen &&
    state.sliceDoc(from - bLen, from) === before &&
    state.sliceDoc(to, to + aLen) === after
  ) {
    view.dispatch({
      changes: [
        { from: from - bLen, to: from, insert: "" },
        { from: to, to: to + aLen, insert: "" },
      ],
      selection: { anchor: from - bLen, head: to - bLen },
    });
    return true;
  }

  if (selected) {
    view.dispatch({
      changes: { from, to, insert: `${before}${selected}${after}` },
      selection: { anchor: from + bLen, head: to + bLen },
    });
  } else {
    view.dispatch({
      changes: { from, insert: `${before}${after}` },
      selection: { anchor: from + bLen },
    });
  }
  return true;
}

/** Toggle a line prefix (heading, list, blockquote) */
function toggleLinePrefix(view: EditorView, prefix: string) {
  const { state } = view;
  const { from, to } = state.selection.main;
  const startLine = state.doc.lineAt(from);
  const endLine = state.doc.lineAt(to);

  const changes: Array<{ from: number; to: number; insert: string }> = [];
  let allHavePrefix = true;

  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = state.doc.line(i);
    if (!line.text.startsWith(prefix)) {
      allHavePrefix = false;
      break;
    }
  }

  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = state.doc.line(i);
    if (allHavePrefix) {
      // Remove prefix
      changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
    } else if (!line.text.startsWith(prefix)) {
      // For headings, strip any existing heading prefix first
      const headingMatch = prefix.match(/^#{1,6} $/);
      if (headingMatch) {
        const existingHeading = line.text.match(/^#{1,6} /);
        if (existingHeading) {
          changes.push({ from: line.from, to: line.from + existingHeading[0].length, insert: prefix });
          continue;
        }
      }
      // For lists, strip any existing list prefix first
      const listPrefixes = ["- ", "1. ", "- [ ] ", "- [x] ", "> "];
      const existingPrefix = listPrefixes.find((p) => line.text.startsWith(p));
      if (existingPrefix && existingPrefix !== prefix) {
        changes.push({ from: line.from, to: line.from + existingPrefix.length, insert: prefix });
        continue;
      }
      changes.push({ from: line.from, to: line.from, insert: prefix });
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
  }
  return true;
}

/** Insert a code block */
function insertCodeBlock(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const newline = from > 0 && view.state.sliceDoc(from - 1, from) !== "\n" ? "\n" : "";

  if (selected) {
    view.dispatch({
      changes: { from, to, insert: `${newline}\`\`\`\n${selected}\n\`\`\`\n` },
      selection: { anchor: from + newline.length + 4, head: from + newline.length + 4 + selected.length },
    });
  } else {
    const insert = `${newline}\`\`\`\n\n\`\`\`\n`;
    view.dispatch({
      changes: { from, insert },
      selection: { anchor: from + newline.length + 4 },
    });
  }
  return true;
}

/** Insert a link */
function insertLink(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);

  if (selected) {
    // If selection looks like a URL, wrap it as link
    if (selected.match(/^https?:\/\//)) {
      view.dispatch({
        changes: { from, to, insert: `[](${selected})` },
        selection: { anchor: from + 1 },
      });
    } else {
      view.dispatch({
        changes: { from, to, insert: `[${selected}](url)` },
        selection: { anchor: from + selected.length + 3, head: from + selected.length + 6 },
      });
    }
  } else {
    view.dispatch({
      changes: { from, insert: "[text](url)" },
      selection: { anchor: from + 1, head: from + 5 },
    });
  }
  return true;
}

/** Insert horizontal rule */
function insertHorizontalRule(view: EditorView) {
  const { from } = view.state.selection.main;
  const newline = from > 0 && view.state.sliceDoc(from - 1, from) !== "\n" ? "\n" : "";
  view.dispatch({
    changes: { from, insert: `${newline}---\n` },
    selection: { anchor: from + newline.length + 4 },
  });
  return true;
}

// Build the formatting keymap for CodeMirror
function buildFormattingKeymap(onSaveRef: React.RefObject<(() => void) | undefined>) {
  return keymap.of([
    { key: "Mod-b", run: (v) => wrapSelection(v, "**", "**") },
    { key: "Mod-i", run: (v) => wrapSelection(v, "*", "*") },
    { key: "Mod-Shift-x", run: (v) => wrapSelection(v, "~~", "~~") },
    { key: "Mod-e", run: (v) => wrapSelection(v, "`", "`") },
    { key: "Mod-Shift-1", run: (v) => toggleLinePrefix(v, "# ") },
    { key: "Mod-Shift-2", run: (v) => toggleLinePrefix(v, "## ") },
    { key: "Mod-Shift-3", run: (v) => toggleLinePrefix(v, "### ") },
    { key: "Mod-Shift-7", run: (v) => toggleLinePrefix(v, "1. ") },
    { key: "Mod-Shift-8", run: (v) => toggleLinePrefix(v, "- ") },
    { key: "Mod-Shift-9", run: (v) => toggleLinePrefix(v, "- [ ] ") },
    { key: "Mod-Shift-.", run: (v) => toggleLinePrefix(v, "> ") },
    { key: "Mod-Shift-c", run: (v) => insertCodeBlock(v) },
    { key: "Mod-k", run: (v) => insertLink(v) },
    {
      key: "Mod-s",
      run: () => {
        onSaveRef.current?.();
        return true;
      },
    },
  ]);
}

// ─── Toolbar definition ───

interface ToolbarAction {
  label: string;
  title: string;
  action: (view: EditorView) => void;
  separator?: false;
}

interface ToolbarSeparator {
  separator: true;
}

type ToolbarItem = ToolbarAction | ToolbarSeparator;

const TOOLBAR_ITEMS: ToolbarItem[] = [
  { label: "B", title: "Bold (⌘B)", action: (v) => wrapSelection(v, "**", "**") },
  { label: "I", title: "Italic (⌘I)", action: (v) => wrapSelection(v, "*", "*") },
  { label: "S", title: "Strikethrough (⌘⇧X)", action: (v) => wrapSelection(v, "~~", "~~") },
  { label: "<>", title: "Inline code (⌘E)", action: (v) => wrapSelection(v, "`", "`") },
  { separator: true },
  { label: "H1", title: "Heading 1 (⌘⇧1)", action: (v) => toggleLinePrefix(v, "# ") },
  { label: "H2", title: "Heading 2 (⌘⇧2)", action: (v) => toggleLinePrefix(v, "## ") },
  { label: "H3", title: "Heading 3 (⌘⇧3)", action: (v) => toggleLinePrefix(v, "### ") },
  { separator: true },
  { label: "•", title: "Bullet list (⌘⇧8)", action: (v) => toggleLinePrefix(v, "- ") },
  { label: "1.", title: "Ordered list (⌘⇧7)", action: (v) => toggleLinePrefix(v, "1. ") },
  { label: "☐", title: "Task list (⌘⇧9)", action: (v) => toggleLinePrefix(v, "- [ ] ") },
  { separator: true },
  { label: "❝", title: "Blockquote (⌘⇧.)", action: (v) => toggleLinePrefix(v, "> ") },
  { label: "{}", title: "Code block (⌘⇧C)", action: (v) => { insertCodeBlock(v); } },
  { label: "🔗", title: "Link (⌘K)", action: (v) => { insertLink(v); } },
  { label: "—", title: "Horizontal rule", action: (v) => { insertHorizontalRule(v); } },
];

// ─── Theme ───

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

// ─── Component ───

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
        buildFormattingKeymap(onSaveRef),
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

  // Sync external value changes
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

  const handleToolbarAction = useCallback(
    (action: (view: EditorView) => void) => {
      const view = viewRef.current;
      if (!view) return;
      action(view);
      view.focus();
    },
    [],
  );

  return (
    <div className={`markdown-cm-wrap ${className}`}>
      {/* Formatting toolbar */}
      <div className="markdown-cm-toolbar">
        {TOOLBAR_ITEMS.map((item, i) =>
          item.separator ? (
            <div key={i} className="markdown-cm-toolbar-sep" />
          ) : (
            <button
              key={i}
              type="button"
              className="markdown-cm-toolbar-btn"
              title={item.title}
              onMouseDown={(e) => e.preventDefault()} // keep editor focus
              onClick={() => handleToolbarAction(item.action)}
            >
              {item.label}
            </button>
          ),
        )}
      </div>
      {/* CodeMirror editor */}
      <div ref={containerRef} className="markdown-cm-editor" />
    </div>
  );
}
