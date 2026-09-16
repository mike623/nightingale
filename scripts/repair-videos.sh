#!/usr/bin/env bash
# Convert library videos the playback webview cannot decode into cached
# H.264/AAC copies, leaving the originals untouched.
#
# WebKit decodes neither AV1 (outside recent Apple silicon) nor Opus in MP4 on
# any Mac, but Nightingale treats every .mp4 as directly playable. This walks
# the library, probes the real streams, and writes a playable copy to the
# cache path playback already prefers.
#
# Source files, songs.db, and every hash stay untouched, so cached analysis
# survives and the app may stay running.
#
#   scripts/repair-videos.sh              report what needs converting
#   scripts/repair-videos.sh --run        convert
#   scripts/repair-videos.sh --run --data-dir /srv/nightingale
#
# Re-runnable: finished conversions are skipped, so an interrupted run resumes.

set -euo pipefail

RUN=0
DATA_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --run) RUN=1 ;;
    --data-dir) DATA_DIR="${2:-}"; shift ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

die() { echo "error: $*" >&2; exit 1; }

# Mirrors cache.rs: config.json lives under the default root, and may point
# data, cache, and vendor somewhere else.
eval "$(DATA_DIR_OVERRIDE="$DATA_DIR" python3 - <<'PY'
import json, os, pathlib, shlex

override = os.environ.get("DATA_DIR_OVERRIDE") or ""
default_root = pathlib.Path(
    os.environ.get("NIGHTINGALE_DATA_PATH") or (pathlib.Path.home() / ".nightingale")
)

config = {}
config_file = default_root / "config.json"
if config_file.is_file():
    try:
        config = json.loads(config_file.read_text())
    except ValueError:
        config = {}

if override:
    root = pathlib.Path(override)
else:
    root = pathlib.Path(config.get("data_path") or default_root)

cache_paths = config.get("cache_paths") or {}
songs_cache = pathlib.Path(cache_paths.get("songs") or (root / "cache"))
vendor = pathlib.Path(cache_paths.get("vendor") or (root / "vendor"))

for name, value in (
    ("DB", root / "songs.db"),
    ("PLAYABLE_DIR", songs_cache / "playable_videos"),
    ("VENDOR_DIR", vendor),
):
    print(f"{name}={shlex.quote(str(value))}")
PY
)"

[ -f "$DB" ] || die "no library database at $DB"
command -v sqlite3 >/dev/null || die "sqlite3 not found"

FFMPEG="$(command -v "$VENDOR_DIR/ffmpeg" 2>/dev/null || command -v ffmpeg)" \
  || die "ffmpeg not found (looked in $VENDOR_DIR and \$PATH)"
FFPROBE="$(command -v "$VENDOR_DIR/ffprobe" 2>/dev/null || command -v ffprobe)" \
  || die "ffprobe not found (looked in $VENDOR_DIR and \$PATH) — install ffmpeg"

# Codecs the playback webview is known to decode. Everything else gets a copy.
stream_codec() {
  "$FFPROBE" -v error -select_streams "$1" -show_entries stream=codec_name \
    -of csv=p=0 -- "$2" 2>/dev/null | head -1
}

ok=0 remuxed=0 encoded=0 skipped=0 missing=0 failed=0 planned_remux=0 planned_encode=0

# sqlite3 emits one tab-separated row per song; file_hash is hex, so the tab
# split is unambiguous however the path is spelled.
while IFS=$'\t' read -r hash path; do
  [ -n "$hash" ] || continue

  if [ ! -f "$path" ]; then
    missing=$((missing + 1))
    continue
  fi

  target="$PLAYABLE_DIR/$hash.mp4"
  if [ -f "$target" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  vcodec="$(stream_codec v:0 "$path")"
  acodec="$(stream_codec a:0 "$path")"

  if [ "$vcodec" = "h264" ] && { [ "$acodec" = "aac" ] || [ -z "$acodec" ]; }; then
    ok=$((ok + 1))
    continue
  fi

  name="$(basename -- "$path")"

  if [ "$RUN" = 0 ]; then
    if [ "$vcodec" = "h264" ]; then
      planned_remux=$((planned_remux + 1))
      echo "audio  $name ($vcodec/$acodec)"
    else
      planned_encode=$((planned_encode + 1))
      echo "video  $name ($vcodec/$acodec)"
    fi
    continue
  fi

  mkdir -p "$PLAYABLE_DIR"
  tmp="$PLAYABLE_DIR/.$hash.$$.tmp.mp4"
  trap 'rm -f "$tmp"' EXIT

  if [ "$vcodec" = "h264" ]; then
    # Video already decodes; only the audio track needs replacing.
    echo "audio  $name"
    set +e
    "$FFMPEG" -v error -y -i "$path" \
      -c:v copy -c:a aac -b:a 160k -ac 2 -ar 48000 \
      -movflags +faststart -sn -dn "$tmp"
    status=$?
    set -e
  else
    # Matches convert_video_to_mp4 in app-core/src/playback.rs, plus a cap at
    # 1080p: 4K AV1 decodes in software on the machines that need this most.
    echo "video  $name"
    set +e
    "$FFMPEG" -v error -y -i "$path" \
      -vf "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2" \
      -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \
      -movflags +faststart -c:a aac -b:a 160k -ac 2 -ar 48000 -sn -dn "$tmp"
    status=$?
    set -e
  fi

  if [ "$status" != 0 ]; then
    rm -f "$tmp"
    failed=$((failed + 1))
    echo "  failed (ffmpeg exit $status)" >&2
    continue
  fi

  # Rename last, so an interrupted run never leaves a partial file that the
  # next run or the app would treat as a finished conversion.
  mv -f "$tmp" "$target"
  if [ "$vcodec" = "h264" ]; then
    remuxed=$((remuxed + 1))
  else
    encoded=$((encoded + 1))
  fi
done < <(sqlite3 -readonly -separator $'\t' "$DB" \
  'select file_hash, path from songs where is_video = 1;')

trap - EXIT

echo
if [ "$RUN" = 0 ]; then
  echo "dry run — nothing written"
  echo "  already playable:  $ok"
  echo "  already converted: $skipped"
  echo "  needs audio only:  $planned_remux"
  echo "  needs full encode: $planned_encode"
  [ "$missing" = 0 ] || echo "  source missing:    $missing"
  echo
  echo "re-run with --run to convert"
else
  echo "done"
  echo "  already playable:  $ok"
  echo "  already converted: $skipped"
  echo "  audio replaced:    $remuxed"
  echo "  video converted:   $encoded"
  [ "$missing" = 0 ] || echo "  source missing:    $missing"
  [ "$failed" = 0 ] || echo "  failed:            $failed"
fi

[ "$failed" = 0 ]
