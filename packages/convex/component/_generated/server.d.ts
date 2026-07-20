/* eslint-disable */
import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
  GenericMutationCtx,
  GenericQueryCtx,
  MutationBuilder,
  QueryBuilder,
} from 'convex/server';
import type { DataModel } from './dataModel.js';

export declare const query: QueryBuilder<DataModel, 'public'>;
export declare const mutation: MutationBuilder<DataModel, 'public'>;
export type QueryCtx = GenericQueryCtx<DataModel>;
export type MutationCtx = GenericMutationCtx<DataModel>;
export type DatabaseReader = GenericDatabaseReader<DataModel>;
export type DatabaseWriter = GenericDatabaseWriter<DataModel>;
