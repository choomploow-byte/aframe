/**
 * Atelier core types. Authoritative spec: docs/04-data-model.md (incl. "Phase 1 decisions").
 * No DOM / Node imports allowed in src/core/.
 */

import type { LibraryEntry } from './library';

export const SCHEMA_VERSION = 1 as const;

export type NodeType = 'page' | 'frame' | 'rect' | 'ellipse' | 'line' | 'text' | 'image' | 'icon';
/** Node types a tool may create (the page node is created with the document). */
export type CreatableNodeType = Exclude<NodeType, 'page'>;
export type Size = number | 'hug' | 'fill';
export type Role =
  'button' | 'input' | 'link' | 'nav' | 'section' | 'heading' | 'card' | 'list' | 'icon';

export interface Shadow {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  inset?: boolean;
}

/** Native repeating fills (docs/04 "Pattern fills"). */
export type PatternName = 'stripes' | 'halftone' | 'sunburst' | 'noise';

/**
 * A pattern used as `fill`. `color` is the ink; `background` (optional, any colour or gradient) is
 * what the ink sits on. Meaning of the numbers per pattern:
 * - stripes: `size` stripe thickness px, `spacing` gap px, `angle` degrees
 * - halftone: `size` dot diameter px, `spacing` distance between dot centres px
 * - sunburst: `size` ray width in degrees, `spacing` gap in degrees, `angle` start rotation
 * - noise: `size` grain tile px (larger = coarser)
 */
export interface PatternFill {
  pattern: PatternName;
  color: string;
  size?: number;
  spacing?: number;
  angle?: number;
  /** 0..1 strength of the ink (default 1). */
  opacity?: number;
  background?: string;
}

/** Named box-shadow recipes (docs/04 "Effect presets"). */
export type EffectPreset =
  'bevel-raised' | 'bevel-pressed' | 'gloss-top' | 'inner-glow' | 'hard-3d-bottom';

/** A preset by name, or with options: `intensity` scales it (default 1), `color` tints it. */
export type EffectRef = EffectPreset | { preset: EffectPreset; intensity?: number; color?: string };

export type ComponentKind = 'button' | 'card' | 'tab' | 'slot' | 'panel' | 'toast' | 'custom';
export type ComponentState = 'default' | 'hover' | 'pressed' | 'disabled' | 'selected';

/** Property changes for one layer of a component, keyed by the master's layer id (`$self` = the root). */
export type LayerPatches = Record<string, Record<string, unknown>>;

/** Marks a frame as a master component (docs/04 "Components"). */
export interface ComponentDef {
  kind: ComponentKind;
  /** What differs from the master's own look in each non-default state. */
  states?: Partial<Record<Exclude<ComponentState, 'default'>, LayerPatches>>;
}

/** Corner radii in CSS order: top-left, top-right, bottom-right, bottom-left. */
export type RadiusTuple = [number, number, number, number];

export interface Node {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  /** Ordered back-to-front (last = on top). */
  children: string[];

  // Geometry. x/y only apply when the parent has layout 'none' or is the page.
  x: number;
  y: number;
  w: Size;
  h: Size;
  rotation?: number; // v0.2
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1

  // Appearance
  /** '#RRGGBB[AA]' | '$token' | 'linear-gradient(...)' | 'radial-gradient(...)' | a pattern */
  fill?: string | PatternFill;
  stroke?: string;
  strokeWidth?: number;
  strokeAlign?: 'inside' | 'center' | 'outside';
  radius?: number | string | RadiusTuple;
  shadow?: Shadow[];
  blur?: number;
  backdropBlur?: number;
  /** Named shadow recipes drawn after `shadow`; box-based, so ignored on text. */
  effects?: EffectRef[];

  // Frame
  layout?: 'none' | 'row' | 'column';
  gap?: number;
  /** top, right, bottom, left */
  padding?: [number, number, number, number];
  /** cross axis */
  align?: 'start' | 'center' | 'end' | 'stretch';
  /** main axis */
  justify?: 'start' | 'center' | 'end' | 'between';
  wrap?: boolean;
  clip?: boolean;

  // Text
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number; // multiplier
  letterSpacing?: number; // em
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  color?: string;
  textTransform?: 'none' | 'uppercase' | 'capitalize';

  // Image
  assetId?: string;
  fit?: 'cover' | 'contain' | 'fill';

  // Icon
  /** Name from the icon set (search_icons). Unknown names draw a labelled placeholder. */
  icon?: string;

  // Components (frames only; docs/04). A master has `component`; an instance has `instanceOf`.
  component?: ComponentDef;
  instanceOf?: string;
  /** Which state an instance shows. */
  state?: ComponentState;
  /** Instance-level changes, keyed by the master's layer id (`$self` = the instance root). */
  overrides?: LayerPatches;
  /** On the layers inside an instance: the master layer they were copied from. Managed, not settable. */
  from?: string;

  // Semantics for export + AI
  role?: Role;
  href?: string;
  props?: Record<string, string>;
}

/** Everything on a node that a tool may set (identity and structure are managed by ops). */
export type NodeProps = Omit<Node, 'id' | 'type' | 'parentId' | 'children' | 'from'>;
export type NodePropKey = keyof NodeProps;

export interface Tokens {
  colors: Record<string, string>;
  fonts: Record<string, string>;
  spacing: number[];
  radii: Record<string, number>;
}

export interface Annotation {
  id: string;
  nodeId?: string;
  x: number;
  y: number;
  rect?: { x: number; y: number; w: number; h: number };
  /**
   * Where inside `nodeId`'s box the pin (or the region's top-left) sits, so the pin follows the node.
   * `x`/`y`/`rect` keep the world position it was made at, used if the node is gone.
   */
  offset?: { x: number; y: number };
  text: string;
  author: 'user' | 'agent';
  status: 'open' | 'resolved';
  reply?: string;
  createdAt: string;
}

export interface Reference {
  id: string;
  name: string;
  assetId: string;
  note?: string;
  scope?: 'style' | 'layout' | 'everything';
}

export interface DocMeta {
  createdAt: string;
  updatedAt: string;
  lastWriter: 'app' | 'mcp' | 'chat';
}

export interface Doc {
  schema: typeof SCHEMA_VERSION;
  rev: number;
  id: string;
  name: string;
  rootId: string;
  nodes: Record<string, Node>;
  tokens: Tokens;
  annotations: Annotation[];
  references: Reference[];
  /** assetId -> data URL (MVP). Later: files under assets/. */
  assets: Record<string, string>;
  meta: DocMeta;
}

// ---------------------------------------------------------------------------
// apply_changes operation schema (docs/05)
// ---------------------------------------------------------------------------

/** Sparse node input. `tempId` lets later ops in the same batch refer to it as `$tempId`. */
export type NodeSpec = Partial<NodeProps> & {
  type: CreatableNodeType;
  id?: string;
  tempId?: string;
  children?: NodeSpec[];
};

/**
 * Property changes for `update`. A value of `null` removes an optional property
 * (docs/04 Phase 1 decision 11).
 */
export type NodePatch = { [K in NodePropKey]?: NodeProps[K] | null };

export type Op =
  | { op: 'create'; parentId: string; index?: number; node: NodeSpec }
  | { op: 'update'; id: string; set: NodePatch }
  | { op: 'delete'; id: string }
  | { op: 'move'; id: string; parentId: string; index?: number }
  | { op: 'duplicate'; id: string; parentId?: string; offset?: { x: number; y: number } };

export type ErrorCode =
  | 'NOT_FOUND'
  | 'BAD_PARENT'
  | 'CYCLE'
  | 'INVALID_VALUE'
  | 'LIMIT_EXCEEDED'
  | 'SCHEMA_NEWER'
  | 'APP_NOT_RUNNING'
  | 'TIMEOUT'
  | 'PATH_NOT_ALLOWED'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL';

export interface OpError {
  /** Index of the failing op in the batch, if applicable. */
  op?: number;
  code: ErrorCode;
  message: string;
  hint?: string;
  /** Dotted path of the offending field, e.g. `node.children.1.fill`. */
  path?: string;
}

export type WarningCode =
  | 'LOCKED_NODE'
  | 'UNKNOWN_TOKEN'
  | 'MISSING_ASSET'
  | 'LAYOUT_IGNORED'
  | 'UNKNOWN_ICON'
  | 'FONT_WEIGHT'
  | 'EFFECT_ON_TEXT'
  | 'INSTANCE_OVERRIDE';

export interface Warning {
  code: WarningCode;
  message: string;
  nodeId?: string;
}

export interface ApplyOk {
  ok: true;
  doc: Doc;
  /** Ids created by the batch, in creation order (net of later deletes). */
  created: string[];
  /** Pre-existing nodes whose own props or children changed (net effect). */
  changed: string[];
  /** Pre-existing nodes that no longer exist. */
  deleted: string[];
  /** tempId -> real id. */
  idMap: Record<string, string>;
  warnings: Warning[];
}

export type ApplyResult = ApplyOk | { ok: false; errors: OpError[] };

// ---------------------------------------------------------------------------
// Tool environment abstraction (docs/03 §2)
// ---------------------------------------------------------------------------

export interface ScreenshotOptions {
  nodeId?: string;
  scale?: 1 | 2;
  annotations?: boolean;
  maxWidth?: number;
  /** Show components in this state (without changing the design); 'all' draws every state side by side. */
  state?: ComponentState | 'all';
}

export interface ScreenshotResult {
  pngBase64: string;
  width: number;
  height: number;
  /** Where the PNG was also saved, for hosts that cannot show images (the agent can open the file). */
  path?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  /** Top-level frames (artboards); null when the project was not opened to count them. */
  frames: number | null;
}

/** Project-level operations (the MCP server implements these over the files; the app does not need them). */
export interface ToolProjects {
  list(): Promise<ProjectSummary[]>;
  create(name: string, template: string): Promise<ProjectSummary>;
  /** Makes a project the current one (by id or exact name) and tells a running app to show it. */
  open(project: string): Promise<ProjectSummary>;
}

/** The user's asset library (their own images, kept in the Atelier home; MCP server only). */
export interface ToolLibrary {
  list(): LibraryEntry[] | Promise<LibraryEntry[]>;
  /** The bytes of one asset by id, or null if there is no such id. */
  read(id: string): Promise<{ entry: LibraryEntry; bytes: Uint8Array } | null>;
}

export interface ToolSkills {
  list(): { name: string; description: string }[];
  load(name: string): string | null;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CommitMeta {
  source: 'agent' | 'user';
  label?: string;
}

export interface ToolContext {
  getDoc(): Doc | Promise<Doc>;
  /** Persists `next`. Implementations bump `rev`/`meta` (see `bumpRev`). */
  commit(next: Doc, meta?: CommitMeta): void | Promise<void>;
  screenshot?: (opts: ScreenshotOptions) => Promise<ScreenshotResult>;
  getSelection?: () => string[] | Promise<string[]>;
  /** Whether the Atelier app is running (heartbeat is fresh). Absent = unknown/not applicable. */
  appOnline?: () => boolean | Promise<boolean>;
  projects?: ToolProjects;
  skills?: ToolSkills;
  library?: ToolLibrary;
  /** App only: absolute bounds of a node on the canvas, if it is rendered. */
  getNodeBounds?: (nodeId: string) => Promise<Bounds | null>;
  /** MCP server only: read a user-specified image file (validated). */
  readUserFile?: (path: string) => Promise<Uint8Array>;
  /** MCP server only: write files under a user-confirmed root; must refuse path escapes. */
  writeUserFiles?: (root: string, files: Record<string, string | Uint8Array>) => Promise<string[]>;
}
