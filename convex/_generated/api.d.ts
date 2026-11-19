/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as explorations from "../explorations.js";
import type * as feedback from "../feedback.js";
import type * as http from "../http.js";
import type * as ideas from "../ideas.js";
import type * as internal_learning from "../internal/learning.js";
import type * as internal_mcp from "../internal/mcp.js";
import type * as internal_optimize from "../internal/optimize.js";
import type * as internal_optimizePersist from "../internal/optimizePersist.js";
import type * as internal_persist from "../internal/persist.js";
import type * as internal_search from "../internal/search.js";
import type * as learning from "../learning.js";
import type * as mcpTokens from "../mcpTokens.js";
import type * as mechanisms from "../mechanisms.js";
import type * as problems from "../problems.js";
import type * as strategies from "../strategies.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  explorations: typeof explorations;
  feedback: typeof feedback;
  http: typeof http;
  ideas: typeof ideas;
  "internal/learning": typeof internal_learning;
  "internal/mcp": typeof internal_mcp;
  "internal/optimize": typeof internal_optimize;
  "internal/optimizePersist": typeof internal_optimizePersist;
  "internal/persist": typeof internal_persist;
  "internal/search": typeof internal_search;
  learning: typeof learning;
  mcpTokens: typeof mcpTokens;
  mechanisms: typeof mechanisms;
  problems: typeof problems;
  strategies: typeof strategies;
  users: typeof users;
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
