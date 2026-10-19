import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spatialNavigationShortcut } from '../../web/src/spatial-shortcuts.js';

test('spatial navigation uses Ctrl+Arrow without requiring Shift', () => {
  for (const [key, direction] of [
    ['ArrowUp', 'N'], ['ArrowRight', 'E'], ['ArrowDown', 'S'], ['ArrowLeft', 'W']
  ] as const) {
    assert.equal(spatialNavigationShortcut({key,ctrlKey:true,metaKey:false,altKey:false}),direction);
    assert.equal(spatialNavigationShortcut({key,ctrlKey:true,metaKey:true,altKey:false}),null);
    assert.equal(spatialNavigationShortcut({key,ctrlKey:false,metaKey:true,altKey:false}),null);
    assert.equal(spatialNavigationShortcut({key,ctrlKey:false,metaKey:false,altKey:false}),null);
    assert.equal(spatialNavigationShortcut({key,ctrlKey:true,metaKey:false,altKey:true}),null);
  }
  assert.equal(spatialNavigationShortcut({
    key:'Enter',ctrlKey:true,metaKey:false,altKey:false
  }),null);
});
