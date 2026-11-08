import { useEffect, useState } from 'react';
import { GLOVE_FINGERS } from '../../contracts/glove';
import { useVision, useVisionFrame } from '../../vision';
import { CAMERA_PLACEMENT_GUIDANCE } from '../../vision/robustness';
import { Banner, StatusDot } from '../../design-system';
import { percent, title } from '../../components/common';
import './setup.css';

const UPRIGHT_PLACEMENT_GUIDANCE =
  'Raise your hand beside your face, palm to the screen, elbow resting on the table, about 40–60 cm from the laptop.';

/** Front webcam framing with an upright hand and a supported elbow. */
export function CameraPlacement() {
  return (
    <figure className="setup-placement">
      <figcaption>Camera placement</figcaption>
      <svg
        viewBox="0 0 400 190"
        role="img"
        aria-label="Raised hand beside the face, palm to the laptop screen, elbow on the table, 40–60 cm from the laptop"
      >
        <path className="setup-placement__surface" d="M16 166H384" />
        <rect
          className="setup-placement__camera"
          x="280"
          y="30"
          width="90"
          height="105"
          rx="4"
        />
        <circle cx="325" cy="37" r="2" />
        <path
          className="setup-placement__camera"
          d="M280 135L265 159H385L370 135"
        />
        <circle cx="60" cy="55" r="22" />
        <path d="M24 148V115Q24 87 60 87Q90 87 96 114L114 158Q124 168 136 158L150 103" />
        <path
          className="setup-placement__hand"
          d="M140 104L130 82Q127 74 133 72L142 83V44Q142 35 148 38L151 65V30Q152 22 158 27L160 65V34Q162 26 167 32L169 68V45Q171 37 176 43L176 86Q174 102 164 106Z"
        />
        <path d="M164 106L154 158Q146 171 128 166" />
        <path className="setup-placement__sight" d="M185 70L275 40" />
        <text x="185" y="101">
          40–60 cm
        </text>
        <text x="20" y="185">
          Elbow supported
        </text>
      </svg>
      <p>{UPRIGHT_PLACEMENT_GUIDANCE}</p>
      <p>Keep your hand relaxed and all five fingers in view.</p>
      <p>Face a light source. Avoid a bright window behind you.</p>
    </figure>
  );
}

export function HandDetectionCheck() {
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
    <section className="setup-detection" aria-labelledby="hand-detection-title">
      <h3 id="hand-detection-title">Hand-detection check</h3>
      <p className="hp-note">
        Keep your bare hand visible with the guides and anchors attached.
      </p>
      {simulated && (
        <p className="hp-note">
          Simulator check · Estimates only. Repeat with your real hand and
          camera.
        </p>
      )}
      {!simulated && (
        <p className="hp-note">
          Lighting check: a bright window behind you can hide your hand. Face
          the light or close the curtain.
        </p>
      )}
      {running && !simulated && stats.lighting?.status === 'backlit' && (
        <Banner tone="warning" title="Your hand is in shadow.">
          Close the curtain behind you or move away from the window. Light your
          palm from the laptop side.
        </Banner>
      )}
      {running && !simulated && stats.lighting?.status === 'low_light' && (
        <Banner tone="warning" title="Your hand needs more light.">
          Add a light in front of you, facing your palm.
        </Banner>
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
                : 'Open and close all five fingers.'}
          </p>
          <ul className="hp-note">
            {stats.guidance.map((line) => (
              <li key={line}>
                {line === CAMERA_PLACEMENT_GUIDANCE
                  ? UPRIGHT_PLACEMENT_GUIDANCE
                  : line.includes('light, thin glove')
                    ? 'Improve the lighting. Keep your palm and all five fingers visible.'
                    : line.replace(/\bgloved hand\b/g, 'hand')}
              </li>
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
