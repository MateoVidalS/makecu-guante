import { PageHeader } from '../../design-system';
import { Link, useParams } from 'react-router-dom';
import { useEvaluation } from '../../api/client';
import { GLOVE_FINGERS } from '../../contracts/glove';
import {
  DataStatus,
  DemoBadge,
  SweepCurves,
  fingerName,
  formatDate,
} from '../../components/charts';
const ma = (value: number | null) =>
  value == null ? '—' : `${Math.round(value)} mA`;
export default function EvaluationDetail() {
  const { id } = useParams(),
    evaluation = useEvaluation(Number(id));
  const data = evaluation.data;
  return (
    <section className="data-page">
      <Link to="/history?tab=resistance">Back to resistance</Link>
      <PageHeader
        title="Evaluation detail"
        lead="An estimate inspired by clinical practice."
      />
      <DataStatus loading={evaluation.isPending} error={evaluation.error}>
        {data && (
          <>
            <p>
              {formatDate(data.started_at)} {data.is_demo && <DemoBadge />}
            </p>
            <p>
              Estimate inspired by clinical practice, not a validated medical
              measurement.
            </p>
            <p>
              {data.friction_used
                ? 'Empty-glove friction was subtracted for resistance estimates.'
                : 'No friction calibration. Resistance includes glove friction; interpret cautiously.'}
            </p>
            <div className="data-table-wrap">
              <table className="data-table">
                <caption>
                  Resistance: mean excess current over 20–90% commanded position
                </caption>
                <thead>
                  <tr>
                    {[
                      'Finger',
                      'Slow',
                      'Fast',
                      'Fast − slow',
                      'Peak excess',
                      'Sweep status',
                    ].map((s) => (
                      <th key={s} scope="col">
                        {s}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.fingers.map((f) => (
                    <tr key={f.finger}>
                      <th scope="row">{fingerName(f.finger)}</th>
                      <td>{ma(f.resistance_slow_ma)}</td>
                      <td>{ma(f.resistance_fast_ma)}</td>
                      <td>{ma(f.velocity_dependence_ma)}</td>
                      <td>{ma(f.peak_excess_ma)}</td>
                      <td>
                        {f.aborted ? 'Stopped safely; incomplete' : 'Complete'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Slow: {data.settings.slow_v} ranges/s · Fast:{' '}
              {data.settings.fast_v} ranges/s.
            </p>
            {GLOVE_FINGERS.map((finger) => (
              <SweepCurves
                key={finger}
                finger={finger}
                sweeps={data.sweeps}
                isDemo={data.is_demo}
              />
            ))}
          </>
        )}
      </DataStatus>
    </section>
  );
}
