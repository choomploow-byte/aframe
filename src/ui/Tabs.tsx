import { useRef, type ReactNode } from 'react';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
}

interface TabsProps<T extends string> {
  label: string;
  tabs: readonly TabDef<T>[];
  value: T;
  onChange: (id: T) => void;
  children: ReactNode;
}

/** Tabs with the WAI-ARIA pattern: one tab stop, arrow keys switch, Home/End jump. */
export function Tabs<T extends string>({ label, tabs, value, onChange, children }: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusTab = (i: number): void => {
    const tab = tabs[(i + tabs.length) % tabs.length];
    if (!tab) return;
    onChange(tab.id);
    refs.current[(i + tabs.length) % tabs.length]?.focus();
  };
  return (
    <div className="tabs">
      <div className="tabs__list" role="tablist" aria-label={label}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={t.id === value}
            aria-controls={`tabpanel-${t.id}`}
            tabIndex={t.id === value ? 0 : -1}
            className="tabs__tab"
            data-tab={t.id}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                focusTab(i + 1);
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                focusTab(i - 1);
              } else if (e.key === 'Home') {
                e.preventDefault();
                focusTab(0);
              } else if (e.key === 'End') {
                e.preventDefault();
                focusTab(tabs.length - 1);
              }
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div
        className="tabs__panel"
        role="tabpanel"
        id={`tabpanel-${value}`}
        aria-labelledby={`tab-${value}`}
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}
