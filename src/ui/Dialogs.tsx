import { SHORTCUTS } from '../canvas/shortcuts';
import { STRINGS } from '../strings';
import { CommandPalette } from './CommandPalette';
import { Dialog } from './Dialog';
import { groupOf } from './palette-commands';
import { ConnectDialog } from './ConnectDialog';
import { ProjectsDialog, RecoverDialog } from './ProjectDialogs';
import { closeDialog, useDialog } from './ui-state';

function ShortcutSheet() {
  const groups = new Map<string, { label: string; keys: string }[]>();
  for (const s of SHORTCUTS) {
    if (s.id.startsWith('nudge.') && s.id !== 'nudge.Left') continue;
    const g = groupOf(s.id);
    const entry =
      s.id === 'nudge.Left'
        ? { label: 'Nudge (Shift for 10px)', keys: 'Arrow keys' }
        : { label: s.label, keys: s.keys };
    groups.set(g, [...(groups.get(g) ?? []), entry]);
  }
  return (
    <Dialog title={STRINGS.shortcuts.title} onClose={closeDialog} width={560}>
      <div className="dialog__body shortcuts">
        {[...groups].map(([group, items]) => (
          <section key={group} aria-label={group}>
            <h3 className="shortcuts__group">{group}</h3>
            <dl className="shortcuts__list">
              {items.map((i) => (
                <div className="shortcuts__row" key={i.label}>
                  <dt>{i.label}</dt>
                  <dd>
                    <kbd>{i.keys}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/** Renders whichever modal is open. */
export function Dialogs() {
  const dialog = useDialog();
  if (dialog === 'palette') return <CommandPalette />;
  if (dialog === 'shortcuts') return <ShortcutSheet />;
  if (dialog === 'connect') return <ConnectDialog />;
  if (dialog === 'projects') return <ProjectsDialog />;
  if (dialog === 'recover') return <RecoverDialog />;
  return null;
}
