import nodekitCaseflow from '@homenshum/nodekit/convex.config.js';
import { defineApp } from 'convex/server';

const app = defineApp();

// NodeKit owns the isolated Caseflow lifecycle tables. NodeSlide keeps auth,
// deck ownership, presentation records, and domain mutation in this host app.
app.use(nodekitCaseflow);

export default app;
