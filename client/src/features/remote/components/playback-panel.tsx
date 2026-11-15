import { useMutation } from '@tanstack/react-query';
import { ShuffleIcon } from 'lucide-react';
import { useState } from 'react';

import { requestQueuePlayback } from '@/bridge/playback-status';
import { QueuePlaybackButtons } from '@/features/playback-queue/components/queue-playback-buttons';
import {
  useClearPlaybackQueue,
  usePlaybackQueueQuery,
} from '@/features/playback-queue/use-playback-queue';
import { MultiplayerSetupDialog } from '@/features/playback/components/dialogs/multiplayer-setup';
import { GuideSection } from '@/features/remote/components/guide-section';
import { NowPlaying } from '@/features/remote/components/now-playing';
import { OptionsSection } from '@/features/remote/components/options-section';
import { TransportSection } from '@/features/remote/components/transport-section';
import type { RemoteCommand, RemoteSnapshot } from '@/features/remote/lib/remote-model';
import { TOUCH_TARGET } from '@/features/remote/lib/touch-target';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/shared/components/ui/empty';
import { cn } from '@/shared/utils/cn';

type PlaybackPanelProps = {
  snapshot: RemoteSnapshot | null;
  positionMs: number;
  /** True while no command can reach a host, whatever the reason. */
  locked: boolean;
  send: (command: RemoteCommand) => void;
};

/**
 * Nothing is playing: start the room's queue (solo or with singers picked on
 * the phone), or let the host draw a song.
 */
const IdlePanel = ({ locked, send }: Pick<PlaybackPanelProps, 'locked' | 'send'>) => {
  const { data: entries = [] } = usePlaybackQueueQuery();
  const { mutate: startQueue, isLoading: starting } = useMutation({
    mutationFn: requestQueuePlayback,
  });
  const { mutate: clear, isLoading: clearing } = useClearPlaybackQueue();
  const [multiplayerOpen, setMultiplayerOpen] = useState(false);

  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{t('remote.lyrics.nothingPlaying')}</EmptyTitle>
        <EmptyDescription>{t('remote.playing.idleDescription')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="w-full gap-2">
        {entries.length > 0 && (
          <div className="flex w-full gap-2">
            <QueuePlaybackButtons
              label={t('remote.queue.play')}
              large
              disabled={locked || starting || clearing}
              preparing={starting}
              entries={entries.length}
              clearing={clearing}
              onPlay={() => startQueue([])}
              onPlayMultiplayer={() => setMultiplayerOpen(true)}
              onClear={() => clear()}
            />
          </div>
        )}
        <Button
          className={cn(TOUCH_TARGET, 'w-full')}
          disabled={locked}
          onClick={() => send({ action: 'start_random' })}
          type="button"
          variant="outline"
        >
          <ShuffleIcon />
          {t('remote.playback.playSomething')}
        </Button>
      </EmptyContent>
      <MultiplayerSetupDialog
        open={multiplayerOpen}
        onOpenChange={setMultiplayerOpen}
        onStart={startQueue}
        queuePlayback
        remote
      />
    </Empty>
  );
};

/** Everything that acts on the song the host is playing right now. */
export const PlaybackPanel = ({ snapshot, positionMs, locked, send }: PlaybackPanelProps) => {
  if (snapshot === null) {
    return <IdlePanel locked={locked} send={send} />;
  }

  return (
    <>
      <NowPlaying snapshot={snapshot} />
      <TransportSection disabled={locked} positionMs={positionMs} send={send} snapshot={snapshot} />
      <GuideSection disabled={locked} send={send} snapshot={snapshot} />
      <OptionsSection disabled={locked} send={send} snapshot={snapshot} />
    </>
  );
};
