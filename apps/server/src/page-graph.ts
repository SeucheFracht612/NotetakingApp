/** Pure layout planner: no database access and no implicit attachments. */
export type Direction = 'N' | 'E' | 'S' | 'W';
export const DIRECTIONS: Direction[] = ['N', 'E', 'S', 'W'];
export const DELTA: Record<Direction, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 }, E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 }, W: { dx: -1, dy: 0 }
};
const OPPOSITE: Record<Direction, Direction> = { N: 'S', E: 'W', S: 'N', W: 'E' };
export const GRID_LIMIT = 100000;

export interface GridPage {
  id: string;
  gx: number;
  gy: number;
}
export interface PageEdge {
  id: string;
  fromPageId: string;
  toPageId: string;
  direction: Direction;
}
export interface Shift {
  id: string;
  fromGx: number;
  fromGy: number;
  gx: number;
  gy: number;
}
export interface InsertionPlan {
  anchorPageId: string;
  direction: Direction;
  gx: number;
  gy: number;
  replacedEdgeId: string | null;
  previousNeighborId: string | null;
  shifts: Shift[];
  pushedIndependentGroups: number;
}

export class GraphConflict extends Error {
  constructor(message: string) { super(message); }
}

export function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && DIRECTIONS.includes(value as Direction);
}
export function reverseDirection(value: Direction): Direction { return OPPOSITE[value]; }
function coordinate(x: number, y: number): string { return x + ':' + y; }
function inBounds(page: { gx: number; gy: number }): boolean {
  return Number.isInteger(page.gx) && Number.isInteger(page.gy) &&
    Math.abs(page.gx) <= GRID_LIMIT && Math.abs(page.gy) <= GRID_LIMIT;
}

export function sideNeighbor(pageId: string, direction: Direction, edges: PageEdge[]): string | null {
  for (const edge of edges) {
    if (edge.fromPageId === pageId && edge.direction === direction) return edge.toPageId;
    if (edge.toPageId === pageId && OPPOSITE[edge.direction] === direction) return edge.fromPageId;
  }
  return null;
}

/** Validate all invariants, including the reciprocal side usage of incoming edges. */
export function validateGraph(pages: GridPage[], edges: PageEdge[]): void {
  const positions = new Set<string>();
  const byId = new Map<string, GridPage>();
  for (const page of pages) {
    if (byId.has(page.id)) throw new GraphConflict('Duplicate page ID');
    if (!inBounds(page)) throw new GraphConflict('Page exceeds supported grid bounds');
    const key = coordinate(page.gx, page.gy);
    if (positions.has(key)) throw new GraphConflict('Two pages occupy the same grid cell');
    positions.add(key);
    byId.set(page.id, page);
  }
  const sides = new Set<string>();
  const pairs = new Set<string>();
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    const from = byId.get(edge.fromPageId), to = byId.get(edge.toPageId);
    if (!from || !to || from.id === to.id || !isDirection(edge.direction)) {
      throw new GraphConflict('Invalid attachment endpoint');
    }
    if (edgeIds.has(edge.id)) throw new GraphConflict('Duplicate attachment ID');
    edgeIds.add(edge.id);
    const { dx, dy } = DELTA[edge.direction];
    if (to.gx !== from.gx + dx || to.gy !== from.gy + dy) {
      throw new GraphConflict('An attachment no longer joins adjacent pages');
    }
    const sideA = from.id + ':' + edge.direction;
    const sideB = to.id + ':' + OPPOSITE[edge.direction];
    if (sides.has(sideA) || sides.has(sideB)) {
      throw new GraphConflict('An edge of a page already has an attachment');
    }
    sides.add(sideA); sides.add(sideB);
    const pair = [from.id, to.id].sort().join(':');
    if (pairs.has(pair)) throw new GraphConflict('Duplicate attachment');
    pairs.add(pair);
  }
}

function component(start: string, edges: PageEdge[]): Set<string> {
  const visited = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const current = queue.pop()!;
    for (const edge of edges) {
      const neighbor = edge.fromPageId === current ? edge.toPageId :
        edge.toPageId === current ? edge.fromPageId : null;
      if (neighbor !== null && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited;
}

export function planInsertion(pages: GridPage[], edges: PageEdge[], anchorId: string, direction: Direction): InsertionPlan {
  validateGraph(pages, edges);
  if (!isDirection(direction)) throw new GraphConflict('Invalid direction');
  const byId = new Map(pages.map(page => [page.id, page]));
  const anchor = byId.get(anchorId);
  if (!anchor) throw new GraphConflict('Anchor page not found');
  const { dx, dy } = DELTA[direction];
  const neighborId = sideNeighbor(anchorId, direction, edges);
  const removed = neighborId
    ? edges.find(edge => (edge.fromPageId === anchorId && edge.toPageId === neighborId) ||
      (edge.toPageId === anchorId && edge.fromPageId === neighborId))
    : undefined;
  if (neighborId && !removed) throw new GraphConflict('Missing attachment');
  const remaining = removed ? edges.filter(edge => edge.id !== removed.id) : edges;

  // The anchor group is immovable. The B-side of a cut attachment may only move
  // if it has no alternate attachment path back to A (cycle check).
  const pinned = component(anchorId, remaining);
  const moving = neighborId ? component(neighborId, remaining) : new Set<string>();
  if (moving.has(anchorId)) {
    throw new GraphConflict('Cannot insert into this loop: the connected pages would need to move both ways');
  }

  const destination = { gx: anchor.gx + dx, gy: anchor.gy + dy };
  if (!inBounds(destination)) throw new GraphConflict('Grid boundary reached');
  const byCoord = new Map(pages.map(page => [coordinate(page.gx, page.gy), page.id]));
  const groupCache = new Map<string, Set<string>>();
  const getGroup = (id: string): Set<string> => {
    const cached = groupCache.get(id);
    if (cached) return cached;
    const group = component(id, remaining);
    for (const pageId of group) groupCache.set(pageId, group);
    return group;
  };
  const independentGroups = new Set<Set<string>>();

  // Every member of a translated component moves by the *same* cell delta,
  // preserving its internal attachments. Repeat when further groups block it.
  while (true) {
    const targets = new Set<string>([coordinate(destination.gx, destination.gy)]);
    for (const id of moving) {
      const page = byId.get(id)!;
      const target = { gx: page.gx + dx, gy: page.gy + dy };
      if (!inBounds(target)) throw new GraphConflict('Insertion would exceed the grid boundary');
      targets.add(coordinate(target.gx, target.gy));
    }
    let expanded = false;
    for (const target of targets) {
      const blocker = byCoord.get(target);
      if (!blocker || moving.has(blocker)) continue;
      if (pinned.has(blocker)) {
        throw new GraphConflict('Insertion would collide with pages attached to the anchor; no changes were saved');
      }
      const group = getGroup(blocker);
      independentGroups.add(group);
      for (const member of group) {
        if (!moving.has(member)) { moving.add(member); expanded = true; }
      }
    }
    if (!expanded) break;
  }

  const shifts = [...moving].map(id => {
    const page = byId.get(id)!;
    return { id, fromGx: page.gx, fromGy: page.gy, gx: page.gx + dx, gy: page.gy + dy };
  }).sort((a, b) => a.id.localeCompare(b.id));

  // A virtual page allows exact postcondition validation before SQL changes.
  const simulated = pages.map(page => {
    const shifted = shifts.find(s => s.id === page.id);
    return shifted ? { id: page.id, gx: shifted.gx, gy: shifted.gy } : page;
  });
  const newId = '__preview_page__';
  simulated.push({ id: newId, ...destination });
  const attached: PageEdge[] = [
    ...remaining,
    { id: '__preview_edge_1__', fromPageId: anchorId, toPageId: newId, direction }
  ];
  if (neighborId) {
    attached.push({ id: '__preview_edge_2__', fromPageId: newId, toPageId: neighborId, direction });
  }
  validateGraph(simulated, attached);

  return {
    anchorPageId: anchorId, direction,
    gx: destination.gx, gy: destination.gy,
    replacedEdgeId: removed?.id ?? null,
    previousNeighborId: neighborId,
    shifts, pushedIndependentGroups: independentGroups.size
  };
}

export function planLink(pages: GridPage[], edges: PageEdge[], fromPageId: string,
  toPageId: string, direction: Direction): void {
  validateGraph(pages, edges);
  if (!isDirection(direction)) throw new GraphConflict('Invalid direction');
  const from = pages.find(p => p.id === fromPageId), to = pages.find(p => p.id === toPageId);
  if (!from || !to) throw new GraphConflict('Page not found');
  const { dx, dy } = DELTA[direction];
  if (from.gx + dx !== to.gx || from.gy + dy !== to.gy) {
    throw new GraphConflict('Only pages in adjacent grid cells can be attached');
  }
  if (sideNeighbor(fromPageId, direction, edges) !== null ||
      sideNeighbor(toPageId, OPPOSITE[direction], edges) !== null) {
    throw new GraphConflict('One of those page edges already has an attachment');
  }
  validateGraph(pages, [...edges, { id: '__preview_link__', fromPageId, toPageId, direction }]);
}
