import { createElement } from 'react';

/** Shared by the visible landing and Vite's initial public HTML. */
export function NodeSlideLandingIntro() {
  return createElement(
    'div',
    { className: 'ns-landing-intro' },
    createElement('span', { className: 'ns-eyebrow' }, 'Decks that stay editable'),
    createElement('h1', { id: 'nodeslide-landing-title' }, 'What presentation should we build?'),
    createElement(
      'p',
      null,
      'Start with an idea, a structured spec, or evidence. NodeSlide turns it into a reviewable deck—not a stack of static images.',
    ),
  );
}
