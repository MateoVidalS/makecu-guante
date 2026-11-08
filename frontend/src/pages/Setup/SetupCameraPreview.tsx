import { useEffect, useRef } from 'react';
import { useVision } from '../../vision';
import { CameraOverlay } from '../../vision/CameraOverlay';

/** The source creates its video before loading hand tracking. Mount that owned
 * element early; CameraOverlay takes over on its first frame. */
export function SetupCameraPreview({
  mirrored,
  onVideoReady,
}: {
  mirrored: boolean;
  onVideoReady?: (ready: boolean) => void;
}) {
  const { source } = useVision();
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onVideoReady?.(false);
    if (source.kind !== 'camera') return;
    let attached: HTMLVideoElement | null = null;
    const timer = setInterval(() => {
      const video = source.videoElement();
      if (
        attached &&
        attached !== video &&
        container.current?.contains(attached)
      )
        attached.remove();
      onVideoReady?.(!!video);
      const host = container.current?.querySelector('.camera-overlay__preview');
      if (video && host && !video.parentElement) {
        host.prepend(video);
        attached = video;
      }
    }, 100);
    const root = container.current;
    return () => {
      clearInterval(timer);
      if (attached && root?.contains(attached)) attached.remove();
    };
  }, [source, onVideoReady]);
  return (
    <div ref={container}>
      <CameraOverlay mirrored={mirrored} />
    </div>
  );
}
