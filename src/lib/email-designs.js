// Email designs: turn generated plain-text copy into a polished HTML email.
// Table-based layout + inline CSS only (email clients strip <style>), system
// font stack, muted palette that survives Gmail dark-mode color inversion.
// Every design also keeps a text/plain alternative (built in gmail.js), which
// is what plain-text-preferring clients and spam filters see.

const ACCENT = '#2f6df6';
const TEXT = '#1f2430';
const MUTED = '#6b7386';
const BORDER = '#e6e9f2';
const BG = '#f4f6fb';

export const EMAIL_DESIGNS = [
  { id: 'plain', name: 'Plain text (best deliverability)' },
  { id: 'clean', name: 'Clean — typographic, subtle accent' },
  { id: 'card', name: 'Card — branded header + call button' },
];

// -> html string, or null for the plain design (text-only email).
export function renderEmailHtml(designId, { bodyText, senderName, ctaText, ctaUrl }) {
  if (designId === 'clean') return clean({ bodyText, senderName });
  if (designId === 'card') return card({ bodyText, senderName, ctaText, ctaUrl });
  return null;
}

function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// Paragraphs on blank lines; single newlines become <br>.
function paragraphs(bodyText, size = 15) {
  return String(bodyText || '')
    .trim()
    .split(/\n\s*\n/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:${size}px;line-height:1.65;color:${TEXT};">${escapeHtml(p).replaceAll('\n', '<br />')}</p>`,
    )
    .join('');
}

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function signature(senderName) {
  const name = senderName
    ? `<span style="color:${TEXT};font-weight:600;">${escapeHtml(senderName)}</span><br />`
    : '';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:1px solid ${BORDER};">
      <tr><td style="padding-top:14px;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};">
        ${name}RemoteStar · CTO-led tech hiring
        <br /><a href="https://remotestar.io" style="color:${ACCENT};text-decoration:none;">remotestar.io</a>
      </td></tr>
    </table>`;
}

function shell(inner) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${BG};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          ${inner}
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

// ---- clean: quiet typography, thin accent rule, subtle signature ----------
function clean({ bodyText, senderName }) {
  return shell(`
    <tr><td style="background:#ffffff;border:1px solid ${BORDER};border-radius:12px;padding:30px 32px;font-family:${FONT};">
      <div style="width:44px;height:3px;background:${ACCENT};border-radius:2px;margin:0 0 22px;"></div>
      ${paragraphs(bodyText)}
      ${signature(senderName)}
    </td></tr>`);
}

// ---- card: branded header band + optional CTA button -----------------------
function card({ bodyText, senderName, ctaText, ctaUrl }) {
  const button = ctaUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 4px;">
        <tr><td style="border-radius:9px;background:${ACCENT};">
          <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:11px 22px;font-family:${FONT};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:9px;">
            ${escapeHtml(ctaText || 'Book a quick call')}
          </a>
        </td></tr>
      </table>`
    : '';
  return shell(`
    <tr><td style="background:${ACCENT};border-radius:12px 12px 0 0;padding:16px 32px;font-family:${FONT};">
      <span style="font-size:15px;font-weight:700;color:#ffffff;letter-spacing:0.2px;">RemoteStar</span>
      <span style="font-size:12px;color:#dbe6ff;"> &nbsp;·&nbsp; CTO-led tech hiring</span>
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid ${BORDER};border-top:0;border-radius:0 0 12px 12px;padding:28px 32px;font-family:${FONT};">
      ${paragraphs(bodyText)}
      ${button}
      ${signature(senderName)}
    </td></tr>`);
}
