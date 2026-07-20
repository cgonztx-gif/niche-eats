/**
 * Manage view: paste names to seed the shared list, fix the ones that miss.
 *
 * Every line gets its own result row. Misses stay on screen with an editable
 * input so nothing is silently dropped — the whole point of the per-query
 * status the function returns.
 */
import { resolveAndAdd, BATCH_SIZE } from './api.js';
import { registerServiceWorker } from './pwa.js';

const el = {
  queries: document.getElementById('queries'),
  submit: document.getElementById('submit'),
  progress: document.getElementById('progress'),
  error: document.getElementById('error'),
  results: document.getElementById('results'),
};

/** Result rows, newest batch last. Each row owns one original query. */
let rows = [];

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

const render = () => {
  el.results.innerHTML = rows.map(rowHtml).join('');
};

/** Send queries and write each result back into `rows` at its own index. */
async function send(items) {
  const indexes = items.map((item) => item.index);
  const payload = items.map((item) => item.payload);

  for (const i of indexes) rows[i].status = 'pending';
  render();

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
      });
      done += batch.length;
      render();
    }
    el.progress.textContent = '';
  } catch (error) {
    // The request itself failed, so no row has a real verdict — say so per row
    // rather than leaving them stuck on "Adding…".
    for (const i of indexes) rows[i] = { ...rows[i], status: 'error', message: error.message };
    el.progress.textContent = '';
    showError(error.message);
    render();
  }
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
