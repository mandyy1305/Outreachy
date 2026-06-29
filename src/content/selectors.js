// Centralized selector strategies — THE one file to fix when LinkedIn changes
// its DOM. Injected as a classic content script (not a module) alongside
// scraper.js; it attaches its API to globalThis so scraper.js can read it.
//
// LinkedIn now ships a server-driven-UI (SDUI) profile with fully hashed class
// names, no <h1>, and no #about/#experience anchors. The stable hooks are:
//   - The profile-link anchor  a[href*="/in/<slug>/"]  wraps the name (<p> with
//     plain text) and headline (<p><span>).
//   - data-testid="expandable-text-box"  holds the About text AND each post body;
//     post boxes sit inside a componentkey^="feed-..." ancestor, the About box
//     does not.
//   - data-testid="profile_ExperienceTopLevelSection_<slug>"  wraps Experience.
// We keep the older classic-DOM selectors as fallbacks so both layouts work.
//
// Principles: never anchor on a single hashed class; each field has an ORDERED
// list of strategies and the first non-empty wins.

(function () {
  // ---- low-level helpers -------------------------------------------------

  function clean(t) {
    return (t || '').replace(/\s+/g, ' ').trim();
  }
  function text(el) {
    return el ? clean(el.textContent) : '';
  }

  function slug() {
    const m = location.pathname.match(/\/in\/([^/]+)/);
    return m ? m[1] : '';
  }

  // Ordered, de-duplicated visible text lines under a root (TreeWalker over text
  // nodes, so no visible/hidden duplication and no double-counting of nesting).
  function collectLines(root) {
    if (!root) return [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const lines = [];
    let prev = '';
    let node;
    while ((node = walker.nextNode())) {
      const t = clean(node.textContent);
      if (t && t.length >= 2 && t !== prev) {
        lines.push(t);
        prev = t;
      }
    }
    return lines;
  }

  // Is this element part of a feed/activity post (vs. the About card)?
  function isFeedPost(el) {
    let n = el;
    while (n && n !== document.body) {
      const ck = n.getAttribute && n.getAttribute('componentkey');
      if (ck && /^(feed-|FeFeaturedItem)/i.test(ck)) return true;
      n = n.parentElement;
    }
    return !!(el.closest && el.closest('a[href*="/feed/update/"]'));
  }

  function expandableBoxes() {
    return Array.from(document.querySelectorAll('[data-testid="expandable-text-box"]'));
  }

  function ldjson() {
    for (const n of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(n.textContent);
        const graph = data['@graph'] || (Array.isArray(data) ? data : [data]);
        const person = graph.find((g) => g && g['@type'] === 'Person');
        if (person) return person;
      } catch {
        /* skip malformed */
      }
    }
    return null;
  }

  // ---- new SDUI DOM: identity (name + headline) --------------------------

  // The native top-card link to this profile, wrapping name + headline <p>s.
  function identityAnchor() {
    const sl = slug();
    if (!sl) return null;
    const anchors = document.querySelectorAll(`a[href*="/in/${sl}/"]`);
    for (const a of anchors) {
      const ps = a.querySelectorAll('p');
      if (ps.length >= 2) {
        const nameText = clean(ps[0].textContent);
        if (nameText && nameText.length <= 70 && !/^[·•]/.test(nameText)) return a;
      }
    }
    return null;
  }

  function getNameSdui() {
    const a = identityAnchor();
    if (!a) return '';
    return clean(a.querySelectorAll('p')[0]?.textContent);
  }

  function getHeadlineSdui() {
    const a = identityAnchor();
    if (!a) return '';
    return clean(a.querySelectorAll('p')[1]?.textContent);
  }

  // document.title is "(N+) Name | LinkedIn" on the live page.
  function getNameFromTitle() {
    const t = (document.title || '').replace(/\s*\|\s*LinkedIn.*$/i, '').replace(/^\(\d+\+?\)\s*/, '');
    return clean(t);
  }

  function getAboutSdui() {
    for (const box of expandableBoxes()) {
      if (!isFeedPost(box)) {
        const t = text(box);
        if (t && t.length > 40) return t.slice(0, 1500);
      }
    }
    return '';
  }

  function getExperienceSdui() {
    const sec =
      document.querySelector('[data-testid^="profile_ExperienceTopLevelSection"]');
    if (!sec) return [];
    const drop = /^(more|…more|see more|show all|\d+ skills?)$/i;
    const lines = collectLines(sec)
      .filter((l) => l.toLowerCase() !== 'experience')
      .filter((l) => !drop.test(l))
      .filter((l) => !/\band \+\d+ skills?$/i.test(l)); // skill-tag rows
    return lines.slice(0, 12);
  }

  function getActivitySdui() {
    const posts = [];
    const seen = new Set();
    for (const box of expandableBoxes()) {
      if (!isFeedPost(box)) continue;
      const t = text(box).slice(0, 300);
      const key = t.slice(0, 60);
      if (t.length > 20 && !seen.has(key)) {
        seen.add(key);
        posts.push(t);
      }
      if (posts.length >= 5) break;
    }
    return posts;
  }

  // ---- classic DOM fallbacks --------------------------------------------

  function sectionByAnchor(id) {
    const a = document.getElementById(id);
    return a ? a.closest('section') || a.parentElement : null;
  }
  function sectionByHeading(heading) {
    const want = heading.toLowerCase();
    for (const s of document.querySelectorAll('main section')) {
      const h = s.querySelector('h2, h3');
      if (h && text(h).toLowerCase().startsWith(want)) return s;
    }
    return null;
  }
  function visibleLines(root) {
    if (!root) return [];
    const out = [];
    const seen = new Set();
    root.querySelectorAll('span[aria-hidden="true"]').forEach((s) => {
      const t = text(s);
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    });
    return out;
  }

  function getNameClassic() {
    return text(document.querySelector('main h1')) || text(document.querySelector('h1'));
  }
  function getNameLd() {
    const p = ldjson();
    return p && p.name ? clean(String(p.name)) : '';
  }
  function getHeadlineClassic() {
    return text(document.querySelector('main .text-body-medium.break-words'));
  }
  function getHeadlineLd() {
    const p = ldjson();
    if (!p) return '';
    if (typeof p.jobTitle === 'string') return p.jobTitle;
    if (Array.isArray(p.jobTitle)) return p.jobTitle.join(', ');
    return '';
  }
  function getAboutClassic() {
    const sec = sectionByAnchor('about') || sectionByHeading('About');
    const lines = visibleLines(sec).filter((l) => l.toLowerCase() !== 'about');
    return lines.length ? lines.reduce((a, b) => (b.length > a.length ? b : a), '') : '';
  }
  function getExperienceClassic() {
    const sec = sectionByAnchor('experience') || sectionByHeading('Experience');
    if (!sec) return [];
    const roles = [];
    sec.querySelectorAll('li').forEach((li) => {
      if (li.parentElement && li.parentElement.closest('li')) return;
      const lines = visibleLines(li).filter((l) => l.toLowerCase() !== 'experience');
      if (lines.length) roles.push(lines.join(' · '));
    });
    return roles.slice(0, 6);
  }
  function getActivityClassic() {
    const sec =
      sectionByAnchor('content_collections') ||
      sectionByHeading('Activity') ||
      sectionByHeading('Posts');
    if (!sec) return [];
    const posts = [];
    const seen = new Set();
    sec.querySelectorAll('li').forEach((li) => {
      const body = visibleLines(li).reduce((a, b) => (b.length > a.length ? b : a), '');
      const t = body.slice(0, 280);
      if (t && t.length > 20 && !seen.has(t)) {
        seen.add(t);
        posts.push(t);
      }
    });
    return posts.slice(0, 3);
  }

  // ---- the strategy map --------------------------------------------------
  // Each entry: ordered list of () => (string | string[]). First non-empty wins.

  globalThis.RS_SELECTORS = {
    FIELDS: {
      name: [getNameSdui, getNameFromTitle, getNameClassic, getNameLd],
      headline: [getHeadlineSdui, getHeadlineClassic, getHeadlineLd],
      about: [getAboutSdui, getAboutClassic],
      experience: [getExperienceSdui, getExperienceClassic],
      activity: [getActivitySdui, getActivityClassic],
    },
  };
})();
