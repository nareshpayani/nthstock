#!/usr/bin/env node
// Publishes the before/after screenshots of a UI pull request (NSTOCK-0285,
// docs/runbooks/pr-screenshots.md). Run by .github/workflows/pr-screenshots.yml after the capture
// job (apps/web/e2e/screens) has written one JSON file per screen and width, plus the JPEGs, to
// <results dir>:
//   1. commits the screenshots of the changed screens to the ci/pr-screenshots branch, under
//      pr-<number>/<head sha>/, dropping the PR's older ones from the branch tip;
//   2. writes the "Screenshots" section of the PR body (between the pr-screenshots markers),
//      linking the images by that commit, so they keep working after later pushes.
// Plain Node 22, no dependencies: it runs with a write token and never runs PR-installed code.
//
//   node tools/github/prScreenshots.mjs <results dir>
// Env: GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, HEAD_SHA, BASE_SHA, BASE_REF, RUN_URL.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BRANCH = 'ci/pr-screenshots';
const START = '<!-- pr-screenshots:start -->';
const END = '<!-- pr-screenshots:end -->';
const AUTHOR = ['Naresh Payani', '15100692+nareshpayani@users.noreply.github.com'];

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`prScreenshots: set ${name}`);
  return value;
};
const resultsDir = process.argv[2];
if (!resultsDir) throw new Error('usage: prScreenshots.mjs <results dir>');
const token = env('GH_TOKEN');
const repo = env('GITHUB_REPOSITORY');
const pr = env('PR_NUMBER');
const headSha = env('HEAD_SHA');
const baseSha = env('BASE_SHA');
const baseRef = env('BASE_REF');
const runUrl = env('RUN_URL');
const short = (sha) => sha.slice(0, 7);

const results = existsSync(resultsDir)
  ? readdirSync(resultsDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => JSON.parse(readFileSync(join(resultsDir, file), 'utf8')))
      .sort((a, b) => a.order - b.order)
  : [];
const changed = results.filter((result) => result.changed);
const failed = results.filter((result) => result.afterError);

/** Commits the changed screens' images; returns the raw URL folder they are served from. */
function publishImages() {
  const dir = mkdtempSync(join(tmpdir(), 'pr-screenshots-'));
  const auth = Buffer.from(`x-access-token:${token}`).toString('base64');
  const git = (...args) =>
    execFileSync('git', ['-c', `http.extraheader=AUTHORIZATION: basic ${auth}`, ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }).trim();
  const remote = `https://github.com/${repo}.git`;
  git('init', '--quiet');
  git('remote', 'add', 'origin', remote);
  const folder = `pr-${pr}/${short(headSha)}`;

  for (let attempt = 1; ; attempt += 1) {
    if (git('ls-remote', '--heads', 'origin', BRANCH) !== '') {
      git('fetch', '--quiet', '--depth', '1', 'origin', BRANCH);
      git('checkout', '--quiet', '-B', BRANCH, 'FETCH_HEAD');
    } else {
      git('checkout', '--quiet', '--orphan', BRANCH);
    }
    // Only this push's images at the tip; older pushes stay reachable through their commits.
    rmSync(join(dir, `pr-${pr}`), { recursive: true, force: true });
    for (const result of changed) {
      for (const side of ['before', 'after']) {
        if (result[side]) cpSync(join(resultsDir, result[side]), join(dir, folder, result[side]));
      }
    }
    git('add', '--all');
    git(
      '-c',
      `user.name=${AUTHOR[0]}`,
      '-c',
      `user.email=${AUTHOR[1]}`,
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      `chore: screenshots for #${pr} at ${short(headSha)}`,
    );
    try {
      git('push', '--quiet', 'origin', `HEAD:refs/heads/${BRANCH}`);
      break;
    } catch (error) {
      // Another PR pushed at the same moment: start again from its commit.
      if (attempt >= 4) throw error;
    }
  }
  const commit = git('rev-parse', 'HEAD');
  rmSync(dir, { recursive: true, force: true });
  return `https://raw.githubusercontent.com/${repo}/${commit}/${folder}`;
}

const label = (result) =>
  `${result.name} · ${result.viewport} ${String(result.width)} px (\`${result.path}\`)`;

function image(base, result, side) {
  if (!result[side]) return `_${result[`${side}Error`] ? 'could not capture' : 'not there'}_`;
  const url = `${base}/${result[side]}`;
  return `<a href="${url}"><img src="${url}" alt="${side}: ${result.name} at ${String(result.width)} px" width="${result.width > 600 ? 480 : 260}"></a>`;
}

function section(base) {
  const lines = [
    START,
    '## Screenshots',
    '',
    `Before is \`${baseRef}\` at ${short(baseSha)}, after is this PR at ${short(headSha)}: the msw-mode build, demo data, market closed so prices hold still. Added by the [PR screenshots](${runUrl}) workflow and refreshed on every push; edits inside this section are replaced.`,
    '',
  ];
  if (results.length === 0) {
    lines.push('_The capture did not run; see the workflow run._');
  } else if (changed.length === 0) {
    lines.push(`No visible change on the ${String(results.length)} screens captured.`);
  }
  for (const result of changed) {
    lines.push(`### ${label(result)}`, '', '| Before | After |', '|---|---|');
    lines.push(`| ${image(base, result, 'before')} | ${image(base, result, 'after')} |`, '');
  }
  const unchanged = results.filter((result) => !result.changed && !result.afterError);
  if (changed.length > 0 && unchanged.length > 0) {
    lines.push(
      `Unchanged: ${unchanged.map((result) => `${result.name} ${String(result.width)}`).join(', ')}.`,
      '',
    );
  }
  for (const result of failed) {
    lines.push(`- Could not capture ${label(result)}: ${result.afterError}`);
  }
  lines.push('', END);
  return lines.join('\n');
}

async function github(path, init = {}) {
  const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${String(response.status)}`);
  return response.json();
}

const base = changed.length > 0 ? publishImages() : '';
const pull = await github(`/pulls/${pr}`);
const body = (pull.body ?? '').replace(/\r\n/g, '\n');
const start = body.indexOf(START);
const end = body.indexOf(END);
const next =
  start >= 0 && end > start
    ? `${body.slice(0, start)}${section(base)}${body.slice(end + END.length)}`
    : `${body.trimEnd()}\n\n${section(base)}\n`;
if (next !== body) {
  await github(`/pulls/${pr}`, { method: 'PATCH', body: JSON.stringify({ body: next }) });
}
console.log(
  `PR #${pr}: ${String(changed.length)} changed of ${String(results.length)} screens, ${String(failed.length)} not captured.`,
);
