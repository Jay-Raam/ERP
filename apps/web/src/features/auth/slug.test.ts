import { orgSlugSchema } from '@erp/shared';
import { describe, expect, it } from 'vitest';
import { suggestSlug } from './slug';

describe('suggestSlug', () => {
  it.each([
    ['Acme Traders', 'acme-traders'],
    ['  Acme   Traders Pvt. Ltd. ', 'acme-traders-pvt-ltd'],
    ['Café Déjà Vu', 'cafe-deja-vu'],
    ['M&S (Chennai) #2', 'm-s-chennai-2'],
    ['---', ''],
    ['', ''],
  ])('%s -> %s', (name, slug) => {
    expect(suggestSlug(name)).toBe(slug);
  });

  it('always suggests something the server accepts', () => {
    for (const name of ['Acme Traders', 'x'.repeat(200), 'A-B--C', 'श्री Traders 9']) {
      const slug = suggestSlug(name);
      if (slug.length >= 2) expect(orgSlugSchema.safeParse(slug).success, slug).toBe(true);
    }
  });
});
