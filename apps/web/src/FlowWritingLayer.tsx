import { useEffect,useRef,useState,useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useEditor,EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
type PaginationExtension=typeof import('tiptap-pagination-plus')['PaginationPlus'];
import { getWritingFlowDraft, type JsonDoc } from './document-autosave';

type TiptapContent=NonNullable<Parameters<typeof useEditor>[0]['content']>;
export interface FlowPageData { id:string;gx:number;gy:number;createdAt:number }
export interface FlowLink { id:string;fromPageId:string;toPageId:string;direction:'N'|'E'|'S'|'W' }
export interface FlowLayout {noteId:string;version:number;pages:FlowPageData[];edges:FlowLink[]}
export interface ContinuationResult {
  layout:FlowLayout;
  flow:{rootPageId:string;pageIds:string[];revision:number};
}
interface Props {
  noteId:string;
  rootPageId:string;
  pageIds:string[];
  layoutVersion:number;
  zoom:number;
  x:number;y:number;
  onContinuation(result:ContinuationResult):void;
}
const A4_W=210*96/25.4;
const A4_H=297*96/25.4;
const GAP=1210-A4_H;
function Tool({label,onClick,disabled=false}:{label:string;onClick():void;disabled?:boolean}) {
  return <button type="button" className="page-format-button" disabled={disabled}
    onMouseDown={e=>e.preventDefault()} onClick={onClick}>{label}</button>;
}
function Surface({manager,PaginationPlus,rootPageId,noteId,pageIds,layoutVersion,zoom,x,y,onContinuation}:Props&{
  manager:ReturnType<typeof getWritingFlowDraft>;
  PaginationPlus:PaginationExtension;
}) {
  const snapshot=useSyncExternalStore(manager.subscribe,manager.getSnapshot);
  const [pageCount,setPageCount]=useState(1);
  const [error,setError]=useState('');
  const [appending,setAppending]=useState(false);
  const [pendingPreview,setPendingPreview]=useState<{key:string;shifts:number;groups:number}|null>(null);
  const [blockedKey,setBlockedKey]=useState<string|null>(null);
  const locked=useRef(false);
  const surface=useRef<HTMLDivElement>(null);
  const editor=useEditor({
    extensions:[
      StarterKit.configure({link:false,heading:{levels:[1,2,3]},trailingNode:false}),
      PaginationPlus.configure({
        pageWidth:A4_W,pageHeight:A4_H,pageGap:GAP,
        marginTop:95,marginBottom:95,marginLeft:93,marginRight:93,
        contentMarginTop:0,contentMarginBottom:0,
        footerRight:'',footerLeft:'',headerRight:'',headerLeft:'',
        pageBreakBackground:'transparent',pageGapBorderColor:'transparent',pageGapBorderSize:0
      })
    ],
    content:snapshot.doc as unknown as TiptapContent,
    immediatelyRender:false,
    editorProps:{attributes:{'aria-label':'Continuous A4 writing flow',spellcheck:'true'}},
    onUpdate:({editor:instance})=>manager.edit(instance.getJSON() as JsonDoc)
  },[manager]);
  useEffect(()=>{
    if(!editor)return;
    if(JSON.stringify(editor.getJSON())!==JSON.stringify(snapshot.doc)){
      editor.commands.setContent(snapshot.doc as unknown as TiptapContent,{emitUpdate:false});
    }
  },[editor,snapshot.doc]);
  useEffect(()=>{
    const host=surface.current;
    if(!host)return;
    let frame=0;
    const measure=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        const pagination=host.querySelector('[data-rm-pagination]');
        const count=Math.max(1,pagination?.children.length??1);
        setPageCount(old=>old===count?old:count);
      });
    };
    const observer=new MutationObserver(measure);
    observer.observe(host,{subtree:true,childList:true});
    measure();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();};
  },[editor]);

  // Saved text and physical page placement are independent transactions.
  // Never silently push a neighboring branch while the user is typing.
  async function appendContinuation(expectedVersion:number,expectedRevision:number) {
    if(locked.current)return;
    locked.current=true;setAppending(true);setError('');setPendingPreview(null);
    try{
      const response=await fetch('/api/notes/'+noteId+'/pages/'+rootPageId+'/continue',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({expectedLayoutVersion:expectedVersion,expectedFlowRevision:expectedRevision})
      });
      if(!response.ok){
        const data=await response.json().catch(()=>({})) as {error?:string};
        throw new Error(data.error??'Could not attach continuation');
      }
      onContinuation(await response.json() as ContinuationResult);
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Could not add continuation');
      setBlockedKey(String(expectedVersion)+':'+expectedRevision+':'+pageIds.length+':'+pageCount);
    }finally{locked.current=false;setAppending(false);}
  }
  useEffect(()=>{
    setBlockedKey(null);setPendingPreview(null);
  },[layoutVersion,snapshot.revision,pageIds.length]);
  useEffect(()=>{
    if(!editor||snapshot.status!=='saved'||pageCount<=pageIds.length||locked.current||pendingPreview)return;
    const key=String(layoutVersion)+':'+snapshot.revision+':'+pageIds.length+':'+pageCount;
    if(key===blockedKey)return;
    let active=true;
    let forwarded=false;
    locked.current=true;
    const tail=pageIds[pageIds.length-1];
    const endpoint='/api/notes/'+noteId+'/pages/preview';
    void fetch(endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({anchorId:tail,direction:'S',expectedVersion:layoutVersion})
    }).then(async response=>{
      if(!response.ok){
        const data=await response.json().catch(()=>({})) as {error?:string};
        throw new Error(data.error??'The layout cannot be extended');
      }
      return response.json() as Promise<{
        version:number;plan:{shifts:unknown[];pushedIndependentGroups:number}
      }>;
    }).then(result=>{
      if(!active)return;
      if(result.plan.shifts.length){
        setBlockedKey(key);
        setPendingPreview({key,shifts:result.plan.shifts.length,
          groups:result.plan.pushedIndependentGroups});
      }else{
        // Release the preview lock before starting the atomic append.
        locked.current=false;
        forwarded=true;
        void appendContinuation(layoutVersion,snapshot.revision);
      }
    }).catch(cause=>{
      if(active){
        setError(cause instanceof Error?cause.message:'Cannot create continuation');
        setBlockedKey(key);
      }
    }).finally(()=>{if(!forwarded)locked.current=false;});
    return()=>{active=false;};
  },[editor,snapshot.status,snapshot.revision,pageCount,pageIds.length,layoutVersion,
    noteId,rootPageId,pendingPreview,blockedKey,onContinuation]);


  const toolbar=editor&&<div className="page-format-toolbar" role="toolbar" aria-label="Writing tools">
    <Tool label="B" onClick={()=>editor.chain().focus().toggleBold().run()}/>
    <Tool label="I" onClick={()=>editor.chain().focus().toggleItalic().run()}/>
    <Tool label="U" onClick={()=>editor.chain().focus().toggleUnderline().run()}/>
    <Tool label="S" onClick={()=>editor.chain().focus().toggleStrike().run()}/>
    <Tool label="H1" onClick={()=>editor.chain().focus().toggleHeading({level:1}).run()}/>
    <Tool label="H2" onClick={()=>editor.chain().focus().toggleHeading({level:2}).run()}/>
    <Tool label="H3" onClick={()=>editor.chain().focus().toggleHeading({level:3}).run()}/>
    <Tool label="• List" onClick={()=>editor.chain().focus().toggleBulletList().run()}/>
    <Tool label="1. List" onClick={()=>editor.chain().focus().toggleOrderedList().run()}/>
    <Tool label="Quote" onClick={()=>editor.chain().focus().toggleBlockquote().run()}/>
    <Tool label="Code" onClick={()=>editor.chain().focus().toggleCodeBlock().run()}/>
    <Tool label="↶" onClick={()=>editor.chain().focus().undo().run()} disabled={!editor.can().undo()}/>
    <Tool label="↷" onClick={()=>editor.chain().focus().redo().run()} disabled={!editor.can().redo()}/>
  </div>;
  const toolTarget=document.getElementById('spatial-format-slot');
  const statusTarget=document.getElementById('spatial-save-slot');
  const label=snapshot.status==='saved'?'✓ Document saved':
    snapshot.status==='saving'?'Saving…':
    snapshot.status==='unsaved'?'Unsaved':snapshot.status==='offline'?'Save unavailable':
    snapshot.status==='conflict'?'Conflict — draft retained':'Loading…';

  return <>
    {toolTarget&&toolbar?createPortal(toolbar,toolTarget):null}
    {statusTarget?createPortal(<span className={'page-save-status save-'+snapshot.status}>{label}</span>,statusTarget):null}
    <div className="flow-writing-layer" ref={surface} data-root-page-id={rootPageId}
      style={{left:x,top:y,width:A4_W,transform:'scale('+zoom+')',transformOrigin:'top left'}}>
      <EditorContent editor={editor} className="flow-editor-content"/>
    </div>
    {(error||snapshot.status==='conflict'||snapshot.status==='offline')&&
      <div className="flow-writing-error" role="alert">
        <strong>{error||snapshot.error||'Writing has not been saved'}</strong>
        <span>Text remains in the editor and the local recovery draft.</span>
        <button type="button" onClick={()=>{
          void navigator.clipboard.writeText(JSON.stringify(snapshot.doc,null,2)).catch(()=>{});
        }}>Copy document</button>
        {snapshot.status==='offline'&&<button type="button" onClick={()=>{void manager.save();}}>Retry save</button>}
        {snapshot.status==='conflict'&&<button type="button" onClick={()=>{
          if(window.confirm('Discard unsaved local changes and load the newest server document?')){
            void manager.discardDraft();
          }
        }}>Discard & reload</button>}
      </div>}
    {pendingPreview&&<div className="spatial-modal-backdrop">
      <section role="dialog" aria-modal="true" aria-label="Continue writing"
        className="spatial-preview">
        <p className="eyebrow">CONTINUE WRITING</p>
        <h2>Make room for the next A4 page?</h2>
        <p>Continuing downward would move {pendingPreview.shifts} existing
          page{pendingPreview.shifts===1?'':'s'} and {pendingPreview.groups}
          independent attached group{pendingPreview.groups===1?'':'s'}.
          Your writing is saved; nothing has moved yet.</p>
        <div className="spatial-modal-actions">
          <button type="button" className="secondary-button" onClick={()=>{
            setBlockedKey(pendingPreview.key);setPendingPreview(null);
          }}>Not now</button>
          <button type="button" className="primary-button"
            onClick={()=>{void appendContinuation(layoutVersion,snapshot.revision);}}>
            Move pages and continue
          </button>
        </div>
      </section>
    </div>}
    {error&&<button className="flow-retry" type="button" onClick={()=>{
      setError('');setBlockedKey(null);
    }}>Retry continuation</button>}
    {appending&&<div className="flow-continuation-working" aria-live="polite">Adding continuation page…</div>}
  </>;
}
export function FlowWritingLayer(props:Props){
  const manager=getWritingFlowDraft(props.noteId,props.rootPageId);
  const snapshot=useSyncExternalStore(manager.subscribe,manager.getSnapshot);
  const [Pagination,setPagination]=useState<PaginationExtension|null>(null);
  const [loadError,setLoadError]=useState('');
  useEffect(()=>{
    let active=true;
    void import('tiptap-pagination-plus').then(module=>{
      if(active)setPagination(module.PaginationPlus);
    }).catch(cause=>{
      if(active)setLoadError(cause instanceof Error?cause.message:'Could not load pagination');
    });
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    void manager.load();
    return()=>{void manager.save();};
  },[manager]);
  if(loadError)return <div role="alert" className="flow-writing-error">Pagination unavailable: {loadError}</div>;
  if(snapshot.status==='loading'||!Pagination)return null;
  return <Surface manager={manager} PaginationPlus={Pagination} {...props}/>;
}
