import { $ } from '../core/dom';
import { nextPaint } from '../core/ksu-bridge';
import { applyMonet, applyTheme, monetAvailable } from '../core/theme';
import { applyFullscreen, fullScreenAvailable } from '../core/fullscreen';
import { t } from '../core/i18n';
import { getAboutData, MOD_DIR, PERSISTENT_DIR, setConfigValue, type AboutData } from '../susfs-data';

export function renderAboutShell(root: HTMLElement): void {
	root.innerHTML = `
		<div class="card" style="text-align:center;">
			<div style="font: var(--md-type-title-lg); margin-bottom:4px;" data-role="name">NyxSUSFS</div>
			<div style="color: var(--md-on-surface-variant);" data-role="version">—</div>
		</div>

		<h2 class="section-title">SuSFS</h2>
		<div class="card">
			<div class="setting-row"><div class="setting-row__text"><div class="setting-row__title">Version</div></div><div data-role="susfs-version">—</div></div>
			<div class="setting-row"><div class="setting-row__text"><div class="setting-row__title">Variant</div></div><div data-role="susfs-variant">—</div></div>
			<div class="setting-row" style="border-bottom:none; flex-direction:column; align-items:stretch;">
				<div class="setting-row__title" style="margin-bottom:4px;">Enabled features</div>
				<div class="chip-row" data-role="features"></div>
			</div>
		</div>

		<h2 class="section-title">Appearance</h2>
		<div class="card">
			<div class="setting-row">
				<div class="setting-row__text"><div class="setting-row__title">Theme</div></div>
				<select class="select-field" data-role="theme">
					<option value="system">System</option>
					<option value="light">Light</option>
					<option value="dark">Dark</option>
				</select>
			</div>
			<div class="setting-row__desc" style="padding:0 4px 12px;" data-role="theme-hint"></div>
			<div class="setting-row">
				<div class="setting-row__text">
					<div class="setting-row__title">Material You</div>
					<div class="setting-row__desc" data-role="monet-hint">Use the colours from your wallpaper</div>
				</div>
				<label class="m3-switch">
					<input type="checkbox" data-role="monet">
					<span class="m3-switch__track"></span>
					<span class="m3-switch__thumb"></span>
				</label>
			</div>
			<div class="setting-row" style="border-bottom:none;">
				<div class="setting-row__text">
					<div class="setting-row__title">Fullscreen</div>
					<div class="setting-row__desc" data-role="fullscreen-hint">Hide the status and navigation bars</div>
				</div>
				<label class="m3-switch">
					<input type="checkbox" data-role="fullscreen">
					<span class="m3-switch__track"></span>
					<span class="m3-switch__thumb"></span>
				</label>
			</div>
		</div>

		<h2 class="section-title">${t('about_credits_title', 'Credits')}</h2>
		<div class="card">
			<p style="margin:0 0 8px;">${t('about_credits_intro', 'NyxSUSFS pairs a WebUI written from scratch with boot-stage logic that started from <strong>ksu_module_susfs</strong>, so it stays a drop-in for anyone already using that module.')}</p>
			<p style="margin:0 0 8px;">${t('about_credits_susfs', '<strong>SuSFS</strong> by <strong>simonpunk</strong> is the kernel magic that makes all of this possible, and the <code>ksu_susfs</code> Nyx ships is built from it. None of this exists without it.')}</p>
			<p style="margin:0 0 8px;">${t('about_credits_sidex15', '<strong>ksu_module_susfs</strong> by <strong>sidex15</strong> is the original module Nyx grew out of. Nyx keeps its config layout so it stays a friendly drop-in for anyone already using it. Huge thanks for the foundation.')}</p>
			<p style="margin:0 0 8px;">${t('about_credits_brene', "A number of Nyx's mount-hiding ideas were sparked by studying <strong>BRENE</strong> by <strong>rrr333nnn333</strong>. The ideas were reimplemented in Nyx's own way, but the inspiration deserves a shout-out.")}</p>
			<p style="margin:0 0 8px;">${t('about_credits_rezygisk', 'The Zygisk-aware unmounting and mount-source detection were guided by the <strong>ReZygisk</strong> project (<strong>PerformanC</strong>), thanks for the pointers on doing it right.')}</p>
			<p style="margin:0 0 8px;">${t('about_credits_poqdavid', 'Everything else, the WebUI, the targeted hiding, the glue, I built myself, with love for the community. Issues and translations welcome. Prop spoofing is a separate module, NyxProps.')}</p>
			<p style="margin:0; color: var(--md-on-surface-variant); font-size: 13px;">${t('about_credits_config', 'Config &amp; logs:')} <code>${PERSISTENT_DIR}</code></p>
		</div>

		<h2 class="section-title">${t('about_license_title', 'License')}</h2>
		<div class="card">
			<p style="margin:0 0 8px;">${t('about_license_copyright', 'Copyright © 2026 poqdavid')}</p>
			<p style="margin:0 0 8px;">${t('about_license_body', 'NyxSUSFS is free software under the GNU Affero General Public License v3.0 (AGPL-3.0-only). You may redistribute and modify it under that license. It comes with ABSOLUTELY NO WARRANTY.')}</p>
			<p style="margin:0; color: var(--md-on-surface-variant); font-size: 13px;">${t('about_license_where', 'License text and notices:')} <code>${MOD_DIR}/LICENSE</code>, <code>NOTICE.md</code><br>${t('about_license_source', 'Source code:')} <code>github.com/poqdavid/nyxsusfs</code></p>
		</div>
	`;

	const monetSwitch = $<HTMLInputElement>(root, '[data-role="monet"]');
	monetSwitch.addEventListener('change', async () => {
		const wanted = monetSwitch.checked;
		await nextPaint();
		await setConfigValue('webui_monet', wanted ? '1' : '0');
		const { enabled, available } = await applyMonet(wanted);
		monetSwitch.checked = enabled;
		updateMonetHint(root, available);
	});

	const fsSwitch = $<HTMLInputElement>(root, '[data-role="fullscreen"]');
	fsSwitch.addEventListener('change', async () => {
		const wanted = fsSwitch.checked;
		const applied = applyFullscreen(wanted);
		fsSwitch.checked = applied;
		await nextPaint();
		await setConfigValue('webui_fullscreen', applied ? '1' : '0');
	});

	const themeSelect = $<HTMLSelectElement>(root, '[data-role="theme"]');
	themeSelect.addEventListener('change', async () => {
		const mode = themeSelect.value;
		await nextPaint();
		await setConfigValue('webui_theme', mode);
		const effective = await applyTheme(mode);
		updateThemeHint(root, mode, effective);
	});
}

export async function refreshAbout(root: HTMLElement): Promise<void> {
	renderAbout(root, await getAboutData());
}

export function renderAbout(root: HTMLElement, { prop, info, config }: AboutData): void {
	$(root, '[data-role="name"]').textContent = prop.name ?? 'NyxSUSFS';
	$(root, '[data-role="version"]').textContent = [prop.version, prop.author ? `by ${prop.author}` : null].filter(Boolean).join(' · ');

	$(root, '[data-role="susfs-version"]').textContent = info.version ?? 'Not detected';
	$(root, '[data-role="susfs-variant"]').textContent = info.variant ?? '—';

	$(root, '[data-role="features"]').innerHTML = info.features.length
		? info.features.map((f) => `<span class="chip">${f.replace('CONFIG_KSU_SUSFS_', '')}</span>`).join('')
		: '<span style="color: var(--md-on-surface-variant);">None reported</span>';

	const mode = config.webui_theme ?? 'system';
	$<HTMLSelectElement>(root, '[data-role="theme"]').value = mode;
	updateThemeHint(root, mode, document.documentElement.dataset.theme);

	syncMonetSwitch(root);

	const fsSwitch = $<HTMLInputElement>(root, '[data-role="fullscreen"]');
	const fsAvailable = fullScreenAvailable();
	fsSwitch.checked = document.documentElement.dataset.fullscreen === 'on';
	fsSwitch.disabled = !fsAvailable;
	$(root, '[data-role="fullscreen-hint"]').textContent = fsAvailable ? 'Hide the status and navigation bars' : "Your manager doesn't support fullscreen";
}

export function syncMonetSwitch(root: HTMLElement): void {
	const monetSwitch = $<HTMLInputElement>(root, '[data-role="monet"]');
	const available = monetAvailable();
	monetSwitch.checked = document.documentElement.dataset.monet === 'on';
	monetSwitch.disabled = !available;
	updateMonetHint(root, available);
}

function updateMonetHint(root: HTMLElement, available: boolean): void {
	const hint = root.querySelector('[data-role="monet-hint"]');
	if (!hint) return;
	hint.textContent = available ? 'Use the colours from your wallpaper' : "Your manager doesn't provide a Material You palette";
}

function updateThemeHint(root: HTMLElement, mode: string, effective: string | undefined): void {
	const hint = root.querySelector('[data-role="theme-hint"]');
	if (!hint) return;
	hint.textContent = mode === 'system' ? `Following the device setting — currently ${effective}.` : '';
}
