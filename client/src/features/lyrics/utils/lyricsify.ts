const LYRICSIFY_HOME = 'https://www.lyricsify.com/';

/** The site's own search form: `GET /search?q=<terms>`. */
const searchUrl = (terms: string): string =>
  terms.length === 0 ? LYRICSIFY_HOME : `${LYRICSIFY_HOME}search?q=${encodeURIComponent(terms)}`;

/** Search URL for a song, falling back to the site home when nothing is known. */
export const lyricsifySearchUrl = (track: string, artist: string): string =>
  searchUrl(
    [artist, track]
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(' '),
  );
