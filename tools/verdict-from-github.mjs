#!/usr/bin/env node
// Genskaber $STATE_DIR/verdict.json fra det review station 1 sendte til GitHub. Stationerne
// deler ikke container, så filen fra station 1 findes ikke i station 2 — men reviewet gør.
//
//   node verdict-from-github.mjs --repo owner/repo --pr 6
//
// Vælger det seneste review hvis tekst bærer linjen «alp-pr-review · dom: <verdict>».
// Findes intet, skrives en dom «none» — og jev-route.mjs sender så til et menneske.

import { join } from 'node:path';
import { arg, die, githubAll, parseRepo, STATE_DIR, writeJson } from './lib/common.mjs';

const { owner, repo } = parseRepo(arg('repo'));
const number = Number(arg('pr'));
if (!Number.isInteger(number) || number <= 0) die('--pr skal være et PR-nummer');

const reviews = await githubAll(`/repos/${owner}/${repo}/pulls/${number}/reviews`);
if (reviews.status !== 200) die(`Kunne ikke hente reviews (HTTP ${reviews.status}).`);

const ours = reviews.items
    .filter((r) => /alp-pr-review · dom: (approve|request_changes|comment)/.test(r.body ?? ''))
    .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));

const section = (body, title) => {
    const m = new RegExp(`\\*\\*${title}\\*\\*\\n((?:- .*\\n?)+)`).exec(body);
    return m ? m[1].split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim()) : [];
};

let verdict;
if (ours.length === 0) {
    verdict = { verdict: 'none', summary: 'Intet review fra alp-pr-review fundet på PR\'et.', blocking: [], concerns: [], uncertain: ['Reviewet mangler.'], source: 'none' };
} else {
    const r = ours[0];
    const body = r.body ?? '';
    const meta = /alp-pr-review · dom: (\w+) · beskrivelse passer: ([^ ]+) · tests dækker: ([^<\n]+)/.exec(body);
    verdict = {
        verdict: meta?.[1] ?? 'none',
        summary: body.split('\n**')[0].trim().slice(0, 800),
        blocking: section(body, 'Skal rettes før merge'),
        concerns: section(body, 'Bemærkninger'),
        uncertain: section(body, 'Kunne ikke afgøres'),
        descriptionMatchesChange: meta?.[2] ?? 'unknown',
        testsCoverChange: (meta?.[3] ?? 'unknown').trim(),
        source: r.html_url,
        reviewedHead: r.commit_id,
        submittedAt: r.submitted_at,
    };
}
const out = join(STATE_DIR, 'verdict.json');
await writeJson(out, verdict);
console.log(`Dom: ${verdict.verdict} (${verdict.source})`);
console.log(`Skrevet til ${out}`);
