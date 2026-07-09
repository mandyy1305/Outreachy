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
          required: ['angle', 'subject', 'message'],
          properties: {
            angle: { type: 'string' },
            subject: { type: 'string' }, // email subject; "" for non-email channels
            message: { type: 'string' },
          },
        },
      },
    },
  },
};

// People ranking: given a company + scraped people, score who's worth pitching.
export const PEOPLE_RANK_SCHEMA = {
  name: 'people_rank',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['companyFit', 'ranked'],
    properties: {
      companyFit: {
        type: 'object',
        additionalProperties: false,
        required: ['score', 'reason'],
        properties: {
          score: { type: 'integer' }, // 1-10: would this COMPANY buy RemoteStar?
          reason: { type: 'string' }, // one line
        },
      },
      ranked: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['index', 'score', 'why', 'angle'],
          properties: {
            index: { type: 'integer' }, // index into the provided people list
            score: { type: 'integer' }, // 1-10 buying-relevance
            why: { type: 'string' }, // one line: why they're the right person
            angle: { type: 'string' }, // one line: opening angle for outreach
          },
        },
      },
    },
  },
};

export function buildPeopleRankPrompt(company, people, mode = 'sell') {
  const companyBlock = [
    `Company: ${val(company?.name) || '(unknown)'}`,
    val(company?.tagline) && `What they do: ${val(company.tagline)}`,
    val(company?.industry) && `Industry: ${val(company.industry)}`,
    val(company?.headcount) && `Size: ${val(company.headcount)}`,
  ]
    .filter(Boolean)
    .join('\n');

  const peopleBlock = people
    .map((p, i) => `${i}. ${p.name} — ${p.title || '(no title)'}`)
    .join('\n');

  const companyName = val(company?.name) || 'the target company';
  const goal =
    mode === 'feedback'
      ? `Score each person 1-10 as someone to ask for honest PRODUCT FEEDBACK on RemoteStar (a CTO-led screening + AI interview platform). The ideal person is a peer who personally feels engineering-hiring pain and whose opinion carries weight: founders, CEOs, CTOs, and senior product/engineering leaders score highest; talent acquisition leads mid (useful workflow feedback); HR generalists and ICs low. "angle" = one line on how to open the feedback ask with them.`
      : `Score each person 1-10 as a first contact for SELLING RemoteStar's hiring service TO ${companyName}.`;
  const system = `You qualify leads for RemoteStar, a CTO-led tech staffing agency with an AI interview platform (clients: companies hiring software engineers). The user opened the LinkedIn page of ${companyName} and collected people from its People tab. ${goal}

CRITICAL — affiliation check first: the "title" lines are LinkedIn headlines and are NOT verified job titles at ${companyName}. LinkedIn's People tab also surfaces alumni, vendors, and loosely-associated profiles. If a headline names a DIFFERENT company (e.g. "Founder at SomeOtherCo", "CEO @ XyzLabs"), that person probably does NOT work at ${companyName} — score them 1-2 and say so in "why" (e.g. "appears to be founder of SomeOtherCo, not staff at ${companyName}"). A "Founder" headline is only a top score if it's plausibly the founder OF ${companyName} — the headline names ${companyName}, names no other company, or is a bare title with nothing contradicting it.

${
    mode === 'feedback'
      ? 'Scoring guide (only AFTER affiliation is plausible): founders, CEOs, CTOs, and senior engineering/product leaders score highest — peers whose feedback is strategic; talent acquisition leads mid; HR generalists, ICs, and unrelated functions low.'
      : 'Scoring guide (only AFTER affiliation is plausible): founders/CEOs at small companies and engineering leaders who own hiring (CTO, VP Eng, Head of Engineering) score highest; talent acquisition / recruiting / HR leads high; engineering managers mid; ICs and unrelated functions low. Consider size: at a tiny startup the founder is the buyer; at a bigger one, talent/HR leads matter more.'
  }

Ground every score in the provided data only. Missing or thin data means a LOWER score, never a generous guess — nobody scores above 6 unless the data actually supports it.

Also return companyFit: 1-10 on whether ${companyName} itself is a plausible RemoteStar buyer (a product/tech company that hires software engineers scores high; agencies, non-tech, or unclear score low), with a one-line reason. If companyFit is 4 or less, cap every person score at 4.

Return ONLY JSON matching the schema. Include EVERY person, using their index from the list. "why" = one specific line on why they're (or aren't) the buyer. "angle" = one line suggesting how to open with them.`;

  const user = `${companyBlock}\n\nPeople:\n${peopleBlock}`;
  return { system, user };
}

// Call-prep notes: a structured brief for a sales/discovery call with the
// prospect. Same adapters as message generation, different schema + prompt.
export const CALL_NOTES_SCHEMA = {
  name: 'call_notes',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['snapshot', 'hooks', 'pitchAngles', 'discoveryQuestions', 'objections', 'nextStep'],
    properties: {
      snapshot: { type: 'string' }, // who they are + company, 2-3 sentences
      hooks: { type: 'array', items: { type: 'string' } }, // why-them-why-now openers
      pitchAngles: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['angle', 'talkTrack'],
          properties: {
            angle: { type: 'string' }, // RemoteStar differentiator to lead with
            talkTrack: { type: 'string' }, // 1-2 sentences, in the caller's voice
          },
        },
      },
      discoveryQuestions: { type: 'array', items: { type: 'string' } },
      objections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['objection', 'response'],
          properties: {
            objection: { type: 'string' },
            response: { type: 'string' },
          },
        },
      },
      nextStep: { type: 'string' }, // the concrete ask to close the call with
    },
  },
};

export function buildCallNotesSystemPrompt(settings, mode = 'sell') {
  const ctx =
    settings.remoteStarContext && settings.remoteStarContext.trim()
      ? settings.remoteStarContext.trim()
      : REMOTESTAR_CONTEXT;
  const role = val(settings.senderRole) || 'Founding Engineer';

  if (mode === 'feedback') {
    return `You prepare session notes for a ${role} at RemoteStar about to run a PRODUCT FEEDBACK session with a founder/CEO/CTO. The host BUILDS the product they're showing — let that authenticity carry the session. This is NOT a sales call: the goal is to show what RemoteStar is building, listen hard, and learn — any commercial interest must come from THEM. Notes are for the host's eyes only: practical, specific, skimmable live.

ABOUT REMOTESTAR (what will be shown):
${ctx}

Build the notes strictly from the provided profile/company/research data — never invent facts. Where data is thin, keep sections short rather than padding them.

Sections (reuse the schema fields as follows):
- snapshot: who this person is and where they work, 2-3 sentences.
- hooks: 2-4 specific reasons THEIR perspective matters (their hiring history, scale, posts) — use these to open the session.
- pitchAngles: 2-3 DEMO BEATS — which part of the product to show and why it will resonate with THIS person (angle = the feature/moment, talkTrack = one line of framing while showing it). Never phrased as selling.
- discoveryQuestions: 4-6 feedback questions that elicit honest reactions (what feels off, would they trust an AI interview score, what would make this a no, how do they screen today).
- objections: 2-4 skeptical reactions THIS person is likely to voice (e.g. "AI interviews feel impersonal"), each with an honest, non-defensive response that invites more detail rather than rebutting.
- nextStep: a soft close that keeps it non-commercial (e.g. thank them + offer to share what changes from their feedback; if THEY ask about using it, offer to run one real role through the platform).

Return ONLY JSON matching the provided schema.`;
  }

  return `You prepare call notes for a ${role} at RemoteStar about to get on a sales call with a prospect. The notes are for the caller's eyes only — practical, specific, skimmable during a live call. Plain conversational language, no fluff, no generic sales advice.

ABOUT REMOTESTAR:
${ctx}

Build the notes strictly from the provided profile/company/research data — never invent facts. Where data is thin, keep sections short rather than padding them.

Sections:
- snapshot: who this person is and where they work, 2-3 sentences.
- hooks: 2-4 specific why-them-why-now conversation openers drawn from their posts, role, or company signals.
- pitchAngles: 2-3, each pairing ONE RemoteStar differentiator (CTO-led screening, AI interview platform, speed, pay-on-hire) with a 1-2 sentence talk track tailored to THIS prospect's likely hiring pain.
- discoveryQuestions: 3-5 open questions to understand their hiring process, volume, and pain.
- objections: the 2-4 pushbacks THIS prospect is most likely to raise (given their role/company stage), each with a concise, honest response.
- nextStep: the one concrete ask to end the call with.

Return ONLY JSON matching the provided schema.`;
}

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

const CHANNEL_GUIDANCE = {
  linkedin:
    'CHANNEL: LinkedIn direct message. Keep it tight and skimmable. Leave the "subject" field empty.',
  whatsapp:
    'CHANNEL: WhatsApp message. Very short and casual — 1 to 3 short sentences, like texting a peer. No greeting/sign-off boilerplate. Leave the "subject" field empty.',
  email: `CHANNEL: Email — a professional cold email, not a DM. Formatting requirements:
- Standard capitalization and punctuation throughout, including the subject.
- Subject: short and specific to THEM (their company/role/situation), never clickbait, no "quick question".
- Structure: greeting line with first name → one specific, factual observation about them or their company (no flattery) → one or two sentences on why RemoteStar is relevant to THAT observation, with a concrete proof point → one clear, low-pressure ask → sign-off.
- 60-120 words total.
- PARAGRAPHS ARE MANDATORY: the greeting is its own line, then 2-4 short paragraphs (1-2 sentences each), each separated by a BLANK line (a literal \\n\\n inside the JSON string). Never return one solid block of text.
- SIGN-OFF IS MANDATORY: end with a closing like "Best," or "Thanks," on its own line, followed by the sender's first name on the next line.
- BANNED: "congrats on", "huge step", "testament to", "impressive", "love what you're doing", "I hope this finds you well", "I came across", "leverage", "ensure", and any opener that compliments instead of observing. Lead with substance, not praise.`,
};

// Feedback mode reframes the entire message: no selling, just "we're building
// this, your take as someone who hires engineers would genuinely help". The
// product gets its showcase implicitly; if they're interested, that's their move.
const FEEDBACK_MODE_GUIDANCE = `MODE: FEEDBACK ASK — this message does NOT sell. The goal is honest product feedback from a peer (founder/CEO/CTO) who knows the pain of hiring engineers.
- Frame: we're building RemoteStar (describe what it is in ONE concrete sentence, e.g. the AI interview that produces a scored, recorded report per candidate); given what THEY have built/do, their reaction would genuinely help us.
- The ask: a short feedback chat (15 minutes) or even an async reaction ("happy to send a 2-minute sample report if easier").
- HARD RULES: never pitch the service, never suggest they use or buy it, no "we can help you hire", no pricing, no "differentiators". If curiosity turns into interest, that's their move — the message only asks for their opinion.
- Where the channel guidance above says to connect RemoteStar's relevance or make an ask, apply it in feedback terms: relevance = why THEIR perspective matters; ask = the feedback chat.`;

export function buildSystemPrompt(settings, template, channel, mode = 'sell') {
  const ctx =
    settings.remoteStarContext && settings.remoteStarContext.trim()
      ? settings.remoteStarContext.trim()
      : REMOTESTAR_CONTEXT;
  const base = val(settings.styleDescription);
  const rules = val(settings.globalRules);
  const typeBlock = templateBlock(template);
  const channelText = CHANNEL_GUIDANCE[channel] || CHANNEL_GUIDANCE.linkedin;

  // Optional full override. Supports {{REMOTESTAR_CONTEXT}}, {{STYLE}}, {{TEMPLATE}}, {{RULES}}, {{CHANNEL}}.
  if (settings.promptTemplate && settings.promptTemplate.trim()) {
    return settings.promptTemplate
      .replaceAll('{{REMOTESTAR_CONTEXT}}', ctx)
      .replaceAll('{{STYLE}}', base)
      .replaceAll('{{TEMPLATE}}', typeBlock)
      .replaceAll('{{RULES}}', rules)
      .replaceAll('{{CHANNEL}}', channelText);
  }

  const sender = val(settings.senderName);
  const role = val(settings.senderRole) || 'Founding Engineer';
  const senderSection = sender
    ? `\n\nSENDER: You write as ${sender}, ${role} at RemoteStar — someone who personally builds the product, not a salesperson. When it's natural, the sender may say so ("I'm a ${role.toLowerCase()} at RemoteStar"). When a sign-off is called for, sign with "${sender.split(' ')[0]}". NEVER write "[Your Name]" or any bracketed placeholder.`
    : `\n\nSENDER: You write as a ${role} at RemoteStar — someone who personally builds the product, not a salesperson. The sender's name is not configured: end messages with the sign-off word alone (e.g. "best,") and no name — NEVER write "[Your Name]" or any bracketed placeholder.`;

  // The saved style/rules are authored for casual DMs (all-lowercase, texting
  // voice). Applying them to email produced lowercase, unstructured blobs and
  // models can't reliably resolve rule-vs-exception conflicts — so email gets
  // ONLY the channel requirements, and DMs keep the user's voice untouched.
  const isEmail = channel === 'email';
  const styleSection =
    !isEmail && base ? `\n\nBASE WRITING STYLE (applies to every message):\n${base}` : '';
  const typeSection = typeBlock ? `\n\n${typeBlock}` : '';
  const rulesSection =
    !isEmail && rules
      ? `\n\nMANDATORY RULES — these are absolute and override everything above, including the base style and the example messages (even if the examples break these rules, you must not):\n${rules}`
      : '';

  const modeSection = mode === 'feedback' ? `\n\n${FEEDBACK_MODE_GUIDANCE}` : '';

  return `You write personalized outreach messages on behalf of a ${role} at RemoteStar, to someone they recently connected with.

${channelText}${modeSection}

ABOUT REMOTESTAR (use only what's relevant to the message type):
${ctx}${senderSection}

GENERAL RULES:
- Match the length and format of the example messages for this template. If there are no examples, keep it to 3-5 sentences (~60-110 words). Multi-paragraph is fine when the examples are.
- Open with a specific, genuine hook drawn from THEIR profile (a recent post, current role/company, focus area). Never use generic openers like "I came across your profile."
- Use the person's first name. Do not invent facts that are not present in the provided profile data.
- Sound human, never robotic or buzzword-y.${styleSection}${typeSection}${rulesSection}

OUTPUT:
Return ONLY JSON matching the provided schema. Produce ${channel === 'email' ? '3-4' : '2-3'} variants of the message described by the MESSAGE TYPE above for the CHANNEL above — each a distinct take (different opening hook / angle / wording), all serving the same goal and matching the example voice. Give each variant a short angle label (a few words). Fill "subject" only for the email channel; otherwise set it to an empty string.`;
}

export function buildUserPrompt(scraped) {
  const s = scraped || {};
  const parts = [];
  parts.push(`Name: ${val(s.name) || '(unknown)'}`);
  parts.push(`Headline: ${val(s.headline) || '(none provided)'}`);
  if (val(s.experience)) parts.push(`Work history:\n${val(s.experience)}`);
  if (val(s.about)) parts.push(`About:\n${val(s.about)}`);
  if (val(s.activity)) parts.push(`Recent activity:\n${val(s.activity)}`);
  if (val(s.research)) parts.push(`Research brief (web search, verified sources):\n${val(s.research)}`);
  return `Write the message variants for this prospect.\n\n${parts.join('\n\n')}`;
}

function val(v) {
  if (v == null) return '';
  return String(v).trim();
}
