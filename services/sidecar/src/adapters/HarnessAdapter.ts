import type { HarnessStatus, ModelDescriptor } from "@orchestrator/contracts";

export interface SessionHandle {
  id: string;
  cwd: string;
  externalId?: string;
}

export type ProviderEvent =
  | { kind: "status"; status: HarnessStatus }
  | { kind: "system"; text: string }
  | { kind: "assistant"; text: string; delta: boolean }
  | { kind: "tool"; callId: string; tool: string; args: string }
  | { kind: "toolResult"; callId: string; ok: boolean; result: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

export interface TurnOptions {
  system?: string;
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
  startSession(cwd: string): Promise<SessionHandle>;
  sendTurn(
    session: SessionHandle,
    prompt: string,
    model: string,
    options?: TurnOptions,
  ): AsyncIterable<ProviderEvent>;
  interrupt(session: SessionHandle): Promise<void>;
}

export interface LaunchableHarness {
  launch(): Promise<{ ok: boolean; detail: string }>;
}

export const isLaunchable = (adapter: unknown): adapter is LaunchableHarness =>
  typeof (adapter as LaunchableHarness | undefined)?.launch === "function";
