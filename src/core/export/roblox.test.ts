import { parse as parseLua } from 'luaparse';
import { describe, expect, it } from 'vitest';
import { applyChanges } from '../apply';
import { createEmptyDoc } from '../doc';
import { mergeTokens } from '../token-edit';
import type { Doc, NodeSpec } from '../types';
import { buildWidget, missingWidgetTokens, WIDGET_KINDS } from '../widgets';
import { exportDesign } from './index';
import { luaString, parseLinearGradient } from './roblox';

/** A document with the widget tokens and one frame holding the given children. */
function screen(children: NodeSpec[], extra: Partial<NodeSpec> = {}): { doc: Doc; id: string } {
  const empty = createEmptyDoc();
  const base = { ...empty, tokens: mergeTokens(empty.tokens, missingWidgetTokens(empty.tokens)) };
  const r = applyChanges(base, [
    {
      op: 'create',
      parentId: base.rootId,
      node: {
        type: 'frame',
        name: 'Shop Screen',
        layout: 'none',
        w: 1920,
        h: 1080,
        fill: '#1B1330',
        children,
        ...extra,
      },
    },
  ]);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return { doc: r.doc, id: r.created[0] as string };
}

const luaOf = (doc: Doc, id: string): string => {
  const out = exportDesign(doc, id, 'roblox');
  const file = out.files.find((f) => f.path.endsWith('.lua'));
  return file?.content as string;
};

/** Delimiters balance outside of strings and comments: a cheap guard that the script at least parses structurally. "ok" or what went wrong. */
function balanced(lua: string): string {
  let paren = 0;
  let brace = 0;
  let inString = false;
  let long = false;
  for (let i = 0; i < lua.length; i += 1) {
    const ch = lua[i] as string;
    if (long) {
      if (lua.startsWith(']]', i)) long = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (lua.startsWith('--', i)) {
      while (i < lua.length && lua[i] !== String.fromCharCode(10)) i += 1;
      continue;
    }
    if (lua.startsWith('[[', i)) long = true;
    else if (ch === '"') inString = true;
    else if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    else if (ch === '{') brace += 1;
    else if (ch === '}') brace -= 1;
    if (paren < 0 || brace < 0)
      return `closing too early near: ${lua.slice(Math.max(0, i - 60), i + 5)}`;
  }
  return paren === 0 && brace === 0 && !inString && !long
    ? 'ok'
    : `unbalanced: ${JSON.stringify({ paren, brace, inString, long })}`;
}

/** Every "do" block the exporter opens is closed. */
function blocksClose(script: string): boolean {
  // Only the generated tree: the helper function before it and the fitting LocalScript after it
  // have `end` lines of their own.
  const lua = (script.split('gui.ZIndexBehavior')[1] as string).split(
    'local fit = new',
  )[0] as string;
  let open = 0;
  for (const line of lua.split('\n')) {
    const t = line.trim();
    if (t === 'do') open += 1;
    else if (t === 'end') open -= 1;
    if (open < 0) return false;
  }
  return open === 0;
}

describe('luaString', () => {
  it('escapes quotes, backslashes and new lines', () => {
    expect(luaString('a "b" \\ c\nd')).toBe('"a \\"b\\" \\\\ c\\nd"');
  });
});

describe('parseLinearGradient', () => {
  it('reads an angle and stops, with positions', () => {
    const g = parseLinearGradient('linear-gradient(180deg, #FFF3B0 0%, #FFB020 100%)');
    expect(g?.rotation).toBe(90);
    expect(g?.stops).toHaveLength(2);
    expect(g?.stops[1]?.rgb).toEqual([255, 176, 32]);
  });

  it('spreads stops that have no position, and adds ends', () => {
    const g = parseLinearGradient('linear-gradient(90deg, #000000, #808080, #ffffff)');
    expect(g?.rotation).toBe(0);
    expect(g?.stops.map((s) => s.at)).toEqual([0, 0.5, 1]);
    const open = parseLinearGradient('linear-gradient(#000000 20%, #ffffff 80%)');
    expect(open?.stops[0]?.at).toBe(0);
    expect(open?.stops.at(-1)?.at).toBe(1);
  });

  it('refuses what it cannot read', () => {
    expect(parseLinearGradient('radial-gradient(#000, #fff)')).toBeNull();
    expect(parseLinearGradient('linear-gradient(red, blue)')).toBeNull();
  });
});

describe('Roblox export', () => {
  it('builds a ScreenGui script with a scaled, centred root, corners, strokes and a list layout', () => {
    const { doc, id } = screen([
      { ...buildWidget('button', { label: 'PLAY' }).spec, x: 100, y: 100 },
    ]);
    const lua = luaOf(doc, id);
    expect(lua).toContain('Instance.new("ScreenGui")');
    expect(lua).toContain('UIScale');
    expect(lua).toContain('AnchorPoint = Vector2.new(0.5, 0.5)');
    expect(lua).toContain('FitToScreen');
    expect(lua).toContain('new("UICorner"');
    expect(lua).toContain('new("UIStroke"');
    expect(lua).toContain('new("UIListLayout"');
    expect(lua).toContain('new("UIGradient"');
    expect(lua).toContain('Text = "PLAY"');
    expect(lua).toContain('Enum.Font.FredokaOne');
    expect(lua).toContain('gui.Parent = game:GetService("StarterGui")');
    expect(balanced(lua)).toBe('ok');
    expect(blocksClose(lua)).toBe(true);
    expect(() => parseLua(lua, { luaVersion: '5.3' })).not.toThrow();
  });

  it('turns text outlines into a contextual UIStroke and gradient lettering into a UIGradient', () => {
    const { doc, id } = screen([
      {
        type: 'text',
        name: 'Title',
        x: 0,
        y: 0,
        text: 'GOLD',
        fontFamily: 'Lilita One',
        fontSize: 64,
        color: 'linear-gradient(180deg, #FFF3B0, #FFB020)',
        textStroke: '#120B24',
        textStrokeWidth: 4,
      },
    ]);
    const lua = luaOf(doc, id);
    expect(lua).toContain('ApplyStrokeMode = Enum.ApplyStrokeMode.Contextual');
    expect(lua).toContain('Thickness = 8');
    expect(lua).toContain('UIGradient');
    expect(lua).toContain('TextColor3 = Color3.new(1, 1, 1)');
  });

  it('uses a shared text style, and upper-cases text that asks for it', () => {
    const empty = createEmptyDoc();
    const withStyle = {
      ...empty,
      tokens: mergeTokens(empty.tokens, {
        textStyles: { Loud: { fontSize: 77, color: '#FF0000', textTransform: 'uppercase' } },
      }),
    };
    const r = applyChanges(withStyle, [
      {
        op: 'create',
        parentId: withStyle.rootId,
        node: {
          type: 'frame',
          name: 'S',
          layout: 'none',
          w: 800,
          h: 600,
          children: [{ type: 'text', name: 'L', text: 'hello', textStyle: 'Loud', x: 0, y: 0 }],
        },
      },
    ]);
    if (!r.ok) throw new Error('setup');
    const lua = luaOf(r.doc, r.created[0] as string);
    expect(lua).toContain('TextSize = 77');
    expect(lua).toContain('Text = "HELLO"');
    expect(lua).toContain('TextColor3 = Color3.fromRGB(255, 0, 0)');
  });

  it('lists the pictures, and warns about what Roblox cannot draw', () => {
    const { doc, id } = screen([
      { ...buildWidget('item_slot', { icon: 'sword' }).spec, x: 40, y: 40 },
      { ...buildWidget('panel', {}).spec, x: 300, y: 40 },
    ]);
    const out = exportDesign(doc, id, 'roblox');
    const lua = out.files.find((f) => f.path.endsWith('.lua'))?.content as string;
    expect(lua).toContain('["icon:sword"]');
    expect(out.warnings.join('\n')).toMatch(/bevel|shadows or effect presets/);
    expect(out.warnings.join('\n')).toMatch(/vector icon/);
    expect(out.files.map((f) => f.path)).toContain('README-roblox.md');
  });

  it('exports every widget to a structurally sound script', () => {
    for (const kind of WIDGET_KINDS) {
      const { doc, id } = screen([{ ...buildWidget(kind, {}).spec, x: 50, y: 50 }]);
      const lua = luaOf(doc, id);
      expect(balanced(lua), kind).toBe('ok');
      expect(blocksClose(lua), kind).toBe(true);
      expect(lua, kind).not.toContain('undefined');
      expect(lua, kind).not.toContain('NaN');
      // A real Lua parser agrees the whole script is syntactically valid.
      expect(() => parseLua(lua, { luaVersion: '5.3' }), kind).not.toThrow();
    }
  });

  it('exports an image with its file and the ASSETS slot', () => {
    const empty = createEmptyDoc();
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const doc: Doc = { ...empty, assets: { img_ab12c: png } };
    const r = applyChanges(doc, [
      {
        op: 'create',
        parentId: doc.rootId,
        node: {
          type: 'frame',
          name: 'S',
          layout: 'none',
          w: 800,
          h: 600,
          children: [
            {
              type: 'image',
              name: 'Stud Tile',
              assetId: 'img_ab12c',
              fit: 'tile',
              tileSize: 32,
              x: 0,
              y: 0,
              w: 200,
              h: 100,
            },
          ],
        },
      },
    ]);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const out = exportDesign(r.doc, r.created[0] as string, 'roblox');
    const lua = out.files.find((f) => f.path.endsWith('.lua'))?.content as string;
    expect(out.files.map((f) => f.path)).toContain('assets/stud-tile.png');
    expect(lua).toContain('["assets/stud-tile.png"]');
    expect(lua).toContain('ScaleType = Enum.ScaleType.Tile');
    expect(lua).toContain('TileSize = UDim2.fromOffset(32, 32)');
  });
});
