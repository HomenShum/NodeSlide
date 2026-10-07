import { Suspense, lazy } from 'react';
import { NodeSlideStudio } from './domains/nodeslide/NodeSlideStudio';

/**
 * The Atlas gallery is a read-only catalogue of archetypes and recipe standings. It shares no
 * state with the editor and pulls in the whole receipt projection, so it is lazy and reached
 * only by explicit request (`?domain=atlas`). This is not a domain router: NodeSlide is still
 * the app, and every other URL renders the studio.
 */
const AtlasGallery = lazy(() =>
  import('./domains/nodeslide/atlas/AtlasGallery').then(({ AtlasGallery: Gallery }) => ({
    default: Gallery,
  })),
);

// NodeSlide is the whole app. NodeSlideStudio self-heals the URL and owns the
// full editor shell; there is no domain router in the standalone repo.
export default function App() {
  const domain =
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('domain');

  if (domain === 'atlas') {
    return (
      <Suspense
        fallback={
          <main className="nodeslide-studio ns-loading-screen" aria-busy="true">
            <strong>Opening the Artifact Atlas…</strong>
          </main>
        }
      >
        <AtlasGallery />
      </Suspense>
    );
  }

  return <NodeSlideStudio />;
}
