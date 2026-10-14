const apiBaseUrl = (window.PEFRIKA_API_BASE_URL || '').replace(/\/+$/, '');
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const editorList = document.getElementById('editor-list');
const pageSelect = document.getElementById('page-select');
const sectionSelect = document.getElementById('section-select');
const searchInput = document.getElementById('search-input');
const previewFrame = document.getElementById('preview-frame');
const dashboardStatus = document.getElementById('dashboard-status');
const saveButton = document.getElementById('save-button');
const previewPages = {
    index: { url: 'index.html?adminPreview=1', label: 'Home page' },
    blog: { url: 'blog.html?adminPreview=1', label: 'Blog page' }
};
const dashboardApiIsCrossOrigin = Boolean(apiBaseUrl) && new URL(apiBaseUrl, window.location.href).origin !== window.location.origin;

let savedContent = {};
let pageFields = [];
const pageBaselines = {};
let activePage = 'index';
let renderGeneration = 0;

function apiUrl(path) {
    return `${apiBaseUrl}${path}`;
}

async function request(path, options = {}) {
    const response = await fetch(apiUrl(path), {
        ...options,
        credentials: 'include',
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers
        }
    });

    if (response.status === 204) {
        return null;
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.error || `Request failed (${response.status}).`);
    }
    return body;
}

function showStatus(message, isError = false) {
    dashboardStatus.textContent = message;
    dashboardStatus.className = `mb-5 rounded-xl border p-3 text-sm ${isError
        ? 'border-red-200 bg-red-50 text-red-800'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`;
}

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

function getTextNodes(doc) {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
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

function getGroup(node, doc) {
    let current = node.parentElement;
    while (current && current !== doc.body) {
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

function findLink(node) {
    return node.parentElement?.closest('a[href]') ?? null;
}

function loadContentIntoPreview() {
    const doc = previewFrame.contentDocument;
    if (!doc?.body) {
        throw new Error('The preview could not be loaded. Check that the website and admin dashboard share the same origin.');
    }

    if (!pageBaselines[activePage]) {
        const texts = {};
        for (const node of getTextNodes(doc)) {
            const key = getNodePath(doc.body, node);
            if (key !== null) {
                texts[key] = node.nodeValue;
            }
        }
        const hrefs = {};
        for (const link of doc.querySelectorAll('a[href]')) {
            const key = getNodePath(doc.body, link);
            if (key !== null) {
                hrefs[key] = link.getAttribute('href');
            }
        }
        pageBaselines[activePage] = { texts, hrefs };
    }

    const overrides = savedContent[activePage] || { texts: {}, hrefs: {} };
    const nodes = getTextNodes(doc);
    for (const node of nodes) {
        const key = getNodePath(doc.body, node);
        if (key !== null && Object.hasOwn(overrides.texts || {}, key)) {
            node.nodeValue = overrides.texts[key];
        }
    }
    for (const [key, href] of Object.entries(overrides.hrefs || {})) {
        const link = getNodeAtPath(doc.body, key);
        if (link?.nodeType === Node.ELEMENT_NODE && link.tagName === 'A') {
            link.setAttribute('href', href);
        }
    }
    return doc;
}

function makeEditorField(field) {
    const container = document.createElement('div');
    container.className = 'rounded-xl border border-slate-200 p-3 sm:p-4';

    const label = document.createElement('label');
    label.className = 'block text-xs font-semibold text-slate-500 mb-2';
    label.textContent = `${field.group} · ${field.element}`;
    container.appendChild(label);

    const input = field.value.length > 100
        ? document.createElement('textarea')
        : document.createElement('input');
    if (input.tagName === 'TEXTAREA') {
        input.rows = Math.min(6, Math.max(2, Math.ceil(field.value.length / 90)));
    } else {
        input.type = 'text';
    }
    input.value = field.value;
    input.maxLength = 5000;
    input.className = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500';
    input.setAttribute('aria-label', `${field.group} text`);
    input.addEventListener('input', () => {
        field.value = input.value;
        const prefix = field.original.match(/^\s*/)?.[0] || '';
        const suffix = field.original.match(/\s*$/)?.[0] || '';
        const currentNode = getNodeAtPath(previewFrame.contentDocument.body, field.path);
        if (currentNode?.nodeType === Node.TEXT_NODE) {
            currentNode.nodeValue = `${prefix}${input.value}${suffix}`;
        }

        const pageData = savedContent[activePage] || { texts: {}, hrefs: {} };
        pageData.texts ||= {};
        const originalValue = field.original.slice(prefix.length, field.original.length - suffix.length);
        if (input.value === originalValue) {
            delete pageData.texts[field.path];
        } else {
            pageData.texts[field.path] = `${prefix}${input.value}${suffix}`;
        }
        savedContent[activePage] = pageData;
    });
    container.appendChild(input);

    if (field.linkPath !== null) {
        const linkLabel = document.createElement('label');
        linkLabel.className = 'block text-xs font-semibold text-slate-500 mt-3 mb-2';
        linkLabel.textContent = 'Link destination';
        container.appendChild(linkLabel);

        const linkInput = document.createElement('input');
        linkInput.type = 'text';
        linkInput.value = field.href;
        linkInput.maxLength = 2048;
        linkInput.placeholder = 'https://, mailto:, tel:, /page, or #section';
        linkInput.className = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500';
        linkInput.setAttribute('aria-label', `${field.group} link destination`);
        linkInput.addEventListener('input', () => {
            field.href = linkInput.value.trim();
            const pageData = savedContent[activePage] || { texts: {}, hrefs: {} };
            pageData.hrefs ||= {};
            if (field.href === field.originalHref) {
                delete pageData.hrefs[field.linkPath];
            } else {
                pageData.hrefs[field.linkPath] = field.href;
            }
            savedContent[activePage] = pageData;

            const previewLink = getNodeAtPath(previewFrame.contentDocument.body, field.linkPath);
            if (previewLink?.tagName === 'A' && isSafeLink(field.href)) {
                previewLink.setAttribute('href', field.href);
            }
        });
        container.appendChild(linkInput);
    }

    return container;
}

function isSafeLink(value) {
    if (!value) {
        return true;
    }
    if (/[\u0000-\u0020\u007f]/.test(value) || value.startsWith('//')) {
        return false;
    }
    try {
        const url = new URL(value, window.location.origin);
        return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol);
    } catch {
        return false;
    }
}

function renderEditor() {
    const generation = ++renderGeneration;
    const doc = loadContentIntoPreview();
    pageFields = getTextNodes(doc).map(node => {
        const path = getNodePath(doc.body, node);
        const link = findLink(node);
        const linkPath = link ? getNodePath(doc.body, link) : null;
        const override = savedContent[activePage] || {};
        return {
            path,
            node,
            value: node.nodeValue.replace(/^\s+|\s+$/g, ''),
            original: pageBaselines[activePage].texts[path] ?? node.nodeValue,
            group: getGroup(node, doc),
            element: node.parentElement.tagName.toLowerCase(),
            linkPath,
            href: link && Object.hasOwn(override.hrefs || {}, linkPath) ? override.hrefs[linkPath] : link?.getAttribute('href') || '',
            originalHref: link ? pageBaselines[activePage].hrefs[linkPath] || '' : ''
        };
    }).filter(field => field.path !== null);

    const groups = [...new Set(pageFields.map(field => field.group))];
    sectionSelect.replaceChildren(new Option('All sections', ''));
    for (const group of groups) {
        sectionSelect.add(new Option(group, group));
    }

    editorList.replaceChildren();
    const selectedGroup = sectionSelect.value;
    const query = searchInput.value.trim().toLocaleLowerCase();
    const fields = pageFields.filter(field =>
        (!selectedGroup || field.group === selectedGroup) &&
        (!query || `${field.group} ${field.value} ${field.href}`.toLocaleLowerCase().includes(query))
    );

    if (generation !== renderGeneration) {
        return;
    }

    if (!fields.length) {
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'text-center text-sm text-slate-500 py-10';
        emptyMessage.textContent = 'No matching content found on this page.';
        editorList.appendChild(emptyMessage);
        return;
    }

    const count = document.createElement('p');
    count.className = 'text-xs text-slate-500';
    count.textContent = `${fields.length} editable text item${fields.length === 1 ? '' : 's'} on this page`;
    editorList.appendChild(count);

    for (const field of fields) {
        editorList.appendChild(makeEditorField(field));
    }
}

async function loadDashboard() {
    savedContent = await request('/api/content');
    loginScreen.classList.add('hidden');
    dashboardScreen.classList.remove('hidden');
    renderEditor();
}

async function changePage(page) {
    activePage = page;
    const details = previewPages[page];
    document.getElementById('preview-label').textContent = details.label;
    editorList.textContent = 'Loading page content…';
    if (!previewFrame.src.endsWith(details.url)) {
        await new Promise((resolve, reject) => {
            previewFrame.onload = resolve;
            previewFrame.onerror = () => reject(new Error('The selected page preview could not be loaded.'));
            previewFrame.src = details.url;
        });
    }
    renderEditor();
}

loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const loginButton = document.getElementById('login-button');
    loginButton.disabled = true;
    loginButton.textContent = 'Signing in…';
    loginError.classList.add('hidden');

    try {
        await request('/api/login', {
            method: 'POST',
            body: JSON.stringify({
                username: document.getElementById('username').value,
                password: document.getElementById('password').value
            })
        });
        await loadDashboard();
    } catch (error) {
        loginError.textContent = error.message;
        loginError.classList.remove('hidden');
    } finally {
        loginButton.disabled = false;
        loginButton.textContent = 'Sign in';
    }
});

document.getElementById('logout-button').addEventListener('click', async () => {
    try {
        await request('/api/logout', { method: 'POST' });
        dashboardScreen.classList.add('hidden');
        loginScreen.classList.remove('hidden');
    } catch (error) {
        showStatus(error.message, true);
    }
});

saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    saveButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Saving…';
    try {
        await request('/api/content', {
            method: 'PUT',
            body: JSON.stringify(savedContent)
        });
        showStatus('Changes saved. Visitors will see the updates when they reload the website.');
    } catch (error) {
        showStatus(error.message, true);
    } finally {
        saveButton.disabled = false;
        saveButton.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i>Save changes';
    }
});

document.getElementById('reload-button').addEventListener('click', async () => {
    try {
        savedContent = await request('/api/content');
        previewFrame.src = previewPages[activePage].url;
        await new Promise(resolve => { previewFrame.onload = resolve; });
        renderEditor();
        showStatus('Saved website content reloaded.');
    } catch (error) {
        showStatus(error.message, true);
    }
});

pageSelect.addEventListener('change', async () => {
    try {
        await changePage(pageSelect.value);
    } catch (error) {
        showStatus(error.message, true);
    }
});
sectionSelect.addEventListener('change', renderEditor);
searchInput.addEventListener('input', renderEditor);

if (dashboardApiIsCrossOrigin) {
    window.location.replace(`${apiBaseUrl}/admin.html`);
} else {
    request('/api/session')
        .then(session => session.authenticated ? loadDashboard() : null)
        .catch(error => {
            loginError.textContent = `The dashboard API is not available: ${error.message}`;
            loginError.classList.remove('hidden');
        });
}
