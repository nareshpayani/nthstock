import { colors } from '@nthstock/tokens';
import { formatIstDate, formatIstTimeSeconds, toIstParts } from '@nthstock/utils';
import { strings } from '../strings';
import type { ChartHandle } from '../components/PriceChartCanvas';

/** Height of the caption band above the plot, in CSS px. */
const CAPTION_HEIGHT = 32;

/** "INFY · 1D · 5m · 29 Oct 2026, 08:45:12 pm IST · nthstock": what and when, on the image. */
export function snapshotCaption(parts: readonly (string | undefined)[], at: Date): string {
  return [
    ...parts.filter((part): part is string => Boolean(part)),
    `${formatIstDate(at)}, ${formatIstTimeSeconds(at)} ${strings.clock.suffix}`,
    strings.snapshot.brand,
  ].join(' · ');
}

/** "nthstock-INFY-20261029-2045.png", by the time in IST. */
export function snapshotFileName(name: string, at: Date): string {
  const { year, month, day, minuteOfDay } = toIstParts(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  const [hour, minute] = [Math.floor(minuteOfDay / 60), minuteOfDay % 60];
  const slug = name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `nthstock-${slug}-${String(year)}${pad(month)}${pad(day)}-${pad(hour)}${pad(minute)}.png`;
}

/** The SVG as an image the canvas can draw; resolves null when the browser will not decode it. */
async function svgImage(svg: SVGSVGElement): Promise<HTMLImageElement | null> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // As an image the SVG loses the page's CSS, so its labels take the page's font with them.
  const style = getComputedStyle(svg);
  copy.setAttribute('font-family', style.fontFamily);
  copy.setAttribute('font-size', style.fontSize);
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  try {
    await image.decode();
    return image;
  } catch {
    return null;
  }
}

/**
 * The chart as a PNG (NSTOCK-0463): a caption band, the plot as the library draws it, and the
 * drawings over it. Null when the canvas cannot be read.
 */
export async function chartSnapshot(handle: ChartHandle, caption: string): Promise<Blob | null> {
  const plot = handle.chart.takeScreenshot();
  // The screenshot is in device pixels; everything added is scaled to match.
  const ratio = plot.width / Math.max(1, handle.host.clientWidth);
  const band = Math.round(CAPTION_HEIGHT * ratio);
  const out = document.createElement('canvas');
  out.width = plot.width;
  out.height = plot.height + band;
  const context = out.getContext('2d');
  if (!context) return null;
  context.fillStyle = colors.surface;
  context.fillRect(0, 0, out.width, out.height);
  context.fillStyle = colors.ink;
  context.font = `600 ${String(Math.round(13 * ratio))}px "IBM Plex Sans", system-ui, sans-serif`;
  context.textBaseline = 'middle';
  context.fillText(caption, Math.round(12 * ratio), band / 2, out.width - 24 * ratio);
  context.drawImage(plot, 0, band);
  const layer = handle.host
    .closest('figure')
    ?.querySelector<SVGSVGElement>('svg[data-testid="drawing-layer"]');
  const drawings = layer ? await svgImage(layer) : null;
  if (drawings && layer) {
    context.drawImage(
      drawings,
      0,
      band,
      layer.width.baseVal.value * ratio,
      layer.height.baseVal.value * ratio,
    );
  }
  return new Promise((resolve) => {
    out.toBlob(resolve, 'image/png');
  });
}

export type SnapshotOutcome = 'shared' | 'downloaded' | 'cancelled';

/**
 * Hands the PNG over: the Share sheet on a phone that can share files, a download otherwise. A
 * share the user cancels is not an error; any other share failure falls back to the download.
 */
export async function deliverSnapshot(
  blob: Blob,
  fileName: string,
  { share }: { share: boolean },
): Promise<SnapshotOutcome> {
  const file = new File([blob], fileName, { type: 'image/png' });
  if (share && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoked on the next turn, once the download has the bytes.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return 'downloaded';
}
