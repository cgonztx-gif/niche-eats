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
  const tones = {
    info: 'border-slate-800 bg-slate-900 text-slate-300',
    warn: 'border-amber-900/60 bg-amber-950/40 text-amber-200',
    error: 'border-red-900/60 bg-red-950/40 text-red-200',
  };
  el.notice.className = `mb-4 rounded-lg border p-3 text-sm ${tones[tone]}`;
  el.notice.innerHTML = html;
}

const hideNotice = () => el.notice.classList.add('hidden');

function card(spot) {
  const distance =
    spot.distance === null
      ? ''
      : `<span class="text-slate-400">${escapeHtml(formatDistance(spot.distance))}</span>`;
  const category = spot.category
    ? `<span class="text-slate-500">${escapeHtml(spot.category)}</span>`
    : '';
  const separator = category && distance ? '<span class="text-slate-700">·</span>' : '';

  return `
    <a href="${mapsUrl(spot, USE_APPLE_MAPS)}" target="_blank" rel="noopener"
       class="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60
              p-4 active:scale-[0.99] transition">
      <span class="min-w-0">
        <span class="block truncate font-medium">${escapeHtml(spot.name)}</span>
        <span class="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm">${category}${separator}${distance}</span>
      </span>
      <span aria-hidden="true" class="shrink-0 text-slate-600">→</span>
    </a>`;
}

function section(title, items, { muted = false } = {}) {
  if (items.length === 0) return '';
  return `
    <section>
      <h2 class="mb-3 text-xs font-semibold uppercase tracking-widest ${muted ? 'text-slate-600' : 'text-emerald-400'}">
        ${escapeHtml(title)} <span class="text-slate-600">(${items.length})</span>
      </h2>
      <div class="space-y-2 ${muted ? 'opacity-60' : ''}">${items.map(card).join('')}</div>
    </section>`;
}

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
    section('Open now', open) + section('Closed', closed, { muted: true });

  if (open.length === 0) {
    el.content.insertAdjacentHTML(
      'afterbegin',
      `<p class="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
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
         <span class="text-amber-200/70">iPhone: Settings → Apps → Safari → Location → Ask.
         Desktop Chrome: the icon at the left of the address bar → Location → Allow.
         Then reload.</span>`
      : `Spots are listed alphabetically.
         <button id="locate" class="ml-1 font-medium underline underline-offset-2">Use my location</button>`,
    'warn',
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

  await applyLocation(await locating);
  el.refresh.disabled = false;
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
