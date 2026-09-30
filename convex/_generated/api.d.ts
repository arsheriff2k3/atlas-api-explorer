/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analyses from "../analyses.js";
import type * as analyze from "../analyze.js";
import type * as crons from "../crons.js";
import type * as flows from "../flows.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as linkReviews from "../linkReviews.js";
import type * as maintenance from "../maintenance.js";
import type * as payloadComparisons from "../payloadComparisons.js";
import type * as shares from "../shares.js";
import type * as tryIt from "../tryIt.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analyses: typeof analyses;
  analyze: typeof analyze;
  crons: typeof crons;
  flows: typeof flows;
  health: typeof health;
  http: typeof http;
  jobs: typeof jobs;
  linkReviews: typeof linkReviews;
  maintenance: typeof maintenance;
  payloadComparisons: typeof payloadComparisons;
  shares: typeof shares;
  tryIt: typeof tryIt;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
