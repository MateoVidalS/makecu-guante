import type { SVGProps } from 'react';

/**
 * One icon approach for the whole app: a small inline-SVG set on a 24 px grid, 2 px round strokes,
 * `currentColor`. No icon font, no dependency. Add new icons here, in the same style.
 */
const paths = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  'chevron-left': <path d="M15 5l-7 7 7 7" />,
  'chevron-right': <path d="M9 5l7 7-7 7" />,
  'chevron-down': <path d="M5 9l7 7 7-7" />,
  'chevron-up': <path d="M5 15l7-7 7 7" />,
  'arrow-left': <path d="M19 12H5M11 6l-6 6 6 6" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  'arrow-up': <path d="M12 19V5M6 11l6-6 6 6" />,
  'arrow-down': <path d="M12 5v14M6 13l6 6 6-6" />,
  'trend-up': <path d="M4 16l5-5 4 4 7-7M15 8h5v5" />,
  'trend-down': <path d="M4 8l5 5 4-4 7 7M15 16h5v-5" />,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  pause: <path d="M9 5.5v13M15 5.5v13" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  skip: <path d="M6 5.5v13l9-6.5zM18 5.5v13" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
      <path d="M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16" />
      <path d="M20 20v-4h-4" />
    </>
  ),
  hand: (
    <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v5.5m0-3a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2L4.6 14.9a1.6 1.6 0 0 1 2.4-2l1 1.1" />
  ),
  glove: (
    <>
      <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v5.5m0-3a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2L4.6 14.9a1.6 1.6 0 0 1 2.4-2l1 1.1" />
      <path d="M9 17.5h8" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  'camera-off': (
    <>
      <path d="M4 4l16 16M9.5 5h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v8M18 19H5.5A1.5 1.5 0 0 1 4 17.5v-9A1.5 1.5 0 0 1 5.5 7H7" />
      <path d="M9.7 10.7a3.5 3.5 0 0 0 4.6 4.6" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  'mic-off': (
    <>
      <path d="M4 4l16 16M15 10V6a3 3 0 0 0-5.8-1.1M9 9v2a3 3 0 0 0 4.6 2.5" />
      <path d="M18.5 11a6.5 6.5 0 0 1-.8 3.1M5.5 11a6.5 6.5 0 0 0 10 5.5M12 17.5V21" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5v.01" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.01" />
    </>
  ),
  caution: (
    <>
      <path d="M10.3 4.3L2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4.5M12 17v.01" />
    </>
  ),
  safety: (
    <>
      <path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </>
  ),
  home: (
    <>
      <path d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />
    </>
  ),
  practice: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
  evaluate: (
    <>
      <path d="M4.5 17a8 8 0 1 1 15 0" />
      <path d="M12 13l3.5-4M12 13v.01" />
    </>
  ),
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.5" />
      <path d="M4 4.5v4h4M12 8v4.5l3 2" />
    </>
  ),
  setup: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  doctor: (
    <>
      <path d="M6 3.5v5a4 4 0 0 0 8 0v-5M6 3.5H5M14 3.5h1" />
      <path d="M10 12.5v2a5 5 0 0 0 10 0V13" />
      <circle cx="20" cy="11" r="2" />
    </>
  ),
  download: <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />,
  print: (
    <>
      <path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2" />
      <rect x="7" y="14" width="10" height="6" rx="1" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M9 20.5h6M12 16.5v4" />
    </>
  ),
  usb: (
    <>
      <path d="M12 3v14M9 6l3-3 3 3M7.5 10v2.5L12 15M16.5 9v2.5L12 14" />
      <circle cx="12" cy="19" r="2" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  chart: <path d="M4 4v16h16M8 15l3.5-4 3 2.5L19 8" />,
  table: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <path d="M4 10h16M4 14.5h16M10 10v9" />
    </>
  ),
  trash: <path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7M10.5 11v5M13.5 11v5" />,
  edit: (
    <path d="M14.5 5.5l4 4M4 20l1-4.5L15.5 5a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2L8.5 19z" />
  ),
  external: (
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  ),
  sparkline: <path d="M3 15l4-5 3 3 4-7 3 5 4-3" />,
  dot: <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />,
  logo: (
    <>
      {/* The memo "m" at icon weight; the full mark is LogoMark in Logo.tsx. */}
      <path d="M5.5 18v-5.5a3.25 3.25 0 0 1 6.5 0V18M12 12.5a3.25 3.25 0 0 1 6.5 0V18" />
    </>
  ),
} as const;

export type IconName = keyof typeof paths;
export const iconNames = Object.keys(paths) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** CSS size; defaults to 1.2em so the icon scales with the label next to it. */
  size?: number | string;
  /** Give a label only when the icon stands alone and carries meaning; otherwise it is decorative. */
  label?: string;
}

export function Icon({ name, size = '1.2em', label, ...rest }: IconProps) {
  return (
    <svg
      className="ds-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
