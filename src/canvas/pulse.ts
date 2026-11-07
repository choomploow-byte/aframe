/**
 * A short highlight on the nodes an agent just changed, so a human sees where the edit landed.
 * Drawn as temporary overlay boxes (not on the nodes themselves, whose own outlines draw strokes),
 * and skipped for people who asked for reduced motion.
 */
const DURATION_MS = 1400;

export function pulseNodes(ids: readonly string[]): void {
  if (typeof document === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.querySelector<HTMLElement>('[data-testid="canvas"]');
  if (!canvas) return;
  const origin = canvas.getBoundingClientRect();
  for (const id of ids.slice(0, 30)) {
    const el = document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (
      r.bottom < origin.top ||
      r.top > origin.bottom ||
      r.right < origin.left ||
      r.left > origin.right
    )
      continue;
    const box = document.createElement('div');
    box.className = 'agent-pulse';
    box.setAttribute('aria-hidden', 'true');
    box.dataset.pulse = id;
    box.style.cssText = `left:${r.left - origin.left}px;top:${r.top - origin.top}px;width:${r.width}px;height:${r.height}px;`;
    canvas.appendChild(box);
    const anim = box.animate(
      [
        { opacity: 0.9, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(1.03)' },
      ],
      { duration: DURATION_MS, easing: 'ease-out' },
    );
    anim.onfinish = () => box.remove();
    anim.oncancel = () => box.remove();
  }
}
