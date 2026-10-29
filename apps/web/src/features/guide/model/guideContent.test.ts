import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strings } from '../strings';
import { FLOW_DIAGRAMS, logFraction } from './diagrams';
import { imageFile, neighboursOf, repoLink, resolveTab, videoFile } from './guideContent';

const TABS = strings.tabs;

describe('guide tabs', () => {
  it('have unique, URL-safe ids', () => {
    const ids = TABS.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z-]*$/);
  });

  it('resolve a ?tab= value, falling back to the first tab', () => {
    expect(resolveTab(TABS, 'ci-cd').id).toBe('ci-cd');
    expect(resolveTab(TABS, undefined).id).toBe('overview');
    expect(resolveTab(TABS, 'missing').id).toBe('overview');
  });

  it('know their neighbours for the pager', () => {
    expect(neighboursOf(TABS, 'overview').previous).toBeNull();
    expect(neighboursOf(TABS, 'overview').next?.id).toBe('demo');
    expect(neighboursOf(TABS, 'roadmap').next).toBeNull();
    expect(neighboursOf(TABS, 'missing')).toEqual({ previous: null, next: null });
  });

  it('link only to files in the public repository', () => {
    expect(repoLink('WRITEUP.md')).toBe(
      'https://github.com/nareshpayani/nthstock/blob/develop/WRITEUP.md',
    );
    for (const tab of TABS) {
      for (const block of tab.blocks) {
        if (block.kind !== 'links') continue;
        for (const link of block.items) expect(link.href).toMatch(/^https:\/\/github\.com\//);
      }
    }
  });
});

describe('Demo 2 stills', () => {
  it('each exist in public/round2', () => {
    const files = TABS.flatMap((tab) =>
      tab.blocks.flatMap((block) =>
        block.kind === 'compare'
          ? block.items.flatMap((item) => [item.before.file, item.after.file])
          : block.kind === 'figures'
            ? block.items.map((item) => item.image.file)
            : [],
      ),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(new Set(files).size).toBe(files.length);
    for (const file of files) {
      expect(existsSync(resolve(process.cwd(), `public${imageFile(file)}`)), file).toBe(true);
    }
  });
});

describe('guide diagrams', () => {
  it('have a label for every box and group, and no label without a box', () => {
    for (const [id, geometry] of Object.entries(FLOW_DIAGRAMS)) {
      const copy = strings.diagrams[id as keyof typeof FLOW_DIAGRAMS];
      expect(Object.keys(copy.nodes).sort(), id).toEqual(Object.keys(geometry.nodes).sort());
      expect(Object.keys(copy.groups).sort(), id).toEqual(Object.keys(geometry.groups).sort());
      for (const key of Object.keys(copy.edges)) {
        expect(geometry.edges, `${id} edge ${key}`).toHaveProperty(key);
      }
      for (const node of Object.values(geometry.nodes)) {
        expect(node.x + node.w, id).toBeLessThanOrEqual(geometry.width);
        expect(node.y + node.h, id).toBeLessThanOrEqual(geometry.height);
      }
    }
  });

  it('are each used by a tab', () => {
    const used = TABS.flatMap((tab) =>
      tab.blocks.flatMap((block) => (block.kind === 'diagram' ? [block.id] : [])),
    );
    expect(new Set(used)).toEqual(new Set([...Object.keys(FLOW_DIAGRAMS), 'loadTest']));
  });

  it('place values on a log axis', () => {
    expect(logFraction(1, 1, 10_000)).toBe(0);
    expect(logFraction(100, 1, 10_000)).toBeCloseTo(0.5);
    expect(logFraction(50_000, 1, 10_000)).toBe(1);
  });
});

/** The committed load test results (docs/runbooks/load-test.md). */
type LoadTestResult = {
  settings: { users: number };
  api: { p95: number; perSecond: number; errors: Record<string, number> };
  ws: { opened: number; tickAgeMs: { p95: number } };
};

const readResult = (name: string): LoadTestResult =>
  JSON.parse(
    // Vitest runs from apps/web.
    readFileSync(
      resolve(process.cwd(), `../../tools/loadTest/results/2026-10-24-${name}.json`),
      'utf8',
    ),
  ) as LoadTestResult;

const ms = (value: number) =>
  value < 10
    ? `${value.toFixed(1)} ms`
    : value < 1000
      ? `${String(Math.round(value))} ms`
      : `${(value / 1000).toFixed(1)} s`;

describe('the scalability tab', () => {
  it('quotes the committed load test results exactly', () => {
    const tab = TABS.find((item) => item.id === 'scalability');
    const table = tab?.blocks.find((block) => block.kind === 'table');
    if (table?.kind !== 'table') throw new Error('no results table');
    const runs = [
      'users1000-think5s-pool10',
      'users5000-think5s-pool10',
      'users7500-think5s-pool30',
      'users10000-think5s-pool30',
      'users10000-think15s-pool30',
    ].map(readResult);
    expect(table.rows).toHaveLength(runs.length);
    runs.forEach((run, index) => {
      const row = table.rows[index] ?? [];
      expect(row[0]).toBe(run.settings.users.toLocaleString('en-IN'));
      expect(row[2]).toBe(run.api.perSecond.toLocaleString('en-IN'));
      expect(row[3]).toBe(ms(run.api.p95));
      expect(row[4]).toBe(String(Object.values(run.api.errors).reduce((a, b) => a + b, 0)));
      expect(row[5]).toBe(run.ws.opened.toLocaleString('en-IN'));
      expect(row[6]).toBe(ms(run.ws.tickAgeMs.p95));
    });
    const bars = strings.diagrams.loadTest.bars;
    expect(bars.map((bar) => bar.value)).toEqual(runs.map((run) => run.api.p95));
  });
});

describe('guide walkthrough videos', () => {
  const videos = TABS.flatMap((tab) =>
    tab.blocks.flatMap((block) => (block.kind === 'videos' ? block.items : [])),
  );

  it('list each clip once, with its length', () => {
    expect(videos.length).toBeGreaterThan(0);
    expect(new Set(videos.map((video) => video.id)).size).toBe(videos.length);
    for (const video of videos) expect(video.length, video.id).toMatch(/^\d+:\d\d$/);
  });

  it('point at a recorded clip, its captions and its poster (tools/demo/recordWalkthrough.sh)', () => {
    for (const video of videos) {
      for (const extension of ['mp4', 'vtt', 'jpg'] as const) {
        const file = resolve(process.cwd(), `public${videoFile(video.id, extension)}`);
        expect(existsSync(file), file).toBe(true);
      }
      const captions = readFileSync(
        resolve(process.cwd(), `public${videoFile(video.id, 'vtt')}`),
        'utf8',
      );
      expect(captions.startsWith('WEBVTT'), video.id).toBe(true);
    }
  });
});
