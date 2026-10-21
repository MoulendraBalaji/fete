/**
 * jsdom setup for component tests.
 *
 * Deliberately minimal: no `@testing-library/jest-dom` matchers (the project
 * keeps its dependency list tight), so component tests assert with plain DOM
 * properties and Testing Library queries. `cleanup` runs after each test to
 * unmount anything the test left behind, which matters because these components
 * render real trees rather than shallow stubs.
 */
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// React 19 warns about the missing `act` environment flag; set it so component
// tests fail only on genuine problems rather than on configuration noise.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
});
