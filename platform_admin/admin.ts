import { clearCurrentSession, getApiBaseUrl, getCurrentSession } from '../app.ts';

type ApiResult<T> = { ok: boolean; data: T; message?: string };
type Plan = { id: string; name: string; price: number; currency: 'TZS' | 'USD'; billing_interval: 'month' | 'year' | 'lifetime'; storage_limit_bytes: number; max_users: number; max_projects: number; max_photos_per_gallery: number; watermark_level: 'basic' | 'advanced'; support_level: 'standard' | 'priority'; status: 'active' | 'inactive'; features: Record<string, boolean> };
type GatewayProvider = 'clickpesa' | 'malipo' | 'stakaba';
const packageFeatures: Record<string, string> = { clientDownloads: 'Client downloads', originalQualityDownloads: 'Original quality downloads', clientPaymentUnlock: 'Client payment and unlock', qrGalleryLinks: 'QR gallery links', galleryExpiration: 'Gallery expiration', ingalleryBranding: 'InGallery branding', customBranding: 'Custom branding', customDomain: 'Custom domain', clientFavorites: 'Client favorites and selection', galleryPassword: 'Gallery password', emailNotifications: 'Email notifications', analytics: 'Analytics', bulkUpload: 'Bulk upload', prioritySupport: 'Priority support', teamManagement: 'Team management', agencyDashboard: 'Agency dashboard' };
const renderFeatureChecks = (features: Record<string, boolean> = {}): string => Object.entries(packageFeatures).map(([key, label]) => `<label class="feature-check"><input type="checkbox" name="feature" value="${key}" ${features[key] ? 'checked' : ''}>${label}</label>`).join('');

const session = getCurrentSession();
const messageNode = document.querySelector<HTMLElement>('#admin-message');
const api = async <T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> => {
  if (!session?.accessToken) throw new Error('Your session ended. Sign in again.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.accessToken}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers, cache: 'no-store' });
  const result = await response.json() as ApiResult<T>;
  if (!response.ok) {
    if (response.status === 401) clearCurrentSession();
    throw new Error(result.message || `Request failed (${response.status})`);
  }
  return result;
};
const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
const prettyDate = (value?: string | null): string => value ? new Date(value).toLocaleString() : '—';
const logAdvice = (status: number): string => status < 400 ? 'Request completed successfully.' : status === 400 ? 'The request data was invalid. Review the form fields and required values.' : status === 401 ? 'The session is missing or expired. Sign in again.' : status === 403 ? 'This account is not allowed to perform this action. Check its role and access.' : status === 404 ? 'The requested record or route was not found. Check the selected item or link.' : status === 409 ? 'The request conflicts with current data. Resolve pending payments or duplicate records, then retry.' : status === 429 ? 'Too many requests arrived in a short time. Wait briefly, then retry.' : status >= 500 ? 'The server or a connected service failed. Check service configuration and provider status, then inspect server logs.' : 'Review the request and retry; contact the system owner if it continues.';
const showMessage = (message = '', isError = true): void => {
  if (!messageNode) return;
  messageNode.textContent = message;
  messageNode.className = `mb-5 text-sm ${isError ? 'text-error' : 'text-success'}`;
};
const signedOut = (): void => { clearCurrentSession(); window.location.href = '../index.html'; };

if (!session?.accessToken) signedOut();
else {
  const emailNode = document.querySelector<HTMLElement>('#admin-email');
  if (emailNode) emailNode.textContent = session.email;
  document.querySelector<HTMLButtonElement>('#sign-out')?.addEventListener('click', signedOut);

  const get = async <T>(path: string): Promise<T> => (await api<T>(path)).data;
  const setTab = (name: string): void => {
    document.querySelectorAll<HTMLButtonElement>('.admin-tab').forEach((button) => {
      const active = button.dataset.tab === name;
      button.setAttribute('aria-selected', String(active));
      button.classList.toggle('text-muted', !active);
    });
    document.querySelectorAll<HTMLElement>('.admin-section').forEach((section) => { section.hidden = section.dataset.section !== name; });
    void loadTab(name);
  };

  const loadOverview = async (): Promise<void> => {
    const summary = await get<{ photographerCount: number; tenantCount: number; activeSubscriptions: number; grossRevenueByCurrency: Record<string, number>; requestsLast24Hours: number; errorsLast24Hours: number; apiUptimeSeconds: number; galleryCount: number; activePlanCount: number; inactivePlanCount: number; pendingPackagePayments: number; failedPackagePayments: number; recentPayments: Array<{ id: string; order_reference: string; amount: number; currency: string; status: string; provider: string; created_at: string; plan_id: string }>; recentIssues: Array<{ id: number; level: string; method: string; route: string; status: number; created_at: string }>; gateway: { provider: string; environment: string } | null }>('/api/platform/admin/overview');
    const cards = [
      ['Photographers', summary.photographerCount.toLocaleString()],
      ['Studios', summary.tenantCount.toLocaleString()],
      ['Active packages', summary.activeSubscriptions.toLocaleString()],
      ['Galleries', summary.galleryCount.toLocaleString()],
      ['API requests · 24h', summary.requestsLast24Hours.toLocaleString()],
      ['API errors · 24h', summary.errorsLast24Hours.toLocaleString()],
      ['Packages active / inactive', `${summary.activePlanCount} / ${summary.inactivePlanCount}`],
      ['Payments pending / failed', `${summary.pendingPackagePayments} / ${summary.failedPackagePayments}`]
    ];
    const metrics = document.querySelector<HTMLElement>('#metrics');
    if (metrics) metrics.innerHTML = cards.map(([label, value]) => `<div class="card"><p class="text-xs uppercase tracking-widest text-muted">${label}</p><p class="mt-3 font-display text-3xl text-secondary">${value}</p></div>`).join('');
    const revenue = Object.entries(summary.grossRevenueByCurrency).filter(([, amount]) => Number(amount) > 0).map(([currency, amount]) => `${currency} ${Number(amount).toLocaleString()}`).join(' · ') || 'No collected revenue yet';
    const health = document.querySelector<HTMLElement>('#health');
    if (health) health.textContent = `${summary.errorsLast24Hours ? `${summary.errorsLast24Hours} API errors in the last 24 hours` : 'No API errors in the last 24 hours'} · uptime ${Math.floor(summary.apiUptimeSeconds / 3600)}h · package gateway ${summary.gateway ? `${summary.gateway.provider} (${summary.gateway.environment})` : 'not configured'}`;
    const revenueNode = document.querySelector<HTMLElement>('#overview-revenue');
    if (revenueNode) revenueNode.innerHTML = Object.entries(summary.grossRevenueByCurrency).map(([currency, amount]) => `<div class="border border-white/10 p-3"><span class="text-xs uppercase tracking-widest text-muted">${escapeHtml(currency)} collected</span><p class="mt-1 text-xl text-secondary">${Number(amount).toLocaleString()}</p></div>`).join('') || `<p class="text-muted">${escapeHtml(revenue)}</p>`;
    const recentPaymentsNode = document.querySelector<HTMLElement>('#overview-payments');
    if (recentPaymentsNode) recentPaymentsNode.innerHTML = summary.recentPayments.length ? summary.recentPayments.map((payment) => `<div class="flex justify-between gap-3 border-b border-white/10 pb-2"><div><div class="text-white">${escapeHtml(payment.order_reference)}</div><div class="text-xs text-muted">${escapeHtml(payment.provider)} · ${escapeHtml(prettyDate(payment.created_at))}</div></div><div class="text-right"><div>${escapeHtml(payment.currency)} ${Number(payment.amount).toLocaleString()}</div><div class="text-xs ${payment.status === 'SUCCESS' ? 'text-success' : payment.status === 'FAILED' ? 'text-error' : 'text-secondary'}">${escapeHtml(payment.status)}</div></div></div>`).join('') : '<p>No package payments have been recorded.</p>';
    const issueNode = document.querySelector<HTMLElement>('#overview-issues');
    if (issueNode) issueNode.innerHTML = summary.recentIssues.length ? summary.recentIssues.map((issue) => `<div class="border-b border-white/10 pb-2"><div class="${issue.level === 'error' ? 'text-error' : 'text-secondary'}">${escapeHtml(issue.level.toUpperCase())} · ${issue.status}</div><div>${escapeHtml(issue.method)} ${escapeHtml(issue.route)}</div><div class="text-xs text-muted">${escapeHtml(logAdvice(issue.status))}</div></div>`).join('') : '<p>No recent warnings or errors.</p>';
  };

  let usersPage = 1;
  let usersLastPage = 1;
  let packageCache: Plan[] = [];
  const photographerById = new Map<string, { id: string; email?: string; name: string; studio: string; suspendedUntil?: string | null; subscription?: { plan_id: string; status: string; plans?: { name: string } | null } | null }>();
  const editPhotographer = async (userId: string): Promise<void> => {
    const user = photographerById.get(userId);
    if (!user) return;
    try {
      packageCache = await get<Plan[]>('/api/platform/admin/plans');
      const form = document.querySelector<HTMLFormElement>('#photographer-form')!;
      const set = (name: string, value: string): void => { const field = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null; if (field) field.value = value; };
      set('userId', user.id); set('name', user.name || ''); set('email', user.email || ''); set('studioName', user.studio || '');
      const planSelect = document.querySelector<HTMLSelectElement>('#photographer-plan')!;
      const currentPackage = packageCache.find((plan) => plan.id === user.subscription?.plan_id)?.name ?? 'none';
      planSelect.innerHTML = `<option value="">Do not change current package (${escapeHtml(currentPackage)})</option>${packageCache.map((plan) => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.name)} · ${escapeHtml(plan.currency)} ${Number(plan.price).toLocaleString()}${plan.status === 'inactive' ? ' (inactive)' : ''}</option>`).join('')}`;
      const active = form.elements.namedItem('active') as HTMLInputElement;
      active.checked = !user.suspendedUntil;
      document.querySelector<HTMLDialogElement>('#photographer-dialog')?.showModal();
    } catch (error) { showMessage(error instanceof Error ? error.message : 'Could not load photographer details.'); }
  };
  const sendRecovery = async (userId: string): Promise<void> => {
    try { await api(`/api/platform/admin/users/${encodeURIComponent(userId)}/recovery`, { method: 'POST' }); showMessage('Password recovery email sent.', false); }
    catch (error) { showMessage(error instanceof Error ? error.message : 'Could not send recovery email.'); }
  };
  const togglePhotographer = async (userId: string): Promise<void> => {
    const user = photographerById.get(userId);
    if (!user) return;
    try {
      await api(`/api/platform/admin/users/${encodeURIComponent(userId)}`, { method: 'PUT', body: JSON.stringify({ name: user.name, email: user.email, studioName: user.studio, active: Boolean(user.suspendedUntil) }) });
      showMessage(user.suspendedUntil ? 'Photographer account activated.' : 'Photographer account deactivated.', false);
      await loadUsers();
    } catch (error) { showMessage(error instanceof Error ? error.message : 'Could not update photographer status.'); }
  };
  const loadUsers = async (): Promise<void> => {
    const result = await api<{ data: Array<{ id: string; email?: string; name: string; createdAt: string; lastSignInAt?: string | null; confirmed: boolean; suspendedUntil?: string | null; studio: string; tenantStatus: string; subscription?: { plan_id: string; status: string; plans?: { name: string } | null } | null }>; page: number; perPage: number; lastPage?: number }>(`/api/platform/admin/users?page=${usersPage}&perPage=50`);
    photographerById.clear(); result.data.forEach((user) => photographerById.set(user.id, user));
    usersLastPage = Math.max(1, Number(result.lastPage ?? 1));
    const table = document.querySelector<HTMLElement>('#users-table');
    if (table) table.innerHTML = result.data.length ? result.data.map((user) => `<tr><td>${escapeHtml(user.name || user.email)}<div class="text-xs text-muted">${escapeHtml(user.email)}</div></td><td>${escapeHtml(user.studio || '—')}<div class="text-xs text-muted">${escapeHtml(user.tenantStatus)}</div></td><td>${escapeHtml(prettyDate(user.createdAt))}</td><td>${escapeHtml(prettyDate(user.lastSignInAt))}</td><td>${escapeHtml(user.subscription?.plans?.name ?? (user.subscription ? user.subscription.status : 'None'))}</td><td>${user.suspendedUntil ? '<span class="text-error">Deactivated</span>' : user.confirmed ? 'Active' : 'Unconfirmed'}</td><td><div class="flex flex-wrap gap-2"><button class="action" data-edit-user="${escapeHtml(user.id)}">Edit</button><button class="action" data-recover-user="${escapeHtml(user.id)}">Send recovery</button><button class="action" data-toggle-user="${escapeHtml(user.id)}">${user.suspendedUntil ? 'Activate' : 'Deactivate'}</button></div></td></tr>`).join('') : '<tr><td colspan="7">No photographer accounts found.</td></tr>';
    table?.querySelectorAll<HTMLButtonElement>('[data-edit-user]').forEach((button) => button.addEventListener('click', () => void editPhotographer(button.dataset.editUser ?? '')));
    table?.querySelectorAll<HTMLButtonElement>('[data-recover-user]').forEach((button) => button.addEventListener('click', () => void sendRecovery(button.dataset.recoverUser ?? '')));
    table?.querySelectorAll<HTMLButtonElement>('[data-toggle-user]').forEach((button) => button.addEventListener('click', () => void togglePhotographer(button.dataset.toggleUser ?? '')));
    const label = document.querySelector<HTMLElement>('#users-page-label');
    if (label) label.textContent = `Page ${usersPage}${usersLastPage > 1 ? ` of ${usersLastPage}` : ''}`;
  };

  const renderPlanForm = (plan: Plan): string => `<form class="card plan-form" data-plan-id="${escapeHtml(plan.id)}"><div class="mb-4 flex items-center justify-between"><h3 class="font-display text-xl">${escapeHtml(plan.name)}</h3><span class="text-xs uppercase tracking-widest ${plan.status === 'active' ? 'text-success' : 'text-muted'}">${escapeHtml(plan.status)}</span></div><div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label><span class="label">Name</span><input class="field" name="name" value="${escapeHtml(plan.name)}" required maxlength="80"></label><label><span class="label">Price</span><input class="field" name="price" type="number" min="0" step="1" value="${escapeHtml(plan.price)}" required></label><label><span class="label">Currency</span><select class="field" name="currency"><option ${plan.currency === 'TZS' ? 'selected' : ''}>TZS</option><option ${plan.currency === 'USD' ? 'selected' : ''}>USD</option></select></label><label><span class="label">Billing period</span><select class="field" name="billingInterval"><option value="month" ${plan.billing_interval === 'month' ? 'selected' : ''}>Monthly</option><option value="year" ${plan.billing_interval === 'year' ? 'selected' : ''}>Yearly</option><option value="lifetime" ${plan.billing_interval === 'lifetime' ? 'selected' : ''}>Lifetime</option></select></label><label><span class="label">Storage (GB)</span><input class="field" name="storageGB" type="number" min="0" step="1" value="${(Number(plan.storage_limit_bytes) / 1073741824).toFixed(0)}" required></label><label><span class="label">Team members</span><input class="field" name="maxUsers" type="number" min="1" value="${escapeHtml(plan.max_users)}" required></label><label><span class="label">Active galleries (0 = unlimited)</span><input class="field" name="maxProjects" type="number" min="0" value="${escapeHtml(plan.max_projects)}" required></label><label><span class="label">Photos per gallery</span><input class="field" name="maxPhotosPerGallery" type="number" min="0" value="${escapeHtml(plan.max_photos_per_gallery)}" required></label><label><span class="label">Watermarks</span><select class="field" name="watermarkLevel"><option value="basic" ${plan.watermark_level === 'basic' ? 'selected' : ''}>Basic</option><option value="advanced" ${plan.watermark_level === 'advanced' ? 'selected' : ''}>Advanced</option></select></label><label><span class="label">Support</span><select class="field" name="supportLevel"><option value="standard" ${plan.support_level === 'standard' ? 'selected' : ''}>Standard</option><option value="priority" ${plan.support_level === 'priority' ? 'selected' : ''}>Priority</option></select></label><label><span class="label">Status</span><select class="field" name="status"><option value="active" ${plan.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${plan.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></label></div><fieldset class="mt-4 border-t border-white/10 pt-4"><legend class="mb-2 text-sm text-secondary">Included features</legend><div class="grid gap-2 sm:grid-cols-2">${renderFeatureChecks(plan.features)}</div></fieldset><button class="action mt-4">Save package</button></form>`;
  const planValues = (form: HTMLFormElement): Record<string, unknown> => {
    const data = new FormData(form);
    return { name: data.get('name'), price: Number(data.get('price')), currency: data.get('currency'), billingInterval: data.get('billingInterval'), storageLimitBytes: Math.round(Number(data.get('storageGB')) * 1073741824), maxUsers: Number(data.get('maxUsers')), maxProjects: Number(data.get('maxProjects')), maxPhotosPerGallery: Number(data.get('maxPhotosPerGallery')), watermarkLevel: data.get('watermarkLevel'), supportLevel: data.get('supportLevel'), status: data.get('status'), features: Object.fromEntries(Object.keys(packageFeatures).map((key) => [key, data.getAll('feature').includes(key)])) };
  };
  const loadPlans = async (): Promise<void> => {
    const plans = await get<Plan[]>('/api/platform/admin/plans');
    packageCache = plans;
    const target = document.querySelector<HTMLElement>('#plans-list');
    if (target) target.innerHTML = plans.map(renderPlanForm).join('') || '<div class="card">No packages yet.</div>';
    target?.querySelectorAll<HTMLFormElement>('.plan-form').forEach((form) => form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try { await api(`/api/platform/admin/plans/${encodeURIComponent(form.dataset.planId ?? '')}`, { method: 'PUT', body: JSON.stringify(planValues(form)) }); showMessage('Package saved.', false); await loadPlans(); }
      catch (error) { showMessage(error instanceof Error ? error.message : 'Could not save package.'); }
    }));
  };

  const gatewayFields = (): void => {
    const provider = document.querySelector<HTMLSelectElement>('#gateway-provider')?.value as GatewayProvider;
    const target = document.querySelector<HTMLElement>('#gateway-credentials');
    if (!target) return;
    const fields = provider === 'clickpesa'
      ? [['clientId', 'Client ID', 'text'], ['apiKey', 'API key', 'password'], ['checksumKey', 'Checksum key (optional)', 'password']]
      : provider === 'malipo' ? [['apiKey', 'API key', 'password'], ['secretKey', 'Secret key', 'password']]
        : [['apiKey', 'API key', 'password']];
    target.innerHTML = fields.map(([name, label, type]) => `<label><span class="label">${escapeHtml(label)}</span><input class="field" name="${name}" type="${type}" autocomplete="new-password" ${name === 'checksumKey' ? '' : 'required'}></label>`).join('');
  };
  const gatewayPayload = (): Record<string, string> => {
    const form = document.querySelector<HTMLFormElement>('#gateway-form')!;
    return Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
  };
  const loadGateway = async (): Promise<void> => {
    const info = await get<{ configured: boolean; provider: string | null; environment: string; updatedAt: string | null }>('/api/platform/admin/payment-settings');
    const status = document.querySelector<HTMLElement>('#gateway-status');
    if (status) status.textContent = info.configured ? `Configured: ${info.provider} · ${info.environment} · updated ${prettyDate(info.updatedAt)}. Credentials are write-only and never displayed.` : 'No platform package payment gateway is configured.';
  };

  const loadRevenue = async (): Promise<void> => {
    const rows = await get<Array<{ created_at: string; revenueType: string; order_reference: string; provider: string; amount: number; currency: string; status: string; customer: string }>>('/api/platform/admin/revenue');
    const table = document.querySelector<HTMLElement>('#revenue-table');
    if (table) table.innerHTML = rows.length ? rows.map((row) => `<tr><td>${escapeHtml(prettyDate(row.created_at))}</td><td>${escapeHtml(row.revenueType)}</td><td>${escapeHtml(row.order_reference)}</td><td>${escapeHtml(row.provider)}<div class="text-xs text-muted">${escapeHtml(row.customer)}</div></td><td>${escapeHtml(row.currency)} ${Number(row.amount).toLocaleString()}</td><td>${escapeHtml(row.status)}</td></tr>`).join('') : '<tr><td colspan="6">No revenue records found.</td></tr>';
  };

  const loadLogs = async (): Promise<void> => {
    const level = document.querySelector<HTMLSelectElement>('#log-level')?.value ?? 'all';
    const logs = await get<Array<{ id: number; level: string; method: string; route: string; status: number; duration_ms: number; created_at: string }>>(`/api/platform/admin/logs?level=${encodeURIComponent(level)}&limit=150`);
    const table = document.querySelector<HTMLElement>('#logs-table');
    if (table) table.innerHTML = logs.length ? logs.map((log) => `<tr><td>${escapeHtml(prettyDate(log.created_at))}</td><td class="${log.level === 'error' ? 'text-error' : log.level === 'warning' ? 'text-secondary' : 'text-success'}">${escapeHtml(log.level)}</td><td>${escapeHtml(log.method)} ${escapeHtml(log.route)}</td><td>${log.status}</td><td>${log.duration_ms} ms</td><td class="max-w-sm text-sm text-muted">${escapeHtml(logAdvice(log.status))}</td></tr>`).join('') : '<tr><td colspan="6">No matching logs yet.</td></tr>';
  };

  const loadTab = async (name: string): Promise<void> => {
    showMessage('');
    try {
      if (name === 'overview') await loadOverview();
      if (name === 'users') await loadUsers();
      if (name === 'plans') await loadPlans();
      if (name === 'payments') await loadGateway();
      if (name === 'revenue') await loadRevenue();
      if (name === 'logs') await loadLogs();
    } catch (error) {
      if (error instanceof Error && error.message.includes('Platform administrator access required')) {
        showMessage('This signed-in account is not enabled as a platform administrator. Ask the system owner to check the platform admin allowlist.');
      } else showMessage(error instanceof Error ? error.message : 'Unable to load this admin section.');
    }
  };

  document.querySelectorAll<HTMLButtonElement>('.admin-tab').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab ?? 'overview')));
  document.querySelectorAll<HTMLButtonElement>('[data-reload]').forEach((button) => button.addEventListener('click', () => void loadTab(button.dataset.reload ?? 'overview')));
  document.querySelector<HTMLButtonElement>('#users-prev')?.addEventListener('click', () => { if (usersPage > 1) { usersPage -= 1; void loadUsers(); } });
  document.querySelector<HTMLButtonElement>('#users-next')?.addEventListener('click', () => { if (usersPage < usersLastPage) { usersPage += 1; void loadUsers(); } });
  document.querySelector<HTMLSelectElement>('#log-level')?.addEventListener('change', () => void loadLogs());
  document.querySelector<HTMLSelectElement>('#gateway-provider')?.addEventListener('change', gatewayFields);
  const newPlanFeatureNode = document.querySelector<HTMLElement>('#new-plan-features');
  if (newPlanFeatureNode) newPlanFeatureNode.innerHTML = renderFeatureChecks();
  document.querySelector<HTMLButtonElement>('#close-photographer-dialog')?.addEventListener('click', () => document.querySelector<HTMLDialogElement>('#photographer-dialog')?.close());
  document.querySelector<HTMLFormElement>('#photographer-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    try {
      await api(`/api/platform/admin/users/${encodeURIComponent(String(data.get('userId')) )}`, { method: 'PUT', body: JSON.stringify({ name: data.get('name'), email: data.get('email'), studioName: data.get('studioName'), active: data.get('active') === 'on', planId: data.get('planId') }) });
      document.querySelector<HTMLDialogElement>('#photographer-dialog')?.close(); showMessage('Photographer details saved.', false); await loadUsers();
    } catch (error) { showMessage(error instanceof Error ? error.message : 'Could not save photographer.'); }
  });
  gatewayFields();

  document.querySelector<HTMLFormElement>('#new-plan-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await api('/api/platform/admin/plans', { method: 'POST', body: JSON.stringify(planValues(event.currentTarget as HTMLFormElement)) }); showMessage('Package created.', false); (event.currentTarget as HTMLFormElement).reset(); await loadPlans(); }
    catch (error) { showMessage(error instanceof Error ? error.message : 'Could not create package.'); }
  });
  document.querySelector<HTMLFormElement>('#gateway-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { const result = await api('/api/platform/admin/payment-settings', { method: 'PUT', body: JSON.stringify(gatewayPayload()) }); showMessage(result.message ?? 'Platform payment gateway saved.', false); await loadGateway(); }
    catch (error) { showMessage(error instanceof Error ? error.message : 'Could not save gateway.'); }
  });
  document.querySelector<HTMLButtonElement>('#test-gateway')?.addEventListener('click', async () => {
    try { await api('/api/platform/admin/payment-settings/test', { method: 'POST', body: JSON.stringify(gatewayPayload()) }); showMessage('Provider connection succeeded.', false); }
    catch (error) { showMessage(error instanceof Error ? error.message : 'Provider connection failed.'); }
  });

  setTab('overview');
  window.setInterval(() => {
    const activeSection = document.querySelector<HTMLElement>('.admin-section:not([hidden])')?.dataset.section;
    if (activeSection === 'overview' || activeSection === 'logs') void loadTab(activeSection);
  }, 30_000);
}
