/**
 * What to show a guest when a request failed. The query layer types a failure
 * as `unknown`, and a phone is the wrong place to render a stack.
 */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'the host did not answer';
