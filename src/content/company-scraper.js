// Injected (classic IIFE) into an open linkedin.com/company/<slug> page.
// Returns { name, tagline, industry, headcount, website } — best effort, any
// field may be ''. Feeds people-ranking and research context.

(function () {
  function clean(t) {
    return (t || '').replace(/\s+/g, ' ').trim();
  }

  // Name: og:title / document.title are the most stable ("Acme | LinkedIn").
  function getName() {
    const og = document.querySelector('meta[property="og:title"]');
    const raw = (og && og.content) || document.title || '';
    return clean(raw.replace(/\s*[|·]\s*LinkedIn.*$/i, '').replace(/^\(\d+\+?\)\s*/, ''));
  }

  // ld+json Organization block, when present.
  function ldOrg() {
    for (const n of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(n.textContent);
        const graph = data['@graph'] || (Array.isArray(data) ? data : [data]);
        const org = graph.find((g) => g && g['@type'] === 'Organization');
        if (org) return org;
      } catch {
        /* skip malformed */
      }
    }
    return null;
  }

  function getTagline() {
    const org = ldOrg();
    if (org && org.description) return clean(String(org.description)).slice(0, 300);
    const og = document.querySelector('meta[property="og:description"], meta[name="description"]');
    return og ? clean(og.content).slice(0, 300) : '';
  }

  // "Software Development · 51-200 employees" style lines appear near the top
  // card; fall back to a body-text regex for the employee bracket.
  function getHeadcount() {
    const m = document.body.innerText.match(/([\d,]+(?:-[\d,]+)?\+?)\s+employees/i);
    return m ? m[1] + ' employees' : '';
  }

  function getIndustry() {
    const org = ldOrg();
    if (org && org.industry) return clean(String(org.industry));
    return '';
  }

  function getWebsite() {
    const org = ldOrg();
    if (org && org.sameAs) return clean(String(org.sameAs));
    // The visible website chip on the about/top card is an outbound link.
    const a = document.querySelector('a[href^="http"][href*="trk=about_website"]');
    return a ? a.href : '';
  }

  return {
    url: location.href,
    name: getName(),
    tagline: getTagline(),
    industry: getIndustry(),
    headcount: getHeadcount(),
    website: getWebsite(),
  };
})();
