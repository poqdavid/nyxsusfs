import { exec, execBatch } from './ksu-bridge.js';

// Nyx's own directories - separate from ksu_module_susfs's
// /data/adb/susfs4ksu, so the two modules never contend over the same
// config.sh or logs if both happen to be installed. customize.sh imports
// an existing ksu_module_susfs config into this directory once, at
// install time, then Nyx only ever touches its own copy after that.
export const MOD_DIR = '/data/adb/modules/nyxsusfs';
export const PERSISTENT_DIR = '/data/adb/nyxsusfs';
export const TMP_DIR = '/data/adb/ksu/nyxsusfs';
export const CONFIG_PATH = `${PERSISTENT_DIR}/config.sh`;
export const STATS_PATH = `${TMP_DIR}/susfs_stats.txt`;
export const LOG1_PATH = `${TMP_DIR}/logs/susfs1.log`;
export const LOG_PATH = `${TMP_DIR}/logs/susfs.log`;
export const SUSFS_BIN = '/data/adb/ksu/bin/ksu_susfs';

// Every read below is a command table plus a parser, so the same parsing
// serves both a single page's refresh and the one batched read the WebUI
// does at startup (see ksu-bridge.js for why the number of exec() calls is
// what matters). Tables are merged under a prefix and split back apart.
function withPrefix(prefix, commands) {
	const out = {};
	for (const [key, cmd] of Object.entries(commands)) out[`${prefix}${key}`] = cmd;
	return out;
}
function takePrefix(prefix, results) {
	const out = {};
	for (const [key, r] of Object.entries(results)) {
		if (key.startsWith(prefix)) out[key.slice(prefix.length)] = r;
	}
	return out;
}

// Each home-screen stat is counted from a specific set of sources in
// boot-completed.sh. The drill-down list has to read the SAME sources or
// the number and the list disagree - e.g. sus_mount is counted from the
// kernel log plus /proc/1/mountinfo, so listing only the userspace tags
// showed "nothing recorded" next to a non-zero count.
//
// userspace : actions this module took, tagged into susfs1.log
// kernel    : lines susfs itself printed, captured from dmesg into susfs.log
// mountinfo : live mounts matching the same pattern the counter uses
const CATEGORY_SOURCES = {
	sus_path: {
		userspace: '^\\[sus_path\\]:|^\\[sus_path_loop\\]:',
	},
	sus_mount: {
		userspace: '^\\[sus_mount\\]:',
		kernel: 'set SUS_MOUNT|to LH_SUS_MOUNT',
		mountinfo: true,
	},
	sus_map: {
		userspace: '^\\[sus_map\\]:',
		kernel: 'AS_FLAGS_SUS_MAP',
	},
	try_umount: {
		userspace: '^\\[try_umount',
		kernel: 'to LH_TRY_UMOUNT_PATH',
	},
};
const CATEGORIES = Object.keys(CATEGORY_SOURCES);

// Strip the leading "[tag]: source " so the entry is just the path. Kept
// as a sub-expression rather than $NF because some Android paths contain
// spaces and would be truncated by whitespace splitting.
const STRIP_TAG = `awk '{ line=$0; sub(/^[^ \\t]+[ \\t]+[^ \\t]+[ \\t]+/, "", line); print line }'`;
// Drop the "[   12.345678] " kernel timestamp so lines are readable.
const STRIP_TIMESTAMP = `sed 's/^\\[[[:space:]]*[0-9.]*\\][[:space:]]*//'`;

/** Non-empty trimmed lines of a successful command, else []. */
function linesOf({ errno, stdout }) {
	if (errno !== 0) return [];
	return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

function categoryCommands(category) {
	const src = CATEGORY_SOURCES[category];
	const cmds = {};
	if (!src) return cmds;
	if (src.userspace) {
		cmds.userspace = `grep -E '${src.userspace}' '${LOG1_PATH}' 2>/dev/null | ${STRIP_TAG} | sort -u`;
	}
	if (src.kernel) {
		cmds.kernel = `grep -iE '${src.kernel}' '${LOG_PATH}' 2>/dev/null | ${STRIP_TIMESTAMP} | sort -u`;
	}
	if (src.mountinfo) {
		// Same pattern boot-completed.sh counts with, so the two agree.
		cmds.mountinfo = `grep -E '^[25][0-9]{5,9} .* (KSU|shared).*$' /proc/1/mountinfo 2>/dev/null | awk '{print $5}' | sort -u`;
	}
	return cmds;
}

function parseCategory(results) {
	const groups = [];
	const add = (label, r) => {
		if (!r) return;
		const items = linesOf(r);
		if (items.length) groups.push({ label, items });
	};
	add('Added by NyxSUSFS', results.userspace);
	add('Reported by the kernel', results.kernel);
	add('Matching mounts in /proc/1/mountinfo', results.mountinfo);
	return groups;
}

function allCategoryCommands() {
	let cmds = {};
	for (const c of CATEGORIES) cmds = { ...cmds, ...withPrefix(`${c}.`, categoryCommands(c)) };
	return cmds;
}

function parseAllCategories(results) {
	const details = {};
	for (const c of CATEGORIES) details[c] = parseCategory(takePrefix(`${c}.`, results));
	return details;
}

/**
 * Per-category counts for the home "This boot" cards. Derived from EXACTLY
 * the sources getCategoryDetail shows, so a card's number always equals the
 * number of rows you see when you tap it - the two cannot drift apart.
 *
 * (They used to: the count came from a boot-time susfs_stats.txt grepped with
 * kernel-log patterns like AS_FLAGS_SUS_MAP, while the list greps Nyx's own
 * userspace [sus_*]: tags. On a kernel that doesn't emit those strings the
 * card read 0 while the list was full. Counting the detail rows removes the
 * second source entirely.)
 */
function statsFromDetails(details) {
	const stats = { sus_path: 0, sus_mount: 0, sus_map: 0, try_umount: 0 };
	for (const c of CATEGORIES) stats[c] = details[c].reduce((n, g) => n + g.items.length, 0);
	return stats;
}

/** Flat list of just this module's own tagged actions. */
export async function getCategoryEntries(category) {
	const src = CATEGORY_SOURCES[category];
	if (!src || !src.userspace) return [];
	const { userspace } = await execBatch({ userspace: categoryCommands(category).userspace });
	return linesOf(userspace);
}

/**
 * Grouped detail for a home-screen stat, covering every source that feeds
 * that stat's counter. Returns [{ label, items }].
 */
export async function getCategoryDetail(category) {
	if (!CATEGORY_SOURCES[category]) return [];
	return parseCategory(await execBatch(categoryCommands(category)));
}

export async function getStats() {
	return statsFromDetails(parseAllCategories(await execBatch(allCategoryCommands())));
}

const SUSFS_COMMANDS = {
	version: `${SUSFS_BIN} show version 2>/dev/null`,
	variant: `${SUSFS_BIN} show variant 2>/dev/null`,
	features: `${SUSFS_BIN} show enabled_features 2>/dev/null`,
};

function parseSusfsInfo({ version, variant, features }) {
	const featureList = features.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
	return {
		version: version.stdout.trim() || null,
		variant: variant.stdout.trim() || null,
		features: featureList,
		active: version.errno === 0 && version.stdout.trim().length > 0,
	};
}

export async function getSusfsInfo() {
	return parseSusfsInfo(await execBatch(SUSFS_COMMANDS));
}

// Reverses the POSIX single-quote escape ' -> '\'' that setConfigValue
// writes for text values, so a value that itself contained an apostrophe
// reads back exactly as typed instead of picking up escape artifacts.
function unescapeShellSingleQuoted(inner) {
	return inner.split("'\\''").join("'");
}

const CONFIG_COMMAND = `cat '${CONFIG_PATH}' 2>/dev/null`;

function parseConfig({ stdout, errno }) {
	const config = {};
	if (errno === 0) {
		for (const line of stdout.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const idx = trimmed.indexOf('=');
			if (idx < 0) continue;
			const key = trimmed.slice(0, idx);
			const raw = trimmed.slice(idx + 1);
			let value = raw;
			const singleQuoted = raw.match(/^'([\s\S]*)'$/);
			const doubleQuoted = raw.match(/^"([\s\S]*)"$/);
			if (singleQuoted) {
				value = unescapeShellSingleQuoted(singleQuoted[1]);
			} else if (doubleQuoted) {
				value = doubleQuoted[1];
			}
			config[key] = value;
		}
	}
	return config;
}

export async function getConfig() {
	return parseConfig(await exec(CONFIG_COMMAND));
}

/** Escapes a value for a POSIX single-quoted shell literal, matching how
 * the shipped config.sh quotes its text values. */
function toShellLiteral(value) {
	const str = String(value);
	if (/^-?\d+$/.test(str)) return str;
	return `'${str.replace(/'/g, "'\\''")}'`;
}

async function writeConfigValue(key, value) {
	const { stdout, errno } = await exec(CONFIG_COMMAND);
	if (errno !== 0) return { ok: false, error: 'could not read config.sh' };

	const literal = toShellLiteral(value);
	const lines = stdout.split('\n');
	let replaced = false;
	for (let i = 0; i < lines.length; i += 1) {
		if (lines[i].startsWith(`${key}=`)) {
			lines[i] = `${key}=${literal}`;
			replaced = true;
			break;
		}
	}
	if (!replaced) {
		// Keep the trailing newline tidy when appending a brand-new key.
		while (lines.length && lines[lines.length - 1] === '') lines.pop();
		lines.push(`${key}=${literal}`, '');
	}

	const b64 = btoa(unescape(encodeURIComponent(lines.join('\n'))));
	const write = await exec(`echo '${b64}' | base64 -d > '${CONFIG_PATH}'`);
	return { ok: write.errno === 0, error: write.stderr };
}

// Writes are chained so each one's read-modify-write finishes before the
// next starts. Two quick toggles used to be able to interleave (both read
// the old file, the second write dropping the first change).
let configWrites = Promise.resolve();

/**
 * Writes one key back into config.sh (updating it in place, or appending
 * it if it's not there yet). Boot-stage scripts re-read this file every
 * boot, so most changes need a reboot to take effect - the settings page
 * surfaces that per toggle.
 *
 * The edit is done here in JS and the whole file is written back through
 * the same base64 path setListFile uses, deliberately. Doing it with a
 * shell one-liner instead would mean depending on either exec()'s `env`
 * option (not guaranteed to be honoured by every manager build) or on
 * `awk -v`, which performs backslash-escape processing on the value it is
 * given. Round-tripping base64 depends on neither, and the value is never
 * re-parsed as shell syntax at any point.
 */
export function setConfigValue(key, value) {
	const run = configWrites.then(() => writeConfigValue(key, value));
	configWrites = run.catch(() => {});
	return run;
}

const MODULE_PROP_COMMAND = `cat '${MOD_DIR}/module.prop' 2>/dev/null`;

function parseModuleProp({ stdout, errno }) {
	const prop = {};
	if (errno === 0) {
		for (const line of stdout.split('\n')) {
			const idx = line.indexOf('=');
			if (idx > 0) prop[line.slice(0, idx)] = line.slice(idx + 1);
		}
	}
	return prop;
}

export async function getModuleProp() {
	return parseModuleProp(await exec(MODULE_PROP_COMMAND));
}

/** Raw contents of one of the editable path-list files under
 * PERSISTENT_DIR (sus_path.txt, sus_mount.txt, ...), for the Advanced
 * settings editors. */
export async function getListFile(filename) {
	const { stdout, errno } = await exec(`cat '${PERSISTENT_DIR}/${filename}' 2>/dev/null`);
	return errno === 0 ? stdout : '';
}

export async function setListFile(filename, contents) {
	// base64 round-trip avoids any quoting hazard from the file's own
	// content (paths, comments, whatever the user pastes in).
	const b64 = btoa(unescape(encodeURIComponent(contents)));
	const { errno, stderr } = await exec(`echo '${b64}' | base64 -d > '${PERSISTENT_DIR}/${filename}'`);
	return { ok: errno === 0, error: stderr };
}

function pathCountsCommand(files) {
	return files
		.filter((f) => /^[A-Za-z0-9._-]+$/.test(f))
		.map((f) => `printf '%s\\t%s\\n' '${f}' "$(grep -cE '^[[:space:]]*[^#[:space:]]' '${PERSISTENT_DIR}/${f}' 2>/dev/null || echo 0)"`)
		.join('\n');
}

function parsePathCounts({ stdout, errno }) {
	const out = {};
	if (errno !== 0) return out;
	for (const line of stdout.split('\n')) {
		const [file, count] = line.split('\t');
		if (file) out[file.trim()] = Number(count) || 0;
	}
	return out;
}

/**
 * Active (non-comment, non-blank) entry count for each path list.
 * @param {string[]} files
 * @returns {Promise<Record<string, number>>}
 */
export async function listPathFiles(files) {
	const cmd = pathCountsCommand(files);
	if (!cmd) return {};
	return parsePathCounts(await exec(cmd));
}

/**
 * Device identity for the home "Device" section. Values are read live via
 * getprop, so they reflect the CURRENT (spoofed, if any) values a detector
 * would see. Kernel is read two ways - /proc/version and uname -r - because
 * spoof_uname makes them differ, which is itself a useful signal.
 */
const DEVICE_COMMANDS = {
	rel: 'getprop ro.build.version.release 2>/dev/null',
	sdk: 'getprop ro.build.version.sdk 2>/dev/null',
	model: 'getprop ro.product.model 2>/dev/null',
	mfr: 'getprop ro.product.manufacturer 2>/dev/null',
	procK: "cat /proc/version 2>/dev/null | awk '{print $3}'",
	unameK: 'uname -r 2>/dev/null',
};

function parseDeviceInfo({ rel, sdk, model, mfr, procK, unameK }) {
	const t = (r) => (r.stdout || '').trim();
	const proc = t(procK);
	const un = t(unameK);
	return {
		model: [t(mfr), t(model)].filter(Boolean).join(' ') || null,
		android: t(rel) ? `${t(rel)}${t(sdk) ? ` (SDK ${t(sdk)})` : ''}` : null,
		procKernel: proc || null,
		unameKernel: un || null,
		unameSpoofed: !!(proc && un && proc !== un),
	};
}

export async function getDeviceInfo() {
	return parseDeviceInfo(await execBatch(DEVICE_COMMANDS));
}

/**
 * Live "is it working" checks for the home Verification section. Each item is
 * { key, value, ok } where ok===true is a pass, false a warning, and null is
 * informational (no verdict). Everything is a read-only getprop / test, so it
 * reflects the device's current reported state rather than what was toggled.
 *
 * The first item is a self-test of SuSFS's own path hiding: SuSFS redirects a
 * hidden path to a canary name (..5.u.S) that must NOT be reachable - if it is
 * reachable, sus_path hiding isn't taking effect. (Probe borrowed from BRENE.)
 * The prop rows (verified boot state, bootloader, dm-verity, security patch)
 * live in NyxProps.
 */
const VERIFY_COMMANDS = {
	canary: '[ -e /storage/emulated/0/..5.u.S ] && echo exposed || echo hidden',
	selinux: 'getenforce 2>/dev/null',
};

function parseVerification({ canary, selinux }) {
	const t = (r) => (r.stdout || '').trim();
	const c = t(canary);
	const se = t(selinux);
	return [
		{ key: 'path_hide', ok: c === 'hidden', value: c === 'hidden' ? 'ok' : 'bad' },
		{ key: 'selinux', ok: /enforc/i.test(se), value: se || '—' },
	];
}

export async function getVerification() {
	return parseVerification(await execBatch(VERIFY_COMMANDS));
}

// ---------------------------------------------------------------------------
// Whole-page reads, one exec each.

function homeCommands() {
	return {
		...withPrefix('susfs.', SUSFS_COMMANDS),
		...withPrefix('cat.', allCategoryCommands()),
		...withPrefix('verify.', VERIFY_COMMANDS),
		...withPrefix('device.', DEVICE_COMMANDS),
	};
}

function parseHome(results) {
	const details = parseAllCategories(takePrefix('cat.', results));
	return {
		info: parseSusfsInfo(takePrefix('susfs.', results)),
		details,
		stats: statsFromDetails(details),
		verify: parseVerification(takePrefix('verify.', results)),
		device: parseDeviceInfo(takePrefix('device.', results)),
	};
}

/** Everything the Home page shows, including each stat's drill-down rows. */
export async function getHomeData() {
	return parseHome(await execBatch(homeCommands()));
}

/** Everything the About page shows. */
export async function getAboutData() {
	const r = await execBatch({
		prop: MODULE_PROP_COMMAND,
		config: CONFIG_COMMAND,
		...withPrefix('susfs.', SUSFS_COMMANDS),
	});
	return { prop: parseModuleProp(r.prop), info: parseSusfsInfo(takePrefix('susfs.', r)), config: parseConfig(r.config) };
}

/**
 * The WebUI's whole startup read in ONE exec: config, every page's data,
 * and any `extra` commands a caller needs alongside (returned raw, e.g. the
 * system night-mode query theme.js parses).
 *
 * @param {string[]} pathFiles list files whose counts the Paths page shows
 * @param {Record<string,string>} [extra]
 */
export async function loadEverything(pathFiles, extra = {}) {
	const counts = pathCountsCommand(pathFiles);
	const r = await execBatch({
		config: CONFIG_COMMAND,
		prop: MODULE_PROP_COMMAND,
		...(counts ? { counts } : {}),
		...withPrefix('home.', homeCommands()),
		...withPrefix('extra.', extra),
	});
	const config = parseConfig(r.config);
	const home = parseHome(takePrefix('home.', r));
	return {
		config,
		home,
		about: { prop: parseModuleProp(r.prop), info: home.info, config },
		pathCounts: counts ? parsePathCounts(r.counts) : {},
		extra: takePrefix('extra.', r),
	};
}
