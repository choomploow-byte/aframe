import { useMemo } from 'react';
import { getCanvasApi } from '../canvas/canvas-api';
import { useAtelier } from '../store/store';
import { STRINGS } from '../strings';
import { buildPropCtx } from './prop-context';
import {
  AutoLayoutSection,
  EffectsSection,
  FillSection,
  ImageSection,
  LayerSection,
  LayoutSection,
  NotesSection,
  RadiusSection,
  StrokeSection,
  TypographySection,
} from './property-sections';
import { ComponentSection, EffectPresetsSection, IconSection } from './toolkit-sections';

/** The Design tab: sections for whatever is selected, with "Mixed" where a multi-selection differs. */
export function PropertiesPanel() {
  const doc = useAtelier((s) => s.doc);
  const selection = useAtelier((s) => s.selection);
  // The measurer only exists while the canvas is mounted; sections call it lazily.
  const ctx = useMemo(
    () => buildPropCtx(doc, selection, (id) => getCanvasApi()?.measure(id) ?? null),
    [doc, selection],
  );

  if (!ctx) {
    return (
      <div className="props props--empty">
        <p className="panel__empty">{STRINGS.panels.propertiesEmpty}</p>
      </div>
    );
  }
  const types = new Set(ctx.nodes.map((n) => n.type));
  const hasText = types.has('text');
  const hasFrame = types.has('frame');
  const hasImage = types.has('image');
  const hasIcon = types.has('icon');
  const presetsApply = ctx.nodes.some((n) => n.type !== 'text' && n.type !== 'line');
  const radiusApplies = ctx.nodes.some((n) => n.type !== 'ellipse' && n.type !== 'line');

  return (
    <div className="props" data-testid="properties">
      <LayerSection ctx={ctx} />
      <LayoutSection ctx={ctx} />
      {hasFrame && <AutoLayoutSection ctx={ctx} />}
      {hasText && <TypographySection ctx={ctx} />}
      {hasIcon && <IconSection ctx={ctx} />}
      {hasImage && <ImageSection ctx={ctx} />}
      <FillSection ctx={ctx} />
      <StrokeSection ctx={ctx} />
      {radiusApplies && <RadiusSection ctx={ctx} />}
      <EffectsSection ctx={ctx} />
      {presetsApply && <EffectPresetsSection ctx={ctx} />}
      {hasFrame && <ComponentSection ctx={ctx} />}
      <NotesSection ctx={ctx} />
    </div>
  );
}
