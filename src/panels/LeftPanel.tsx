import { useState } from 'react';
import { STRINGS } from '../strings';
import { Tabs, type TabDef } from '../ui/Tabs';
import { AssetsPanel } from './AssetsPanel';
import { ComponentsPanel, IconsPanel } from './KitPanels';
import { LayersPanel } from './LayersPanel';
import { TokensPanel } from './TokensPanel';

type LeftTab = 'layers' | 'assets' | 'tokens' | 'icons' | 'components';

const TABS: readonly TabDef<LeftTab>[] = [
  { id: 'layers', label: STRINGS.panels.layers },
  { id: 'assets', label: STRINGS.panels.assets },
  { id: 'tokens', label: STRINGS.panels.tokens },
  { id: 'icons', label: STRINGS.panels.icons },
  { id: 'components', label: STRINGS.panels.components },
];

/** Left panel: Layers, Assets, Tokens, Icons and Components tabs (docs/07). */
export function LeftPanel() {
  const [tab, setTab] = useState<LeftTab>('layers');
  return (
    <Tabs label={STRINGS.panels.left} tabs={TABS} value={tab} onChange={setTab}>
      {tab === 'layers' && <LayersPanel />}
      {tab === 'assets' && <AssetsPanel />}
      {tab === 'tokens' && <TokensPanel />}
      {tab === 'icons' && <IconsPanel />}
      {tab === 'components' && <ComponentsPanel />}
    </Tabs>
  );
}
