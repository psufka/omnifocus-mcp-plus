import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { z } from "zod";

type Handler = (args: any, extra: RequestHandlerExtra) => any;

function getShape(schema: z.ZodTypeAny): z.ZodRawShape {
  if (schema instanceof z.ZodObject) return schema.shape;
  const def: any = (schema as any)._def;
  if (def?.schema) return getShape(def.schema);
  throw new Error("registerStrictTool: schema is not a ZodObject (and not a wrapped one)");
}

// Wraps server.tool() to enforce strict input validation across the MCP boundary.
//
// The SDK reconstructs schemas via `z.object(shape)` at registration time, which
// drops any `.strict()` chained on the exported schema. After the SDK builds its
// loose copy we overwrite `inputSchema` with the original strict schema; the SDK's
// safeParseAsync (mcp.js:66) then rejects unknown fields with a clear error.
export function registerStrictTool(
  server: McpServer,
  name: string,
  description: string,
  schema: z.ZodTypeAny,
  handler: Handler
): void {
  server.tool(name, description, getShape(schema), handler);
  const registered = (server as any)._registeredTools?.[name];
  if (!registered) {
    throw new Error(`registerStrictTool: tool ${name} was not registered by the SDK`);
  }
  registered.inputSchema = schema;
}
