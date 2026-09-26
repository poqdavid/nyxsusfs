import { $, $$, closestTarget, escapeHtml } from '../core/dom';
import { nextPaint, toast } from '../core/ksu-bridge';
import { confirmDialog } from '../core/dialog';
import { getAvailableLanguages, getCurrentLanguage, setLanguage, t } from '../core/i18n';
import { closeSheet, openSheetWithBody } from '../core/sheet';
import { applyPriorityFilter, getPriorityApps, getSettingsData, savePriorityApps, setConfigValue, type Config, type PriorityState } from '../susfs-data';
import { applyBinaryUpdate, checkBinaryUpdate, describeBinaryStatus } from '../bin-update';

interface BaseItem {
	key: string;
	label: string;
	i18n?: string;
	desc?: string;
	i18nDesc?: string;
}

interface BoolItem extends BaseItem {
	type: 'bool';
}

interface SelectItem extends BaseItem {
	type: 'select';
	options: readonly (readonly [string, string])[];
	i18nOpts?: readonly string[];
}

interface TextItem extends BaseItem {
	type: 'text';
	placeholder?: string;
}

interface ActionItem extends BaseItem {
	type: 'action';
	actionLabel?: string;
	i18nAction?: string;
}

type Item = BoolItem | SelectItem | TextItem | ActionItem;

interface Group {
	title: string;
	i18nTitle?: string;
	items: readonly Item[];
}

const GROUPS: readonly Group[] = [
	{
		title: 'Mount & path hiding',
		i18nTitle: 'set_group_mounts',
		items: [
			{
				key: 'hide_cusrom',
				i18n: 'set_hide_cusrom_label',
				i18nDesc: 'set_hide_cusrom_desc',
				i18nOpts: [
					'set_hide_cusrom_opt_0',
					'set_hide_cusrom_opt_1',
					'set_hide_cusrom_opt_2',
					'set_hide_cusrom_opt_3',
					'set_hide_cusrom_opt_4',
					'set_hide_cusrom_opt_5',
					'set_hide_cusrom_opt_6',
				],
				label: 'Hide custom-ROM traces',
				type: 'select',
				options: [
					['0', 'Off'],
					['1', 'Conservative'],
					['2', 'Light'],
					['3', 'Moderate'],
					['4', 'Strong'],
					['5', 'Aggressive'],
					['6', 'Extreme'],
				],
				desc: 'Searches /system, /vendor, /system_ext, /product and top-level /data for custom-ROM name strings and hides matches (sus_map + sus_path_loop). Higher = fewer file-type exclusions. Extreme also scans /data dalvik-cache, resource-cache and misc — thorough but slow, and hides more, so use only if a check still detects the ROM.',
			},
			{ key: 'hide_gapps', i18n: 'set_hide_gapps_label', label: 'Hide GApps traces', type: 'bool' },
			{ key: 'hide_revanced', i18n: 'set_hide_revanced_label', label: 'Hide ReVanced YouTube/Music', type: 'bool' },
			{ key: 'hide_loops', i18n: 'set_hide_loops_label', label: 'Hide loop/jbd2 mount info', type: 'bool' },
			{
				key: 'hide_injections',
				i18n: 'set_hide_injections_label',
				i18nDesc: 'set_hide_injections_desc',
				label: 'Hide suspicious injections',
				type: 'bool',
				desc: 'Maps every file a module injects — files under each module’s system/ overlay and *.so under /data/adb/modules — so an inode/memory-map scan can’t spot them. Needs the SUS_MAP kernel feature.',
			},
			{
				key: 'hide_custom_recovery',
				i18n: 'set_hide_custom_recovery_label',
				i18nDesc: 'set_hide_custom_recovery_desc',
				label: 'Hide custom recovery paths',
				type: 'bool',
				desc: 'Hides leftover TWRP/OrangeFox/install-recovery traces (/data/recovery, install-recovery.sh, storage folders) when present.',
			},
			{
				key: 'hide_suspicious_pty',
				i18n: 'set_hide_suspicious_pty_label',
				i18nDesc: 'set_hide_suspicious_pty_desc',
				label: 'Hide suspicious PTYs',
				type: 'bool',
				desc: 'Hides /dev/pts/0–5, the pseudo-terminals a root shell allocates. Off by default — can affect terminal apps.',
			},
			{
				key: 'hide_addon_d',
				i18n: 'set_hide_addon_d_label',
				i18nDesc: 'set_hide_addon_d_desc',
				label: 'Hide /system/addon.d',
				type: 'bool',
				desc: 'Hides the addon.d directory of survive-OTA scripts (e.g. 50-lineage.sh) that name a custom ROM.',
			},
			{
				key: 'hide_framework_res',
				i18n: 'set_hide_framework_res_label',
				i18nDesc: 'set_hide_framework_res_desc',
				label: 'Hide framework-res.apk',
				type: 'bool',
				desc: 'Maps framework-res.apk overlays under /system, a common resource-overlay detection point. Needs the SUS_MAP kernel feature.',
			},
			{
				key: 'hide_data_local_tmp',
				i18n: 'set_hide_data_local_tmp_label',
				i18nDesc: 'set_hide_data_local_tmp_desc',
				label: 'Hide /data/local/tmp contents',
				type: 'bool',
				desc: 'Hides every entry under /data/local/tmp — the usual staging area for root tools and installers.',
			},
			{
				key: 'hide_nonstd_sdcard',
				i18n: 'set_hide_nonstd_sdcard_label',
				i18nDesc: 'set_hide_nonstd_sdcard_desc',
				label: 'Hide non-standard storage folders',
				type: 'bool',
				desc: 'Hides top-level /storage/emulated/0 folders that aren’t standard media dirs (DCIM, Download, Android…). Broad — hides any stray folder you keep in storage root. Off by default.',
			},
			{
				key: 'hide_nonstd_sdcard_android',
				i18n: 'set_hide_nonstd_sdcard_android_label',
				i18nDesc: 'set_hide_nonstd_sdcard_android_desc',
				label: 'Hide non-standard Android/ folders',
				type: 'bool',
				desc: 'Hides /storage/emulated/0/Android entries that aren’t data, media, or obb.',
			},
			{
				key: 'hide_lineage_strings',
				i18n: 'set_hide_lineage_strings_label',
				i18nDesc: 'set_hide_lineage_strings_desc',
				label: 'Hide LineageOS policy strings (advanced)',
				type: 'bool',
				desc: '⚠ Risky. Redirects SELinux policy (sepolicy.cil, file_contexts) and lineage-mentioning .rc files to empty fakes. These are policy/init files — if something re-reads them at runtime you can hit SELinux denials or a service that won’t start. Leave off unless a check specifically needs it and you understand the risk. Needs the open_redirect kernel feature.',
			},
			{ key: 'hide_vendor_sepolicy', i18n: 'set_hide_vendor_sepolicy_label', label: 'Hide vendor sepolicy strings', type: 'bool' },
			{ key: 'hide_compat_matrix', i18n: 'set_hide_compat_matrix_label', label: 'Hide compatibility_matrix strings', type: 'bool' },
			{
				key: 'hide_sus_mnts_for_all_or_non_su_procs',
				i18n: 'set_hide_sus_mnts_label',
				i18nOpts: ['set_hide_sus_mnts_opt_0', 'set_hide_sus_mnts_opt_1', 'set_hide_sus_mnts_opt_2'],
				label: 'Hide sus mounts',
				type: 'select',
				options: [
					['0', 'Off'],
					['1', 'Always'],
					['2', 'During boot only'],
				],
			},
			{ key: 'skip_legit_mounts', i18n: 'set_skip_legit_mounts_label', label: 'Skip mounts in legit_mounts.txt', type: 'bool' },
			{
				key: 'priority_uid_filter',
				i18n: 'set_priority_label',
				i18nDesc: 'set_priority_desc',
				i18nOpts: ['set_priority_opt_0', 'set_priority_opt_1', 'set_priority_opt_2'],
				label: 'Hide apps from priority probes',
				type: 'select',
				options: [
					['0', 'Off'],
					['1', 'Apps you choose'],
					['2', 'All user apps'],
				],
				desc: 'Hides apps’ uids from apps that call getpriority/setpriority or ioprio_get/ioprio_set to find out what is installed or running. Needs a SuSFS kernel with the priority uid filter. Turning it off takes effect after a reboot.',
			},
			{
				key: 'priority_uid_filter_apps',
				i18n: 'set_priority_apps_label',
				i18nDesc: 'set_priority_apps_desc',
				i18nAction: 'set_priority_apps_action',
				label: 'Apps to hide',
				type: 'action',
				actionLabel: 'Choose',
				desc: 'The apps hidden when the filter is set to “Apps you choose”.',
			},
			{
				key: 'priority_uid_filter_apply',
				i18n: 'set_priority_apply_label',
				i18nDesc: 'set_priority_apply_desc',
				i18nAction: 'set_priority_apply_action',
				label: 'Apply now',
				type: 'action',
				actionLabel: 'Apply',
				desc: 'Hides the apps straight away instead of at the next boot.',
			},
		],
	},
	{
		title: 'Process & unmounting',
		i18nTitle: 'set_group_process',
		items: [
			{ key: 'auto_try_umount', i18n: 'set_auto_try_umount_label', label: 'Auto try_umount detected mounts', type: 'bool' },
			{
				key: 'skip_kernel_umount_zygisk',
				i18n: 'set_skip_kernel_umount_zygisk_label',
				i18nDesc: 'set_skip_kernel_umount_zygisk_desc',
				label: 'Skip kernel umount with ReZygisk/ZygiskNext',
				desc: 'When ReZygisk or ZygiskNext is installed, let it handle unmounting instead of the kernel umount — they do their own, and doing both conflicts. Only takes effect when one of them is present; otherwise the module unmounts normally. On by default.',
				type: 'bool',
			},
			{ key: 'force_hide_lsposed', i18n: 'set_force_hide_lsposed_label', label: 'Force-hide LSPosed (dex2oat)', type: 'bool' },
		],
	},
	{
		title: 'Spoofing',
		i18nTitle: 'set_group_spoofing',
		items: [
			{ key: 'spoof_cmdline', i18n: 'set_spoof_cmdline_label', label: 'Spoof /proc/cmdline & bootconfig', type: 'bool' },
			{
				key: 'spoof_uname',
				i18n: 'set_spoof_uname_label',
				i18nOpts: ['set_spoof_uname_opt_0', 'set_spoof_uname_opt_1', 'set_spoof_uname_opt_2'],
				label: 'Spoof uname',
				type: 'select',
				options: [
					['0', 'Off'],
					['1', 'At boot-completed'],
					['2', 'At post-fs-data'],
				],
			},
			{ key: 'kernel_version', i18n: 'set_kernel_version_label', label: 'Spoofed kernel release', type: 'text', placeholder: 'default' },
			{ key: 'kernel_build', i18n: 'set_kernel_build_label', label: 'Spoofed kernel version string', type: 'text', placeholder: 'default' },
			{
				key: 'avc_log_spoofing',
				i18n: 'set_avc_log_spoofing_label',
				i18nDesc: 'set_avc_log_spoofing_desc',
				label: 'AVC log spoofing',
				type: 'bool',
				desc: "Bypasses 'su' domain detection via /proc/<pid> enumeration.",
			},
		],
	},
	{
		title: 'Storage',
		i18nTitle: 'set_group_storage',
		items: [
			{
				key: 'emulate_vold_app_data',
				i18n: 'set_emulate_vold_label',
				i18nOpts: ['set_emulate_vold_opt_0', 'set_emulate_vold_opt_1', 'set_emulate_vold_opt_2'],
				label: 'Emulate vold app data',
				type: 'select',
				options: [
					['0', 'Off'],
					['1', 'sus_path'],
					['2', 'sus_path_loop'],
				],
			},
		],
	},
	{
		title: 'Logging & updates',
		i18nTitle: 'set_group_logging',
		items: [
			{ key: 'susfs_log', i18n: 'set_susfs_log_label', label: 'SuSFS kernel log', type: 'bool' },
			{
				key: 'disable_webui_bin_update',
				i18n: 'set_disable_bin_update_label',
				i18nDesc: 'set_disable_bin_update_desc',
				label: 'Skip binary update check on open',
				type: 'bool',
				desc: 'On by default. Turn it off and opening the WebUI checks simonpunk’s susfs4ksu for a newer ksu_susfs, then offers to install it — nothing is ever replaced without asking.',
			},
			{
				key: 'bin_update_now',
				i18n: 'set_bin_update_now_label',
				i18nDesc: 'set_bin_update_now_desc',
				i18nAction: 'set_bin_update_now_action',
				label: 'Check the susfs binary now',
				type: 'action',
				actionLabel: 'Check',
				desc: 'Checks simonpunk’s susfs4ksu for a newer ksu_susfs. Works whether or not the check on open is enabled.',
			},
		],
	},
];

function renderLanguageSelector(cardEl: HTMLElement | null): void {
	if (!cardEl) return;
	const langs = getAvailableLanguages();
	const current = getCurrentLanguage();
	const options = Object.entries(langs)
		.map(([code, name]) => `<option value="${code}" ${code === current ? 'selected' : ''}>${name}</option>`)
		.join('');
	cardEl.innerHTML = `
		<div class="setting-row setting-row--stacked">
			<div class="setting-row__text">
				<div class="setting-row__title">${t('set_language_label', 'Interface language')}</div>
				<div class="setting-row__desc">${t('set_language_desc', 'English is the source language. Other languages are community translations and may be incomplete; missing text falls back to English.')}</div>
			</div>
			<select class="select-field select-field--block" data-role="language-select">
				${options}
			</select>
		</div>`;
	const sel = $<HTMLSelectElement>(cardEl, '[data-role="language-select"]');
	sel.addEventListener('change', async () => {
		await setLanguage(sel.value);
		const pageRoot = cardEl.closest<HTMLElement>('.page') || cardEl.parentElement;
		if (pageRoot) {
			renderSettingsShell(pageRoot);
			refreshSettings(pageRoot);
		}
		document.dispatchEvent(new CustomEvent('nyx:language-changed'));
	});
}

function rowHtml(item: Item, value: string): string {
	const label = item.i18n ? t(item.i18n, item.label) : item.label;
	const descText = item.i18nDesc ? t(item.i18nDesc, item.desc) : item.desc;
	const desc = descText ? `<div class="setting-row__desc">${descText}</div>` : '';
	let control: string;
	switch (item.type) {
		case 'bool': {
			const checked = value === '1' ? 'checked' : '';
			control = `
			<label class="m3-switch">
				<input type="checkbox" data-key="${item.key}" data-type="bool" ${checked}>
				<span class="m3-switch__track"></span>
				<span class="m3-switch__thumb"></span>
			</label>`;
			break;
		}
		case 'select':
			control = `
			<select class="select-field select-field--block" data-key="${item.key}" data-type="select">
				${item.options
					.map(([v, l], idx) => {
						const optKey = item.i18nOpts?.[idx];
						const optLabel = optKey ? t(optKey, l) : l;
						return `<option value="${v}" ${v === value ? 'selected' : ''}>${optLabel}</option>`;
					})
					.join('')}
			</select>`;
			break;
		case 'action': {
			const actionLabel = item.i18nAction ? t(item.i18nAction, item.actionLabel ?? 'Run') : (item.actionLabel ?? 'Run');
			control = `<button class="btn btn--tonal" data-action="${item.key}">${actionLabel}</button>`;
			break;
		}
		case 'text':
			control = `<input class="select-field" data-key="${item.key}" data-type="text" value="${value ?? ''}" placeholder="${item.placeholder ?? ''}">`;
			break;
	}
	return `
		<div class="setting-row${item.type === 'select' ? ' setting-row--stacked' : ''}">
			<div class="setting-row__text">
				<div class="setting-row__title">${label}</div>
				${desc}
			</div>
			${control}
		</div>`;
}

export function renderSettingsShell(root: HTMLElement): void {
	root.innerHTML = `
		<h2 class="section-title">${t('set_group_language', 'Language')}</h2>
		<div class="card" data-role="language-card"></div>
		<div data-role="groups"></div>
		<p class="setting-row__desc" style="margin:20px 4px 0;">
			Path lists (sus_path, sus_maps, try_umount…) live in the Paths section.
		</p>
	`;

	renderLanguageSelector(root.querySelector<HTMLElement>('[data-role="language-card"]'));

	const groupsEl = $(root, '[data-role="groups"]');
	groupsEl.innerHTML = GROUPS.map(
		(g) => `
		<h2 class="section-title">${g.i18nTitle ? t(g.i18nTitle, g.title) : g.title}</h2>
		<div class="card" data-group="${g.title}">
			${g.items.map((item) => rowHtml(item, '')).join('')}
		</div>
	`,
	).join('');
	groupsEl
		.querySelector('[data-action="priority_uid_filter_apply"]')
		?.closest('.setting-row')
		?.querySelector('.setting-row__text')
		?.insertAdjacentHTML('beforeend', '<div class="setting-row__desc" data-role="priority-status"></div>');

	groupsEl.addEventListener('change', async (e) => {
		const el = closestTarget<HTMLInputElement | HTMLSelectElement>(e, '[data-key]');
		const key = el?.dataset.key;
		if (!el || !key) return;
		const value = el.dataset.type === 'bool' ? ((el as HTMLInputElement).checked ? '1' : '0') : el.value;
		await nextPaint();
		const { ok } = await setConfigValue(key, value);
		if (ok && key === 'priority_uid_filter') {
			renderPriority(root);
			if (value === '0') toast(t('set_priority_off_toast', 'Saved — apps already hidden stay hidden until a reboot'));
			else await runPriorityApply(root);
			return;
		}
		toast(ok ? 'Saved — some settings need a reboot to apply' : 'Failed to save setting');
	});

	groupsEl.addEventListener('click', (e) => {
		const btn = closestTarget<HTMLButtonElement>(e, '[data-action]');
		if (btn?.dataset.action === 'bin_update_now') runManualBinCheck(btn);
		if (btn?.dataset.action === 'priority_uid_filter_apps') openPriorityPicker(root);
		if (btn?.dataset.action === 'priority_uid_filter_apply') runPriorityApply(root);
	});
}

let priorityState: PriorityState = { supported: true, status: {} };

function priorityMode(root: HTMLElement): string {
	return root.querySelector<HTMLSelectElement>('[data-key="priority_uid_filter"]')?.value ?? '0';
}

function priorityStatusText(mode: string, state: PriorityState): string {
	const nobinary = t('set_priority_status_nobinary', 'Not available: the installed ksu_susfs has no priority uid filter. Check the binary under Logging & updates.');
	if (!state.supported) return nobinary;
	switch (state.status.state) {
		case 'applied': {
			const hiding = t('set_priority_status_applied', 'Hiding {n} apps.').replace('{n}', state.status.apps ?? '0');
			return mode === '0' ? `${hiding} ${t('set_priority_status_until_reboot', 'They stay hidden until the next reboot.')}` : hiding;
		}
		case 'empty':
			return t('set_priority_status_empty', 'Nothing hidden: none of the chosen apps are installed.');
		case 'unsupported':
			return t('set_priority_status_unsupported', 'Not applied: this kernel’s SuSFS has no priority uid filter.');
		case 'nobinary':
			return nobinary;
		case 'failed':
			return t('set_priority_status_failed', 'Not applied: ksu_susfs reported an error. See the Activity log.');
		case 'susfs':
			return t('set_priority_status_susfs', 'Not applied: NyxSUSFS needs SuSFS v2.1.0 or newer.');
		default:
			return mode === '0' ? t('set_priority_status_off', 'Off.') : t('set_priority_status_pending', 'Not applied yet. Tap Apply, or reboot.');
	}
}

function renderPriority(root: HTMLElement): void {
	const mode = priorityMode(root);
	const supported = priorityState.supported;
	const select = root.querySelector<HTMLSelectElement>('[data-key="priority_uid_filter"]');
	const choose = root.querySelector<HTMLButtonElement>('[data-action="priority_uid_filter_apps"]');
	const apply = root.querySelector<HTMLButtonElement>('[data-action="priority_uid_filter_apply"]');
	if (select) select.disabled = !supported;
	if (choose) choose.disabled = !supported;
	if (apply && !apply.classList.contains('is-busy')) apply.disabled = !supported || mode === '0';
	const status = root.querySelector<HTMLElement>('[data-role="priority-status"]');
	if (status) status.textContent = priorityStatusText(mode, priorityState);
}

async function runPriorityApply(root: HTMLElement): Promise<void> {
	const btn = root.querySelector<HTMLButtonElement>('[data-action="priority_uid_filter_apply"]');
	if (!btn || btn.classList.contains('is-busy')) return;
	const original = btn.innerHTML;
	btn.disabled = true;
	btn.classList.add('is-busy');
	setBtnBusy(btn, t('set_priority_applying', 'Applying…'));
	await nextPaint();
	try {
		const result = await applyPriorityFilter();
		if (result.state && result.state !== 'off') priorityState = { ...priorityState, status: result };
		toast(result.state ? priorityStatusText(priorityMode(root), priorityState) : t('set_priority_apply_failed', 'Could not run nyxsusfs'));
	} finally {
		btn.classList.remove('is-busy');
		btn.innerHTML = original;
		renderPriority(root);
	}
}

async function openPriorityPicker(root: HTMLElement): Promise<void> {
	const apps = await getPriorityApps();
	const installed = new Set(apps.installed);
	const chosen = new Set(apps.chosen);
	const all = [...new Set([...apps.installed, ...apps.chosen])].sort();
	const rows = all
		.map(
			(p) => `
			<li data-pkg="${escapeHtml(p)}">
				<label class="app-picker__row">
					<input type="checkbox" value="${escapeHtml(p)}" ${chosen.has(p) ? 'checked' : ''}>
					<span class="app-picker__name">${escapeHtml(p)}</span>
					${installed.has(p) ? '' : `<span class="app-picker__missing">${t('set_priority_picker_missing', 'not installed')}</span>`}
				</label>
			</li>`,
		)
		.join('');
	const body = openSheetWithBody(
		t('set_priority_picker_title', 'Apps to hide'),
		all.length
			? `
			<input class="select-field select-field--block app-picker__search" type="search" data-role="search" placeholder="${t('set_priority_picker_search', 'Search apps')}">
			<div class="app-picker__count" data-role="count"></div>
			<ul class="app-picker__list">${rows}</ul>
			<div class="dialog__actions app-picker__actions">
				<button class="btn btn--filled" data-role="save">${t('set_priority_picker_save', 'Save')}</button>
			</div>`
			: `<div class="sheet__empty">${t('set_priority_picker_empty', 'No user-installed apps found.')}</div>`,
	);
	if (!all.length) return;
	const boxes = $$<HTMLInputElement>(body, 'input[type="checkbox"]');
	const count = $(body, '[data-role="count"]');
	const updateCount = () => {
		count.textContent = t('set_priority_picker_count', '{n} chosen').replace('{n}', String(boxes.filter((b) => b.checked).length));
	};
	updateCount();
	for (const b of boxes) b.addEventListener('change', updateCount);
	$<HTMLInputElement>(body, '[data-role="search"]').addEventListener('input', (e) => {
		const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
		for (const li of $$<HTMLElement>(body, 'li[data-pkg]')) li.hidden = !!q && !(li.dataset.pkg ?? '').toLowerCase().includes(q);
	});
	$(body, '[data-role="save"]').addEventListener('click', async () => {
		const picked = boxes.filter((b) => b.checked).map((b) => b.value);
		const { ok } = await savePriorityApps(apps.comments, picked);
		closeSheet();
		if (!ok) {
			toast('Failed to save setting');
			return;
		}
		if (priorityMode(root) === '1') await runPriorityApply(root);
		else toast(t('set_priority_saved_toast', 'Saved — used when the filter is set to “Apps you choose”'));
	});
}

function setBtnBusy(btn: HTMLButtonElement, label: string): void {
	btn.innerHTML = `<span class="btn__spinner" aria-hidden="true"></span>${label}`;
}

async function runManualBinCheck(btn: HTMLButtonElement): Promise<void> {
	const original = btn.innerHTML;
	btn.disabled = true;
	btn.classList.add('is-busy');
	btn.setAttribute('aria-busy', 'true');
	setBtnBusy(btn, 'Checking…');
	await nextPaint();
	try {
		const result = await checkBinaryUpdate();
		const notice = describeBinaryStatus(result);
		if (result.status !== 'differs' && result.status !== 'missing') {
			toast(notice ? [notice.title, notice.subtitle].filter(Boolean).join(' — ') : result.detail);
			return;
		}
		const message = [
			result.detail,
			result.message ? `Latest change: ${result.message}` : '',
			'This binary is shared with ksu_module_susfs if you have it installed. A reboot is needed afterwards.',
		]
			.filter(Boolean)
			.join('\n\n');
		if (!(await confirmDialog('Install the published binary?', message, 'Install'))) return;

		setBtnBusy(btn, 'Installing…');
		await nextPaint();
		const applied = await applyBinaryUpdate();
		toast(applied.detail || 'Done');
	} finally {
		btn.disabled = false;
		btn.classList.remove('is-busy');
		btn.removeAttribute('aria-busy');
		btn.innerHTML = original;
	}
}

export async function refreshSettings(root: HTMLElement): Promise<void> {
	const { config, priority } = await getSettingsData();
	applySettingsConfig(root, config, priority);
}

export function applySettingsConfig(root: HTMLElement, config: Config, priority?: PriorityState): void {
	for (const el of $$<HTMLInputElement | HTMLSelectElement>(root, '[data-key][data-type]')) {
		const value = config[el.dataset.key ?? ''];
		if (el.dataset.type === 'bool') {
			(el as HTMLInputElement).checked = value === '1';
		} else {
			el.value = value ?? '';
		}
	}
	if (priority) priorityState = priority;
	renderPriority(root);
}
