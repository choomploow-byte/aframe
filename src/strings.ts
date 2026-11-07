/**
 * UI strings in one place from day one, so translating the editor later does not mean hunting
 * through components (docs/19). Product name comes from brand.ts.
 */
export const STRINGS = {
  toolbar: {
    label: 'Tools',
    select: 'Select',
    frame: 'Frame',
    rect: 'Rectangle',
    ellipse: 'Ellipse',
    text: 'Text',
    image: 'Image (coming in a later phase)',
    annotate: 'Annotate (coming in a later phase)',
    hand: 'Hand (pan)',
    framePresets: 'Frame sizes',
  },
  topbar: {
    undo: 'Undo',
    redo: 'Redo',
    untitled: 'Untitled project',
    connect: 'Connect AI',
    export: 'Export',
  },
  zoom: {
    label: 'Zoom',
    in: 'Zoom in',
    out: 'Zoom out',
    actual: 'Zoom to 100%',
    fitAll: 'Zoom to fit all',
    fitSelection: 'Zoom to selection',
  },
  panels: {
    layers: 'Layers',
    layersEmpty:
      'No layers yet. Press F and drag on the canvas to draw a frame, or open the sample project.',
    filterLayers: 'Filter layers',
    noLayersMatch: 'No layer matches that name.',
    assets: 'Assets',
    tokens: 'Tokens',
    properties: 'Properties',
    design: 'Design',
    propertiesEmpty: 'Select something on the canvas or in Layers to edit it.',
    left: 'Layers, assets and tokens',
  },
  welcome: {
    title: 'Design with your AI.',
    lead: 'Draw a screen, let Claude Code or Codex improve it, then take real code back into your project.',
    draw: 'Draw a frame',
    drawHint: 'Press F, then drag on the canvas',
    sample: 'Explore the sample project',
    sampleHint: 'A landing page and a pricing page to play with',
    connect: 'Connect your AI',
    connectHint: 'Claude Code, Codex or an API key',
  },
  connect: {
    title: 'Connect your AI',
    body: 'Atelier works with Claude Code, Codex and any MCP-compatible agent. They open the same design you see here, edit it, take screenshots and read your notes.',
    soon: 'The one-line install arrives in a later phase. Until then, the canvas works fully on its own.',
    close: 'Got it',
  },
  palette: {
    label: 'Command palette',
    placeholder: 'Type a command…',
    empty: 'No command matches.',
  },
  shortcuts: { title: 'Keyboard shortcuts' },
  canvas: {
    label: 'Canvas',
    emptyTitle: 'Design with your AI.',
    emptyHint: 'Press F and drag to draw a frame, or pick a size from the toolbar.',
  },
} as const;
