/* eslint-disable */
import type * as repository from '../repository.js';
import type { ApiFromModules, FilterApi, FunctionReference } from 'convex/server';

declare const fullApi: ApiFromModules<{ repository: typeof repository }>;
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, 'public'>>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, 'internal'>>;
