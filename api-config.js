// Set this to the deployed API origin when the website and API use different hosts.
window.PEFRIKA_API_BASE_URL = '';

const adminApiBaseUrl = window.PEFRIKA_API_BASE_URL.replace(/\/+$/, '');
if (adminApiBaseUrl) {
    document.querySelectorAll('[data-admin-link]').forEach(link => {
        link.href = `${adminApiBaseUrl}/admin.html`;
    });
}
