import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GraphConflict, planInsertion, planLink, sideNeighbor, validateGraph,
  type GridPage, type PageEdge, type Direction
} from '../src/page-graph.js';

const page = (id: string, gx: number, gy: number): GridPage => ({ id, gx, gy });
const edge = (id: string, fromPageId: string, toPageId: string, direction: Direction): PageEdge =>
  ({ id, fromPageId, toPageId, direction });

test('explicit links only: geometric neighbors have no implicit navigation', () => {
  const pages = [page('A',0,0), page('B',1,0)];
  assert.equal(sideNeighbor('A','E',[]), null);
  planLink(pages, [], 'A','B','E');
  assert.throws(() => planLink(pages, [], 'A','B','N'), GraphConflict);
  assert.deepEqual(planInsertion(pages, [], 'A','E').shifts.map(s=>s.id), ['B']);
});

test('insert between A and B shifts only the B branch and preserves other attachments', () => {
  const pages = [page('A',0,0),page('B',1,0),page('E',2,0),page('C',0,-1),page('D',1,-1)];
  const edges = [edge('AB','A','B','E'),edge('BE','B','E','E'),
    edge('AC','A','C','N'),edge('CD','C','D','E')];
  const result = planInsertion(pages, edges, 'A','E');
  assert.equal(result.previousNeighborId, 'B');
  assert.equal(result.replacedEdgeId, 'AB');
  assert.deepEqual(result.shifts.map(s => [s.id,s.gx,s.gy]), [['B',2,0],['E',3,0]]);
  assert.equal(result.pushedIndependentGroups, 0);
});

test('insertion rejects loops and anchored collisions without mutating inputs', () => {
  const pages = [page('A',0,0),page('B',1,0),page('C',0,1),page('D',1,1)];
  const edges = [edge('AB','A','B','E'),edge('AC','A','C','S'),
    edge('CD','C','D','E'),edge('BD','B','D','S')];
  const snapshot = JSON.stringify({pages,edges});
  assert.throws(() => planInsertion(pages,edges,'A','E'), /loop/i);
  assert.equal(JSON.stringify({pages,edges}),snapshot);

  const anchored = [
    page('A',0,0),page('B',1,0),page('C',0,-1),page('D',1,-1),
    page('E',2,-1),page('F',2,0)
  ];
  const links = [edge('AB','A','B','E'),edge('AC','A','C','N'),edge('CD','C','D','E'),
    edge('DE','D','E','E'),edge('EF','E','F','S')];
  assert.throws(() => planInsertion(anchored,links,'A','E'), /collide/i);
});

test('cascade push shifts entire independent linked components; free-side insertion too', () => {
  const pages=[page('A',0,0),page('B',1,0),page('U',2,0),page('V',3,0)];
  const edges=[edge('AB','A','B','E'),edge('UV','U','V','E')];
  const inserted=planInsertion(pages,edges,'A','E');
  assert.deepEqual(inserted.shifts.map(s=>[s.id,s.gx]), [['B',2],['U',3],['V',4]]);
  assert.equal(inserted.pushedIndependentGroups,1);
  const free=planInsertion([page('A',0,0),page('U',1,0),page('V',2,0)],
    [edge('UV','U','V','E')],'A','E');
  assert.deepEqual(free.shifts.map(s=>[s.id,s.gx]),[['U',2],['V',3]]);
  assert.equal(free.previousNeighborId,null);
});

test('validateGraph catches side duplication, overlap, broken edges and bounds', () => {
  const pages=[page('A',0,0),page('B',1,0),page('C',0,1)];
  validateGraph(pages,[edge('AB','A','B','E')]);
  assert.throws(() => validateGraph([...pages,page('D',1,0)],[]), /same grid cell/i);
  assert.throws(() => validateGraph(pages,[edge('bad','A','C','E')]), /adjacent/i);
  assert.throws(() => validateGraph(pages,[edge('AB','A','B','E'),edge('AB2','A','B','E')]), /already|Duplicate/i);
  assert.throws(() => validateGraph([page('A',100001,0)],[]), /bounds/i);
});
