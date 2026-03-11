import { runOmniJs } from '../../utils/scriptExecution.js';

export interface AppendToNoteParams {
  object_type: 'task' | 'project';
  object_id: string;
  text: string;
}

export async function appendToNote(params: AppendToNoteParams): Promise<{ success: boolean; id?: string; name?: string; noteLength?: number; error?: string }> {
  const script = `
    const collection = args.object_type === 'project'
      ? document.flattenedProjects
      : document.flattenedTasks;
    const obj = collection.find(o => o.id.primaryKey === args.object_id);
    if (!obj) return JSON.stringify({ success: false, error: args.object_type + ' not found with ID: ' + args.object_id });
    obj.appendStringToNote(args.text);
    return JSON.stringify({
      success: true,
      id: obj.id.primaryKey,
      name: obj.name,
      noteLength: (obj.note || '').length
    });
  `;
  return await runOmniJs(script, params);
}
