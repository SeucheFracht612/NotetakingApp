/** Navigate the spatial page graph using the physical AltGr modifier.
 * Firefox on Linux exposes AltGr/ISO_Level3_Shift via getModifierState('AltGraph').
 * Do not alias Ctrl+Alt: that would steal ordinary editor/browser shortcuts.
 */
export type SpatialDirection = 'N' | 'E' | 'S' | 'W';

type SpatialKeyEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'getModifierState'>;

export function spatialNavigationShortcut(event: SpatialKeyEvent): SpatialDirection | null {
  if (event.metaKey || !event.getModifierState('AltGraph')) return null;
  switch (event.key) {
    case 'ArrowUp': return 'N';
    case 'ArrowRight': return 'E';
    case 'ArrowDown': return 'S';
    case 'ArrowLeft': return 'W';
    default: return null;
  }
}
