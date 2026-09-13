#!/usr/bin/env bash
# Upload Nightingale instrumental ("devoiced") tracks to a private YouTube playlist.
#
# One-off operator tool, not part of the app. Reads the library DB and the stem
# cache directly, muxes cover art + instrumental into an mp4 (YouTube rejects
# bare audio), uploads it as `private`, and files it into one private playlist.
#
# Quota is the binding constraint: videos.insert costs ~1600 units against a
# default 10,000 units/day project quota, so roughly 6 uploads/day. The script
# stops at MAX_UPLOADS per run and aborts cleanly on a quotaExceeded response.
# State lives in a manifest so the next run picks up where this one stopped.
#
# Usage:
#   yt-sync.sh auth              one-time OAuth, stores a refresh token
#   yt-sync.sh list              show what would be uploaded
#   yt-sync.sh check             render one mp4 to /tmp and stop (no upload)
#   yt-sync.sh playlists         show your playlists and which one is pinned
#   yt-sync.sh playlist <id|->    pin an existing playlist ("-" clears the pin)
#   yt-sync.sh sync [N]          upload up to N (default 5) pending tracks
set -euo pipefail

DATA_DIR="${NIGHTINGALE_DATA:-$HOME/.nightingale/data}"
DB="$DATA_DIR/songs.db"
CACHE="$DATA_DIR/cache"
STATE="${YT_SYNC_STATE:-$HOME/.nightingale/yt-sync.json}"
PLAYLIST_TITLE="${YT_SYNC_PLAYLIST:-Nightingale Karaoke}"
FALLBACK_COVER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/client/src/assets/images/logo.png"
MAX_UPLOADS="${2:-5}"
FFMPEG="$(command -v "$DATA_DIR/vendor/ffmpeg" 2>/dev/null || command -v ffmpeg)"

die() { echo "error: $*" >&2; exit 1; }
state_get() { jq -r "$1" "$STATE" 2>/dev/null || echo ""; }

init_state() {
  [ -f "$STATE" ] || { echo '{"videos":{}}' > "$STATE"; chmod 600 "$STATE"; }
}

# --- auth -------------------------------------------------------------------
# Loopback OAuth for a "Desktop app" client. Google retired the OOB flow, so we
# catch the redirect on 127.0.0.1 with nc. Run once; the refresh token persists.
cmd_auth() {
  init_state
  read -rp "Google OAuth client ID: " CID
  read -rsp "Client secret: " CSEC; echo
  local port=8723 redirect="http://127.0.0.1:8723"
  local scope="https://www.googleapis.com/auth/youtube"
  echo
  echo "Open this URL, approve, then come back:"
  echo "https://accounts.google.com/o/oauth2/v2/auth?client_id=$CID&redirect_uri=$redirect&response_type=code&scope=$scope&access_type=offline&prompt=consent"
  echo
  echo "Waiting for redirect on $redirect ..."
  local req
  req=$(printf 'HTTP/1.1 200 OK\r\nContent-Length: 24\r\nConnection: close\r\n\r\nDone. Back to terminal.' | nc -l "$port" | head -1)
  # Param order is not guaranteed (Google often sends ?scope=...&code=...), so
  # pick the param out by key. The value stays percent-encoded: query-string and
  # form-body encoding are the same rules, so curl can post it verbatim. Encoding
  # it a second time yields %252F and "invalid_grant: Malformed auth code".
  local query="${req#GET }"; query="${query%% *}"; query="${query#*\?}"
  local code
  code=$(awk -F'&' '{for(i=1;i<=NF;i++) if ($i ~ /^code=/) {sub(/^code=/,"",$i); print $i; exit}}' <<<"$query")
  [ -n "$code" ] || die "no auth code in redirect: ${req:-<no request received>}"

  local resp
  resp=$(curl -s -X POST https://oauth2.googleapis.com/token \
    -d "code=$code" \
    -d "client_id=$CID" -d "client_secret=$CSEC" \
    -d "redirect_uri=$redirect" -d "grant_type=authorization_code")
  local refresh; refresh=$(jq -r '.refresh_token // empty' <<<"$resp")
  [ -n "$refresh" ] || die "token exchange failed: $resp"

  jq --arg c "$CID" --arg s "$CSEC" --arg r "$refresh" \
     '.client_id=$c | .client_secret=$s | .refresh_token=$r' "$STATE" > "$STATE.tmp"
  mv "$STATE.tmp" "$STATE"; chmod 600 "$STATE"
  echo "Stored refresh token in $STATE"
}

access_token() {
  local cid csec refresh resp
  cid=$(state_get '.client_id'); csec=$(state_get '.client_secret'); refresh=$(state_get '.refresh_token')
  [ -n "$refresh" ] && [ "$refresh" != "null" ] || die "not authorized — run: $0 auth"
  resp=$(curl -s -X POST https://oauth2.googleapis.com/token \
    -d "client_id=$cid" -d "client_secret=$csec" \
    -d "refresh_token=$refresh" -d "grant_type=refresh_token")
  jq -r '.access_token // empty' <<<"$resp" | grep . || die "token refresh failed: $resp"
}

# --- library ----------------------------------------------------------------
# One row per analyzed song that has an instrumental stem on disk and is not
# already in the manifest. TSV: hash <TAB> artist <TAB> title <TAB> cover
pending() {
  local synced; synced=$(jq -r '.videos | keys[]' "$STATE" 2>/dev/null || true)
  sqlite3 "file:$DB?mode=ro" -json \
    "select file_hash, artist, title, coalesce(album_art_path,'') art
     from songs where is_analyzed=1 order by artist, title;" |
  jq -r '.[] | [.file_hash, .artist, .title, .art] | @tsv' |
  while IFS=$'\t' read -r hash artist title art; do
    grep -qxF "$hash" <<<"$synced" && continue
    # Stems are written per key/tempo variant; 1.0 is the untransposed render.
    local stem
    stem=$(ls "$CACHE/${hash}_instrumental_"*_1.0.mp3 2>/dev/null | head -1) || true
    [ -n "$stem" ] || continue
    printf '%s\t%s\t%s\t%s\t%s\n' "$hash" "$artist" "$title" "$art" "$stem"
  done
}

# --- render -----------------------------------------------------------------
# YouTube needs a video track. Still cover + audio, cheapest encode that plays.
render() {
  local stem="$1" cover="$2" out="$3"
  [ -f "$cover" ] || cover="$FALLBACK_COVER"
  # -nostdin: sync() feeds the song list into the loop on stdin, and ffmpeg would
  # otherwise read it as interactive commands and eat the next track.
  "$FFMPEG" -nostdin -y -loglevel error \
    -loop 1 -framerate 2 -i "$cover" -i "$stem" \
    -c:v libx264 -tune stillimage -pix_fmt yuv420p -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1" \
    -c:a aac -b:a 192k -shortest "$out"
}

# --- youtube ----------------------------------------------------------------
cmd_playlists() {
  init_state
  local tok pinned; tok=$(access_token); pinned=$(state_get '.playlist_id')
  curl -s "https://www.googleapis.com/youtube/v3/playlists?part=snippet,status&mine=true&maxResults=50" \
    -H "Authorization: Bearer $tok" |
    jq -r --arg p "$pinned" '.items[] | "\(if .id==$p then "* " else "  " end)\(.id)  [\(.status.privacyStatus)]  \(.snippet.title)"'
  echo "---"
  [ -n "$pinned" ] && [ "$pinned" != "null" ] \
    && echo "pinned: $pinned" \
    || echo "none pinned — sync will create \"$PLAYLIST_TITLE\" (private)"
}

cmd_playlist() {
  init_state
  local id="${2:-}"
  [ -n "$id" ] || die "usage: $0 playlist <playlistId|->"
  if [ "$id" = "-" ]; then
    jq 'del(.playlist_id)' "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
    echo "pin cleared — next sync creates \"$PLAYLIST_TITLE\""
  else
    jq --arg i "$id" '.playlist_id=$i' "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
    echo "pinned $id"
  fi
}

ensure_playlist() {
  local tok="$1" id
  id=$(state_get '.playlist_id')
  if [ -n "$id" ] && [ "$id" != "null" ]; then echo "$id"; return; fi
  local resp
  resp=$(curl -s -X POST "https://www.googleapis.com/youtube/v3/playlists?part=snippet,status" \
    -H "Authorization: Bearer $tok" -H "Content-Type: application/json" \
    -d "$(jq -n --arg t "$PLAYLIST_TITLE" \
          '{snippet:{title:$t,description:"Instrumentals rendered by Nightingale."},status:{privacyStatus:"private"}}')")
  id=$(jq -r '.id // empty' <<<"$resp")
  [ -n "$id" ] || die "playlist create failed: $resp"
  jq --arg i "$id" '.playlist_id=$i' "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
  echo "$id"
}

# Resumable upload: POST metadata, then PUT the bytes at the returned Location.
# Two plain curl calls — simpler here than hand-rolling multipart/related.
upload() {
  local tok="$1" file="$2" name="$3" meta location resp
  meta=$(jq -n --arg t "${name:0:100}" \
    '{snippet:{title:$t,description:"Instrumental generated locally by Nightingale.",categoryId:"10"},status:{privacyStatus:"private",selfDeclaredMadeForKids:false}}')
  location=$(curl -s -D - -o /dev/null \
    -X POST "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status" \
    -H "Authorization: Bearer $tok" -H "Content-Type: application/json; charset=UTF-8" \
    -H "X-Upload-Content-Type: video/mp4" -H "X-Upload-Content-Length: $(wc -c <"$file")" \
    -d "$meta" | tr -d '\r' | awk '/^[Ll]ocation:/ {print $2}')
  [ -n "$location" ] || { echo "INIT_FAILED" >&2; return 1; }
  resp=$(curl -s -X PUT "$location" -H "Content-Type: video/mp4" --data-binary "@$file")
  if jq -e '.error.errors[]? | select(.reason=="quotaExceeded")' <<<"$resp" >/dev/null 2>&1; then
    echo "QUOTA" >&2; return 2
  fi
  jq -r '.id // empty' <<<"$resp" | grep . || { echo "$resp" >&2; return 1; }
}

add_to_playlist() {
  local tok="$1" playlist="$2" video="$3"
  curl -s -o /dev/null -X POST "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet" \
    -H "Authorization: Bearer $tok" -H "Content-Type: application/json" \
    -d "$(jq -n --arg p "$playlist" --arg v "$video" \
          '{snippet:{playlistId:$p,resourceId:{kind:"youtube#video",videoId:$v}}}')"
}

record() {
  jq --arg h "$1" --arg v "$2" '.videos[$h]=$v' "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
}

# --- commands ---------------------------------------------------------------
cmd_list() {
  init_state
  local all; all=$(pending)
  [ -n "$all" ] || { echo "nothing pending"; return; }
  awk -F'\t' '{printf "%s — %s\n", $2, $3}' <<<"$all"
  echo "---"
  echo "$(wc -l <<<"$all" | tr -d ' ') pending, $(jq -r '.videos|length' "$STATE") already synced"
}

cmd_check() {
  init_state
  # No `| head -1` here: pipefail turns the SIGPIPE into a silent 141 exit.
  local line; line=$(pending); line=${line%%$'\n'*}
  [ -n "$line" ] || die "nothing pending"
  IFS=$'\t' read -r hash artist title art stem <<<"$line"
  local out="/tmp/yt-sync-check.mp4"
  render "$stem" "$art" "$out"
  [ -s "$out" ] || die "render produced no output"
  echo "OK: $artist — $title"
  # ffmpeg with no output file always exits 1; the probe is informational.
  { "$FFMPEG" -nostdin -hide_banner -i "$out" 2>&1 || true; } | grep -E 'Duration|Stream'
  echo "wrote $out"
}

cmd_sync() {
  init_state
  local tok playlist n=0
  tok=$(access_token)
  playlist=$(ensure_playlist "$tok")
  local tmp; tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

  while IFS=$'\t' read -r hash artist title art stem; do
    [ "$n" -lt "$MAX_UPLOADS" ] || { echo "stopping at $MAX_UPLOADS uploads (quota)"; break; }
    echo "[$((n+1))/$MAX_UPLOADS] $artist — $title"
    local mp4="$tmp/$hash.mp4"
    render "$stem" "$art" "$mp4"
    local vid rc=0
    vid=$(upload "$tok" "$mp4" "$artist - $title (Instrumental)") || rc=$?
    if [ "$rc" = 2 ]; then echo "daily quota exhausted — rerun tomorrow"; break; fi
    [ "$rc" = 0 ] || { echo "  upload failed, skipping"; rm -f "$mp4"; continue; }
    add_to_playlist "$tok" "$playlist" "$vid"
    record "$hash" "$vid"
    rm -f "$mp4"
    echo "  https://youtu.be/$vid"
    n=$((n+1))
  done < <(pending)
  echo "done: $n uploaded"
}

case "${1:-}" in
  auth)      cmd_auth ;;
  playlists) cmd_playlists ;;
  playlist)  cmd_playlist "$@" ;;
  list)      cmd_list ;;
  check)     cmd_check ;;
  sync)      cmd_sync ;;
  *) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
