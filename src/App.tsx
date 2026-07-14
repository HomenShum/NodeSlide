import { NodeSlideStudio } from './domains/nodeslide/NodeSlideStudio';

// NodeSlide is the whole app. NodeSlideStudio self-heals the URL and owns the
// full editor shell; there is no domain router in the standalone repo.
export default function App() {
  return <NodeSlideStudio />;
}
