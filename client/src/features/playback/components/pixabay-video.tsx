import { usePixabaySlots } from '@/features/playback/hooks/use-pixabay-slots';
import type { VideoFlavor } from '@/features/playback/lib/video-flavor';
import { AMBIENT_VIDEO_CLASS_NAME } from '@/features/playback/lib/video-styles';

type PixabayVideoProps = {
  flavor: VideoFlavor;
  isPlaying: boolean;
};

export const PixabayVideo = ({ flavor, isPlaying }: PixabayVideoProps) => {
  const { slots, onActiveEnded } = usePixabaySlots(flavor, isPlaying);

  return (
    <>
      {slots.map((slot) => (
        <video
          key={slot.id}
          ref={slot.ref}
          className={AMBIENT_VIDEO_CLASS_NAME}
          style={{ visibility: slot.isActive ? 'visible' : 'hidden' }}
          src={slot.src || undefined}
          preload="auto"
          muted
          playsInline
          onEnded={slot.isActive ? onActiveEnded : undefined}
          onError={slot.isActive ? onActiveEnded : undefined}
        />
      ))}
    </>
  );
};
