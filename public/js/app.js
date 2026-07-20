/**
 * Dashboard: read the shared list, locate the user, render open/closed buckets.
 * All decision logic lives in spots.js — this file only fetches and paints.
 */
import { fetchSpots, getLocation } from './api.js';
import { partitionSpots, formatDistance, mapsUrl } from './spots.js';
import { registerServiceWorker } from './pwa.js';

const RERENDER_MS = 60_000;

const el = {
  subtitle: document.getElementById('subtitle'),
  notice: document.getElementById('notice'),
  content: document.getElementById('content'),
  refresh: document.getElementById('refresh'),
};

/** Apple Maps on Apple hardware, Google Maps everywhere else. */
const USE_APPLE_MAPS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let spots = [];
let origin = null;

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));

function showNotice(html, tone = 'info') {
  // Missing location is a normal state, not a warning — so it reads neutral.
  // Only an actual failure earns colour.
  const tones = {
    info: 'border-line bg-raised text-ink-soft',
    error: 'border-closed/50 bg-closed-dim text-red-200',
  };
  el.notice.className = `mb-5 rounded-xl border p-3 text-sm ${tones[tone]}`;
  el.notice.innerHTML = html;
}

const hideNotice = () => el.notice.classList.add('hidden');

function card(spot, dimmed = false) {
  // tabular-nums keeps "0.4 mi" and "11.2 mi" aligned down the column.
  const distance =
    spot.distance === null
      ? ''
      : `<span class="tabular-nums">${escapeHtml(formatDistance(spot.distance))}</span>`;
  const category = spot.category ? `<span>${escapeHtml(spot.category)}</span>` : '';
  const separator = category && distance ? '<span class="text-ink-mute">·</span>' : '';

  return `
    <a href="${mapsUrl(spot, USE_APPLE_MAPS)}" target="_blank" rel="noopener"
       class="flex min-h-[64px] items-center justify-between gap-3 rounded-xl border border-line bg-raised
              p-[14px] transition active:scale-[0.99] active:bg-pressed
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-strong">
      <span class="min-w-0">
        <span class="block truncate text-[16px] font-medium ${dimmed ? 'text-ink-soft' : 'text-ink'}">
          ${escapeHtml(spot.name)}
        </span>
        <span class="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-soft">
          ${category}${separator}${distance}
        </span>
      </span>
      <span aria-hidden="true" class="shrink-0 text-ink-mute">→</span>
    </a>`;
}

/**
 * @param tone 'open' | 'closed'
 *
 * Colour never carries the status alone: the header is worded, and closed
 * cards are additionally dimmed. Green/red is the most common colour-blind
 * confusion pair, and open-vs-closed is the whole point of the screen.
 */
function section(title, items, tone) {
  if (items.length === 0) return '';
  const isOpen = tone === 'open';

  return `
    <section>
      <div class="mb-3 flex items-center gap-2 border-b pb-2 ${isOpen ? 'border-open-dim' : 'border-closed-dim'}">
        <span aria-hidden="true" class="h-1.5 w-1.5 shrink-0 rounded-full ${isOpen ? 'bg-open' : 'bg-closed'}"></span>
        <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] ${isOpen ? 'text-open' : 'text-closed'}">
          ${escapeHtml(title)}
        </h2>
        <span class="text-[11px] tabular-nums text-ink-mute">(${items.length})</span>
      </div>
      <div class="space-y-2 ${isOpen ? '' : 'opacity-70'}">
        ${items.map((spot) => card(spot, !isOpen)).join('')}
      </div>
    </section>`;
}

/** Shape-of-the-content placeholder, so the first paint isn't a bare word. */
const skeleton = () => `
  <div class="space-y-2" aria-hidden="true">
    ${Array.from({ length: 3 }, () =>
      `<div class="h-[64px] animate-pulse rounded-xl border border-line bg-raised"></div>`).join('')}
  </div>`;

function render() {
  const { open, closed } = partitionSpots(spots, origin, new Date());

  if (spots.length === 0) {
    el.content.innerHTML = '';
    el.subtitle.textContent = 'No spots yet';
    showNotice('The list is empty. Add your first spot from <a class="underline" href="./manage.html">Manage spots</a>.');
    el.notice.classList.remove('hidden');
    return;
  }

  el.subtitle.textContent = origin
    ? `${open.length} open now · nearest first`
    : `${open.length} open now`;

  el.content.innerHTML =
    section('Open now', open, 'open') + section('Closed', closed, 'closed');

  if (open.length === 0) {
    el.content.insertAdjacentHTML(
      'afterbegin',
      `<p class="rounded-xl border border-line bg-raised p-4 text-sm text-ink-soft">
         Nothing is open right now.
       </p>`,
    );
  }
}

/**
 * Guidance for when we have no location.
 *
 * Both Chrome and Safari remember a denial permanently, so a retry button is
 * useless once blocked — the browser will never prompt again from script. In
 * that state the only honest thing to show is where the setting lives.
 */
async function locationNotice() {
  let denied = false;
  try {
    denied = (await navigator.permissions.query({ name: 'geolocation' })).state === 'denied';
  } catch {
    // Permissions API absent, or geolocation not queryable (older Safari).
    // Fall through and offer the button; the worst case is a no-op tap.
  }

  showNotice(
    denied
      ? `Location is blocked for this site, so spots are listed alphabetically.<br>
         <span class="text-ink-mute">iPhone: Settings → Apps → Safari → Location → Ask.
         Desktop Chrome: the icon at the left of the address bar → Location → Allow.
         Then reload.</span>`
      : `Spots are listed alphabetically.
         <button id="locate" class="ml-1 font-medium text-ink underline underline-offset-2">Use my location</button>`,
    'info',
  );
  el.notice.classList.remove('hidden');
}

/** Apply a location result and repaint. */
async function applyLocation(location) {
  origin = location;
  if (origin) hideNotice();
  else await locationNotice();
  render();
}

async function load() {
  el.refresh.disabled = true;
  if (spots.length === 0) el.content.innerHTML = skeleton();

  // Start geolocation BEFORE awaiting anything. iOS Safari only shows the
  // permission prompt while the user-gesture context is alive, and awaiting
  // the spot fetch first discards it — which is why tapping Refresh never
  // produced a prompt on iPhone.
  const locating = getLocation();

  try {
    spots = await fetchSpots();
    hideNotice();
    render();
  } catch (error) {
    el.subtitle.textContent = 'Could not load';
    showNotice(`Couldn't load the list. ${escapeHtml(error.message)}`, 'error');
    el.notice.classList.remove('hidden');
    el.refresh.disabled = false;
    return;
  }

  // Re-enable before waiting on location. The list is already on screen, and
  // geolocation can sit pending for the full timeout while the user decides —
  // holding Refresh disabled that long makes the app feel stuck.
  el.refresh.disabled = false;
  await applyLocation(await locating);
}

el.refresh.addEventListener('click', load);

el.notice.addEventListener('click', (event) => {
  if (event.target.id !== 'locate') return;
  // Called synchronously inside the click handler — no await may precede this,
  // or iOS Safari drops the prompt.
  getLocation().then(applyLocation);
});

// Open/closed flips with the clock without a reload.
setInterval(() => { if (spots.length) render(); }, RERENDER_MS);

// A PWA resumed from the background can be hours stale.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && spots.length) render();
});

registerServiceWorker();
load();
