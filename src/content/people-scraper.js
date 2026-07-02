// Injected (classic IIFE) into a background tab at
// linkedin.com/company/<slug>/people/?keywords=<query>.
// Returns { people: [{ name, title, url }] } from the visible result cards.
//
// Strategy: every real person card contains exactly one profile anchor
// (a[href*="/in/"]). Walk up from the anchor to a small card container, then
// read its distinct text lines — first line is the name, the next substantive
// line is the title. Works on both SDUI and classic people-tab layouts, which
// share this anchor+lines shape even though classes differ.

(function () {
  function clean(t) {
    return (t || '').replace(/\s+/g, ' ').trim();
  }

  // Distinct visible text lines under a node (TreeWalker avoids duplicated
  // visible/hidden spans — same trick as selectors.js collectLines).
  function lines(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const out = [];
    let prev = '';
    let node;
    while ((node = walker.nextNode())) {
      const t = clean(node.textContent);
      if (t && t.length >= 2 && t !== prev && !out.includes(t)) {
        out.push(t);
        prev = t;
      }
    }
    return out;
  }

  const DROP_LINE = /^(connect|follow|message|view profile|· 1st|· 2nd|· 3rd|1st|2nd|3rd\+?|linkedin member|\d+ mutual|see all|show more)/i;

  function cardFor(anchor) {
    // Walk up to a container that looks like one person's card: small enough
    // to not swallow neighbours, big enough to hold name + title.
    let n = anchor;
    for (let depth = 0; n && n.parentElement && depth < 8; depth++) {
      const parent = n.parentElement;
      // Stop before a container that holds multiple profile anchors (the grid).
      const anchors = new Set(
        Array.from(parent.querySelectorAll('a[href*="/in/"]')).map((a) => a.href.split('?')[0]),
      );
      if (anchors.size > 1) return n;
      n = parent;
    }
    return n;
  }

  const people = [];
  const seen = new Set();

  for (const a of document.querySelectorAll('a[href*="/in/"]')) {
    const m = (a.getAttribute('href') || '').match(/\/in\/([^/?#]+)/);
    if (!m) continue;
    const slug = m[1];
    if (seen.has(slug)) continue;

    const card = cardFor(a);
    if (!card) continue;
    const ls = lines(card).filter((l) => !DROP_LINE.test(l));
    if (!ls.length) continue;

    const name = ls[0];
    // Out-of-network placeholders and junk rows.
    if (!name || name.length > 60 || /linkedin member/i.test(name)) continue;
    const title = clean((ls[1] || '').replace(/^[·•]\s*/, '')).slice(0, 140);

    seen.add(slug);
    people.push({ name, title, url: `https://www.linkedin.com/in/${slug}/` });
    if (people.length >= 25) break;
  }

  return { people };
})();
