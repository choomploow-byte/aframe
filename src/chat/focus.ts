import { showRightTab } from '../ui/right-tab';

/** Shows the Chat tab and puts the cursor in its message box. */
export function openChat(): void {
  showRightTab('chat');
  // The panel renders on the next frame; then the box exists.
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input"]')?.focus(),
    ),
  );
}
