import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

// A full-density recording for a clip that is a deliverable on its own (the round 2 phone take).
// Playwright's video is one pixel per CSS pixel; a phone records at its device pixel ratio. This
// takes Chrome's screencast frames at the emulated device's full resolution (1320 × 2868 for an
// iPhone 16 Pro Max at 3×), keeps each frame's time, and encodes them to H.264 at 30 fps with
// ffmpeg, so a frame lasts on screen as long as it did in the browser.

const FPS = 30;

/** Starts recording `page`; the returned function stops and writes `<output>` (an .mp4). */
export async function startScreencast(page: Page, output: string): Promise<() => Promise<void>> {
  const frames = `${output}.frames`;
  await rm(frames, { recursive: true, force: true });
  await mkdir(frames, { recursive: true });
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('the page has no viewport');
  const scale = await page.evaluate(() => window.devicePixelRatio);
  const session = await page.context().newCDPSession(page);
  const shots: { file: string; at: number }[] = [];
  const writes: Promise<void>[] = [];
  session.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(frames, `${String(shots.length).padStart(5, '0')}.jpg`);
    shots.push({ file, at: metadata.timestamp ?? Date.now() / 1000 });
    writes.push(writeFile(file, Buffer.from(data, 'base64')));
    void session.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
  });
  await session.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: Math.round(viewport.width * scale),
    maxHeight: Math.round(viewport.height * scale),
    everyNthFrame: 1,
  });
  return async () => {
    await session.send('Page.stopScreencast');
    await Promise.all(writes);
    if (shots.length === 0) throw new Error('the screencast sent no frames');
    // The concat list gives each frame its real duration (the fps filter then resamples to 30 fps);
    // the last one holds for a second.
    const lines = shots.flatMap((shot, i) => {
      const next = shots[i + 1];
      const duration = next ? Math.max(next.at - shot.at, 0.001) : 1;
      return [`file '${shot.file}'`, `duration ${duration.toFixed(4)}`];
    });
    const last = shots[shots.length - 1];
    if (last) lines.push(`file '${last.file}'`);
    const list = join(frames, 'frames.txt');
    await writeFile(list, `${lines.join('\n')}\n`);
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list],
      ...['-vf', `fps=${String(FPS)},scale=trunc(iw/2)*2:trunc(ih/2)*2`],
      ...['-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p'],
      ...['-movflags', '+faststart', '-an', output],
    ]);
    await rm(frames, { recursive: true, force: true });
  };
}
