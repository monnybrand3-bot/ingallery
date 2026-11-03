"use strict";
(() => {
    const root = '../';
    const routes = {
        dashboard: 'photographer_dashboard_overview/code.html',
        galleries: 'photographer_dashboard_overview/code.html',
        gallery: 'public_gallery_unpaid/code.html',
        collections: 'photographer_dashboard_overview/code.html',
        clients: 'client_management_dashboard/code.html',
        orders: 'order_management_dashboard/code.html',
        storage: 'storage_hosting_dashboard/code.html',
        settings: 'marketing_seo_settings/code.html',
        team: 'team_permissions_view/code.html',
        performance: 'studio_performance_report/code.html',
        plans: 'subscription_storage_plans/code.html',
        checkout: 'client_checkout_flow/code.html',
        pending: 'payment_pending_status/code.html',
        success: 'public_gallery_unpaid/code.html',
        create: 'create_new_gallery_form/code.html',
        'upload new gallery': 'create_new_gallery_form/code.html',
        'create new gallery': 'create_new_gallery_form/code.html',
        'create gallery': 'create_new_gallery_form/code.html',
        'back to galleries': 'photographer_dashboard_overview/code.html',
        'view all': 'photographer_dashboard_overview/code.html',
        'view gallery': 'public_gallery_unpaid/code.html',
        'unlock now': 'client_checkout_flow/code.html',
        'client access': 'client_detail_view/code.html'
    };
    const keyFor = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase();
    const labelFor = (element) => {
        const icon = element.querySelector('.material-symbols-outlined');
        const text = element.textContent ?? '';
        return keyFor(icon ? text.replace(icon.textContent ?? '', '') : text);
    };
    const go = (target) => {
        if (target)
            window.location.href = root + target;
    };
    document.querySelectorAll('a').forEach((link) => {
        const target = routes[labelFor(link)];
        if (target)
            link.href = root + target;
    });
    document.querySelectorAll('button').forEach((button) => {
        const target = routes[labelFor(button)];
        if (!target || button.getAttribute('onclick') || button.closest('form'))
            return;
        button.addEventListener('click', () => go(target));
    });
    const galleryForm = document.querySelector('form');
    if (galleryForm && window.location.pathname.includes('create_new_gallery_form')) {
        galleryForm.addEventListener('submit', (event) => {
            event.preventDefault();
            const titleInput = document.querySelector('#gallery-title');
            const title = titleInput?.value.trim();
            if (!title) {
                titleInput?.focus();
                return;
            }
            window.localStorage.setItem('ingallery:lastGallery', JSON.stringify({ title, createdAt: new Date().toISOString() }));
            go(routes.dashboard);
        });
    }
    const saveButton = Array.from(document.querySelectorAll('button'))
        .find((button) => labelFor(button) === 'save settings');
    if (saveButton) {
        saveButton.addEventListener('click', () => {
            saveButton.textContent = 'Saved';
            saveButton.disabled = true;
            window.setTimeout(() => {
                saveButton.textContent = 'Save Settings';
                saveButton.disabled = false;
            }, 1800);
        });
    }
})();
