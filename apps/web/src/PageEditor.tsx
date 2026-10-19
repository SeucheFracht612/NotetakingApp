import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { createPortal } from 'react-dom';
import StarterKit from '@tiptap/starter-kit';
import { getDraft, type JsonDoc, type PageDraft } from './document-autosave';

interface Props { noteId: string; pageId: string; zoom: number }
type TiptapContent = NonNullable<Parameters<typeof useEditor>[0]['content']>;
function Tool({label,action,disabled=false}: {label:string;action():void;disabled?:boolean}) {
  return <button type="button" className="page-format-button" title={label}
    disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={action}>{label}</button>;
}

function EditablePage({ manager,zoom }: {manager:PageDraft;zoom:number}) {
  const snapshot=useSyncExternalStore(manager.subscribe,manager.getSnapshot);
  const [overflow,setOverflow]=useState(false);
  const viewportRef=useRef<HTMLDivElement>(null);
  const editor=useEditor({
    extensions:[StarterKit.configure({link:false,heading:{levels:[1,2,3]},trailingNode:false})],
    content:snapshot.doc as unknown as TiptapContent,
    immediatelyRender:false,
    editorProps:{attributes:{'aria-label':'Page writing area',spellcheck:'true'}},
    onUpdate:({editor:instance})=>{manager.edit(instance.getJSON() as JsonDoc);}
  },[manager]);
  useEffect(()=>{
    if(!editor)return;
    if(JSON.stringify(editor.getJSON())!==JSON.stringify(snapshot.doc)) {
      editor.commands.setContent(snapshot.doc as unknown as TiptapContent,{emitUpdate:false});
    }
  },[editor,snapshot.doc]);

  useEffect(()=>{
    const viewport=viewportRef.current;
    if(!viewport)return;
    const check=()=>setOverflow(viewport.scrollHeight>viewport.clientHeight+3);
    check();
    const observer=new ResizeObserver(check);
    observer.observe(viewport);
    const content=viewport.querySelector('.tiptap');
    if(content)observer.observe(content);
    return ()=>observer.disconnect();
  },[editor,zoom,snapshot.doc]);

  function run(command:()=>void) {command();}
  const toolbar=editor && (
    <div className="page-format-toolbar" role="toolbar" aria-label="Text formatting">
      <Tool label="B" action={()=>run(()=>editor.chain().focus().toggleBold().run())}/>
      <Tool label="I" action={()=>run(()=>editor.chain().focus().toggleItalic().run())}/>
      <Tool label="U" action={()=>run(()=>editor.chain().focus().toggleUnderline().run())}/>
      <Tool label="S" action={()=>run(()=>editor.chain().focus().toggleStrike().run())}/>
      <Tool label="H1" action={()=>run(()=>editor.chain().focus().toggleHeading({level:1}).run())}/>
      <Tool label="H2" action={()=>run(()=>editor.chain().focus().toggleHeading({level:2}).run())}/>
      <Tool label="H3" action={()=>run(()=>editor.chain().focus().toggleHeading({level:3}).run())}/>
      <Tool label="• List" action={()=>run(()=>editor.chain().focus().toggleBulletList().run())}/>
      <Tool label="1. List" action={()=>run(()=>editor.chain().focus().toggleOrderedList().run())}/>
      <Tool label="Quote" action={()=>run(()=>editor.chain().focus().toggleBlockquote().run())}/>
      <Tool label="Code" action={()=>run(()=>editor.chain().focus().toggleCodeBlock().run())}/>
      <Tool label="—" action={()=>run(()=>editor.chain().focus().setHorizontalRule().run())}/>
      <Tool label="↶" disabled={!editor.can().undo()} action={()=>run(()=>editor.chain().focus().undo().run())}/>
      <Tool label="↷" disabled={!editor.can().redo()} action={()=>run(()=>editor.chain().focus().redo().run())}/>
    </div>
  );
  const classes='page-save-status save-'+snapshot.status;
  const target=document.getElementById('spatial-format-slot');
  return <>
    {toolbar && target ? createPortal(toolbar,target) : null}
    <div className="page-editor-viewport" ref={viewportRef} style={{fontSize:Math.max(9,15*zoom)}}>
      <EditorContent editor={editor} className="page-rich-content" />
    </div>
    <div className="page-editor-footer">
      <span className={classes} role="status" aria-live="polite">
        {snapshot.status==='saved'?'✓ Saved':snapshot.status==='saving'?'Saving…':
          snapshot.status==='conflict'?'⚠ Conflict — draft kept':
          snapshot.status==='offline'?'⚠ Save unavailable':
          snapshot.status==='loading'?'Loading…':'● Unsaved'}
      </span>
      {overflow && <span className="page-overflow-warning" role="status" title="Content remains saved but extends beyond the A4 writing area">
        A4 overflow — scroll to continue
      </span>}
    </div>
    {(snapshot.status==='offline'||snapshot.status==='conflict') && <div className="page-save-problem">
      <small>{snapshot.error}</small>
      <div className="page-recovery-actions">
        {snapshot.status==='offline' && <button type="button" onClick={()=>{void manager.save();}}>Retry save</button>}
        <button type="button" onClick={()=>{
          void navigator.clipboard.writeText(JSON.stringify(snapshot.doc,null,2)).catch(()=>{
            window.prompt('Copy your recovered document JSON:',JSON.stringify(snapshot.doc));
          });
        }}>Copy draft</button>
        {snapshot.status==='conflict' && <button type="button" onClick={()=>{
          if(window.confirm('Discard YOUR local draft and load the latest saved server version? This cannot be undone.')) {
            void manager.discardDraft();
          }
        }}>Discard draft & reload</button>}
      </div>
    </div>}
  </>;
}

/** Mounted on the selected page only. Draft persists across page switches and reloads. */
export function PageEditor({noteId,pageId,zoom}:Props) {
  const manager=getDraft(noteId,pageId);
  const snapshot=useSyncExternalStore(manager.subscribe,manager.getSnapshot);
  useEffect(()=>{
    void manager.load();
    return ()=>{void manager.save();};
  },[manager]);
  if(snapshot.status==='loading')return <div className="page-editor-loading">Loading saved writing…</div>;
  return <EditablePage manager={manager} zoom={zoom}/>;
}
