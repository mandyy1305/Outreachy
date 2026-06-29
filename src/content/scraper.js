// Injected (classic, non-module) after selectors.js. Runs every field's
// strategy list, builds a per-field { value, status } result, and returns it.
// The IIFE's return value is the completion value chrome.scripting.executeScript
// hands back to the side panel.
//
// status: 'ok'     -> a strategy produced a non-empty value
//         'empty'   -> strategies ran but found nothing
//         'failed'  -> every strategy threw (likely a LinkedIn DOM change)

(function () {
  const S = globalThis.RS_SELECTORS;
  if (!S || !S.FIELDS) {
    return { error: 'Selectors failed to load.' };
  }

  function resolve(strategies) {
    let threw = false;
    for (const fn of strategies) {
      try {
        const v = fn();
        const has = Array.isArray(v)
          ? v.length > 0
          : v != null && String(v).trim() !== '';
        if (has) return { value: v, status: 'ok' };
      } catch {
        threw = true;
      }
    }
    return { value: null, status: threw ? 'failed' : 'empty' };
  }

  const fields = {};
  for (const [key, strategies] of Object.entries(S.FIELDS)) {
    try {
      fields[key] = resolve(strategies);
    } catch (e) {
      fields[key] = { value: null, status: 'failed' };
    }
  }

  return {
    url: location.href,
    scrapedAt: new Date().toISOString(),
    fields,
  };
})();
