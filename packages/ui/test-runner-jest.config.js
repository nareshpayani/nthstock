import { getJestConfig } from '@storybook/test-runner';

// Storybook test runner (T-012): axe runs on every story via @storybook/addon-a11y
// (parameters.a11y.test = 'error'). PW_CHROMIUM_PATH lets a sandbox point at a preinstalled
// Chromium; CI uses the browser from `npx playwright install chromium`.
const base = getJestConfig();
const executablePath = process.env.PW_CHROMIUM_PATH;

export default {
  ...base,
  testEnvironmentOptions: {
    'jest-playwright': {
      ...base.testEnvironmentOptions['jest-playwright'],
      browsers: ['chromium'],
      ...(executablePath ? { launchOptions: { executablePath } } : {}),
    },
  },
};
