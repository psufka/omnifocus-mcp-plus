import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { cacheKey, cacheGet, cacheSet, cacheClear, DEFAULT_CACHE_TTL_MS } from "./cache.js";

type Handler = (args: any, extra: any) => any;

export type { ToolAnnotations };

// Annotation presets. Spread and override for special cases
// (e.g. an idempotent mutation: { ...MUTATING_TOOL, idempotentHint: true }).
export const READ_ONLY_TOOL: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
};
export const ADDITIVE_TOOL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};
export const MUTATING_TOOL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
};

export interface StrictToolOptions {
  annotations?: ToolAnnotations;
  title?: string;
  /** Cache successful results keyed on (name, args). Only valid on tools
   *  whose annotations declare readOnlyHint: true. */
  cacheable?: boolean;
  cacheTtlMs?: number;
}

function unwrapToObject(schema: z.ZodTypeAny): z.ZodObject<z.ZodRawShape> {
  if (schema instanceof z.ZodObject) return schema as z.ZodObject<z.ZodRawShape>;
  const def: any = (schema as any)._def;
  if (def?.schema) return unwrapToObject(def.schema);
  throw new Error("registerStrictTool: schema is not a ZodObject (and not a wrapped one)");
}

// ---------------------------------------------------------------------------
// Tolerant input: normalize-then-strict.
//
// Some MCP clients (and smaller models) serialize booleans, numbers, and
// arrays as strings. Each top-level field whose base type is boolean, number,
// array, or object gets a z.preprocess coercer that repairs exactly those
// shapes and passes everything else through untouched — validation then runs
// against the SAME strict type, so unrepairable input still fails with the
// original error. zod-to-json-schema serializes the inner schema for effects,
// so the advertised JSON Schema is unchanged.
// ---------------------------------------------------------------------------

function baseType(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def: any = (schema as any)._def;
  const typeName = def?.typeName;
  if (typeName === "ZodOptional" || typeName === "ZodNullable" || typeName === "ZodDefault") {
    return baseType(def.innerType);
  }
  if (typeName === "ZodEffects" && def.schema) return baseType(def.schema);
  return schema;
}

function coerceBooleanString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const lower = value.trim().toLowerCase();
  if (lower === "true" || lower === "yes" || lower === "1") return true;
  if (lower === "false" || lower === "no" || lower === "0") return false;
  return value;
}

function coerceNumberString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "") return value;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : value;
}

function makeJsonStringCoercer(prefix: string): (value: unknown) => unknown {
  return (value: unknown) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith(prefix)) return value;
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  };
}

function coercerFor(field: z.ZodTypeAny): ((value: unknown) => unknown) | null {
  const typeName = (baseType(field) as any)._def?.typeName;
  if (typeName === "ZodBoolean") return coerceBooleanString;
  if (typeName === "ZodNumber") return coerceNumberString;
  if (typeName === "ZodArray") return makeJsonStringCoercer("[");
  if (typeName === "ZodObject" || typeName === "ZodRecord") return makeJsonStringCoercer("{");
  return null;
}

function withCoercion(objectSchema: z.ZodObject<z.ZodRawShape>): z.ZodObject<z.ZodRawShape> {
  const shape = objectSchema.shape;
  const newShape: z.ZodRawShape = {};
  for (const [key, field] of Object.entries(shape)) {
    const coercer = coercerFor(field as z.ZodTypeAny);
    newShape[key] = coercer
      ? (z.preprocess(coercer, field as z.ZodTypeAny) as any)
      : (field as z.ZodTypeAny);
  }
  return z.object(newShape);
}

// Registers a tool whose input schema rejects unknown fields.
//
// The strict object schema is passed to the official registerTool() API — the
// SDK (>=1.30) preserves full object schemas for both validation and tools/list
// serialization, so unknown fields fail with a clear error and clients see the
// real JSON Schema (with additionalProperties: false).
//
// Refine/transform wrappers (ZodEffects) can't serialize to JSON Schema, so the
// unwrapped strict object is registered and the full schema re-runs in a
// handler wrapper: cross-field refinements still reject, transforms still reach
// the handler, and tools/list still shows the complete field list.
export function registerStrictTool(
  server: McpServer,
  name: string,
  description: string,
  schema: z.ZodTypeAny,
  handler: Handler,
  options?: StrictToolOptions
): void {
  const objectSchema = unwrapToObject(schema);
  const strictObject = withCoercion(objectSchema).strict();
  const needsFullParse = schema !== objectSchema;

  const isReadOnly = options?.annotations?.readOnlyHint === true;
  if (options?.cacheable && !isReadOnly) {
    throw new Error(
      `registerStrictTool: tool "${name}" is cacheable but not annotated readOnlyHint — caching a mutation is never valid`
    );
  }

  const validated = needsFullParse
    ? async (args: any, extra: any) => {
        const parsed = await schema.safeParseAsync(args);
        if (!parsed.success) {
          const message = parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
            .join("; ");
          return {
            content: [
              {
                type: "text" as const,
                text: `Input validation error for tool ${name}: ${message}`,
              },
            ],
            isError: true,
          };
        }
        return handler(parsed.data, extra);
      }
    : handler;

  const callback = async (args: any, extra: any) => {
    if (options?.cacheable) {
      const key = cacheKey(name, args);
      const hit = cacheGet(key);
      if (hit !== undefined) return hit;
      const result = await validated(args, extra);
      if (!result?.isError) {
        cacheSet(key, result, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
      }
      return result;
    }
    if (isReadOnly) {
      return validated(args, extra);
    }
    // Every non-read-only call invalidates all cached reads, whether it
    // succeeded or not — a failed mutation may still have partially applied.
    try {
      return await validated(args, extra);
    } finally {
      cacheClear();
    }
  };

  server.registerTool(
    name,
    {
      description,
      inputSchema: strictObject as any,
      ...(options?.title ? { title: options.title } : {}),
      ...(options?.annotations ? { annotations: options.annotations } : {}),
    },
    callback as any
  );
}
