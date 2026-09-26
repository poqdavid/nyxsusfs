import { $, $$, closestTarget } from '../core/dom';
import { nextPaint, toast } from '../core/ksu-bridge';
import { confirmDialog } from '../core/dialog';
import { getAvailableLanguages, getCurrentLanguage, setLanguage, t } from '../core/i18n';
import { getConfig, setConfigValue, type Config } from '../susfs-data';
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
		title: 'Su compatibility',
		i18nTitle: 'set_group_su',
		items: [
			{
				key: 'sus_su',
				i18n: 'set_sus_su_label',
				i18nDesc: 'set_sus_su_desc',
				i18nOpts: ['set_sus_su_opt_0', 'set_sus_su_opt_1', 'set_sus_su_opt_2'],
				label: 'sus_su mode',
				type: 'select',
				options: [
					['0', 'Off'],
					['1', 'Legacy'],
					['2', 'Modern (recommended)'],
				],
				desc: 'Deprecated entirely on SuSFS v2.0.0+ kernels; the toggle is a no-op there.',
			},
		],
	},
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
			{
				key: 'disable_add_try_umount',
				i18n: 'set_disable_add_try_umount_label',
				i18nDesc: 'set_disable_add_try_umount_desc',
				label: 'Disable SuSFS add_try_umount',
				desc: 'Deprecated in SuSFS v2.0.0 — the add_try_umount backend was removed, so this has no effect on v2.0.0+ kernels (Nyx unmounts through KernelSU’s built-in kernel umount there). Only relevant on older kernels that still expose CONFIG_KSU_SUSFS_TRY_UMOUNT. Advanced — off by default.',
				type: 'bool',
			},
			{
				key: 'umount_for_zygote_iso_service',
				i18n: 'set_umount_zygote_label',
				i18nDesc: 'set_umount_zygote_desc',
				label: 'Umount for zygote isolated services',
				type: 'bool',
				desc: 'Deprecated in SuSFS v2.0.0 — the command was removed, so this is a no-op on v2.0.0+ kernels (the built-in kernel umount covers isolated services). On older kernels it can break modules that overlay framework files; boot into rescue mode if you bootloop.',
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
				desc: 'On by default. Turn it off and opening the WebUI compares the installed susfs binary against the published one, then offers to install it — nothing is ever replaced without asking.',
			},
			{
				key: 'bin_update_now',
				i18n: 'set_bin_update_now_label',
				i18nDesc: 'set_bin_update_now_desc',
				i18nAction: 'set_bin_update_now_action',
				label: 'Check the susfs binary now',
				type: 'action',
				actionLabel: 'Check',
				desc: 'Compares hashes against sidex15/susfs4ksu-binaries. Works whether or not the check on open is enabled.',
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
			Path lists (sus_path, sus_mount, try_umount…) live in the Paths section.
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

	groupsEl.addEventListener('change', async (e) => {
		const el = closestTarget<HTMLInputElement | HTMLSelectElement>(e, '[data-key]');
		const key = el?.dataset.key;
		if (!el || !key) return;
		const value = el.dataset.type === 'bool' ? ((el as HTMLInputElement).checked ? '1' : '0') : el.value;
		await nextPaint();
		const { ok } = await setConfigValue(key, value);
		toast(ok ? 'Saved — some settings need a reboot to apply' : 'Failed to save setting');
	});

	groupsEl.addEventListener('click', (e) => {
		const btn = closestTarget<HTMLButtonElement>(e, '[data-action="bin_update_now"]');
		if (btn) runManualBinCheck(btn);
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
	applySettingsConfig(root, await getConfig());
}

export function applySettingsConfig(root: HTMLElement, config: Config): void {
	for (const el of $$<HTMLInputElement | HTMLSelectElement>(root, '[data-key][data-type]')) {
		const value = config[el.dataset.key ?? ''];
		if (el.dataset.type === 'bool') {
			(el as HTMLInputElement).checked = value === '1';
		} else {
			el.value = value ?? '';
		}
	}
}
