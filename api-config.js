window.PEFRIKA_API_BASE_URL = 'https://pefrika-admin.onrender.com';
window.PEFRIKA_PUBLIC_SITE_URL = 'https://pefrika-website.vercel.app';
window.PEFRIKA_ADMIN_ORIGIN = 'https://pefrika-admin.onrender.com';

const adminApiBaseUrl = window.PEFRIKA_API_BASE_URL.replace(/\/+$/, '');
if (adminApiBaseUrl) {
    document.querySelectorAll('[data-admin-link]').forEach(link => {
        link.href = `${adminApiBaseUrl}/admin.html`;
    });
}
