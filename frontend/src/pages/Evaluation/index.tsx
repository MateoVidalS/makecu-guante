import { useRuntime, useEvaluationView } from '../../runtime';
import { DEFAULT_EVAL_SETTINGS } from '../../contracts/poses';
export default function Evaluation() {
  const runtime = useRuntime(),
    view = useEvaluationView();
  return (
    <section>
      <h1>Evaluation</h1>
      <p>Coming in WP7 · Scripted simulator</p>
      <p className="phase">{view.stage}</p>
      <div className="actions">
        <button
          className="primary"
          disabled={['prepare', 'sweep', 'cooldown'].includes(view.stage)}
          onClick={() => void runtime.evaluation.start(DEFAULT_EVAL_SETTINGS)}
        >
          Play scripted evaluation
        </button>
        <button onClick={() => void runtime.evaluation.stop()}>Stop</button>
      </div>
      <details>
        <summary>Scripted evaluation data</summary>
        <pre>{JSON.stringify(view, null, 2)}</pre>
      </details>
    </section>
  );
}
