// Fælles for alle værktøjer i linjen. Afhængighedsfrit: kun Node 20+ indbyggede moduler.
//
// To kanaler ud af containeren, begge over runnerens legitimationssocket:
//   GET  /git-credential?host=github.com   → { password }   (GitHub-token til API-kald)
//   POST /typesafe/systemone               → Jevs svar      (nøglen bliver på værten)
// Uden for et job (håndkørsel i devcontaineren) falder begge tilbage til miljøet:
// GITHUB_TOKEN og TYPESAFE_API_KEY.

import { request as httpRequest } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const SOCKET = process.env.PKS_CREDS_SOCKET || '/var/run/pks-creds/creds.sock';
export const STATE_DIR = process.env.ALP_PR_REVIEW_STATE || '/tmp/alp-pr-review';

export const argv = process.argv.slice(2);
export const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
export const flag = (n) => argv.includes(`--${n}`);

export const die = (msg, code = 1) => { console.error(msg); process.exit(code); };

// En variabel der stadig står som `${localEnv:…}` er en devcontainer-substitution der ikke
// skete. Behandl den som tom, ellers sender vi teksten som token og et opsætningsproblem
// ligner en fejl i arbejdet.
export const env = (name) => {
    const v = process.env[name];
    return !v || /^\$\{.*\}$/.test(v.trim()) ? '' : v;
};

/** Ét HTTP-kald over unix-socketen. Svarer { status, body } og kaster kun på transportfejl. */
export function socketRequest(path, { method = 'GET', body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const req = httpRequest({ socketPath: SOCKET, path, method, headers: {
            ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}),
            ...(env('PKS_TOKEN') ? { authorization: `Bearer ${env('PKS_TOKEN')}` } : {}),
            ...headers,
        } }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

let githubToken;
/** GitHub-token: socketen når vi er et job, ellers GITHUB_TOKEN. Hentes én gang. */
export async function getGithubToken() {
    if (githubToken !== undefined) return githubToken;
    if (env('GITHUB_TOKEN')) return (githubToken = env('GITHUB_TOKEN'));
    try {
        const r = await socketRequest('/git-credential?host=github.com');
        if (r.status === 200) {
            const j = JSON.parse(r.body);
            if (j.password) return (githubToken = j.password);
        }
        console.error(`git-credential over socketen svarede HTTP ${r.status}: ${r.body.slice(0, 200)}`);
    } catch (e) {
        console.error(`Ingen legitimationssocket på ${SOCKET} (${e.message}) og ingen GITHUB_TOKEN.`);
    }
    return (githubToken = '');
}

/** Ét kald mod api.github.com. Svarer { status, json, text }. */
export async function github(path, { method = 'GET', body, accept } = {}) {
    const token = await getGithubToken();
    if (!token) die('Intet GitHub-token: hverken socketen eller GITHUB_TOKEN gav et.');
    const res = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
            authorization: `Bearer ${token}`,
            accept: accept || 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            'user-agent': 'alp-pr-review',
            ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ikke JSON */ }
    return { status: res.status, json, text };
}

/** Alle sider af en liste-endpoint (per_page=100). */
export async function githubAll(path) {
    const out = [];
    for (let page = 1; page < 20; page++) {
        const sep = path.includes('?') ? '&' : '?';
        const r = await github(`${path}${sep}per_page=100&page=${page}`);
        if (r.status !== 200 || !Array.isArray(r.json)) return { status: r.status, items: out, text: r.text };
        out.push(...r.json);
        if (r.json.length < 100) break;
    }
    return { status: 200, items: out };
}

export const parseRepo = (s) => {
    const m = /^([^/\s]+)\/([^/\s]+)$/.exec((s || '').trim());
    if (!m) die(`--repo skal være owner/repo, fik "${s}"`);
    return { owner: m[1], repo: m[2] };
};

export async function writeJson(path, data) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}
export async function readJson(path) {
    return JSON.parse(await readFile(path, 'utf8'));
}

/** Tekst fra fremmede (PR-titel, -beskrivelse, commit-beskeder) markeres som data. */
export const untrusted = (s, max = 4000) => {
    const t = (s ?? '').toString().replace(/⟦|⟧/g, '').trim();
    return `⟦untrusted⟧ ${t.length > max ? t.slice(0, max) + ' …[afkortet]' : t} ⟦/untrusted⟧`;
};
