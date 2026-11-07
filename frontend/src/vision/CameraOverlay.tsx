import { useEffect, useRef, useState } from 'react';
import type { FingerId, VisionFrame, VisionSource } from '../contracts/vision';
import { tokens } from '../styles/tokens';
import { useVision } from './VisionProvider';
import { FINGERS } from './flex';
import { drawOverlay, handInsideGuide, type FingerState } from './overlay';
import './cameraOverlay.css';

export interface CameraOverlayProps {
  source?: VisionSource;
  compact?: boolean;
  mirrored?: boolean;
  state?: (finger: FingerId) => FingerState;
}
/** With no source prop, follows the provider. Explicit sources also work without a provider. */
export function CameraOverlay(props: CameraOverlayProps) {
  return props.source ? (
    <SourceOverlay {...props} source={props.source} />
  ) : (
    <ConnectedOverlay {...props} />
  );
}
function ConnectedOverlay(props: CameraOverlayProps) {
  return <SourceOverlay {...props} source={useVision().source} />;
}
function SourceOverlay({
  source,
  compact = false,
  mirrored = false,
  state,
}: CameraOverlayProps & { source: VisionSource }) {
  const preview = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState<VisionFrame | null>(() => source.latest());
  useEffect(() => {
    const host = preview.current;
    let video: HTMLVideoElement | null = null;
    const update = (latest: VisionFrame | null) => {
      setFrame(latest);
      const currentVideo = source.videoElement();
      if (currentVideo !== video) {
        if (video?.parentElement === host) video.remove();
        video = currentVideo;
        if (video && host) host.prepend(video);
      }
      if (canvas.current) {
        canvas.current.width = video?.videoWidth || 640;
        canvas.current.height = video?.videoHeight || 480;
        drawOverlay(canvas.current, latest, state);
      }
    };
    update(source.latest());
    const unsubscribe = source.onFrame(update);
    return () => {
      unsubscribe();
      if (video?.parentElement === host) video?.remove();
    };
  }, [source, state]);
  return (
    <figure
      className={`camera-overlay${compact ? ' camera-overlay--compact' : ''}`}
      style={
        {
          '--vision-skeleton': tokens.light.surface,
          '--vision-outline': tokens.light.text,
        } as React.CSSProperties
      }
      aria-label="Hand camera preview"
    >
      <div
        className={`camera-overlay__preview${mirrored ? ' camera-overlay__preview--mirrored' : ''}`}
        ref={preview}
      >
        <canvas ref={canvas} aria-hidden="true" />
        <div
          className={`camera-overlay__guide${handInsideGuide(frame) ? ' camera-overlay__guide--seen' : ''}`}
          aria-hidden="true"
        />
        {!source.videoElement() && (
          <span className="camera-overlay__placeholder">
            {source.kind === 'sim' ? 'Simulated camera' : 'Camera preview'}
          </span>
        )}
      </div>
      <span className="camera-overlay__confidence" role="status">
        {frame?.detected
          ? `Sees hand ${Math.round(frame.confidence * 100)}%`
          : 'Hand not visible'}
      </span>
      <figcaption>
        <dl className="camera-overlay__fingers">
          {FINGERS.map((finger) => (
            <div key={finger}>
              <dt>{finger[0].toUpperCase() + finger.slice(1)}</dt>
              <dd>
                {frame?.closure
                  ? `${Math.round(frame.closure[finger] * 100)}%`
                  : '—'}
              </dd>
            </div>
          ))}
        </dl>
        {!frame?.detected && <p>Move your hand into the frame.</p>}
        {frame?.detected && !frame.closure && (
          <p>Calibrate to see finger percentages.</p>
        )}
      </figcaption>
    </figure>
  );
}
