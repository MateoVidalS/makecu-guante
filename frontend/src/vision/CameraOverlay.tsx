import { useEffect, useRef, useState } from 'react';
import type { FingerId, VisionFrame, VisionSource } from '../contracts/vision';
import { tokens } from '../styles/tokens';
import { useVision } from './VisionProvider';
import { FINGERS } from './flex';
import {
  drawOverlay,
  handInsideGuide,
  simulatedLandmarks,
  type FingerState,
} from './overlay';
import './cameraOverlay.css';

export interface CameraOverlayProps {
  source?: VisionSource;
  compact?: boolean;
  mirrored?: boolean;
  /** Video and skeleton only: no framing guide and no finger read-out. Fills its container. */
  bare?: boolean;
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
/** Simulated frames carry joints but no landmarks; sketch them so the panel still reads. */
function drawable(
  frame: VisionFrame | null,
  kind: VisionSource['kind'],
): VisionFrame | null {
  if (kind !== 'sim' || !frame?.detected || frame.landmarks || !frame.joints)
    return frame;
  return {
    ...frame,
    landmarks: simulatedLandmarks(frame.joints, frame.handedness),
  };
}
function SourceOverlay({
  source,
  compact = false,
  mirrored = false,
  bare = false,
  state,
}: CameraOverlayProps & { source: VisionSource }) {
  const preview = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState<VisionFrame | null>(() => source.latest());
  const [hasVideo, setHasVideo] = useState(() => !!source.videoElement());
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
        setHasVideo(!!video);
      }
      if (canvas.current) {
        const width = video?.videoWidth || 640,
          height = video?.videoHeight || 480;
        // Resizing a canvas clears it; only do it when the size really changes.
        if (canvas.current.width !== width) canvas.current.width = width;
        if (canvas.current.height !== height) canvas.current.height = height;
        drawOverlay(canvas.current, drawable(latest, source.kind), state);
      }
    };
    update(source.latest());
    const unsubscribe = source.onFrame(update);
    return () => {
      unsubscribe();
      if (video?.parentElement === host) video?.remove();
    };
  }, [source, state]);
  const confidence = frame?.detected
    ? `Hand detected ${Math.round(frame.confidence * 100)}%`
    : 'Hand not visible';
  return (
    <figure
      className={[
        'camera-overlay',
        compact && 'camera-overlay--compact',
        bare && 'camera-overlay--bare',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          '--vision-skeleton': tokens.light.surface,
          '--vision-backdrop': tokens.light.text,
        } as React.CSSProperties
      }
      aria-label="Hand camera preview"
      data-detected={!!frame?.detected}
    >
      <div
        className={`camera-overlay__preview${mirrored ? ' camera-overlay__preview--mirrored' : ''}`}
        ref={preview}
      >
        <canvas ref={canvas} aria-hidden="true" />
        {!bare && (
          <div
            className={`camera-overlay__guide${handInsideGuide(frame) ? ' camera-overlay__guide--seen' : ''}`}
            aria-hidden="true"
          />
        )}
        {!hasVideo && (
          <span className="camera-overlay__placeholder">
            {source.kind === 'sim' ? 'Simulated camera' : 'Camera preview'}
          </span>
        )}
      </div>
      <span className="camera-overlay__confidence" role="status">
        {confidence}
      </span>
      {!bare && (
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
      )}
    </figure>
  );
}
