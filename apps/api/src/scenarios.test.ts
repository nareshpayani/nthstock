import { healthScenarios, runScenarioSuite } from '@nthstock/contracts/testing';
import { buildApp } from './app.js';
import { injectBackend } from './test/injectBackend.js';

// The same scenario files run against the MSW node server in apps/web (ADR 0004).
runScenarioSuite('apps/api (app.inject)', [healthScenarios], () => injectBackend(buildApp()));
