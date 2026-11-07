import { PageHeader } from '../../design-system';
import { Link, useParams } from 'react-router-dom';
import { useEvaluation } from '../../api/client';
import { GLOVE_FINGERS } from '../../contracts/glove';
import {
  DataSection,
  DataStatus,
  SweepCurves,
  fingerName,
  formatDate,
  sweepsAreConstant,
} from '../../components/charts';
const ma = (value: number | null) =>
  value == null ? '—' : `${Math.round(value)} mA`;
export default function EvaluationDetail() {
  const { id } = useParams(),
    evaluation = useEvaluation(Number(id));
  const data = evaluation.data;
  return (
    <section className="data-page">
      <Link className="back-link" to="/history?tab=resistance">
        <span aria-hidden="true">← </span>Back to resistance
      </Link>
      <PageHeader
        title="Evaluation detail"
        lead={
          data
            ? `${formatDate(data.started_at)} · An estimate inspired by clinical practice, not a validated medical measurement.`
            : 'An estimate inspired by clinical practice, not a validated medical measurement.'
        }
      />
      <DataStatus loading={evaluation.isPending} error={evaluation.error}>
        {data && (
          <>
            <DataSection
              title="Resistance by finger"
              description={
                data.friction_used
                  ? 'Empty-glove friction was subtracted for resistance estimates.'
                  : 'No friction calibration. Resistance includes glove friction; interpret cautiously.'
              }
              demo={data.is_demo}
              demoNote="Demo data"
            >
              <div className="data-table-wrap">
                <table className="data-table">
                  <caption>
                    Mean excess current over 20–90% commanded position
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Finger</th>
                      {['Slow', 'Fast', 'Fast − slow', 'Peak excess'].map(
                        (s) => (
                          <th key={s} scope="col" className="num">
                            {s}
                          </th>
                        ),
                      )}
                      <th scope="col">Sweep status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.fingers.map((f) => (
                      <tr key={f.finger}>
                        <th scope="row">{fingerName(f.finger)}</th>
                        <td className="num">{ma(f.resistance_slow_ma)}</td>
                        <td className="num">{ma(f.resistance_fast_ma)}</td>
                        <td className="num">{ma(f.velocity_dependence_ma)}</td>
                        <td className="num">{ma(f.peak_excess_ma)}</td>
                        <td>
                          {f.aborted
                            ? 'Stopped safely; incomplete'
                            : 'Complete'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="footnote">
                Sweep speeds: slow {data.settings.slow_v} ranges/s, fast{' '}
                {data.settings.fast_v} ranges/s.
              </p>
            </DataSection>
            <DataSection
              title="Sweep curves"
              description="Total current along the commanded range, slow and fast, with the stored friction for comparison."
            >
              <div className="chart-grid">
                {GLOVE_FINGERS.map((finger) => (
                  <SweepCurves
                    key={finger}
                    finger={finger}
                    sweeps={data.sweeps}
                    isDemo={data.is_demo}
                    compact
                  />
                ))}
              </div>
              {data.is_demo && sweepsAreConstant(data.sweeps) && (
                <p className="footnote">
                  Sample sweep values are constant in these demo records.
                </p>
              )}
            </DataSection>
          </>
        )}
      </DataStatus>
    </section>
  );
}
