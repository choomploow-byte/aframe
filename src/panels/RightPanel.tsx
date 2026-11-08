import { useAFrame } from '../store/store';
import { STRINGS } from '../strings';
import { useChat } from '../chat/session';
import { ChatPanel } from './ChatPanel';
import { Tabs, type TabDef } from '../ui/Tabs';
import { showRightTab, useRightTab, type RightTab } from '../ui/right-tab';
import { NotesPanel } from './NotesPanel';
import { PropertiesPanel } from './PropertiesPanel';

/** Right panel: the Design tab (properties) and the Notes tab with its open count (docs/07). */
export function RightPanel() {
  const tab = useRightTab();
  const working = useChat((s) => s.running);
  const open = useAFrame((s) => s.doc.annotations.filter((a) => a.status === 'open').length);
  const tabs: readonly TabDef<RightTab>[] = [
    { id: 'design', label: STRINGS.panels.design },
    { id: 'notes', label: open > 0 ? `${STRINGS.panels.notes} ${open}` : STRINGS.panels.notes },
    { id: 'chat', label: working ? `${STRINGS.panels.chat}…` : STRINGS.panels.chat },
  ];
  return (
    <Tabs label={STRINGS.panels.properties} tabs={tabs} value={tab} onChange={showRightTab}>
      {tab === 'design' ? <PropertiesPanel /> : tab === 'notes' ? <NotesPanel /> : <ChatPanel />}
    </Tabs>
  );
}
