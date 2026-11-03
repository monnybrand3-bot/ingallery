(() => {

  const routes = [
    ['dashboard', 'dashboard', 'dashboard', 'Dashboard'],
    ['galleries', 'photo_library', 'ingallery_photography_studio_platform/code.html', 'Galleries'],
    ['clients', 'group', 'client_management_dashboard/code.html', 'Clients'],
    ['orders', 'shopping_bag', 'order_management_dashboard/code.html', 'Orders'],
    ['storage', 'cloud_queue', 'storage_hosting_dashboard/code.html', 'Storage'],
    ['performance', 'analytics', 'studio_performance_report/code.html', 'Performance'],
    ['settings', 'settings', 'marketing_seo_settings/code.html', 'Settings']
  ];

  const page = window.location.pathname;
  const isClientFacingPage = /public_gallery_unpaid|client_checkout_flow|payment_pending_status/.test(page);
  const prefix = '/';
  const resolveApiBaseUrl = () => {
    const configured = (window.INGALLERY_API_BASE_URL || 'http://localhost:8787').replace(/\/$/, '');
    return configured;
  };
  const destination = (route) => route === 'dashboard'
    ? `${prefix}photographer_dashboard_overview/code.html`
    : `${prefix}${route}`;

  const style = document.createElement('style');
  style.textContent = `
    body { --ingallery-sidebar-width: 256px; }
    .ingallery-existing-nav { display: none !important; }
    .ingallery-sidebar {
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 100;
      display: flex;
      width: var(--ingallery-sidebar-width);
      flex-direction: column;
      border-right: 1px solid rgba(255,255,255,.1);
      background: rgba(18,20,20,.96);
      color: #e2e2e2;
      padding: 32px 16px;
      font-family: Inter, sans-serif;
      backdrop-filter: blur(24px);
    }
    .ingallery-sidebar__brand { padding: 0 16px 32px; border-bottom: 1px solid rgba(255,255,255,.1); }
    .ingallery-sidebar__brand strong { display: block; color: #e9c349; font: 600 24px/32px 'Playfair Display', serif; }
    .ingallery-sidebar__brand span { display: block; margin-top: 8px; color: #c4c7c7; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; }
    .ingallery-sidebar__logo { width: 40px; height: 40px; margin-bottom: 12px; object-fit: cover; }
    .ingallery-sidebar__create { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 24px 4px 20px; border: 0; background: #e9c349; color: #121414; padding: 12px 14px; font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; text-decoration: none; }
    .ingallery-sidebar__links { display: flex; flex: 1; flex-direction: column; gap: 4px; }
    .ingallery-sidebar__link { display: flex; align-items: center; gap: 12px; border-right: 3px solid transparent; color: #c4c7c7; padding: 12px 16px; font-size: 14px; text-decoration: none; transition: background .2s, color .2s; }
    .ingallery-sidebar__link:hover, .ingallery-sidebar__link[aria-current='page'] { border-right-color: #e9c349; background: rgba(233,195,73,.1); color: #e9c349; }
    .ingallery-sidebar__link .material-symbols-outlined { font-size: 20px; }
    .ingallery-sidebar__footer { border-top: 1px solid rgba(255,255,255,.1); padding-top: 16px; }
    .ingallery-payment-backdrop { position: fixed; inset: 0; z-index: 200; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,.72); padding: 24px; }
    .ingallery-payment-backdrop.is-open { display: flex; }
    .ingallery-payment-modal { width: min(100%, 520px); border: 1px solid rgba(255,255,255,.14); background: #1a1c1c; padding: 28px; color: #e2e2e2; box-shadow: 0 24px 80px rgba(0,0,0,.45); }
    .ingallery-payment-modal h2 { margin: 0; color: #e9c349; font: 600 28px/36px 'Playfair Display', serif; }
    .ingallery-payment-modal label { display: block; margin-top: 18px; color: #c4c7c7; font: 600 11px/16px Inter, sans-serif; letter-spacing: .14em; text-transform: uppercase; }
    .ingallery-payment-modal input, .ingallery-payment-modal select { width: 100%; margin-top: 8px; border: 0; border-bottom: 1px solid rgba(255,255,255,.2); background: transparent; padding: 10px 0; color: #e2e2e2; outline: none; }
    .ingallery-payment-modal input:focus, .ingallery-payment-modal select:focus { border-bottom-color: #e9c349; }
    .ingallery-payment-modal select option { background: #1a1c1c; }
    .ingallery-payment-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 28px; }
    .ingallery-payment-actions button { border: 1px solid rgba(255,255,255,.2); background: transparent; color: #e2e2e2; padding: 11px 16px; font: 600 11px Inter, sans-serif; letter-spacing: .12em; text-transform: uppercase; }
    .ingallery-payment-actions button[type='submit'] { border-color: #e9c349; background: #e9c349; color: #121414; }
    .ingallery-payment-message { min-height: 20px; margin-top: 12px; color: #ffb4ab; font: 14px/20px Inter, sans-serif; }
    .ingallery-action-backdrop { position: fixed; inset: 0; z-index: 210; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,.72); padding: 24px; }
    .ingallery-action-backdrop.is-open { display: flex; }
    .ingallery-action-modal { width: min(100%, 560px); max-height: 90vh; overflow-y: auto; border: 1px solid rgba(255,255,255,.14); background: #1a1c1c; padding: 28px; color: #e2e2e2; box-shadow: 0 24px 80px rgba(0,0,0,.45); }
    .ingallery-action-modal h2 { margin: 0; color: #e9c349; font: 600 28px/36px 'Playfair Display', serif; }
    .ingallery-action-modal label { display: block; margin-top: 18px; color: #c4c7c7; font: 600 11px/16px Inter, sans-serif; letter-spacing: .14em; text-transform: uppercase; }
    .ingallery-action-modal input, .ingallery-action-modal select, .ingallery-action-modal textarea { width: 100%; margin-top: 8px; border: 0; border-bottom: 1px solid rgba(255,255,255,.2); background: transparent; padding: 10px 0; color: #e2e2e2; outline: none; }
    .ingallery-action-modal input:focus, .ingallery-action-modal select:focus, .ingallery-action-modal textarea:focus { border-bottom-color: #e9c349; }
    .ingallery-action-modal select option { background: #1a1c1c; }
    .ingallery-action-modal input[type='checkbox'] { width: auto; margin-right: 8px; accent-color: #e9c349; }
    .ingallery-action-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 28px; }
    .ingallery-action-actions button { border: 1px solid rgba(255,255,255,.2); background: transparent; color: #e2e2e2; padding: 11px 16px; font: 600 11px Inter, sans-serif; letter-spacing: .12em; text-transform: uppercase; }
    .ingallery-action-actions button[type='submit'] { border-color: #e9c349; background: #e9c349; color: #121414; }
    .ingallery-action-message { min-height: 20px; margin-top: 12px; color: #ffb4ab; font: 14px/20px Inter, sans-serif; }
    .ingallery-sidebar__mobile { display: none; }
    .ingallery-sidebar__mobile > span { max-width: calc(100vw - 140px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ingallery-upload-card { position: fixed; right: 20px; bottom: 20px; z-index: 180; width: min(390px, calc(100vw - 40px)); border: 1px solid rgba(233,195,73,.35); background: rgba(26,28,28,.96); padding: 16px; color: #e2e2e2; box-shadow: 0 16px 48px rgba(0,0,0,.42); backdrop-filter: blur(18px); }
    .ingallery-upload-card[hidden] { display: none; }
    .ingallery-upload-card__head { display: flex; align-items: flex-start; gap: 12px; }
    .ingallery-upload-card__icon { display: flex; width: 36px; height: 36px; flex: 0 0 auto; align-items: center; justify-content: center; background: rgba(233,195,73,.12); color: #e9c349; }
    .ingallery-upload-card__title { overflow: hidden; color: #e2e2e2; font: 600 14px/20px Inter, sans-serif; text-overflow: ellipsis; white-space: nowrap; }
    .ingallery-upload-card__detail { margin-top: 3px; color: #c4c7c7; font: 12px/18px Inter, sans-serif; }
    .ingallery-upload-card__track { height: 4px; margin-top: 14px; overflow: hidden; background: rgba(255,255,255,.12); }
    .ingallery-upload-card__fill { width: 0; height: 100%; background: #e9c349; transition: width .25s ease; }
    .ingallery-upload-card__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
    .ingallery-upload-card__actions button { border: 1px solid rgba(255,255,255,.18); background: transparent; padding: 6px 10px; color: #e2e2e2; font: 600 10px/14px Inter, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
    .ingallery-upload-card__actions button[data-upload-retry] { border-color: #e9c349; background: #e9c349; color: #121414; }
    .ingallery-upload-card__actions a { border: 1px solid #e9c349; background: #e9c349; padding: 6px 10px; color: #121414; font: 600 10px/14px Inter, sans-serif; letter-spacing: .08em; text-decoration: none; text-transform: uppercase; }
    .ingallery-mobile-drawer { position: fixed; inset: 64px 0 auto; z-index: 99; display: none; border-bottom: 1px solid rgba(255,255,255,.1); background: rgba(18,20,20,.98); padding: 12px 20px 20px; }
    .ingallery-mobile-drawer.is-open { display: block; }
    .ingallery-mobile-drawer a { display: flex; align-items: center; gap: 12px; color: #c4c7c7; padding: 12px 0; font: 14px Inter, sans-serif; text-decoration: none; }
    .ingallery-mobile-drawer a:hover { color: #e9c349; }
    @media (max-width: 767px) {
      .ingallery-sidebar { display: none; }
      .ingallery-sidebar__mobile { position: fixed; inset: 0 0 auto; z-index: 100; display: flex; align-items: center; justify-content: space-between; height: 64px; border-bottom: 1px solid rgba(255,255,255,.1); background: rgba(18,20,20,.94); padding: 0 20px; color: #e9c349; font: 600 20px 'Playfair Display', serif; }
      .ingallery-sidebar__mobile button { border: 0; background: transparent; color: #e9c349; }
    }
      .ingallery-sidebar__storage { margin-top: auto; padding: 16px; border-top: 1px solid rgba(255,255,255,.1); }
    .ingallery-sidebar__storage-label { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .ingallery-sidebar__storage-label span { font-size: 11px; color: #c4c7c7; text-transform: uppercase; letter-spacing: .1em; }
    .ingallery-sidebar__storage-value { font-size: 12px; color: #e9c349; font-weight: 600; }
    .ingallery-sidebar__storage-bar { height: 4px; background: rgba(255,255,255,.1); border-radius: 2px; overflow: hidden; }
    .ingallery-sidebar__storage-fill { height: 100%; background: #e9c349; transition: width .3s ease; }
`;
  document.head.appendChild(style);

  if (!isClientFacingPage) {
    document.querySelectorAll('nav').forEach((nav) => nav.classList.add('ingallery-existing-nav'));
  }

  const pageLinks = {
    dashboard: `${prefix}photographer_dashboard_overview/code.html`,
    galleries: `${prefix}ingallery_photography_studio_platform/code.html`,
    'view all': `${prefix}ingallery_photography_studio_platform/code.html`,
    'back to galleries': `${prefix}ingallery_photography_studio_platform/code.html`,
    'client access': `${prefix}client_detail_view/code.html`
  };
  document.querySelectorAll('a').forEach((link) => {
    const label = (link.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (link.getAttribute('href') === '#' && pageLinks[label]) link.setAttribute('href', pageLinks[label]);
  });

  let sidebar = null;
  if (!isClientFacingPage) {
  sidebar = document.createElement('aside');
  sidebar.className = 'ingallery-sidebar';
  sidebar.innerHTML = `
  <div class="ingallery-sidebar__brand"><img class="ingallery-sidebar__logo" data-studio-logo alt="Studio logo" hidden><strong>InGallery</strong><span data-studio-brand>Studio</span></div>
    <a class="ingallery-sidebar__create" href="${prefix}create_new_gallery_form/code.html"><span class="material-symbols-outlined">add</span>Create Gallery</a>
    <div class="ingallery-sidebar__links">
      ${routes.map(([key, icon, route, label]) => `<a class="ingallery-sidebar__link" data-nav-key="${key}" href="${destination(route)}"><span class="material-symbols-outlined">${icon}</span><span>${label}</span></a>`).join('')}
    </div>
    <div class="ingallery-sidebar__storage">
        <div class="ingallery-sidebar__storage-label">
            <span>Storage</span>
            <span class="ingallery-sidebar__storage-value" data-storage-value>0 / 0 GB</span>
        </div>
        <div class="ingallery-sidebar__storage-bar">
            <div class="ingallery-sidebar__storage-fill" data-storage-fill style="width: 0%"></div>
        </div>
    </div>
    <div class="ingallery-sidebar__footer">
      <a class="ingallery-sidebar__link" href="${prefix}team_permissions_view/code.html"><span class="material-symbols-outlined">group</span><span>Team</span></a>
      <a class="ingallery-sidebar__link" href="${prefix}index.html"><span class="material-symbols-outlined">logout</span><span>Sign Out</span></a>
    </div>
  `;
  document.body.prepend(sidebar);

  const mobile = document.createElement('div');
  mobile.className = 'ingallery-sidebar__mobile';
  mobile.innerHTML = `<span data-studio-brand-mobile>InGallery</span><div><a href="${prefix}photographer_dashboard_overview/code.html" aria-label="Open dashboard"><span class="material-symbols-outlined">dashboard</span></a><button type="button" aria-label="Open navigation menu"><span class="material-symbols-outlined">menu</span></button></div>`;
  document.body.prepend(mobile);

  const mobileDrawer = document.createElement('nav');
  mobileDrawer.className = 'ingallery-mobile-drawer';
  mobileDrawer.innerHTML = `${routes.map(([key, icon, route, label]) => `<a data-mobile-nav-key="${key}" href="${destination(route)}"><span class="material-symbols-outlined">${icon}</span><span>${label}</span></a>`).join('')}<a href="${prefix}team_permissions_view/code.html"><span class="material-symbols-outlined">group</span><span>Team</span></a>`;
  document.body.prepend(mobileDrawer);
  mobile.querySelector('button')?.addEventListener('click', () => mobileDrawer.classList.toggle('is-open'));

  const applyStudioProfile = (profile) => {
    const name = profile.studio_name?.trim() || profile.display_name?.trim() || 'Studio';
    document.querySelectorAll('[data-studio-brand]').forEach((node) => { node.textContent = name; });
    const mobileBrand = mobile.querySelector('[data-studio-brand-mobile]');
    if (mobileBrand) mobileBrand.textContent = name;
    const logoUrl = profile.avatarUrl || profile.avatar_url;
    document.querySelectorAll('[data-studio-logo]').forEach((logo) => {
      if (logoUrl) {
        logo.src = logoUrl;
        logo.hidden = false;
      } else {
        logo.removeAttribute('src');
        logo.hidden = true;
      }
    });
  };

  const sessionForBrand = JSON.parse(window.localStorage.getItem('ingallery:session') || 'null');
  if (sessionForBrand?.accessToken) {
    fetch(`${resolveApiBaseUrl()}/api/profile`, { headers: { Authorization: `Bearer ${sessionForBrand.accessToken}` } })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (result?.data) applyStudioProfile(result.data); })
      .catch(() => {});
  }
  window.addEventListener('ingallery:profile-updated', (event) => {
    if (event.detail) applyStudioProfile(event.detail);
  });

  const uploadCard = document.createElement('aside');
  uploadCard.className = 'ingallery-upload-card';
  uploadCard.hidden = true;
  uploadCard.setAttribute('aria-label', 'Gallery upload progress');
  uploadCard.innerHTML = `
    <div class="ingallery-upload-card__head">
      <span class="ingallery-upload-card__icon material-symbols-outlined" aria-hidden="true">cloud_upload</span>
      <div style="min-width:0;flex:1">
        <p class="ingallery-upload-card__title" data-upload-card-title></p>
        <p class="ingallery-upload-card__detail" data-upload-card-detail aria-live="polite"></p>
      </div>
      <strong data-upload-card-percent style="color:#e9c349;font:600 12px/18px Inter,sans-serif"></strong>
    </div>
    <div class="ingallery-upload-card__track" role="progressbar" aria-label="Gallery upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="ingallery-upload-card__fill" data-upload-card-fill></div></div>
    <div class="ingallery-upload-card__actions">
      <button type="button" data-upload-retry hidden>Retry</button>
      <a data-upload-view hidden>View Gallery</a>
      <button type="button" data-upload-dismiss hidden>Dismiss</button>
    </div>`;
  document.body.append(uploadCard);

  const uploadJobs = new Map();
  const uploadWorker = { current: null };
  const renderUploadCard = () => {
    const jobs = [...uploadJobs.values()].filter((job) => !job.dismissed);
    const job = jobs.filter((item) => ['queued', 'uploading'].includes(item.status)).sort((left, right) => right.createdAt - left.createdAt)[0]
      ?? jobs.sort((left, right) => right.createdAt - left.createdAt)[0];
    if (!job) {
      uploadCard.hidden = true;
      return;
    }

    uploadCard.hidden = false;
    const title = uploadCard.querySelector('[data-upload-card-title]');
    const detail = uploadCard.querySelector('[data-upload-card-detail]');
    const percent = uploadCard.querySelector('[data-upload-card-percent]');
    const track = uploadCard.querySelector('[role="progressbar"]');
    const fill = uploadCard.querySelector('[data-upload-card-fill]');
    const retry = uploadCard.querySelector('[data-upload-retry]');
    const viewGallery = uploadCard.querySelector('[data-upload-view]');
    const dismiss = uploadCard.querySelector('[data-upload-dismiss]');
    const value = Math.max(0, Math.min(100, Number(job.percent) || 0));
    if (title) title.textContent = job.status === 'complete' ? `Gallery ready: ${job.title}` : job.status === 'failed' ? `Upload paused: ${job.title}` : job.status === 'staging' ? `Preparing gallery: ${job.title}` : `Creating gallery: ${job.title}`;
    if (detail) {
      if (job.status === 'complete') detail.textContent = job.hasCover && job.photoCount === 0
        ? 'Cover updated. Gallery is ready.'
        : `${job.photoCount} photos uploaded. Gallery is ready.`;
      else if (job.status === 'failed') detail.textContent = job.stage === 'cover'
        ? `Cover upload failed. ${job.errorMessage || 'Retry to continue.'}`
        : `${job.uploadedPhotos} of ${job.photoCount} photos uploaded. ${job.errorMessage || 'Retry to continue.'}`;
      else if (job.status === 'staging') detail.textContent = `Saving ${job.stagedPhotos || 0} of ${job.photoCount} photos to the background queue.`;
      else if (job.stage === 'cover') detail.textContent = `Uploading cover${job.currentFile ? `: ${job.currentFile}` : '...'}`;
      else if (job.stage === 'photo') detail.textContent = `Uploaded ${job.uploadedPhotos} of ${job.photoCount} photos. Now uploading ${job.currentFile || 'next photo'}.`;
      else detail.textContent = `${job.uploadedPhotos} of ${job.photoCount} photos uploaded. Preparing upload...`;
    }
    if (percent) percent.textContent = `${value}%`;
    if (track) track.setAttribute('aria-valuenow', String(value));
    if (fill) fill.style.width = `${value}%`;
    if (retry) retry.hidden = job.status !== 'failed';
    if (viewGallery) {
      viewGallery.hidden = job.status !== 'complete';
      viewGallery.href = `${prefix}public_gallery_unpaid/code.html?slug=${encodeURIComponent(job.slug || '')}&galleryId=${encodeURIComponent(job.galleryId)}`;
    }
    if (dismiss) dismiss.hidden = !['complete', 'failed'].includes(job.status);
    uploadCard.dataset.jobId = job.id;
  };

  uploadCard.querySelector('[data-upload-retry]')?.addEventListener('click', () => {
    uploadWorker.current?.postMessage({ type: 'RETRY_GALLERY_UPLOAD', jobId: uploadCard.dataset.jobId });
  });
  uploadCard.querySelector('[data-upload-dismiss]')?.addEventListener('click', () => {
    uploadWorker.current?.postMessage({ type: 'DISMISS_GALLERY_UPLOAD', jobId: uploadCard.dataset.jobId });
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'INGALLERY_UPLOAD_UPDATE' && event.data.job) {
        uploadJobs.set(event.data.job.id, event.data.job);
        renderUploadCard();
        if (event.data.job.status === 'complete') {
          window.dispatchEvent(new CustomEvent('ingallery:gallery-upload-complete', { detail: event.data.job }));
        }
      }
      if (event.data?.type === 'INGALLERY_UPLOAD_LIST') {
        (event.data.jobs ?? []).forEach((job) => uploadJobs.set(job.id, job));
        renderUploadCard();
      }
    });
    navigator.serviceWorker.register('/gallery-upload-worker.js').then(async (registration) => {
      await navigator.serviceWorker.ready;
      uploadWorker.current = registration.active || navigator.serviceWorker.controller;
      uploadWorker.current?.postMessage({ type: 'GET_GALLERY_UPLOADS' });
      uploadWorker.current?.postMessage({ type: 'RESUME_GALLERY_UPLOADS' });
    }).catch(() => {});
  }
  }

  const createGalleryUrl = `${prefix}create_new_gallery_form/code.html?upload=v4`;
  document.querySelectorAll('button').forEach((button) => {
    const label = (button.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!label.includes('create new gallery') && !label.includes('upload new gallery')) return;
    button.addEventListener('click', () => {
      window.location.href = createGalleryUrl;
    });
  });

  const coverImage = document.querySelector('input[type="file"]#cover-image');
  if (coverImage) {
    coverImage.addEventListener('change', () => {
      const file = coverImage.files?.[0];
      const preview = document.querySelector('[data-cover-preview]');
      const progress = document.querySelector('[data-cover-progress]');
      if (!file || !preview || !progress) return;
      if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) return;
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        preview.setAttribute('src', String(reader.result));
        preview.style.display = 'block';
        progress.style.display = 'block';
        progress.style.setProperty('--upload-progress', '100%');
      });
      reader.readAsDataURL(file);
    });
  }

  if (page.includes('client_checkout_flow')) {
    const gallery = new URLSearchParams(window.location.search).get('gallery');
    const galleryHeading = document.querySelector('h1');
    if (gallery && galleryHeading) galleryHeading.textContent = gallery;
    if (gallery) document.title = `InGallery - Checkout - ${gallery}`;
  }

  if (page.includes('photographer_dashboard_overview') || page.includes('ingallery_photography_studio_platform')) {
    document.querySelectorAll('.image-card').forEach((card) => {
      if (card.hasAttribute('data-gallery-actions-managed')) return;
      const title = card.querySelector('h3')?.textContent?.trim();
      if (!title) return;
      const encodedTitle = encodeURIComponent(title);
      const publicGalleryUrl = `${prefix}public_gallery_unpaid/code.html?gallery=${encodedTitle}`;
      const editorUrl = `${prefix}create_new_gallery_form/code.html?edit=${encodedTitle}`;

      card.addEventListener('click', (event) => {
        if ((event.target instanceof Element) && event.target.closest('a, button')) return;
        window.location.href = publicGalleryUrl;
      });

      card.querySelectorAll('button').forEach((button) => {
        const icon = button.querySelector('.material-symbols-outlined')?.textContent?.trim();
        if (icon === 'edit') {
          button.setAttribute('aria-label', `Edit ${title}`);
          button.addEventListener('click', (event) => {
            event.stopPropagation();
            window.location.href = editorUrl;
          });
        }
        if (icon === 'share') {
          button.setAttribute('aria-label', `Share ${title}`);
          button.addEventListener('click', async (event) => {
            event.stopPropagation();
            const shareUrl = `${window.location.origin}${publicGalleryUrl}`;
            if (navigator.clipboard) await navigator.clipboard.writeText(shareUrl);
            button.setAttribute('title', 'Gallery link copied');
          });
        }
        if (icon === 'qr_code') {
          button.setAttribute('aria-label', `Open QR link for ${title}`);
          button.addEventListener('click', (event) => {
            event.stopPropagation();
            window.location.href = publicGalleryUrl;
          });
        }
      });
    });
  }

  if (page.includes('photographer_dashboard_overview')) {
    const session = JSON.parse(window.localStorage.getItem('ingallery:session') || 'null');
    if (session?.accessToken) {
      const apiBaseUrl = resolveApiBaseUrl();
      const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
      fetch(`${apiBaseUrl}/api/dashboard`, { headers: { Authorization: `Bearer ${session.accessToken}` } })
        .then((response) => response.ok ? response.json() : null)
        .then((result) => {
          const snapshot = result?.data;
          if (!snapshot) return;
          const revenue = document.querySelector('[data-dashboard-revenue]');
          const totalGalleries = document.querySelector('[data-dashboard-total-galleries]');
          const activeGalleries = document.querySelector('[data-dashboard-active-galleries]');
          const storage = document.querySelector('[data-dashboard-storage]');
          const storageBar = document.querySelector('[data-dashboard-storage-bar]');
          if (revenue) {
            const totals = snapshot.revenueByCurrency || { TZS: 0, USD: 0 };
            const formatted = ['TZS', 'USD'].filter((currency) => Number(totals[currency]) > 0)
              .map((currency) => `${currency} ${Number(totals[currency]).toLocaleString('en-US', { maximumFractionDigits: currency === 'USD' ? 2 : 0 })}`);
            revenue.textContent = formatted.join(' · ') || 'TZS 0';
          }
          if (totalGalleries) totalGalleries.textContent = String(snapshot.recentGalleries?.length || 0);
          if (activeGalleries) activeGalleries.textContent = String((snapshot.recentGalleries || []).filter((gallery) => gallery.status === 'published').length);
          const storagePercent = snapshot.storageLimit ? Math.min(100, Math.round((snapshot.storageUsed / snapshot.storageLimit) * 100)) : 0;
          if (storage) storage.innerHTML = `${storagePercent}<span class="text-body-md font-body-md text-on-surface-variant">% used</span>`;
          if (storageBar) storageBar.style.width = `${storagePercent}%`;

          const galleryList = document.querySelector('[data-live-gallery-list]');
          if (!galleryList || !snapshot.recentGalleries?.length) return;
          galleryList.innerHTML = snapshot.recentGalleries.slice(0, 4).map((gallery) => `
            <div class="glass-panel rounded-xl overflow-hidden image-card cursor-pointer group" data-live-gallery="${escapeHtml(gallery.id)}">
              <div class="h-48 w-full bg-surface-container relative overflow-hidden">
                ${gallery.coverUrl
                  ? `<img src="${gallery.coverUrl}" alt="${escapeHtml(gallery.title)} cover" class="h-full w-full object-cover">`
                  : `<div class="h-full w-full flex items-center justify-center"><span class="material-symbols-outlined text-5xl text-on-surface-variant/30">photo_library</span></div>`}
                <div class="absolute top-4 left-4 bg-primary-container/80 backdrop-blur-md px-2 py-1 rounded text-label-sm font-label-sm text-on-surface border border-white/10">${escapeHtml(gallery.status.toUpperCase())}</div>
              </div>
              <div class="p-5">
                <h3 class="text-body-lg font-body-lg font-semibold text-on-surface truncate">${escapeHtml(gallery.title)}</h3>
                <div class="flex justify-between items-center mt-3">
                  <p class="text-label-sm font-label-sm text-on-surface-variant">${Number(gallery.imageCount || 0)} Photos</p>
                  <p class="text-label-sm font-label-sm ${gallery.status === 'published' ? 'text-tertiary' : 'text-error'}">${gallery.status === 'published' ? 'READY' : 'DRAFT'}</p>
                </div>
              </div>
            </div>`).join('');
          galleryList.querySelectorAll('[data-live-gallery]').forEach((card, index) => {
            card.addEventListener('click', () => {
              const gallery = snapshot.recentGalleries[index];
              window.location.href = `${prefix}public_gallery_unpaid/code.html?gallery=${encodeURIComponent(gallery.slug || gallery.title)}&galleryId=${encodeURIComponent(gallery.id)}`;
            });
          });
        })
        .catch(() => {});
    }
  }

  const apiRequest = async (path, options = {}) => {
    const session = JSON.parse(window.localStorage.getItem('ingallery:session') || 'null');
        const apiBaseUrl = resolveApiBaseUrl();
    let response;
    try {
      response = await fetch(`${apiBaseUrl}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}), ...(options.headers || {}) }
      });
    } catch {
      throw new Error('InGallery API is offline. Configure .env, run npm run dev:server, and try again.');
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Request failed');
    return result;
  };

  const openActionModal = (title, content, onSubmit) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'ingallery-action-backdrop is-open';
    backdrop.innerHTML = `<form class="ingallery-action-modal"><h2>${title}</h2>${content}<div class="ingallery-action-message" data-action-message></div><div class="ingallery-action-actions"><button type="button" data-action-cancel>Cancel</button><button type="submit">Save</button></div></form>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector('[data-action-cancel]')?.addEventListener('click', close);
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
    backdrop.querySelector('form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const message = form.querySelector('[data-action-message]');
      try {
        await onSubmit(form, message, close);
      } catch (error) {
        if (message) message.textContent = error instanceof Error ? error.message : 'Unable to save changes.';
      }
    });
    return backdrop;
  };

  if (page.includes('client_management_dashboard')) {
    const clientCards = Array.from(document.querySelectorAll('main .glass-panel')).filter((card) => card.querySelector('h3'));
    clientCards.forEach((card) => {
      const name = card.querySelector('h3')?.textContent?.trim() || 'Client';
      const contactLine = card.querySelector('h3')?.parentElement?.querySelector('p')?.textContent?.trim() || '';
      const email = contactLine.split('•')[0]?.trim() || '';
      card.querySelectorAll('button').forEach((button) => {
        const label = button.textContent?.trim().toLowerCase() || '';
        if (button.getAttribute('title') === 'Message') {
          button.addEventListener('click', () => { window.location.href = `mailto:${email}?subject=${encodeURIComponent(`Message from InGallery`)}&body=${encodeURIComponent(`Hello ${name},\n\n`)}`; });
        } else if (label.includes('view details') || label.includes('view archive')) {
          button.addEventListener('click', () => { window.location.href = `${prefix}client_detail_view/code.html?name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}`; });
        } else if (label.includes('create quote')) {
          button.addEventListener('click', () => openActionModal(`Quote for ${name}`, '<label>Amount (TZS)<input name="amount" type="number" min="1" required></label><label>Notes<textarea name="notes" rows="3" placeholder="Describe the package"></textarea></label>', async (form, message, close) => {
            const amount = Number(form.querySelector('[name="amount"]')?.value);
            if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid quote amount.');
            const notes = form.querySelector('[name="notes"]')?.value || '';
            await apiRequest('/api/quotes', { method: 'POST', body: JSON.stringify({ clientName: name, clientEmail: email, amount, notes }) });
            if (message) { message.style.color = '#4deea3'; message.textContent = 'Quote saved.'; }
            setTimeout(close, 500);
          }));
        }
      });
      card.addEventListener('click', (event) => {
        if (!(event.target instanceof Element) || !event.target.closest('button')) window.location.href = `${prefix}client_detail_view/code.html?name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}`;
      });
    });
    const addClientButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim().toLowerCase() === 'add client');
    addClientButton?.addEventListener('click', () => openActionModal('Add Client', '<label>Name<input name="name" required></label><label>Email<input name="email" type="email" required></label><label>Phone<input name="phone" type="tel"></label>', async (form, message, close) => {
      const client = { name: form.querySelector('[name="name"]')?.value.trim(), email: form.querySelector('[name="email"]')?.value.trim(), phone: form.querySelector('[name="phone"]')?.value.trim(), createdAt: new Date().toISOString() };
      if (!client.name || !client.email) throw new Error('Name and email are required.');
      await apiRequest('/api/clients', { method: 'POST', body: JSON.stringify(client) });
      if (message) { message.style.color = '#4edea3'; message.textContent = 'Client saved. Refresh the page to see the new record.'; }
      setTimeout(close, 700);
    }));
    const search = document.querySelector('input[placeholder="Search clients..."]');
    search?.addEventListener('input', () => { const query = search.value.toLowerCase(); clientCards.forEach((card) => { card.style.display = card.textContent?.toLowerCase().includes(query) ? '' : 'none'; }); });
  }

  if (page.includes('order_management_dashboard')) {
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    rows.forEach((row) => {
      const values = Array.from(row.children).map((cell) => cell.textContent?.trim() || '');
      row.querySelectorAll('button').forEach((button) => {
        const title = button.getAttribute('title') || '';
        if (title === 'View Details') button.addEventListener('click', () => openActionModal(`Order ${values[0]}`, `<p class="mt-5 text-on-surface-variant">${values.slice(1, 7).join(' · ')}</p>`, (_form, _message, close) => close()));
        if (title === 'Print Receipt' && !button.classList.contains('cursor-not-allowed')) button.addEventListener('click', () => {
          const receipt = window.open('', '_blank', 'width=640,height=720');
          if (!receipt) return;
          receipt.document.write(`<html><head><title>Receipt ${values[0]}</title></head><body><h1>InGallery Receipt</h1><p>Order: ${values[0]}</p><p>Client: ${values[1]}</p><p>Gallery: ${values[2]}</p><p>Amount: ${values[4]}</p><p>Status: ${values[6]}</p><script>window.print()<\/script></body></html>`);
          receipt.document.close();
        });
      });
    });
    const orderSearch = document.querySelector('input[placeholder="Search ID or Client..."]');
    const statusFilter = document.querySelector('select');
    const filterOrders = () => { const query = orderSearch?.value.toLowerCase() || ''; const status = statusFilter?.value || 'all'; rows.forEach((row) => { const text = row.textContent?.toLowerCase() || ''; const matchesStatus = status === 'all' || text.includes(status); row.style.display = text.includes(query) && matchesStatus ? '' : 'none'; }); };
    orderSearch?.addEventListener('input', filterOrders);
    statusFilter?.addEventListener('change', filterOrders);
  }

  if (page.includes('team_permissions_view')) {
    const eventToken = new URLSearchParams(window.location.search).get('eventToken');
    if (eventToken) {
      apiRequest(`/api/public/team-events/${encodeURIComponent(eventToken)}`).then((result) => {
        const event = result.data;
        const assignmentRows = event.assignments.map((assignment) => `<li class="border-b border-white/10 py-4"><strong>${assignment.display_name}</strong><span class="ml-3 text-secondary">${assignment.role}</span><span class="ml-3 text-on-surface-variant">${assignment.assignment_group}</span></li>`).join('');
        const main = document.querySelector('main');
        if (main) main.innerHTML = `<div class="mx-auto max-w-3xl py-12"><p class="text-xs uppercase tracking-[0.2em] text-secondary">InGallery Event Roster</p><h1 class="mt-3 font-headline-lg text-4xl text-on-surface">${event.event_name}</h1><p class="mt-2 text-on-surface-variant">${event.event_date}</p><section class="glass-panel mt-8 rounded-xl p-6"><h2 class="font-headline-sm text-on-surface">Assigned Team</h2><ul class="mt-4">${assignmentRows}</ul></section></div>`;
      }).catch(() => {});
    }
    if (eventToken) return;
    const inviteButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim().toLowerCase().includes('invite member'));
    const permissionFields = '<label>Access</label><div class="mt-3 grid grid-cols-2 gap-2 text-sm"><label><input type="checkbox" name="permission" value="galleries" checked> Galleries</label><label><input type="checkbox" name="permission" value="clients"> Clients</label><label><input type="checkbox" name="permission" value="orders"> Orders</label><label><input type="checkbox" name="permission" value="storage"> Storage</label><label><input type="checkbox" name="permission" value="settings"> Settings</label><label><input type="checkbox" name="permission" value="team"> Team</label><label><input type="checkbox" name="permission" value="performance"> Performance</label></div>';
    const inviteMember = () => openActionModal('Invite Team Member', `<label>Name<input name="name" required></label><label>Email<input name="email" type="email" required></label><label>WhatsApp Phone<input name="phone" type="tel" placeholder="255712345678" required></label><label>Temporary Password<input name="password" type="password" minlength="8" required></label><label>Role<select name="role"><option value="photographer">Photographer</option><option value="videographer">Videographer</option><option value="retoucher">Retoucher</option><option value="lead-editor">Lead Editor</option><option value="admin">Admin</option></select></label><label>Performance Percentage<input name="performancePercentage" type="number" min="0" max="100" step="0.01" value="0" required></label><label>Commission Percentage<input name="commissionPercentage" type="number" min="0" max="100" step="0.01" value="0" required></label>${permissionFields}`, async (form, message) => {
      const member = { display_name: form.querySelector('[name="name"]')?.value.trim(), email: form.querySelector('[name="email"]')?.value.trim(), phone: form.querySelector('[name="phone"]')?.value.trim(), role: form.querySelector('[name="role"]')?.value, performance_percentage: Number(form.querySelector('[name="performancePercentage"]')?.value), commission_percentage: Number(form.querySelector('[name="commissionPercentage"]')?.value), permissions: Array.from(form.querySelectorAll('[name="permission"]:checked')).map((input) => input.value), member_id: `local-${Date.now()}` };
      try {
        const result = await apiRequest('/api/team/invite', { method: 'POST', body: JSON.stringify({ name: member.display_name, email: member.email, phone: member.phone, password: form.querySelector('[name="password"]')?.value, role: member.role, performancePercentage: member.performance_percentage, commissionPercentage: member.commission_percentage, permissions: member.permissions }) });
        if (message) { message.style.color = '#4deea3'; message.textContent = result.message || 'Member invited.'; }
        form.querySelector('[type="submit"]').textContent = 'Created';
      } catch (error) {
        if (message) message.textContent = error instanceof Error ? error.message : 'Unable to create team member.';
      }
    });
    const teamMain = document.querySelector('main');
    let availableRoles = ['videographer', 'photographer', 'retoucher', 'lead-editor'];
    apiRequest('/api/team/roles').then((result) => { availableRoles = result.data.filter((role) => role.role_key !== 'admin').map((role) => role.role_key); }).catch(() => {});
    const addRoleButton = document.createElement('button');
    addRoleButton.className = 'border border-white/20 text-on-surface px-5 py-3 rounded font-label-md text-label-md uppercase tracking-widest hover:border-secondary hover:text-secondary transition-colors';
    addRoleButton.textContent = 'Add Role';
    inviteButton?.parentElement?.appendChild(addRoleButton);
    addRoleButton.addEventListener('click', () => openActionModal('Add Studio Role', '<label>Role Name<input name="roleName" placeholder="Drone Operator" required></label><p class="mt-4 text-sm text-on-surface-variant">This role will appear in member invitations and event scheduling.</p>', async (form, message, close) => {
      const roleName = form.querySelector('[name="roleName"]')?.value.trim() || '';
      const roleKey = roleName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
      if (!roleKey) throw new Error('Enter a valid role name.');
      try {
        const result = await apiRequest('/api/team/roles', { method: 'POST', body: JSON.stringify({ roleName }) });
        availableRoles.push(result.data.role_key);
        if (message) { message.style.color = '#4deea3'; message.textContent = 'Role added to your studio.'; }
      } catch (error) {
        if (message) message.textContent = error instanceof Error ? error.message : 'Unable to save this role.';
        return;
      }
      setTimeout(close, 1200);
    }));
    inviteButton?.addEventListener('click', () => setTimeout(() => {
      const roleSelect = document.querySelector('.ingallery-action-modal select[name="role"]');
      if (!roleSelect) return;
      availableRoles.forEach((role) => {
        if (roleSelect.querySelector(`option[value="${role}"]`)) return;
        const option = document.createElement('option');
        option.value = role;
        option.textContent = role.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
        roleSelect.appendChild(option);
      });
    }, 0));
    const eventButton = document.createElement('button');
    eventButton.className = 'border border-secondary text-secondary px-5 py-3 rounded font-label-md text-label-md uppercase tracking-widest hover:bg-secondary/10 transition-colors';
    eventButton.textContent = 'Schedule Event';
    inviteButton?.parentElement?.appendChild(eventButton);
    eventButton.addEventListener('click', () => openActionModal('Schedule Studio Event', '<label>Event Name<input name="eventName" placeholder="Smith Wedding" required></label><label>Event Date<input name="eventDate" type="date" required></label><label>Teams Needed<input name="teamCount" type="number" min="1" max="20" value="1" required></label><p class="mt-4 text-sm text-on-surface-variant">The system selects available teams with the lowest event workload for this date.</p>', async (form, message, close) => {
      const result = await apiRequest('/api/team/events', { method: 'POST', body: JSON.stringify({ eventName: form.querySelector('[name="eventName"]')?.value.trim(), eventDate: form.querySelector('[name="eventDate"]')?.value, teamCount: Number(form.querySelector('[name="teamCount"]')?.value) }) });
      if (message) { message.style.color = '#4edea3'; message.textContent = `Assigned: ${result.data.selectedTeams.join(', ')}`; }
      setTimeout(close, 1000);
    }));

    const roleEventButton = eventButton.cloneNode(true);
    eventButton.replaceWith(roleEventButton);
    roleEventButton.addEventListener('click', () => openActionModal('Schedule Studio Event', '<label>Event Name<input name="eventName" placeholder="Smith Wedding" required></label><label>Event Date<input name="eventDate" type="date" required></label><label>Videographers Needed<input name="videographerCount" type="number" min="0" max="20" value="0" required></label><label>Photographers Needed<input name="photographerCount" type="number" min="0" max="20" value="1" required></label><label>Retouchers Needed<input name="retoucherCount" type="number" min="0" max="20" value="0" required></label><label>Lead Editors Needed<input name="leadEditorCount" type="number" min="0" max="20" value="0" required></label><p class="mt-4 text-sm text-on-surface-variant">The highest-performing available person is selected for each requested role. People already booked on this date are skipped.</p>', async (form, message, close) => {
      const roleRequirements = { videographer: Number(form.querySelector('[name="videographerCount"]')?.value), photographer: Number(form.querySelector('[name="photographerCount"]')?.value), retoucher: Number(form.querySelector('[name="retoucherCount"]')?.value), 'lead-editor': Number(form.querySelector('[name="leadEditorCount"]')?.value) };
      const result = await apiRequest('/api/team/events', { method: 'POST', body: JSON.stringify({ eventName: form.querySelector('[name="eventName"]')?.value.trim(), eventDate: form.querySelector('[name="eventDate"]')?.value, roleRequirements }) });
      if (message) { message.style.color = '#4deea3'; message.textContent = `Assigned ${result.data.assignments.length} team member(s) by performance.`; }
      setTimeout(close, 1000);
    }));

    const dynamicRoleEventButton = roleEventButton.cloneNode(true);
    roleEventButton.replaceWith(dynamicRoleEventButton);
    dynamicRoleEventButton.addEventListener('click', () => {
      const roleFields = availableRoles.map((role) => `<label>${role.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())} Needed<input name="role-${role}" type="number" min="0" max="20" value="0" required></label>`).join('');
      openActionModal('Schedule Studio Event', `<label>Event Name<input name="eventName" placeholder="Smith Wedding" required></label><label>Event Date<input name="eventDate" type="date" required></label>${roleFields}<p class="mt-4 text-sm text-on-surface-variant">The highest-performing available person is selected for each requested role. People already booked on this date are skipped.</p>`, async (form, message, close) => {
        const roleRequirements = Object.fromEntries(availableRoles.map((role) => [role, Number(form.querySelector(`[name="role-${role}"]`)?.value)]));
        const result = await apiRequest('/api/team/events', { method: 'POST', body: JSON.stringify({ eventName: form.querySelector('[name="eventName"]')?.value.trim(), eventDate: form.querySelector('[name="eventDate"]')?.value, roleRequirements }) });
        if (message) {
          message.style.color = '#4deea3';
          const rosterUrl = `${window.location.origin}/team_permissions_view/code.html?eventToken=${encodeURIComponent(result.data.access_token)}`;
          message.innerHTML = `Assigned ${result.data.assignments.length} member(s) by performance.<div class="mt-3 space-y-2">${result.data.assignments.map((assignment) => { const text = `InGallery event ${form.querySelector('[name="eventName"]')?.value.trim()} on ${form.querySelector('[name="eventDate"]')?.value}: you are assigned as ${assignment.role} in ${assignment.assignment_group}. Team roster: ${rosterUrl}`; const whatsapp = assignment.member_phone ? `https://wa.me/${assignment.member_phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}` : ''; return whatsapp ? `<a class="block text-secondary underline" target="_blank" rel="noreferrer" href="${whatsapp}">WhatsApp ${assignment.role}</a>` : `<span class="block text-on-surface-variant">${assignment.role}: add a phone number to enable WhatsApp</span>`; }).join('')}</div>`;
        }
        setTimeout(close, 1000);
      });
    });

    const roster = teamMain?.querySelector('tbody');
    const renderMemberRow = (member) => `<tr class="border-b border-white/5" data-member-id="${member.member_id}"><td class="py-4"><div class="font-medium">${member.display_name}</div><div class="text-sm text-on-surface-variant">${member.email}</div></td><td class="py-4">${member.role}</td><td class="py-4">Performance ${member.performance_percentage}% · Commission ${member.commission_percentage}%</td><td class="py-4 text-right"><button class="text-secondary mr-3" data-score-member="${member.member_id}">Score</button><button class="text-secondary" data-edit-member="${member.member_id}">Edit</button></td></tr>`;
    apiRequest('/api/team/members').then((result) => {
      if (!roster || !result.data?.length) return;
      roster.innerHTML = result.data.map(renderMemberRow).join('');
      roster.querySelectorAll('[data-edit-member]').forEach((button) => button.addEventListener('click', () => {
        const member = result.data.find((item) => item.member_id === button.dataset.editMember);
        if (!member) return;
        openActionModal(`Edit ${member.display_name}`, `<label>Role<select name="role"><option value="photographer">Photographer</option><option value="retoucher">Retoucher</option><option value="lead-editor">Lead Editor</option><option value="admin">Admin</option></select></label><label>Team Name<input name="teamName" value="${member.team_name}"></label><label>Commission Percentage<input name="commissionPercentage" type="number" min="0" max="100" step="0.01" value="${member.commission_percentage}"></label>${permissionFields}`, async (form, message, close) => {
          const permissions = Array.from(form.querySelectorAll('[name="permission"]:checked')).map((input) => input.value);
          await apiRequest(`/api/team/members/${encodeURIComponent(member.member_id)}`, { method: 'PATCH', body: JSON.stringify({ role: form.querySelector('[name="role"]')?.value, teamName: form.querySelector('[name="teamName"]')?.value.trim(), commissionPercentage: Number(form.querySelector('[name="commissionPercentage"]')?.value), permissions }) });
          if (message) { message.style.color = '#4edea3'; message.textContent = 'Member updated.'; }
          setTimeout(() => { close(); window.location.reload(); }, 600);
        });
      }));
      roster.querySelectorAll('[data-score-member]').forEach((button) => button.addEventListener('click', async () => {
        const member = result.data.find((item) => item.member_id === button.dataset.scoreMember);
        if (!member) return;
        let history = [];
        try { history = (await apiRequest(`/api/team/members/${encodeURIComponent(member.member_id)}/performance`)).data; } catch {}
        const historyText = history.length ? `<div class="mt-4 border-t border-white/10 pt-3 text-sm text-on-surface-variant">${history.slice(0, 5).map((entry) => `${entry.performance_percentage}% · ${new Date(entry.created_at).toLocaleDateString()}`).join('<br>')}</div>` : '';
        openActionModal(`Score ${member.display_name}`, `<label>Performance Percentage<input name="performancePercentage" type="number" min="0" max="100" step="0.01" value="${member.performance_percentage}" required></label><p class="mt-4 text-sm text-on-surface-variant">Higher scores are selected first when this person matches an event role.</p>${historyText}`, async (form, message, close) => {
          await apiRequest(`/api/team/members/${encodeURIComponent(member.member_id)}`, { method: 'PATCH', body: JSON.stringify({ role: member.role, performancePercentage: Number(form.querySelector('[name="performancePercentage"]')?.value), commissionPercentage: member.commission_percentage, teamName: member.team_name, permissions: member.permissions || [] }) });
          if (message) { message.style.color = '#4deea3'; message.textContent = 'Performance score updated.'; }
          setTimeout(() => { close(); window.location.reload(); }, 600);
        });
      }));
    }).catch(() => {});
  }

  if (page.includes('team_permissions_view') && !new URLSearchParams(window.location.search).get('eventToken')) {
    const calendar = document.createElement('section');
    calendar.className = 'glass-panel rounded-xl p-6 mt-8';
    calendar.innerHTML = '<div class="flex items-center justify-between"><h3 class="font-headline-sm text-headline-sm text-on-surface">Event Calendar</h3><span class="text-xs uppercase tracking-widest text-on-surface-variant">Upcoming assignments</span></div><div data-event-calendar class="mt-4 space-y-3"><p class="text-sm text-on-surface-variant">Loading events...</p></div>';
    document.querySelector('main')?.appendChild(calendar);
    const renderCalendarEvents = (events) => {
      const list = calendar.querySelector('[data-event-calendar]');
      if (!list) return;
      list.innerHTML = events.length ? events.map((event) => `<div class="flex flex-col gap-2 border-b border-white/10 pb-3 last:border-0"><div class="flex items-center justify-between"><strong class="text-on-surface">${event.event_name || event.eventName}</strong><span class="text-secondary">${event.event_date || event.eventDate}</span></div><p class="text-sm text-on-surface-variant">${Object.entries(event.role_requirements || event.roleRequirements || {}).map(([role, count]) => `${count} ${role.replace(/-/g, ' ')}`).join(' · ')}</p></div>`).join('') : '<p class="text-sm text-on-surface-variant">No events scheduled yet.</p>';
    };
    apiRequest('/api/team/events').then((result) => {
      renderCalendarEvents(result.data);
    }).catch(() => renderCalendarEvents([]));
  }

  const paymentButton = Array.from(document.querySelectorAll('button')).find((button) =>
    (button.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase().includes('record manual payment')
  );
  if (paymentButton) {
    const backdrop = document.createElement('div');
    backdrop.className = 'ingallery-payment-backdrop';
    backdrop.innerHTML = `
      <form class="ingallery-payment-modal" data-manual-payment-form>
        <h2>Record Manual Payment</h2>
        <label>Client<input name="client" type="text" placeholder="Client name" required></label>
        <label>Gallery<input name="gallery" type="text" placeholder="Gallery name" required></label>
        <label>Amount (TZS)<input name="amount" type="number" min="1" step="1" placeholder="350000" required></label>
        <label>Payment method<select name="method"><option>Bank Transfer</option><option>Cash</option><option>Mobile Money</option><option>Cheque</option></select></label>
        <div class="ingallery-payment-message" data-payment-message></div>
        <div class="ingallery-payment-actions"><button type="button" data-payment-cancel>Cancel</button><button type="submit">Record Payment</button></div>
      </form>
    `;
    document.body.appendChild(backdrop);

    const closePayment = () => backdrop.classList.remove('is-open');
    paymentButton.addEventListener('click', () => backdrop.classList.add('is-open'));
    backdrop.querySelector('[data-payment-cancel]')?.addEventListener('click', closePayment);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) closePayment();
    });

    backdrop.querySelector('[data-manual-payment-form]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const client = form.querySelector('[name="client"]')?.value.trim();
      const gallery = form.querySelector('[name="gallery"]')?.value.trim();
      const amount = Number(form.querySelector('[name="amount"]')?.value);
      const method = form.querySelector('[name="method"]')?.value;
      const message = form.querySelector('[data-payment-message]');
      if (!client || !gallery || !Number.isFinite(amount) || amount <= 0) {
        if (message) message.textContent = 'Enter a client, gallery, and valid amount.';
        return;
      }

      try {
        await apiRequest('/api/orders/manual', { method: 'POST', body: JSON.stringify({ clientName: client, galleryName: gallery, amount, method }) });
        closePayment();
        form.reset();
        window.location.reload();
      } catch (error) {
        if (message) message.textContent = error instanceof Error ? error.message : 'Unable to record this payment.';
      }
    });
  }

  const current = page.match(/(photographer_dashboard_overview|client_management_dashboard|order_management_dashboard|storage_hosting_dashboard|studio_performance_report|marketing_seo_settings|team_permissions_view|create_new_gallery_form)/)?.[1];
  const currentKey = current === 'photographer_dashboard_overview' || current === 'ingallery_photography_studio_platform' || current === 'create_new_gallery_form' ? 'galleries' : {
    client_management_dashboard: 'clients',
    order_management_dashboard: 'orders',
    storage_hosting_dashboard: 'storage',
    studio_performance_report: 'performance',
    marketing_seo_settings: 'settings',
    team_permissions_view: 'settings'
  }[current];
  if (currentKey) sidebar?.querySelector(`[data-nav-key="${currentKey}"]`)?.setAttribute('aria-current', 'page');

  const updateSidebarStorage = async () => {
    try {
        if (isClientFacingPage) return;
        let session = null;
        try { session = JSON.parse(window.localStorage.getItem('ingallery:session') || 'null'); } catch {}
        if (!session?.isAuthenticated || !session?.accessToken) return;
        const response = await fetch(`${resolveApiBaseUrl()}/api/storage`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
          cache: 'no-store'
        });
        if (!response.ok) return;
        const { data } = await response.json();
        const used = data.totalUsedBytes || 0;
        const limit = data.effectiveLimitBytes || 1;
        const usedGB = (used / (1024**3)).toFixed(1);
        const limitGB = (limit / (1024**3)).toFixed(1);
        const percent = Math.min(100, Math.round((used / limit) * 100));
        const valueEl = document.querySelector('.ingallery-sidebar__storage-value');
        const fillEl = document.querySelector('.ingallery-sidebar__storage-fill');
        if (valueEl) valueEl.textContent = `${usedGB} / ${limitGB} GB`;
        if (fillEl) fillEl.style.width = `${percent}%`;
    } catch (e) { console.error('Sidebar storage update failed', e); }
  };
  updateSidebarStorage();
  setInterval(updateSidebarStorage, 60000);
})();
