/* eslint-disable */
/** Generated ComponentApi utility. Regenerate with Convex component codegen before release. */
import type * as repository from '../repository.js';
import type { ApiFromModules, FilterApi, FunctionReference } from 'convex/server';

type FullApi = ApiFromModules<{ repository: typeof repository }>;
export type ComponentApi<Name extends string | undefined = string | undefined> = FilterApi<
  FullApi,
  FunctionReference<any, 'public', any, any, Name>
>;
