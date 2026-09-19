#!/usr/bin/env node
// Skriver review-stationens dom til GitHub som ét review, og gemmer den som
// $STATE_DIR/verdict.json til jev-route.mjs.
//
//   node post-review.mjs --repo owner/repo --pr 6 --verdict verdict.json [--no-github]
//
// verdict.json (skrevet af agenten):
// {
//   "verdict": "approve" | "request_changes" | "comment",
//   "summary": "to-fem linjer, hvad PR'et gør og om det gør det",
//   "blocking": ["…"],          // fund der SKAL rettes før merge (tom ved approve)
//   "concerns": ["…"],          // ikke-blokerende fund
//   "uncertain": ["…"],         // det revieweren ikke kunne afgøre
//   "descriptionMatchesChange": "yes" | "no" | "partly",
//   "testsCoverChange": "yes" | "no" | "partly" | "n/a",
//   "comments": [ { "path": "src/x.ts", "line": 12, "body": "…" } ]   // valgfrit, linjekommentarer
// }
//
// Et token kan ikke godkende sit eget PR (GitHub svarer 422). Så bliver det en COMMENT
// med samme tekst — dommen står stadig i verdict.json, og det er den Jev ser.

import { join } from 'node:path';
import { arg, die, flag, github, parseRepo, readJson, STATE_DIR, writeJson } from './lib/common.mjs';

const { owner, repo } = parseRepo(arg('repo'));
const number = Number(arg('pr'));
if (!Number.isInteger(number) || number <= 0) die('--pr skal være et PR-nummer');
const verdictPath = arg('verdict');
if (!verdictPath) die('--verdict <fil> mangler');

const v = await readJson(verdictPath);
const allowed = ['approve', 'request_changes', 'comment'];
if (!allowed.includes(v.verdict)) die(`verdict skal være en af ${allowed.join(', ')}, fik "${v.verdict}"`);
if (v.verdict === 'approve' && (v.blocking ?? []).length > 0) die('approve med blokerende fund giver ikke mening — vælg request_changes.');

await writeJson(join(STATE_DIR, 'verdict.json'), { ...v, postedAt: new Date().toISOString() });

const list = (title, items) => (items?.length ? `\n**${title}**\n${items.map((i) => `- ${i}`).join('\n')}\n` : '');
const bodyText =
    `${v.summary ?? ''}\n` +
    list('Skal rettes før merge', v.blocking) +
    list('Bemærkninger', v.concerns) +
    list('Kunne ikke afgøres', v.uncertain) +
    `\n<sub>alp-pr-review · dom: ${v.verdict} · beskrivelse passer: ${v.descriptionMatchesChange ?? '?'} · tests dækker: ${v.testsCoverChange ?? '?'}</sub>`;

if (flag('no-github')) { console.log(bodyText); console.log('\n(ikke sendt til GitHub: --no-github)'); process.exit(0); }

const event = { approve: 'APPROVE', request_changes: 'REQUEST_CHANGES', comment: 'COMMENT' }[v.verdict];
const comments = (v.comments ?? []).filter((c) => c.path && c.body).map((c) => ({ path: c.path, body: c.body, ...(c.line ? { line: c.line, side: 'RIGHT' } : { subject_type: 'file' }) }));

const post = (ev) => github(`/repos/${owner}/${repo}/pulls/${number}/reviews`, { method: 'POST', body: { event: ev, body: bodyText, ...(comments.length ? { comments } : {}) } });
let r = await post(event);
if (r.status === 422 && /own pull request/i.test(r.text)) {
    console.error('GitHub: tokenet kan ikke godkende sit eget PR — sender som COMMENT i stedet. Dommen i verdict.json er uændret.');
    r = await post('COMMENT');
}
if (r.status === 422 && comments.length) {
    console.error(`Linjekommentarerne blev afvist (${r.text.slice(0, 200)}) — sender reviewet uden dem.`);
    r = await github(`/repos/${owner}/${repo}/pulls/${number}/reviews`, { method: 'POST', body: { event: event === 'APPROVE' ? 'COMMENT' : event, body: bodyText } });
}
if (r.status !== 200) die(`GitHub afviste reviewet: HTTP ${r.status} ${r.text.slice(0, 300)}`);
console.log(`Review sendt: ${r.json?.html_url ?? ''} (${r.json?.state ?? event})`);
