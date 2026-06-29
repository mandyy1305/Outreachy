// SignalHire Person API adapter — looks up a person's email/phone from their
// LinkedIn URL. Uses the SYNCHRONOUS mode (`withoutWaterfall: true`) so results
// come back in the same HTTP response — no callback server needed.
//
//   POST https://www.signalhire.com/api/v1/candidate/search
//   header: apikey: <key>
//   body:   { items: ["<linkedin url>"], withoutWaterfall: true }
//   resp:   { status, candidate: { fullName, contacts: [{type,value,rating,subType}] } }
//
// (This is a paid API that consumes credits per reveal.)

const SEARCH_URL = 'https://www.signalhire.com/api/v1/candidate/search';

export async function lookupContact({ apiKey, profileUrl, signal }) {
  if (!apiKey) {
    const e = new Error('No SignalHire API key set. Add one in Settings.');
    e.code = 'NO_KEY';
    throw e;
  }
  if (!profileUrl) throw new Error('No LinkedIn profile URL to look up.');

  let res;
  try {
    res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ items: [profileUrl], withoutWaterfall: true }),
      signal,
    });
  } catch (e) {
    throw new Error(
      e.name === 'AbortError'
        ? 'SignalHire request timed out.'
        : `Network error reaching SignalHire: ${e.message}`,
    );
  }

  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j?.message || j?.error || '';
    } catch {
      /* non-JSON */
    }
    throw new Error(friendlyHttpError(res.status, detail));
  }

  const data = await res.json();
  const cand = extractCandidate(data);
  const contacts = (cand && Array.isArray(cand.contacts) && cand.contacts) || [];

  const emails = contacts.filter((c) => c.type === 'email').map(mapContact);
  const phones = contacts.filter((c) => c.type === 'phone').map(mapContact);
  // Best confidence first.
  const byRating = (a, b) => (b.rating || 0) - (a.rating || 0);
  emails.sort(byRating);
  phones.sort(byRating);

  return { emails, phones, name: (cand && cand.fullName) || '' };
}

function mapContact(c) {
  return { value: c.value, rating: c.rating, subType: c.subType || '' };
}

// The synchronous response is { status, candidate }, but be defensive about
// array / item-keyed shapes too.
function extractCandidate(data) {
  if (!data) return null;
  if (data.candidate) return data.candidate;
  if (Array.isArray(data)) {
    const hit = data.find((x) => x && x.candidate);
    return hit ? hit.candidate : null;
  }
  for (const k of Object.keys(data)) {
    const v = data[k];
    if (v && v.candidate) return v.candidate;
  }
  return null;
}

function friendlyHttpError(status, detail) {
  if (status === 401) return 'SignalHire rejected the API key (401). Check it in Settings.';
  if (status === 402 || status === 403)
    return 'SignalHire: no credits or access denied. Check your SignalHire plan/credits.';
  if (status === 404) return 'SignalHire found no profile for that LinkedIn URL.';
  if (status === 429) return 'SignalHire rate limited (429). Wait a moment and retry.';
  if (status >= 500) return `SignalHire server error (${status}). Try again shortly.`;
  return detail ? `SignalHire error ${status}: ${detail}` : `SignalHire error ${status}.`;
}
