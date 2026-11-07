/**
 * A small imperative builder for templates: each step is a real, validated edit (the same
 * `applyChanges` and component operations an agent uses), so a template is both a starting point
 * and an example of good structure. Throws if a template is invalid (a bug, covered by tests).
 */
import { applyChanges } from './apply';
import { defineComponent, type DefineComponentInput } from './component-ops';
import { descendantsOf, resolveLayerKey, SELF } from './components';
import type { Rng } from './ids';
import { mergeTokens } from './token-edit';
import type { ComponentKind, ComponentState, Doc, NodeSpec, Tokens } from './types';

export class DocBuilder {
  constructor(
    public doc: Doc,
    private readonly rng?: Rng,
  ) {}

  /** Creates `spec` under `parentId` and returns its id. */
  add(parentId: string, spec: NodeSpec): string {
    const result = applyChanges(this.doc, [{ op: 'create', parentId, node: spec }], {
      ...(this.rng === undefined ? {} : { rng: this.rng }),
    });
    if (!result.ok) {
      throw new Error(`Template step failed: ${JSON.stringify(result.errors[0])}`);
    }
    this.doc = result.doc;
    const id = result.created[0];
    if (id === undefined) throw new Error('Template step created nothing.');
    return id;
  }

  tokens(patch: {
    colors?: Record<string, string>;
    fonts?: Record<string, string>;
    radii?: Record<string, number>;
    spacing?: number[];
  }): void {
    const next: Tokens = mergeTokens(this.doc.tokens, patch);
    this.doc = { ...this.doc, tokens: next };
  }

  /** Builds a master from `spec` (under `parentId`) and defines its states. */
  master(
    parentId: string,
    spec: NodeSpec,
    kind: ComponentKind,
    states?: DefineComponentInput['states'],
  ): string {
    const id = this.add(parentId, spec);
    const result = defineComponent(this.doc, { nodeId: id, kind, ...(states ? { states } : {}) });
    this.doc = result.doc;
    return id;
  }

  /** The id of the first node with this name. */
  find(name: string): string {
    const node = Object.values(this.doc.nodes).find((n) => n.name === name);
    if (!node) throw new Error(`Template refers to a missing node "${name}".`);
    return node.id;
  }

  /**
   * A node spec for an instance of a master, for use inside a bigger tree. `layers` overrides by
   * layer name; `self` overrides the instance root's own look (width, fill...).
   */
  inst(
    component: string,
    layers: Record<string, Record<string, unknown>> = {},
    options: {
      name?: string;
      state?: ComponentState;
      self?: Record<string, unknown>;
      x?: number;
      y?: number;
    } = {},
  ): NodeSpec {
    const masterId = this.find(component);
    const overrides: Record<string, Record<string, unknown>> = {};
    for (const [layer, patch] of Object.entries(layers)) {
      overrides[resolveLayerKey(this.doc.nodes, masterId, layer)] = patch;
    }
    if (options.self) overrides[SELF] = options.self;
    return {
      type: 'frame',
      name: options.name ?? component,
      instanceOf: masterId,
      ...(options.state === undefined ? {} : { state: options.state }),
      ...(options.x === undefined ? {} : { x: options.x }),
      ...(options.y === undefined ? {} : { y: options.y }),
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    };
  }

  /** Layer ids of an instance by name, for follow-up edits. */
  layers(instanceId: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const layer of descendantsOf(this.doc.nodes, instanceId)) out[layer.name] = layer.id;
    return out;
  }
}

// ---------------------------------------------------------------------------
// Small spec helpers shared by the templates
// ---------------------------------------------------------------------------

export const txt = (name: string, value: string, props: Partial<NodeSpec> = {}): NodeSpec => ({
  type: 'text',
  name,
  text: value,
  fontFamily: '$font.body',
  fontSize: 16,
  color: '$text',
  ...props,
});

export const icn = (name: string, glyph: string, size: number, color: string): NodeSpec => ({
  type: 'icon',
  name,
  icon: glyph,
  w: size,
  h: size,
  color,
});
