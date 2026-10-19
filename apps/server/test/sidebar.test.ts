import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FolderTree } from '../../web/src/Workspace.js';

const folder = (id: string, name: string, parentId: string | null) =>
  ({ id, parentId, name, sortKey: 0, createdAt: 0 });
const note = (id: string, title: string, folderId: string, sortKey = 0) =>
  ({ id, title, folderId, sortKey, createdAt: 0, updatedAt: 0 });

test('sidebar folders with only notes expand and render their notes in order', () => {
  const folders = [folder('a', 'History', null), folder('b', 'Lectures', 'a')];
  const notes = [note('n2', 'Second lecture', 'b', 1), note('n1', 'First lecture', 'b', 0)];
  const props = {
    parentId: null, depth: 0, folders, notes,
    selectedId: 'b', selectedNoteId: 'n1',
    onSelect: (_id: string) => undefined,
    onSelectNote: (_entry: typeof notes[number]) => undefined,
    onToggle: (_id: string) => undefined,
    onMenu: (_kind: 'note' | 'folder', _action: 'create' | 'rename' | 'move', _id: string) => undefined,
    onDelete: (_kind: 'note' | 'folder', _id: string) => undefined,
    onStep: (_kind: 'note' | 'folder', _id: string, _direction: -1 | 1) => undefined,
    onDropFolder: (_source: string, _destination: string | null) => undefined
  };

  const closed = renderToStaticMarkup(React.createElement(FolderTree, { ...props, expanded: new Set(['a']) }));
  assert.match(closed, /Expand Lectures/);
  assert.match(closed, /aria-expanded="false"/);
  assert.doesNotMatch(closed, /First lecture/);

  const opened = renderToStaticMarkup(React.createElement(FolderTree, { ...props, expanded: new Set(['a','b']) }));
  assert.ok(opened.indexOf('First lecture') < opened.indexOf('Second lecture'));
  assert.match(opened, /aria-current="page"/);
  assert.match(opened, /class="sidebar-note-line selected-note"/);
  assert.match(opened, /Actions for note First lecture/);
  assert.match(opened, /New note/);

  const moved = renderToStaticMarkup(React.createElement(FolderTree, {
    ...props,
    notes: notes.map(entry => entry.id === 'n1' ? { ...entry, folderId: 'a' } : entry),
    expanded: new Set(['a','b'])
  }));
  assert.ok(moved.indexOf('First lecture') < moved.indexOf('Lectures'));
});
