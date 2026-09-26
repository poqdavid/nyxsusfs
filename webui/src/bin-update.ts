import { execAsync } from './core/ksu-bridge';
import { MOD_DIR } from './susfs-data';

const SCRIPT = `${MOD_DIR}/bin-update.sh`;

export interface BinResult {
	status: string;
	local: string;
	remote: string;
	detail: string;
	message: string;
}

const KEYS: readonly (keyof BinResult)[] = ['status', 'local', 'remote', 'detail', 'message'];

export interface Notice {
	kind: 'info' | 'warn';
	title: string;
	subtitle?: string;
	actionLabel?: string;
	onAction?: (button: HTMLButtonElement) => void;
}

function emptyResult(detail: string): BinResult {
	return { status: 'error', local: '', remote: '', detail, message: '' };
}

function isKey(key: string): key is keyof BinResult {
	return (KEYS as readonly string[]).includes(key);
}

function parseBlock(stdout: string): BinResult {
	const out = emptyResult('');
	for (const line of String(stdout).split('\n')) {
		const idx = line.indexOf('=');
		if (idx <= 0) continue;
		const key = line.slice(0, idx).trim();
		if (isKey(key)) out[key] = line.slice(idx + 1).trim();
	}
	return out;
}

async function runStage(stage: 'check' | 'apply'): Promise<BinResult> {
	const { errno, stdout } = await execAsync(`sh '${SCRIPT}' ${stage} 2>/dev/null`);
	if (errno !== 0 && !String(stdout).trim()) {
		return emptyResult('Could not run bin-update.sh');
	}
	return parseBlock(stdout);
}

let inFlight: Promise<BinResult> | null = null;

export function checkBinaryUpdate(): Promise<BinResult> {
	if (!inFlight) {
		const clear = (r: BinResult) => {
			inFlight = null;
			return r;
		};
		inFlight = runStage('check').then(clear, (err: unknown) => clear(emptyResult(String(err))));
	}
	return inFlight;
}

export function applyBinaryUpdate(): Promise<BinResult> {
	return runStage('apply');
}

export function describeBinaryStatus(result: BinResult, { silentWhenIdle = false }: { silentWhenIdle?: boolean } = {}): Notice | null {
	switch (result.status) {
		case 'differs':
			return {
				kind: 'info',
				title: result.detail || 'A different ksu_susfs is published',
				subtitle: result.message ? `Latest change: ${result.message}` : 'simonpunk’s latest ksu_susfs is not the one installed.',
				actionLabel: 'Install',
			};
		case 'missing':
			return {
				kind: 'warn',
				title: 'No susfs binary installed',
				subtitle: result.message || 'SuSFS features cannot be applied until one is installed.',
				actionLabel: 'Install',
			};
		case 'uptodate':
			return silentWhenIdle ? null : { kind: 'info', title: 'susfs binary is up to date', subtitle: result.detail };
		case 'offline':
			return silentWhenIdle ? null : { kind: 'warn', title: 'No connection', subtitle: result.detail };
		default:
			return silentWhenIdle ? null : { kind: 'warn', title: 'Update check failed', subtitle: result.detail };
	}
}
