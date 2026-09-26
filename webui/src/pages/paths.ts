import { $, $$, closestTarget } from '../core/dom';
import { nextPaint, toast } from '../core/ksu-bridge';
import { getListFile, listPathFiles, setListFile } from '../susfs-data';

interface PathFile {
	file: string;
	desc: string;
	hint: string;
	inlineComments: boolean;
}

const PATH_FILES: readonly PathFile[] = [
	{
		file: 'sus_path.txt',
		desc: 'Paths hidden with sus_path at boot-completed.',
		hint: 'One path per line. Optional second column: how many seconds to wait for the path to appear before adding it.',
		inlineComments: true,
	},
	{
		file: 'sus_path_loop.txt',
		desc: 'Same as sus_path, for paths that get recreated or modified often.',
		hint: 'Same format as sus_path.txt.',
		inlineComments: true,
	},
	{
		file: 'try_umount.txt',
		desc: 'Mount points unmounted per-process at boot-completed.',
		hint: 'One mount point per line. Inline # comments are NOT supported here — a line containing # is dropped entirely.',
		inlineComments: false,
	},
	{
		file: 'sus_maps.txt',
		desc: 'Paths hidden from /proc/<pid>/maps.',
		hint: 'Needs a kernel built with CONFIG_KSU_SUSFS_SUS_MAP.',
		inlineComments: true,
	},
	{
		file: 'sus_open_redirect.txt',
		desc: 'Files transparently redirected when opened.',
		hint: 'Format: <original> <redirected> <stage> [uid_scheme]. Stage 0 = boot-completed, 1 = service. uid_scheme defaults to 2.',
		inlineComments: true,
	},
	{
		file: 'legit_mounts.txt',
		desc: 'Mounts excluded from the auto try_umount scan.',
		hint: 'Only consulted when "Skip mounts in legit_mounts.txt" is enabled in Settings.',
		inlineComments: true,
	},
	{
		file: 'priority_uid_filter.txt',
		desc: 'Apps hidden by the priority uid filter.',
		hint: 'One package name per line. Used when Settings → Hide apps from priority probes is set to "Apps you choose"; Settings also has a picker.',
		inlineComments: true,
	},
];

export const PATH_FILE_NAMES: readonly string[] = PATH_FILES.map((f) => f.file);

export function renderPathsShell(root: HTMLElement): void {
	root.innerHTML = `
		<p class="setting-row__desc" style="margin:4px 4px 16px;">
			These lists are read at boot, so edits apply on the next reboot.
			Lines starting with # are comments.
		</p>
		<div data-role="list"></div>
	`;

	const listEl = $(root, '[data-role="list"]');
	listEl.innerHTML = PATH_FILES.map(
		(lf) => `
		<div class="card path-card" data-file="${lf.file}">
			<button class="path-card__head" data-role="toggle" aria-expanded="false">
				<span class="path-card__chevron" aria-hidden="true">▸</span>
				<span class="path-card__text">
					<span class="path-card__name">${lf.file}</span>
					<span class="path-card__desc">${lf.desc}</span>
				</span>
				<span class="path-card__count" data-role="count">—</span>
			</button>
			<div class="path-card__body" data-role="body" hidden>
				<p class="path-card__hint">${lf.hint}</p>
				<textarea class="list-editor" data-role="editor" spellcheck="false"
					autocapitalize="off" autocorrect="off" wrap="off"></textarea>
				<p class="path-card__warn" data-role="warn" hidden></p>
				<div class="path-card__actions">
					<button class="btn btn--text" data-role="revert">Revert</button>
					<button class="btn btn--filled" data-role="save">Save</button>
				</div>
			</div>
		</div>
	`,
	).join('');

	listEl.addEventListener('click', async (e) => {
		const card = closestTarget(e, '.path-card');
		if (!card) return;
		const file = card.dataset.file ?? '';
		const role = closestTarget(e, '[data-role]')?.dataset.role;

		if (role === 'toggle') {
			const body = $(card, '[data-role="body"]');
			const head = $(card, '[data-role="toggle"]');
			const opening = body.hidden;
			body.hidden = !opening;
			head.setAttribute('aria-expanded', String(opening));
			$(card, '.path-card__chevron').textContent = opening ? '▾' : '▸';
			if (opening && !card.dataset.loaded) {
				await nextPaint();
				await loadInto(card, file);
			}
			return;
		}

		if (role === 'revert') {
			await loadInto(card, file);
			toast('Reloaded from disk');
			return;
		}

		if (role === 'save') {
			const textarea = $<HTMLTextAreaElement>(card, '[data-role="editor"]');
			const { ok } = await setListFile(file, textarea.value);
			toast(ok ? `Saved ${file} — reboot to apply` : `Failed to save ${file}`);
			if (ok) {
				card.dataset.loaded = '1';
				checkWarning(card, file);
				refreshPaths(root);
			}
		}
	});

	listEl.addEventListener('input', (e) => {
		const target = e.target;
		if (!(target instanceof HTMLElement) || target.dataset.role !== 'editor') return;
		const card = target.closest<HTMLElement>('.path-card');
		if (card) checkWarning(card, card.dataset.file ?? '');
	});
}

async function loadInto(card: HTMLElement, file: string): Promise<void> {
	const textarea = $<HTMLTextAreaElement>(card, '[data-role="editor"]');
	textarea.value = await getListFile(file);
	card.dataset.loaded = '1';
	checkWarning(card, file);
}

function checkWarning(card: HTMLElement, file: string): void {
	const meta = PATH_FILES.find((f) => f.file === file);
	const warn = card.querySelector<HTMLElement>('[data-role="warn"]');
	if (!warn || !meta || meta.inlineComments) return;
	const textarea = $<HTMLTextAreaElement>(card, '[data-role="editor"]');
	const offenders = textarea.value.split('\n').filter((l) => {
		const line = l.trim();
		return line && !line.startsWith('#') && line.includes('#');
	});
	if (offenders.length) {
		warn.hidden = false;
		const n = offenders.length;
		warn.textContent = `${n} line${n === 1 ? '' : 's'} here ${n === 1 ? 'mixes' : 'mix'} a path with a # comment. This file drops any line containing #, so ${n === 1 ? 'that entry' : 'those entries'} would be ignored entirely — put comments on their own line.`;
	} else {
		warn.hidden = true;
		warn.textContent = '';
	}
}

export async function refreshPaths(root: HTMLElement): Promise<void> {
	renderPathCounts(root, await listPathFiles(PATH_FILE_NAMES));
}

export function renderPathCounts(root: HTMLElement, counts: Record<string, number>): void {
	for (const card of $$(root, '.path-card')) {
		const n = counts[card.dataset.file ?? ''];
		const el = $(card, '[data-role="count"]');
		el.textContent = n === undefined ? '—' : `${n}`;
		el.title = `${n} active entr${n === 1 ? 'y' : 'ies'}`;
	}
}
