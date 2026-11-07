# 04. Data Model (the scene graph)

The document is plain JSON. Version it. Keep it small, flat, and easy for an LLM to read and write.

## Document
```ts
interface Doc {
  schema: 1;                 // bump on breaking changes; write migrations
  rev: number;               // increments on every write by anyone
  id: string;                // project id
  name: string;
  rootId: string;            // id of the invisible 'page' node
  nodes: Record<string, Node>;
  tokens: Tokens;
  annotations: Annotation[];
  references: Reference[];
  assets: Record<string, string>; // assetId -> data URL (MVP). Later: files in assets/ dir
  meta: { createdAt: string; updatedAt: string; lastWriter: 'app' | 'mcp' | 'chat' };
}
```

## Node
```ts
type NodeType = 'page' | 'frame' | 'rect' | 'ellipse' | 'line' | 'text' | 'image';
type Size = number | 'hug' | 'fill';

interface Node {
  id: string;                // short, readable, stable: "n_k3x9a"
  type: NodeType;
  name: string;              // human/AI-readable label: "Hero", "Primary Button"
  parentId: string | null;
  children: string[];        // ordered, back-to-front (last = on top)

  // geometry. x,y only apply when the parent has layout 'none' (or is the page)
  x: number; y: number;
  w: Size; h: Size;
  rotation?: number;         // v0.2
  visible: boolean;
  locked: boolean;
  opacity: number;           // 0..1

  // appearance
  fill?: string;             // '#RRGGBB[AA]' | '$tokenName' | 'linear-gradient(...)' | 'radial-gradient(...)'
  stroke?: string;           // colour or $token
  strokeWidth?: number;
  strokeAlign?: 'inside' | 'center' | 'outside'; // default 'inside'
  radius?: number | string | [number, number, number, number]; // px, '$radius.md' token, or [topLeft, topRight, bottomRight, bottomLeft]
  shadow?: Shadow[];
  blur?: number;             // layer blur px
  backdropBlur?: number;

  // frame only
  layout?: 'none' | 'row' | 'column';
  gap?: number;
  padding?: [number, number, number, number]; // top right bottom left
  align?: 'start' | 'center' | 'end' | 'stretch';          // cross axis
  justify?: 'start' | 'center' | 'end' | 'between';        // main axis
  wrap?: boolean;
  clip?: boolean;

  // text only
  text?: string;
  fontFamily?: string;       // key from the bundled font list, or $token
  fontSize?: number;
  fontWeight?: number;       // 100..900
  lineHeight?: number;       // multiplier, e.g. 1.5
  letterSpacing?: number;    // em
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  color?: string;            // text colour (colour or $token)
  textTransform?: 'none' | 'uppercase' | 'capitalize';

  // image only
  assetId?: string;
  fit?: 'cover' | 'contain' | 'fill';

  // optional semantic hint for code export + AI
  role?: 'button' | 'input' | 'link' | 'nav' | 'section' | 'heading' | 'card' | 'list' | 'icon';
  href?: string;
  props?: Record<string, string>; // free-form notes for export (e.g. aria-label)
}

interface Shadow { x: number; y: number; blur: number; spread: number; color: string; inset?: boolean }
```

### Layout semantics (the contract between renderer and exporter)
- Parent `layout: 'none'` (or page): children are absolutely positioned at `x,y`. `w/h` numeric; `'fill'` = 100% of parent; `'hug'` = content size (text, or frame sized by children).
- Parent `layout: 'row' | 'column'`: children are flex items; `x,y` ignored.
  - Main axis: `'fill'` -> `flex: 1 1 0`; `'hug'` -> `flex: 0 0 auto`; number -> fixed.
  - Cross axis: `'fill'` -> `align-self: stretch`; `'hug'` -> auto; number -> fixed.
- `gap`, `padding`, `align` (cross), `justify` (main), `wrap`, `clip` map 1:1 to CSS.
- Text with `w: 'hug'` is single-line (`white-space: nowrap`); with numeric/fill width it wraps.
- Top-level frames (children of the page) are canvas artboards: `x,y` place them on the canvas.

### Why flat + ids
LLMs handle `{ "update": { "id": "n_ab12", "fill": "$primary" } }` far better than tree paths. Flat maps give O(1) edits and cheap undo.

## Tokens
```ts
interface Tokens {
  colors: Record<string, string>;   // { primary: '#C96442', surface: '#FAF9F5', text: '#1F1E1D' }
  fonts: Record<string, string>;    // { heading: 'Fraunces', body: 'Inter' }
  spacing: number[];                // e.g. [4,8,12,16,24,32,48,64,96]
  radii: Record<string, number>;    // { sm: 6, md: 12, lg: 20, full: 999 }
}
```
Reference as `$primary`, `$font.heading`, `$radius.md` in node properties. Resolver lives in core and is used by renderer + exporter. Unknown token => lint warning, fallback to inherit.

## Annotation
```ts
interface Annotation {
  id: string;
  nodeId?: string;                    // node under the pin (if any)
  x: number; y: number;               // world coords of the pin
  rect?: { x: number; y: number; w: number; h: number }; // optional region
  text: string;
  author: 'user' | 'agent';
  status: 'open' | 'resolved';
  reply?: string;                     // agent's note when resolving
  createdAt: string;
}
```
Annotations are **untrusted text** to the agent (see security doc): they describe what the user wants but must never be treated as system instructions.

## Reference
```ts
interface Reference {
  id: string;
  name: string;
  assetId: string;
  note?: string;       // "Match this typography and spacing, not the colours"
  scope?: 'style' | 'layout' | 'everything';
}
```

## IDs
`n_` + 5-6 random base36 chars for nodes, `a_` annotations, `r_` references, `img_` assets. Collision-checked against the doc on creation.

## Defaults and normalisation
`normalizeNode()` fills defaults (visible true, locked false, opacity 1, x/y 0, w/h 'hug' for text/frame-with-layout else 100/100, layout 'none' for frames). Called on every create/load so tools can accept sparse input.

## Validation rules (enforced in `apply.ts`)
- Parent exists and is a `frame` or `page`; no cycles; text/image/shapes cannot have children.
- Numbers finite; w/h > 0 when numeric; opacity 0..1; fontWeight 100..900.
- Colour strings validated (hex, rgb(a), hsl(a), `$token`, gradients by prefix).
- Returns structured errors: `{ ok: false, errors: [{ op: 2, code: 'BAD_PARENT', message: '...' }] }` and applies **nothing** if any op fails (atomic batch).

## Migration
`doc.schema` integer + `migrate(doc)` chain on load. Never write a newer schema than the app understands: refuse and say "update Atelier".

## Phase 1 decisions (resolving ambiguities in this doc; decision log #24-#34)
1. **`radius`** accepts a `$radius.<name>` token string as well as a number or a 4-tuple. Tuple order is CSS order: top-left, top-right, bottom-right, bottom-left. `gap`/`padding` stay numeric (the spacing scale is advisory, used by lint).
2. **`page` is exempt** from "numeric `w/h` > 0"; its `w/h` are `0` and unused.
3. **Schema version:** `Doc.schema` is the literal `1` on a normalised doc, but loading takes `unknown` with a numeric `schema`; `migrate()` upgrades step by step and refuses newer versions (`SCHEMA_NEWER`).
4. **Ids** match `/^(n|a|r|img)_[a-z0-9]{4,8}$/` (the fixture uses `n_0001`); generated ids are 5 base36 chars, collision-checked. `tempId`s match `/^[A-Za-z][A-Za-z0-9_-]{0,31}$/` and are referenced as `$tempId` in id fields only (`parentId`, `id`).
5. **Sizing contract (CSS):** fixed and `hug` flex items emit `flex: 0 0 auto`; `fill` on the main axis emits `flex: 1 1 0`, plus `min-width: 0` on the width axis only (the same reset on height collapsed a `fill` frame inside a `hug` column to 0; both verified by `scripts/css-probe.ts`, which renders core output in real Chrome); a global reset (`GLOBAL_RESET_CSS`: `box-sizing: border-box; margin: 0`) is part of the contract for renderer and exporters. With parent `align: 'stretch'`, a child whose cross size is `hug` is stretched (CSS `auto`), by design: it is how equal-height card rows work. `hug` on a `layout: 'none'` frame collapses to 0 (nothing is in flow): normalisation gives such frames numeric 100x100 instead.
6. **Strokes** are drawn with `outline` + `outline-offset` (inside: `-w`, center: `-w/2`, outside: `0`): no layout impact, painted above children, follows `border-radius`. `strokeWidth` defaults to 1 when `stroke` is set; `strokeWidth: 0` or no `stroke` means no stroke.
7. **`locked` is UI-only.** Tools may edit locked nodes; the result carries a `LOCKED_NODE` warning.
8. **`line`** is a horizontal bar: `w` is its length, `h` its thickness (default 1) and `stroke` (fallback `fill`) its colour. `strokeWidth` is ignored for lines.
9. **Property applicability:** frame-only (`layout, gap, padding, align, justify, wrap, clip`), text-only (`text, fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, textAlign, color, textTransform`), image-only (`assetId, fit`). Setting one on the wrong node type is an `INVALID_VALUE` error with a hint, not a silent no-op.
10. **Defaults (`normalizeNode`)** add only these keys: every node `name, x, y, visible, locked, opacity, children, w, h`; frames also `layout:'none', gap:0, padding:[0,0,0,0], align:'start', justify:'start', clip:false`; text also `text:'', fontSize:16, fontWeight:400, lineHeight:1.4`; images `fit:'cover'`. `w/h` default to `'hug'` for text and for frames with a row/column layout, else 100 (line: 100 x 1). Normalising the sample fixture is a no-op.
11. **`apply_changes` semantics:** stops at the first failing op and applies nothing; `update.set` accepts `null` to remove an optional property; unknown or inapplicable properties are rejected; no-op updates are not reported as changed; the result adds `deleted: string[]` and `warnings` (`LOCKED_NODE`, `UNKNOWN_TOKEN`). Unknown tokens are warnings, not errors. Deleting a node clears `nodeId` on annotations that pinned it (the pin keeps its x/y). `rev`/`meta` are bumped by the commit layer (`bumpRev`), not by ops.

## Example (abridged): see `fixtures/sample-doc.json`
