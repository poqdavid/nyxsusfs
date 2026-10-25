// WebUI tests: the built module/webroot in Chromium (Playwright) with a mock
// KernelSU manager.
//
//   node tests/webui/run.cjs [--update]
//
// The mock host behaves like the managers' WebView bridge:
//   exec   -> blocks the page (synchronous XHR) and calls back in a later task
//   spawn  -> runs asynchronously and emits stdout lines, 'exit', then 'error'
//             on a non-zero exit, each in its own task
// and runs every command for real with `sh -c` (NYX_SH=mksh for mksh). Paths
// the WebUI reads on a device (/data/adb, /proc/version, /proc/1/mountinfo,
// /storage) are moved into a temporary root seeded from module/ and
// tests/webui/fixtures, so nothing outside it is read or written and results
// don't depend on the machine.
//
// Checks:
//   functional  everything each page shows and writes, compared with
//               tests/webui/expected/functional.json (--update rewrites it)
//   behaviour   batching, queued saves, spawn fallbacks, caching, logs,
//               late palette (E1-E9)
//   insets      system-bar padding on KernelSU-style and KernelSU-Next-style
//               managers, with fullscreen on and off
//
// Needs `npm ci && npm run build` first. NYX_CHROMIUM=/path/to/chrome uses an
// existing Chromium instead of Playwright's own; NYX_DEBUG=1 logs every command.
'use strict';
const { chromium } = require('playwright');
const { execFile } = require('child_process');
const esbuild = require('esbuild');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const MODULE = path.join(REPO, 'module');
const WEBROOT = path.join(MODULE, 'webroot');
const FIXTURES = path.join(__dirname, 'fixtures');
const EXPECTED = path.join(__dirname, 'expected', 'functional.json');
const UPDATE = process.argv.includes('--update');
const SHELL = process.env.NYX_SH || 'sh';
const SHELL_COST = 80; // ms a manager spends opening a root shell
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(path.join(WEBROOT, 'js', 'app.js'))) {
	console.error('tests/webui: module/webroot/js/app.js not found - run `npm run build` first');
	process.exit(2);
}

// ---------------------------------------------------------------------------
// The device: a temporary root and the path mapping into it.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nyxsusfs-webui-'));
const DEVICE_PATHS = ['/data/adb/', '/proc/version', '/proc/1/mountinfo', '/storage/'];
const host = (p) => path.join(ROOT, p);
const PDIR = host('/data/adb/nyxsusfs');
const MODDIR = host('/data/adb/modules/nyxsusfs');
const LOGDIR = host('/data/adb/ksu/nyxsusfs/logs');
const toHost = (cmd) => DEVICE_PATHS.reduce((c, p) => c.split(p).join(ROOT + p), cmd);
const toDevice = (out) => out.split(ROOT).join('');

function resetDevice() {
	fs.rmSync(ROOT, { recursive: true, force: true });
	fs.cpSync(MODULE, MODDIR, { recursive: true, filter: (src) => !/\.sha256$/.test(src) });
	fs.copyFileSync(path.join(FIXTURES, 'bin-update.sh'), path.join(MODDIR, 'bin-update.sh'));
	fs.mkdirSync(PDIR, { recursive: true });
	for (const f of fs.readdirSync(MODULE)) {
		if (f === 'config.sh' || /\.(txt|json)$/.test(f)) fs.copyFileSync(path.join(MODULE, f), path.join(PDIR, f));
	}
	fs.mkdirSync(LOGDIR, { recursive: true });
	for (const f of ['susfs1.log', 'susfs.log']) fs.copyFileSync(path.join(FIXTURES, 'logs', f), path.join(LOGDIR, f));
	fs.cpSync(path.join(FIXTURES, 'bin'), host('/data/adb/ksu/bin'), { recursive: true });
	fs.cpSync(path.join(FIXTURES, 'proc'), host('/proc'), { recursive: true });
	fs.mkdirSync(host('/storage/emulated/0'), { recursive: true });
	fs.mkdirSync(host('/data/adb/nyxtest'), { recursive: true });
	setBinMode('uptodate');
}
const setBinMode = (m) => fs.writeFileSync(host('/data/adb/nyxtest/bin_mode'), m);
const readConfig = () => fs.readFileSync(`${PDIR}/config.sh`, 'utf8');
function setConfigKey(k, v) {
	fs.writeFileSync(`${PDIR}/config.sh`, readConfig().replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`));
}
const cfgVal = (k) => (readConfig().match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1];

// libsu-style result: output lines joined with \n (one trailing newline dropped).
function runSh(cmd) {
	return new Promise((resolve) => {
		execFile(SHELL, ['-c', `${toHost(cmd)}\nprintf '\\n__END__%s' $?`], {
			env: { ...process.env, PATH: `${host('/data/adb/ksu/bin')}:${process.env.PATH}`, NYX_TEST_ROOT: ROOT },
			maxBuffer: 1 << 26,
		}, (_e, stdout, stderr) => {
			if (process.env.NYX_DEBUG) console.error('[sh]', JSON.stringify(cmd).slice(0, 160), '->', JSON.stringify(stdout).slice(-80), JSON.stringify(stderr).slice(0, 200));
			const i = stdout.lastIndexOf('\n__END__');
			const strip = (s) => toDevice(s.endsWith('\n') ? s.slice(0, -1) : s);
			if (i < 0) return resolve({ errno: 1, stdout: '', stderr: strip(stderr) });
			resolve({ errno: Number(stdout.slice(i + 8)), stdout: strip(stdout.slice(0, i)), stderr: strip(stderr) });
		});
	});
}

// Module functions for the behaviour checks, bundled from webui/src.
const TEST_BUNDLE = esbuild.buildSync({
	stdin: { contents: "export * as bridge from './core/ksu-bridge'; export * as data from './susfs-data';", resolveDir: path.join(REPO, 'webui', 'src'), loader: 'ts' },
	bundle: true, format: 'esm', target: 'es2020', write: false, logLevel: 'silent',
}).outputFiles[0].text;

// ---------------------------------------------------------------------------
// The mock manager.
let inflight = 0;
let lastNet = Date.now();

function hostInit() {
	const n = (window.__nyx = { execs: 0, spawns: 0, toasts: [], last: performance.now(), pending: 0 });
	const syncPost = (p, body) => {
		const x = new XMLHttpRequest();
		x.open('POST', p, false);
		x.send(JSON.stringify(body));
		return JSON.parse(x.responseText);
	};
	const post = (fn) => { n.pending++; setTimeout(() => { n.pending--; n.last = performance.now(); fn(); }, 0); };
	window.ksu = {
		exec(cmd, opts, cb) {
			if (arguments.length !== 3) throw new Error(`Method not found: exec/${arguments.length}`);
			const r = syncPost('/__nyx_exec', { cmd });
			n.execs++; n.last = performance.now();
			post(() => { try { window[cb](r.errno, r.stdout, r.stderr); } catch (e) { console.error(e); } });
		},
		spawn(command, args, options, cb) {
			if (arguments.length !== 4) throw new Error(`Method not found: spawn/${arguments.length}`);
			syncPost('/__nyx_shell', {});
			n.spawns++; n.last = performance.now(); n.pending++;
			fetch('/__nyx_run', { method: 'POST', body: JSON.stringify({ cmd: command }) }).then((x) => x.json()).then((r) => {
				n.pending--;
				const q = [];
				for (const l of r.lines) q.push(() => { try { window[cb].stdout.emit('data', l); } catch (e) { console.error('emitData', e); } });
				for (const l of r.errLines) q.push(() => { try { window[cb].stderr.emit('data', l); } catch (e) { console.error('emitData', e); } });
				q.push(() => { try { window[cb].emit('exit', r.errno); } catch (e) { console.error(`emitExit error: ${e}`); } });
				if (r.errno !== 0) q.push(() => { try { const err = new Error(); err.exitCode = r.errno; err.message = r.stderr; window[cb].emit('error', err); } catch (e) { console.error('emitErr', e); } });
				for (const f of q) post(f);
			});
		},
		toast(m) { n.toasts.push(String(m)); },
		fullScreen(e) { if (arguments.length !== 1) throw new Error('arity'); },
		enableEdgeToEdge(e) { if (arguments.length !== 1) throw new Error('arity'); },
	};
}

async function serve(route, extra = {}) {
	const req = route.request();
	const p = new URL(req.url()).pathname;
	inflight++;
	try {
		if (extra[p]) return await extra[p](route);
		if (p === '/__nyx_exec') {
			const { cmd } = JSON.parse(req.postData());
			await sleep(SHELL_COST);
			return await route.fulfill({ contentType: 'application/json', body: JSON.stringify(await runSh(cmd)) });
		}
		if (p === '/__nyx_shell') {
			await sleep(SHELL_COST);
			return await route.fulfill({ contentType: 'application/json', body: '{}' });
		}
		if (p === '/__nyx_run') {
			const { cmd } = JSON.parse(req.postData());
			const r = await runSh(cmd);
			const lines = (s) => (s === '' ? [] : s.split('\n'));
			return await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ errno: r.errno, lines: lines(r.stdout), errLines: lines(r.stderr), stderr: r.stderr }) });
		}
		if (p === '/__nyxtest.js') return await route.fulfill({ contentType: 'text/javascript', body: TEST_BUNDLE });
		if (p === '/internal/insets.css') {
			return await route.fulfill({ contentType: 'text/css', body: ':root{--safe-area-inset-top:0px;--safe-area-inset-bottom:0px;--window-inset-top:var(--safe-area-inset-top,0px);--window-inset-bottom:var(--safe-area-inset-bottom,0px);}' });
		}
		if (p === '/internal/colors.css') {
			return await route.fulfill({ contentType: 'text/css', body: ':root{--primary:#00696e;--onPrimary:#ffffff;--primaryContainer:#6ff6fe;--onPrimaryContainer:#002022;}' });
		}
		if (p.startsWith('/internal/')) return await route.fulfill({ contentType: 'text/css', body: '' });
		const f = path.join(WEBROOT, p === '/' ? 'index.html' : p);
		if (!f.startsWith(WEBROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return await route.fulfill({ status: 404, body: '' });
		const ct = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html' }[path.extname(f)] || 'application/octet-stream';
		return await route.fulfill({ contentType: ct, body: fs.readFileSync(f) });
	} finally {
		inflight--;
		lastNet = Date.now();
	}
}

async function newPage(browser, variant = '') {
	const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
	const page = await ctx.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
	await page.addInitScript(hostInit);
	if (variant === 'nospawn') await page.addInitScript(() => { delete window.ksu.spawn; });
	if (variant === 'nobridge') await page.addInitScript(() => { delete window.ksu; });
	await page.route('https://mui.kernelsu.org/**', (route) => serve(route));
	return { ctx, page, errors };
}

async function settle(page, quiet = 400) {
	const start = Date.now();
	for (;;) {
		const s = await page.evaluate(() => ({ pending: window.__nyx.pending, idle: performance.now() - window.__nyx.last }));
		if (inflight === 0 && s.pending === 0 && s.idle > quiet && Date.now() - lastNet > quiet && Date.now() - start >= quiet) return;
		if (Date.now() - start > 30000) throw new Error('settle timeout');
		await sleep(50);
	}
}

const counters = (page) => page.evaluate(() => ({ execs: window.__nyx.execs, spawns: window.__nyx.spawns }));

// ---------------------------------------------------------------------------
// Functional snapshot: everything the pages show and write.
async function functional(browser) {
	resetDevice();
	let { page, errors, ctx } = await newPage(browser);
	const snap = {};
	const text = (sel) => page.evaluate((s) => document.querySelector(s)?.innerText ?? null, sel);
	const go = async (t) => { await page.click(`.nav-item[data-page="${t}"]`); await settle(page); };
	await page.goto('https://mui.kernelsu.org/index.html');
	await settle(page);
	snap.html = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, themeSource: document.documentElement.dataset.themeSource, fs: document.documentElement.dataset.fullscreen, monet: document.documentElement.dataset.monet ?? null, lang: document.documentElement.lang }));
	snap.nav = await text('#nav-bar');
	for (const t of ['home', 'paths', 'settings', 'logs', 'about']) {
		await go(t);
		snap[`page_${t}`] = await text(`#page-${t}`);
	}
	snap.markup = await page.evaluate(() => {
		const norm = (el) => el.outerHTML.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
		return [...document.querySelectorAll('.page, #nav-bar')].map(norm);
	});
	snap.settingsControls = await page.evaluate(() => [...document.querySelectorAll('#page-settings [data-key]')].map((el) => `${el.dataset.key}=${el.type === 'checkbox' ? el.checked : el.value}`));
	snap.aboutControls = await page.evaluate(() => ['theme', 'monet', 'fullscreen'].map((r) => { const el = document.querySelector(`#page-about [data-role="${r}"]`); return `${r}=${el.type === 'checkbox' ? `${el.checked}/${el.disabled}` : el.value}`; }));

	await go('home');
	snap.sheets = {};
	for (const c of ['sus_path', 'sus_mount', 'sus_map', 'try_umount']) {
		await page.click(`.stat-card[data-category="${c}"]`);
		await settle(page);
		snap.sheets[c] = { card: await text(`.stat-card[data-category="${c}"]`), sheet: await text('.sheet') };
		await page.click('.sheet [data-role="close"]');
		await settle(page);
	}

	await go('settings');
	await page.click('input[data-key="hide_gapps"]');
	await settle(page);
	snap.after_hide_gapps = cfgVal('hide_gapps');
	await page.selectOption('select[data-key="hide_cusrom"]', '3');
	await settle(page);
	snap.after_hide_cusrom = cfgVal('hide_cusrom');
	await page.fill('input[data-key="kernel_version"]', "5.10.999-it's");
	await page.locator('input[data-key="kernel_version"]').evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true })));
	await settle(page);
	snap.after_kernel_version = cfgVal('kernel_version');
	snap.config_after_settings = readConfig().split('\n').filter((l) => l.trim() && !l.startsWith('#')).join('\n');

	setBinMode('uptodate');
	await page.click('[data-action="bin_update_now"]');
	await settle(page);
	setBinMode('differs');
	await page.click('[data-action="bin_update_now"]');
	await page.waitForSelector('.dialog-scrim.open', { timeout: 15000 });
	snap.bin_dialog = await text('.dialog');
	await page.click('.dialog [data-role="cancel"]');
	await settle(page);
	snap.bin_button_after = await text('[data-action="bin_update_now"]');

	await go('paths');
	const card = (f) => `.path-card[data-file="${f}"]`;
	await page.click(`${card('sus_path.txt')} [data-role="toggle"]`);
	await settle(page);
	snap.editor_sus_path = await page.inputValue(`${card('sus_path.txt')} [data-role="editor"]`);
	await page.fill(`${card('sus_path.txt')} [data-role="editor"]`, `${snap.editor_sus_path}\n/data/test_nyx\n`);
	await page.click(`${card('sus_path.txt')} [data-role="save"]`);
	await settle(page);
	snap.disk_sus_path = fs.readFileSync(`${PDIR}/sus_path.txt`, 'utf8');
	snap.counts_after_save = await text('#page-paths [data-role="list"]');
	await page.fill(`${card('sus_path.txt')} [data-role="editor"]`, 'garbage');
	await page.click(`${card('sus_path.txt')} [data-role="revert"]`);
	await settle(page);
	snap.editor_after_revert = await page.inputValue(`${card('sus_path.txt')} [data-role="editor"]`);
	await page.click(`${card('sus_mount.txt')} [data-role="toggle"]`);
	await settle(page);
	await page.fill(`${card('sus_mount.txt')} [data-role="editor"]`, '/foo # comment\n/bar\n');
	snap.warn_sus_mount = await text(`${card('sus_mount.txt')} [data-role="warn"]`);
	await page.click(`${card('sus_mount.txt')} [data-role="toggle"]`);
	await settle(page);

	await go('logs');
	snap.logs_activity = await text('#page-logs');
	await page.click('#page-logs [data-log="kernel"]');
	await settle(page);
	snap.logs_kernel = await text('#page-logs');
	await page.click('#page-logs [data-log="activity"]');
	await settle(page);

	await go('about');
	await page.selectOption('#page-about [data-role="theme"]', 'dark');
	await settle(page);
	snap.theme_dark = { cfg: cfgVal('webui_theme'), theme: await page.evaluate(() => document.documentElement.dataset.theme), hint: await text('#page-about [data-role="theme-hint"]') };
	await page.selectOption('#page-about [data-role="theme"]', 'system');
	await settle(page);
	snap.theme_system = { cfg: cfgVal('webui_theme'), theme: await page.evaluate(() => document.documentElement.dataset.theme), hint: await text('#page-about [data-role="theme-hint"]') };
	await page.click('#page-about [data-role="monet"]');
	await settle(page, 1500);
	snap.monet = { cfg: cfgVal('webui_monet'), checked: await page.isChecked('#page-about [data-role="monet"]'), hint: await text('#page-about [data-role="monet-hint"]') };
	await page.click('#page-about [data-role="fullscreen"]');
	await settle(page);
	snap.fullscreen = { cfg: cfgVal('webui_fullscreen'), fs: await page.evaluate(() => document.documentElement.dataset.fullscreen) };

	for (const t of ['home', 'paths', 'settings', 'logs', 'about']) {
		await go(t);
		await page.click('#refresh-btn');
		await settle(page);
		snap[`refreshed_${t}`] = await text(`#page-${t}`);
	}
	snap.toasts = (await page.evaluate(() => window.__nyx.toasts)).slice().sort();

	await go('settings');
	await page.selectOption('[data-role="language-select"]', 'en');
	await settle(page);
	snap.settings_after_lang = await text('#page-settings');

	// On-open binary check: notice, Install, installed notice.
	setConfigKey('disable_webui_bin_update', '0');
	setBinMode('differs');
	const firstErrors = errors.slice();
	await ctx.close();
	({ page, errors, ctx } = await newPage(browser));
	await page.goto('https://mui.kernelsu.org/index.html');
	await page.waitForSelector('#page-home .notice-card', { timeout: 15000 });
	snap.notice = await text('#page-home [data-role="notice"]');
	await page.click('#page-home .notice-card__action');
	await page.waitForFunction(() => /updated|failed/i.test(document.querySelector('#page-home [data-role="notice"]')?.innerText || ''), null, { timeout: 15000 });
	await settle(page);
	snap.notice_after = await text('#page-home [data-role="notice"]');
	snap.toasts2 = await page.evaluate(() => window.__nyx.toasts);
	snap.home_with_notice = await text('#page-home');
	await ctx.close();
	return { snap: normalize(snap), errors: [...firstErrors, ...errors] };
}

// Whitespace in rendered text varies a little between Chromium releases.
function normalize(v) {
	if (typeof v === 'string') return v.replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim();
	if (Array.isArray(v)) return v.map(normalize);
	if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]));
	return v;
}

function diffValue(a, b) {
	const x = (typeof a === 'string' ? a : JSON.stringify(a, null, 1) ?? 'undefined').split('\n');
	const y = (typeof b === 'string' ? b : JSON.stringify(b, null, 1) ?? 'undefined').split('\n');
	const out = [];
	for (let i = 0; i < Math.max(x.length, y.length) && out.length < 16; i++) {
		if (x[i] !== y[i]) out.push(`      line ${i + 1}: expected ${JSON.stringify(x[i])}`, `              got      ${JSON.stringify(y[i])}`);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Behaviour checks.
async function behaviour(browser, check) {
	const open = async (variant) => {
		const p = await newPage(browser, variant);
		await p.page.goto('https://mui.kernelsu.org/index.html');
		await settle(p.page);
		return p;
	};

	// E1: execBatch gives each command exactly what a separate exec() would.
	{
		resetDevice();
		const { page, errors, ctx } = await open();
		const cmds = {
			empty: 'true',
			nonl: "printf 'abc'",
			nl: "printf 'abc\\n'",
			twonl: "printf 'abc\\n\\n'",
			multi: "printf 'a\\nb\\n\\nc\\n'",
			fail: 'echo out; exit 3',
			stderr: 'echo visible; echo hidden >&2',
			tagish: "echo '__NYX_fake_B0'; echo 'E0:9'",
			casey: 'n=yes\ncase "$n" in\n  *yes*) echo dark ;;\n  *) echo light ;;\nesac',
			spaces: "printf '  padded  \\n'",
			unicode: "printf 'ö — ✓\\n'",
			after: 'echo still-here',
		};
		const r = await page.evaluate(async (cmds) => {
			const { bridge } = await import('/__nyxtest.js');
			const batch = await bridge.execBatch(cmds);
			const single = {};
			for (const [k, c] of Object.entries(cmds)) {
				const x = await bridge.exec(`( ${c}\n) 2>/dev/null`);
				single[k] = { errno: x.errno, stdout: x.stdout };
			}
			return { batch, single };
		}, cmds);
		for (const k of Object.keys(cmds)) {
			const b = r.batch[k];
			const s = r.single[k];
			check(`E1 execBatch[${k}]`, b.errno === s.errno && b.stdout === s.stdout, `batch=${JSON.stringify(b)} single=${JSON.stringify(s)}`);
		}
		check('E1 no console errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E2: quick toggles queued in one task all land in config.sh.
	{
		resetDevice();
		const { page, errors, ctx } = await open();
		await page.click('.nav-item[data-page="settings"]');
		await settle(page);
		const before = { r: cfgVal('hide_revanced'), l: cfgVal('hide_loops'), g: cfgVal('hide_gapps') };
		await page.evaluate(() => ['hide_revanced', 'hide_loops', 'hide_gapps'].forEach((k) => document.querySelector(`input[data-key="${k}"]`).click()));
		await settle(page);
		const after = { r: cfgVal('hide_revanced'), l: cfgVal('hide_loops'), g: cfgVal('hide_gapps') };
		const flipped = (a, b) => (a === '1' ? '0' : '1') === b;
		check('E2 rapid toggles all saved', flipped(before.r, after.r) && flipped(before.l, after.l) && flipped(before.g, after.g), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
		check('E2 no console errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E3: a manager without spawn: the binary check falls back to exec.
	{
		resetDevice();
		const { page, errors, ctx } = await open('nospawn');
		await page.click('.nav-item[data-page="settings"]');
		await settle(page);
		const a = await counters(page);
		await page.click('[data-action="bin_update_now"]');
		await settle(page);
		const b = await counters(page);
		const toasts = await page.evaluate(() => window.__nyx.toasts);
		check('E3 no-spawn fallback uses exec', b.execs - a.execs === 1 && b.spawns === a.spawns, `exec+${b.execs - a.execs} spawn+${b.spawns - a.spawns}`);
		check('E3 no-spawn result reported', toasts.some((t) => /up to date/.test(t)), JSON.stringify(toasts));
		check('E3 no console errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E4: spawn with a non-zero exit: result shape, and the trailing 'error' event is absorbed.
	{
		resetDevice();
		const { page, errors, ctx } = await open();
		const r = await page.evaluate(async () => (await import('/__nyxtest.js')).bridge.execAsync("sh -c 'echo one; echo two; echo bad >&2; exit 3'"));
		await settle(page);
		check('E4 execAsync non-zero exit', r.errno === 3 && r.stdout === 'one\ntwo' && r.stderr === 'bad', JSON.stringify(r));
		const r2 = await page.evaluate(async () => (await import('/__nyxtest.js')).bridge.execAsync('true'));
		check('E4 execAsync empty output', r2.errno === 0 && r2.stdout === '' && r2.stderr === '', JSON.stringify(r2));
		await settle(page, 600);
		check('E4 no console errors (error event after exit)', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E5: no bridge at all (desktop preview) still renders.
	{
		resetDevice();
		const { page, errors, ctx } = await open('nobridge');
		const status = await page.evaluate(() => document.querySelector('#page-home .status-card__title')?.textContent);
		const tabs = await page.evaluate(() => document.querySelectorAll('.nav-item').length);
		check('E5 preview mode renders', status === 'SuSFS not detected' && tabs === 5, `status=${status} tabs=${tabs}`);
		check('E5 no page errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E6: language change -> pages re-read on the next visit; double refresh = one read.
	{
		resetDevice();
		const { page, errors, ctx } = await open();
		const homeText = await page.evaluate(() => document.querySelector('#page-home').innerText);
		await page.click('.nav-item[data-page="settings"]');
		await settle(page);
		await page.selectOption('[data-role="language-select"]', 'en');
		await settle(page);
		let a = await counters(page);
		await page.click('.nav-item[data-page="home"]');
		await settle(page);
		let b = await counters(page);
		check('E6 home re-read after language change', b.execs - a.execs === 1, `exec+${b.execs - a.execs}`);
		check('E6 home unchanged after re-read', homeText === await page.evaluate(() => document.querySelector('#page-home').innerText));
		a = await counters(page);
		await page.click('.nav-item[data-page="settings"]');
		await page.click('.nav-item[data-page="home"]');
		await settle(page);
		b = await counters(page);
		check('E6 revisit costs nothing', b.execs - a.execs === 0, `exec+${b.execs - a.execs}`);
		a = await counters(page);
		await page.evaluate(() => { const btn = document.getElementById('refresh-btn'); btn.click(); btn.click(); });
		const spinning = await page.evaluate(() => document.getElementById('refresh-btn').classList.contains('is-busy'));
		await settle(page);
		b = await counters(page);
		const stillSpinning = await page.evaluate(() => document.getElementById('refresh-btn').classList.contains('is-busy'));
		check('E6 double refresh = one read', b.execs - a.execs === 1, `exec+${b.execs - a.execs}`);
		check('E6 refresh icon spins then stops', spinning && !stillSpinning, `during=${spinning} after=${stillSpinning}`);
		check('E6 no console errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E7: each stat sheet equals a fresh per-category read.
	{
		resetDevice();
		const { page, errors, ctx } = await open();
		for (const c of ['sus_path', 'sus_mount', 'sus_map', 'try_umount']) {
			await page.click(`.stat-card[data-category="${c}"]`);
			await settle(page);
			const shown = await page.evaluate(() => document.querySelector('.sheet [data-role="body"]').innerText);
			const fresh = await page.evaluate(async (c) => (await import('/__nyxtest.js')).data.getCategoryDetail(c), c);
			const value = await page.evaluate((c) => document.querySelector(`.stat-card[data-category="${c}"] .stat-card__value`).textContent, c);
			const n = fresh.reduce((k, g) => k + g.items.length, 0);
			const allShown = fresh.every((g) => g.items.every((i) => shown.includes(i)));
			check(`E7 sheet ${c} matches fresh read`, allShown && String(n) === value && n > 0, `card=${value} fresh=${n}`);
			await page.click('.sheet [data-role="close"]');
			await settle(page);
		}
		check('E7 no console errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E8: Logs tab with the Activity / Kernel switch.
	{
		resetDevice();
		const { page, errors, ctx } = await open();
		const view = (k) => page.evaluate((k) => {
			const el = document.querySelector(`#page-logs [data-role="log-${k}"]`);
			const note = document.querySelector(`#page-logs [data-role="note-${k}"]`);
			const text = el.classList.contains('is-empty') ? el.textContent : [...el.children].map((c) => c.textContent).join('\n');
			return { text, empty: el.classList.contains('is-empty'), note: note.hidden ? null : note.textContent, atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 1, scrolls: el.scrollHeight > el.clientHeight };
		}, k);
		const startup = await counters(page);
		check('E8 startup is one read', startup.execs === 1, `exec=${startup.execs}`);
		let a = await counters(page);
		await page.click('.nav-item[data-page="logs"]');
		await settle(page);
		let b = await counters(page);
		check('E8 first visit = one read', b.execs - a.execs === 1, `exec+${b.execs - a.execs}`);
		const act = await view('activity');
		const ker = await view('kernel');
		check('E8 activity = susfs1.log', act.text === fs.readFileSync(`${LOGDIR}/susfs1.log`, 'utf8').trim() && !act.empty && act.note === null);
		check('E8 kernel = susfs.log', ker.text === fs.readFileSync(`${LOGDIR}/susfs.log`, 'utf8').trim() && !ker.empty && ker.note === null);
		a = await counters(page);
		await page.click('.nav-item[data-page="home"]');
		await page.click('.nav-item[data-page="logs"]');
		await settle(page);
		b = await counters(page);
		check('E8 revisit costs nothing', b.execs - a.execs === 0, `exec+${b.execs - a.execs}`);
		const tabs = () => page.evaluate(() => ({
			selected: [...document.querySelectorAll('#page-logs [role="tab"]')].filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.dataset.log),
			visible: [...document.querySelectorAll('#page-logs [role="tabpanel"]')].filter((p) => !p.hidden).map((p) => p.dataset.panel),
			footnote: document.querySelector('#page-logs [role="tabpanel"]:not([hidden]) .page-footnote')?.innerText,
		}));
		let st = await tabs();
		check('E8 Activity shown by default', st.selected.join() === 'activity' && st.visible.join() === 'activity' && /susfs1\.log/.test(st.footnote), JSON.stringify(st));
		a = await counters(page);
		await page.click('#page-logs [data-log="kernel"]');
		await settle(page);
		b = await counters(page);
		st = await tabs();
		check('E8 switching to Kernel costs nothing', b.execs - a.execs === 0, `exec+${b.execs - a.execs}`);
		check('E8 Kernel tab shows only the kernel log', st.selected.join() === 'kernel' && st.visible.join() === 'kernel' && /susfs\.log/.test(st.footnote) && !/susfs1\.log/.test(st.footnote), JSON.stringify(st));
		await page.click('.nav-item[data-page="home"]');
		await page.click('.nav-item[data-page="logs"]');
		await page.click('#refresh-btn');
		await settle(page);
		st = await tabs();
		check('E8 chosen log survives leaving the page and refresh', st.selected.join() === 'kernel' && st.visible.join() === 'kernel', JSON.stringify(st));
		fs.writeFileSync(`${LOGDIR}/susfs.log`, Array.from({ length: 1200 }, (_, i) => `[ ${i}.000000] susfs: kernel line-${i + 1}`).join('\n') + '\n');
		fs.writeFileSync(`${LOGDIR}/susfs1.log`, Array.from({ length: 1500 }, (_, i) => `[sus_path]: nyxsusfs/boot-completed /data/app/line-${i + 1}`).join('\n') + '\n');
		await page.click('#refresh-btn');
		await settle(page);
		const kbig = await view('kernel');
		check('E8 long kernel log at newest', kbig.scrolls && kbig.atBottom && kbig.note === 'Showing the last 1000 of 1200 lines.', JSON.stringify({ scrolls: kbig.scrolls, atBottom: kbig.atBottom, note: kbig.note }));
		await page.click('#page-logs [data-log="activity"]');
		await settle(page);
		const big = await view('activity');
		const lines = big.text.split('\n');
		check('E8 long log tail', lines.length === 1000 && lines[0].endsWith('line-501') && lines[999].endsWith('line-1500'), `${lines.length} lines, first=${lines[0]}`);
		check('E8 long log note', big.note === 'Showing the last 1000 of 1500 lines.', String(big.note));
		check('E8 long log scrolled to newest', big.scrolls && big.atBottom, JSON.stringify({ scrolls: big.scrolls, atBottom: big.atBottom }));
		fs.rmSync(`${LOGDIR}/susfs1.log`, { force: true });
		fs.rmSync(`${LOGDIR}/susfs.log`, { force: true });
		await page.click('#refresh-btn');
		await settle(page);
		const ea = await view('activity');
		const ek = await view('kernel');
		check('E8 empty activity', ea.empty && ea.text === 'Nothing logged this boot yet.' && ea.note === null, JSON.stringify(ea));
		check('E8 empty kernel', ek.empty && ek.text === 'No SuSFS kernel messages captured this boot.' && ek.note === null, JSON.stringify(ek));
		check('E8 no console errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E9: a palette that turns up late is picked up without holding the first render.
	{
		resetDevice();
		setConfigKey('webui_monet', '1');
		const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
		const page = await ctx.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
		page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
		await page.addInitScript(hostInit);
		await page.route('https://mui.kernelsu.org/**', (route) => serve(route, {
			'/internal/colors.css': async (r) => { await sleep(600); await r.fulfill({ contentType: 'text/css', body: ':root{--primary:#00696e;}' }); },
		}));
		await page.goto('https://mui.kernelsu.org/index.html');
		await settle(page, 1800);
		const st = await page.evaluate(() => ({ monet: document.documentElement.dataset.monet ?? null, sw: document.querySelector('#page-about [data-role="monet"]').checked }));
		check('E9 late palette applied', st.monet === 'on' && st.sw === true, JSON.stringify(st));
		check('E9 no console errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}
}

// ---------------------------------------------------------------------------
// Insets. Two manager models:
//   ksu  - KernelSU / SukiSU-Ultra / ReSukiSU: insets.css turns edge-to-edge
//          on; fullScreen(e) hides/shows the bars and sets edge-to-edge = e;
//          while edge-to-edge is on the manager pushes the system-bar insets
//          into documentElement.style, and the host pads while it's off.
//   ksun - KernelSU-Next: insets.css turns edge-to-edge on and serves the real
//          values; fullScreen only hides/shows the bars.
// Host padding + page padding must equal the visible system bars.
const BARS = { top: 24, bottom: 48 };

function insetsHostInit([model, real, effectDelay]) {
	const h = (window.__host = { model, insetsEnabled: false, barsHidden: false, current: { top: 0, bottom: 0 }, calls: [] });
	const push = (v) => {
		const s = document.documentElement.style;
		s.setProperty('--safe-area-inset-top', `${v.top}px`);
		s.setProperty('--safe-area-inset-right', '0px');
		s.setProperty('--safe-area-inset-bottom', `${v.bottom}px`);
		s.setProperty('--safe-area-inset-left', '0px');
	};
	const effect = () => {
		if (model !== 'ksu' || !h.insetsEnabled) return;
		const v = h.barsHidden ? { top: 0, bottom: 0 } : real;
		if (v.top !== h.current.top || v.bottom !== h.current.bottom) {
			h.current = { ...v };
			push(v);
		}
	};
	const schedule = () => setTimeout(effect, 16);
	h.insetsEnabled = true; // insets.css requested from <head>
	setTimeout(effect, effectDelay);
	h.hostPad = () => (h.insetsEnabled || h.barsHidden ? { top: 0, bottom: 0 } : { ...real });
	const arity = (name, n, args) => {
		if (args.length !== n) throw new Error(`Method not found: ${name}/${args.length}`);
	};
	window.ksu = {
		exec(cmd, opts, cb) {
			window.__nyxExec(cmd).then((r) => window[cb](r.errno, r.stdout, r.stderr));
		},
		toast() {},
		fullScreen(e) {
			arity('fullScreen', 1, arguments);
			h.calls.push(`fullScreen:${e}`);
			setTimeout(() => { h.barsHidden = e; schedule(); }, 0);
			if (model === 'ksu') { h.insetsEnabled = e; schedule(); }
		},
	};
	if (model === 'ksu') {
		window.ksu.enableEdgeToEdge = function (e) {
			arity('enableEdgeToEdge', 1, arguments);
			h.calls.push(`enableEdgeToEdge:${e}`);
			h.insetsEnabled = e;
			schedule();
		};
		window.ksu.enableInsets = window.ksu.enableEdgeToEdge;
	} else {
		window.ksu.enableInsets = function (e) {
			arity('enableInsets', 1, arguments);
			h.calls.push(`enableInsets:${e}`);
			h.insetsEnabled = e;
		};
	}
}

function insetsMeasure() {
	const cs = getComputedStyle;
	const top = parseFloat(cs(document.querySelector('.top-bar')).paddingTop);
	const bottom = parseFloat(cs(document.querySelector('main')).paddingBottom) - 96;
	const hostPad = window.__host.hostPad();
	return { fs: document.documentElement.dataset.fullscreen, barsHidden: window.__host.barsHidden, total: { top: top + hostPad.top, bottom: bottom + hostPad.bottom } };
}

async function insets(browser, check) {
	const insetsCss = (t, b) => `:root{--safe-area-inset-top:${t}px;--safe-area-inset-right:0px;--safe-area-inset-bottom:${b}px;--safe-area-inset-left:0px;--window-inset-top:var(--safe-area-inset-top,0px);--window-inset-bottom:var(--safe-area-inset-bottom,0px);--window-inset-left:var(--safe-area-inset-left,0px);--window-inset-right:var(--safe-area-inset-right,0px);}`;
	for (const model of ['ksu', 'ksun']) {
		for (const effectDelay of [16, 1500]) {
			for (const start of ['0', '1']) {
				resetDevice();
				setConfigKey('webui_fullscreen', start);
				const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
				const page = await ctx.newPage();
				const errors = [];
				page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
				page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
				await page.exposeFunction('__nyxExec', runSh);
				await page.addInitScript(insetsHostInit, [model, BARS, effectDelay]);
				await page.route('https://mui.kernelsu.org/**', (route) => serve(route, {
					'/internal/insets.css': (r) => {
						const v = model === 'ksun' ? BARS : { top: 0, bottom: 0 };
						return r.fulfill({ contentType: 'text/css', body: insetsCss(v.top, v.bottom) });
					},
				}));
				await page.goto('https://mui.kernelsu.org/index.html');
				await page.waitForSelector('.nav-item');
				await page.waitForTimeout(effectDelay + 800);
				const steps = [['load', await page.evaluate(insetsMeasure)]];
				await page.click('.nav-item[data-page="about"]');
				const sw = page.locator('[data-role="fullscreen"]');
				for (let i = 0; i < 2; i++) {
					await sw.evaluate((el) => el.click());
					await page.waitForTimeout(400);
					const m = await page.evaluate(insetsMeasure);
					m.cfg = cfgVal('webui_fullscreen');
					steps.push([`toggle${i + 1}`, m]);
				}
				for (const [name, m] of steps) {
					const want = m.barsHidden ? { top: 0, bottom: 0 } : BARS;
					const ok = m.total.top === want.top && m.total.bottom === want.bottom && m.fs === (m.barsHidden ? 'on' : 'off')
						&& (m.cfg === undefined || m.cfg === (m.fs === 'on' ? '1' : '0'));
					check(`insets ${model} delay=${effectDelay} fullscreen=${start} ${name}`, ok, `fs=${m.fs} padding=${m.total.top}/${m.total.bottom} want=${want.top}/${want.bottom}${m.cfg ? ` cfg=${m.cfg}` : ''}`);
				}
				check(`insets ${model} delay=${effectDelay} fullscreen=${start} no console errors`, errors.length === 0, errors.join(' | '));
				await ctx.close();
			}
		}
	}
}

// ---------------------------------------------------------------------------
async function main() {
	const browser = await chromium.launch(process.env.NYX_CHROMIUM ? { executablePath: process.env.NYX_CHROMIUM } : {});
	const results = [];
	const check = (name, ok, detail = '') => results.push({ name, ok, detail });
	try {
		const { snap, errors } = await functional(browser);
		check('functional: no console errors', errors.length === 0, errors.join(' | '));
		if (UPDATE) {
			fs.mkdirSync(path.dirname(EXPECTED), { recursive: true });
			fs.writeFileSync(EXPECTED, JSON.stringify(snap, null, 1) + '\n');
			console.log(`wrote ${path.relative(REPO, EXPECTED)} (${Object.keys(snap).length} keys)`);
		} else if (!fs.existsSync(EXPECTED)) {
			check('functional: expected file', false, `${path.relative(REPO, EXPECTED)} missing (run with --update)`);
		} else {
			const want = JSON.parse(fs.readFileSync(EXPECTED, 'utf8'));
			for (const k of [...new Set([...Object.keys(want), ...Object.keys(snap)])]) {
				const same = JSON.stringify(want[k]) === JSON.stringify(snap[k]);
				check(`functional: ${k}`, same, same ? '' : `\n${diffValue(want[k], snap[k]).join('\n')}`);
			}
		}
		await behaviour(browser, check);
		await insets(browser, check);
	} finally {
		await browser.close();
		fs.rmSync(ROOT, { recursive: true, force: true });
	}
	const failed = results.filter((r) => !r.ok);
	for (const r of results) if (!r.ok || process.env.VERBOSE) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok || !r.detail ? '' : ` - ${r.detail}`}`);
	console.log(`== WebUI (sh=${SHELL}): ${results.length - failed.length}/${results.length} checks passed`);
	process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); fs.rmSync(ROOT, { recursive: true, force: true }); process.exit(2); });
