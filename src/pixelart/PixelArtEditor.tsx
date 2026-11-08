import {
  addPaletteColor,
  applyBrush,
  colorUsage,
  createCanvas,
  floodFill,
  linePoints,
  MAX_PALETTE,
  MAX_PIXEL_SIZE,
  parsePixelFile,
  pickIndex,
  PixelError,
  removePaletteColor,
  resizeCanvas,
  serializePixelFile,
  setPaletteColor,
  shapePoints,
  toRgba,
  type PixelCanvas,
  type ShapeTool,
} from '@core/pixelart';
import {
  Download,
  FolderOpen,
  Grid3x3,
  Maximize,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  FlipHorizontal2,
  FlipVertical2,
  FilePlus2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { store, useAFrame } from '../store/store';
import { showToast } from '../ui/toast';
import {
  cancelPixelAi,
  dismissPixelAi,
  generatePrompt,
  QUICK_ACTIONS,
  runPixelAi,
  usePixelAi,
} from './ai';
import {
  clampZoom,
  closePixelEditor,
  fitZoom,
  PIXEL_TOOLS,
  setPixelUi,
  usePixelUi,
  type PixelTool,
} from './state';

const SHAPE_TOOLS: readonly PixelTool[] = ['line', 'rect', 'rectFilled'];

/** Saves a canvas into the document as one undoable change. Inside a stroke it joins the stroke's step. */
function write(next: PixelCanvas, label: string, key?: string): void {
  const r = store.getState().edit((doc) => ({ ...doc, pixelArt: next }), label, key);
  if (!r.ok) showToast(r.error.message, { kind: 'error' });
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const problem = (e: unknown): string =>
  e instanceof PixelError || e instanceof Error ? e.message : 'That did not work.';

// ---------------------------------------------------------------------------
// The start screen: a blank canvas of a chosen size, or an existing file
// ---------------------------------------------------------------------------

function StartScreen({ replacing, onDone }: { replacing: boolean; onDone: () => void }) {
  const [w, setW] = useState(32);
  const [h, setH] = useState(32);
  const [error, setError] = useState<string | null>(null);

  const make = (width: number, height: number): void => {
    try {
      const palette = store.getState().doc.pixelArt?.palette.slice(1);
      write(createCanvas(width, height, palette), 'New pixel art canvas');
      setPixelUi({ color: 1, pan: { x: 0, y: 0 }, starting: false });
      onDone();
    } catch (e) {
      setError(problem(e));
    }
  };

  const open = (file: File | undefined): void => {
    if (!file) return;
    if (file.size > 3_000_000) {
      setError('That file is too big for a pixel art canvas (the limit is about 3 MB).');
      return;
    }
    void file
      .text()
      .then((text) => {
        write(parsePixelFile(text), 'Open pixel art file');
        setPixelUi({ color: 1, pan: { x: 0, y: 0 }, starting: false });
        onDone();
      })
      .catch((e: unknown) => setError(problem(e)));
  };

  return (
    <div className="pixel__start" data-testid="pixel-start">
      <h2>{replacing ? 'Start a new canvas' : 'Pixel art'}</h2>
      {replacing && (
        <p className="pixel__note">
          This replaces the canvas you have now. Undo (Ctrl+Z) brings it back.
        </p>
      )}
      <p className="pixel__note">Choose a size to start from a blank canvas.</p>
      <div className="pixel__sizes" role="group" aria-label="Canvas size">
        {[16, 32, 64].map((n) => (
          <button
            key={n}
            type="button"
            className="btn btn--secondary"
            data-action={`pixel-new-${n}`}
            onClick={() => make(n, n)}
          >
            {n} × {n}
          </button>
        ))}
      </div>
      <div className="pixel__custom">
        <label>
          Width
          <input
            className="textfield"
            type="number"
            min={1}
            max={MAX_PIXEL_SIZE}
            value={w}
            aria-label="Custom width"
            data-field="pixel-custom-w"
            onChange={(e) => setW(Number(e.target.value))}
          />
        </label>
        <label>
          Height
          <input
            className="textfield"
            type="number"
            min={1}
            max={MAX_PIXEL_SIZE}
            value={h}
            aria-label="Custom height"
            data-field="pixel-custom-h"
            onChange={(e) => setH(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className="btn btn--primary"
          data-action="pixel-new-custom"
          onClick={() => make(w, h)}
        >
          Create
        </button>
      </div>
      <p className="pixel__note">
        Up to {MAX_PIXEL_SIZE} × {MAX_PIXEL_SIZE}.
      </p>
      <label className="btn btn--secondary pixel__open">
        <FolderOpen size={14} strokeWidth={1.75} aria-hidden="true" /> Open a pixel art file…
        <input
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="pixel-open-input"
          onChange={(e) => {
            open(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {error !== null && (
        <p className="pixel__error" role="alert" data-testid="pixel-start-error">
          {error}
        </p>
      )}
      {replacing && (
        <button type="button" className="btn btn--small" onClick={onDone}>
          Cancel
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The palette
// ---------------------------------------------------------------------------

function Palette({ canvas }: { canvas: PixelCanvas }) {
  const color = usePixelUi((s) => s.color);
  const usage = colorUsage(canvas);
  const selected = Math.min(color, canvas.palette.length - 1);
  const hex = canvas.palette[selected] ?? '#00000000';
  // The text being typed belongs to one colour at one value; picking another resets it.
  const draftKey = `${selected}:${hex}`;
  const [typed, setTyped] = useState({ key: draftKey, text: hex });
  const draft = typed.key === draftKey ? typed.text : hex;
  const setDraft = (text: string): void => setTyped({ key: draftKey, text });

  const change = (value: string): void => {
    try {
      write(setPaletteColor(canvas, selected, value), 'Pixel art: edit colour', 'pixel-colour');
    } catch (e) {
      showToast(problem(e), { kind: 'error' });
    }
  };

  return (
    <section className="pixel__panel" aria-label="Palette">
      <h3>Palette</h3>
      <div className="pixel__swatches" role="group" aria-label="Colours">
        {canvas.palette.map((c, i) => (
          <button
            key={i}
            type="button"
            className={`pixel__swatch${i === 0 ? ' pixel__swatch--clear' : ''}`}
            style={i === 0 ? undefined : { background: c }}
            aria-pressed={selected === i}
            aria-label={i === 0 ? 'Transparent (eraser colour)' : `Colour ${i}, ${c}`}
            title={i === 0 ? 'Transparent' : `${c} · ${usage[i] ?? 0} pixels`}
            data-swatch={i}
            onClick={() => setPixelUi({ color: i })}
          />
        ))}
        <button
          type="button"
          className="pixel__swatch pixel__swatch--add"
          aria-label="Add a colour"
          title="Add a colour"
          data-action="pixel-add-colour"
          disabled={canvas.palette.length >= MAX_PALETTE}
          onClick={() => {
            try {
              const next = addPaletteColor(canvas, '#888888');
              write(next.canvas, 'Pixel art: add colour');
              setPixelUi({ color: next.index });
            } catch (e) {
              showToast(problem(e), { kind: 'error' });
            }
          }}
        >
          <Plus size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      {selected > 0 && (
        <div className="pixel__colour">
          <input
            type="color"
            aria-label="Colour picker"
            data-field="pixel-colour-input"
            value={hex.slice(0, 7)}
            onChange={(e) => change(e.target.value)}
          />
          <input
            className="textfield"
            type="text"
            aria-label="Hex colour"
            data-field="pixel-colour-hex"
            value={draft}
            maxLength={7}
            onFocus={(e) => e.target.select()}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => (draft.toUpperCase() === hex ? undefined : change(draft))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') change(draft);
            }}
          />
          <button
            type="button"
            className="icon-btn icon-btn--small"
            aria-label="Remove this colour"
            title="Remove this colour (its pixels become transparent)"
            data-action="pixel-remove-colour"
            onClick={() => {
              try {
                write(removePaletteColor(canvas, selected), 'Pixel art: remove colour');
                setPixelUi({ color: Math.max(1, selected - 1) });
              } catch (e) {
                showToast(problem(e), { kind: 'error' });
              }
            }}
          >
            <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The AI bar
// ---------------------------------------------------------------------------

function AiBar() {
  const state = usePixelAi((s) => s.state);
  const [text, setText] = useState('');
  const working = state.phase === 'working';
  return (
    <footer className="pixel__ai" aria-label="AI help">
      <div className="pixel__aiquick" role="group" aria-label="Quick AI actions">
        <button
          type="button"
          className="btn btn--small btn--secondary"
          data-action="pixel-ai-improve"
          disabled={working}
          onClick={() => void runPixelAi(QUICK_ACTIONS.improve)}
        >
          <Sparkles size={13} strokeWidth={1.75} aria-hidden="true" /> Improve
        </button>
        <button
          type="button"
          className="btn btn--small btn--secondary"
          data-action="pixel-ai-shading"
          disabled={working}
          onClick={() => void runPixelAi(QUICK_ACTIONS.shading)}
        >
          Add shading
        </button>
        <button
          type="button"
          className="btn btn--small btn--secondary"
          data-action="pixel-ai-outline"
          disabled={working}
          onClick={() => void runPixelAi(QUICK_ACTIONS.outline)}
        >
          Clean up outline
        </button>
        <button
          type="button"
          className="btn btn--small btn--secondary"
          data-action="pixel-ai-generate"
          disabled={working || text.trim() === ''}
          title="Type what to draw in the box first"
          onClick={() => void runPixelAi(generatePrompt(text))}
        >
          Generate from prompt
        </button>
      </div>
      <form
        className="pixel__aiform"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() !== '' && !working) void runPixelAi(text);
        }}
      >
        <input
          className="textfield"
          type="text"
          aria-label="Ask the AI"
          data-field="pixel-ai-text"
          placeholder="Generate a sword · Add shading · Make it look like night"
          value={text}
          disabled={working}
          onChange={(e) => setText(e.target.value)}
        />
        {working ? (
          <button
            type="button"
            className="btn btn--secondary"
            data-action="pixel-ai-cancel"
            onClick={cancelPixelAi}
          >
            Cancel
          </button>
        ) : (
          <button
            type="submit"
            className="btn btn--primary"
            data-action="pixel-ai-send"
            disabled={text.trim() === ''}
          >
            Ask
          </button>
        )}
      </form>
      <div className="pixel__aistatus" aria-live="polite" data-testid="pixel-ai-status">
        {state.phase === 'working' && (
          <span className="pixel__working">
            <span className="pixel__spinner" aria-hidden="true" /> {state.status}
          </span>
        )}
        {state.phase === 'done' && (
          <span>
            {state.message}{' '}
            <button type="button" className="linklike" onClick={dismissPixelAi}>
              Dismiss
            </button>
          </span>
        )}
        {state.phase === 'error' && (
          <span className="pixel__error" role="alert">
            {state.message}{' '}
            <button type="button" className="linklike" onClick={dismissPixelAi}>
              Dismiss
            </button>
          </span>
        )}
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

interface Gesture {
  kind: 'stroke' | 'shape' | 'pan';
  last: { x: number; y: number };
  start: { x: number; y: number };
  index: number;
  panStart?: { x: number; y: number; px: number; py: number };
}

export function PixelArtEditor() {
  const canvas = useAFrame((s) => s.doc.pixelArt);
  const ui = usePixelUi();
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const spaceDown = useRef(false);
  const [preview, setPreview] = useState<[number, number][] | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [scale, setScale] = useState(ui.exportScale);

  const starting = canvas === undefined || ui.starting;
  const paintIndex =
    ui.tool === 'eraser' ? 0 : Math.min(ui.color, (canvas?.palette.length ?? 1) - 1);

  // Focus the editor when it opens so its keys work at once.
  useEffect(() => {
    root.current?.focus();
  }, []);

  // Fit a canvas that has just been made or opened into the view.
  const fit = useCallback(() => {
    const view = stage.current?.getBoundingClientRect();
    const c = store.getState().doc.pixelArt;
    if (view && c)
      setPixelUi({
        zoom: fitZoom(c.width, c.height, view.width, view.height),
        pan: { x: 0, y: 0 },
      });
  }, []);
  const sizeKey = canvas === undefined ? '' : `${canvas.width}x${canvas.height}`;
  useEffect(() => {
    if (sizeKey !== '') fit();
  }, [sizeKey, fit]);

  // What is drawn: the document's canvas, plus the shape being dragged.
  // While a keyboard anchor is set, the shape follows the cursor; while dragging, the drag's preview.
  const livePreview =
    anchor && cursor && SHAPE_TOOLS.includes(ui.tool)
      ? shapePoints(ui.tool as ShapeTool, anchor, cursor)
      : preview;
  const shown = (() => {
    if (!canvas || !livePreview) return canvas;
    return applyBrush(canvas, livePreview, paintIndex, { x: ui.mirrorX, y: ui.mirrorY });
  })();

  useLayoutEffect(() => {
    const el = canvasEl.current;
    if (!el || !shown) return;
    el.width = shown.width;
    el.height = shown.height;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const { data, width, height } = toRgba(shown, 1);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  }, [shown]);

  // ---- pointer ----------------------------------------------------------------------------------

  const cellAt = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const el = canvasEl.current;
    if (!el || !canvas) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.floor(((e.clientX - r.left) / r.width) * canvas.width),
      y: Math.floor(((e.clientY - r.top) / r.height) * canvas.height),
    };
  };

  const mirror = { x: ui.mirrorX, y: ui.mirrorY };

  /** The tool applied at one cell, outside a drag (also what the keyboard does). */
  const tapAt = (c: PixelCanvas, x: number, y: number, tool: PixelTool): void => {
    if (tool === 'fill') {
      if (pickIndex(c, x, y) === null) return;
      write(floodFill(c, x, y, paintIndex), 'Pixel art: fill');
    } else if (tool === 'picker') {
      const i = pickIndex(c, x, y);
      if (i !== null) setPixelUi({ color: i });
    } else if (tool === 'pencil' || tool === 'eraser') {
      write(
        applyBrush(c, [[x, y]], paintIndex, mirror),
        tool === 'eraser' ? 'Pixel art: erase' : 'Pixel art: draw',
      );
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    const c = store.getState().doc.pixelArt;
    if (!c) return;
    root.current?.focus();
    if (e.button === 1 || spaceDown.current) {
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = {
        kind: 'pan',
        last: { x: 0, y: 0 },
        start: { x: 0, y: 0 },
        index: 0,
        panStart: { x: e.clientX, y: e.clientY, px: ui.pan.x, py: ui.pan.y },
      };
      return;
    }
    if (e.button !== 0) return;
    const cell = cellAt(e);
    if (!cell) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setCursor(cell);
    if (ui.tool === 'pencil' || ui.tool === 'eraser') {
      store
        .getState()
        .beginTransaction(ui.tool === 'eraser' ? 'Pixel art: erase' : 'Pixel art: draw');
      write(applyBrush(c, [[cell.x, cell.y]], paintIndex, mirror), 'Pixel art: draw');
      gesture.current = { kind: 'stroke', last: cell, start: cell, index: paintIndex };
    } else if (SHAPE_TOOLS.includes(ui.tool)) {
      gesture.current = { kind: 'shape', last: cell, start: cell, index: paintIndex };
      setPreview(shapePoints(ui.tool as ShapeTool, cell, cell));
    } else {
      tapAt(c, cell.x, cell.y, ui.tool);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>): void => {
    const g = gesture.current;
    if (g?.kind === 'pan' && g.panStart) {
      setPixelUi({
        pan: {
          x: g.panStart.px + e.clientX - g.panStart.x,
          y: g.panStart.py + e.clientY - g.panStart.y,
        },
      });
      return;
    }
    const cell = cellAt(e);
    if (!cell) return;
    if (!g) return;
    if (g.kind === 'stroke') {
      const c = store.getState().doc.pixelArt;
      if (c && (cell.x !== g.last.x || cell.y !== g.last.y)) {
        write(
          applyBrush(c, linePoints(g.last.x, g.last.y, cell.x, cell.y), g.index, mirror),
          'Pixel art: draw',
        );
        g.last = cell;
      }
    } else if (g.kind === 'shape' && (cell.x !== g.last.x || cell.y !== g.last.y)) {
      g.last = cell;
      setPreview(shapePoints(ui.tool as ShapeTool, g.start, cell));
    }
  };

  const endGesture = (cancel = false): void => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'stroke') store.getState().endTransaction();
    else if (g.kind === 'shape') {
      const c = store.getState().doc.pixelArt;
      if (c && !cancel) {
        write(
          applyBrush(c, shapePoints(ui.tool as ShapeTool, g.start, g.last), g.index, mirror),
          ui.tool === 'line' ? 'Pixel art: line' : 'Pixel art: rectangle',
        );
      }
      setPreview(null);
    }
  };

  // ---- zoom and pan ----------------------------------------------------------------------------

  const zoomBy = (delta: number): void => setPixelUi({ zoom: clampZoom(ui.zoom + delta) });

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const z = usePixelUi.getState().zoom;
      setPixelUi({
        zoom: clampZoom(
          z + (e.deltaY < 0 ? Math.max(1, Math.round(z / 6)) : -Math.max(1, Math.round(z / 6))),
        ),
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [starting]);

  // ---- keyboard --------------------------------------------------------------------------------

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>): void => {
    const target = e.target as HTMLElement;
    const typing =
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
    if (typing) {
      // Typing in a field must not reach the design's shortcuts (Delete, V, R...).
      e.stopPropagation();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const c = store.getState().doc.pixelArt;
    let handled = true;
    if (mod && key === 'z' && !e.shiftKey) store.getState().undo();
    else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) store.getState().redo();
    else if (mod) handled = false;
    else if (key === ' ') {
      spaceDown.current = true;
      if (c && cursor) activate(c);
    } else if (key === 'p') setPixelUi({ tool: 'pencil' });
    else if (key === 'e') setPixelUi({ tool: 'eraser' });
    else if (key === 'f') setPixelUi({ tool: 'fill' });
    else if (key === 'l') setPixelUi({ tool: 'line' });
    else if (key === 'r') setPixelUi({ tool: e.shiftKey ? 'rectFilled' : 'rect' });
    else if (key === 'i') setPixelUi({ tool: 'picker' });
    else if (key === 'm')
      setPixelUi(e.shiftKey ? { mirrorY: !ui.mirrorY } : { mirrorX: !ui.mirrorX });
    else if (key === 'g') setPixelUi({ grid: !ui.grid });
    else if (key === '+' || key === '=') zoomBy(Math.max(1, Math.round(ui.zoom / 6)));
    else if (key === '-') zoomBy(-Math.max(1, Math.round(ui.zoom / 6)));
    else if (key === '0') fit();
    else if (key === '[' && c) setPixelUi({ color: Math.max(0, ui.color - 1) });
    else if (key === ']' && c) setPixelUi({ color: Math.min(c.palette.length - 1, ui.color + 1) });
    else if (key === 'escape') {
      if (gesture.current) endGesture(true);
      else if (anchor) setAnchor(null);
      else if (ui.starting && canvas) setPixelUi({ starting: false });
      else closePixelEditor();
    } else if (key === 'enter') {
      if (c && cursor) activate(c);
    } else if (key.startsWith('arrow') && c) {
      const step = e.shiftKey ? 4 : 1;
      const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
      const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
      const from = cursor ?? { x: 0, y: 0 };
      setCursor({
        x: Math.min(c.width - 1, Math.max(0, from.x + (cursor ? dx : 0))),
        y: Math.min(c.height - 1, Math.max(0, from.y + (cursor ? dy : 0))),
      });
    } else handled = false;
    // Whatever the editor handles never reaches the design underneath; Ctrl+K and the like still do.
    if (handled || !mod) e.stopPropagation();
    if (handled) e.preventDefault();
  };

  /** Enter / Space at the keyboard cursor: the same as a click with the current tool. */
  const activate = (c: PixelCanvas): void => {
    if (!cursor) return;
    if (SHAPE_TOOLS.includes(ui.tool)) {
      if (!anchor) {
        setAnchor(cursor);
        setPreview(shapePoints(ui.tool as ShapeTool, cursor, cursor));
      } else {
        write(
          applyBrush(c, shapePoints(ui.tool as ShapeTool, anchor, cursor), paintIndex, mirror),
          ui.tool === 'line' ? 'Pixel art: line' : 'Pixel art: rectangle',
        );
        setAnchor(null);
        setPreview(null);
      }
      return;
    }
    tapAt(c, cursor.x, cursor.y, ui.tool);
  };

  if (!canvas || ui.starting) {
    return (
      <section
        ref={root}
        className="pixel"
        data-pixel-editor
        data-testid="pixel-editor"
        aria-label="Pixel art editor"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="pixel__bar">
          <h2>
            Pixel Art <span className="pixel__beta">beta</span>
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close the pixel art editor"
            data-action="pixel-close"
            onClick={closePixelEditor}
          >
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>
        <StartScreen
          replacing={canvas !== undefined}
          onDone={() => setPixelUi({ starting: false })}
        />
      </section>
    );
  }

  const cell = ui.zoom;
  const history = store.getState().history;

  return (
    <section
      ref={root}
      className="pixel"
      data-pixel-editor
      data-testid="pixel-editor"
      aria-label="Pixel art editor"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => {
        if (e.key === ' ') spaceDown.current = false;
      }}
    >
      <header className="pixel__bar">
        <h2>
          Pixel Art <span className="pixel__beta">beta</span>
        </h2>
        <span className="pixel__size" data-testid="pixel-size">
          {canvas.width} × {canvas.height} · {canvas.palette.length - 1} colours
        </span>
        <span className="pixel__spacer" />
        <button
          type="button"
          className="icon-btn"
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          data-action="pixel-undo"
          disabled={history.past.length === 0}
          onClick={() => store.getState().undo()}
        >
          <Undo2 size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Redo"
          title="Redo (Ctrl+Y)"
          data-action="pixel-redo"
          disabled={history.future.length === 0}
          onClick={() => store.getState().redo()}
        >
          <Redo2 size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn btn--small btn--secondary"
          data-action="pixel-new"
          onClick={() => setPixelUi({ starting: true })}
        >
          <FilePlus2 size={13} strokeWidth={1.75} aria-hidden="true" /> New or open…
        </button>
        <button
          type="button"
          className="btn btn--small btn--secondary"
          data-action="pixel-save"
          onClick={() =>
            download(
              'pixel-art.json',
              new Blob([serializePixelFile(canvas)], { type: 'application/json' }),
            )
          }
        >
          <Save size={13} strokeWidth={1.75} aria-hidden="true" /> Save JSON
        </button>
        <label className="pixel__scale">
          <span className="visually-hidden">PNG scale</span>
          <select
            aria-label="PNG scale"
            data-field="pixel-export-scale"
            value={scale}
            onChange={(e) => {
              setScale(Number(e.target.value));
              setPixelUi({ exportScale: Number(e.target.value) });
            }}
          >
            {[1, 2, 4, 8, 16, 32].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn--small btn--secondary"
          data-action="pixel-export"
          onClick={() => {
            try {
              const { width, height, data } = toRgba(canvas, scale);
              const out = document.createElement('canvas');
              out.width = width;
              out.height = height;
              out
                .getContext('2d')
                ?.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
              out.toBlob(
                (blob) =>
                  blob
                    ? download('pixel-art.png', blob)
                    : showToast('The PNG could not be made.', { kind: 'error' }),
                'image/png',
              );
            } catch (e) {
              showToast(problem(e), { kind: 'error' });
            }
          }}
        >
          <Download size={13} strokeWidth={1.75} aria-hidden="true" /> Export PNG
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close the pixel art editor"
          data-action="pixel-close"
          onClick={closePixelEditor}
        >
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </header>

      <div className="pixel__body">
        <div
          className="pixel__tools"
          role="toolbar"
          aria-label="Pixel art tools"
          aria-orientation="vertical"
        >
          {PIXEL_TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="icon-btn pixel__tool"
              aria-pressed={ui.tool === t.id}
              aria-label={t.label}
              title={`${t.label} (${t.key})`}
              data-tool={t.id}
              onClick={() => setPixelUi({ tool: t.id })}
            >
              <ToolGlyph tool={t.id} />
            </button>
          ))}
          <span className="pixel__rule" />
          <button
            type="button"
            className="icon-btn pixel__tool"
            aria-pressed={ui.mirrorX}
            aria-label="Mirror drawing left and right"
            title="Mirror left-right (M)"
            data-action="pixel-mirror-x"
            onClick={() => setPixelUi({ mirrorX: !ui.mirrorX })}
          >
            <FlipHorizontal2 size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn pixel__tool"
            aria-pressed={ui.mirrorY}
            aria-label="Mirror drawing up and down"
            title="Mirror up-down (Shift+M)"
            data-action="pixel-mirror-y"
            onClick={() => setPixelUi({ mirrorY: !ui.mirrorY })}
          >
            <FlipVertical2 size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn pixel__tool"
            aria-pressed={ui.grid}
            aria-label="Show grid"
            title="Grid (G)"
            data-action="pixel-grid"
            onClick={() => setPixelUi({ grid: !ui.grid })}
          >
            <Grid3x3 size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <span className="pixel__rule" />
          <button
            type="button"
            className="icon-btn pixel__tool"
            aria-label="Zoom in"
            title="Zoom in (+)"
            data-action="pixel-zoom-in"
            onClick={() => zoomBy(Math.max(1, Math.round(ui.zoom / 6)))}
          >
            <ZoomIn size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn pixel__tool"
            aria-label="Zoom out"
            title="Zoom out (-)"
            data-action="pixel-zoom-out"
            onClick={() => zoomBy(-Math.max(1, Math.round(ui.zoom / 6)))}
          >
            <ZoomOut size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn pixel__tool"
            aria-label="Fit to view"
            title="Fit (0)"
            data-action="pixel-fit"
            onClick={fit}
          >
            <Maximize size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div
          className="pixel__stage"
          ref={stage}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => endGesture()}
          onPointerCancel={() => endGesture(true)}
          onAuxClick={(e) => e.preventDefault()}
        >
          <div
            className={`pixel__sheet${ui.grid && cell >= 6 ? ' pixel__sheet--grid' : ''}`}
            style={{
              width: canvas.width * cell,
              height: canvas.height * cell,
              transform: `translate(${ui.pan.x}px, ${ui.pan.y}px)`,
              ['--cell' as string]: `${cell}px`,
            }}
          >
            <canvas
              ref={canvasEl}
              className="pixel__canvas"
              data-testid="pixel-canvas"
              role="img"
              aria-label={`Pixel art, ${canvas.width} by ${canvas.height}. Use the arrow keys to move the cursor and Enter to draw.`}
              style={{ width: canvas.width * cell, height: canvas.height * cell }}
            />
            {cursor && cursor.x < canvas.width && cursor.y < canvas.height && (
              <span
                className="pixel__cursor"
                data-testid="pixel-cursor"
                style={{ left: cursor.x * cell, top: cursor.y * cell, width: cell, height: cell }}
              />
            )}
          </div>
        </div>

        <aside className="pixel__side">
          <Palette canvas={canvas} />
          <ResizePanel key={`${canvas.width}x${canvas.height}`} canvas={canvas} />
        </aside>
      </div>
      <AiBar />
    </section>
  );
}

function ToolGlyph({ tool }: { tool: PixelTool }) {
  switch (tool) {
    case 'pencil':
      return (
        <span className="pixel__glyph" aria-hidden="true">
          ✎
        </span>
      );
    case 'eraser':
      return (
        <span className="pixel__glyph" aria-hidden="true">
          ⌫
        </span>
      );
    case 'fill':
      return (
        <span className="pixel__glyph" aria-hidden="true">
          ▧
        </span>
      );
    case 'line':
      return (
        <span className="pixel__glyph" aria-hidden="true">
          ╱
        </span>
      );
    case 'rect':
      return <Square size={15} strokeWidth={1.75} aria-hidden="true" />;
    case 'rectFilled':
      return <Square size={15} strokeWidth={1.75} fill="currentColor" aria-hidden="true" />;
    case 'picker':
      return (
        <span className="pixel__glyph" aria-hidden="true">
          ◉
        </span>
      );
  }
}

function ResizePanel({ canvas }: { canvas: PixelCanvas }) {
  // The parent keys this panel by the canvas size, so the fields start from the current size.
  const [w, setW] = useState(canvas.width);
  const [h, setH] = useState(canvas.height);
  return (
    <section className="pixel__panel" aria-label="Canvas size">
      <h3>Size</h3>
      <div className="pixel__custom">
        <input
          className="textfield"
          type="number"
          min={1}
          max={MAX_PIXEL_SIZE}
          value={w}
          aria-label="Width"
          data-field="pixel-w"
          onChange={(e) => setW(Number(e.target.value))}
        />
        <span aria-hidden="true">×</span>
        <input
          className="textfield"
          type="number"
          min={1}
          max={MAX_PIXEL_SIZE}
          value={h}
          aria-label="Height"
          data-field="pixel-h"
          onChange={(e) => setH(Number(e.target.value))}
        />
        <button
          type="button"
          className="btn btn--small btn--secondary"
          data-action="pixel-resize"
          disabled={w === canvas.width && h === canvas.height}
          onClick={() => {
            try {
              write(resizeCanvas(canvas, w, h), 'Pixel art: resize');
            } catch (e) {
              showToast(problem(e), { kind: 'error' });
            }
          }}
        >
          Resize
        </button>
      </div>
      <p className="pixel__note">
        Keeps the top-left; anything cut off is lost (undo restores it).
      </p>
    </section>
  );
}
