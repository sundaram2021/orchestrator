import type { HarnessStatus, ModelDescriptor, Usage } from "@orchestrator/contracts";
import type { McpProfile } from "../mcp/profile.js";

export interface SessionHandle {
  id: string;
  cwd: string;
  externalId?: string;
  mcpProfile?: McpProfile;
}

export type ProviderEvent =
  | { kind: "system"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool"; callId: string; tool: string; args: string }
  | { kind: "toolResult"; callId: string; ok: boolean; result: string; truncated?: boolean }
  | { kind: "usage"; usage: Usage }
  | { kind: "done" }
  | { kind: "error"; message: string };

export interface TurnAttachment {
  name: string;
  mime: string;
  data: string;
  path?: string;
}

export interface TurnOptions {
  system?: string;
  attachments?: TurnAttachment[];
}

export interface HarnessAdapter {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly status: HarnessStatus;
  readonly canExecute: boolean;

  detect(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
  models(): Promise<ModelDescriptor[]>;
  /** Optional: human-readable status detail for the settings UI. */
  describe?(): string;
  startSession(cwd: string, profile?: McpProfile): Promise<SessionHandle>;
  sendTurn(
    session: SessionHandle,
    prompt: string,
    model: string,
    options?: TurnOptions,
  ): AsyncIterable<ProviderEvent>;
  interrupt(session: SessionHandle): Promise<void>;

  /** Optional: compact or rotate a long-lived session when context is nearly full. */
  compact?(session: SessionHandle, model: string): Promise<boolean>;

  /** Optional: release per-turn session resources (e.g. a harness subprocess). */
  disposeSession?(session: SessionHandle): Promise<void>;

  /** Optional: release pooled processes rooted at a workspace dir (called before a worktree is removed). */
  disposeWorkspace?(dir: string): Promise<void>;
}
