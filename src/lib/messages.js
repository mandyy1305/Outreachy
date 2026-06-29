// Shared message-type constants used across the service worker, content scripts,
// and the side panel / options UI. Keep all cross-context message names here.

export const MSG = {
  // Side panel -> service worker: inject the scraper into the given tab and return data.
  SCRAPE_PROFILE: 'SCRAPE_PROFILE',
  // Side panel -> service worker: build the prompt and call the LLM, return variants.
  GENERATE: 'GENERATE',
  // Side panel -> service worker: open the activity page in a background tab,
  // scrape the full recent posts, return them. (Phase 2, opt-in.)
  FETCH_ACTIVITY: 'FETCH_ACTIVITY',
  // Side panel -> service worker: look up email/phone via SignalHire.
  FIND_CONTACT: 'FIND_CONTACT',
  // Side panel -> service worker: send an email via the Gmail API.
  SEND_EMAIL: 'SEND_EMAIL',
};

// Outreach channels.
export const CHANNELS = ['linkedin', 'whatsapp', 'email'];
