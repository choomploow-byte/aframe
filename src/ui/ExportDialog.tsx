import { Check, Copy, Download, FolderOpen } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { base64ToBytes } from '@core/assets';
import { EXPORT_FORMATS, exportDesign, kebab, type ExportFormat } from '@core/export';
import { exportTarget, useExportTarget, type ExportMode } from '../export/dialog-state';
import { getExportSink, type SaveOutcome, type SinkFile } from '../platform/export-sink';
import { store, useAFrame } from '../store/store';
import { STRINGS } from '../strings';
import { Dialog } from './Dialog';
import { Segmented, Select, Toggle } from './fields';
import { Tabs } from './Tabs';
import { showToast } from './toast';
import { closeDialog } from './ui-state';

const t = STRINGS.export;
const PREVIEW_LIMIT = 24_000;

type Scale = '1' | '2' | '3';
type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; text: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'error'; message: string };

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function outcomeStatus(o: SaveOutcome): Status {
  switch (o.kind) {
    case 'saved': {
      const n = o.written.length;
      const same = o.unchanged.length;
      const parts = [
        n > 0 ? `${n} file${n === 1 ? '' : 's'} saved` : 'Nothing new to save',
        same > 0 ? `${same} already up to date` : '',
      ].filter(Boolean);
      return { kind: 'done', text: `${parts.join(', ')} in ${o.where}.` };
    }
    case 'conflict':
      return { kind: 'conflict', message: o.message };
    case 'cancelled':
      return { kind: 'idle' };
    case 'failed':
      return { kind: 'error', message: o.message };
  }
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === 'idle' || status.kind === 'busy') {
    return <p className="export__status" role="status" />;
  }
  return (
    <p
      className={`export__status export__status--${status.kind}`}
      role={status.kind === 'error' ? 'alert' : 'status'}
      data-testid="export-status"
      data-state={status.kind}
    >
      {status.kind === 'done' ? <Check size={13} strokeWidth={2} aria-hidden="true" /> : null}
      {status.kind === 'done' ? status.text : status.message}
    </p>
  );
}

/** Where the files go: the chosen folder (desktop) or a download (browser). */
function useSink() {
  const [kind, setKind] = useState<'folder' | 'download' | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void getExportSink().then(async (sink) => {
      const current = await sink.folder().catch(() => null);
      if (live) {
        setKind(sink.kind);
        setFolder(current);
      }
    });
    return () => {
      live = false;
    };
  }, []);
  return { kind, folder, setFolder };
}

interface SaveProps {
  files: () => Promise<SinkFile[]> | SinkFile[];
  suggestedName: string;
  sink: ReturnType<typeof useSink>;
  disabled?: boolean;
  label: string;
}

/** Save button, folder line and the "replace existing files" step, shared by both tabs. */
function SaveBar({ files, suggestedName, sink, disabled, label }: SaveProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const run = async (overwrite: boolean, forcePick: boolean): Promise<void> => {
    setStatus({ kind: 'busy' });
    try {
      const target = await getExportSink();
      if (target.kind === 'folder' && (forcePick || sink.folder === null)) {
        const picked = await target.pickFolder();
        if (picked === null) {
          setStatus({ kind: 'idle' });
          return;
        }
        sink.setFolder(picked);
        if (forcePick && !overwrite) {
          setStatus({ kind: 'idle' });
          return;
        }
      }
      const outcome = await target.save(await files(), { overwrite, suggestedName });
      setStatus(outcomeStatus(outcome));
    } catch (e) {
      setStatus({ kind: 'error', message: messageOf(e) });
    }
  };
  const busy = status.kind === 'busy';
  const Icon = sink.kind === 'folder' ? FolderOpen : Download;
  return (
    <div className="export__save">
      {sink.kind === 'folder' && (
        <p className="export__folder" data-testid="export-folder">
          {sink.folder === null ? t.noFolder : t.savingTo(sink.folder)}{' '}
          {sink.folder !== null && (
            <button
              type="button"
              className="linklike"
              data-action="export-change-folder"
              onClick={() => void run(false, true)}
            >
              {t.changeFolder}
            </button>
          )}
        </p>
      )}
      <StatusLine status={status} />
      <div className="export__actions">
        {status.kind === 'conflict' && (
          <button
            type="button"
            className="btn btn--secondary"
            data-action="export-overwrite"
            onClick={() => void run(true, false)}
          >
            {t.replace}
          </button>
        )}
        <button
          type="button"
          className="btn btn--primary"
          data-action="export-save"
          disabled={disabled || sink.kind === null}
          aria-disabled={busy || undefined}
          onClick={() => {
            // Not `disabled` while saving: that would drop keyboard focus out of the dialog.
            if (!busy) void run(false, false);
          }}
        >
          <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
          {busy ? t.saving : label}
        </button>
      </div>
    </div>
  );
}

function CodeTab({ nodeId }: { nodeId: string }) {
  const doc = useAFrame((s) => s.doc);
  const sink = useSink();
  const [format, setFormat] = useState<ExportFormat>('react-css');
  const [name, setName] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const node = doc.nodes[nodeId];
  const result = useMemo(() => {
    try {
      return {
        ok: true as const,
        value: exportDesign(doc, nodeId, format, name.trim() === '' ? {} : { componentName: name }),
      };
    } catch (e) {
      return { ok: false as const, message: messageOf(e) };
    }
  }, [doc, nodeId, format, name]);

  if (!result.ok) {
    return (
      <p className="export__status export__status--error" role="alert">
        {result.message}
      </p>
    );
  }
  const { files, main, warnings } = result.value;
  const shown = files.find((f) => f.path === (fileName ?? main)) ?? files[0];
  const text = shown && typeof shown.content === 'string' ? shown.content : null;
  const preview =
    text === null
      ? null
      : text.length > PREVIEW_LIMIT
        ? `${text.slice(0, PREVIEW_LIMIT)}\n… ${text.length - PREVIEW_LIMIT} more characters (they are in the exported file)`
        : text;

  const copy = (): void => {
    if (text === null) return;
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2000);
      })
      .catch(() =>
        showToast('Copying was blocked. Select the code and press Ctrl+C.', { kind: 'error' }),
      );
  };

  return (
    <div className="export__panel">
      <Segmented
        ariaLabel={t.format}
        field="export-format"
        value={format}
        options={EXPORT_FORMATS.map((f) => ({ value: f.id, label: f.label, title: f.description }))}
        onChange={(v) => {
          setFormat(v);
          setFileName(null);
        }}
      />
      <p className="dialog__muted export__hint">
        {EXPORT_FORMATS.find((f) => f.id === format)?.description}
      </p>
      {format !== 'html' && (
        <label className="export__row">
          <span>{t.componentName}</span>
          <input
            className="textfield"
            type="text"
            data-field="export-component"
            value={name}
            placeholder={result.value.componentName}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}
      <div className="copyblock">
        <div className="copyblock__bar">
          <Select
            ariaLabel={t.file}
            field="export-file"
            value={shown?.path}
            options={files.map((f) => ({ value: f.path, label: f.path }))}
            onChange={setFileName}
          />
          <button
            type="button"
            className="btn btn--small btn--secondary"
            data-action="export-copy"
            disabled={text === null}
            onClick={copy}
          >
            {copied ? (
              <Check size={13} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Copy size={13} strokeWidth={1.75} aria-hidden="true" />
            )}
            {copied ? t.copied : t.copy}
          </button>
        </div>
        <pre className="copyblock__text export__code" tabIndex={0} data-testid="export-preview">
          {preview ?? t.binary(shown?.path ?? '')}
        </pre>
      </div>
      {warnings.length > 0 && (
        <details className="export__notes">
          <summary>{t.notes(warnings.length)}</summary>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      <SaveBar
        sink={sink}
        suggestedName={kebab(node?.name ?? 'design', 'design')}
        label={sink.kind === 'download' ? t.download(files.length) : t.saveFiles(files.length)}
        files={() => files.map((f) => ({ path: f.path, content: f.content }))}
      />
    </div>
  );
}

function ImageTab({ nodeId }: { nodeId: string }) {
  const doc = useAFrame((s) => s.doc);
  const sink = useSink();
  const [format, setFormat] = useState<'png' | 'svg'>('png');
  const [scale, setScale] = useState<Scale>('2');
  const [transparent, setTransparent] = useState(false);
  const [copied, setCopied] = useState(false);
  const node = doc.nodes[nodeId];

  /** The picture in the app's own renderer, as bytes. */
  const render = async (
    fmt: 'png' | 'svg',
  ): Promise<{ bytes: Uint8Array; width: number; height: number }> => {
    const { captureExport } = await import('../canvas/screenshot');
    const s = store.getState();
    const out = await captureExport(s.doc, s.viewport.zoom, {
      nodeId,
      format: fmt,
      scale: Number(scale) as 1 | 2 | 3,
      transparent: fmt === 'png' && transparent,
    });
    const bytes = base64ToBytes(out.dataBase64);
    if (!bytes) throw new Error('The picture could not be read back.');
    return { bytes, width: out.width, height: out.height };
  };

  const base = kebab(node?.name ?? 'design', 'design');
  const fileName = `${base}${format === 'png' && scale !== '1' ? `@${scale}x` : ''}.${format}`;
  // The size on the canvas (a hugging frame has no fixed height in the document).
  const [bounds, setBounds] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    let live = true;
    // The screenshot module (html-to-image) loads on demand, not with the app.
    void import('../canvas/screenshot').then((m) => {
      if (live) setBounds(m.nodeBounds(nodeId, store.getState().viewport.zoom));
    });
    return () => {
      live = false;
    };
  }, [nodeId, doc]);
  const w = bounds?.width ?? null;
  const h = bounds?.height ?? null;

  const copyImage = async (): Promise<void> => {
    try {
      const { bytes } = await render('png');
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([bytes as BlobPart], { type: 'image/png' }) }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      showToast(`Could not copy the image: ${messageOf(e)}`, { kind: 'error' });
    }
  };

  return (
    <div className="export__panel">
      <div className="export__row">
        <span>{t.imageFormat}</span>
        <Segmented
          ariaLabel={t.imageFormat}
          field="export-image-format"
          value={format}
          options={[
            { value: 'png', label: 'PNG', title: t.pngHint },
            { value: 'svg', label: 'SVG', title: t.svgHint },
          ]}
          onChange={setFormat}
        />
      </div>
      {format === 'png' ? (
        <>
          <div className="export__row">
            <span>{t.scale}</span>
            <Segmented
              ariaLabel={t.scale}
              field="export-scale"
              value={scale}
              options={[
                { value: '1', label: '1x' },
                { value: '2', label: '2x' },
                { value: '3', label: '3x' },
              ]}
              onChange={setScale}
            />
          </div>
          <div className="export__row">
            <span>{t.transparent}</span>
            <Toggle
              ariaLabel={t.transparent}
              field="export-transparent"
              checked={transparent}
              onChange={setTransparent}
            />
          </div>
          {w !== null && (
            <p className="dialog__muted export__hint" data-testid="export-size">
              {t.size(w * Number(scale), h === null ? null : h * Number(scale))}
            </p>
          )}
        </>
      ) : (
        <p className="dialog__muted export__hint">{t.svgHint}</p>
      )}
      <SaveBar
        sink={sink}
        suggestedName={base}
        label={sink.kind === 'download' ? t.downloadImage(fileName) : t.saveImage(fileName)}
        files={async () => [{ path: fileName, content: (await render(format)).bytes }]}
      />
      {format === 'png' && (
        <button
          type="button"
          className="btn btn--secondary export__copyimage"
          data-action="export-copy-image"
          onClick={() => void copyImage()}
        >
          {copied ? (
            <Check size={14} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
          )}
          {copied ? t.copied : t.copyImage}
        </button>
      )}
    </div>
  );
}

export function ExportDialog() {
  const target = useExportTarget();
  const doc = useAFrame((s) => s.doc);
  const node = target.nodeId === null ? undefined : doc.nodes[target.nodeId];
  if (!node || target.nodeId === null) {
    return (
      <Dialog title={t.title} onClose={closeDialog} width={420}>
        <div className="dialog__body">
          <p className="dialog__muted">{t.gone}</p>
        </div>
      </Dialog>
    );
  }
  const nodeId = target.nodeId;
  return (
    <Dialog title={t.titleFor(node.name)} onClose={closeDialog} width={620}>
      <div className="dialog__body export" data-testid="export-dialog">
        <Tabs
          label={t.title}
          value={target.mode}
          onChange={(mode: ExportMode) => exportTarget.setState({ mode })}
          tabs={[
            { id: 'code', label: t.code },
            { id: 'image', label: t.image },
          ]}
        >
          {target.mode === 'code' ? <CodeTab nodeId={nodeId} /> : <ImageTab nodeId={nodeId} />}
        </Tabs>
      </div>
    </Dialog>
  );
}
