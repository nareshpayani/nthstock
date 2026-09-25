import { createIcon } from './createIcon.js';

// nthstock's own icon set: simple 24×24 strokes on a 2 px grid, drawn for this project.

export const IconSearch = /* @__PURE__ */ createIcon('search', () => (
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </>
));

export const IconSort = /* @__PURE__ */ createIcon('sort', () => (
  <>
    <path d="M7 4v16M3.5 7.5 7 4l3.5 3.5" />
    <path d="M17 20V4M13.5 16.5 17 20l3.5-3.5" />
  </>
));

export const IconPlus = /* @__PURE__ */ createIcon('plus', () => <path d="M12 5v14M5 12h14" />);

export const IconMinus = /* @__PURE__ */ createIcon('minus', () => <path d="M5 12h14" />);

export const IconCheck = /* @__PURE__ */ createIcon('check', () => (
  <path d="m5 12.5 4.5 4.5L19 7.5" />
));

export const IconClose = /* @__PURE__ */ createIcon('close', () => (
  <path d="M6 6l12 12M18 6 6 18" />
));

export const IconChevronDown = /* @__PURE__ */ createIcon('chevron-down', () => (
  <path d="m6 9 6 6 6-6" />
));

export const IconChevronUp = /* @__PURE__ */ createIcon('chevron-up', () => (
  <path d="m6 15 6-6 6 6" />
));

export const IconChevronLeft = /* @__PURE__ */ createIcon('chevron-left', () => (
  <path d="m15 6-6 6 6 6" />
));

export const IconChevronRight = /* @__PURE__ */ createIcon('chevron-right', () => (
  <path d="m9 6 6 6-6 6" />
));

export const IconMenu = /* @__PURE__ */ createIcon('menu', () => (
  <path d="M4 7h16M4 12h16M4 17h16" />
));

export const IconMore = /* @__PURE__ */ createIcon('more', () => (
  <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} />
));

export const IconUser = /* @__PURE__ */ createIcon('user', () => (
  <>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
  </>
));

export const IconSupport = /* @__PURE__ */ createIcon('support', () => (
  <>
    <path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2" />
    <rect x="3.5" y="13" width="4" height="6" rx="1.5" />
    <rect x="16.5" y="13" width="4" height="6" rx="1.5" />
    <path d="M18.5 19c0 1.2-1.5 2-4 2h-1.5" />
  </>
));

export const IconHelp = /* @__PURE__ */ createIcon('help', () => (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2-2.4 3.7" />
    <path d="M12 17h.01" />
  </>
));

export const IconInfo = /* @__PURE__ */ createIcon('info', () => (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.5h.01" />
  </>
));

export const IconAlert = /* @__PURE__ */ createIcon('alert', () => (
  <>
    <path d="M10.3 4.3 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4M12 17h.01" />
  </>
));

export const IconRefresh = /* @__PURE__ */ createIcon('refresh', () => (
  <>
    <path d="M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1" />
    <path d="M17.5 3.5v3.4h-3.4M6.5 20.5v-3.4h3.4" />
  </>
));

export const IconBookmark = /* @__PURE__ */ createIcon('bookmark', () => (
  <path d="M6.5 4h11v16.5L12 16.5l-5.5 4Z" />
));

export const IconBell = /* @__PURE__ */ createIcon('bell', () => (
  <>
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15Z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </>
));

export const IconKeyboard = /* @__PURE__ */ createIcon('keyboard', () => (
  <>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8" />
  </>
));

export const IconWallet = /* @__PURE__ */ createIcon('wallet', () => (
  <>
    <path d="M19 7.5V6a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 6v12A1.5 1.5 0 0 0 5 19.5h14a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 19 7.5H5" />
    <path d="M16.5 13.5h.01" />
  </>
));

export const IconBriefcase = /* @__PURE__ */ createIcon('briefcase', () => (
  <>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18" />
  </>
));

export const IconClock = /* @__PURE__ */ createIcon('clock', () => (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>
));

export const IconChart = /* @__PURE__ */ createIcon('chart', () => (
  <>
    <path d="M4 4v16h16" />
    <path d="m7.5 14.5 3.5-4 3 2.5 5-6" />
  </>
));

export const IconTrendUp = /* @__PURE__ */ createIcon('trend-up', () => (
  <path d="m3.5 16.5 6-6 4 4 7-7M15 7.5h5.5V13" />
));

export const IconTrendDown = /* @__PURE__ */ createIcon('trend-down', () => (
  <path d="m3.5 7.5 6 6 4-4 7 7M15 16.5h5.5V11" />
));

export const IconInbox = /* @__PURE__ */ createIcon('inbox', () => (
  <>
    <path d="M3.5 13.5 6 5.5h12l2.5 8V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18Z" />
    <path d="M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5" />
  </>
));

export const IconLogout = /* @__PURE__ */ createIcon('logout', () => (
  <>
    <path d="M14 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h8" />
    <path d="M10 12h10M16.5 8.5 20 12l-3.5 3.5" />
  </>
));

export const IconSettings = /* @__PURE__ */ createIcon('settings', () => (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
  </>
));

export const IconGrid = /* @__PURE__ */ createIcon('grid', () => (
  <path d="M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z" />
));

export const IconExternal = /* @__PURE__ */ createIcon('external', () => (
  <>
    <path d="M13.5 4.5h6v6M19.5 4.5 11 13" />
    <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  </>
));
