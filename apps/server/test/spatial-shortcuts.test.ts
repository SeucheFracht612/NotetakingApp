import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spatialNavigationShortcut } from '../../web/src/spatial-shortcuts.js';

function keyEvent(key: string, altGraph: boolean, metaKey = false) {
  return {key, metaKey, getModifierState: (modifier: string) => modifier === 'AltGraph' && altGraph};
}

test('AltGr + arrows navigate all four attached directions', () => {
  for(const [key, side] of [
    ['ArrowUp', 'N'], ['ArrowRight', 'E'], ['ArrowDown', 'S'], ['ArrowLeft', 'W']
  ] as const) {
    assert.equal(spatialNavigationShortcut(keyEvent(key,true)),side);
    assert.equal(spatialNavigationShortcut(keyEvent(key,false)),null);
    assert.equal(spatialNavigationShortcut(keyEvent(key,true,true)),null);
  }
});

test('Ctrl, Super, regular Alt, and unrelated AltGr key presses do not navigate', () => {
  const modifiedKey = {
    key:'ArrowRight',
    ctrlKey:true,
    altKey:true,
    metaKey:false,
    getModifierState: (modifier:string) => modifier === 'never-present'
  };
  assert.equal(spatialNavigationShortcut(modifiedKey),null);
  assert.equal(spatialNavigationShortcut(keyEvent('Enter',true)),null);
  assert.equal(spatialNavigationShortcut(keyEvent('a',true)),null);
});
