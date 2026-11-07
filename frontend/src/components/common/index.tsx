import type { ButtonHTMLAttributes, ReactNode } from 'react';
export function BigButton({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props}>{children}</button>;
}
export function StatusChip({ children }: { children: ReactNode }) {
  return <span className="chip">{children}</span>;
}
export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="card">{children}</div>;
}
export function Toasts() {
  return (
    <div
      id="toast-region"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    />
  );
}
