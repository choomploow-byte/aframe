import { useEffect, useMemo, useRef, useState } from 'react';
import { useAFrame } from '../store/store';

/** Hidden debug HUD (Ctrl+Alt+D): frame rate, node count, zoom (docs/19 "Measurement"). */
export function Hud() {
  const visible = useAFrame((s) => s.hud);
  const nodes = useAFrame((s) => s.doc.nodes);
  const zoom = useAFrame((s) => s.viewport.zoom);
  const selected = useAFrame((s) => s.selection.length);
  const count = useMemo(() => Object.keys(nodes).length, [nodes]);
  const [fps, setFps] = useState(0);
  const frames = useRef({ n: 0, t: 0 });

  useEffect(() => {
    if (!visible) return undefined;
    let id = 0;
    frames.current = { n: 0, t: performance.now() };
    const loop = (now: number): void => {
      frames.current.n += 1;
      const elapsed = now - frames.current.t;
      if (elapsed >= 500) {
        setFps(Math.round((frames.current.n * 1000) / elapsed));
        frames.current = { n: 0, t: now };
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [visible]);

  if (!visible) return null;
  return (
    <div className="hud" data-ui data-testid="hud">
      {fps} fps · {count} nodes · {selected} selected · {Math.round(zoom * 100)}%
    </div>
  );
}
