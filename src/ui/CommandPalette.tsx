import { useMemo, useState } from 'react';
import { rankItems } from '../panels/fuzzy';
import { STRINGS } from '../strings';
import { Dialog } from './Dialog';
import { buildPaletteCommands, type PaletteCommand } from './palette-commands';
import { closeDialog } from './ui-state';

/** Ctrl+K: type to filter every command, arrows to move, Enter to run. */
export function CommandPalette() {
  const commands = useMemo(() => buildPaletteCommands(), []);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(
    () => rankItems(commands, query, (c) => `${c.group} ${c.label}`),
    [commands, query],
  );
  const shown = results.slice(0, 40);

  const run = (command: PaletteCommand | undefined): void => {
    if (!command) return;
    closeDialog();
    // After the dialog has closed and returned focus, so the command sees the canvas as it was.
    setTimeout(command.run, 0);
  };

  return (
    <Dialog
      title={STRINGS.palette.label}
      onClose={closeDialog}
      width={560}
      hideHeader
      className="palette"
    >
      <input
        className="palette__input"
        data-autofocus
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={shown[active] ? `palette-${shown[active].id}` : undefined}
        aria-label={STRINGS.palette.label}
        placeholder={STRINGS.palette.placeholder}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(shown.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            run(shown[active]);
          }
        }}
      />
      <div className="palette__list" id="palette-list" role="listbox" aria-label="Commands">
        {shown.length === 0 && <p className="palette__empty">{STRINGS.palette.empty}</p>}
        {shown.map((c, i) => (
          <button
            key={c.id}
            id={`palette-${c.id}`}
            type="button"
            role="option"
            aria-selected={i === active}
            tabIndex={-1}
            className={`palette__item${i === active ? ' palette__item--active' : ''}`}
            data-command={c.id}
            onMouseMove={() => setActive(i)}
            onClick={() => run(c)}
          >
            <span className="palette__group">{c.group}</span>
            <span className="palette__label">{c.label}</span>
            {c.keys && <kbd className="palette__keys">{c.keys}</kbd>}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
