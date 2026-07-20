/**
 * Manage view: paste names to seed the shared list, fix the ones that miss.
 *
 * Every line gets its own result row. Misses stay on screen with an editable
 * input so nothing is silently dropped — the whole point of the per-query
 * status the function returns.
 */
import { resolveAndAdd, removeSpot, fetchSpots, BATCH_SIZE } from './api.js';
import { registerServiceWorker } from './pwa.js';

const el = {
  queries: document.getElementById('queries'),
  submit: document.getElementById('submit'),
  progress: document.getElementById('progress'),
  error: document.getElementById('error'),
  results: document.getElementById('results'),
  spotList: document.getElementById('spot-list'),
  spotCount: document.getElementById('spot-count'),
};

/** Result rows, newest batch last. Each row owns one original query. */
let rows = [];

// The spot list is a *separate* concern from the paste results above: keyed by
// place_id, not by array index, and rendered into its own container. Keeping
// the two states and their data-attributes disjoint is what stops the two
// delegated click listeners from ever cross-firing.
let spots = [];
let loadingSpots = false;
let armedId = null;   // place_id of the spot whose Remove button is armed
let armTimer = null;  // auto-disarm timeout

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));

const chunk = (items, size) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size));

function showError(message) {
  el.error.textContent = message;
  el.error.classList.remove('hidden');
}

const clearError = () => el.error.classList.add('hidden');

function rowHtml(row, index) {
  const shell = (border, body) =>
    `<div class="rounded-xl border ${border} p-3 text-sm" data-row="${index}">${body}</div>`;

  if (row.status === 'resolved') {
    return shell(
      'border-open-dim bg-raised',
      `<div class="flex items-start gap-2.5">
         <span class="text-open" aria-hidden="true">✓</span>
         <div class="min-w-0">
           <div class="font-medium text-ink">${escapeHtml(row.name)}</div>
           <div class="truncate text-ink-soft">${escapeHtml(row.address ?? '')}</div>
         </div>
       </div>`,
    );
  }

  if (row.status === 'ambiguous') {
    // Tapping a candidate confirms it by place_id, which is the only way past
    // branches that share a name and have no distinguishing address token.
    const options = (row.candidates ?? [])
      .map(
        (candidate, ci) => `
        <button data-confirm="${index}" data-candidate="${ci}"
          class="block w-full rounded-lg border border-line bg-base p-2.5 text-left transition
                 hover:border-line-strong active:scale-[0.99] active:bg-pressed
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-strong">
          <span class="block font-medium text-ink">${escapeHtml(candidate.name)}</span>
          <span class="block truncate text-ink-soft">${escapeHtml(candidate.address ?? '')}</span>
        </button>`,
      )
      .join('');

    return shell(
      'border-line bg-raised',
      `<div class="mb-2.5 text-ink-soft">
         Several matches for <span class="font-medium text-ink">${escapeHtml(row.query)}</span> — pick one:
       </div>
       <div class="space-y-1.5">${options}</div>`,
    );
  }

  if (row.status === 'pending') {
    return shell(
      'border-line bg-raised',
      `<span class="animate-pulse text-ink-soft">Adding ${escapeHtml(row.query)}…</span>`,
    );
  }

  // not_found or error — keep the text editable so it can be corrected in place.
  const message =
    row.status === 'error'
      ? escapeHtml(row.message ?? 'Something went wrong')
      : 'No match. Add a city or street and try again.';

  return shell(
    row.status === 'error' ? 'border-closed/50 bg-closed-dim' : 'border-line bg-raised',
    `<div class="mb-2.5 ${row.status === 'error' ? 'text-red-200' : 'text-ink-soft'}">${message}</div>
     <div class="flex gap-2">
       <input data-edit="${index}" value="${escapeHtml(row.query)}" spellcheck="false"
         class="min-w-0 flex-1 rounded-lg border border-line bg-base px-2.5 py-1.5 text-ink
                focus:border-line-strong focus:outline-none">
       <button data-retry="${index}"
         class="shrink-0 rounded-lg border border-line-strong px-3 py-1.5 text-ink-soft transition
                active:scale-95 active:text-ink
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-strong">Retry</button>
     </div>`,
  );
}

const renderResults = () => {
  el.results.innerHTML = rows.map(rowHtml).join('');
};

/** Send queries and write each result back into `rows` at its own index. */
async function send(items) {
  const indexes = items.map((item) => item.index);
  const payload = items.map((item) => item.payload);

  for (const i of indexes) rows[i].status = 'pending';
  renderResults();

  let anyResolved = false;
  try {
    const batches = chunk(payload, BATCH_SIZE);
    let done = 0;
    for (const [batchIndex, batch] of batches.entries()) {
      if (batches.length > 1) {
        el.progress.textContent = `Batch ${batchIndex + 1} of ${batches.length}…`;
      }
      const results = await resolveAndAdd(batch);
      results.forEach((result, i) => {
        const target = indexes[done + i];
        rows[target] = { ...result, query: rows[target].query };
        if (result.status === 'resolved') anyResolved = true;
      });
      done += batch.length;
      renderResults();
    }
    el.progress.textContent = '';
  } catch (error) {
    // The request itself failed, so no row has a real verdict — say so per row
    // rather than leaving them stuck on "Adding…".
    for (const i of indexes) rows[i] = { ...rows[i], status: 'error', message: error.message };
    el.progress.textContent = '';
    showError(error.message);
    renderResults();
  }

  // Anything that resolved changed the shared list, so re-sync the view below.
  // One hook here covers submit, retry, and confirm-candidate alike.
  if (anyResolved) loadSpotList();
}

async function submit() {
  clearError();
  const lines = el.queries.value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return showError('Add at least one name.');

  const start = rows.length;
  rows.push(...lines.map((query) => ({ query, status: 'pending' })));

  el.submit.disabled = true;
  el.queries.value = '';
  await send(lines.map((query, i) => ({ index: start + i, payload: query })));
  el.submit.disabled = false;
}

el.submit.addEventListener('click', submit);

// Ctrl/Cmd+Enter submits from the textarea.
el.queries.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit();
});

registerServiceWorker();

el.results.addEventListener('click', async (event) => {
  const retry = event.target.closest('[data-retry]');
  if (retry) {
    const index = Number(retry.dataset.retry);
    const input = el.results.querySelector(`[data-edit="${index}"]`);
    const query = input.value.trim();
    if (!query) return;
    rows[index].query = query;
    return send([{ index, payload: query }]);
  }

  const confirm = event.target.closest('[data-confirm]');
  if (confirm) {
    const index = Number(confirm.dataset.confirm);
    const candidate = rows[index].candidates[Number(confirm.dataset.candidate)];
    return send([{ index, payload: { query: rows[index].query, placeId: candidate.place_id } }]);
  }
});

// --- Spot list with per-row remove -----------------------------------------

function spotRowHtml(spot) {
  const address = spot.formatted_address
    ? `<div class="truncate text-ink-soft">${escapeHtml(spot.formatted_address)}</div>`
    : '';
  return `
    <div class="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised p-3 text-sm">
      <div class="min-w-0">
        <div class="truncate font-medium text-ink">${escapeHtml(spot.name)}</div>
        ${address}
      </div>
      <button data-remove="${escapeHtml(spot.place_id)}"
        class="shrink-0 rounded-lg border border-line-strong px-3 py-1.5 text-ink-soft transition
               active:scale-95 active:text-ink
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-strong">Remove</button>
    </div>`;
}

function renderSpotList() {
  // A full innerHTML replace clears any armed button, so reset the arm state
  // rather than leaving armedId pointing at a button that no longer exists.
  disarm();
  el.spotCount.textContent = spots.length ? String(spots.length) : '';

  if (spots.length === 0) {
    el.spotList.innerHTML =
      '<p class="text-ink-soft">Nothing in the list yet. Add a spot above.</p>';
    return;
  }
  const ordered = [...spots].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  el.spotList.innerHTML = ordered.map(spotRowHtml).join('');
}

function spotListSkeleton() {
  el.spotList.innerHTML = Array.from(
    { length: 3 },
    () => '<div class="h-[58px] animate-pulse rounded-xl border border-line bg-raised"></div>',
  ).join('');
}

async function loadSpotList() {
  if (loadingSpots) return;
  loadingSpots = true;
  if (spots.length === 0) spotListSkeleton();
  try {
    spots = await fetchSpots();
    renderSpotList();
  } catch (error) {
    el.spotList.innerHTML = `
      <div class="rounded-xl border border-closed/50 bg-closed-dim p-3 text-sm text-red-200">
        Couldn't load the list. ${escapeHtml(error.message)}
        <button data-reload-spots class="ml-1 font-medium text-ink underline underline-offset-2">Retry</button>
      </div>`;
  } finally {
    loadingSpots = false;
  }
}

/** Reset any armed Remove button back to its resting state. */
function disarm() {
  if (armTimer) { clearTimeout(armTimer); armTimer = null; }
  if (armedId === null) return;
  const button = el.spotList.querySelector(`[data-remove="${CSS.escape(armedId)}"]`);
  if (button) {
    button.textContent = 'Remove';
    button.className = button.className.replace(' border-closed text-closed', '');
    button.removeAttribute('aria-label');
  }
  armedId = null;
}

el.spotList.addEventListener('click', async (event) => {
  const reload = event.target.closest('[data-reload-spots]');
  if (reload) return loadSpotList();

  const button = event.target.closest('[data-remove]');
  if (!button) return;
  const placeId = button.dataset.remove;
  const spot = spots.find((s) => s.place_id === placeId);
  if (!spot) return;

  // First tap on a fresh button arms it; a full re-render is deliberately
  // avoided so focus survives and the interaction stays cheap.
  if (armedId !== placeId) {
    disarm();
    armedId = placeId;
    button.textContent = 'Remove?';
    button.className += ' border-closed text-closed';
    button.setAttribute('aria-label', `Confirm removing ${spot.name}`);
    armTimer = setTimeout(disarm, 4000);
    return;
  }

  // Second tap on the same button confirms the delete.
  if (armTimer) { clearTimeout(armTimer); armTimer = null; }
  button.textContent = 'Removing…';
  button.disabled = true;
  clearError();
  try {
    await removeSpot(placeId);
    // Local array is authoritative for a delete — splice and repaint, no refetch.
    spots = spots.filter((s) => s.place_id !== placeId);
    armedId = null;
    renderSpotList();
  } catch (error) {
    button.disabled = false;
    disarm(); // resets label/classes on this same button
    showError(`Couldn't remove ${spot.name}. ${error.message}`);
  }
});

loadSpotList();
