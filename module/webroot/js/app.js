import { icons } from './icons.js';
import { toast } from './ksu-bridge.js';
import { getConfig } from './susfs-data.js';
import { initI18n } from './i18n.js';
import { applyFullscreen } from './fullscreen.js';
import { checkBinaryUpdate, applyBinaryUpdate, describeBinaryStatus } from './bin-update.js';
import { applyTheme, applyMonet } from './theme.js';
import { initKeyboardHandling } from './keyboard.js';
import { renderHomeShell, refreshHome, setHomeNotice } from './pages/home.js';
import { renderPathsShell, refreshPaths } from './pages/paths.js';
import { renderSettingsShell, refreshSettings } from './pages/settings.js';
import { renderAboutShell, refreshAbout } from './pages/about.js';

const PAGES = {
	home: { render: renderHomeShell, refresh: refreshHome, icon: icons.home, label: 'Home' },
	paths: { render: renderPathsShell, refresh: refreshPaths, icon: icons.paths, label: 'Paths' },
	settings: { render: renderSettingsShell, refresh: refreshSettings, icon: icons.settings, label: 'Settings' },
	about: { render: renderAboutShell, refresh: refreshAbout, icon: icons.info, label: 'About' },
};

const app = document.getElementById('app');
const navBar = document.getElementById('nav-bar');
const refreshBtn = document.getElementById('refresh-btn');

let currentPage = 'home';

function buildShell() {
	for (const [key, page] of Object.entries(PAGES)) {
		const section = document.createElement('section');
		section.className = 'page';
		section.id = `page-${key}`;
		app.appendChild(section);
		page.render(section);
	}
	navBar.innerHTML = Object.entries(PAGES).map(([key, page]) => `
		<button class="nav-item" data-page="${key}">
			${page.icon}
			<span class="pill">${page.label}</span>
		</button>
	`).join('');
	navBar.addEventListener('click', (e) => {
		const btn = e.target.closest('.nav-item');
		if (btn) goToPage(btn.dataset.page);
	});
	refreshBtn.addEventListener('click', () => refreshCurrentPage());
}

function goToPage(key) {
	if (!PAGES[key]) return;
	currentPage = key;
	document.querySelectorAll('.page').forEach((el) => el.classList.toggle('active', el.id === `page-${key}`));
	document.querySelectorAll('.nav-item').forEach((el) => {
		const active = el.dataset.page === key;
		el.toggleAttribute('aria-current', active);
		if (active) el.setAttribute('aria-current', 'page');
	});
	refreshCurrentPage();
}

function refreshCurrentPage() {
	const page = PAGES[currentPage];
	const section = document.getElementById(`page-${currentPage}`);
	page.refresh(section);
}

/**
 * Compare the installed susfs binary against the published one and raise
 * a notice if there is something to decide.
 *
 * Never awaited by init(): it does up to two network round trips with
 * 5-10s timeouts, and the UI must not sit blank behind that. Stays silent
 * unless actionable - see describeBinaryStatus.
 */
async function runBinaryUpdateCheck() {
	const result = await checkBinaryUpdate();
	const notice = describeBinaryStatus(result, { silentWhenIdle: true });
	if (!notice) return;
	setHomeNotice({
		...notice,
		onAction: async (btn) => {
			btn.disabled = true;
			btn.textContent = 'Installing…';
			const applied = await applyBinaryUpdate();
			toast(applied.detail || 'Done');
			setHomeNotice(applied.status === 'installed'
				? { kind: 'info', title: 'susfs binary updated', subtitle: 'Reboot for the boot scripts to use it.' }
				: { kind: 'warn', title: 'Update failed', subtitle: applied.detail });
		},
	});
}

async function init() {
	const config = await getConfig();
	// Load the interface language before anything renders. Safe and fast:
	// it reads a small manifest and the saved choice, and falls back to the
	// bundled English on any failure, so the UI never blocks or blanks.
	await initI18n();
	await applyTheme(config.webui_theme ?? 'system');
	await applyMonet((config.webui_monet ?? '1') === '1');
	// Absent from a config carried over from ksu_module_susfs, so default
	// to on - that is the behaviour this replaces.
	applyFullscreen((config.webui_fullscreen ?? '1') === '1');
	initKeyboardHandling();
	buildShell();
	goToPage('home');

	// Opt-in: the key defaults to 1 (skip) in config.sh.
	if ((config.disable_webui_bin_update ?? '1') !== '1') {
		runBinaryUpdateCheck();
	}
}

init();
