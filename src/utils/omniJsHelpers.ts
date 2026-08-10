/**
 * Shared OmniJS source snippets, prepended to tool scripts before they are
 * passed to runOmniJs(). These are the single implementation of item lookup
 * used by every mutation tool, with three safety rules:
 *
 *   1. An explicitly provided ID that matches nothing is an ERROR — it never
 *      falls back to name matching (a stale ID must not mutate a same-named
 *      different item).
 *   2. A name matching several items prefers the unique ACTIVE one — a stale
 *      dropped/completed copy must not block the live item — and only errors
 *      (listing every match with its status) when that tiebreak fails.
 *   3. ID lookups use the class-level byIdentifier() fast path (verified to
 *      return null on miss), with membership in the passed collection checked
 *      via indexOf so semantics stay identical to the original linear scan.
 *
 * Both resolvers return { item } on success or { error } on failure.
 * Written without template literals or `$` so the runOmniJs escaping layer
 * has nothing to transform.
 */
export const OMNIJS_LOOKUP_HELPERS = `
  // "[object Project.Status: Active]" -> "Active"; '' when no status exists.
  // .status is checked FIRST: a Project exposes BOTH .status and .taskStatus
  // (the latter is its root task's status, e.g. "Blocked"), so taskStatus-first
  // would misreport every project. Only Task lacks .status entirely.
  function __statusLabel(o) {
    try {
      var v = (o.status !== undefined) ? o.status : o.taskStatus;
      if (v === undefined || v === null) { return ''; }
      var s = String(v);
      var i = s.indexOf(': ');
      if (i >= 0 && s.charAt(s.length - 1) === ']') { return s.slice(i + 2, -1); }
      return '';
    } catch (e) { return ''; }
  }

  function __isActive(o) {
    var l = __statusLabel(o);
    return l !== 'Dropped' && l !== 'Completed' && l !== 'Done';
  }

  function __matchList(matches) {
    return matches.slice(0, 5).map(function (m) {
      var loc = '';
      if (m.containingProject) { loc = ' in "' + m.containingProject.name + '"'; }
      else if (m.parent && m.parent.name) { loc = ' in "' + m.parent.name + '"'; }
      var st = __statusLabel(m);
      return '"' + m.name + '" (id: ' + m.id.primaryKey + loc + (st ? ', ' + st : '') + ')';
    }).join(', ');
  }

  // Label -> OmniJS class, for byIdentifier. 'task' is checked first so
  // labels like 'Destination parent task' resolve to Task, not Project.
  // typeof-guarded so the helpers also run outside OmniFocus (unit tests),
  // where the classes are absent and lookups fall back to the linear scan.
  function __lookupClassFor(label) {
    var l = String(label).toLowerCase();
    if (l.indexOf('task') >= 0) { return typeof Task === 'undefined' ? null : Task; }
    if (l.indexOf('project') >= 0) { return typeof Project === 'undefined' ? null : Project; }
    if (l.indexOf('folder') >= 0) { return typeof Folder === 'undefined' ? null : Folder; }
    if (l.indexOf('tag') >= 0) { return typeof Tag === 'undefined' ? null : Tag; }
    return null;
  }

  // byIdentifier fast path with linear-scan fallback. The indexOf membership
  // check keeps "id must be in the passed collection" semantics; identity
  // comparison is far cheaper than per-element primaryKey string reads.
  // Property reads are guarded: an object scheduled for deletion (a freshly
  // deleted item still present in a re-read collection) THROWS on any
  // property access — such zombies count as non-matches, not as errors.
  function __findById(collection, id, label) {
    var cls = __lookupClassFor(label);
    if (cls && typeof cls.byIdentifier === 'function') {
      // byIdentifier returns null for an unknown id but THROWS "scheduled for
      // deletion" for a just-deleted one (verified live) — both mean "gone".
      var hit = null;
      try { hit = cls.byIdentifier(id); } catch (e) { hit = null; }
      if (hit && collection.indexOf(hit) !== -1) {
        try { if (hit.id.primaryKey === id) { return hit; } } catch (e) { return null; }
      }
    }
    var scanned = collection.filter(function (o) {
      try { return o.id.primaryKey === id; } catch (e) { return false; }
    });
    return scanned.length > 0 ? scanned[0] : null;
  }

  // Several same-named matches: if exactly one is active, that one wins.
  function __preferActive(matches) {
    if (matches.length < 2) { return matches; }
    var active = matches.filter(__isActive);
    return active.length === 1 ? active : matches;
  }

  // Strict two-field lookup: explicit id wins and never falls back to name.
  function __resolveByIdOrName(collection, id, name, label) {
    if (id) {
      var byId = __findById(collection, id, label);
      if (byId) { return { item: byId }; }
      return { error: label + ' not found with ID: ' + id + (name ? ' (name was NOT tried; drop the id field to look up by name)' : '') };
    }
    if (!name) { return { error: 'Either id or name must be provided for ' + label + '.' }; }
    var matches = __preferActive(collection.filter(function (o) {
      try { return o.name === name; } catch (e) { return false; }
    }));
    if (matches.length === 0) { return { error: label + ' not found with name: ' + name }; }
    if (matches.length > 1) {
      return { error: 'Ambiguous ' + label + ' name "' + name + '": ' + matches.length + ' matches — ' + __matchList(matches) + '. Use id instead.' };
    }
    return { item: matches[0] };
  }

  // Single-field lookup (tag/folder tools' name_or_id): exact id match first,
  // then case-insensitive name with the same active-preference and ambiguity
  // guard.
  function __resolveByNameOrId(collection, nameOrId, label) {
    var byId = __findById(collection, nameOrId, label);
    if (byId) { return { item: byId }; }
    var lower = nameOrId.toLowerCase();
    var matches = __preferActive(collection.filter(function (o) {
      try { return o.name.toLowerCase() === lower; } catch (e) { return false; }
    }));
    if (matches.length === 0) { return { error: label + ' not found: ' + nameOrId }; }
    if (matches.length > 1) {
      return { error: 'Ambiguous ' + label + ' name "' + nameOrId + '": ' + matches.length + ' matches — ' + __matchList(matches) + '. Use the exact id instead.' };
    }
    return { item: matches[0] };
  }
`;
