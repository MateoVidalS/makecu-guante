import type {
  GloveClient,
  GloveInfo,
  GloveTelemetry,
  GloveEvent,
  GloveError,
  GloveConnection,
  Triple,
} from '../contracts/glove';
export class WebSerialGlove implements GloveClient {
  readonly kind = 'serial' as const;
  connection(): GloveConnection {
    return 'disconnected';
  }
  async connect(): Promise<GloveInfo> {
    throw new Error('WP2');
  }
  async disconnect() {}
  target(_f: Triple, _v: number): void {
    throw new Error('WP2');
  }
  follow(_f: Triple): void {
    throw new Error('WP2');
  }
  release() {}
  calib(_i: 0 | 1 | 2, _min: number, _max: number): void {
    throw new Error('WP2');
  }
  jog(_i: 0 | 1 | 2, _deg: number): void {
    throw new Error('WP2');
  }
  limit(_ma: number): void {
    throw new Error('WP2');
  }
  hello(): void {
    throw new Error('WP2');
  }
  latest(): GloveTelemetry | null {
    return null;
  }
  onTelemetry(_cb: (value: GloveTelemetry) => void) {
    return () => {};
  }
  onEvent(_cb: (value: GloveEvent) => void) {
    return () => {};
  }
  onError(_cb: (value: GloveError) => void) {
    return () => {};
  }
  onConnection(_cb: (value: GloveConnection) => void) {
    return () => {};
  }
}
