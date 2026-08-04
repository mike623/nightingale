import { useProfiles } from "@/queries/use-profiles";
import { useMemo } from "react";

/**
 * Map of song hash → the active profile's most recent score (by `played_at`).
 * Mirrors {@link useBestScoresBySongForActiveProfile} but keeps the last score
 * rather than the best.
 */
export function useLastScoresBySongForActiveProfile(): Map<string, number> {
  const { data } = useProfiles();
  const active = data?.active;
  const scores = data?.scores ?? [];

  return useMemo(() => {
    const latest = new Map<string, { score: number; playedAt: bigint }>();
    if (!active) {
      return new Map<string, number>();
    }

    for (const r of scores) {
      if (r.profile !== active) {
        continue;
      }
      const cur = latest.get(r.song_hash);
      if (!cur || r.played_at > cur.playedAt) {
        latest.set(r.song_hash, { score: r.score, playedAt: r.played_at });
      }
    }

    return new Map([...latest].map(([hash, v]) => [hash, v.score]));
  }, [scores, active]);
}
