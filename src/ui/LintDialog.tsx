import { lintDesign, type Finding, type Severity } from '@core/lint';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, Wand2 } from 'lucide-react';
import { useMemo } from 'react';
import { getCanvasApi } from '../canvas/canvas-api';
import { store, useAFrame } from '../store/store';
import { Dialog } from './Dialog';
import { showToast } from './toast';
import { closeDialog } from './ui-state';

const ICON = { error: OctagonAlert, warning: AlertTriangle, info: Info } as const;
const LABEL: Record<Severity, string> = {
  error: 'Problems',
  warning: 'Worth fixing',
  info: 'Polish',
};

/** Selects the layer and brings it into view, leaving the dialog open so the list can be worked through. */
function focusNode(id: string): void {
  const s = store.getState();
  if (s.doc.nodes[id] === undefined) return;
  s.setSelection([id]);
  getCanvasApi()?.fitSelection();
}

/** Applies a fix as one undo step. */
function applyFinding(f: Finding): void {
  if (f.fixOps === undefined) return;
  const r = store.getState().dispatch(f.fixOps, { label: `Fix: ${f.rule}` });
  if (!r.ok) showToast(r.errors[0]?.message ?? 'That fix could not be applied.', { kind: 'error' });
}

/** Everything that has a one-click fix, as a single step. */
function applyAll(findings: Finding[]): void {
  const ops = findings.flatMap((f) => f.fixOps ?? []);
  if (ops.length === 0) return;
  const r = store.getState().dispatch(ops, { label: 'Fix design checks' });
  if (r.ok)
    showToast(`Fixed ${findings.filter((f) => f.fixOps).length} things.`, {
      action: { label: 'Undo', run: () => void store.getState().undo() },
    });
  else showToast(r.errors[0]?.message ?? 'Those fixes could not be applied.', { kind: 'error' });
}

/** The design check list: what is wrong in plain words, click to find it, Fix to repair it. */
export function LintDialog() {
  const doc = useAFrame((s) => s.doc);
  const result = useMemo(() => lintDesign(doc), [doc]);
  const fixable = result.findings.filter((f) => f.fixOps !== undefined);
  const groups = (['error', 'warning', 'info'] as const).map((sev) => ({
    sev,
    items: result.findings.filter((f) => f.severity === sev),
  }));
  return (
    <Dialog title="Design check" onClose={closeDialog} width={560}>
      <div className="dialog__body lint" data-testid="lint-dialog">
        {result.findings.length === 0 ? (
          <p className="lint__clean" data-testid="lint-clean">
            <CheckCircle2 size={16} strokeWidth={1.75} aria-hidden="true" /> Nothing to fix:
            contrast, text sizes, spacing and alignment all check out.
          </p>
        ) : (
          <>
            <div className="lint__top">
              <p className="dialog__muted">
                {result.counts.error} problem{result.counts.error === 1 ? '' : 's'},{' '}
                {result.counts.warning} worth fixing, {result.counts.info} polish.
              </p>
              <button
                type="button"
                className="btn btn--small btn--primary"
                data-action="lint-fix-all"
                disabled={fixable.length === 0}
                onClick={() => applyAll(fixable)}
              >
                <Wand2 size={13} strokeWidth={1.75} aria-hidden="true" /> Fix {fixable.length}{' '}
                automatically
              </button>
            </div>
            {groups
              .filter((g) => g.items.length > 0)
              .map((g) => (
                <section key={g.sev} aria-label={LABEL[g.sev]}>
                  <h3 className="lint__group">{LABEL[g.sev]}</h3>
                  <ul className="lint__list">
                    {g.items.map((f, i) => {
                      const Icon = ICON[f.severity];
                      const node = doc.nodes[f.nodeId];
                      return (
                        <li
                          key={`${f.rule}-${f.nodeId}-${i}`}
                          className={`lint__row lint__row--${f.severity}`}
                          data-rule={f.rule}
                        >
                          <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                          <div className="lint__text">
                            <p>{f.message}</p>
                            <button
                              type="button"
                              className="linklike"
                              data-action="lint-find"
                              onClick={() => focusNode(f.nodeId)}
                            >
                              Show {node?.name ?? 'layer'}
                            </button>
                          </div>
                          {f.fixOps !== undefined && (
                            <button
                              type="button"
                              className="btn btn--small btn--secondary"
                              data-action="lint-fix"
                              onClick={() => applyFinding(f)}
                            >
                              Fix
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            {result.total > result.findings.length && (
              <p className="dialog__muted">
                Showing the first {result.findings.length} of {result.total}.
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
