import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

interface WorkerEnvironment {
  getWorker(workerId: string, label: string): Worker;
}

(self as unknown as { MonacoEnvironment: WorkerEnvironment }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

monaco.editor.defineTheme("orchestrator-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "546e7a", fontStyle: "italic" },
    { token: "keyword", foreground: "c792ea" },
    { token: "string", foreground: "c3e88d" },
    { token: "number", foreground: "f78c6c" },
  ],
  colors: {
    "editor.background": "#0e0e0f",
    "editor.foreground": "#d4d6dc",
    "editorLineNumber.foreground": "#3a3a42",
    "editorLineNumber.activeForeground": "#7c7c88",
    "editor.selectionBackground": "#26406f",
    "editorCursor.foreground": "#3d6ef5",
    "scrollbar.shadow": "#00000000",
    "scrollbarSlider.background": "#ffffff1f",
    "scrollbarSlider.hoverBackground": "#ffffff2e",
    "scrollbarSlider.activeBackground": "#ffffff3d",
  },
});

export default monaco;
