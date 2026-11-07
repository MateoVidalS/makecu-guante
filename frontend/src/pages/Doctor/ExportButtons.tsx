import { useState } from 'react';
import { exportData } from '../../api/client';

export function ExportButtons() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const download = async (format: 'json' | 'csv') => {
    setBusy(true);
    setMessage('');
    try {
      const blob = await exportData(format);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `rehab-hub.${format}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // Keep the object URL alive until the browser has started the download.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Export downloaded. Demo records include the is_demo field.');
    } catch {
      setMessage('Export unavailable. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="no-print">
      <div className="actions">
        <button disabled={busy} onClick={() => void download('json')}>
          Export JSON
        </button>
        <button disabled={busy} onClick={() => void download('csv')}>
          Export CSV
        </button>
      </div>
      <p role="status">{message}</p>
    </div>
  );
}
