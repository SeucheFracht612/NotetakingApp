/** Page navigation shortcuts should not conflict with Linux window-manager Super + Arrow. */
export type SpatialDirection = 'N' | 'E' | 'S' | 'W';

export function spatialNavigationShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>):
  SpatialDirection | null {
  // Ctrl+Arrow is the primary shortcut. Ctrl+Shift+Arrow remains compatible,
  // but Super/Meta and Alt must never trigger navigation.
  if (!event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case 'ArrowUp': return 'N';
    case 'ArrowRight': return 'E';
    case 'ArrowDown': return 'S';
    case 'ArrowLeft': return 'W';
    default: return null;
  }
}
