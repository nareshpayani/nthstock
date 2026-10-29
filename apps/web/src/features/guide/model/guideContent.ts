/**
 * The shape of the reviewer guide's copy (NSTOCK-0341). Every tab is a list of blocks the page
 * renders in order, so the copy in `strings.ts` stays data and the layout stays in one place.
 */

/** The diagrams `GuideDiagram` can draw (geometry in `diagrams.ts`). */
export type DiagramId = 'system' | 'ticks' | 'tslo' | 'cicd' | 'agents' | 'loadTest';

export type GuideLink = { label: string; href: string };

/**
 * A walkthrough clip (NSTOCK-0390): `id` names the files the site serves from apps/web/public/demo,
 * `<id>.mp4`, its captions `<id>.vtt` and its poster `<id>.jpg`.
 */
export type GuideVideo = {
  id: string;
  title: string;
  body: string;
  device: 'Desktop' | 'Phone';
  /** "0:45": the clip's length, as the recorder printed it. */
  length: string;
};

/**
 * A still frame the site serves from apps/web/public/round2 (the Demo 2 tab): `file` names
 * `<file>.jpg`; width and height are its CSS pixels, so the page reserves its space.
 */
export type GuideImage = { file: string; alt: string; width: number; height: number };

/** One before and after pair, captured with the same script at the same screen size. */
export type GuideComparison = {
  title: string;
  body: string;
  before: GuideImage;
  after: GuideImage;
};

export type GuideBlock =
  | { kind: 'text'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: readonly string[] }
  | { kind: 'steps'; items: readonly string[] }
  | {
      kind: 'table';
      caption: string;
      head: readonly string[];
      rows: readonly (readonly string[])[];
    }
  | { kind: 'code'; label: string; text: string }
  | { kind: 'facts'; label: string; items: readonly { term: string; value: string }[] }
  | { kind: 'cards'; items: readonly { name: string; body: string }[] }
  | { kind: 'videos'; label: string; items: readonly GuideVideo[] }
  | { kind: 'diagram'; id: DiagramId }
  | {
      kind: 'compare';
      label: string;
      items: readonly GuideComparison[];
      /** Captions over each frame of a pair; the round 1 against Demo 2 wording when left out. */
      captions?: { before: string; after: string };
    }
  | {
      kind: 'figures';
      label: string;
      items: readonly { image: GuideImage; caption: string }[];
    }
  | { kind: 'links'; label: string; items: readonly GuideLink[] }
  | { kind: 'note'; text: string }
  /** A button to the login page; `href` adds a query, e.g. the reviewer link `/login?try=1`. */
  | { kind: 'loginCta'; label: string; href?: string };

export type GuideTab = {
  /** The `?tab=` value; stable, because reviewers share these links. */
  id: string;
  /** Short name in the tab list. */
  label: string;
  /** The panel's heading. */
  title: string;
  /** One line under the heading: what this tab answers. */
  summary: string;
  blocks: readonly GuideBlock[];
};

/** Types the guide's tab list and keeps it a non-empty tuple. */
export const defineTabs = (tabs: readonly [GuideTab, ...GuideTab[]]) => tabs;

/** The tab a `?tab=` value names, or the first tab for a missing or unknown one. */
export function resolveTab<T extends { id: string }>(tabs: readonly [T, ...T[]], id: unknown): T {
  return tabs.find((tab) => tab.id === id) ?? tabs[0];
}

/** The tabs before and after `id`, for the pager at the foot of each panel. */
export function neighboursOf<T extends { id: string }>(
  tabs: readonly T[],
  id: string,
): { previous: T | null; next: T | null } {
  const index = tabs.findIndex((tab) => tab.id === id);
  return {
    previous: index > 0 ? (tabs[index - 1] ?? null) : null,
    next: index >= 0 && index < tabs.length - 1 ? (tabs[index + 1] ?? null) : null,
  };
}

/** Where the site serves a walkthrough clip's files (apps/web/public/demo). */
export const videoFile = (id: string, extension: 'mp4' | 'vtt' | 'jpg') =>
  `/demo/${id}.${extension}`;

/** Where the site serves a Demo 2 still (apps/web/public/round2). */
export const imageFile = (file: string) => `/round2/${file}.jpg`;

/** A link to a file or folder in the public repository, on the default branch. */
export const repoLink = (path: string) =>
  `https://github.com/nareshpayani/nthstock/blob/develop/${path}`;
