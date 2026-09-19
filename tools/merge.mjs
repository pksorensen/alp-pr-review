#!/usr/bin/env node
// Merger PR'et — men kun det PR, i den tilstand, som routingen så.
//
//   node merge.mjs --repo owner/repo --pr 6 --head <sha> [--max-wait 60] [--method squash] [--dry-run]
//
// Nægter hvis head-sha'en er en anden end den der blev reviewet (der er pushet siden —
// så kommer der et nyt kort), hvis PR'et ikke er åbent, eller hvis checks er røde.
// Venter på checks der stadig kører, med en hjertesla-linje hvert 30. sekund, så
// stationens idle-timeout måler arbejdet og ikke ventetiden.
//
// Selve merget sender `sha` med, så GitHub selv afviser hvis head flyttede sig mellem
// vores sidste opslag og merget (HTTP 409).

import { arg, die, flag, github, parseRepo } from './lib/common.mjs';

const { owner, repo } = parseRepo(arg('repo'));
const number = Number(arg('pr'));
if (!Number.isInteger(number) || number <= 0) die('--pr skal være et PR-nummer');
const expectedHead = arg('head');
if (!expectedHead) die('--head <sha> mangler: merge uden en kendt head er ikke et merge af det reviewede.');
const maxWaitMin = Number(arg('max-wait', '60'));
const method = arg('method', 'squash');
const dryRun = flag('dry-run');

const base = `/repos/${owner}/${repo}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checksFor = async (sha) => {
    const cr = await github(`${base}/commits/${sha}/check-runs?per_page=100`);
    const st = await github(`${base}/commits/${sha}/status`);
    const all = [
        ...(cr.json?.check_runs ?? []).map((c) => ({ name: c.name, done: c.status === 'completed', ok: ['success', 'neutral', 'skipped'].includes(c.conclusion), conclusion: c.conclusion ?? c.status })),
        ...(st.json?.statuses ?? []).map((s) => ({ name: s.context, done: s.state !== 'pending', ok: s.state === 'success', conclusion: s.state })),
    ];
    return all;
};

const started = Date.now();
let pr;
for (;;) {
    const r = await github(`${base}/pulls/${number}`);
    if (r.status !== 200) die(`GitHub svarede HTTP ${r.status} på PR'et: ${r.text.slice(0, 300)}`);
    pr = r.json;
    if (pr.state !== 'open') die(`PR'et er ikke åbent (${pr.merged ? 'merget' : 'lukket'}). Intet at gøre.`);
    if (pr.head.sha !== expectedHead) die(`HEAD FLYTTET: reviewet så ${expectedHead}, PR'et står på ${pr.head.sha}. Der kommer et nyt kort for det nye push; dette stopper.`);
    if (pr.draft) die('PR\'et er et udkast.');

    const checks = await checksFor(pr.head.sha);
    const pending = checks.filter((c) => !c.done);
    const failed = checks.filter((c) => c.done && !c.ok);
    if (failed.length) die(`RØDE CHECKS: ${failed.map((c) => `${c.name}=${c.conclusion}`).join(', ')}.`);
    if (checks.length === 0) die('Ingen checks på head — linjen merger ikke uden et grønt check.');
    if (pending.length === 0 && pr.mergeable !== null) break;

    const waited = Math.round((Date.now() - started) / 1000);
    if (waited > maxWaitMin * 60) die(`Ventede ${maxWaitMin} min på checks/mergeability; stadig: ${pending.map((c) => c.name).join(', ') || 'mergeable=null'}.`);
    console.log(`… venter (${waited}s): ${pending.length} check(s) kører${pr.mergeable === null ? ', GitHub regner mergeability' : ''}`);
    await sleep(30_000);
}

if (pr.mergeable === false || ['dirty', 'blocked', 'behind'].includes(pr.mergeable_state)) {
    die(`IKKE MERGEBAR: mergeable=${pr.mergeable} state=${pr.mergeable_state}. ${pr.mergeable_state === 'blocked' ? 'Branch protection kræver noget linjen ikke kan give (fx et review fra en anden).' : ''}`);
}

console.log(`Klar: ${owner}/${repo}#${number} head=${pr.head.sha} checks grønne, mergeable_state=${pr.mergeable_state}`);
if (dryRun) { console.log('(dry-run: merger ikke)'); process.exit(0); }

const m = await github(`${base}/pulls/${number}/merge`, {
    method: 'PUT',
    body: { sha: pr.head.sha, merge_method: method, commit_title: `${pr.title} (#${number})`.slice(0, 200) },
});
if (m.status === 409) die('GitHub: head flyttede sig i sidste øjeblik (409). Ikke merget.');
if (m.status === 405) die(`GitHub: merge ikke tilladt (405): ${m.json?.message ?? m.text.slice(0, 200)}`);
if (m.status !== 200) die(`GitHub afviste merget: HTTP ${m.status} ${m.text.slice(0, 300)}`);
console.log(`MERGED: ${pr.html_url} → ${m.json?.sha ?? ''} (${method})`);
