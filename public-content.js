(async function applyWebsiteContent() {
    const apiBaseUrl = (window.PEFRIKA_API_BASE_URL || '').replace(/\/+$/, '');
    const page = window.location.pathname.toLowerCase().endsWith('/blog.html') ? 'blog' : 'index';
    if (new URLSearchParams(window.location.search).has('adminPreview')) {
        const adminOrigin = new URL(window.PEFRIKA_ADMIN_ORIGIN).origin;
        let baseline;

        function getNodePath(root, node) {
            const path = [];
            let current = node;
            while (current && current !== root) {
                const parent = current.parentNode;
                if (!parent) {
                    return null;
                }
                path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
                current = parent;
            }
            return current === root ? path.join('.') : null;
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

        function getTextNodes() {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    if (!node.nodeValue.trim()) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    const parent = node.parentElement;
                    if (!parent || parent.closest('script, style, noscript, title, textarea, input, select, option, svg')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            });
            const nodes = [];
            while (walker.nextNode()) {
                nodes.push(walker.currentNode);
            }
            return nodes;
        }

        function getGroup(node) {
            let current = node.parentElement;
            while (current && current !== document.body) {
                if (['SECTION', 'ARTICLE', 'HEADER', 'FOOTER'].includes(current.tagName)) {
                    const heading = current.querySelector('h1, h2, h3, h4');
                    if (heading) {
                        return heading.textContent.trim().replace(/\s+/g, ' ').slice(0, 80);
                    }
                    if (current.id) {
                        return current.id.replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
                    }
                    return current.tagName === 'FOOTER' ? 'Footer' : 'Header';
                }
                current = current.parentElement;
            }
            return 'Page content';
        }

        function collectBaseline() {
            const texts = {};
            for (const node of getTextNodes()) {
                const key = getNodePath(document.body, node);
                if (key !== null) {
                    texts[key] = node.nodeValue;
                }
            }
            const hrefs = {};
            for (const link of document.querySelectorAll('a[href]')) {
                const key = getNodePath(document.body, link);
                if (key !== null) {
                    hrefs[key] = link.getAttribute('href');
                }
            }
            return { texts, hrefs };
        }

        function isSafeLink(value) {
            if (!value) {
                return true;
            }
            if (/[\u0000-\u0020\u007f]/.test(value) || value.startsWith('//')) {
                return false;
            }
            try {
                return ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(value, window.location.origin).protocol);
            } catch {
                return false;
            }
        }

        function inspect(content) {
            baseline ||= collectBaseline();
            const overrides = content?.[page] || { texts: {}, hrefs: {} };
            for (const [key, value] of Object.entries(baseline.texts)) {
                const node = getNodeAtPath(document.body, key);
                if (node?.nodeType === Node.TEXT_NODE) {
                    node.nodeValue = Object.hasOwn(overrides.texts || {}, key) ? overrides.texts[key] : value;
                }
            }
            for (const [key, value] of Object.entries(baseline.hrefs)) {
                const link = getNodeAtPath(document.body, key);
                if (link?.tagName === 'A') {
                    link.setAttribute('href', Object.hasOwn(overrides.hrefs || {}, key) ? overrides.hrefs[key] : value);
                }
            }

            return getTextNodes().flatMap(node => {
                const key = getNodePath(document.body, node);
                if (key === null || !Object.hasOwn(baseline.texts, key)) {
                    return [];
                }
                const link = node.parentElement?.closest('a[href]') ?? null;
                const linkPath = link ? getNodePath(document.body, link) : null;
                return [{
                    path: key,
                    value: node.nodeValue,
                    original: baseline.texts[key],
                    group: getGroup(node),
                    element: node.parentElement.tagName.toLowerCase(),
                    linkPath,
                    href: link?.getAttribute('href') || '',
                    originalHref: linkPath === null ? '' : baseline.hrefs[linkPath] || ''
                }];
            });
        }

        window.addEventListener('message', event => {
            if (event.source !== window.parent || event.origin !== adminOrigin) {
                return;
            }
            const message = event.data;
            if (!message || message.channel !== 'pefrika-admin-preview' || typeof message.requestId !== 'string') {
                return;
            }
            let result;
            if (message.action === 'inspect') {
                result = inspect(message.content);
            } else if (message.action === 'setText' && /^\d+(?:\.\d+)*$/.test(message.path) &&
                typeof message.value === 'string' && message.value.length <= 5000) {
                const node = getNodeAtPath(document.body, message.path);
                if (node?.nodeType === Node.TEXT_NODE) {
                    node.nodeValue = message.value;
                }
            } else if (message.action === 'setHref' && /^\d+(?:\.\d+)*$/.test(message.path) &&
                typeof message.value === 'string' && message.value.length <= 2048 && isSafeLink(message.value)) {
                const link = getNodeAtPath(document.body, message.path);
                if (link?.tagName === 'A') {
                    link.setAttribute('href', message.value);
                }
            } else {
                return;
            }
            window.parent.postMessage({
                channel: 'pefrika-admin-preview',
                requestId: message.requestId,
                result
            }, adminOrigin);
        });
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
