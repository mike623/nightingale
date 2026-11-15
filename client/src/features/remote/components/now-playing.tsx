import type { RemoteSnapshot } from '@/features/remote/lib/remote-model';
import { t } from '@/i18n';

export const NowPlaying = ({ snapshot }: { snapshot: RemoteSnapshot }) => {
  const song = snapshot.song;

  return (
    <section aria-label={t('remote.playing.nowPlaying')} className="space-y-1">
      <h1 className="text-xl leading-tight font-semibold">
        {song?.title ?? t('remote.lyrics.nothingPlaying')}
      </h1>
      {song !== null && <p className="text-sm text-muted-foreground">{song.artist}</p>}
      <p className="text-sm tabular-nums">
        {t('remote.playing.score', { score: Math.round(snapshot.score) })}
      </p>
    </section>
  );
};
