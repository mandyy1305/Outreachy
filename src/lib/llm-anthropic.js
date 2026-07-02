// Anthropic (Claude) adapter — same generate() contract as llm-openai.js, so the
// service worker can swap providers without other changes.
//
// Structured output is done via a FORCED tool call (tool_choice), which works
// across all current Claude models. Note: Opus 4.8/4.7 reject `temperature`
// (400), so this adapter deliberately does NOT send sampling params.
//
// The `anthropic-dangerous-direct-browser-access: true` header is required for
// calls from a browser/extension origin (Anthropic blocks browser-origin CORS
// without it).

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/**
 * @returns {Promise<object>} The tool input matching `schema` — callers validate
 * the shape they need (same contract as llm-openai.js).
 */
export async function generate({ apiKey, model, system, user, schema, signal }) {
  const toolName = schema.name || 'emit_result';
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
        system,
        messages: [{ role: 'user', content: user }],
        tools: [
          {
            name: toolName,
            description: 'Return the structured result.',
            input_schema: schema.schema,
          },
        ],
        tool_choice: { type: 'tool', name: toolName },
      }),
      signal,
    });
  } catch (e) {
    const msg =
      e.name === 'AbortError'
        ? 'Request timed out. Check your connection and try again.'
        : `Network error reaching Anthropic: ${e.message}`;
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
  const toolUse = (data?.content || []).find(
    (b) => b.type === 'tool_use' && b.name === toolName,
  );
  if (!toolUse || !toolUse.input) {
    const err = new Error('Anthropic returned no structured output.');
    err.raw = JSON.stringify(data).slice(0, 500);
    throw err;
  }
  return toolUse.input;
}

function friendlyHttpError(status, detail) {
  if (status === 401) return 'Anthropic rejected the API key (401). Check it in Settings.';
  if (status === 429) return 'Rate limited (429). Wait a moment or check your Anthropic usage.';
  if (status === 400 && detail) return `Anthropic request error: ${detail}`;
  if (status >= 500) return `Anthropic server error (${status}). Try again shortly.`;
  return detail ? `Anthropic error ${status}: ${detail}` : `Anthropic error ${status}.`;
}
