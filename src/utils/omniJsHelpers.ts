/**
 * Shared OmniJS source snippets, prepended to tool scripts before they are
 * passed to runOmniJs(). These are the single implementation of item lookup
 * used by every mutation tool, with two safety rules:
 *
 *   1. An explicitly provided ID that matches nothing is an ERROR — it never
 *      falls back to name matching (a stale ID must not mutate a same-named
 *      different item).
 *   2. A name that matches more than one item is an ERROR listing the
 *      matches — never "first match wins".
 *
 * Both functions return { item } on success or { error } on failure.
 * Written without template literals or `$` so the runOmniJs escaping layer
 * has nothing to transform.
 */
export const OMNIJS_LOOKUP_HELPERS = `
  function __matchList(matches) {
    return matches.slice(0, 5).map(function (m) {
      var loc = '';
      if (m.containingProject) { loc = ' in "' + m.containingProject.name + '"'; }
      else if (m.parent && m.parent.name) { loc = ' in "' + m.parent.name + '"'; }
      return '"' + m.name + '" (id: ' + m.id.primaryKey + loc + ')';
    }).join(', ');
  }

  // Strict two-field lookup: explicit id wins and never falls back to name.
  function __resolveByIdOrName(collection, id, name, label) {
    if (id) {
      var byId = collection.filter(function (o) { return o.id.primaryKey === id; })[0];
      if (byId) { return { item: byId }; }
      return { error: label + ' not found with ID: ' + id + (name ? ' (name was NOT tried; drop the id field to look up by name)' : '') };
    }
    if (!name) { return { error: 'Either id or name must be provided for ' + label + '.' }; }
    var matches = collection.filter(function (o) { return o.name === name; });
    if (matches.length === 0) { return { error: label + ' not found with name: ' + name }; }
    if (matches.length > 1) {
      return { error: 'Ambiguous ' + label + ' name "' + name + '": ' + matches.length + ' matches — ' + __matchList(matches) + '. Use id instead.' };
    }
    return { item: matches[0] };
  }

  // Single-field lookup (tag/folder tools' name_or_id): exact id match first,
  // then case-insensitive name with the same ambiguity guard.
  function __resolveByNameOrId(collection, nameOrId, label) {
    var byId = collection.filter(function (o) { return o.id.primaryKey === nameOrId; })[0];
    if (byId) { return { item: byId }; }
    var lower = nameOrId.toLowerCase();
    var matches = collection.filter(function (o) { return o.name.toLowerCase() === lower; });
    if (matches.length === 0) { return { error: label + ' not found: ' + nameOrId }; }
    if (matches.length > 1) {
      return { error: 'Ambiguous ' + label + ' name "' + nameOrId + '": ' + matches.length + ' matches — ' + __matchList(matches) + '. Use the exact id instead.' };
    }
    return { item: matches[0] };
  }
`;
