import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { GloveClient, GloveConnection } from '../contracts/glove';
import { ClientBase } from './clientBase';
import {
  createGloveController,
  GloveProvider,
  useGlove,
  useGloveTelemetry,
} from './GloveProvider';
import { SimWorld } from './sim/simWorld';

class FakeSerial extends ClientBase implements GloveClient {
  readonly kind = 'serial' as const;
  connect = vi.fn(async () => {
    this.setConnection('connected');
    return { fw: 'fake', fingers: 3, limit: 900, calib: [null, null, null] };
  });
  disconnect = vi.fn(async () => {
    this.setConnection('disconnected');
  });
  target = vi.fn();
  follow = vi.fn();
  release = vi.fn();
  calib = vi.fn();
  jog = vi.fn();
  limit = vi.fn();
  hello = vi.fn();
  change(connection: GloveConnection) {
    this.setConnection(connection);
  }
}
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('GloveProvider controller', () => {
  it('binds the active client, forwards selector subscriptions and keeps the last 100 events', async () => {
    const world = new SimWorld({ autoStart: false });
    const value = createGloveController({ world, kind: 'sim' });
    value.mount();
    expect(value.connection).toBe('connected');
    const values: unknown[] = [],
      telemetry: unknown[] = [];
    const unsub = value.subscribeTelemetry(
      (tel) => tel?.st,
      (st) => values.push(st),
    );
    const unsubTel = value.subscribe((tel) => telemetry.push(tel));
    world.advance(100);
    expect(values).toEqual(['idle']);
    expect(telemetry).toHaveLength(5);
    for (let i = 0; i < 110; i++)
      world.firmware.events.emit({ t: i, e: 'boot' });
    expect(value.events).toHaveLength(100);
    unsub();
    unsubTel();
    world.advance(100);
    expect(telemetry).toHaveLength(5);
    value.dispose();
    expect(world.glove.connection()).toBe('disconnected');
  });
  it('switches clients safely, clears old telemetry/events and keeps subscriptions on the active client only', async () => {
    const world = new SimWorld({ autoStart: false }),
      serial = new FakeSerial();
    const value = createGloveController({ world, serial, kind: 'sim' });
    value.mount();
    world.advance(20);
    await value.setKind('serial');
    expect(value.client).toBe(serial);
    expect(value.latest).toBeNull();
    expect(value.events).toEqual([]);
    expect(serial.connect).not.toHaveBeenCalled(); // Chooser needs an explicit user gesture.
    world.firmware.events.emit({ t: 0, e: 'boot' });
    expect(value.events).toEqual([]);
    await value.client.connect();
    expect(value.connection).toBe('connected');
    await value.setKind('sim');
    expect(serial.disconnect).toHaveBeenCalledOnce();
    serial.change('error');
    expect(value.connection).toBe('connected');
    world.advance(20);
    expect(value.latest).not.toBeNull();
    value.dispose();
  });
  it('serial is idle until connect is called and rapid switches are serialized', async () => {
    const world = new SimWorld({ autoStart: false }),
      serial = new FakeSerial();
    const value = createGloveController({ world, serial, kind: 'serial' });
    value.mount();
    expect(serial.connect).not.toHaveBeenCalled();
    await Promise.all([value.setKind('sim'), value.setKind('serial')]);
    expect(value.client).toBe(serial);
    expect(value.connection).toBe('disconnected');
    value.dispose();
  });
  it('useGlove and useGloveTelemetry rerender on connection and selected telemetry', async () => {
    vi.stubEnv('VITE_SIM', '1');
    const { result, unmount } = renderHook(
      () => {
        const glove = useGlove();
        const state = useGloveTelemetry((tel) => tel?.st);
        return { glove, connection: glove.connection, state };
      },
      { wrapper: GloveProvider },
    );
    expect(result.current.connection).toBe('connected');
    act(() => result.current.glove.world.advance(20));
    expect(result.current.state).toBe('idle');
    await act(() => result.current.glove.client.disconnect());
    expect(result.current.connection).toBe('disconnected');
    unmount();
  });
});
