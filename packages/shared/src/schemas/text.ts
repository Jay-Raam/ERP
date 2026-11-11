import { z } from 'zod';

// C0/C1 control characters, plus zero-width and bidi-override characters that
// can make stored text render as something other than what was typed.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

/** Trim, normalise Unicode, drop invisible characters, collapse runs of whitespace. */
export function cleanText(value: string): string {
  return value.normalize('NFC').replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * A single-line plain-text field (names, titles, codes).
 * Markup is rejected, not silently stripped, so what the user typed is what
 * is stored. Output escaping in React remains the XSS control; this keeps
 * markup out of exports, emails and PDFs as well.
 */
export function plainText(label: string, min: number, max: number) {
  return z
    .string()
    .transform(cleanText)
    .pipe(
      z
        .string()
        .min(1, `${label} is required`)
        .min(min, `${label} must be at least ${min} characters`)
        .max(max, `${label} must be at most ${max} characters`)
        .regex(/^[^<>]*$/, `${label} cannot contain < or >`),
    );
}
