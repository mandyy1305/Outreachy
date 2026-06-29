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
};
