import { icons } from '../core/icons';
import { $, closestTarget } from '../core/dom';
import { nextPaint } from '../core/ksu-bridge';
import { openSheetLoading, openSheetWithGroups } from '../core/sheet';
import { t } from '../core/i18n';
import { CATEGORIES, getCategoryDetail, getHomeData, type Category, type Details, type HomeData, type VerifyItem } from '../susfs-data';
import type { Notice } from '../bin-update';

let lastDetails: Details | null = null;

export function setHomeNotice(notice: Notice | null): void {
	const host = document.querySelector('#page-home [data-role="notice"]');
	if (!host) return;
	host.innerHTML = '';
	if (!notice) return;

	const card = document.createElement('div');
	card.className = `notice-card${notice.kind === 'warn' ? ' is-warn' : ''}`;
	const text = document.createElement('div');
	text.className = 'notice-card__text';
	const title = document.createElement('div');
	title.className = 'notice-card__title';
	title.textContent = notice.title;
	text.appendChild(title);
	if (notice.subtitle) {
		const sub = document.createElement('div');
		sub.className = 'notice-card__subtitle';
		sub.textContent = notice.subtitle;
		text.appendChild(sub);
	}
	card.appendChild(text);
	const onAction = notice.onAction;
	if (notice.actionLabel && onAction) {
		const btn = document.createElement('button');
		btn.className = 'btn btn--tonal notice-card__action';
		btn.textContent = notice.actionLabel;
		btn.addEventListener('click', () => onAction(btn));
		card.appendChild(btn);
	}
	host.appendChild(card);
}

const STAT_LABELS: Record<Category, string> = {
	sus_path: 'sus_path',
	sus_mount: 'sus_mount',
	sus_map: 'sus_map',
	try_umount: 'try_umount',
};

const VERIFY_META: Record<VerifyItem['key'], { i18n: string; label: string; fmt: (v: string) => string }> = {
	path_hide: {
		i18n: 'home_verify_pathhide',
		label: 'Path-hiding self-test',
		fmt: (v) => (v === 'ok' ? t('home_verify_working', 'Working') : t('home_verify_notworking', 'Not working')),
	},
	selinux: { i18n: 'home_verify_selinux', label: 'SELinux', fmt: (v) => v },
};

function checkRowHtml(item: VerifyItem): string {
	const meta = VERIFY_META[item.key];
	const label = t(meta.i18n, meta.label);
	const value = meta.fmt(item.value);
	let mark = '';
	if (item.ok === true) mark = `<span class="check-row__mark is-ok">${icons.check}</span>`;
	else if (item.ok === false) mark = `<span class="check-row__mark is-warn">${icons.error}</span>`;
	return `
		<div class="check-row">
			<span class="check-row__label">${label}</span>
			<span class="check-row__value">${value ?? '—'}</span>
			${mark}
		</div>`;
}

function infoRowHtml(label: string, value: string | null): string {
	return `
		<div class="info-row">
			<span class="info-row__label">${label}</span>
			<span class="info-row__value">${value ?? '—'}</span>
		</div>`;
}

function isCategory(value: string | undefined): value is Category {
	return (CATEGORIES as readonly (string | undefined)[]).includes(value);
}

export function renderHomeShell(root: HTMLElement): void {
	root.innerHTML = `
		<div data-role="status"></div>
		<div data-role="notice"></div>
		<h2 class="section-title">${t('home_verify_title', 'Verification')}</h2>
		<div class="card" data-role="verify"></div>
		<h2 class="section-title">${t('home_stats_title', 'This boot')}</h2>
		<div class="stat-grid" data-role="stats"></div>
		<h2 class="section-title">${t('home_device_title', 'Device')}</h2>
		<div class="card" data-role="device"></div>
	`;
	$(root, '[data-role="stats"]').addEventListener('click', async (e) => {
		const btn = closestTarget(e, '.stat-card');
		if (!btn) return;
		const category = btn.dataset.category;
		if (!isCategory(category)) return;
		const cached = lastDetails && lastDetails[category];
		if (cached) {
			openSheetWithGroups(STAT_LABELS[category], cached);
			return;
		}
		openSheetLoading(STAT_LABELS[category]);
		await nextPaint();
		const groups = await getCategoryDetail(category);
		openSheetWithGroups(STAT_LABELS[category], groups);
	});
}

export async function refreshHome(root: HTMLElement): Promise<void> {
	renderHome(root, await getHomeData());
}

export function renderHome(root: HTMLElement, { info, stats, verify, device, details }: HomeData): void {
	lastDetails = details;

	const statusEl = $(root, '[data-role="status"]');
	if (info.active) {
		statusEl.innerHTML = `
			<div class="status-card">
				<div class="status-card__icon">${icons.check}</div>
				<div>
					<div class="status-card__title">${t('home_susfs_active', 'SuSFS active')}</div>
					<div class="status-card__subtitle">${info.version ?? t('home_unknown_version', 'unknown version')}${info.variant ? ` · ${info.variant}` : ''} · ${info.features.length} ${info.features.length === 1 ? t('home_feature', 'feature') : t('home_features', 'features')}</div>
				</div>
			</div>`;
	} else {
		statusEl.innerHTML = `
			<div class="status-card is-error">
				<div class="status-card__icon">${icons.error}</div>
				<div>
					<div class="status-card__title">${t('home_susfs_inactive', 'SuSFS not detected')}</div>
					<div class="status-card__subtitle">${t('home_susfs_inactive_hint', 'Confirm your kernel is SuSFS-patched, then reboot.')}</div>
				</div>
			</div>`;
	}

	$(root, '[data-role="verify"]').innerHTML = verify.map(checkRowHtml).join('');

	const kernelValue = device.unameSpoofed ? `${device.procKernel} <span class="tag-inline">${t('home_device_uname_spoofed', 'uname spoofed')}</span>` : device.procKernel;
	$(root, '[data-role="device"]').innerHTML = [
		infoRowHtml(t('home_device_model', 'Model'), device.model),
		infoRowHtml(t('home_device_android', 'Android'), device.android),
		infoRowHtml(t('home_device_kernel', 'Kernel'), kernelValue),
	].join('');

	$(root, '[data-role="stats"]').innerHTML = CATEGORIES.map(
		(key) => `
		<button class="stat-card" data-category="${key}">
			<span class="stat-card__value">${stats[key] ?? 0}</span>
			<span class="stat-card__label">${STAT_LABELS[key]}</span>
		</button>
	`,
	).join('');
}
