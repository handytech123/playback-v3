import { verifyRuntime } from './runtime-contract.mjs';
await verifyRuntime();
console.log('All packaged runtime dependencies and isolated executable smoke checks passed.');
