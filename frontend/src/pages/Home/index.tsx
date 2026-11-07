import { Link } from 'react-router-dom';
import { useHealth } from '../../api/client';
export default function Home() {
  const health = useHealth();
  return (
    <section>
      <h1>Rehab Hub</h1>
      <p>Practice at your pace.</p>
      <p>Coming in WP7</p>
      <Link className="button" to="/exercise">
        Start exercise
      </Link>
      <p className="muted">
        {health.isSuccess
          ? 'API connected'
          : health.isError
            ? 'API unavailable'
            : 'Connecting to API…'}{' '}
        · Foundation preview
      </p>
    </section>
  );
}
