import { getListFile, setListFile, listPathFiles } from '../susfs-data.js';
import { toast } from '../ksu-bridge.js';

// Order matches how the boot scripts consume them, most-used first.
// `inlineComments: false` marks the two files filtered with `grep -v "#"`,
// where a trailing comment silently discards the whole line.
const PATH_FILES = [
	{
		file: 'sus_path.txt',
		desc: 'Paths hidden with sus_path at boot-completed.',
		hint: 'One path per line. Optional second column: how many seconds to wait for the path to appear before adding it.',
		inlineComments: true,
	},
	{
		file: 'sus_path_loop.txt',
		desc: 'Same as sus_path, for paths that get recreated or modified often.',
		hint: 'Requires susfs v1.5.9+ (or v2.0.0+). Same format as sus_path.txt.',
		inlineComments: true,
	},
	{
		file: 'sus_mount.txt',
		desc: 'Mount points hidden with sus_mount at post-mount.',
		hint: 'One mount point per line. Inline # comments are NOT supported here — a line containing # is dropped entirely.',
		inlineComments: false,
	},
	{
		file: 'try_umount.txt',
		desc: 'Mount points unmounted per-process at post-mount.',
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
		hint: 'Format: <original> <redirected> <stage> [uid_scheme]. Stage 0 = boot-completed, 1 = service. uid_scheme needs susfs v2.1.0+.',
		inlineComments: true,
	},
	{
		file: 'legit_mounts.txt',
		desc: 'Mounts excluded from the auto try_umount scan.',
		hint: 'Only consulted when "Skip mounts in legit_mounts.txt" is enabled in Settings.',
		inlineComments: true,
	},
];

export function renderPathsShell(root) {
	root.innerHTML = `
		<p class="setting-row__desc" style="margin:4px 4px 16px;">
			These lists are read by the boot scripts, so edits apply on the next reboot.
			Lines starting with # are comments.
		</p>
		<div data-role="list"></div>
	`;

	const listEl = root.querySelector('[data-role="list"]');
	listEl.innerHTML = PATH_FILES.map((lf) => `
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
	`).join('');

	listEl.addEventListener('click', async (e) => {
		const card = e.target.closest('.path-card');
		if (!card) return;
		const file = card.dataset.file;
		const role = e.target.closest('[data-role]')?.dataset.role;

		if (role === 'toggle') {
			const body = card.querySelector('[data-role="body"]');
			const head = card.querySelector('[data-role="toggle"]');
			const opening = body.hidden;
			body.hidden = !opening;
			head.setAttribute('aria-expanded', String(opening));
			card.querySelector('.path-card__chevron').textContent = opening ? '▾' : '▸';
			if (opening && !card.dataset.loaded) {
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
			const textarea = card.querySelector('[data-role="editor"]');
			const { ok } = await setListFile(file, textarea.value);
			toast(ok ? `Saved ${file} — reboot to apply` : `Failed to save ${file}`);
			if (ok) {
				card.dataset.loaded = '1';
				checkWarning(card, file);
				refreshPaths(root);
			}
		}
	});

	// Warn as they type, not only on save.
	listEl.addEventListener('input', (e) => {
		if (e.target.dataset.role !== 'editor') return;
		const card = e.target.closest('.path-card');
		checkWarning(card, card.dataset.file);
	});
}

async function loadInto(card, file) {
	const textarea = card.querySelector('[data-role="editor"]');
	textarea.value = await getListFile(file);
	card.dataset.loaded = '1';
	checkWarning(card, file);
}

/** Flags the silent footgun: for files filtered with `grep -v "#"`, a line
 * with a trailing comment is discarded whole, taking the path with it. */
function checkWarning(card, file) {
	const meta = PATH_FILES.find((f) => f.file === file);
	const warn = card.querySelector('[data-role="warn"]');
	if (!warn || !meta || meta.inlineComments) return;
	const textarea = card.querySelector('[data-role="editor"]');
	const offenders = textarea.value
		.split('\n')
		.filter((l) => {
			const t = l.trim();
			return t && !t.startsWith('#') && t.includes('#');
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

export async function refreshPaths(root) {
	const counts = await listPathFiles(PATH_FILES.map((f) => f.file));
	root.querySelectorAll('.path-card').forEach((card) => {
		const n = counts[card.dataset.file];
		const el = card.querySelector('[data-role="count"]');
		el.textContent = n === undefined ? '—' : `${n}`;
		el.title = `${n} active entr${n === 1 ? 'y' : 'ies'}`;
	});
}
