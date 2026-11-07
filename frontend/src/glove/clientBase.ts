import type {
  GloveTelemetry,
  GloveConnection,
  GloveEvent,
  GloveError,
} from '../contracts/glove';

export class Signal<T> {
  private listeners = new Set<(value: T) => void>();
  subscribe = (cb: (value: T) => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  emit(value: T) {
    this.listeners.forEach((cb) => cb(value));
  }
}

export abstract class ClientBase {
  protected status: GloveConnection = 'disconnected';
  protected tel: GloveTelemetry | null = null;
  protected telemetry = new Signal<GloveTelemetry>();
  protected events = new Signal<GloveEvent>();
  protected errors = new Signal<GloveError>();
  protected connections = new Signal<GloveConnection>();
  connection = () => this.status;
  latest = () => this.tel;
  onTelemetry = this.telemetry.subscribe;
  onEvent = this.events.subscribe;
  onError = this.errors.subscribe;
  onConnection = this.connections.subscribe;
  protected setConnection(status: GloveConnection) {
    if (this.status === status) return;
    this.status = status;
    this.connections.emit(status);
  }
  protected emitTelemetry(tel: GloveTelemetry) {
    this.tel = tel;
    this.telemetry.emit(tel);
  }
}
