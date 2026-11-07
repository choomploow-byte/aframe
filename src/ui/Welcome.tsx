import { Frame, MessageCircle, Sparkles } from 'lucide-react';
import { createSampleProject } from '../projects/session';
import { store } from '../store/store';
import { STRINGS } from '../strings';
import { openDialog } from './ui-state';

/** What an empty canvas says: three ways to begin, written for someone who has never seen the app. */
export function Welcome() {
  const w = STRINGS.welcome;
  return (
    <div className="welcome" data-testid="welcome">
      <h1 className="welcome__title">{w.title}</h1>
      <p className="welcome__lead">{w.lead}</p>
      <div className="welcome__actions" data-ui>
        <button
          type="button"
          className="welcome__card"
          data-action="welcome-draw"
          onClick={() => store.getState().setTool('frame')}
        >
          <Frame size={20} strokeWidth={1.5} aria-hidden="true" />
          <span className="welcome__card-title">{w.draw}</span>
          <span className="welcome__card-hint">{w.drawHint}</span>
        </button>
        <button
          type="button"
          className="welcome__card"
          data-action="welcome-sample"
          onClick={() => void createSampleProject()}
        >
          <Sparkles size={20} strokeWidth={1.5} aria-hidden="true" />
          <span className="welcome__card-title">{w.sample}</span>
          <span className="welcome__card-hint">{w.sampleHint}</span>
        </button>
        <button
          type="button"
          className="welcome__card"
          data-action="welcome-connect"
          onClick={() => openDialog('connect')}
        >
          <MessageCircle size={20} strokeWidth={1.5} aria-hidden="true" />
          <span className="welcome__card-title">{w.connect}</span>
          <span className="welcome__card-hint">{w.connectHint}</span>
        </button>
      </div>
    </div>
  );
}
