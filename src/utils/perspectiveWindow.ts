/** Build a JXA wrapper that reads one saved perspective in its own window.
 * Native window IDs remain stable if the user (or another request) changes
 * window order. Only outline IDs cross into OmniJS; it never reads windows[0].
 */
export function buildPerspectiveWindowScript(scriptContent: string, perspectiveName: string): string {
  const expression = scriptContent.trim().replace(/;$/, '');
  return `function run() {
    const app = Application('OmniFocus');
    const doc = app.defaultDocument;
    let readWindow = null;
    let result;
    let failure = null;
    try {
      // Validate before creating a window: assigning an unknown name through
      // AppleScript can silently leave the window in its default perspective.
      const exists = app.evaluateJavascript(${JSON.stringify(`Boolean(Perspective.Custom.byName(${JSON.stringify(perspectiveName)}))`)});
      if (!exists) return JSON.stringify({ success: false,
        error: 'No custom perspective found with name ' + ${JSON.stringify(JSON.stringify(perspectiveName))} });

      readWindow = app.DocumentWindow({ perspectiveName: ${JSON.stringify(perspectiveName)} });
      doc.documentWindows.push(readWindow);
      readWindow = doc.documentWindows.byId(readWindow.id());
      if (readWindow.searchTerm()) readWindow.searchTerm = '';

      function readNode(node) {
        // Group headings have no database ID. Keep them to preserve the
        // perspective's ordering and the hierarchy beneath each heading.
        return { id: node.id() || null, children: node.trees().map(readNode) };
      }
      const nodes = readWindow.content.trees().map(readNode);
      result = app.evaluateJavascript(
        '(() => { const perspectiveNodes = ' + JSON.stringify(nodes) + '; return (\\n' +
        ${JSON.stringify(expression)} + '\\n); })()'
      );
    } catch (error) {
      failure = { __omnifocusTransportError: true, success: false,
        error: error.message || String(error), code: error.errorNumber || error.number || null };
    } finally {
      if (readWindow) {
        try {
          // Use the native close command: OmniJS Window.close() can leave a
          // newly created window open in OmniFocus 4.9.2.
          if (readWindow.exists()) readWindow.close();
        } catch (error) {
          const cleanup = 'Could not close the temporary perspective window: ' + (error.message || String(error));
          if (!failure && result) {
            try { const data = JSON.parse(result); if (data.success === false) failure = data; } catch (_) {}
          }
          failure = { success: false, error: failure ? failure.error + '; ' + cleanup : cleanup };
        }
      }
    }
    return failure ? JSON.stringify(failure) : result;
  }`;
}
