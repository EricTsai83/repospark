/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analysis from "../analysis.js";
import type * as analysisNode from "../analysisNode.js";
import type * as chat from "../chat.js";
import type * as crons from "../crons.js";
import type * as daytona from "../daytona.js";
import type * as github from "../github.js";
import type * as githubAppNode from "../githubAppNode.js";
import type * as githubCheck from "../githubCheck.js";
import type * as http from "../http.js";
import type * as imports from "../imports.js";
import type * as importsNode from "../importsNode.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_github from "../lib/github.js";
import type * as lib_observability from "../lib/observability.js";
import type * as lib_openaiPricing from "../lib/openaiPricing.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_repoAnalysis from "../lib/repoAnalysis.js";
import type * as lib_sandboxAvailability from "../lib/sandboxAvailability.js";
import type * as lib_sandboxNames from "../lib/sandboxNames.js";
import type * as ops from "../ops.js";
import type * as opsNode from "../opsNode.js";
import type * as repositories from "../repositories.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analysis: typeof analysis;
  analysisNode: typeof analysisNode;
  chat: typeof chat;
  crons: typeof crons;
  daytona: typeof daytona;
  github: typeof github;
  githubAppNode: typeof githubAppNode;
  githubCheck: typeof githubCheck;
  http: typeof http;
  imports: typeof imports;
  importsNode: typeof importsNode;
  "lib/auth": typeof lib_auth;
  "lib/constants": typeof lib_constants;
  "lib/github": typeof lib_github;
  "lib/observability": typeof lib_observability;
  "lib/openaiPricing": typeof lib_openaiPricing;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/repoAnalysis": typeof lib_repoAnalysis;
  "lib/sandboxAvailability": typeof lib_sandboxAvailability;
  "lib/sandboxNames": typeof lib_sandboxNames;
  ops: typeof ops;
  opsNode: typeof opsNode;
  repositories: typeof repositories;
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

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
