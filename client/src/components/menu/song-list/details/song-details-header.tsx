import { Button } from "@/components/ui/button";
import { Stars } from "@/components/shared/stars";
import { useBestScoresBySongForActiveProfile } from "@/hooks/use-best-scores-by-song";
import type { QueuedStatus } from "@/types/QueuedStatus";
import type { Song } from "@/types/Song";
import { XIcon } from "lucide-react";
import { formatSeconds } from "@/utils/format-duration";
import { AlbumArt } from "../shared/album-art";
import { LanguageBadge, isDisplayableLanguage } from "../shared/language-badge";
import { StatusBadge } from "../shared/status-badge";

interface SongDetailsHeaderProps {
  song: Song;
  queueStatus?: QueuedStatus;
  onClose: () => void;
}

export const SongDetailsHeader = ({ song, queueStatus, onClose }: SongDetailsHeaderProps) => {
  const bestScore = useBestScoresBySongForActiveProfile().get(song.file_hash);

  return (
    <header className="relative border-b px-4 pb-4 pt-3">
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute right-2 top-2"
        onClick={onClose}
        aria-label="Close song details"
      >
        <XIcon />
      </Button>

      <div className="flex items-center gap-3 pr-8">
        <AlbumArt
          song={song}
          className="size-16 rounded-lg"
          fallbackIconClassName="size-6"
          lazy={false}
        />

        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 text-sm font-semibold leading-snug text-balance">
            {song.title}
          </h2>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {song.artist || "Unknown band"}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {song.album || "Unknown album"}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <StatusBadge song={song} queueStatus={queueStatus} />
        {isDisplayableLanguage(song.language) ? (
          <>
            <span aria-hidden="true">·</span>
            <LanguageBadge language={song.language} />
          </>
        ) : null}
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{formatSeconds(song.duration_secs)}</span>
      </div>

      {bestScore != null && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span>Best score</span>
          <Stars score={bestScore} size="sm" />
          <span className="tabular-nums text-foreground">{bestScore}</span>
        </div>
      )}
    </header>
  );
};
