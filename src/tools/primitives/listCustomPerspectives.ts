import { executeOmniFocusScript, runOmniJs } from '../../utils/scriptExecution.js';

export interface ListCustomPerspectivesOptions {
  format?: 'simple' | 'detailed';
  /** Also read each perspective's archived filter rules and aggregation. */
  includeRules?: boolean;
}

export interface PerspectiveRow {
  name: string;
  identifier: string;
  rules?: unknown[];
  aggregation?: string | null;
  rulesError?: string;
}

/**
 * Read every custom perspective together with its archived filter rules.
 *
 * Probed live against OmniFocus 4.8.13:
 *  - `Perspective.Custom.all` is a plain array; `byName` / `byIdentifier` exist
 *    and return `null` on a miss.
 *  - Unlike Task/Project/Tag objects, a `Perspective.Custom` DOES expose its
 *    fields to `Object.getOwnPropertyNames` — but the fields are read one by one
 *    here anyway, because the conventions' "Object.keys is useless" rule holds
 *    for every other OmniJS class and explicit reads cost nothing.
 *  - `archivedFilterRules` is a genuine JSON array of plain objects (verified
 *    with `Object.prototype.toString` and `JSON.stringify`), and each read
 *    returns a FRESH array — it cannot be mutated in place.
 *  - `archivedTopLevelFilterAggregation` is 'all' | 'any' | null.
 *
 * Written with no template literals, `$`, or backslashes so it survives the
 * runOmniJs escaping layer untouched.
 */
export const LIST_PERSPECTIVE_RULES_SCRIPT = `
  var perspectives = Perspective.Custom.all.map(function (p) {
    var row = { name: p.name, identifier: p.identifier };
    try {
      row.rules = p.archivedFilterRules;
    } catch (e) {
      row.rules = [];
      row.rulesError = e.message || String(e);
    }
    try {
      var agg = p.archivedTopLevelFilterAggregation;
      row.aggregation = (agg === undefined) ? null : agg;
    } catch (e2) {
      row.aggregation = null;
    }
    return row;
  });

  return JSON.stringify({
    success: true,
    count: perspectives.length,
    perspectives: perspectives
  });
`;

function renderRules(row: PerspectiveRow): string[] {
  const lines: string[] = [];
  lines.push(`   Aggregation: ${row.aggregation === null || row.aggregation === undefined ? '(none)' : row.aggregation}`);
  if (row.rulesError) {
    lines.push(`   Rules: unreadable — ${row.rulesError}`);
    return lines;
  }
  const rules = row.rules ?? [];
  lines.push(`   Rules (${rules.length}):`);
  lines.push('   ```json');
  for (const line of JSON.stringify(rules, null, 2).split('\n')) {
    lines.push(`   ${line}`);
  }
  lines.push('   ```');
  return lines;
}

export async function listCustomPerspectives(options: ListCustomPerspectivesOptions = {}): Promise<string> {
  const { format = 'simple', includeRules = false } = options;

  try {
    // Both paths are pure reads — readOnly lets the concurrency layer retry on
    // Apple Event contention and lets registerStrictTool cache the result.
    const result = includeRules
      ? await runOmniJs(LIST_PERSPECTIVE_RULES_SCRIPT, undefined, { readOnly: true })
      : await executeOmniFocusScript('@listCustomPerspectives.js', {}, { readOnly: true });

    // Handle various possible return types
    let data: any;

    if (typeof result === 'string') {
      try {
        data = JSON.parse(result);
      } catch (parseError) {
        console.error('JSON parse failed:', parseError);
        throw new Error(`Failed to parse string result: ${result}`);
      }
    } else if (typeof result === 'object' && result !== null) {
      data = result;
    } else {
      console.error('Invalid result type:', typeof result, result);
      throw new Error(`Script returned an invalid result type: ${typeof result}, value: ${result}`);
    }

    // Check for errors
    if (!data.success) {
      throw new Error(data.error || 'Unknown error occurred');
    }

    // Format output
    if (data.count === 0) {
      return "**Custom Perspectives**\n\nNo custom perspectives found.";
    }

    const rows: PerspectiveRow[] = data.perspectives;

    if (includeRules) {
      const details = rows.map((p, index) => {
        const lines = [`${index + 1}. **${p.name}**`, `   ID: ${p.identifier}`, ...renderRules(p)];
        return lines.join('\n');
      });
      return `**Custom Perspectives** (${data.count})\n\n${details.join('\n\n')}`;
    }

    if (format === 'simple') {
      // Simple format: names only
      const perspectiveNames = rows.map((p) => p.name);
      return `**Custom Perspectives** (${data.count})\n\n${perspectiveNames.map((name: string, index: number) => `${index + 1}. ${name}`).join('\n')}`;
    }

    // Detailed format: name and identifier
    const perspectiveDetails = rows.map((p, index) =>
      `${index + 1}. **${p.name}**\n   ID: ${p.identifier}`
    );
    return `**Custom Perspectives** (${data.count})\n\n${perspectiveDetails.join('\n\n')}`;

  } catch (error) {
    console.error('Error in listCustomPerspectives:', error);
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}
