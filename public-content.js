(async function applyWebsiteContent() {
    const apiBaseUrl = (window.PEFRIKA_API_BASE_URL || '').replace(/\/+$/, '');
    const page = window.location.pathname.toLowerCase().endsWith('/blog.html') ? 'blog' : 'index';
    if (new URLSearchParams(window.location.search).has('adminPreview')) {
        return;
    }

    function getNodeAtPath(root, key) {
        let current = root;
        for (const index of key.split('.').map(Number)) {
            current = current?.childNodes[index];
            if (!current) {
                return null;
            }
        }
        return current;
    }

    try {
        const response = await fetch(`${apiBaseUrl}/api/content`, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Content service returned HTTP ${response.status}.`);
        }
        const content = await response.json();
        const pageContent = content[page];
        if (!pageContent) {
            return;
        }

        for (const [key, value] of Object.entries(pageContent.texts || {})) {
            const node = getNodeAtPath(document.body, key);
            if (node?.nodeType === Node.TEXT_NODE && typeof value === 'string') {
                node.nodeValue = value;
            }
        }
        for (const [key, value] of Object.entries(pageContent.hrefs || {})) {
            const element = getNodeAtPath(document.body, key);
            if (element?.tagName === 'A' && typeof value === 'string') {
                element.setAttribute('href', value);
            }
        }
    } catch (error) {
        console.warn('Website content overrides were not applied:', error.message);
    }
})();
