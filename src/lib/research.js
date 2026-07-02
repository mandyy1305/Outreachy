// Deep research: a web-search-backed brief on the prospect + their company,
// using the SAME provider + API key already configured for generation.
//   OpenAI    -> Responses API with the built-in `web_search` tool
//   Anthropic -> Messages API with the `web_search_20250305` server tool
// Returns plain text that the side panel drops into an editable Research box —
// it then feeds message generation and call notes via buildUserPrompt.

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const BRIEF_SPEC = `Write a compact research brief (under 250 words, plain text, short bullet-like lines) for a RemoteStar sales rep (RemoteStar = CTO-led tech staffing + AI interview platform; buyers are companies hiring software engineers). Cover, when findable:
- Company: what it does, stage/funding, headcount trend, recent news.
- Hiring signals: open engineering roles, careers page activity, growth announcements.
- The person: public footprint, talks/posts/interviews, what they care about.
- 3 specific outreach hooks connecting the above to RemoteStar's pitch.
Only include what you actually found — no padding, no invented facts. If something isn't findable, skip it.`;

function subjectLine(scraped, company) {
  const bits = [];
  if (scraped?.name) bits.push(`Person: ${scraped.name}${scraped.headline ? ` — ${scraped.headline}` : ''}`);
  if (scraped?.experience) bits.push(`Work history:\n${scraped.experience}`);
  if (company?.name) {
    bits.push(
      `Company: ${company.name}${company.tagline ? ` — ${company.tagline}` : ''}${company.headcount ? ` (${company.headcount})` : ''}`,
    );
    if (company.website) bits.push(`Website: ${company.website}`);
  }
  return bits.join('\n') || '(no subject data provided)';
}

export async function research({ provider, apiKey, model, scraped, company, signal }) {
  const user = `Research this prospect for outreach:\n\n${subjectLine(scraped, company)}\n\n${BRIEF_SPEC}`;
  if (provider === 'anthropic') return anthropicResearch({ apiKey, model, user, signal });
  return openaiResearch({ apiKey, model, user, signal });
}

async function openaiResearch({ apiKey, model, user, signal }) {
  let res;
  try {
    res = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        tools: [{ type: 'web_search' }],
        input: user,
      }),
      signal,
    });
  } catch (e) {
    throw netError(e, 'OpenAI');
  }
  if (!res.ok) {
    const detail = await errDetail(res);
    if (res.status === 400 && /web_search|tool/i.test(detail)) {
      throw new Error(
        `This OpenAI model can't use web search (${detail}). Try gpt-4o-mini or gpt-4o in Settings.`,
      );
    }
    throw new Error(detail ? `OpenAI error ${res.status}: ${detail}` : `OpenAI error ${res.status}.`);
  }
  const data = await res.json();
  // Responses API: text lives in output[] -> message items -> output_text parts.
  const text = (data.output || [])
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content || [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('OpenAI returned an empty research brief.');
  return text;
}

async function anthropicResearch({ apiKey, model, user, signal }) {
  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        messages: [{ role: 'user', content: user }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
      }),
      signal,
    });
  } catch (e) {
    throw netError(e, 'Anthropic');
  }
  if (!res.ok) {
    const detail = await errDetail(res);
    throw new Error(detail ? `Anthropic error ${res.status}: ${detail}` : `Anthropic error ${res.status}.`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Anthropic returned an empty research brief.');
  return text;
}

function netError(e, who) {
  return new Error(
    e.name === 'AbortError'
      ? 'Research timed out — web search can be slow; try again.'
      : `Network error reaching ${who}: ${e.message}`,
  );
}

async function errDetail(res) {
  try {
    const j = await res.json();
    return j?.error?.message || '';
  } catch {
    return '';
  }
}
