import { addressNotesPrompt, placeAnnotations } from '@core/annotations';
import { getCanvasApi } from '../canvas/canvas-api';
import { openChat } from '../chat/focus';
import { chatReadiness, sendChat } from '../chat/session';
import { store } from '../store/store';
import { showToast } from '../ui/toast';
import { annotationUi } from './ui-state';

/**
 * Makes a note the centre of attention: selects the node it is on, focuses its card, and pans the
 * canvas (keeping the zoom) so the pin is in the middle of the view.
 */
export function focusAnnotation(id: string): void {
  const s = store.getState();
  const api = getCanvasApi();
  const note = s.doc.annotations.find((a) => a.id === id);
  if (!note) return;
  if (note.nodeId !== undefined && s.doc.nodes[note.nodeId]) s.setSelection([note.nodeId]);
  annotationUi.getState().focus(id);
  if (!api) return;
  const placed = placeAnnotations([note], (nodeId) => api.measure(nodeId))[0];
  if (!placed) return;
  const view = api.viewSize();
  const { zoom } = s.viewport;
  s.setViewport({
    zoom,
    x: view.w / 2 - placed.x * zoom,
    y: view.h / 2 - placed.y * zoom,
  });
}

/**
 * "Ask AI to address N open notes". With the built-in chat set up this sends the notes to it;
 * otherwise (and for external agents) it copies the sentence to say in Claude Code or Codex.
 */
export async function askAiToAddressNotes(): Promise<void> {
  const open = store.getState().doc.annotations.filter((a) => a.status === 'open').length;
  if (open === 0) {
    showToast('There are no open notes.');
    return;
  }
  const prompt = addressNotesPrompt(open);
  // The built-in assistant, when it is set up, takes the notes itself.
  if ((await chatReadiness()).ok) {
    openChat();
    void sendChat(
      'Address my open annotations: read them with get_annotations, fix each one, then answer each with resolve_annotation.',
    );
    return;
  }
  try {
    await navigator.clipboard.writeText(prompt);
    showToast(`Copied: "${prompt}". Paste it into Claude Code or Codex.`);
  } catch {
    showToast(`Say this to your AI: "${prompt}"`);
  }
}
