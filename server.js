import 'dotenv/config';

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const sessionLifetimeSeconds = 60 * 60 * 8;
const maximumRequestBytes = '1mb';
const maximumEntriesPerPage = 5000;
const maximumTextLength = 5000;
const allowedPages = new Set(['index', 'blog']);

function secureEqual(first, second) {
    const firstHash = crypto.createHash('sha256').update(String(first)).digest();
    const secondHash = crypto.createHash('sha256').update(String(second)).digest();
    return crypto.timingSafeEqual(firstHash, secondHash);
}

function getSessionCookie(req, config) {
    const expiry = Math.floor(Date.now() / 1000) + sessionLifetimeSeconds;
    const value = `${expiry}.${crypto.randomUUID()}`;
    const signature = crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
    const sameSite = config.production ? 'None' : 'Lax';
    const secure = config.production ? '; Secure' : '';

    return `pefrika_admin=${value}.${signature}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${sessionLifetimeSeconds}${secure}`;
}

function isAuthenticated(req, config) {
    const cookie = req.headers.cookie?.split(';').map(value => value.trim())
        .find(value => value.startsWith('pefrika_admin='))
        ?.slice('pefrika_admin='.length);

    if (!cookie) {
        return false;
    }

    const [expiry, nonce, signature] = cookie.split('.');
    if (!expiry || !nonce || !signature || !/^\d+$/.test(expiry) || Number(expiry) <= Date.now() / 1000) {
        return false;
    }

    const value = `${expiry}.${nonce}`;
    const expected = crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
    return secureEqual(signature, expected);
}

function normalizeContent(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(page => !allowedPages.has(page))) {
        throw new Error('Content must contain only supported page data.');
    }

    const normalized = {};
    for (const [page, data] of Object.entries(input)) {
        if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['texts', 'hrefs'].includes(key))) {
            throw new Error(`Invalid content for ${page}.`);
        }

        normalized[page] = { texts: {}, hrefs: {} };
        for (const field of ['texts', 'hrefs']) {
            const values = data[field] ?? {};
            if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > maximumEntriesPerPage) {
                throw new Error(`Invalid ${field} values for ${page}.`);
            }

            for (const [key, value] of Object.entries(values)) {
                if (!/^\d+(?:\.\d+)*$/.test(key) || typeof value !== 'string' || value.length > maximumTextLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
                    throw new Error(`Invalid ${field} entry for ${page}.`);
                }

                if (field === 'hrefs' && value) {
                    if (/[\u0000-\u0020\u007f]/.test(value) || value.startsWith('//')) {
                        throw new Error('Links cannot contain spaces, control characters, or protocol-relative URLs.');
                    }
                    let protocol;
                    try {
                        protocol = new URL(value, 'https://pefrika.invalid').protocol;
                    } catch {
                        throw new Error('A link destination is not a valid URL.');
                    }
                    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(protocol)) {
                        throw new Error('Links must use a relative path, an in-page anchor, HTTPS/HTTP, mailto, or tel URL.');
                    }
                }

                normalized[page][field][key] = value;
            }
        }
    }

    return normalized;
}

function getAllowedOrigins(config) {
    return new Set(config.siteOrigins.map(origin => new URL(origin).origin));
}

function originIsAllowed(req, config) {
    const origin = req.get('origin');
    if (!origin) {
        return false;
    }

    try {
        return getAllowedOrigins(config).has(new URL(origin).origin);
    } catch {
        return false;
    }
}

function createApp(config = {}) {
    const settings = {
        adminUsername: config.adminUsername ?? process.env.ADMIN_USERNAME,
        adminPassword: config.adminPassword ?? process.env.ADMIN_PASSWORD,
        sessionSecret: config.sessionSecret ?? process.env.SESSION_SECRET,
        dataDirectory: config.dataDirectory ?? process.env.DATA_DIR ?? path.join(rootDirectory, '.data'),
        siteOrigins: config.siteOrigins ?? (process.env.SITE_ORIGIN ?? 'http://localhost:3000').split(',').map(value => value.trim()).filter(Boolean),
        production: config.production ?? process.env.NODE_ENV === 'production'
    };

    if (!settings.adminUsername || !settings.adminPassword || !settings.sessionSecret || settings.sessionSecret.length < 32) {
        throw new Error('Set ADMIN_USERNAME, ADMIN_PASSWORD, and SESSION_SECRET (at least 32 characters) before starting the server.');
    }

    getAllowedOrigins(settings);

    const contentFile = path.join(settings.dataDirectory, 'content.json');
    const app = express();
    const loginAttempts = new Map();
    let writeQueue = Promise.resolve();

    app.disable('x-powered-by');
    app.set('trust proxy', 1);
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                baseUri: ["'self'"],
                objectSrc: ["'none'"],
                frameAncestors: ["'self'"],
                frameSrc: ["'self'", ...getAllowedOrigins(settings)],
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdn.tailwindcss.com'],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
                fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com', 'data:'],
                imgSrc: ["'self'", 'data:', 'https:'],
                connectSrc: ["'self'", ...getAllowedOrigins(settings)],
                formAction: ["'self'"]
            }
        },
        crossOriginEmbedderPolicy: false
    }));
    app.use(express.json({ limit: maximumRequestBytes, strict: true }));

    app.use('/api', (req, res, next) => {
        const origin = req.get('origin');
        if (origin && originIsAllowed(req, settings)) {
            res.set('Access-Control-Allow-Origin', new URL(origin).origin);
            res.set('Access-Control-Allow-Credentials', 'true');
            res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
            res.set('Access-Control-Allow-Headers', 'Content-Type');
            res.vary('Origin');
        }

        if (req.method === 'OPTIONS') {
            if (!originIsAllowed(req, settings)) {
                return res.status(403).json({ error: 'Origin is not allowed.' });
            }
            return res.sendStatus(204);
        }

        next();
    });

    app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

    app.get('/api/content', async (req, res) => {
        try {
            const stored = await fs.readFile(contentFile, 'utf8').catch(error => {
                if (error.code === 'ENOENT') {
                    return '{}';
                }
                throw error;
            });
            res.set('Cache-Control', 'no-store').json(JSON.parse(stored));
        } catch (error) {
            console.error('Unable to read website content:', error);
            res.status(500).json({ error: 'Website content could not be loaded.' });
        }
    });

    app.post('/api/login', (req, res) => {
        if (!originIsAllowed(req, settings)) {
            return res.status(403).json({ error: 'Origin is not allowed.' });
        }

        const now = Date.now();
        const key = req.ip;
        const attempts = (loginAttempts.get(key) ?? []).filter(time => now - time < 15 * 60 * 1000);
        if (attempts.length >= 10) {
            loginAttempts.set(key, attempts);
            return res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
        }
        if (loginAttempts.size > 10000) {
            for (const [ip, times] of loginAttempts) {
                if (!times.some(time => now - time < 15 * 60 * 1000)) {
                    loginAttempts.delete(ip);
                }
            }
        }

        const username = typeof req.body?.username === 'string' ? req.body.username : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        if (!secureEqual(username, settings.adminUsername) || !secureEqual(password, settings.adminPassword)) {
            attempts.push(now);
            loginAttempts.set(key, attempts);
            return res.status(401).json({ error: 'Username or password is incorrect.' });
        }

        loginAttempts.delete(key);
        res.set('Cache-Control', 'no-store');
        res.set('Set-Cookie', getSessionCookie(req, settings));
        res.json({ authenticated: true });
    });

    app.post('/api/logout', (req, res) => {
        if (!originIsAllowed(req, settings)) {
            return res.status(403).json({ error: 'Origin is not allowed.' });
        }
        const secure = settings.production ? '; Secure' : '';
        res.set('Set-Cookie', `pefrika_admin=; Path=/; HttpOnly; SameSite=${settings.production ? 'None' : 'Lax'}; Max-Age=0${secure}`);
        res.sendStatus(204);
    });

    app.get('/api/session', (req, res) => {
        res.set('Cache-Control', 'no-store').json({ authenticated: isAuthenticated(req, settings) });
    });

    app.put('/api/content', async (req, res) => {
        if (!originIsAllowed(req, settings)) {
            return res.status(403).json({ error: 'Origin is not allowed.' });
        }
        if (!isAuthenticated(req, settings)) {
            return res.status(401).json({ error: 'Sign in to save website content.' });
        }

        let normalized;
        try {
            normalized = normalizeContent(req.body);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }

        writeQueue = writeQueue.then(async () => {
            await fs.mkdir(settings.dataDirectory, { recursive: true });
            const temporaryFile = `${contentFile}.${crypto.randomUUID()}.tmp`;
            try {
                await fs.writeFile(temporaryFile, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
                await fs.rename(temporaryFile, contentFile);
            } catch (error) {
                await fs.rm(temporaryFile, { force: true }).catch(() => {});
                throw error;
            }
        });

        try {
            await writeQueue;
            res.set('Cache-Control', 'no-store').json({ saved: true });
        } catch (error) {
            console.error('Unable to save website content:', error);
            res.status(500).json({ error: 'Website content could not be saved.' });
        }
    });

    const adminAssetOptions = { etag: true, maxAge: settings.production ? '1h' : 0 };
    const sendAdminAsset = filename => (req, res, next) => {
        res.sendFile(path.join(rootDirectory, filename), adminAssetOptions, error => {
            if (error) {
                next(error);
            }
        });
    };
    app.get('/', sendAdminAsset('admin.html'));
    app.get('/admin.html', sendAdminAsset('admin.html'));
    app.get('/admin.js', sendAdminAsset('admin.js'));
    app.get('/api-config.js', sendAdminAsset('api-config.js'));

    app.use((error, req, res, next) => {
        if (res.headersSent) {
            return next(error);
        }
        if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
            return res.status(400).json({ error: 'Request body must be valid JSON.' });
        }
        console.error('Unhandled server error:', error);
        res.status(500).json({ error: 'An unexpected server error occurred.' });
    });

    return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const app = createApp();
    const port = Number(process.env.PORT ?? 3000);
    app.listen(port, '0.0.0.0', () => {
        console.log(`Pefrika admin API listening on port ${port}.`);
    });
}

export { createApp };
