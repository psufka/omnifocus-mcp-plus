import { AsyncLocalStorage } from 'node:async_hooks';

interface Invocation { data?: unknown }
const invocations = new AsyncLocalStorage<Invocation>();
/** Capture machine data before human formatting. Definitions may replace this with
 * their final sanitized result (e.g. attachments saved to disk). */
export function recordToolData<T>(data: T): T {
  const invocation = invocations.getStore();
  if (invocation) invocation.data = data;
  return data;
}
export async function collectToolResult(tool: string, run: () => Promise<any>): Promise<any> {
  const invocation: Invocation = {};
  return invocations.run(invocation, async () => {
    let result;
    try { result = await run(); }
    catch (error) {
      result = { content: [{ type: 'text', text: (error as Error).message }], isError: true };
      invocation.data = { error: (error as Error).message };
    }
    const data: any = result.structuredContent?.data ?? invocation.data ?? null;
    const failed = result.isError === true || data?.success === false || data?.verified === false;
    return { ...result, ...(failed ? { isError: true } : {}), structuredContent: {
      success: !failed, tool, data,
      ...(result.structuredContent?.meta ? { meta: result.structuredContent.meta } : {})
    } };
  });
}
