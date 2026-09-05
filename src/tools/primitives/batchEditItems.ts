import { runOmniJs } from '../../utils/scriptExecution.js';
import { EDIT_ITEM_SCRIPT, normalizeDateParams, validateEditItemParams, type EditItemParams } from './editItem.js';

export interface BatchEditItemsParams { items: EditItemParams[]; dryRun?: boolean; stopOnError?: boolean }
export const BATCH_EDIT_ITEMS_SCRIPT = `
  function editOne(args) { ${EDIT_ITEM_SCRIPT} }
  const results = [];
  let stopped = false;
  args.items.forEach(function (item, index) {
    let result;
    if (stopped) result = { success: false, status: 'skipped', id: item.id, name: item.name, error: 'Skipped after a previous failure.' };
    else if (item.preflightError) result = { success: false, status: 'failed', id: item.id, name: item.name, error: item.preflightError };
    else {
      try {
        result = JSON.parse(editOne(item));
        if (result.verified === false) result.success = false;
        result.status = result.success ? (args.dryRun ? 'wouldEdit' : 'edited') : 'failed';
      } catch (error) {
        result = { success: false, status: 'failed', id: item.id, name: item.name, error: error.message };
      }
    }
    result.index = index;
    result.itemType = item.itemType;
    results.push(result);
    if (!result.success && args.stopOnError) stopped = true;
  });
  return JSON.stringify({ success: results.every(function (r) { return r.success; }), dryRun: args.dryRun === true,
    verified: args.dryRun ? null : results.every(function (r) { return r.verified === true; }), results: results });
`;
export async function batchEditItems(params: BatchEditItemsParams) {
  const items = params.items.map(item => {
    const validation = validateEditItemParams(item);
    return { ...normalizeDateParams(item), dryRun: params.dryRun === true,
      ...(!validation.valid ? { preflightError: validation.error } : {}) };
  });
  return runOmniJs(BATCH_EDIT_ITEMS_SCRIPT, { ...params, items }, { readOnly: params.dryRun === true });
}
