import { $, $$, closestTarget } from '../core/dom';
import { t } from '../core/i18n';
import { getLogs, LOG1_PATH, LOG_PATH, type Logs } from '../susfs-data';

type LogKey = keyof Logs;

const LOGS: readonly {
	key: LogKey;
	path: string;
	i18nTab: string;
	tab: string;
	i18nDesc: string;
	desc: string;
	i18nEmpty: string;
	empty: string;
}[] = [
	{
		key: 'activity',
		path: LOG1_PATH,
		i18nTab: 'logs_tab_activity',
		tab: 'Activity',
		i18nDesc: 'logs_activity_desc',
		desc: 'What NyxSUSFS did at each boot stage.',
		i18nEmpty: 'logs_empty',
		empty: 'Nothing logged this boot yet.',
	},
	{
		key: 'kernel',
		path: LOG_PATH,
		i18nTab: 'logs_tab_kernel',
		tab: 'Kernel',
		i18nDesc: 'logs_kernel_desc',
		desc: 'The lines SuSFS itself wrote to the kernel log.',
		i18nEmpty: 'logs_kernel_empty',
		empty: 'No SuSFS kernel messages captured this boot.',
	},
];

let current: LogKey = 'activity';
const pendingScroll = new Set<LogKey>();

function isLogKey(value: string | undefined): value is LogKey {
	return LOGS.some((l) => l.key === value);
}

export function renderLogsShell(root: HTMLElement): void {
	root.innerHTML = `
		<div class="seg" role="tablist" aria-label="${t('nav_logs', 'Logs')}">
			${LOGS.map((l) => `<button class="seg__btn" role="tab" id="logs-tab-${l.key}" data-log="${l.key}" aria-controls="logs-panel-${l.key}">${t(l.i18nTab, l.tab)}</button>`).join('')}
		</div>
		${LOGS.map(
			(l) => `
			<div class="logs-panel" role="tabpanel" id="logs-panel-${l.key}" aria-labelledby="logs-tab-${l.key}" data-panel="${l.key}">
				<div class="card">
					<p class="log-note" data-role="note-${l.key}" hidden></p>
					<div class="log-view is-empty" data-role="log-${l.key}">${t('logs_loading', 'Loading…')}</div>
				</div>
				<p class="setting-row__desc page-footnote">${t(l.i18nDesc, l.desc)} ${t('logs_hint', 'Both logs are rewritten at every boot. Newest at the bottom. Tap refresh in the top bar to reload.')}<br><code>${l.path}</code></p>
			</div>
		`,
		).join('')}
	`;
	$(root, '.seg').addEventListener('click', (e) => {
		const key = closestTarget(e, '[data-log]')?.dataset.log;
		if (isLogKey(key)) showLog(root, key);
	});
	showLog(root, current);
}

function showLog(root: HTMLElement, key: LogKey): void {
	current = key;
	for (const btn of $$(root, '[data-log]')) {
		btn.setAttribute('aria-selected', String(btn.dataset.log === key));
	}
	for (const panel of $$(root, '[data-panel]')) {
		panel.hidden = panel.dataset.panel !== key;
	}
	if (pendingScroll.delete(key)) scrollToNewest(root, key);
}

function scrollToNewest(root: HTMLElement, key: LogKey): void {
	const el = $(root, `[data-role="log-${key}"]`);
	requestAnimationFrame(() => {
		el.scrollTop = el.scrollHeight;
	});
}

export async function refreshLogs(root: HTMLElement): Promise<void> {
	renderLogs(root, await getLogs());
}

export function renderLogs(root: HTMLElement, logs: Logs): void {
	for (const l of LOGS) {
		const { text, total } = logs[l.key];
		const el = $(root, `[data-role="log-${l.key}"]`);
		const note = $(root, `[data-role="note-${l.key}"]`);
		const body = text.trim();
		el.classList.toggle('is-empty', !body);
		if (body) {
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
		const shown = body ? body.split('\n').length : 0;
		note.hidden = total <= shown;
		note.textContent =
			total > shown ? t('logs_truncated', 'Showing the last {shown} of {total} lines.').replace('{shown}', String(shown)).replace('{total}', String(total)) : '';
		if (l.key === current) scrollToNewest(root, l.key);
		else pendingScroll.add(l.key);
	}
}
