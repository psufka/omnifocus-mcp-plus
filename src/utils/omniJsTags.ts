/** Pure resolution first; all tag mutations use the resolved object identities. */
export const OMNIJS_TAG_HELPERS = `
  function __tagPathMatches(path) {
    var literal = __preferActive(flattenedTags.filter(function (tag) { return tag.name === path; }));
    if (literal.length > 0) return literal;
    var found = [];
    for (var i = path.length - 1; i >= 0; i--) {
      if (path[i] !== '/') continue;
      var parents = __tagPathMatches(path.substring(0, i));
      var leaf = path.substring(i + 1);
      flattenedTags.forEach(function (tag) {
        if (tag.name === leaf && parents.indexOf(tag.parent) !== -1 && found.indexOf(tag) === -1) found.push(tag);
      });
    }
    return __preferActive(found);
  }

  function __resolveTagPlan(names, ids, allowCreate) {
    var entries = [], missing = [], existing = [];
    var seen = Object.create(null);
    var byIds = ids || [];
    for (var i = 0; i < byIds.length; i++) {
      var lookup = __resolveByIdOrName(flattenedTags, byIds[i], null, 'Tag');
      if (lookup.error) return { error: lookup.error };
      var key = lookup.item.id.primaryKey;
      if (!seen['id:' + key]) { entries.push({ tag: lookup.item, id: key }); seen['id:' + key] = true; existing.push(lookup.item.name); }
    }
    var byNames = names || [];
    for (var n = 0; n < byNames.length; n++) {
      var name = byNames[n];
      if (!name || !name.trim()) return { error: 'Tag names must not be empty.' };
      var matches = __tagPathMatches(name);
      if (matches.length > 1) return { error: 'Ambiguous Tag name "' + name + '": ' + __matchList(matches) + '. Use tag IDs or a unique parent/name path.' };
      if (matches.length === 0) {
        if (allowCreate === 'ignoreMissing') continue;
        if (!allowCreate || name.indexOf('/') !== -1) return { error: 'Tag not found: ' + name + '. Create it first with create_tag or use an exact tag ID.' };
        if (!seen['new:' + name]) { entries.push({ name: name }); missing.push(name); seen['new:' + name] = true; }
      } else {
        var id = matches[0].id.primaryKey;
        if (!seen['id:' + id]) { entries.push({ tag: matches[0], id: id }); existing.push(matches[0].name); seen['id:' + id] = true; }
      }
    }
    return { entries: entries, existing: existing, missing: missing };
  }

  function __materializeTagPlan(plan, created) {
    var resolved = [];
    plan.entries.forEach(function (entry) {
      if (!entry.tag) {
        entry.tag = new Tag(entry.name);
        entry.id = entry.tag.id.primaryKey;
        if (created) created.push({ obj: entry.tag, kind: 'tag', name: entry.name });
      }
      resolved.push(entry.tag);
    });
    return resolved;
  }

  function __tagIds(item) { return item.tags.map(function (tag) { return tag.id.primaryKey; }).sort(); }
  function __verifyTagPlan(item, plan) {
    var actual = __tagIds(item);
    var expected = plan.entries.map(function (entry) { return entry.id; });
    return expected.every(function (id) { return actual.indexOf(id) !== -1; });
  }
`;
