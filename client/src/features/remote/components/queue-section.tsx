import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVerticalIcon, Trash2Icon } from 'lucide-react';

import type { PlaybackQueueEntry } from '@/bridge/playback-queue';
import {
  useMovePlaybackQueueEntry,
  usePlaybackQueueQuery,
  useRemovePlaybackQueueEntry,
} from '@/features/playback-queue/use-playback-queue';
import { errorMessage } from '@/features/remote/lib/error-message';
import { TOUCH_TARGET } from '@/features/remote/lib/touch-target';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/components/ui/empty';
import { Spinner } from '@/shared/components/ui/spinner';
import { cn } from '@/shared/utils/cn';
import { formatSeconds } from '@/shared/utils/format-duration';

/** A drag starts only after the finger has travelled, so a tap still taps. */
const DRAG_START_DISTANCE_PX = 8;

type QueueRowProps = {
  entry: PlaybackQueueEntry;
  position: number;
  onRemove: (id: string) => void;
  removing: boolean;
};

const QueueRow = ({ entry, position, onRemove, removing }: QueueRowProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
  });

  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded-md border bg-background p-2',
        isDragging && 'opacity-80 shadow-lg',
      )}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        aria-label={t('remote.queue.moveLabel', { title: entry.song.title })}
        className={cn(
          TOUCH_TARGET,
          'flex touch-none items-center justify-center rounded-md px-2 text-muted-foreground',
        )}
        type="button"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon />
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {position}. {entry.song.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {entry.song.artist} · {formatSeconds(entry.song.duration_secs)}
        </p>
      </div>

      <Button
        aria-label={t('remote.queue.removeLabel', { title: entry.song.title })}
        className={cn(TOUCH_TARGET, 'shrink-0')}
        disabled={removing}
        onClick={() => onRemove(entry.id)}
        type="button"
        variant="ghost"
      >
        <Trash2Icon />
      </Button>
    </li>
  );
};

/**
 * The queue everyone in the room shares. Order is the queue's whole meaning,
 * so it is draggable by a grip rather than by the row: the list itself still
 * scrolls under a finger, and the same grip reorders from the keyboard.
 */
export const QueueSection = () => {
  const { data, isLoading, error } = usePlaybackQueueQuery();
  const { mutate: reorder } = useMovePlaybackQueueEntry();
  const { mutate: remove, isLoading: removing } = useRemovePlaybackQueueEntry();

  const entries = data ?? [];
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_START_DISTANCE_PX } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent): void => {
    if (over === null || active.id === over.id) {
      return;
    }

    const toIndex = entries.findIndex((entry) => entry.id === over.id);

    if (toIndex === -1) {
      return;
    }

    reorder({ id: String(active.id), targetIndex: toIndex });
  };

  if (isLoading) {
    return (
      <output aria-live="polite" className="flex justify-center py-6">
        <Spinner />
      </output>
    );
  }

  if (error !== null) {
    return (
      <p aria-live="polite" className="text-sm text-destructive">
        {t('remote.queue.loadError', { error: errorMessage(error) })}
      </p>
    );
  }

  if (entries.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('remote.queue.empty')}</EmptyTitle>
          <EmptyDescription>{t('remote.queue.emptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <section aria-label={t('remote.tabs.queue')} className="min-w-0">
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd} sensors={sensors}>
        <SortableContext
          items={entries.map((entry) => entry.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-2">
            {entries.map((entry, index) => (
              <QueueRow
                entry={entry}
                key={entry.id}
                onRemove={remove}
                position={index + 1}
                removing={removing}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  );
};
