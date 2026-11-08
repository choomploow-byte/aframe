import { describe, expect, it } from 'vitest';
import { CoreError } from '../errors';
import { buildDoc, deepFreeze } from '../testing';
import { createTemplateDoc, TEMPLATES } from '../templates';
import type { Doc } from '../types';
import { exportDesign, EXPORT_FORMATS, type ExportFormat } from './index';
import { utilitiesFor } from './tailwind';
import { kebab, pascal, uniqueNames } from './names';

const FORMATS: ExportFormat[] = EXPORT_FORMATS.map((f) => f.id);
const text = (f: { content: string | Uint8Array }): string =>
  typeof f.content === 'string' ? f.content : '';
const file = (files: { path: string; content: string | Uint8Array }[], path: string): string => {
  const found = files.find((f) => f.path === path);
  if (!found) throw new Error(`missing ${path}: ${files.map((f) => f.path).join(', ')}`);
  return text(found);
};

/** A 1x1 transparent PNG as a data URL. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function design(): Doc {
  const doc = buildDoc([
    {
      id: 'n_screen',
      type: 'frame',
      name: 'Landing Page',
      layout: 'column',
      w: 600,
      gap: 12,
      padding: [24, 24, 24, 24],
      fill: '$primary',
      children: [
        {
          id: 'n_h',
          type: 'text',
          name: 'Title',
          text: 'Hello <world> & "friends"',
          role: 'heading',
          fontSize: 32,
        },
        { id: 'n_h2', type: 'text', name: 'Subtitle', text: 'Sub', role: 'heading', fontSize: 20 },
        { id: 'n_p', type: 'text', name: 'Body', text: 'Plain text', fontSize: 16 },
        {
          id: 'n_btn',
          type: 'frame',
          name: 'Button',
          role: 'button',
          layout: 'row',
          children: [{ id: 'n_bt', type: 'text', name: 'Label', text: 'Go' }],
        },
        {
          id: 'n_btn2',
          type: 'frame',
          name: 'Button',
          role: 'link',
          href: '/pricing',
          layout: 'row',
          children: [{ id: 'n_bt2', type: 'text', name: 'Label', text: 'Pricing' }],
        },
        { id: 'n_img', type: 'image', name: 'Hero Image', assetId: 'a_hero', w: 100, h: 60 },
        { id: 'n_hidden', type: 'rect', name: 'Hidden', visible: false },
        {
          id: 'n_overlay',
          type: 'frame',
          name: 'Overlay',
          layout: 'none',
          w: 100,
          h: 40,
          children: [{ id: 'n_abs', type: 'rect', name: 'Badge', x: 10, y: 10, w: 20, h: 20 }],
        },
      ],
    },
  ]);
  return {
    ...doc,
    tokens: { ...doc.tokens, colors: { ...doc.tokens.colors, primary: '#c96442' } },
    assets: { a_hero: PIXEL },
  };
}

describe('names', () => {
  it('makes readable kebab and Pascal names with fallbacks', () => {
    expect(kebab('Primary Button')).toBe('primary-button');
    expect(kebab('Café / Menu')).toBe('cafe-menu');
    expect(kebab('!!!', 'frame')).toBe('frame');
    expect(kebab('3 up', 'node')).toBe('node-3-up');
    expect(pascal('Landing - Desktop')).toBe('LandingDesktop');
    expect(pascal('', 'Design')).toBe('Design');
    expect(pascal('2 col')).toBe('Design2Col');
  });

  it('numbers repeated names in document order', () => {
    const n = uniqueNames();
    expect([n.next('Card', 'x'), n.next('Card', 'x'), n.next('Card', 'x')]).toEqual([
      'card',
      'card-2',
      'card-3',
    ]);
  });
});

describe('exportDesign', () => {
  it('rejects the page, hidden and unknown nodes with a useful error', () => {
    const doc = design();
    expect(() => exportDesign(doc, doc.rootId, 'html')).toThrow(CoreError);
    expect(() => exportDesign(doc, 'n_hidden', 'html')).toThrow(/hidden/);
    expect(() => exportDesign(doc, 'n_nope', 'html')).toThrow(/does not exist/);
  });

  it('does not change the document', () => {
    const doc = deepFreeze(design());
    for (const f of FORMATS) expect(() => exportDesign(doc, 'n_screen', f)).not.toThrow();
  });

  it('is deterministic: the same design gives the same bytes', () => {
    for (const f of FORMATS) {
      const a = exportDesign(design(), 'n_screen', f);
      const b = exportDesign(design(), 'n_screen', f);
      expect(b.files).toEqual(a.files);
    }
  });

  it('uses semantic tags, escapes text and skips hidden layers (html)', () => {
    const out = exportDesign(design(), 'n_screen', 'html');
    const html = file(out.files, 'index.html');
    expect(html).toContain('<h1 ');
    expect(html).toContain('<h2 ');
    expect(html).toContain('<button ');
    expect(html).toContain('type="button"');
    expect(html).toContain('<a ');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('<span ');
    expect(html).toContain('Hello &lt;world&gt; &amp; "friends"');
    expect(html).not.toContain('<world>');
    expect(html).not.toContain('hidden');
    expect(html).toContain('<!-- Placed by x/y');
    expect(out.main).toBe('index.html');
  });

  it('references tokens as CSS variables and defines them once', () => {
    const out = exportDesign(design(), 'n_screen', 'html');
    const css = file(out.files, 'styles.css');
    expect(css).toContain('--color-primary: #c96442');
    expect(css).toContain('var(--color-primary)');
    expect(css.match(/--color-primary: #c96442/g)).toHaveLength(1);
  });

  it('writes images as files and warns about missing alt text', () => {
    const out = exportDesign(design(), 'n_screen', 'html');
    const img = out.files.find((f) => f.path === 'assets/hero-image.png');
    expect(img?.content).toBeInstanceOf(Uint8Array);
    expect(file(out.files, 'index.html')).toContain('src="assets/hero-image.png"');
    expect(out.warnings.some((w) => w.includes('alt'))).toBe(true);
  });

  it('keeps class names stable and unique', () => {
    const out = exportDesign(design(), 'n_screen', 'html');
    const html = file(out.files, 'index.html');
    expect(html).toContain('class="landing-page"');
    expect(html).toContain('class="button"');
    expect(html).toContain('class="button-2"');
  });

  it('exports a React component with CSS Modules', () => {
    const out = exportDesign(design(), 'n_screen', 'react-css');
    expect(out.main).toBe('LandingPage.tsx');
    const tsx = file(out.files, 'LandingPage.tsx');
    expect(tsx).toContain("import styles from './LandingPage.module.css';");
    expect(tsx).toContain("import './tokens.css';");
    expect(tsx).toContain("import imgHeroImage from './assets/hero-image.png';");
    expect(tsx).toContain('export default function LandingPage()');
    expect(tsx).toContain("className={styles['landing-page']}");
    expect(tsx).toContain('{"Hello <world> & \\"friends\\""}');
    expect(file(out.files, 'LandingPage.module.css')).toContain('.landing-page {');
  });

  it('honours a custom component name', () => {
    const out = exportDesign(design(), 'n_screen', 'react-css', { componentName: 'hero section' });
    expect(out.componentName).toBe('HeroSection');
    expect(out.files.map((f) => f.path)).toContain('HeroSection.tsx');
  });

  it('maps exact values to Tailwind utilities and keeps the rest verbatim', () => {
    const out = exportDesign(design(), 'n_screen', 'react-tailwind');
    const tsx = file(out.files, 'LandingPage.tsx');
    expect(tsx).toContain('flex');
    expect(tsx).toContain('flex-col');
    expect(tsx).toContain('bg-primary');
    expect(tsx).toContain('w-[600px]');
    const theme = file(out.files, 'theme.css');
    expect(theme).toContain("@import 'tailwindcss';");
    expect(theme).toContain('@theme {');
    expect(theme).toContain('--color-primary: #c96442');
    expect(file(out.files, 'aframe.css')).toContain('font-family');
  });

  it('adds a README with files, fonts and warnings', () => {
    const out = exportDesign(design(), 'n_screen', 'react-css');
    const readme = file(out.files, 'README-aframe.md');
    expect(readme).toContain('# Landing Page');
    expect(readme).toContain('- `LandingPage.tsx`');
    expect(readme).toContain('Notes from the export');
  });

  it.each(TEMPLATES.filter((t) => t !== 'blank'))(
    'exports the %s template in every format',
    (t) => {
      const doc = createTemplateDoc(t, { name: t, id: 'p_exp01', now: '2026-01-01T00:00:00.000Z' });
      const screen = doc.nodes[doc.rootId]?.children
        .map((id) => doc.nodes[id])
        .find((n) => n?.name !== 'Components');
      expect(screen).toBeDefined();
      for (const f of FORMATS) {
        const out = exportDesign(doc, screen?.id ?? '', f);
        expect(out.files.length).toBeGreaterThanOrEqual(2);
        expect(out.files.every((x) => !x.path.includes('..') && !x.path.startsWith('/'))).toBe(
          true,
        );
        // Nothing from the editor leaks into the output.
        expect(out.files.map(text).join('\n')).not.toMatch(/data-node-id|n_[a-z0-9]{4,}/);
      }
    },
  );

  it('does not carry layer text into attribute values unescaped', () => {
    const hostile = buildDoc([
      {
        id: 'n_f',
        type: 'frame',
        name: '"><script>alert(1)</script>',
        role: 'button',
        children: [
          { id: 'n_i', type: 'icon', name: 'x', icon: 'nope', props: { 'aria-label': '"><b>' } },
        ],
      },
    ]);
    const out = exportDesign(hostile, 'n_f', 'html');
    const html = file(out.files, 'index.html');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('"><b>');
  });
});

describe('utilitiesFor', () => {
  it('maps only exact values', () => {
    const { classes, rest } = utilitiesFor({
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      backgroundColor: 'var(--color-primary)',
      boxShadow: '0 1px 2px #000',
      width: '100%',
      padding: '8px 8px 8px 8px',
    });
    expect(classes).toEqual([
      'flex',
      'flex-col',
      'gap-[12px]',
      'bg-primary',
      'w-full',
      'pt-[8px]',
      'pr-[8px]',
      'pb-[8px]',
      'pl-[8px]',
    ]);
    expect(rest).toEqual({ boxShadow: '0 1px 2px #000' });
  });

  it('falls back instead of guessing', () => {
    const { classes, rest } = utilitiesFor({
      gap: 'calc(1px + 2px)',
      fontSize: '1.2rem',
      padding: '8px',
      background: 'linear-gradient(red, blue)',
    });
    expect(classes).toEqual([]);
    expect(Object.keys(rest)).toEqual(['gap', 'fontSize', 'padding', 'background']);
  });
});
