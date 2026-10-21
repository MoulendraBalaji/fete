/**
 * Shared presentational primitives for Fête.
 *
 * These are deliberately tiny, unstyled-by-default wrappers around a CSS
 * Module. They exist so the "Stationery & Ledger" look is expressed once:
 * a card is a sheet of paper, a status is a rubber stamp, a number is set in
 * the mono ledger face.
 *
 * Everything is a plain function component with no client directive, so the
 * server can render them; only components that read state opt into "use client".
 */
export { Sheet } from './Sheet';
export { Button, LinkButton } from './Button';
export { Stamp } from './Stamp';
export { Rule } from './Rule';
export { Money } from './Money';
export { Progress } from './Progress';
export { Callout } from './Callout';
export { Field } from './Field';
export { Tabs } from './Tabs';
export { EmptyState } from './EmptyState';
export { Toast } from './Toast';
