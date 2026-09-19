/**
 * Recognises the YouTube links the importer can actually fetch, so a link
 * copied while browsing lands in the box and anything else is ignored.
 */

/** A pasted link is a URL, not a document; anything longer is not one. */
const MAX_CHARS = 2048;

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

/** `/shorts/<id>`, `/live/<id>`, `/embed/<id>` — a video under another path. */
const VIDEO_PATH = /^\/(?:shorts|live|embed)\/[\w-]+$/;

/** `youtu.be/<id>` carries the video id as the whole path. */
const SHORT_LINK_PATH = /^\/[\w-]+$/;

/** Whether `url` names a video or a playlist rather than some other page. */
function isFetchable(url: URL): boolean {
  if (url.searchParams.has('v') || url.searchParams.has('list')) {
    return true;
  }

  if (url.hostname.toLowerCase() === 'youtu.be') {
    return SHORT_LINK_PATH.test(url.pathname);
  }

  return VIDEO_PATH.test(url.pathname);
}

/**
 * The link `text` holds, unchanged, when it is a YouTube video or playlist the
 * importer can read; `null` otherwise.
 *
 * The link is returned exactly as copied: query parameters decide what yt-dlp
 * fetches, so a playlist link must not be trimmed down to its video.
 */
export function extractYoutubeUrl(text: string): string | null {
  const candidate = text.trim();
  if (candidate.length === 0 || candidate.length > MAX_CHARS) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  if (!HOSTS.has(parsed.hostname.toLowerCase())) {
    return null;
  }

  return isFetchable(parsed) ? candidate : null;
}
