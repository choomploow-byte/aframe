import { FilePlus2, Pencil, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatBytes, relativeTime } from '../projects/format';
import {
  createNewProject,
  importProjectFile,
  openById,
  refreshProjects,
  removeProject,
  renameById,
  restoreProject,
  useProjects,
} from '../projects/session';
import { STRINGS } from '../strings';
import { Dialog } from './Dialog';
import { TextField } from './fields';
import { closeDialog } from './ui-state';

const t = STRINGS.projects;

function ProjectRow({
  id,
  name,
  updatedAtMs,
  size,
  unreadable,
  current,
}: {
  id: string;
  name: string;
  updatedAtMs: number;
  size: number;
  unreadable: boolean;
  current: boolean;
}) {
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view');
  return (
    <li className="project" data-project-id={id} data-current={current || undefined}>
      {mode === 'rename' ? (
        <div className="project__main">
          <TextField
            ariaLabel={t.renameLabel}
            field="rename-project"
            value={name}
            maxLength={120}
            onCommit={(v) => {
              setMode('view');
              void renameById(id, v);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          className="project__main project__open"
          aria-label={`${t.open} ${name}`}
          onClick={() => void openById(id)}
        >
          <span className="project__name">{name}</span>
          <span className="project__meta">
            {unreadable
              ? t.unreadable
              : `${t.edited} ${relativeTime(updatedAtMs)} · ${formatBytes(size)}`}
            {current && <span className="project__badge">{t.currentBadge}</span>}
          </span>
        </button>
      )}
      {mode === 'delete' ? (
        <span className="project__confirm" role="group" aria-label={t.confirmDelete(name)}>
          <span>{t.confirmDelete(name)}</span>
          <button
            type="button"
            className="btn btn--small btn--danger"
            data-action="confirm-delete-project"
            onClick={() => void removeProject(id)}
          >
            {t.deleteForever}
          </button>
          <button
            type="button"
            className="btn btn--small btn--secondary"
            data-autofocus
            onClick={() => setMode('view')}
          >
            {t.cancel}
          </button>
        </span>
      ) : (
        <span className="project__actions">
          <button
            type="button"
            className="icon-btn icon-btn--small"
            aria-label={`${t.rename} ${name}`}
            title={t.rename}
            onClick={() => setMode('rename')}
          >
            <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--small"
            aria-label={`${t.delete} ${name}`}
            title={t.delete}
            data-action="delete-project"
            onClick={() => setMode('delete')}
          >
            <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </span>
      )}
    </li>
  );
}

/** Open, create, import, rename and delete projects. */
export function ProjectsDialog() {
  const list = useProjects((s) => s.list);
  const loading = useProjects((s) => s.loading);
  const currentId = useProjects((s) => s.save.projectId);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refreshProjects();
  }, []);

  return (
    <Dialog title={t.title} onClose={closeDialog} width={520}>
      <div className="dialog__body">
        {list.length === 0 ? (
          <p className="dialog__muted">{loading ? t.loading : t.empty}</p>
        ) : (
          <ul className="projects" aria-label={t.title} data-testid="project-list">
            {list.map((p) => (
              <ProjectRow key={p.id} {...p} current={p.id === currentId} />
            ))}
          </ul>
        )}
        <div className="dialog__footer dialog__footer--split">
          <button
            type="button"
            className="btn btn--primary"
            data-autofocus
            data-action="new-project"
            onClick={() => void createNewProject()}
          >
            <FilePlus2 size={14} strokeWidth={1.75} aria-hidden="true" />
            {t.newProject}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => input.current?.click()}
          >
            <Upload size={14} strokeWidth={1.75} aria-hidden="true" />
            {t.import}
          </button>
          <input
            ref={input}
            type="file"
            accept=".json,.atelier.json,application/json"
            hidden
            data-testid="project-file-input"
            aria-label={t.import}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importProjectFile(file);
            }}
          />
        </div>
      </div>
    </Dialog>
  );
}

/** A project could not be opened: say why and offer the way out. */
export function RecoverDialog() {
  const recover = useProjects((s) => s.recover);
  if (!recover) return null;
  const tooNew = recover.reason === 'too-new';
  return (
    <Dialog title={tooNew ? t.tooNewTitle : t.recoverTitle} onClose={closeDialog} width={480}>
      <div className="dialog__body">
        <p>{tooNew ? t.tooNewBody(recover.name) : t.recoverBody(recover.name)}</p>
        {recover.messages.length > 0 && (
          <ul className="dialog__muted recover__details">
            {recover.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        <p className="dialog__muted">
          {recover.canRestore ? t.recoverHasBackup : tooNew ? '' : t.recoverNoBackup}
        </p>
        <div className="dialog__footer dialog__footer--split">
          {recover.canRestore && (
            <button
              type="button"
              className="btn btn--primary"
              data-autofocus
              data-action="restore-backup"
              onClick={() => void restoreProject(recover.id)}
            >
              {t.restore}
            </button>
          )}
          <button
            type="button"
            className="btn btn--secondary"
            data-autofocus={!recover.canRestore || undefined}
            onClick={closeDialog}
          >
            {t.close}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
