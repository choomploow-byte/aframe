import { applyImport } from '@core/import/apply';
import { importDom, type DomSnapshot } from '@core/import/dom';
import { importFigma, listFigmaFrames, type FigmaFrameInfo } from '@core/import/figma';
import { importSvg } from '@core/import/svg';
import { ImportError, summarise, type ImportResult } from '@core/import/types';
import { CheckCircle2, FileUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { getCanvasApi } from '../canvas/canvas-api';
import { openChat } from '../chat/focus';
import { readImage } from '../chat/images';
import { chatReadiness, sendChat } from '../chat/session';
import {
  FigmaError,
  clearToken,
  figmaAvailable,
  hasToken,
  loadFrame,
  loadOutline,
  loadPictures,
  saveToken,
} from '../import/figma-client';
import { store } from '../store/store';
import { Dialog } from './Dialog';
import { importFiles } from './image-import';
import { Tabs } from './Tabs';
import { showToast } from './toast';
import { closeDialog } from './ui-state';

type Tab = 'svg' | 'figma' | 'web' | 'canva';

const REBUILD_PROMPT =
  'Rebuild the image I just added as an editable design: structure first with auto-layout frames, then tokens for the colours and fonts, then check it with a screenshot against the image and fix the biggest differences.';

const messageOf = (e: unknown): string =>
  e instanceof ImportError || e instanceof FigmaError || e instanceof Error
    ? e.message
    : 'That file could not be imported.';

/** Puts an import on the canvas as one undo step, in the middle of the view. */
function addToCanvas(result: ImportResult): void {
  const s = store.getState();
  const w = typeof result.spec?.w === 'number' ? result.spec.w : 400;
  const h = typeof result.spec?.h === 'number' ? result.spec.h : 300;
  const centre = getCanvasApi()?.viewCenter() ?? { x: 0, y: 0 };
  const out = applyImport(s.doc, result, {
    x: Math.round(centre.x - w / 2),
    y: Math.round(centre.y - h / 2),
  });
  s.commitExternal(out.doc, `Import ${result.name}`);
  s.setSelection([out.nodeId]);
  getCanvasApi()?.fitSelection();
  closeDialog();
  showToast(`Imported "${result.name}".`, {
    action: { label: 'Undo', run: () => void store.getState().undo() },
  });
}

/** What came across, what was approximated, and what was left out, in plain words. */
function Report({ result }: { result: ImportResult }) {
  const sum = summarise(result.report);
  const groups = (['approximated', 'fallback', 'skipped'] as const).map((kind) => ({
    kind,
    items: result.report.filter((r) => r.kind === kind),
  }));
  const colors = Object.entries(result.colors);
  return (
    <div className="import__report" data-testid="import-report">
      <p className="import__summary" data-testid="import-summary">
        <CheckCircle2 size={15} strokeWidth={1.75} aria-hidden="true" />
        {sum.converted} layer{sum.converted === 1 ? '' : 's'} came across editable
        {sum.fallback > 0 ? `, ${sum.fallback} as a picture` : ''}
        {sum.skipped > 0 ? `, ${sum.skipped} left out` : ''} ({sum.editablePct}% editable).
      </p>
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <details key={g.kind} className="import__group">
            <summary>
              {g.kind === 'approximated'
                ? 'Changed a little'
                : g.kind === 'fallback'
                  ? 'Kept as a picture or placeholder'
                  : 'Left out'}{' '}
              ({g.items.length})
            </summary>
            <ul>
              {g.items.slice(0, 40).map((r, i) => (
                <li key={i}>
                  <strong>{r.what}</strong>
                  {r.why ? `: ${r.why}` : ''}
                </li>
              ))}
            </ul>
          </details>
        ))}
      {colors.length > 0 && (
        <p className="dialog__muted import__colors">
          Colours used more than once (worth making tokens):{' '}
          {colors.map(([hex, n]) => `${hex} ×${n}`).join(', ')}
        </p>
      )}
    </div>
  );
}

function FilePicker({
  accept,
  label,
  onFile,
  testId,
}: {
  accept: string;
  label: string;
  onFile: (f: File) => void;
  testId: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn--secondary"
        data-action={`pick-${testId}`}
        onClick={() => input.current?.click()}
      >
        <FileUp size={14} strokeWidth={1.75} aria-hidden="true" /> {label}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        data-testid={testId}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </>
  );
}

function Result({ result, onAdd }: { result: ImportResult | null; onAdd: () => void }) {
  if (result === null) return null;
  return (
    <>
      <Report result={result} />
      <div className="dialog__footer">
        <button
          type="button"
          className="btn btn--primary"
          data-action="import-add"
          disabled={result.spec === null}
          onClick={onAdd}
        >
          Add to the design
        </button>
      </div>
    </>
  );
}

function SvgTab() {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="import__panel">
      <p className="dialog__muted">
        Rectangles, circles, text and groups become layers you can edit; shapes drawn with paths
        come in as a picture of exactly that drawing. Nothing is downloaded.
      </p>
      <FilePicker
        accept=".svg,image/svg+xml"
        label="Choose an SVG file"
        testId="import-svg-file"
        onFile={(f) => {
          setError(null);
          void f.text().then((text) => {
            try {
              setResult(importSvg(text, f.name));
            } catch (e) {
              setResult(null);
              setError(messageOf(e));
            }
          });
        }}
      />
      {error !== null && (
        <p className="import__error" role="alert" data-testid="import-error">
          {error}
        </p>
      )}
      <Result result={result} onAdd={() => result && tryAdd(result, setError)} />
    </div>
  );
}

function tryAdd(result: ImportResult, setError: (m: string) => void): void {
  try {
    addToCanvas(result);
  } catch (e) {
    setError(messageOf(e));
  }
}

function FigmaTab() {
  const desktop = figmaAvailable();
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState<boolean | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outline, setOutline] = useState<{
    key: string;
    file: unknown;
    frames: FigmaFrameInfo[];
  } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  if (desktop && saved === null)
    void hasToken()
      .then(setSaved)
      .catch(() => setSaved(false));

  const guard = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const importFrame = (key: string, frameId: string) =>
    guard(async () => {
      const frame = await loadFrame(key, frameId);
      const pictures = await loadPictures(key, frame, frameId);
      setResult(importFigma(frame, { frameId, ...pictures }));
    });

  return (
    <div className="import__panel">
      <p className="dialog__muted">
        AFrame reads a frame from your Figma file: layout, text styles, colours, corners and shadows
        come across as layers; shapes drawn as vectors come in as pictures. Components arrive as
        plain frames.
      </p>
      {desktop ? (
        <>
          <div className="import__row">
            <span>Figma token</span>
            {saved ? (
              <span className="import__saved">
                Saved in your system keychain{' '}
                <button
                  type="button"
                  className="linklike"
                  onClick={() => void clearToken().then(() => setSaved(false))}
                >
                  Remove
                </button>
              </span>
            ) : (
              <span className="import__tokenrow">
                <input
                  className="textfield"
                  type="password"
                  aria-label="Figma personal access token"
                  data-field="figma-token"
                  placeholder="figd_…"
                  value={token}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setToken(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  data-action="figma-save-token"
                  disabled={token.trim() === ''}
                  onClick={() =>
                    void guard(async () => {
                      await saveToken(token);
                      setToken('');
                      setSaved(true);
                    })
                  }
                >
                  Save
                </button>
              </span>
            )}
          </div>
          <p className="dialog__muted import__hint">
            Make a personal access token in Figma (Settings, Security) with permission to read
            files. It stays on this computer.
          </p>
          <div className="import__row">
            <span>File link</span>
            <input
              className="textfield"
              type="text"
              aria-label="Figma file link"
              data-field="figma-url"
              placeholder="https://www.figma.com/design/…"
              value={url}
              spellCheck={false}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="import__actions">
            <button
              type="button"
              className="btn btn--secondary"
              data-action="figma-load"
              disabled={busy || !saved || url.trim() === ''}
              onClick={() =>
                void guard(async () => {
                  const o = await loadOutline(url);
                  const frames = listFigmaFrames(o.file);
                  if (frames.length === 0)
                    throw new Error('That file has no frames at the top of any page.');
                  setOutline({ key: o.key, file: o.file, frames });
                  setResult(null);
                  const wanted = o.nodeId ? frames.find((f) => f.id === o.nodeId) : undefined;
                  if (wanted) await importFrame(o.key, wanted.id);
                })
              }
            >
              {busy ? 'Working…' : 'Load frames'}
            </button>
          </div>
          {outline !== null && (
            <ul className="import__frames" data-testid="figma-frames">
              {outline.frames.map((f) => (
                <li key={f.id}>
                  <span>
                    <strong>{f.name}</strong>{' '}
                    <span className="dialog__muted">
                      {f.page} · {f.width}×{f.height}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn--small btn--secondary"
                    disabled={busy}
                    data-action="figma-import-frame"
                    onClick={() => void importFrame(outline.key, f.id)}
                  >
                    Import
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="dialog__muted">
          Reaching Figma needs the desktop app (it keeps your token in the system keychain). You can
          still import a saved file here.
        </p>
      )}
      <div className="import__row">
        <span>Or a saved file</span>
        <FilePicker
          accept=".json,application/json"
          label="Choose a Figma JSON file"
          testId="import-figma-file"
          onFile={(f) => {
            setError(null);
            void f.text().then((text) => {
              try {
                const json = JSON.parse(text) as unknown;
                const frames = listFigmaFrames(json);
                if (frames.length === 0)
                  throw new ImportError('That file has no frames at the top of any page.');
                setOutline({ key: '', file: json, frames });
                setResult(importFigma(json, { frameId: (frames[0] as FigmaFrameInfo).id }));
              } catch (e) {
                setResult(null);
                setError(e instanceof SyntaxError ? 'That is not a JSON file.' : messageOf(e));
              }
            });
          }}
        />
      </div>
      {error !== null && (
        <p className="import__error" role="alert" data-testid="import-error">
          {error}
        </p>
      )}
      <Result result={result} onAdd={() => result && tryAdd(result, setError)} />
    </div>
  );
}

function WebTab() {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="import__panel">
      <p className="dialog__muted">
        A prototype for starting from the app you already built. Capture your running page with the
        script in the AFrame repository, then choose the file it writes. Sizes are fixed at the
        captured width, flex layouts become auto-layout, and pictures become grey placeholders.
      </p>
      <pre className="copyblock__text import__code">
        npm run capture-dom -- http://localhost:3000 --out my-app
      </pre>
      <FilePicker
        accept=".json,application/json"
        label="Choose the capture (.json)"
        testId="import-web-file"
        onFile={(f) => {
          setError(null);
          void f.text().then((text) => {
            try {
              const snap = JSON.parse(text) as DomSnapshot;
              setResult(importDom(snap));
            } catch (e) {
              setResult(null);
              setError(e instanceof SyntaxError ? 'That is not a page capture.' : messageOf(e));
            }
          });
        }}
      />
      {error !== null && (
        <p className="import__error" role="alert" data-testid="import-error">
          {error}
        </p>
      )}
      <Result result={result} onAdd={() => result && tryAdd(result, setError)} />
    </div>
  );
}

function CanvaTab() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="import__panel">
      <p className="dialog__muted" data-testid="canva-note">
        Canva designs come in as images and are rebuilt by AI. AFrame cannot open a Canva file
        itself: Canva keeps its format closed.
      </p>
      <ol className="import__steps">
        <li>In Canva choose Share, then Download, and pick PNG (or SVG for simple graphics).</li>
        <li>Choose the downloaded image below. It is added to your design.</li>
        <li>
          Press Rebuild: the AI recreates it as editable frames, text and colours, then checks its
          work against your image. Expect a close match, not an exact copy.
        </li>
      </ol>
      <FilePicker
        accept="image/png,image/jpeg,image/webp,image/gif"
        label="Choose the image and rebuild it"
        testId="import-canva-file"
        onFile={(f) => {
          setError(null);
          void (async () => {
            try {
              const image = await readImage(f);
              await importFiles([f], { insert: true });
              if ((await chatReadiness()).ok) {
                closeDialog();
                openChat();
                void sendChat(REBUILD_PROMPT, [image]);
              } else {
                try {
                  await navigator.clipboard.writeText(
                    'in aframe, rebuild the image I just added as an editable design',
                  );
                  setDone(
                    'The image is on your canvas. Say this to Claude Code or Codex (copied): "in aframe, rebuild the image I just added as an editable design".',
                  );
                } catch {
                  setDone(
                    'The image is on your canvas. Ask your AI: "in aframe, rebuild the image I just added as an editable design".',
                  );
                }
              }
            } catch (e) {
              setError(messageOf(e));
            }
          })();
        }}
      />
      {done !== null && (
        <p className="import__summary" role="status" data-testid="canva-done">
          {done}
        </p>
      )}
      {error !== null && (
        <p className="import__error" role="alert" data-testid="import-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** Import: SVG, Figma, a captured web page, or an image to rebuild (Canva and screenshots). */
export function ImportDialog() {
  const [tab, setTab] = useState<Tab>('svg');
  return (
    <Dialog title="Import" onClose={closeDialog} width={620}>
      <div className="dialog__body import" data-testid="import-dialog">
        <Tabs<Tab>
          label="What to import"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'svg', label: 'SVG' },
            { id: 'figma', label: 'Figma' },
            { id: 'web', label: 'Web page' },
            { id: 'canva', label: 'Canva or image' },
          ]}
        >
          {tab === 'svg' ? (
            <SvgTab />
          ) : tab === 'figma' ? (
            <FigmaTab />
          ) : tab === 'web' ? (
            <WebTab />
          ) : (
            <CanvaTab />
          )}
        </Tabs>
      </div>
    </Dialog>
  );
}
