/** Apostrophes sit inside a word, so removing them keeps `Don't` in one piece. */
const WORD_INNER_MARKS = /['’ʼ]/gu;

/** Every other punctuation or symbol separates words: `Title(Live)` is two. */
const WORD_SEPARATOR_MARKS = /[\p{P}\p{S}]/gu;

/**
 * Words of a title or artist name, offered as one-click replacements. An
 * imported name — especially a raw YouTube video title — usually carries the
 * real track or artist plus noise, so picking one word beats retyping the
 * whole value. Punctuation is dropped from the chips while the value it came
 * from keeps whatever the user or the import wrote. A single-word value has
 * nothing to narrow down.
 */
export function wordChips(value: string): string[] {
  const words = value
    .replaceAll(WORD_INNER_MARKS, '')
    .replaceAll(WORD_SEPARATOR_MARKS, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);

  const unique = Array.from(new Set(words));
  return unique.length > 1 ? unique : [];
}
