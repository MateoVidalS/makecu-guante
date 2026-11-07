import { Icon } from '../../design-system';

const DAY = 86_400_000;
const localKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface WeekDay {
  key: string;
  date: Date;
  practiced: boolean;
  today: boolean;
}

/** The last 7 local days ending today, marked practiced when any session started that day. */
export function lastSevenDays(
  startedAt: string[],
  now = new Date(),
): WeekDay[] {
  const done = new Set(startedAt.map((s) => localKey(new Date(s))));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(today.getTime() - (6 - i) * DAY);
    // Re-normalise across DST changes.
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const key = localKey(day);
    return { key, date: day, practiced: done.has(key), today: i === 6 };
  });
}

/** Days in a row up to today (or up to yesterday when today isn't done yet). */
export function streak(days: WeekDay[]): number {
  let i = days.length - 1;
  if (!days[i]?.practiced) i -= 1;
  let n = 0;
  while (i >= 0 && days[i].practiced) {
    n += 1;
    i -= 1;
  }
  return n;
}

const weekday = (d: Date) =>
  d.toLocaleDateString('en-US', { weekday: 'short' });
const long = (d: Date) =>
  d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

/** Seven calm circles: filled with a check = practiced, open ring = not yet. */
export function WeekStrip({
  days,
  goal = 5,
}: {
  days: WeekDay[];
  goal?: number;
}) {
  const count = days.filter((d) => d.practiced).length;
  const run = streak(days);
  return (
    <div className="mx-week">
      <p className="mx-week__headline">
        <strong>
          {count} of {goal} days
        </strong>{' '}
        <span className="mx-muted">in the last 7 days</span>
      </p>
      <ol className="mx-week__days" aria-label="Practice in the last 7 days">
        {days.map((d) => (
          <li
            key={d.key}
            className="mx-week__day"
            data-practiced={d.practiced}
            data-today={d.today}
          >
            <span className="mx-week__mark" title={long(d.date)}>
              {d.practiced && <Icon name="check" />}
            </span>
            <span className="mx-week__label" aria-hidden="true">
              {d.today ? 'Today' : weekday(d.date)}
            </span>
            <span className="mx-sr">
              {long(d.date)}: {d.practiced ? 'practiced' : 'no practice'}
            </span>
          </li>
        ))}
      </ol>
      {run >= 2 && (
        <p className="mx-week__streak mx-muted">
          {run} days in a row. Nice rhythm.
        </p>
      )}
    </div>
  );
}
