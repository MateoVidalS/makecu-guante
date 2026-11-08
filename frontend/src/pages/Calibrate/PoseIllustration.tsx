/**
 * Side view of one finger with the glove thread over its back (the opening glove routes the
 * tendon dorsally). Used to show what "slack", "open", "your fist" and "open hand" look like.
 */
export type Pose = 'slack' | 'open' | 'fist' | 'open-hand';

const KNUCKLE = { x: 58, y: 44 };
const SEGMENTS = [30, 20, 15];

/** Joint flexion in degrees per pose: MCP, PIP, DIP. */
const FLEXION: Record<'curled' | 'straight', [number, number, number]> = {
  curled: [55, 75, 45],
  straight: [0, 0, 0],
};

function joints(flexion: [number, number, number]) {
  const points = [KNUCKLE];
  let angle = 0;
  flexion.forEach((flex, i) => {
    angle += (flex * Math.PI) / 180;
    const last = points[points.length - 1];
    points.push({
      x: last.x + SEGMENTS[i] * Math.cos(angle),
      y: last.y + SEGMENTS[i] * Math.sin(angle),
    });
  });
  return points;
}

/** The thread rides on the back (outer side) of the finger: offset each joint along its normal. */
function dorsal(points: { x: number; y: number }[], offset: number) {
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // Normal pointing away from the palm side (up for a straight finger).
    return {
      x: p.x + ((b.y - a.y) / len) * offset,
      y: p.y - ((b.x - a.x) / len) * offset,
    };
  });
}

const path = (points: { x: number; y: number }[]) =>
  points
    .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

export function PoseIllustration({
  pose,
  size = 'md',
}: {
  pose: Pose;
  size?: 'sm' | 'md';
}) {
  const curled = pose === 'slack' || pose === 'fist';
  const finger = joints(FLEXION[curled ? 'curled' : 'straight']);
  const showThread = pose === 'slack' || pose === 'open';
  const thread = dorsal(finger, 8);
  const labels: Record<Pose, string> = {
    slack:
      'A relaxed fist with the thread just taut along the back of the finger',
    open: 'The finger straight, thread taut, not bent back',
    fist: 'A closed fist',
    'open-hand': 'An open hand with straight fingers',
  };
  return (
    <svg
      className={`cal-pose cal-pose--${size}`}
      viewBox="0 0 132 96"
      role="img"
      aria-label={labels[pose]}
    >
      {/* Wrist module and back of the hand. */}
      <rect
        className="cal-pose__module"
        x="4"
        y="30"
        width="20"
        height="26"
        rx="4"
      />
      <rect
        className="cal-pose__palm"
        x="20"
        y="34"
        width="44"
        height="22"
        rx="10"
      />
      {/* Finger: outline stroke under the fill stroke reads as a rounded finger. */}
      <path className="cal-pose__finger-outline" d={path(finger)} />
      <path className="cal-pose__finger" d={path(finger)} />
      {finger.slice(1, -1).map((j, i) => (
        <circle key={i} className="cal-pose__joint" cx={j.x} cy={j.y} r="1.6" />
      ))}
      {showThread && (
        <path
          className="cal-pose__thread"
          d={`M24 38 L${KNUCKLE.x - 6} 36 ${path(thread.slice(1)).replace('M', 'L')}`}
        />
      )}
      {pose === 'open' && (
        <path className="cal-pose__limit" d={`M${finger[3].x + 6} 24 V64`} />
      )}
    </svg>
  );
}
