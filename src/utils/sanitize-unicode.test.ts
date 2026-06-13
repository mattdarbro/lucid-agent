import { describe, it, expect } from 'vitest';
import { stripLoneSurrogates } from './sanitize-unicode';

describe('stripLoneSurrogates', () => {
  it('leaves plain text untouched', () => {
    expect(stripLoneSurrogates('hello world')).toBe('hello world');
  });

  it('preserves valid surrogate pairs (emoji)', () => {
    const emoji = '👍 nice 🎉';
    expect(stripLoneSurrogates(emoji)).toBe(emoji);
  });

  it('removes a lone high surrogate left by truncating an emoji', () => {
    // '😀' is U+1F600 = '😀'. Slicing off the low half leaves '\uD83D'.
    const truncated = 'I feel \uD83D';
    expect(stripLoneSurrogates(truncated)).toBe('I feel ');
    // And the result must be valid JSON that round-trips.
    expect(() => JSON.parse(JSON.stringify(stripLoneSurrogates(truncated)))).not.toThrow();
  });

  it('removes a lone low surrogate', () => {
    expect(stripLoneSurrogates('\uDE00tail')).toBe('tail');
  });

  it('removes lone surrogates but keeps adjacent valid pairs', () => {
    // valid pair + lone high + valid pair
    const mixed = '😀\uD83D🎉';
    expect(stripLoneSurrogates(mixed)).toBe('😀🎉');
  });

  it('handles empty and falsy input', () => {
    expect(stripLoneSurrogates('')).toBe('');
  });

  it('reproduces the Anthropic "no low surrogate" rejection cause', () => {
    // JSON.stringify emits a lone surrogate as an escape that strict parsers reject.
    const bad = 'x'.repeat(10) + '\uD83D';
    // The raw escaped form contains the dangling \ud83d ...
    expect(JSON.stringify(bad)).toContain('\\ud83d');
    // ... and after sanitizing it's gone.
    expect(JSON.stringify(stripLoneSurrogates(bad))).not.toContain('\\ud83d');
  });
});
