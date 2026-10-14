import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../server.js';

const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pefrika-admin-test-'));
const origin = 'http://localhost:3000';
const server = createApp({
    adminUsername: 'test-admin',
    adminPassword: 'test-password',
    sessionSecret: 'test-session-secret-that-is-long-enough-32',
    dataDirectory,
    siteOrigins: [origin],
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
});
