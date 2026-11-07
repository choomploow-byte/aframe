import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAtelier } from '../store/store';

const SHOW_FOR_MS = 3000;

/**
 * "An AI is editing…" for a few seconds after an agent saves a change. The writer and time come from
 * the document itself (`meta.lastWriter` / `updatedAt`), so it works for anything that writes the file.
 */
export function AgentActivity() {
  const writer = useAtelier((s) => s.doc.meta.lastWriter);
  const rev = useAtelier((s) => s.doc.rev);
  const docId = useAtelier((s) => s.doc.id);
  const previous = useRef({ rev, docId });
  const [seenAt, setSeenAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // A new revision written by an agent, while this project stays open, starts the countdown (opening a
  // project an agent edited earlier must not). Local edits and undo are stamped 'app'.
  useEffect(() => {
    const before = previous.current;
    previous.current = { rev, docId };
    if (before.docId === docId && before.rev !== rev && writer !== 'app') setSeenAt(Date.now());
  }, [writer, rev, docId]);

  const active = seenAt !== null && now - seenAt < SHOW_FOR_MS;
  useEffect(() => {
    if (seenAt === null) return;
    const left = SHOW_FOR_MS - (Date.now() - seenAt);
    if (left <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), left + 50);
    return () => clearTimeout(timer);
  }, [seenAt]);

  if (!active) return null;
  return (
    <div className="agent-chip" role="status" aria-live="polite" data-testid="agent-editing">
      <Sparkles size={13} strokeWidth={1.75} aria-hidden="true" />
      An AI is editing…
    </div>
  );
}
