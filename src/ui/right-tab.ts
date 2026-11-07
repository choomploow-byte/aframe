import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export type RightTab = 'design' | 'notes' | 'chat';

/** Which tab of the right panel is showing. UI-only: other code opens a tab through `showRightTab`. */
export const rightTabStore = createStore<{ tab: RightTab }>()(() => ({ tab: 'design' }));

export const useRightTab = (): RightTab => useStore(rightTabStore, (s) => s.tab);
export const showRightTab = (tab: RightTab): void => rightTabStore.setState({ tab });
