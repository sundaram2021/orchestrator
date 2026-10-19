# Orchestrator Sidecar — Test Readme

A **test document** for the split markdown view: the left pane is the editable
*source* and the right pane is the live **preview**. Edit either side's source and
the preview updates as you type.

## 1. What this file exercises

- Headings, paragraphs, and inline styles: **bold**, *italic*, `inline code`.
- Nested lists:

  1. Ordered item
  2. Second item
     - Nested bullet
     - Another bullet

- Task-style bullets:

  - [x] Split source/preview layout
  - [x] Markdown syntax highlighting in Monaco
  - [ ] Your next idea

## 2. Code blocks

```ts
export interface HarnessAdapter {
  start(session: SessionOptions): Promise<SessionHandle>;
  sendTurn(handle: SessionHandle, prompt: string): AsyncIterable<TurnEvent>;
  stop(handle: SessionHandle): Promise<void>;
}
```

```bash
pnpm dev
pnpm typecheck
pnpm test
```

## 3. Table

| Surface | Purpose | Owner |
| --- | --- | --- |
| Sidecar | Single authority, events, RPC | Node |
| Web | Dumb UI over contracts | Svelte 5 |
| Desktop | Tauri shell + lifecycle | Rust |

## 4. Quote and rule

> The sidecar is the single authority. The UI is dumb; it depends on contracts,
> never on concrete adapters.

---

### 5. File references

Open files directly from the preview:

- `src/Orchestrator.ts`
- `src/git/GitService.ts`
- [README at repo root](https://github.com/sundaram2021/orchestrator)

#### 5.1 Longer heading for wrapping

This paragraph is intentionally long so the preview pane has to wrap text and the
source pane has to clip or scroll. It should wrap gracefully without horizontal
scrolling. If the layout feels cramped, make the window wider or toggle the
preview off with the eye button in the editor bar.
