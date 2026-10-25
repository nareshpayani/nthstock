import type { DiagramId } from './guideContent';

/** Colour role of a box; `GuideDiagram` maps each to design-token classes. */
export type NodeTone = 'brand' | 'neutral' | 'data' | 'warn' | 'done';

export type NodeGeometry = {
  x: number;
  y: number;
  w: number;
  h: number;
  tone: NodeTone;
  dashed?: boolean;
};

export type Point = readonly [number, number];

export type EdgeGeometry = {
  /** Polyline from the source to the arrowhead. */
  points: readonly Point[];
  /** Where the edge's label sits, and how it is anchored. */
  label?: { at: Point; anchor?: 'start' | 'middle' | 'end' };
  dashed?: boolean;
};

export type GroupGeometry = { x: number; y: number; w: number; h: number };

export type FlowGeometry = {
  width: number;
  height: number;
  groups: Readonly<Record<string, GroupGeometry>>;
  nodes: Readonly<Record<string, NodeGeometry>>;
  edges: Readonly<Record<string, EdgeGeometry>>;
};

/**
 * Box-and-arrow layouts of the guide's diagrams (NSTOCK-0341), in SVG user units. The labels are
 * in `strings.diagrams`, keyed the same way; a test checks every key has its label.
 */
export const FLOW_DIAGRAMS = {
  system: {
    width: 720,
    height: 440,
    groups: {
      browser: { x: 8, y: 8, w: 236, h: 424 },
      servers: { x: 268, y: 8, w: 444, h: 424 },
    },
    nodes: {
      spa: { x: 24, y: 40, w: 204, h: 64, tone: 'brand' },
      stores: { x: 24, y: 150, w: 204, h: 64, tone: 'brand' },
      msw: { x: 24, y: 262, w: 204, h: 82, tone: 'neutral', dashed: true },
      realtime: { x: 290, y: 40, w: 160, h: 64, tone: 'brand' },
      api: { x: 290, y: 150, w: 160, h: 64, tone: 'brand' },
      postgres: { x: 290, y: 280, w: 160, h: 64, tone: 'data' },
      workers: { x: 290, y: 370, w: 160, h: 56, tone: 'neutral' },
      quotes: { x: 540, y: 40, w: 160, h: 64, tone: 'brand' },
      redis: { x: 540, y: 150, w: 160, h: 90, tone: 'data' },
      matcher: { x: 540, y: 280, w: 160, h: 64, tone: 'brand' },
    },
    edges: {
      ws: {
        points: [
          [290, 72],
          [228, 72],
        ],
        label: { at: [259, 64] },
      },
      rest: {
        points: [
          [228, 96],
          [252, 96],
          [252, 182],
          [290, 182],
        ],
        label: { at: [256, 140], anchor: 'start' },
      },
      stores: {
        points: [
          [126, 104],
          [126, 150],
        ],
        label: { at: [134, 131], anchor: 'start' },
      },
      demo: {
        points: [
          [126, 214],
          [126, 262],
        ],
        label: { at: [134, 242], anchor: 'start' },
        dashed: true,
      },
      ticks: {
        points: [
          [620, 104],
          [620, 150],
        ],
        label: { at: [628, 131], anchor: 'start' },
      },
      fanout: {
        points: [
          [540, 166],
          [495, 166],
          [495, 88],
          [450, 88],
        ],
        label: { at: [490, 128], anchor: 'end' },
      },
      streams: {
        points: [
          [450, 200],
          [540, 200],
        ],
        label: { at: [495, 192] },
      },
      matcher: {
        points: [
          [620, 280],
          [620, 240],
        ],
        label: { at: [628, 264], anchor: 'start' },
      },
      reconcile: {
        points: [
          [450, 312],
          [540, 312],
        ],
        label: { at: [486, 304] },
      },
      sql: {
        points: [
          [370, 214],
          [370, 280],
        ],
        label: { at: [378, 251], anchor: 'start' },
      },
      workerSql: {
        points: [
          [370, 370],
          [370, 344],
        ],
        label: { at: [378, 361], anchor: 'start' },
      },
      jobs: {
        points: [
          [450, 398],
          [525, 398],
          [525, 228],
          [540, 228],
        ],
        label: { at: [517, 390], anchor: 'end' },
      },
    },
  },
  ticks: {
    width: 720,
    height: 360,
    groups: {
      demo: { x: 8, y: 120, w: 704, h: 104 },
      stack: { x: 8, y: 244, w: 704, h: 104 },
    },
    nodes: {
      master: { x: 24, y: 16, w: 200, h: 64, tone: 'neutral' },
      gbm: { x: 260, y: 16, w: 200, h: 64, tone: 'brand' },
      adapter: { x: 496, y: 16, w: 200, h: 64, tone: 'brand' },
      engine: { x: 24, y: 146, w: 200, h: 64, tone: 'neutral' },
      delta: { x: 260, y: 146, w: 200, h: 64, tone: 'neutral' },
      store: { x: 496, y: 146, w: 200, h: 64, tone: 'done' },
      pump: { x: 24, y: 270, w: 200, h: 64, tone: 'data' },
      hub: { x: 260, y: 270, w: 200, h: 64, tone: 'data' },
      quotes: { x: 496, y: 270, w: 200, h: 64, tone: 'done' },
    },
    edges: {
      masterGbm: {
        points: [
          [224, 48],
          [260, 48],
        ],
      },
      gbmAdapter: {
        points: [
          [460, 48],
          [496, 48],
        ],
      },
      adapterEngine: {
        points: [
          [560, 80],
          [560, 100],
          [200, 100],
          [200, 146],
        ],
      },
      engineDelta: {
        points: [
          [224, 178],
          [260, 178],
        ],
      },
      deltaStore: {
        points: [
          [460, 178],
          [496, 178],
        ],
      },
      adapterPump: {
        points: [
          [680, 80],
          [680, 112],
          [716, 112],
          [716, 234],
          [90, 234],
          [90, 270],
        ],
      },
      pumpHub: {
        points: [
          [224, 302],
          [260, 302],
        ],
      },
      hubQuotes: {
        points: [
          [460, 302],
          [496, 302],
        ],
      },
    },
  },
  tslo: {
    width: 720,
    height: 300,
    groups: {},
    nodes: {
      pending: { x: 16, y: 70, w: 150, h: 56, tone: 'neutral' },
      armed: { x: 196, y: 70, w: 150, h: 56, tone: 'brand' },
      trailing: { x: 376, y: 70, w: 150, h: 56, tone: 'brand' },
      triggered: { x: 556, y: 70, w: 150, h: 56, tone: 'warn' },
      cancelled: { x: 70, y: 220, w: 250, h: 56, tone: 'neutral' },
      rejected: { x: 370, y: 220, w: 150, h: 56, tone: 'warn' },
      executed: { x: 556, y: 220, w: 150, h: 56, tone: 'done' },
    },
    edges: {
      entry: {
        points: [
          [166, 98],
          [196, 98],
        ],
        label: { at: [181, 62] },
      },
      activate: {
        points: [
          [346, 98],
          [376, 98],
        ],
        label: { at: [361, 62] },
      },
      ratchet: {
        points: [
          [420, 70],
          [420, 34],
          [482, 34],
          [482, 70],
        ],
        label: { at: [451, 24] },
      },
      trigger: {
        points: [
          [526, 98],
          [556, 98],
        ],
        label: { at: [541, 62] },
      },
      fill: {
        points: [
          [650, 126],
          [650, 220],
        ],
        label: { at: [658, 178], anchor: 'start' },
      },
      fail: {
        points: [
          [590, 126],
          [480, 220],
        ],
        label: { at: [560, 170], anchor: 'start' },
      },
      cancelPending: {
        points: [
          [90, 126],
          [130, 220],
        ],
        dashed: true,
      },
      cancelArmed: {
        points: [
          [270, 126],
          [220, 220],
        ],
        dashed: true,
      },
      cancelTrailing: {
        points: [
          [420, 126],
          [300, 220],
        ],
        dashed: true,
      },
    },
  },
  cicd: {
    width: 720,
    height: 330,
    groups: {},
    nodes: {
      pr: { x: 16, y: 20, w: 150, h: 76, tone: 'neutral' },
      checks: { x: 206, y: 20, w: 300, h: 76, tone: 'brand' },
      review: { x: 546, y: 20, w: 158, h: 76, tone: 'brand' },
      merge: { x: 546, y: 140, w: 158, h: 60, tone: 'neutral' },
      devci: { x: 326, y: 140, w: 180, h: 60, tone: 'brand' },
      devdeploy: { x: 16, y: 140, w: 270, h: 60, tone: 'done' },
      promote: { x: 16, y: 250, w: 270, h: 60, tone: 'warn' },
      prodci: { x: 326, y: 250, w: 180, h: 60, tone: 'brand' },
      live: { x: 546, y: 250, w: 158, h: 60, tone: 'done' },
    },
    edges: {
      prChecks: {
        points: [
          [166, 58],
          [206, 58],
        ],
      },
      checksReview: {
        points: [
          [506, 58],
          [546, 58],
        ],
      },
      fix: {
        points: [
          [356, 96],
          [356, 118],
          [91, 118],
          [91, 96],
        ],
        label: { at: [224, 112] },
        dashed: true,
      },
      reviewMerge: {
        points: [
          [625, 96],
          [625, 140],
        ],
      },
      mergeDevci: {
        points: [
          [546, 170],
          [506, 170],
        ],
      },
      devciDeploy: {
        points: [
          [326, 170],
          [286, 170],
        ],
      },
      release: {
        points: [
          [151, 200],
          [151, 250],
        ],
        label: { at: [159, 230], anchor: 'start' },
      },
      promoteProdci: {
        points: [
          [286, 280],
          [326, 280],
        ],
      },
      prodciLive: {
        points: [
          [506, 280],
          [546, 280],
        ],
      },
    },
  },
  agents: {
    width: 720,
    height: 300,
    groups: {},
    nodes: {
      owner: { x: 16, y: 112, w: 150, h: 76, tone: 'warn' },
      planner: { x: 196, y: 24, w: 150, h: 60, tone: 'brand' },
      developer: { x: 446, y: 24, w: 150, h: 60, tone: 'brand' },
      reviewer: { x: 446, y: 216, w: 150, h: 60, tone: 'brand' },
      fixer: { x: 196, y: 216, w: 150, h: 60, tone: 'brand' },
      merge: { x: 616, y: 120, w: 96, h: 60, tone: 'done' },
    },
    edges: {
      plan: {
        points: [
          [166, 124],
          [226, 84],
        ],
        label: { at: [184, 96], anchor: 'end' },
      },
      ready: {
        points: [
          [346, 54],
          [446, 54],
        ],
        label: { at: [396, 44] },
      },
      pr: {
        points: [
          [521, 84],
          [521, 216],
        ],
        label: { at: [529, 154], anchor: 'start' },
      },
      fixNeeded: {
        points: [
          [446, 236],
          [346, 236],
        ],
        label: { at: [396, 228] },
      },
      pushFix: {
        points: [
          [346, 260],
          [446, 260],
        ],
        label: { at: [396, 292] },
      },
      approved: {
        points: [
          [596, 246],
          [664, 246],
          [664, 180],
        ],
        label: { at: [656, 206], anchor: 'end' },
      },
    },
  },
} as const satisfies Record<Exclude<DiagramId, 'loadTest'>, FlowGeometry>;

export type FlowDiagramId = keyof typeof FLOW_DIAGRAMS;

/** Position of a value on a log10 axis from `min` to `max`, as a 0..1 fraction. */
export function logFraction(value: number, min: number, max: number): number {
  if (value <= min) return 0;
  if (value >= max) return 1;
  return (Math.log10(value) - Math.log10(min)) / (Math.log10(max) - Math.log10(min));
}
