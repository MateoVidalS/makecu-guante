import { useEffect, useState } from 'react';
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';
import { hasStatic } from './media';

// Loads a JSON manifest from public/ (null if the file is not there yet).
export function useJson<T>(path: string): T | null {
  const exists = hasStatic(path);
  const [data, setData] = useState<T | null>(null);
  const [handle] = useState(() => (exists ? delayRender(`load ${path}`) : null));
  useEffect(() => {
    if (handle === null) return;
    fetch(staticFile(path))
      .then((r) => r.json())
      .then((j: T) => {
        setData(j);
        continueRender(handle);
      })
      .catch((e) => cancelRender(e));
  }, [handle, path]);
  return data;
}
