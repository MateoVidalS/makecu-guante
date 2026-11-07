import { useRuntime, useExerciseView } from '../../runtime';
import { DEFAULT_PLAN, DEFAULT_EXERCISE_SETTINGS } from '../../contracts/poses';
import { CoachPanel } from '../../voice';
export default function Exercise() {
  const runtime = useRuntime(),
    view = useExerciseView();
  return (
    <section>
      <h1>Exercise</h1>
      <p>Coming in WP7 · Scripted simulator</p>
      <p className="instruction">{view.pose.instruction}</p>
      <p className="phase">{view.phase}</p>
      <div className="actions">
        <button
          className="primary"
          onClick={() =>
            void runtime.exercise.start(DEFAULT_PLAN, DEFAULT_EXERCISE_SETTINGS)
          }
          disabled={view.phase !== 'DONE'}
        >
          Play scripted exercise
        </button>
        <button
          onClick={() =>
            view.paused ? runtime.exercise.resume() : runtime.exercise.pause()
          }
          disabled={view.phase === 'DONE'}
        >
          {view.paused ? 'Resume' : 'Pause'}
        </button>
        <button
          onClick={runtime.exercise.skip}
          disabled={view.phase === 'DONE'}
        >
          Skip pose
        </button>
        <button
          onClick={() => void runtime.exercise.stop()}
          disabled={view.phase === 'DONE'}
        >
          End session
        </button>
      </div>
      <CoachPanel />
      <details>
        <summary>Scripted runtime data</summary>
        <pre>{JSON.stringify(view, null, 2)}</pre>
      </details>
    </section>
  );
}
