// Injected (classic IIFE) into a background tab pointed at a profile's
// /recent-activity/all/ page. Returns { posts: string[] }. Phase 2, opt-in.
//
// On the activity page the whole feed is the person's own activity, so we can
// take every post body. New LinkedIn SDUI uses data-testid="expandable-text-box"
// for post text; we fall back to feed-update containers and long dir=ltr spans.

(function () {
  function clean(t) {
    return (t || '').replace(/\s+/g, ' ').trim();
  }

  const posts = [];
  const seen = new Set();
  function consider(raw) {
    const t = clean(raw).slice(0, 320);
    const key = t.slice(0, 60);
    if (t && t.length > 25 && !seen.has(key)) {
      seen.add(key);
      posts.push(t);
    }
  }

  // Primary (new SDUI DOM): post bodies.
  document.querySelectorAll('[data-testid="expandable-text-box"]').forEach((b) => consider(b.textContent));

  // Fallback (classic DOM): feed update cards, longest text span each.
  if (!posts.length) {
    document
      .querySelectorAll('div.feed-shared-update-v2, li.profile-creator-shared-feed-update__container')
      .forEach((card) => {
        let best = '';
        card.querySelectorAll('span[dir="ltr"], .update-components-text').forEach((s) => {
          const t = clean(s.textContent);
          if (t.length > best.length) best = t;
        });
        consider(best);
      });
  }

  // Last resort: any substantial left-to-right text span.
  if (!posts.length) {
    document.querySelectorAll('span[dir="ltr"]').forEach((s) => {
      const t = clean(s.textContent);
      if (t.length > 60) consider(t);
    });
  }

  return { posts: posts.slice(0, 8) };
})();
