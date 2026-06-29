// Prompt assembly. The RemoteStar context lives here as a condensed constant
// (sourced from remotestar-overview.md) — we deliberately do NOT dump the whole
// overview into every prompt.

export const REMOTESTAR_CONTEXT = `RemoteStar is a CTO-led tech staffing agency. What sets it apart:
- Every candidate is screened by a CTO-level engineer before reaching the client, so clients judge real technical depth instead of interview polish.
- An in-house AI interviewing platform: JD-based question generation, skill-by-skill resume scoring, candidate matching, and full two-way conversational AI interviews that produce a transcript, per-section scores with reasoning, and a video recording.
- This cuts hiring cycles from weeks to days — clients can see a candidate's technical and communication ability before the first call.
- Pay only on hire (commission, no upfront cost). The platform is also available to license as SaaS.`;

// JSON schema for structured output. Used by both adapters: OpenAI passes it to
// response_format.json_schema; Anthropic uses schema.schema as a tool input_schema.
// NOTE: OpenAI strict mode doesn't support minItems/maxItems, so the variant
// count (2-3) is enforced in the prompt text, not the schema.
export const VARIANTS_SCHEMA = {
  name: 'outreach_variants',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['variants'],
    properties: {
      variants: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['angle', 'message'],
          properties: {
            angle: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  },
};

// Builds the MESSAGE TYPE block from the selected template: its name, its
// goal/approach instructions, and the user's example messages. Each example is
// kept whole (paragraphs intact) and separated by a delimiter — never collapsed.
function templateBlock(template) {
  if (!template) return '';
  const parts = [];
  parts.push(`MESSAGE TYPE: ${val(template.name) || 'Outreach'}`);
  if (val(template.instructions)) parts.push(`GOAL & APPROACH:\n${val(template.instructions)}`);

  const examples = (template.examples || []).map((e) => String(e == null ? '' : e).trim()).filter(Boolean);
  if (examples.length) {
    const joined = examples.map((e, i) => `Example ${i + 1}:\n"""\n${e}\n"""`).join('\n\n');
    parts.push(
      `EXAMPLE MESSAGES the user has actually sent for this template. Mirror their voice, structure, paragraphing, and length — but write fresh content for THIS prospect; never copy phrasing wholesale:\n\n${joined}`,
    );
  }
  return parts.join('\n\n');
}

export function buildSystemPrompt(settings, template) {
  const ctx =
    settings.remoteStarContext && settings.remoteStarContext.trim()
      ? settings.remoteStarContext.trim()
      : REMOTESTAR_CONTEXT;
  const base = val(settings.styleDescription);
  const rules = val(settings.globalRules);
  const typeBlock = templateBlock(template);

  // Optional full override. Supports {{REMOTESTAR_CONTEXT}}, {{STYLE}}, {{TEMPLATE}}, {{RULES}}.
  if (settings.promptTemplate && settings.promptTemplate.trim()) {
    return settings.promptTemplate
      .replaceAll('{{REMOTESTAR_CONTEXT}}', ctx)
      .replaceAll('{{STYLE}}', base)
      .replaceAll('{{TEMPLATE}}', typeBlock)
      .replaceAll('{{RULES}}', rules);
  }

  const styleSection = base ? `\n\nBASE WRITING STYLE (applies to every message):\n${base}` : '';
  const typeSection = typeBlock ? `\n\n${typeBlock}` : '';
  const rulesSection = rules
    ? `\n\nMANDATORY RULES — these are absolute and override everything above, including the base style and the example messages (even if the examples break these rules, you must not):\n${rules}`
    : '';

  return `You write personalized LinkedIn messages on behalf of a business-development representative at RemoteStar, to someone they recently connected with.

ABOUT REMOTESTAR (use only what's relevant to the message type):
${ctx}

GENERAL RULES:
- Match the length and format of the example messages for this template. If there are no examples, keep it to 3-5 sentences (~60-110 words). Multi-paragraph is fine when the examples are.
- Open with a specific, genuine hook drawn from THEIR profile (a recent post, current role/company, focus area). Never use generic openers like "I came across your profile."
- Use the person's first name. Do not invent facts that are not present in the provided profile data.
- Sound human, never robotic or buzzword-y.${styleSection}${typeSection}${rulesSection}

OUTPUT:
Return ONLY JSON matching the provided schema. Produce 2-3 variants of the message described by the MESSAGE TYPE above — each a distinct take (different opening hook / angle / wording), all serving the same goal and matching the example voice. Give each variant a short angle label (a few words).`;
}

export function buildUserPrompt(scraped) {
  const s = scraped || {};
  const parts = [];
  parts.push(`Name: ${val(s.name) || '(unknown)'}`);
  parts.push(`Headline: ${val(s.headline) || '(none provided)'}`);
  if (val(s.experience)) parts.push(`Work history:\n${val(s.experience)}`);
  if (val(s.about)) parts.push(`About:\n${val(s.about)}`);
  if (val(s.activity)) parts.push(`Recent activity:\n${val(s.activity)}`);
  return `Write the message variants for this prospect.\n\n${parts.join('\n\n')}`;
}

function val(v) {
  if (v == null) return '';
  return String(v).trim();
}
