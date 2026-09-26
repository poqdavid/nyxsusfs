import { exec, execBatch, type ExecResult } from './core/ksu-bridge';
import type { SheetGroup } from './core/sheet';

export const MOD_DIR = '/data/adb/modules/nyxsusfs';
export const PERSISTENT_DIR = '/data/adb/nyxsusfs';
const TMP_DIR = '/data/adb/ksu/nyxsusfs';
const CONFIG_PATH = `${PERSISTENT_DIR}/config.sh`;
export const LOG1_PATH = `${TMP_DIR}/logs/susfs1.log`;
export const LOG_PATH = `${TMP_DIR}/logs/susfs.log`;
const SUSFS_BIN = '/data/adb/ksu/bin/ksu_susfs';

export type Config = Record<string, string>;

function withPrefix(prefix: string, commands: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, cmd] of Object.entries(commands)) out[`${prefix}${key}`] = cmd;
	return out;
}

function takePrefix<K extends string>(prefix: string, results: Record<string, ExecResult>): Record<K, ExecResult> {
	const out: Record<string, ExecResult> = {};
	for (const [key, r] of Object.entries(results)) {
		if (key.startsWith(prefix)) out[key.slice(prefix.length)] = r;
	}
	return out as Record<K, ExecResult>;
}

export type Category = 'sus_path' | 'sus_mount' | 'sus_map' | 'try_umount';
export const CATEGORIES: readonly Category[] = ['sus_path', 'sus_mount', 'sus_map', 'try_umount'];

type Source = 'userspace' | 'kernel' | 'mountinfo';

const CATEGORY_SOURCES: Record<Category, { userspace?: string; kernel?: string; mountinfo?: true }> = {
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

const STRIP_TAG = `awk '{ line=$0; sub(/^[^ \\t]+[ \\t]+[^ \\t]+[ \\t]+/, "", line); print line }'`;
const STRIP_TIMESTAMP = `sed 's/^\\[[[:space:]]*[0-9.]*\\][[:space:]]*//'`;

function linesOf({ errno, stdout }: ExecResult): string[] {
	if (errno !== 0) return [];
	return stdout
		.split('\n')
		.map((s) => s.trim())
		.filter(Boolean);
}

function categoryCommands(category: Category): Partial<Record<Source, string>> {
	const src = CATEGORY_SOURCES[category];
	const cmds: Partial<Record<Source, string>> = {};
	if (src.userspace) {
		cmds.userspace = `grep -E '${src.userspace}' '${LOG1_PATH}' 2>/dev/null | ${STRIP_TAG} | sort -u`;
	}
	if (src.kernel) {
		cmds.kernel = `grep -iE '${src.kernel}' '${LOG_PATH}' 2>/dev/null | ${STRIP_TIMESTAMP} | sort -u`;
	}
	if (src.mountinfo) {
		cmds.mountinfo = `grep -E '^[25][0-9]{5,9} .* (KSU|shared).*$' /proc/1/mountinfo 2>/dev/null | awk '{print $5}' | sort -u`;
	}
	return cmds;
}

function parseCategory(results: Partial<Record<Source, ExecResult>>): SheetGroup[] {
	const groups: SheetGroup[] = [];
	const add = (label: string, r: ExecResult | undefined) => {
		if (!r) return;
		const items = linesOf(r);
		if (items.length) groups.push({ label, items });
	};
	add('Added by NyxSUSFS', results.userspace);
	add('Reported by the kernel', results.kernel);
	add('Matching mounts in /proc/1/mountinfo', results.mountinfo);
	return groups;
}

function allCategoryCommands(): Record<string, string> {
	let cmds: Record<string, string> = {};
	for (const c of CATEGORIES) cmds = { ...cmds, ...withPrefix(`${c}.`, categoryCommands(c)) };
	return cmds;
}

export type Details = Record<Category, SheetGroup[]>;
export type Stats = Record<Category, number>;

function parseAllCategories(results: Record<string, ExecResult>): Details {
	const details = {} as Details;
	for (const c of CATEGORIES) details[c] = parseCategory(takePrefix<Source>(`${c}.`, results));
	return details;
}

function statsFromDetails(details: Details): Stats {
	const stats: Stats = { sus_path: 0, sus_mount: 0, sus_map: 0, try_umount: 0 };
	for (const c of CATEGORIES) stats[c] = details[c].reduce((n, g) => n + g.items.length, 0);
	return stats;
}

export async function getCategoryDetail(category: Category): Promise<SheetGroup[]> {
	return parseCategory(await execBatch(categoryCommands(category) as Record<Source, string>));
}

const SUSFS_COMMANDS = {
	version: `${SUSFS_BIN} show version 2>/dev/null`,
	variant: `${SUSFS_BIN} show variant 2>/dev/null`,
	features: `${SUSFS_BIN} show enabled_features 2>/dev/null`,
};

export interface SusfsInfo {
	version: string | null;
	variant: string | null;
	features: string[];
	active: boolean;
}

function okOutput({ errno, stdout }: ExecResult): string {
	return errno === 0 ? stdout.trim() : '';
}

function parseSusfsInfo({ version, variant, features }: Record<keyof typeof SUSFS_COMMANDS, ExecResult>): SusfsInfo {
	const versionText = okOutput(version);
	const featureList = okOutput(features)
		.split('\n')
		.map((s) => s.trim())
		.filter((s) => s.startsWith('CONFIG_KSU_SUSFS'));
	return {
		version: /^v?\d+\.\d+/.test(versionText) ? versionText : null,
		variant: okOutput(variant) || null,
		features: featureList,
		active: /^v?\d+\.\d+/.test(versionText),
	};
}

function unescapeShellSingleQuoted(inner: string): string {
	return inner.split("'\\''").join("'");
}

const CONFIG_COMMAND = `cat '${CONFIG_PATH}' 2>/dev/null`;

function parseConfig({ stdout, errno }: ExecResult): Config {
	const config: Config = {};
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
				value = unescapeShellSingleQuoted(singleQuoted[1] ?? '');
			} else if (doubleQuoted) {
				value = doubleQuoted[1] ?? '';
			}
			config[key] = value;
		}
	}
	return config;
}

export async function getConfig(): Promise<Config> {
	return parseConfig(await exec(CONFIG_COMMAND));
}

export const PRIORITY_LIST = 'priority_uid_filter.txt';

export const PRIORITY_COMMANDS = {
	priorityHelp: `'${SUSFS_BIN}' 2>&1 | grep -cE '^ +set_priority_uid_filter( |$)'`,
	priorityStatus: `cat '${TMP_DIR}/priority_uid_filter' 2>/dev/null`,
};

export interface PriorityState {
	supported: boolean;
	status: Record<string, string>;
}

function parseKeyValues(stdout: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of stdout.split('\n')) {
		const idx = line.indexOf('=');
		if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
	}
	return out;
}

export function parsePriorityState(r: Record<keyof typeof PRIORITY_COMMANDS, ExecResult>): PriorityState {
	return {
		supported: Number(r.priorityHelp.stdout.trim()) > 0,
		status: r.priorityStatus.errno === 0 ? parseKeyValues(r.priorityStatus.stdout) : {},
	};
}

export async function getSettingsData(): Promise<{ config: Config; priority: PriorityState }> {
	const r = await execBatch({ config: CONFIG_COMMAND, ...PRIORITY_COMMANDS });
	return { config: parseConfig(r.config), priority: parsePriorityState(r) };
}

export interface PriorityApps {
	installed: string[];
	chosen: string[];
	comments: string[];
}

export async function getPriorityApps(): Promise<PriorityApps> {
	const r = await execBatch({
		apps: 'pm list packages -3 2>/dev/null',
		list: `cat '${PERSISTENT_DIR}/${PRIORITY_LIST}' 2>/dev/null`,
	});
	const installed = linesOf(r.apps)
		.filter((l) => l.startsWith('package:'))
		.map((l) => l.slice('package:'.length).trim())
		.filter(Boolean);
	const lines = r.list.errno === 0 ? r.list.stdout.split('\n') : [];
	const chosen = lines.map((l) => l.trim().split(/\s+/)[0] ?? '').filter((p) => p && !p.startsWith('#'));
	return {
		installed: [...new Set(installed)].sort(),
		chosen: [...new Set(chosen)],
		comments: lines.filter((l) => l.trimStart().startsWith('#')),
	};
}

export function savePriorityApps(comments: readonly string[], chosen: readonly string[]): Promise<WriteResult> {
	return setListFile(PRIORITY_LIST, [...comments, ...chosen].join('\n') + '\n');
}

export async function applyPriorityFilter(): Promise<Record<string, string>> {
	const { stdout } = await exec(`'${MOD_DIR}/bin/nyxsusfs' priority-filter 2>/dev/null`);
	return parseKeyValues(stdout);
}

function toShellLiteral(value: string): string {
	const str = String(value);
	if (/^-?\d+$/.test(str)) return str;
	return `'${str.replace(/'/g, "'\\''")}'`;
}

export interface WriteResult {
	ok: boolean;
	error: string;
}

function toBase64(text: string): string {
	return btoa(unescape(encodeURIComponent(text)));
}

async function writeConfigValue(key: string, value: string): Promise<WriteResult> {
	const { stdout, errno } = await exec(CONFIG_COMMAND);
	if (errno !== 0) return { ok: false, error: 'could not read config.sh' };

	const literal = toShellLiteral(value);
	const lines = stdout.split('\n');
	let replaced = false;
	for (let i = 0; i < lines.length; i += 1) {
		if (lines[i]?.startsWith(`${key}=`)) {
			lines[i] = `${key}=${literal}`;
			replaced = true;
			break;
		}
	}
	if (!replaced) {
		while (lines.length && lines[lines.length - 1] === '') lines.pop();
		lines.push(`${key}=${literal}`, '');
	}

	const write = await exec(`echo '${toBase64(lines.join('\n'))}' | base64 -d > '${CONFIG_PATH}'`);
	return { ok: write.errno === 0, error: write.stderr };
}

let configWrites: Promise<unknown> = Promise.resolve();

export function setConfigValue(key: string, value: string): Promise<WriteResult> {
	const run = configWrites.then(() => writeConfigValue(key, value));
	configWrites = run.catch(() => {});
	return run;
}

const MODULE_PROP_COMMAND = `cat '${MOD_DIR}/module.prop' 2>/dev/null`;

function parseModuleProp({ stdout, errno }: ExecResult): Record<string, string> {
	const prop: Record<string, string> = {};
	if (errno === 0) {
		for (const line of stdout.split('\n')) {
			const idx = line.indexOf('=');
			if (idx > 0) prop[line.slice(0, idx)] = line.slice(idx + 1);
		}
	}
	return prop;
}

export async function getListFile(filename: string): Promise<string> {
	const { stdout, errno } = await exec(`cat '${PERSISTENT_DIR}/${filename}' 2>/dev/null`);
	return errno === 0 ? stdout : '';
}

export async function setListFile(filename: string, contents: string): Promise<WriteResult> {
	const { errno, stderr } = await exec(`echo '${toBase64(contents)}' | base64 -d > '${PERSISTENT_DIR}/${filename}'`);
	return { ok: errno === 0, error: stderr };
}

function pathCountsCommand(files: readonly string[]): string {
	return files
		.filter((f) => /^[A-Za-z0-9._-]+$/.test(f))
		.map((f) => `printf '%s\\t%s\\n' '${f}' "$(grep -cE '^[[:space:]]*[^#[:space:]]' '${PERSISTENT_DIR}/${f}' 2>/dev/null || echo 0)"`)
		.join('\n');
}

function parsePathCounts({ stdout, errno }: ExecResult): Record<string, number> {
	const out: Record<string, number> = {};
	if (errno !== 0) return out;
	for (const line of stdout.split('\n')) {
		const [file, count] = line.split('\t');
		if (file) out[file.trim()] = Number(count) || 0;
	}
	return out;
}

export async function listPathFiles(files: readonly string[]): Promise<Record<string, number>> {
	const cmd = pathCountsCommand(files);
	if (!cmd) return {};
	return parsePathCounts(await exec(cmd));
}

const DEVICE_COMMANDS = {
	rel: 'getprop ro.build.version.release 2>/dev/null',
	sdk: 'getprop ro.build.version.sdk 2>/dev/null',
	model: 'getprop ro.product.model 2>/dev/null',
	mfr: 'getprop ro.product.manufacturer 2>/dev/null',
	procK: "cat /proc/version 2>/dev/null | awk '{print $3}'",
	unameK: 'uname -r 2>/dev/null',
};

export interface DeviceInfo {
	model: string | null;
	android: string | null;
	procKernel: string | null;
	unameKernel: string | null;
	unameSpoofed: boolean;
}

const trimmed = (r: ExecResult): string => (r.stdout || '').trim();

function parseDeviceInfo({ rel, sdk, model, mfr, procK, unameK }: Record<keyof typeof DEVICE_COMMANDS, ExecResult>): DeviceInfo {
	const proc = trimmed(procK);
	const un = trimmed(unameK);
	return {
		model: [trimmed(mfr), trimmed(model)].filter(Boolean).join(' ') || null,
		android: trimmed(rel) ? `${trimmed(rel)}${trimmed(sdk) ? ` (SDK ${trimmed(sdk)})` : ''}` : null,
		procKernel: proc || null,
		unameKernel: un || null,
		unameSpoofed: !!(proc && un && proc !== un),
	};
}

const VERIFY_COMMANDS = {
	canary: '[ -e /storage/emulated/0/..5.u.S ] && echo exposed || echo hidden',
	selinux: 'getenforce 2>/dev/null',
};

export interface VerifyItem {
	key: 'path_hide' | 'selinux';
	ok: boolean | null;
	value: string;
}

function parseVerification({ canary, selinux }: Record<keyof typeof VERIFY_COMMANDS, ExecResult>): VerifyItem[] {
	const c = trimmed(canary);
	const se = trimmed(selinux);
	return [
		{ key: 'path_hide', ok: c === 'hidden', value: c === 'hidden' ? 'ok' : 'bad' },
		{ key: 'selinux', ok: /enforc/i.test(se), value: se || '—' },
	];
}

const LOG_LINES = 1000;

function logCommands(path: string) {
	return {
		text: `tail -n ${LOG_LINES} '${path}' 2>/dev/null`,
		total: `wc -l < '${path}' 2>/dev/null`,
	};
}

export interface LogData {
	text: string;
	total: number;
}

function parseLog({ text, total }: Record<keyof ReturnType<typeof logCommands>, ExecResult>): LogData {
	return {
		text: text.errno === 0 ? text.stdout : '',
		total: Number((total.stdout || '').trim()) || 0,
	};
}

export interface Logs {
	activity: LogData;
	kernel: LogData;
}

export async function getLogs(): Promise<Logs> {
	const r = await execBatch({
		...withPrefix('activity.', logCommands(LOG1_PATH)),
		...withPrefix('kernel.', logCommands(LOG_PATH)),
	});
	return { activity: parseLog(takePrefix('activity.', r)), kernel: parseLog(takePrefix('kernel.', r)) };
}

export interface HomeData {
	info: SusfsInfo;
	details: Details;
	stats: Stats;
	verify: VerifyItem[];
	device: DeviceInfo;
}

export interface AboutData {
	prop: Record<string, string>;
	info: SusfsInfo;
	config: Config;
}

function homeCommands(): Record<string, string> {
	return {
		...withPrefix('susfs.', SUSFS_COMMANDS),
		...withPrefix('cat.', allCategoryCommands()),
		...withPrefix('verify.', VERIFY_COMMANDS),
		...withPrefix('device.', DEVICE_COMMANDS),
	};
}

function parseHome(results: Record<string, ExecResult>): HomeData {
	const details = parseAllCategories(takePrefix('cat.', results));
	return {
		info: parseSusfsInfo(takePrefix('susfs.', results)),
		details,
		stats: statsFromDetails(details),
		verify: parseVerification(takePrefix('verify.', results)),
		device: parseDeviceInfo(takePrefix('device.', results)),
	};
}

export async function getHomeData(): Promise<HomeData> {
	return parseHome(await execBatch(homeCommands()));
}

export async function getAboutData(): Promise<AboutData> {
	const r = await execBatch({
		prop: MODULE_PROP_COMMAND,
		config: CONFIG_COMMAND,
		...withPrefix('susfs.', SUSFS_COMMANDS),
	});
	return { prop: parseModuleProp(r.prop), info: parseSusfsInfo(takePrefix('susfs.', r)), config: parseConfig(r.config) };
}

export interface Everything<E extends string> {
	config: Config;
	home: HomeData;
	about: AboutData;
	pathCounts: Record<string, number>;
	extra: Record<E, ExecResult>;
}

export async function loadEverything<E extends string>(pathFiles: readonly string[], extra: Record<E, string>): Promise<Everything<E>> {
	const counts = pathCountsCommand(pathFiles);
	const commands: Record<string, string> = { config: CONFIG_COMMAND, prop: MODULE_PROP_COMMAND };
	if (counts) commands.counts = counts;
	Object.assign(commands, withPrefix('home.', homeCommands()), withPrefix('extra.', extra));
	const r = await execBatch(commands);
	const top = takePrefix<'config' | 'prop' | 'counts'>('', r);
	const config = parseConfig(top.config);
	const home = parseHome(takePrefix('home.', r));
	return {
		config,
		home,
		about: { prop: parseModuleProp(top.prop), info: home.info, config },
		pathCounts: counts ? parsePathCounts(top.counts) : {},
		extra: takePrefix<E>('extra.', r),
	};
}
