import { t } from '../i18n.js';
import { getLogs, LOG1_PATH, LOG_PATH } from '../susfs-data.js';

// The two logs every boot rewrites, one tab each: what NyxSUSFS did, and
// SuSFS's own lines from the kernel log. Both come from the same read, so
// switching between them costs nothing. Read on the first visit to the
// page rather than at startup - they can run to hundreds of lines and
// opening the WebUI doesn't need them.

const LOGS = [
	{
		key: 'activity', path: LOG1_PATH,
		i18nTab: 'logs_tab_activity', tab: 'Activity',
		i18nDesc: 'logs_activity_desc', desc: 'What NyxSUSFS did at each boot stage.',
		i18nEmpty: 'logs_empty', empty: 'Nothing logged this boot yet.',
	},
	{
		key: 'kernel', path: LOG_PATH,
		i18nTab: 'logs_tab_kernel', tab: 'Kernel',
		i18nDesc: 'logs_kernel_desc', desc: 'The lines SuSFS itself wrote to the kernel log.',
		i18nEmpty: 'logs_kernel_empty', empty: 'No SuSFS kernel messages captured this boot.',
	},
];

// The log you're looking at survives a refresh and leaving the page.
let current = 'activity';
// A view filled while its tab is hidden can't be scrolled yet, so it's
// taken to the newest line the first time it's shown instead.
const pendingScroll = new Set();

export function renderLogsShell(root) {
	root.innerHTML = `
		<div class="seg" role="tablist" aria-label="${t('nav_logs', 'Logs')}">
			${LOGS.map((l) => `<button class="seg__btn" role="tab" id="logs-tab-${l.key}" data-log="${l.key}" aria-controls="logs-panel-${l.key}">${t(l.i18nTab, l.tab)}</button>`).join('')}
		</div>
		${LOGS.map((l) => `
			<div class="logs-panel" role="tabpanel" id="logs-panel-${l.key}" aria-labelledby="logs-tab-${l.key}" data-panel="${l.key}">
				<div class="card">
					<p class="log-note" data-role="note-${l.key}" hidden></p>
					<div class="log-view is-empty" data-role="log-${l.key}">${t('logs_loading', 'Loading…')}</div>
				</div>
				<p class="setting-row__desc page-footnote">${t(l.i18nDesc, l.desc)} ${t('logs_hint', 'Both logs are rewritten at every boot. Newest at the bottom. Tap refresh in the top bar to reload.')}<br><code>${l.path}</code></p>
			</div>
		`).join('')}
	`;
	root.querySelector('.seg').addEventListener('click', (e) => {
		const btn = e.target.closest('[data-log]');
		if (btn) showLog(root, btn.dataset.log);
	});
	showLog(root, current);
}

function showLog(root, key) {
	current = key;
	root.querySelectorAll('[data-log]').forEach((btn) => {
		btn.setAttribute('aria-selected', String(btn.dataset.log === key));
	});
	root.querySelectorAll('[data-panel]').forEach((panel) => {
		panel.hidden = panel.dataset.panel !== key;
	});
	if (pendingScroll.delete(key)) scrollToNewest(root, key);
}

// Newest lines are what you came for.
function scrollToNewest(root, key) {
	const el = root.querySelector(`[data-role="log-${key}"]`);
	requestAnimationFrame(() => {
		el.scrollTop = el.scrollHeight;
	});
}

export async function refreshLogs(root) {
	renderLogs(root, await getLogs());
}

/** Fill both log views from a getLogs() result. */
export function renderLogs(root, logs) {
	for (const l of LOGS) {
		const { text, total } = logs[l.key];
		const el = root.querySelector(`[data-role="log-${l.key}"]`);
		const note = root.querySelector(`[data-role="note-${l.key}"]`);
		const body = text.trim();
		el.classList.toggle('is-empty', !body);
		if (body) {
			// One row per line, so a long path that wraps is indented under
			// its own entry instead of reading like the start of the next.
			const rows = document.createDocumentFragment();
			for (const line of body.split('\n')) {
				const row = document.createElement('div');
				row.className = 'log-line';
				row.textContent = line || ' ';
				rows.append(row);
			}
			el.replaceChildren(rows);
		} else {
			el.textContent = t(l.i18nEmpty, l.empty);
		}
		// Only the end of a long log is shown; say so.
		const shown = body ? body.split('\n').length : 0;
		note.hidden = total <= shown;
		note.textContent = total > shown
			? t('logs_truncated', 'Showing the last {shown} of {total} lines.').replace('{shown}', shown).replace('{total}', total)
			: '';
		if (l.key === current) scrollToNewest(root, l.key);
		else pendingScroll.add(l.key);
	}
}
