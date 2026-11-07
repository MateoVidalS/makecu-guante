import { attemptLevel, calendarTakeaway, practiceCalendar } from './visuals';
import { VisualCard } from './VisualCard';

const CELL = 16;
const GAP = 3;
const LEFT = 30;
const TOP = 18;
const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];
const longDate = (d: string) =>
  new Date(d).toLocaleDateString('en', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
const month = (d: string) =>
  new Date(d).toLocaleDateString('en', { month: 'short', timeZone: 'UTC' });

/** Days practiced, one square per day, darker with more attempts. */
export function PracticeCalendar({
  sessions,
  today = Date.now(),
  loading,
  weeks: minWeeks = 8,
}: {
  sessions: { started_at: string; n_attempts: number; is_demo: boolean }[];
  today?: Date | number;
  loading?: boolean;
  weeks?: number;
}) {
  const cal = practiceCalendar(sessions, today, minWeeks);
  const width = LEFT + cal.weeks.length * (CELL + GAP);
  const height = TOP + 7 * (CELL + GAP);
  const todayKey = new Date(+today).toISOString().slice(0, 10);
  const practiced = cal.days.filter((d) => d.sessions > 0);
  return (
    <VisualCard
      className="practice-calendar"
      title={calendarTakeaway(cal.last7, cal.last28)}
      hint="One square per day. Darker means more attempts. The outlined square is today."
      label={`Practice calendar, ${cal.weeks.length} weeks. ${practiced.length} days with practice: ${practiced
        .map((d) => `${longDate(d.date)}, ${d.attempts} attempts`)
        .join('; ')}.`}
      loading={loading}
      aside={
        <dl className="calendar-stats">
          <div>
            <dt>Last 7 days</dt>
            <dd>{cal.last7} days</dd>
          </div>
          <div>
            <dt>Last 28 days</dt>
            <dd>{cal.last28} days</dd>
          </div>
          <div>
            <dt>Attempts, all time</dt>
            <dd>{cal.days.reduce((n, d) => n + d.attempts, 0)}</dd>
          </div>
        </dl>
      }
      table={
        practiced.length ? (
          <table className="data-table">
            <caption>Days with practice</caption>
            <thead>
              <tr>
                <th scope="col">Date (UTC)</th>
                <th scope="col" className="num">
                  Sessions
                </th>
                <th scope="col" className="num">
                  Attempts
                </th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {practiced.map((d) => (
                <tr key={d.date}>
                  <th scope="row">{longDate(d.date)}</th>
                  <td className="num">{d.sessions}</td>
                  <td className="num">{d.attempts}</td>
                  <td>{d.demo ? 'Demo data' : 'Recorded'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="footnote">No practice recorded yet.</p>
        )
      }
    >
      <div className="calendar-scroll">
        <svg
          className="viz-svg calendar-svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
        >
          {DAY_LABELS.map((l, i) =>
            l ? (
              <text
                key={l}
                className="viz-tick"
                x={LEFT - 6}
                y={TOP + i * (CELL + GAP) + CELL / 2}
                dy={4}
                textAnchor="end"
              >
                {l}
              </text>
            ) : null,
          )}
          {cal.weeks.map((week, w) => {
            const x = LEFT + w * (CELL + GAP);
            const prev = cal.weeks[w - 1]?.[0];
            const showMonth = !prev || month(prev.date) !== month(week[0].date);
            return (
              <g key={week[0].date}>
                {showMonth && (
                  <text className="viz-tick" x={x} y={TOP - 6}>
                    {month(week[0].date)}
                  </text>
                )}
                {week.map((d, i) =>
                  d.future ? null : (
                    <rect
                      key={d.date}
                      className={`cal-day cal-day--${attemptLevel(d.attempts)}${d.demo ? ' viz-demo' : ''}${d.date === todayKey ? ' cal-day--today' : ''}`}
                      x={x}
                      y={TOP + i * (CELL + GAP)}
                      width={CELL}
                      height={CELL}
                      rx={3}
                    >
                      <title>
                        {`${longDate(d.date)} · ${d.attempts ? `${d.attempts} attempts` : 'No practice'}${d.demo ? ' · Demo data' : ''}`}
                      </title>
                    </rect>
                  ),
                )}
              </g>
            );
          })}
        </svg>
        <div className="calendar-scale" aria-hidden="true">
          <span>Fewer attempts</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <svg key={l} viewBox="0 0 12 12">
              <rect
                className={`cal-day cal-day--${l}`}
                x={0.5}
                y={0.5}
                width={11}
                height={11}
                rx={2.5}
              />
            </svg>
          ))}
          <span>More</span>
        </div>
      </div>
    </VisualCard>
  );
}
