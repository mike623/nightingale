/**
 * Every control on the phone page is sized for a fingertip rather than the
 * pointer-sized defaults the desktop surfaces use.
 */
export const TOUCH_TARGET = 'h-12 min-w-12 px-4 text-sm';

/**
 * Mobile Safari zooms the page in when a focused field's text is smaller than
 * 16px, and never zooms back out, so a phone field states its size at every
 * width rather than inheriting the desktop scale.
 */
export const TOUCH_FIELD = 'h-12 text-base md:text-base';
