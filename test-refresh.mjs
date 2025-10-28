#!/usr/bin/env node
/**
 * Test script for the model refresh functionality
 * Tests the refreshModels() function directly without going through HTTP
 */

console.log('Testing model refresh functionality...\n');

// Import the refreshModels function
const { refreshModels, models: initialModels } = await import('./build/server/models.js');

console.log(`Initial model count: ${initialModels.length}`);
console.log(`Initial models: ${initialModels.map(m => m.id).join(', ')}\n`);

console.log('Calling refreshModels()...');
const summary = await refreshModels();

console.log('\n=== Refresh Summary ===');
console.log(`Refreshed at: ${summary.refreshedAt}`);
console.log(`Duration: ${summary.durationMs}ms`);
console.log(`Total models: ${summary.total}`);
console.log(`Added: ${summary.added.length > 0 ? summary.added.join(', ') : 'none'}`);
console.log(`Removed: ${summary.removed.length > 0 ? summary.removed.join(', ') : 'none'}`);
console.log(`Changed: ${summary.changed.length > 0 ? summary.changed.join(', ') : 'none'}`);
console.log(`Had changes: ${summary.hadChanges || (summary.added.length > 0 || summary.removed.length > 0 || summary.changed.length > 0)}`);

console.log('\n✓ Test completed successfully!');
process.exit(0);
