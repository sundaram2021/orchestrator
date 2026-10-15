import type { DomainEvent } from "@orchestrator/contracts";

export class Broadcaster {
  private readonly listeners = new Set<(event: DomainEvent) => void>();

  on(listener: (event: DomainEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: DomainEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
