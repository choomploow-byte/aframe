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
  topbar: { undo: 'Undo', redo: 'Redo', untitled: 'Untitled project', connect: 'Connect AI' },
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
    layersEmpty: 'Layers will list every frame and shape here.',
    properties: 'Properties',
    propertiesEmpty: 'Select something on the canvas to edit it.',
  },
  canvas: {
    label: 'Canvas',
    emptyTitle: 'Design with your AI.',
    emptyHint: 'Press F and drag to draw a frame, or pick a size from the toolbar.',
  },
} as const;
