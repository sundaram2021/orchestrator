import type {
  DomainEvent,
  MethodName,
  MethodParams,
  MethodResult,
  ServerReply,
  ServerPush,
} from "@orchestrator/contracts";

export type ConnState = "connecting" | "open" | "closed";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class RpcClient {
  private ws: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly eventListeners = new Set<(event: DomainEvent) => void>();
  private readonly stateListeners = new Set<(state: ConnState) => void>();
  private buffer: DomainEvent[] = [];
  private paused = true;
  private counter = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;

  state: ConnState = "connecting";

  constructor(private url: string) {}

  setUrl(url: string): void {
    if (url === this.url) return;
    this.url = url;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.attempt = 0;
    this.ws?.close();
    this.connect();
  }

  onEvent(listener: (event: DomainEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onState(listener: (state: ConnState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  private setState(state: ConnState): void {
    this.state = state;
    for (const listener of this.stateListeners) listener(state);
  }

  connect(): void {
    this.setState("connecting");
    this.paused = true;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.setState("open");
    };

    ws.onmessage = (ev) => {
      let payload: ServerReply | ServerPush;
      try {
        payload = JSON.parse(String(ev.data)) as ServerReply | ServerPush;
      } catch {
        return;
      }
      if ("push" in payload) {
        this.deliver(payload.event);
        return;
      }
      const pending = this.pending.get(payload.id);
      if (!pending) return;
      this.pending.delete(payload.id);
      if (payload.ok) pending.resolve(payload.result);
      else pending.reject(new Error(payload.error ?? "rpc error"));
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.rejectPending("connection closed");
      this.setState("closed");
      this.scheduleReconnect();
    };

    ws.onerror = () => ws.close();
  }

  private rejectPending(reason: string): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) p.reject(new Error(reason));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.attempt, 8000);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private deliver(event: DomainEvent): void {
    if (this.paused) {
      this.buffer.push(event);
      return;
    }
    for (const listener of this.eventListeners) listener(event);
  }

  resume(): void {
    const buffered = this.buffer;
    this.buffer = [];
    this.paused = false;
    for (const event of buffered) {
      for (const listener of this.eventListeners) listener(event);
    }
  }

  pause(): void {
    this.paused = true;
  }

  request<M extends MethodName>(method: M, params?: MethodParams<M>): Promise<MethodResult<M>> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("not connected"));
        return;
      }
      const id = `r${this.counter++}`;
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}
