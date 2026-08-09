import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Handler = (args: any, extra: any) => any;

function unwrapToObject(schema: z.ZodTypeAny): z.ZodObject<z.ZodRawShape> {
  if (schema instanceof z.ZodObject) return schema as z.ZodObject<z.ZodRawShape>;
  const def: any = (schema as any)._def;
  if (def?.schema) return unwrapToObject(def.schema);
  throw new Error("registerStrictTool: schema is not a ZodObject (and not a wrapped one)");
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
  handler: Handler
): void {
  const objectSchema = unwrapToObject(schema);
  const strictObject = objectSchema.strict();
  const needsFullParse = schema !== objectSchema;

  const callback = needsFullParse
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

  server.registerTool(
    name,
    { description, inputSchema: strictObject as any },
    callback as any
  );
}
