import type {
  GloveTelemetry,
  GloveEvent,
  GloveInfo,
  GloveError,
} from '../contracts/glove';
import type { SerialCommand } from '../contracts/glove';
export function encode(_command: SerialCommand): string {
  throw new Error('WP2');
}
export function decode(
  _line: string,
): GloveTelemetry | GloveEvent | GloveInfo | GloveError | null {
  throw new Error('WP2');
}
