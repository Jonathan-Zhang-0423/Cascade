/**
 * Lightweight observable state container for stream instances.
 * Designed for high-frequency updates (token-level) without triggering
 * global Zustand re-renders. React consumption via useSyncExternalStore.
 */
export class ObservableState<T extends object> {
  private state: T;
  private listeners = new Set<() => void>();
  private snapshot: T;

  constructor(initial: T) {
    this.state = { ...initial };
    this.snapshot = this.state;
  }

  get(): T {
    return this.state;
  }

  set(partial: Partial<T>): void {
    let changed = false;
    for (const key of Object.keys(partial) as (keyof T)[]) {
      if (this.state[key] !== partial[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    this.state = { ...this.state, ...partial };
    this.snapshot = this.state;
    this.notify();
  }

  reset(full: T): void {
    this.state = { ...full };
    this.snapshot = this.state;
    this.notify();
  }

  /**
   * For useSyncExternalStore — returns a stable reference that only
   * changes when set() is called with different values.
   */
  getSnapshot = (): T => {
    return this.snapshot;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    for (const fn of this.listeners) {
      try { fn(); } catch {}
    }
  }
}
