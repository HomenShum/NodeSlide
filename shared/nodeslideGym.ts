/**
 * NodeSlide compatibility entrypoint for the portable NodeKit Gym core.
 *
 * Keep product imports stable while the versioned package is adopted by
 * external consumers. New package consumers should import `@nodekit/gym-core`.
 */
export * from '../packages/gym-core/src/index.js';
