import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../server.js';

const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pefrika-admin-test-'));
const origin = 'http://localhost:3000';
const publicOrigin = 'https://pefrika-website.vercel.app';
const adminOrigin = 'https://pefrika-admin.onrender.com';
const server = createApp({
    adminUsername: 'test-admin',
    adminPassword: 'test-password',
    sessionSecret: 'test-session-secret-that-is-long-enough-32',
    dataDirectory,
    siteOrigins: [origin, publicOrigin, adminOrigin],
    production: false
}).listen(0);

let baseUrl;
let cookie;

before(async () => {
    await new Promise(resolve => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await fs.rm(dataDirectory, { recursive: true, force: true });
});

async function api(pathname, options = {}) {
    return fetch(`${baseUrl}${pathname}`, {
        ...options,
        headers: {
            Origin: origin,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
            ...options.headers
        }
    });
}

test('content can be read publicly and editing requires authentication', async () => {
    const publicResponse = await api('/api/content');
    assert.equal(publicResponse.status, 200);
    assert.deepEqual(await publicResponse.json(), {});

    const deniedResponse = await api('/api/content', {
        method: 'PUT',
        body: JSON.stringify({})
    });
    assert.equal(deniedResponse.status, 401);
    assert.equal((await api('/api/appointments')).status, 401);
});

test('admin login sets a valid session cookie', async () => {
    const invalidResponse = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'test-admin', password: 'incorrect' })
    });
    assert.equal(invalidResponse.status, 401);

    const loginResponse = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'test-admin', password: 'test-password' })
    });
    assert.equal(loginResponse.status, 200);
    cookie = loginResponse.headers.get('set-cookie').split(';')[0];

    const sessionResponse = await api('/api/session');
    assert.deepEqual(await sessionResponse.json(), { authenticated: true });
});

test('clients can submit appointments and only authenticated admins can read them', async () => {
    const invalidResponse = await api('/api/appointments', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Client Name',
            phone: '0712345678',
            service: 'Website Design & Development',
            preferredDateTime: '2026-02-31T10:00'
        })
    });
    assert.equal(invalidResponse.status, 400);

    const response = await api('/api/appointments', {
        method: 'POST',
        body: JSON.stringify({
            name: '  Client Name  ',
            phone: '0712345678',
            service: 'Website Design & Development',
            preferredDateTime: '2026-12-31T10:00'
        })
    });
    assert.equal(response.status, 201);
    const { appointment } = await response.json();
    assert.equal(appointment.name, 'Client Name');
    assert.equal(appointment.phone, '0712345678');
    assert.ok(appointment.id);
    assert.ok(appointment.createdAt);

    const inboxResponse = await api('/api/appointments');
    assert.equal(inboxResponse.status, 200);
    assert.deepEqual(await inboxResponse.json(), [appointment]);
    const stored = JSON.parse(await fs.readFile(path.join(dataDirectory, 'appointments.json'), 'utf8'));
    assert.deepEqual(stored, [appointment]);
});

test('authenticated content edits persist and unsafe links are rejected', async () => {
    const invalidResponse = await api('/api/content', {
        method: 'PUT',
        body: JSON.stringify({ index: { texts: {}, hrefs: { '0.1': 'javascript:alert(1)' } } })
    });
    assert.equal(invalidResponse.status, 400);

    const saveResponse = await api('/api/content', {
        method: 'PUT',
        body: JSON.stringify({
            index: {
                texts: { '0.0': 'Updated welcome message' },
                hrefs: { '0.1': 'tel:+254700000000', '0.2': 'contact.html#form' }
            },
            blog: { texts: { '1.0': 'Updated article title' }, hrefs: {} }
        })
    });
    assert.equal(saveResponse.status, 200);
    assert.deepEqual(await (await api('/api/content')).json(), {
        index: {
            texts: { '0.0': 'Updated welcome message' },
            hrefs: { '0.1': 'tel:+254700000000', '0.2': 'contact.html#form' }
        },
        blog: { texts: { '1.0': 'Updated article title' }, hrefs: {} }
    });

    const stored = JSON.parse(await fs.readFile(path.join(dataDirectory, 'content.json'), 'utf8'));
    assert.equal(stored.index.texts['0.0'], 'Updated welcome message');

    const updateResponse = await api('/api/content', {
        method: 'PUT',
        body: JSON.stringify({ index: { texts: { '0.0': 'Second saved edit' }, hrefs: {} } })
    });
    assert.equal(updateResponse.status, 200);
    assert.equal((await (await api('/api/content')).json()).index.texts['0.0'], 'Second saved edit');
});

test('login rejects untrusted origins', async () => {
    const response = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'test-admin', password: 'test-password' })
    });
    assert.equal(response.status, 403);

    const appointmentResponse = await fetch(`${baseUrl}/api/appointments`, {
        method: 'POST',
        headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Client Name',
            phone: '0712345678',
            service: 'Website Design & Development',
            preferredDateTime: '2026-12-31T10:00'
        })
    });
    assert.equal(appointmentResponse.status, 403);
});

test('only the dashboard and API routes are served by the backend', async () => {
    for (const pathname of ['/', '/admin.html', '/admin.js', '/api-config.js']) {
        const response = await fetch(`${baseUrl}${pathname}`);
        assert.equal(response.status, 200, pathname);
        if (pathname === '/') {
            assert.match(await response.text(), /Sign in to your dashboard/);
        }
    }

    for (const pathname of ['/index.html', '/blog.html', '/public-content.js']) {
        const response = await fetch(`${baseUrl}${pathname}`);
        assert.equal(response.status, 404, pathname);
    }

    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
});

test('public and admin deployment origins are explicitly allowed for API requests', async () => {
    for (const allowedOrigin of [publicOrigin, adminOrigin]) {
        const response = await fetch(`${baseUrl}/api/content`, {
            headers: { Origin: allowedOrigin }
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
        assert.equal(response.headers.get('access-control-allow-credentials'), 'true');

        const preflight = await fetch(`${baseUrl}/api/content`, {
            method: 'OPTIONS',
            headers: { Origin: allowedOrigin }
        });
        assert.equal(preflight.status, 204);
    }
});
