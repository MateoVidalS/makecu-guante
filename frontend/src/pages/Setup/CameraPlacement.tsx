import { useEffect, useState } from 'react';
import { GLOVE_FINGERS } from '../../contracts/glove';
import { useVision, useVisionFrame } from '../../vision';
import { StatusDot } from '../../design-system';
import { percent, title } from '../../components/common';
import './setup.css';

/** Side/front diagram: the camera looks diagonally down from the thumb side. */
export function CameraPlacement() {
  return (
    <figure className="setup-placement">
      <figcaption>Camera placement</figcaption>
      <svg
        viewBox="0 0 400 150"
        role="img"
        aria-label="Camera in front on the thumb side, diagonally above the palm-down hand, 30–40 cm from the fingers"
      >
        <path className="setup-placement__surface" d="M16 125H240V144" />
        <path
          className="setup-placement__hand"
          d="M35 106H178L210 98L267 102Q280 104 277 112L211 117H35Z"
        />
        <rect
          className="setup-placement__module"
          x="164"
          y="117"
          width="48"
          height="24"
          rx="4"
        />
        <g
          className="setup-placement__camera"
          transform="translate(315 12) rotate(25)"
        >
          <rect width="42" height="24" rx="4" />
          <circle cx="21" cy="12" r="7" />
          <path d="M21 24V41M21 41L7 57M21 41L35 57" />
        </g>
        <path className="setup-placement__sight" d="M314 44L261 93" />
        <text x="216" y="55">
          30–40 cm
        </text>
        <text x="24" y="91">
          Palm down
        </text>
        <text x="18" y="143">
          Forearm on a towel
        </text>
      </svg>
      <p>Place the camera in front, on the thumb side, diagonally above.</p>
      <p>Rest palm down. Keep the wrist module at the table edge.</p>
      <p>Let your fingers close freely beyond the edge.</p>
    </figure>
  );
}

export function GloveDetectionCheck() {
  const vision = useVision();
  const running = useVisionFrame((frame) => frame !== null);
  const [stats, setStats] = useState(() => vision.robustness());
  // Poll the time-weighted API as well as frames: a stalled camera must decay.
  useEffect(() => {
    setStats(vision.robustness());
    const timer = setInterval(() => setStats(vision.robustness()), 250);
    return () => clearInterval(timer);
  }, [vision, vision.source]);
  const simulated = vision.source.kind === 'sim';
  return (
    <section
      className="setup-detection"
      aria-labelledby="glove-detection-title"
    >
      <h3 id="glove-detection-title">Glove-detection check</h3>
      {simulated && (
        <p className="hp-note">
          Simulator check · Estimates only. Repeat with the real glove and
          camera.
        </p>
      )}
      <p className="hp-capture-status" role="status">
        <StatusDot
          tone={
            !running ? 'off' : stats.status === 'ready' ? 'reached' : 'caution'
          }
        />
        {!running
          ? 'Connect the camera to check tracking.'
          : stats.status === 'collecting'
            ? `Checking tracking · ${Math.min(5, stats.observedMs / 1000).toFixed(1)} of 5 s`
            : `Hand detected: ${percent(stats.detectionRate)} of the last 5 s`}
      </p>
      {running && (
        <>
          <p>
            {stats.status === 'ready'
              ? 'Tracking looks steady.'
              : stats.status === 'poor'
                ? 'Tracking needs adjustment.'
                : 'Open and close all five fingers in your glove.'}
          </p>
          <ul className="hp-note">
            {stats.guidance.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <details className="hp-disclosure">
            <summary>Detection by finger</summary>
            <dl>
              {GLOVE_FINGERS.map((finger) => (
                <div key={finger}>
                  <dt>{title(finger)}</dt>
                  <dd>{percent(stats.perFingerVisibility[finger])} in view</dd>
                </div>
              ))}
            </dl>
            <p className="hp-note">
              Camera estimates can include hidden joints. Check that every
              finger follows.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
