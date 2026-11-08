/**
 * The window's own buttons. The desktop app has no native title bar, so the top bar draws minimise,
 * maximise and close and the page asks the native side to do them. In a normal browser (dev server,
 * tests) there is no window to control, so `controls` stays null and the buttons are not drawn.
 */
import { create } from 'zustand';

export interface WindowControls {
  minimize(): Promise<void>;
  /** Maximises, or restores if already maximised. */
  toggleMaximize(): Promise<void>;
  isMaximized(): Promise<boolean>;
  /** Same path as the native close button: unsaved work is flushed first. */
  close(): Promise<void>;
  /** Begins moving the window; call on a press of the primary button. */
  startDrag(): Promise<void>;
}

export const useWindowControls = create<{ controls: WindowControls | null }>(() => ({
  controls: null,
}));

export function setWindowControls(controls: WindowControls | null): void {
  useWindowControls.setState({ controls });
}
