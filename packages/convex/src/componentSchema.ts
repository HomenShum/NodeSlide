import type { GenericSchema, SchemaDefinition } from 'convex/server';
import schema from '../component/schema';

// Keep the public testing export intentionally broad. Re-exporting the fully
// inferred validator type makes TypeScript declaration emission depend on
// nondeterministic object/union member ordering, which changes the packed
// tarball bytes across otherwise identical release builds.
const componentSchema: SchemaDefinition<GenericSchema, true> = schema;

export default componentSchema;
