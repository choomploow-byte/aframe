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
  radius?: number | [number, number, number, number];
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

## Example (abridged): see `fixtures/sample-doc.json`
