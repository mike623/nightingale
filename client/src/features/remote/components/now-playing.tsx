import type { RemoteSnapshot } from '@/bridge/remote';

export const NowPlaying = ({ snapshot }: { snapshot: RemoteSnapshot }) => {
  const song = snapshot.song;

  return (
    <section aria-label="Now playing" className="space-y-1">
      <h1 className="text-xl leading-tight font-semibold">{song?.title ?? 'Nothing playing'}</h1>
      {song !== null && <p className="text-sm text-muted-foreground">{song.artist}</p>}
      <p className="text-sm tabular-nums">Score {Math.round(snapshot.score)}</p>
    </section>
  );
};
