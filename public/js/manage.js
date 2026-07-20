/**
 * Manage view: paste names to seed the shared list, fix the ones that miss.
 *
 * Every line gets its own result row. Misses stay on screen with an editable
 * input so nothing is silently dropped — the whole point of the per-query
 * status the function returns.
 */
import { resolveAndAdd, removeSpot, fetchSpots, geocodeReference, BATCH_SIZE } from './api.js';
import { registerServiceWorker } from './pwa.js';

const el = {
  queries: document.getElementById('queries'),
  submit: document.getElementById('submit'),
  progress: document.getElementById('progress'),
  error: document.getElementById('error'),
  results: document.getElementById('results'),
  spotList: document.getElementById('spot-list'),
  spotCount: document.getElementById('spot-count'),
  refLabel: document.getElementById('ref-label'),
  refEdit: document.getElementById('ref-edit'),
  refEditor: document.getElementById('ref-editor'),
  refInput: document.getElementById('ref-input'),
  refSet: document.getElementById('ref-set'),
};

const REF_KEY = 'niche-eats-reference';
// Anchor for the add flow: candidates sort by proximity to this and a far match
// is rejected. NOT the user's location — it's a per-device adding convenience.
const DEFAULT_REFERENCE = { lat: 30.2849, lng: -97.7341, label: 'The University of Texas at Austin' };

function getReference() {
  try {
    const saved = JSON.parse(localStorage.getItem(REF_KEY));
    if (saved && typeof saved.lat === 'number' && typeof saved.lng === 'number') return saved;
  } catch { /* fall through to default */ }
  return DEFAULT_REFERENCE;
}

function setReference(reference) {
  try { localStorage.setItem(REF_KEY, JSON.stringify(reference)); } catch { /* private mode */ }
  el.refLabel.textContent = reference.label;
}

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
    // Checkboxes, not single-tap: several branches of a chain can be added at
    // once. Candidates arrive sorted nearest-first (to the reference) and each
    // carries its distance so the closest is easy to spot.
    const options = (row.candidates ?? [])
      .map((candidate, ci) => {
        const dist = typeof candidate.distance_mi === 'number'
          ? `<span class="shrink-0 tabular-nums text-ink-mute">${candidate.distance_mi} mi</span>` : '';
        return `
        <label class="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-base p-2.5 transition
                      hover:border-line-strong">
          <input type="checkbox" data-cand="${ci}" class="mt-0.5 h-4 w-4 shrink-0 accent-open">
          <span class="min-w-0 flex-1">
            <span class="flex items-baseline justify-between gap-2">
              <span class="truncate font-medium text-ink">${escapeHtml(candidate.name)}</span>${dist}
            </span>
            <span class="block truncate text-ink-soft">${escapeHtml(candidate.address ?? '')}</span>
          </span>
        </label>`;
      })
      .join('');

    return shell(
      'border-line bg-raised',
      `<div class="mb-2.5 text-ink-soft">
         Several matches for <span class="font-medium text-ink">${escapeHtml(row.query)}</span> — select any to add:
       </div>
       <div class="space-y-1.5">${options}</div>
       <button data-add-selected="${index}"
         class="mt-2.5 rounded-lg bg-open px-3 py-1.5 text-sm font-medium text-base transition
                active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-strong">
         Add selected</button>`,
    );
  }

  if (row.status === 'note') {
    return shell('border-line bg-raised', `<span class="text-ink-soft">${escapeHtml(row.message)}</span>`);
  }

  if (row.status === 'too_far') {
    const dist = typeof row.distance_mi === 'number' ? `${row.distance_mi} mi` : 'far';
    return shell(
      'border-closed/50 bg-closed-dim',
      `<div class="mb-2.5 text-red-200">
         Nearest match${row.name ? ` (<span class="font-medium">${escapeHtml(row.name)}</span>)` : ''}
         is ${dist} from your reference — check the name, or change the reference above.
       </div>
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
      const results = await resolveAndAdd(batch, getReference());
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

  const addSelected = event.target.closest('[data-add-selected]');
  if (addSelected) {
    const index = Number(addSelected.dataset.addSelected);
    const container = el.results.querySelector(`[data-row="${index}"]`);
    const checked = [...container.querySelectorAll('[data-cand]:checked')]
      .map((box) => rows[index].candidates[Number(box.dataset.cand)]);
    if (checked.length === 0) return showError('Select at least one match.');

    clearError();
    // Each selected candidate becomes its OWN new result row (keeping send()'s
    // 1:1 index mapping), and the ambiguous row collapses to a note. Routing
    // several adds back through the one ambiguous index would break that mapping.
    rows[index] = { query: rows[index].query, status: 'note', message: `Added ${checked.length} place${checked.length > 1 ? 's' : ''}` };
    const start = rows.length;
    rows.push(...checked.map((c) => ({ query: c.name, status: 'pending' })));
    renderResults();
    return send(checked.map((c, i) => ({ index: start + i, payload: { query: c.name, placeId: c.place_id } })));
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

// --- Reference point ---------------------------------------------------------

// Reflect any stored reference on load (default label is already in the HTML).
el.refLabel.textContent = getReference().label;

el.refEdit.addEventListener('click', () => {
  const opening = el.refEditor.classList.toggle('hidden') === false;
  el.refEditor.classList.toggle('flex', opening);
  if (opening) {
    el.refInput.value = '';
    el.refInput.focus();
  }
});

async function setReferenceFromInput() {
  const query = el.refInput.value.trim();
  if (!query) return;
  clearError();
  el.refSet.disabled = true;
  el.refSet.textContent = 'Setting…';
  try {
    const { lat, lng, label } = await geocodeReference(query);
    setReference({ lat, lng, label });
    el.refEditor.classList.add('hidden');
    el.refEditor.classList.remove('flex');
  } catch (error) {
    showError(`Couldn't set reference. ${error.message}`);
  } finally {
    el.refSet.disabled = false;
    el.refSet.textContent = 'Set';
  }
}

el.refSet.addEventListener('click', setReferenceFromInput);
el.refInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') setReferenceFromInput();
});

loadSpotList();
