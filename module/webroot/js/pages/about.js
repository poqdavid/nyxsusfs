import { getAboutData, setConfigValue, PERSISTENT_DIR, MOD_DIR } from '../susfs-data.js';
import { applyTheme, applyMonet, monetAvailable } from '../theme.js';
import { applyFullscreen, fullScreenAvailable } from '../fullscreen.js';
import { nextPaint } from '../ksu-bridge.js';
import { t } from '../i18n.js';

export function renderAboutShell(root) {
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
			<p style="margin:0 0 8px;">${t('about_credits_intro', "NyxSUSFS pairs a WebUI written from scratch with boot scripts that started from <strong>ksu_module_susfs</strong>, so it stays a drop-in for anyone already using that module.")}</p>
			<p style="margin:0 0 8px;">${t('about_credits_susfs', '<strong>SuSFS</strong> by <strong>simonpunk</strong> is the kernel magic that makes all of this possible. None of this exists without it.')}</p>
			<p style="margin:0 0 8px;">${t('about_credits_sidex15', "<strong>ksu_module_susfs</strong> by <strong>sidex15</strong> is the original module Nyx grew out of. Nyx keeps its config layout so it stays a friendly drop-in for anyone already using it, and ships sidex15's <code>ksu_susfs</code> binaries. Huge thanks for the foundation.")}</p>
			<p style="margin:0 0 8px;">${t('about_credits_brene', "A number of Nyx's mount-hiding ideas were sparked by studying <strong>BRENE</strong> by <strong>rrr333nnn333</strong>. The ideas were reimplemented in Nyx's own way, but the inspiration deserves a shout-out.")}</p>
			<p style="margin:0 0 8px;">${t('about_credits_rezygisk', 'The Zygisk-aware unmounting and mount-source detection were guided by the <strong>ReZygisk</strong> project (<strong>PerformanC</strong>), thanks for the pointers on doing it right.')}</p>
			<p style="margin:0 0 8px;">${t('about_credits_poqdavid', 'Everything else, the WebUI, the targeted hiding, the glue, I built myself, with love for the community. Issues and translations welcome. Prop spoofing now lives in its own module, NyxProps.')}</p>
			<p style="margin:0; color: var(--md-on-surface-variant); font-size: 13px;">${t('about_credits_config', 'Config &amp; logs:')} <code>${PERSISTENT_DIR}</code></p>
		</div>

		<h2 class="section-title">${t('about_license_title', 'License')}</h2>
		<div class="card">
			<p style="margin:0 0 8px;">${t('about_license_copyright', 'Copyright © 2026 poqdavid')}</p>
			<p style="margin:0 0 8px;">${t('about_license_body', 'NyxSUSFS is free software under the GNU Affero General Public License v3.0 (AGPL-3.0-only). You may redistribute and modify it under that license. It comes with ABSOLUTELY NO WARRANTY.')}</p>
			<p style="margin:0; color: var(--md-on-surface-variant); font-size: 13px;">${t('about_license_where', 'License text and notices:')} <code>${MOD_DIR}/LICENSE</code>, <code>NOTICE.md</code><br>${t('about_license_source', 'Source code:')} <code>github.com/poqdavid/nyxsusfs</code></p>
		</div>
	`;

	root.querySelector('[data-role="monet"]').addEventListener('change', async (e) => {
		const wanted = e.target.checked;
		await nextPaint();
		await setConfigValue('webui_monet', wanted ? '1' : '0');
		const { enabled, available } = await applyMonet(wanted);
		// If the manager never supplied a palette, don't leave the switch
		// sitting on while the colours plainly haven't changed.
		e.target.checked = enabled;
		updateMonetHint(root, available);
	});

	root.querySelector('[data-role="fullscreen"]').addEventListener('change', async (e) => {
		const wanted = e.target.checked;
		// Applied first so the change is visible immediately; the config
		// write only decides what happens next time the WebUI opens.
		const applied = applyFullscreen(wanted);
		e.target.checked = applied;
		await nextPaint();
		await setConfigValue('webui_fullscreen', applied ? '1' : '0');
	});

	root.querySelector('[data-role="theme"]').addEventListener('change', async (e) => {
		const mode = e.target.value;
		await nextPaint();
		await setConfigValue('webui_theme', mode);
		const effective = await applyTheme(mode);
		updateThemeHint(root, mode, effective);
	});
}

export async function refreshAbout(root) {
	renderAbout(root, await getAboutData());
}

/** Fill the page from a getAboutData() result (also used at startup). */
export function renderAbout(root, { prop, info, config }) {
	root.querySelector('[data-role="name"]').textContent = prop.name ?? 'NyxSUSFS';
	root.querySelector('[data-role="version"]').textContent = [prop.version, prop.author ? `by ${prop.author}` : null].filter(Boolean).join(' · ');

	root.querySelector('[data-role="susfs-version"]').textContent = info.version ?? 'Not detected';
	root.querySelector('[data-role="susfs-variant"]').textContent = info.variant ?? '—';

	const featuresEl = root.querySelector('[data-role="features"]');
	featuresEl.innerHTML = info.features.length
		? info.features.map((f) => `<span class="chip">${f.replace('CONFIG_KSU_SUSFS_', '')}</span>`).join('')
		: '<span style="color: var(--md-on-surface-variant);">None reported</span>';

	const mode = config.webui_theme ?? 'system';
	root.querySelector('[data-role="theme"]').value = mode;
	// Show what "System" actually resolved to - otherwise there's no way to
	// tell whether it read the device setting correctly.
	updateThemeHint(root, mode, document.documentElement.dataset.theme);

	syncMonetSwitch(root);

	// Read back off the document rather than the config, so the switch
	// shows what is actually in effect - the two differ when the host has
	// no fullScreen to call.
	const fsSwitch = root.querySelector('[data-role="fullscreen"]');
	const fsAvailable = fullScreenAvailable();
	fsSwitch.checked = document.documentElement.dataset.fullscreen === 'on';
	fsSwitch.disabled = !fsAvailable;
	root.querySelector('[data-role="fullscreen-hint"]').textContent = fsAvailable
		? 'Hide the status and navigation bars'
		: "Your manager doesn't support fullscreen";
}

/** Show the Material You switch as it is in effect right now. Also called
 * when a palette turns up after the page was rendered. */
export function syncMonetSwitch(root) {
	const monetSwitch = root.querySelector('[data-role="monet"]');
	const available = monetAvailable();
	monetSwitch.checked = document.documentElement.dataset.monet === 'on';
	monetSwitch.disabled = !available;
	updateMonetHint(root, available);
}

function updateMonetHint(root, available) {
	const hint = root.querySelector('[data-role="monet-hint"]');
	if (!hint) return;
	hint.textContent = available
		? 'Use the colours from your wallpaper'
		: "Your manager doesn't provide a Material You palette";
}

function updateThemeHint(root, mode, effective) {
	const hint = root.querySelector('[data-role="theme-hint"]');
	if (!hint) return;
	hint.textContent = mode === 'system'
		? `Following the device setting — currently ${effective}.`
		: '';
}
