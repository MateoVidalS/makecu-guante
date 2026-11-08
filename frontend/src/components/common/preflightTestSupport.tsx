import { useGlove } from '../../glove';

/** Exercise serial-only UI gates without opening a port or moving hardware. */
export function PreflightGloveControls() {
  const glove = useGlove();
  return (
    <>
      <button
        onClick={() => {
          const client = new Proxy(glove.world.glove, {
            get(target, property) {
              if (property === 'kind') return 'serial';
              const value: unknown = Reflect.get(target, property);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
          glove.store.setState({ client, connection: 'connected' });
        }}
      >
        Use real glove
      </button>
      <button
        onClick={() =>
          glove.store.setState({
            client: glove.world.glove,
            connection: 'connected',
          })
        }
      >
        Use simulated glove
      </button>
    </>
  );
}
