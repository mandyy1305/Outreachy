// OpenAI adapter. This is the provider abstraction boundary: generate() has a
// provider-neutral signature, so adding Claude/others later means a new adapter
// file that exports the same generate() contract + an extra host_permission.

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * @returns {Promise<object>} The parsed JSON object matching `schema` — callers
 * validate the shape they need (e.g. .variants for messages, sections for notes).
 * Throws Error with optional .status (HTTP) and .raw (unparsed model output).
 */
export async function generate({ apiKey, model, temperature, system, user, schema, signal }) {
  let res;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_schema', json_schema: schema },
      }),
      signal,
    });
  } catch (e) {
    // Network failure or aborted request.
    const msg =
      e.name === 'AbortError'
        ? 'Request timed out. Check your connection and try again.'
        : `Network error reaching OpenAI: ${e.message}`;
    throw new Error(msg);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j?.error?.message || '';
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(friendlyHttpError(res.status, detail));
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned an empty response.');

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const err = new Error('Could not parse the model output as JSON.');
    err.raw = content;
    throw err;
  }
  return parsed;
}

function friendlyHttpError(status, detail) {
  if (status === 401) return 'OpenAI rejected the API key (401). Check it in Settings.';
  if (status === 429)
    return 'Rate limited or out of credits (429). Wait a moment or check your OpenAI billing.';
  if (status === 400 && detail) return `OpenAI request error: ${detail}`;
  if (status >= 500) return `OpenAI server error (${status}). Try again shortly.`;
  return detail ? `OpenAI error ${status}: ${detail}` : `OpenAI error ${status}.`;
}
