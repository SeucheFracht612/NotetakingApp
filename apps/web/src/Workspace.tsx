import React, { useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { SpatialPages } from './SpatialPages';

export interface Owner {
  id: number;
  username: string;
}

interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  sortKey: number;
  createdAt: number;
}
interface Note {
  id: string;
  folderId: string;
  title: string;
  sortKey: number;
  createdAt: number;
  updatedAt: number;
}
interface LibraryData {
  folders: Folder[];
  notes: Note[];
}
type Kind = 'folder' | 'note';
type Action = 'create' | 'rename' | 'move';
interface Modal {
  kind: Kind;
  action: Action;
  id?: string;
}

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (response.status === 401) throw new Error('Your session expired. Please sign in again.');
    throw new Error(payload.error || 'Request failed (' + response.status + ')');
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

function sorted<T extends { sortKey: number; id: string }>(values: T[]): T[] {
  return [...values].sort((a, b) => a.sortKey - b.sortKey || a.id.localeCompare(b.id));
}

function pathFor(id: string, folders: Folder[]): string {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const names: string[] = [];
  let current: string | null = id;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const folder = byId.get(current);
    if (!folder) break;
    names.unshift(folder.name);
    current = folder.parentId;
  }
  return names.join(' / ');
}

interface TreeProps {
  parentId: string | null;
  depth: number;
  folders: Folder[];
  notes: Note[];
  selectedId: string | null;
  selectedNoteId: string | null;
  expanded: Set<string>;
  onSelect(id: string): void;
  onSelectNote(note: Note): void;
  onToggle(id: string): void;
  onMenu(kind: Kind, action: Action, id: string): void;
  onDelete(kind: Kind, id: string): void;
  onStep(kind: Kind, id: string, direction: -1 | 1): void;
  onDropFolder(sourceId: string, destinationId: string | null): void;
}
export function FolderTree(props: TreeProps) {
  const children = sorted(props.folders.filter(folder => folder.parentId === props.parentId));
  return (
    <>
      {children.map((folder, index) => {
        const directNotes = sorted(props.notes.filter(note => note.folderId === folder.id));
        const hasChildren = props.folders.some(child => child.parentId === folder.id) || directNotes.length > 0;
        return (
          <div key={folder.id} className="folder-branch">
            <div className={'folder-line' + (props.selectedId === folder.id && props.selectedNoteId === null ? ' selected' : '')}
              style={{ paddingLeft: Math.min(props.depth * 12 + 7, 127) }}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', 'folder:' + folder.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
              onDrop={(event: DragEvent<HTMLDivElement>) => {
                event.preventDefault(); event.stopPropagation();
                const source = event.dataTransfer.getData('text/plain');
                if (source.startsWith('folder:') && source.slice(7) !== folder.id) {
                  props.onDropFolder(source.slice(7), folder.id);
                }
              }}>
              <button type="button" className="tree-expander"
                aria-label={(props.expanded.has(folder.id) ? 'Collapse ' : 'Expand ') + folder.name}
                aria-expanded={props.expanded.has(folder.id)}
                onClick={() => props.onToggle(folder.id)}
                disabled={!hasChildren}>
                {hasChildren ? (props.expanded.has(folder.id) ? '⌄' : '›') : ''}
              </button>
              <button type="button" className="folder-select" title={pathFor(folder.id, props.folders)}
                onClick={() => props.onSelect(folder.id)}>
                <span aria-hidden="true" className="folder-glyph">▰</span>
                <span className="folder-name">{folder.name}</span>
              </button>
              <details className="item-menu">
                <summary aria-label={'Actions for folder ' + folder.name} title="Folder actions">⋯</summary>
                <div className="menu-options">
                  <button type="button" onClick={() => props.onMenu('folder', 'create', folder.id)}>New subfolder</button>
                  <button type="button" onClick={() => props.onMenu('note', 'create', folder.id)}>New note</button>
                  <button type="button" onClick={() => props.onMenu('folder', 'rename', folder.id)}>Rename</button>
                  <button type="button" onClick={() => props.onMenu('folder', 'move', folder.id)}>Move to…</button>
                  <button type="button" disabled={index === 0} onClick={() => props.onStep('folder', folder.id, -1)}>Move up</button>
                  <button type="button" disabled={index === children.length - 1} onClick={() => props.onStep('folder', folder.id, 1)}>Move down</button>
                  <button type="button" className="danger-text" onClick={() => props.onDelete('folder', folder.id)}>Delete folder</button>
                </div>
              </details>
            </div>
            {hasChildren && props.expanded.has(folder.id) && (
              <>
                <FolderTree {...props} parentId={folder.id} depth={props.depth + 1} />
                {directNotes.map((entry, noteIndex) => (
                  <div key={entry.id}
                    className={'sidebar-note-line' + (props.selectedNoteId === entry.id ? ' selected-note' : '')}
                    style={{ paddingLeft: Math.min((props.depth + 1) * 12 + 7, 139) }}>
                    <button type="button" className="sidebar-note-select"
                      title={entry.title}
                      aria-current={props.selectedNoteId === entry.id ? 'page' : undefined}
                      onClick={() => props.onSelectNote(entry)}>
                      <span aria-hidden="true" className="sidebar-note-glyph">▤</span>
                      <span className="folder-name">{entry.title}</span>
                    </button>
                    <details className="item-menu sidebar-note-menu">
                      <summary aria-label={'Actions for note ' + entry.title} title="Note actions">⋯</summary>
                      <div className="menu-options">
                        <button type="button" onClick={() => props.onMenu('note', 'rename', entry.id)}>Rename</button>
                        <button type="button" onClick={() => props.onMenu('note', 'move', entry.id)}>Move to…</button>
                        <button type="button" disabled={noteIndex === 0}
                          onClick={() => props.onStep('note', entry.id, -1)}>Move up</button>
                        <button type="button" disabled={noteIndex === directNotes.length - 1}
                          onClick={() => props.onStep('note', entry.id, 1)}>Move down</button>
                        <button type="button" className="danger-text"
                          onClick={() => props.onDelete('note', entry.id)}>Delete note</button>
                      </div>
                    </details>
                  </div>
                ))}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

interface WorkspaceProps {
  owner: Owner;
  onLogout(): void;
  authError: string;
}
export function Workspace({ owner, onLogout, authError }: WorkspaceProps) {
  const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
  const [data, setData] = useState<LibraryData>({ folders: [], notes: [] });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<Modal | null>(null);
  const [fieldValue, setFieldValue] = useState('');
  const [destination, setDestination] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const refresh = React.useCallback(async () => {
    const result = await api<LibraryData>('/api/library');
    setData(result);
    return result;
  }, []);
  useEffect(() => {
    let current = true;
    void api<LibraryData>('/api/library')
      .then(result => { if (current) setData(result); })
      .catch(reason => { if (current) setError(String(reason instanceof Error ? reason.message : reason)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);

  const byFolder = useMemo(() => new Map(data.folders.map(folder => [folder.id, folder])), [data.folders]);
  const byNote = useMemo(() => new Map(data.notes.map(note => [note.id, note])), [data.notes]);
  const folder = selectedFolder === null ? undefined : byFolder.get(selectedFolder);
  const note = selectedNote === null ? undefined : byNote.get(selectedNote);
  const visibleNotes = sorted(data.notes.filter(item => selectedFolder === null || item.folderId === selectedFolder));
  const availableFolders = sorted([...data.folders]);
  const folderOptions = [...availableFolders].sort((a, b) => pathFor(a.id, data.folders).localeCompare(pathFor(b.id, data.folders)));

  function expandAncestors(id: string | null) {
    if (!id) return;
    setExpanded(previous => {
      const next = new Set(previous);
      const visited = new Set<string>();
      let current: string | null = id;
      while (current && !visited.has(current)) {
        visited.add(current);
        next.add(current);
        current = byFolder.get(current)?.parentId ?? null;
      }
      return next;
    });
  }
  function selectFolder(id: string | null) {
    setSelectedFolder(id);
    setSelectedNote(null);
    setSidebarOpen(false);
    expandAncestors(id);
  }
  function selectNote(item: Note) {
    setSelectedFolder(item.folderId);
    setSelectedNote(item.id);
    setSidebarOpen(false);
    expandAncestors(item.folderId);
  }
  function begin(kind: Kind, action: Action, id?: string | null) {
    const currentFolder = id && kind === 'folder' ? byFolder.get(id) : undefined;
    const currentNote = id && kind === 'note' ? byNote.get(id) : undefined;
    const initialDestination = kind === 'folder'
      ? action === 'create' ? (id === null ? '' : (id ?? selectedFolder ?? '')) : (currentFolder?.parentId ?? '')
      : action === 'create' ? (id ?? selectedFolder ?? availableFolders[0]?.id ?? '') : (currentNote?.folderId ?? '');
    setFieldValue(action === 'create' ? '' : (currentFolder?.name ?? currentNote?.title ?? ''));
    setDestination(initialDestination);
    setError('');
    setModal({ kind, action, id: id ?? undefined });
  }
  async function mutate<T>(path: string, method: string, payload?: unknown): Promise<T> {
    setWorking(true);
    setError('');
    try {
      const result = await api<T>(path, method, payload);
      await refresh();
      return result;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unexpected error';
      setError(message);
      throw reason;
    } finally {
      setWorking(false);
    }
  }
  async function submitModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal || working) return;
    const { kind, action, id } = modal;
    const resource = kind === 'folder' ? 'folders' : 'notes';
    const payload = action === 'move'
      ? kind === 'folder' ? { parentId: destination || null } : { folderId: destination }
      : action === 'rename'
        ? kind === 'folder' ? { name: fieldValue } : { title: fieldValue }
        : kind === 'folder' ? { name: fieldValue, parentId: destination || null } : { title: fieldValue, folderId: destination };
    try {
      const result = await mutate<{ folder?: Folder; note?: Note }>(
        '/api/' + resource + (action === 'create' ? '' : '/' + id),
        action === 'create' ? 'POST' : 'PATCH',
        payload
      );
      setModal(null);
      if (result.folder) selectFolder(result.folder.id);
      if (result.note) selectNote(result.note);
      if (action === 'move' && kind === 'folder') expandAncestors(destination || null);
      if (action === 'move' && kind === 'note' && id) {
        const item = data.notes.find(value => value.id === id);
        if (item) selectNote({ ...item, folderId: destination });
      }
    } catch {
      // Inline error is displayed without closing the dialog.
    }
  }
  async function remove(kind: Kind, id: string) {
    const record = kind === 'folder' ? byFolder.get(id) : byNote.get(id);
    if (!record) return;
    const name = kind === 'folder' ? (record as Folder).name : (record as Note).title;
    if (!window.confirm('Delete ' + (kind === 'folder' ? 'folder' : 'note') + ' "' + name + '"?\n\nThis cannot be undone. Nonempty folders cannot be deleted.')) return;
    try {
      await mutate<void>('/api/' + (kind === 'folder' ? 'folders' : 'notes') + '/' + id, 'DELETE');
      if (kind === 'folder' && selectedFolder === id) selectFolder(null);
      if (kind === 'note' && selectedNote === id) setSelectedNote(null);
    } catch { /* The error banner explains the rejection. */ }
  }
  async function moveStep(kind: Kind, id: string, direction: -1 | 1) {
    const list = kind === 'folder'
      ? sorted(data.folders.filter(entry => entry.parentId === byFolder.get(id)?.parentId))
      : sorted(data.notes.filter(entry => entry.folderId === byNote.get(id)?.folderId));
    const index = list.findIndex(item => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    const beforeId = direction === -1 ? list[target]?.id : list[target + 1]?.id ?? null;
    try {
      await mutate<void>('/api/' + (kind === 'folder' ? 'folders' : 'notes') + '/' + id, 'PATCH', { beforeId });
    } catch { /* Error banner rendered. */ }
  }
  async function dropFolder(sourceId: string, destinationId: string | null) {
    if (!byFolder.has(sourceId) || sourceId === destinationId) return;
    try {
      await mutate<void>('/api/folders/' + sourceId, 'PATCH', { parentId: destinationId });
      expandAncestors(destinationId);
    } catch { /* Cycle or other invalid moves are rejected by the server. */ }
  }

  const pathOptions = folderOptions.filter(candidate => {
    if (!modal || modal.kind !== 'folder' || modal.action !== 'move' || !modal.id) return true;
    const visited = new Set<string>();
    let parent: string | null = candidate.id;
    while (parent && !visited.has(parent)) {
      if (parent === modal.id) return false;
      visited.add(parent);
      parent = byFolder.get(parent)?.parentId ?? null;
    }
    return true;
  });

  return (
    <div className={'workspace library-workspace'+(sidebarCollapsed?' sidebar-collapsed':'')}>
      <aside className={'sidebar library-sidebar' + (sidebarOpen ? ' mobile-visible' : '')}>
        <div className="sidebar-title">
          <span className="mark small" aria-hidden="true">N</span>
          <strong>NotetakingApp</strong>
          <button className="sidebar-close" type="button" onClick={() => setSidebarOpen(false)} aria-label="Close library">×</button>
        </div>
        <div className="library-sidebar-body">
          <div className="library-sidebar-heading"><span className="eyebrow">YOUR LIBRARY</span>
            <button type="button" className="icon-button" title="New top-level folder" aria-label="New top-level folder"
              onClick={() => begin('folder', 'create', null)}>＋</button>
          </div>
          <button type="button" className={'root-item' + (selectedFolder === null && selectedNote === null ? ' active' : '')}
            onClick={() => selectFolder(null)}>▦ <span>All notes</span><span className="count">{data.notes.length}</span></button>
          <div className="tree-region">
            <div className="tree-drop-root" onDragOver={event => event.preventDefault()}
              onDrop={event => {
                event.preventDefault();
                const source = event.dataTransfer.getData('text/plain');
                if (source.startsWith('folder:')) void dropFolder(source.slice(7), null);
              }}>
              <FolderTree parentId={null} depth={0} folders={data.folders} notes={data.notes}
                selectedId={selectedFolder} selectedNoteId={selectedNote}
                expanded={expanded} onSelect={selectFolder} onSelectNote={selectNote}
                onToggle={id => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
                onMenu={begin} onDelete={(kind, id) => { void remove(kind, id); }}
                onStep={(kind, id, direction) => { void moveStep(kind, id, direction); }}
                onDropFolder={(source, target) => { void dropFolder(source, target); }} />
            </div>
            {!data.folders.length && <p className="sidebar-empty">Create your first folder to begin organizing your notes.</p>}
          </div>
          <button type="button" className="sidebar-add" onClick={() => begin('folder', 'create', selectedFolder ?? undefined)}>
            ＋ New {selectedFolder ? 'subfolder' : 'folder'}
          </button>
        </div>
        <div className="sidebar-bottom">
          <span className="user-indicator">Signed in as {owner.username}</span>
          <button type="button" className="text-button" onClick={onLogout}>Sign out</button>
        </div>
      </aside>
      <main className="workspace-main library-main">
        <header className="workspace-toolbar">
          <div className="toolbar-left">
            <button className="mobile-menu-button" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open library">☰</button>
            <span>Library <span className="toolbar-separator">/</span> {note?.title ?? folder?.name ?? 'All notes'}</span>
          </div>
          <span className="stage-label">SLICE 1 · LIBRARY</span>
        </header>
        {error && <div className="library-error" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
        {authError && <div className="library-error" role="alert">{authError}</div>}
        <div className={'library-content'+(note?' library-content-spatial':'')}>
          {loading ? <p className="muted">Loading library…</p> : note ? (
            <SpatialPages key={note.id} noteId={note.id} noteTitle={note.title}
              onBack={() => setSelectedNote(null)}
              onToggleLibrary={()=>{
                if(window.matchMedia('(max-width: 600px)').matches)setSidebarOpen(true);
                else setSidebarCollapsed(value=>!value);
              }} />
          ) : (
            <section>
              <div className="library-heading">
                <div><p className="eyebrow">{folder ? 'FOLDER' : 'LIBRARY'}</p>
                  <h1>{folder?.name ?? 'Your notes'}</h1>
                  <p className="muted">{folder ? pathFor(folder.id, data.folders) : 'Everything you are studying, organized your way.'}</p>
                </div>
                <div className="heading-actions">
                  {folder && <button className="secondary-button" type="button" onClick={() => begin('folder', 'create', folder.id)}>New subfolder</button>}
                  <button className="primary-button" type="button" disabled={!availableFolders.length} title={availableFolders.length ? 'Create note' : 'Create a folder first'}
                    onClick={() => begin('note', 'create')}>＋ New note</button>
                </div>
              </div>
              {visibleNotes.length ? (
                <div className="notes-list">
                  {visibleNotes.map((entry, index) => (
                    <article className="note-row" key={entry.id}>
                      <button className="note-open" type="button" onClick={() => selectNote(entry)}>
                        <span className="note-symbol" aria-hidden="true">▤</span>
                        <span className="note-info"><strong>{entry.title}</strong>
                          <small>{pathFor(entry.folderId, data.folders)}</small></span>
                      </button>
                      <div className="note-actions">
                        <button type="button" disabled={selectedFolder === null || index === 0} onClick={() => { void moveStep('note', entry.id, -1); }} aria-label={'Move ' + entry.title + ' up'} title="Move up">↑</button>
                        <button type="button" disabled={selectedFolder === null || index === visibleNotes.length - 1} onClick={() => { void moveStep('note', entry.id, 1); }} aria-label={'Move ' + entry.title + ' down'} title="Move down">↓</button>
                        <details className="item-menu note-item-menu">
                          <summary aria-label={'Actions for note ' + entry.title}>⋯</summary>
                          <div className="menu-options">
                            <button type="button" onClick={() => begin('note', 'rename', entry.id)}>Rename</button>
                            <button type="button" onClick={() => begin('note', 'move', entry.id)}>Move to…</button>
                            <button type="button" className="danger-text" onClick={() => { void remove('note', entry.id); }}>Delete note</button>
                          </div>
                        </details>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="library-empty">
                  <div className="empty-icon" aria-hidden="true">▤</div>
                  <h2>{data.folders.length ? 'No notes here yet' : 'Start with a folder'}</h2>
                  <p className="muted">{data.folders.length
                    ? 'Create a note and start building your library.'
                    : 'Group lectures, seminars and sources into a structure that makes sense to you.'}</p>
                  <button className="secondary-button" type="button"
                    onClick={() => begin(data.folders.length ? 'note' : 'folder', 'create')}>
                    {data.folders.length ? 'Create a note' : 'Create a folder'}
                  </button>
                </div>
              )}
              {selectedFolder === null && data.folders.length > 0 &&
                <p className="library-hint">Select a folder in the sidebar to see only its notes and change their order.</p>}
            </section>
          )}
        </div>
      </main>

      {modal && (
        <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !working) setModal(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="library-dialog"
            onKeyDown={event => { if (event.key === 'Escape' && !working) setModal(null); }}>
            <h2 id="dialog-title">{modal.action === 'create' ? 'New ' : modal.action === 'rename' ? 'Rename ' : 'Move '}{modal.kind}</h2>
            <form onSubmit={event => { void submitModal(event); }}>
              {modal.action !== 'move' && <>
                <label htmlFor="library-name">{modal.kind === 'folder' ? 'Folder name' : 'Note title'}</label>
                <input id="library-name" autoFocus required maxLength={modal.kind === 'folder' ? 120 : 160}
                  value={fieldValue} onChange={event => setFieldValue(event.target.value)} placeholder={modal.kind === 'folder' ? 'e.g. Modern History' : 'e.g. Lecture 1'} />
              </>}
              {modal.action !== 'rename' && <>
                <label htmlFor="library-destination">{modal.kind === 'folder' ? 'Parent folder' : 'Folder'}</label>
                <select id="library-destination" value={destination} onChange={event => setDestination(event.target.value)} required={modal.kind === 'note'}>
                  {modal.kind === 'folder' && <option value="">Top level</option>}
                  {pathOptions.map(option => <option key={option.id} value={option.id}>{pathFor(option.id, data.folders)}</option>)}
                </select>
              </>}
              <div className="dialog-actions">
                <button className="secondary-button" type="button" onClick={() => setModal(null)} disabled={working}>Cancel</button>
                <button className="primary-button" type="submit" disabled={working || (modal.kind === 'note' && modal.action !== 'rename' && !destination)}>
                  {working ? 'Saving…' : modal.action === 'create' ? 'Create' : 'Save changes'}
                </button>
              </div>
            </form>
            {error && <p className="form-error" role="alert">{error}</p>}
          </section>
        </div>
      )}
    </div>
  );
}
