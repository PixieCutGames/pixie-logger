// Log data is untrusted: it only ever reaches the page through textContent.

const DEFAULT_LIMIT = '100';
const EMPTY = '—';
const COLUMN_COUNT = 6;
const SIGN_IN_MESSAGE =
	'Your Cloudflare Access sign-in has expired or is missing. Reload the page to sign in again.';
const LEVEL_CLASSES = new Map([
	['debug', 'lvl-debug'],
	['info', 'lvl-info'],
	['warn', 'lvl-warn'],
	['error', 'lvl-error'],
	['fatal', 'lvl-fatal'],
]);

const form = document.getElementById('filters');
const appSelect = document.getElementById('f-app');
const eventInput = document.getElementById('f-event');
const sessionInput = document.getElementById('f-session');
const fromInput = document.getElementById('f-from');
const toInput = document.getElementById('f-to');
const limitSelect = document.getElementById('f-limit');
const resetButton = document.getElementById('f-reset');
const searchButton = form.querySelector('button[type="submit"]');
const statusLine = document.getElementById('status');
const tbody = document.querySelector('#results tbody');
const loadMoreButton = document.getElementById('load-more');
const levelBoxes = [...form.querySelectorAll('input[name="level"]')];

let latestRequest = 0;
let activeParams = new URLSearchParams();
let nextCursor = null;
let shown = 0;
let appsError = null;

// ---- Small helpers ----

function el(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function setStatus(text) {
	statusLine.textContent =
		appsError && appsError !== text ? `${text} · App list unavailable: ${appsError}` : text;
}

function setBusy(busy) {
	searchButton.disabled = busy;
	loadMoreButton.disabled = busy;
}

function pad(value) {
	return String(value).padStart(2, '0');
}

function isoToLocalInput(iso) {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '';
	const day = `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	return `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatLocal(iso) {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return String(iso);
	return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

function orEmpty(value) {
	return value === null || value === undefined || value === '' ? EMPTY : String(value);
}

function formatJson(value) {
	return value === null || value === undefined ? EMPTY : JSON.stringify(value, null, 2);
}

// ---- Filters and URL ----

function ensureAppOption(id) {
	if (!id || [...appSelect.options].some((option) => option.value === id)) return;
	const option = el('option', '', id);
	option.value = id;
	appSelect.append(option);
}

function readFiltersFromUrl() {
	const query = new URLSearchParams(location.search);
	const app = query.get('app') ?? '';
	ensureAppOption(app);
	appSelect.value = app;

	const levels = new Set(query.getAll('level'));
	for (const box of levelBoxes) box.checked = levels.has(box.value);

	eventInput.value = query.get('event') ?? '';
	sessionInput.value = query.get('session') ?? '';
	fromInput.value = query.has('from') ? isoToLocalInput(query.get('from')) : '';
	toInput.value = query.has('to') ? isoToLocalInput(query.get('to')) : '';

	const limit = query.get('limit');
	const known = [...limitSelect.options].some((option) => option.value === limit);
	limitSelect.value = known ? limit : DEFAULT_LIMIT;
}

function dateToIso(input, label) {
	if (input.validity.badInput) throw new Error(`${label} date is invalid.`);
	if (!input.value) return null;
	const date = new Date(input.value);
	if (Number.isNaN(date.getTime())) throw new Error(`${label} date is invalid.`);
	return date.toISOString();
}

// The default limit is left out so a default search keeps a clean URL; the API also defaults to 100.
function filtersFromForm() {
	const params = new URLSearchParams();
	if (appSelect.value) params.set('app', appSelect.value);
	for (const box of levelBoxes) {
		if (box.checked) params.append('level', box.value);
	}
	const event = eventInput.value.trim();
	const session = sessionInput.value.trim();
	if (event) params.set('event', event);
	if (session) params.set('session', session);
	const from = dateToIso(fromInput, 'From');
	const to = dateToIso(toInput, 'To');
	if (from) params.set('from', from);
	if (to) params.set('to', to);
	if (limitSelect.value !== DEFAULT_LIMIT) params.set('limit', limitSelect.value);
	return params;
}

function clearFilters() {
	appSelect.value = '';
	for (const box of levelBoxes) box.checked = false;
	eventInput.value = '';
	sessionInput.value = '';
	fromInput.value = '';
	toInput.value = '';
	limitSelect.value = DEFAULT_LIMIT;
}

// ---- Requests ----

async function apiGet(pathAndQuery) {
	let response;
	try {
		response = await fetch(pathAndQuery, {
			credentials: 'same-origin',
			redirect: 'manual',
			headers: { Accept: 'application/json' },
		});
	} catch {
		throw new Error('Network error. Check your connection and try again.');
	}

	if (response.type === 'opaqueredirect' || response.status === 401 || response.status === 403) {
		throw new Error(SIGN_IN_MESSAGE);
	}

	let body;
	try {
		body = await response.json();
	} catch {
		throw new Error(`Request failed (HTTP ${response.status})`);
	}

	if (!response.ok) {
		const code = body?.error?.code;
		const message = body?.error?.message;
		if (typeof code === 'string' && typeof message === 'string') {
			throw new Error(`${code}: ${message}`);
		}
		throw new Error(`Request failed (HTTP ${response.status})`);
	}
	return body;
}

async function loadApps() {
	try {
		const { items } = await apiGet('/v1/admin/apps');
		const selected = appSelect.value;
		appSelect.replaceChildren(appSelect.options[0]);
		for (const app of items) {
			const suffix = app.disabled ? ' (disabled)' : '';
			const option = el('option', '', `${app.displayName} (${app.id})${suffix}`);
			option.value = app.id;
			appSelect.append(option);
		}
		ensureAppOption(selected);
		appSelect.value = selected;
	} catch (error) {
		appsError = error.message;
		setStatus(error.message);
	}
}

// ---- Rendering ----

function addDetail(list, term, value) {
	list.append(el('dt', '', term), el('dd', '', orEmpty(value)));
}

function timeWithIso(iso) {
	return `${formatLocal(iso)} (${iso})`;
}

function buildDetailsRow(log) {
	const row = el('tr', 'details-row');
	const cell = el('td', 'details');
	cell.colSpan = COLUMN_COUNT;

	const list = el('dl');
	addDetail(list, 'Message', log.message);
	addDetail(list, 'Route', log.route);
	addDetail(list, 'Event', log.event);
	addDetail(list, 'Level', log.level);
	addDetail(list, 'App', log.app);
	addDetail(list, 'App version', log.appVersion);
	addDetail(list, 'Platform', log.platform);
	addDetail(list, 'Session id', log.sessionId);
	addDetail(list, 'Client time', timeWithIso(log.clientTs));
	addDetail(list, 'Received', timeWithIso(log.receivedAt));
	addDetail(list, 'Log id', log.id);

	const sessionButton = el('button', '', 'Show this session');
	sessionButton.type = 'button';
	sessionButton.addEventListener('click', () => {
		clearFilters();
		sessionInput.value = log.sessionId;
		runSearch();
	});

	cell.append(
		list,
		el('h2', '', 'Params'),
		el('pre', '', formatJson(log.params)),
		el('h2', '', 'Context'),
		el('pre', '', formatJson(log.context)),
		sessionButton,
	);
	row.append(cell);
	return row;
}

function buildLogRow(log, index) {
	const row = el('tr', index % 2 === 1 ? 'log-row alt' : 'log-row');
	row.tabIndex = 0;
	row.setAttribute('aria-expanded', 'false');

	const levelCell = el('td');
	const levelClass = LEVEL_CLASSES.get(log.level);
	levelCell.append(
		el('span', levelClass ? `lvl ${levelClass}` : 'lvl', String(log.level).toUpperCase()),
	);

	row.append(
		el('td', '', formatLocal(log.receivedAt)),
		el('td', '', log.app),
		levelCell,
		el('td', '', log.event),
		el('td', 'message', log.message || EMPTY),
		el('td', '', log.platform),
	);

	let detailsRow = null;
	const toggle = () => {
		if (detailsRow) {
			detailsRow.remove();
			detailsRow = null;
			row.setAttribute('aria-expanded', 'false');
		} else {
			detailsRow = buildDetailsRow(log);
			row.after(detailsRow);
			row.setAttribute('aria-expanded', 'true');
		}
	};
	row.addEventListener('click', toggle);
	row.addEventListener('keydown', (event) => {
		if (event.target === row && (event.key === 'Enter' || event.key === ' ')) {
			event.preventDefault();
			toggle();
		}
	});
	return row;
}

function renderPage(page) {
	const rows = page.items.map((log, offset) => buildLogRow(log, shown + offset));
	tbody.append(...rows);
	shown += page.items.length;
	nextCursor = page.nextCursor;
	loadMoreButton.hidden = nextCursor === null;

	if (shown === 0) {
		setStatus('No logs match these filters');
	} else {
		setStatus(`${shown} logs${nextCursor !== null ? ' — more available' : ''}`);
	}
}

// ---- Search and paging ----

async function fetchPage(params) {
	const request = ++latestRequest;
	setBusy(true);
	try {
		const query = params.toString();
		const page = await apiGet(query ? `/v1/admin/logs?${query}` : '/v1/admin/logs');
		if (request === latestRequest) renderPage(page);
	} catch (error) {
		if (request === latestRequest) setStatus(error.message);
	} finally {
		if (request === latestRequest) setBusy(false);
	}
}

function runSearch() {
	let params;
	try {
		params = filtersFromForm();
	} catch (error) {
		setStatus(error.message);
		return;
	}

	const query = params.toString();
	history.replaceState(null, '', query ? `?${query}` : location.pathname);

	activeParams = params;
	nextCursor = null;
	shown = 0;
	tbody.replaceChildren();
	loadMoreButton.hidden = true;
	setStatus('Loading…');
	fetchPage(params);
}

function loadMore() {
	if (nextCursor === null) return;
	const params = new URLSearchParams(activeParams);
	params.set('cursor', nextCursor);
	setStatus('Loading…');
	fetchPage(params);
}

// ---- Start ----

form.addEventListener('submit', (event) => {
	event.preventDefault();
	runSearch();
});
resetButton.addEventListener('click', () => {
	clearFilters();
	runSearch();
});
loadMoreButton.addEventListener('click', loadMore);

readFiltersFromUrl();
await loadApps();
runSearch();
