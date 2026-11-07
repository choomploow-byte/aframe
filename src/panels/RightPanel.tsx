import { useState } from 'react';
import { useAtelier } from '../store/store';
import { STRINGS } from '../strings';
import { Tabs, type TabDef } from '../ui/Tabs';
import { NotesPanel } from './NotesPanel';
import { PropertiesPanel } from './PropertiesPanel';

type RightTab = 'design' | 'notes';

/** Right panel: the Design tab (properties) and the Notes tab with its open count (docs/07). */
export function RightPanel() {
  const [tab, setTab] = useState<RightTab>('design');
  const open = useAtelier((s) => s.doc.annotations.filter((a) => a.status === 'open').length);
  const tabs: readonly TabDef<RightTab>[] = [
    { id: 'design', label: STRINGS.panels.design },
    { id: 'notes', label: open > 0 ? `${STRINGS.panels.notes} ${open}` : STRINGS.panels.notes },
  ];
  return (
    <Tabs label={STRINGS.panels.properties} tabs={tabs} value={tab} onChange={setTab}>
      {tab === 'design' ? <PropertiesPanel /> : <NotesPanel />}
    </Tabs>
  );
}
