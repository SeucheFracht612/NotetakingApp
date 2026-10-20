import { useCallback,useEffect,useRef,useState, type PointerEvent } from 'react';

export type CanvasKind='sticky'|'text'|'quote';
export interface CanvasItem {
  id:string;kind:CanvasKind;x:number;y:number;width:number;height:number;
  content:string;source:string;locator:string;revision:number;createdAt:number;updatedAt:number;
}
interface CanvasState {noteId:string;version:number;items:CanvasItem[]}
interface ChangeResult {item:CanvasItem;version:number}
type Changes=Partial<Pick<CanvasItem,'x'|'y'|'width'|'height'|'content'|'source'|'locator'>>;
const failures=new Set<string>();
export function hasUnsavedFreeform():boolean{return failures.size>0;}

async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{
  const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',
    headers:body===undefined?undefined:{'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok){
    const detail=await response.json().catch(()=>({})) as {error?:string};
    const error=new Error(detail.error??'Canvas request failed ('+response.status+')') as Error&{status:number};
    error.status=response.status;throw error;
  }
  return response.json() as Promise<T>;
}

export function useFreeformCanvas(noteId:string){
  const [state,setState]=useState<CanvasState>({noteId,version:0,items:[]});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const current=useRef(state),queues=useRef(new Map<string,Promise<unknown>>());
  const assign=(next:CanvasState)=>{
    current.current=next;setState(next);
  };
  const url='/api/notes/'+noteId+'/canvas';
  const refresh=useCallback(async()=>{
    const next=await api<CanvasState>(url);
    current.current=next;setState(next);
    return next;
  },[url]);
  useEffect(()=>{
    let live=true;
    void api<CanvasState>(url).then(result=>{if(live){current.current=result;setState(result);}})
      .catch(cause=>{if(live)setError(cause instanceof Error?cause.message:'Cannot load canvas');})
      .finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[url]);
  async function create(kind:CanvasKind,x:number,y:number) {
    const dimensions=kind==='quote'?{width:330,height:205}:
      kind==='sticky'?{width:260,height:210}:{width:320,height:190};
    try{
      const result=await api<ChangeResult>(url+'/items','POST',{
        kind,x:Math.round(x),y:Math.round(y),...dimensions,expectedVersion:current.current.version
      });
      assign({...current.current,version:result.version,items:[...current.current.items,result.item]});
      setError('');
      return result.item;
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Could not create item');
      throw cause;
    }
  }
  // Serialize requests for one item so move/resize and text autosaves never
  // race with each other and submit an obsolete per-item revision.
  function update(id:string,change:Changes):Promise<ChangeResult>{
    const earlier=queues.current.get(id)??Promise.resolve();
    const next=earlier.catch(()=>{}).then(async()=>{
      const original=current.current.items.find(entry=>entry.id===id);
      if(!original)throw new Error('Item no longer exists');
      const result=await api<ChangeResult>(url+'/items/'+id,'PATCH',{
        ...change,expectedRevision:original.revision
      });
      assign({...current.current,version:result.version,
        items:current.current.items.map(entry=>entry.id===id?result.item:entry)});
      setError('');
      return result;
    }).catch(cause=>{
      setError(cause instanceof Error?cause.message:'Could not save this canvas item');
      throw cause;
    });
    queues.current.set(id,next);
    void next.finally(()=>{if(queues.current.get(id)===next)queues.current.delete(id);}).catch(()=>{});
    return next;
  }
  async function remove(id:string) {
    try{
      await queues.current.get(id)?.catch(()=>{});
      const item=current.current.items.find(entry=>entry.id===id);
      if(!item)return;
      const result=await api<{version:number}>(url+'/items/'+id,'DELETE',{expectedRevision:item.revision});
      assign({...current.current,version:result.version,items:current.current.items.filter(entry=>entry.id!==id)});
      failures.delete(id);
      try{sessionStorage.removeItem('freeform:'+noteId+':'+id);}catch{/* blocked */}
      setError('');
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Could not delete item');
      throw cause;
    }
  }
  return {items:state.items,loading,error,clearError:()=>setError(''),create,update,remove,refresh};
}
type CardProps={
  noteId:string;item:CanvasItem;zoom:number;selected:boolean;
  onSelect(id:string):void;onUpdate(id:string,change:Changes):Promise<ChangeResult>;
  onDelete(id:string):Promise<void>;
  onRefresh():Promise<CanvasState>;
};
interface CachedCard { content:string;source:string;locator:string;revision:number }
function readDraft(key:string):CachedCard|null {
  try {
    const input=sessionStorage.getItem(key);
    if(!input)return null;
    const parsed=JSON.parse(input) as {content:unknown;source?:unknown;locator?:unknown;revision:unknown};
    if(typeof parsed.content==='string'&&typeof parsed.revision==='number')return {
      content:parsed.content,source:typeof parsed.source==='string'?parsed.source:'',
      locator:typeof parsed.locator==='string'?parsed.locator:'',revision:parsed.revision
    };
  }catch{/* session storage disabled */}
  return null;
}
function putDraft(key:string,revision:number,content:string,source:string,locator:string) {
  try{sessionStorage.setItem(key,JSON.stringify({revision,content,source,locator}));}catch{/* in-memory local state remains */}
}
function eraseDraft(key:string){try{sessionStorage.removeItem(key);}catch{/* blocked */}}
export function FreeformCard({noteId,item,zoom,selected,onSelect,onUpdate,onDelete,onRefresh}:CardProps){
  const cacheKey='freeform:'+noteId+':'+item.id;
  const [initial]=useState(()=>readDraft(cacheKey));
  const [content,setContent]=useState(initial?.content??item.content);
  const [source,setSource]=useState(initial?.source??item.source);
  const [locator,setLocator]=useState(initial?.locator??item.locator);
  const changedSinceServer=Boolean(initial &&
    (initial.content!==item.content || initial.source!==item.source || initial.locator!==item.locator));
  const [status,setStatus]=useState<'saved'|'unsaved'|'saving'|'error'|'conflict'>(()=>
    changedSinceServer ? initial?.revision!==item.revision?'conflict':'unsaved':'saved');
  const [message,setMessage]=useState('');
  const latest=useRef(content),latestSource=useRef(source),latestLocator=useRef(locator);
  const statusRef=useRef(status),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const revisionRef=useRef(item.revision);
  const running=useRef<Promise<void>|null>(null);
  useEffect(()=>{revisionRef.current=item.revision;},[item.revision]);
  useEffect(()=>{statusRef.current=status;if(status==='saved')failures.delete(item.id);else failures.add(item.id);},[status,item.id]);

  async function save(){
    if(timer.current){clearTimeout(timer.current);timer.current=null;}
    if(running.current) return running.current;
    if(!['unsaved','error'].includes(statusRef.current))return;
    const sent=latest.current,sentSource=latestSource.current,sentLocator=latestLocator.current;
    setStatus('saving');statusRef.current='saving';
    const pending=onUpdate(item.id,{content:sent,source:sentSource,locator:sentLocator}).then(result=>{
      revisionRef.current=result.item.revision;
      if(latest.current===sent&&latestSource.current===sentSource&&latestLocator.current===sentLocator){
        eraseDraft(cacheKey);setStatus('saved');statusRef.current='saved';
      }
      else {
        putDraft(cacheKey,result.item.revision,latest.current,latestSource.current,latestLocator.current);
        setStatus('unsaved');statusRef.current='unsaved';
      }
      setMessage('');
    }).catch(cause=>{
      const problem=cause as Error & {status?:number};
      setStatus(problem.status===409?'conflict':'error');
      statusRef.current=problem.status===409?'conflict':'error';
      setMessage(problem.message);
    }).finally(()=>{
      running.current=null;
      if(statusRef.current==='unsaved')schedule();
    });
    running.current=pending;
    return pending;
  }
  function schedule(){
    if(timer.current)clearTimeout(timer.current);
    timer.current=setTimeout(()=>{void save();},950);
  }
  useEffect(()=>{
    if(changedSinceServer && initial?.revision===item.revision)schedule();
    return ()=>{
      if(timer.current)clearTimeout(timer.current);
      if(['unsaved','error'].includes(statusRef.current))void save();
      failures.delete(item.id);
    };
    // Only bind the lifetime of this card; never overwrite its local draft
    // when a parent state refresh arrives during editing.
  },[item.id]);
  function edit(text:string){
    if(text.length>6000)return;
    latest.current=text;setContent(text);
    putDraft(cacheKey,revisionRef.current,text,latestSource.current,latestLocator.current);
    if(statusRef.current!=='conflict'){statusRef.current='unsaved';setStatus('unsaved');schedule();}
  }
  function editReference(kind:'source'|'locator',text:string){
    if(kind==='source'){
      if(text.length>350)return;
      latestSource.current=text;setSource(text);
    }else{
      if(text.length>80)return;
      latestLocator.current=text;setLocator(text);
    }
    putDraft(cacheKey,revisionRef.current,latest.current,latestSource.current,latestLocator.current);
    if(statusRef.current!=='conflict'){statusRef.current='unsaved';setStatus('unsaved');schedule();}
  }
  function drag(event:PointerEvent<HTMLButtonElement>){
    if(event.button!==0)return;
    event.preventDefault();event.stopPropagation();onSelect(item.id);
    const handle=event.currentTarget;
    const card=handle.closest('.freeform-position') as HTMLElement|null;
    if(!card)return;
    const x=event.clientX,y=event.clientY;
    const startX=item.x,startY=item.y;
    const initialLeft=parseFloat(card.style.left),initialTop=parseFloat(card.style.top);
    handle.setPointerCapture(event.pointerId);
    let moved=false;
    const move=(current:globalThis.PointerEvent)=>{
      const dx=(current.clientX-x)/zoom,dy=(current.clientY-y)/zoom;
      if(Math.abs(dx)+Math.abs(dy)>2)moved=true;
      card.style.left=initialLeft+dx*zoom+'px';
      card.style.top=initialTop+dy*zoom+'px';
    };
    const finish=(current:globalThis.PointerEvent)=>{
      handle.removeEventListener('pointermove',move);
      handle.removeEventListener('pointerup',finish);
      handle.removeEventListener('pointercancel',cancel);
      if(handle.hasPointerCapture(current.pointerId))handle.releasePointerCapture(current.pointerId);
      if(moved){
        void onUpdate(item.id,{
          x:Math.max(-200000,Math.min(200000,Math.round(startX+(current.clientX-x)/zoom))),
          y:Math.max(-200000,Math.min(200000,Math.round(startY+(current.clientY-y)/zoom)))
        }).catch(()=>{card.style.left=initialLeft+'px';card.style.top=initialTop+'px';});
      }
    };
    const cancel=()=>{
      handle.removeEventListener('pointermove',move);
      handle.removeEventListener('pointerup',finish);
      handle.removeEventListener('pointercancel',cancel);
      card.style.left=initialLeft+'px';card.style.top=initialTop+'px';
    };
    handle.addEventListener('pointermove',move);
    handle.addEventListener('pointerup',finish);
    handle.addEventListener('pointercancel',cancel);
  }
  function resize(event:PointerEvent<HTMLButtonElement>){
    if(event.button!==0)return;
    event.preventDefault();event.stopPropagation();onSelect(item.id);
    const handle=event.currentTarget;
    const card=handle.closest('.freeform-position') as HTMLElement|null;
    if(!card)return;
    const startX=event.clientX,startY=event.clientY;
    handle.setPointerCapture(event.pointerId);
    const move=(e:globalThis.PointerEvent)=>{
      card.style.width=Math.min(900,Math.max(120,item.width+(e.clientX-startX)/zoom))*zoom+'px';
      card.style.height=Math.min(800,Math.max(90,item.height+(e.clientY-startY)/zoom))*zoom+'px';
    };
    const finish=(e:globalThis.PointerEvent)=>{
      handle.removeEventListener('pointermove',move);
      handle.removeEventListener('pointerup',finish);
      if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);
      const width=Math.round(Math.min(900,Math.max(120,item.width+(e.clientX-startX)/zoom)));
      const height=Math.round(Math.min(800,Math.max(90,item.height+(e.clientY-startY)/zoom)));
      void onUpdate(item.id,{width,height}).catch(()=>{
        card.style.width=item.width*zoom+'px';card.style.height=item.height*zoom+'px';
      });
    };
    handle.addEventListener('pointermove',move);
    handle.addEventListener('pointerup',finish);
  }
  async function discard(){
    if(!window.confirm('Discard your unsaved local text and load the latest confirmed server version?'))return;
    try{
      const result=await onRefresh();
      const current=result.items.find(entry=>entry.id===item.id);
      if(!current)throw new Error('This card was deleted in another tab');
      eraseDraft(cacheKey);
      latest.current=current.content;setContent(current.content);
      latestSource.current=current.source;setSource(current.source);
      latestLocator.current=current.locator;setLocator(current.locator);
      revisionRef.current=current.revision;
      statusRef.current='saved';setStatus('saved');setMessage('');
    }catch(cause){
      setMessage(cause instanceof Error?cause.message:'Cannot reload card');
    }
  }
  return <section className={'freeform-card freeform-'+item.kind+(selected?' selected':'')}
    data-item-id={item.id} aria-label={item.kind+' canvas card'} onPointerDown={()=>onSelect(item.id)}>
    <div className="freeform-card-top">
      <button type="button" className="freeform-grab" onPointerDown={drag}
        title="Drag to move" aria-label={'Move '+item.kind+' card'}>
        <span aria-hidden="true">⠿</span> {item.kind==='sticky'?'Sticky note':item.kind==='quote'?'Quotation':'Text card'}
      </button>
      <button type="button" className="freeform-dismiss" aria-label="Delete card"
        onClick={()=>{
          if(!window.confirm('Delete this card and all its text?'))return;
          // Deletion is intentional: cancel pending debounced writes so that
          // unmount cannot resurrect a newly deleted object via autosave.
          if(timer.current){clearTimeout(timer.current);timer.current=null;}
          statusRef.current='saved';
          void onDelete(item.id).catch(cause=>{
            putDraft(cacheKey,revisionRef.current,latest.current,latestSource.current,latestLocator.current);
            statusRef.current='error';setStatus('error');
            setMessage(cause instanceof Error?cause.message:'Could not delete the card');
          });
        }}>×</button>
    </div>
    {item.kind==='quote' && <span className="quote-glyph" aria-hidden="true">“</span>}
    <textarea className="freeform-text" value={content} placeholder={
      item.kind==='quote'?'Paste or write a quotation…':item.kind==='sticky'?'Quick thought…':'Write anything…'}
      spellCheck aria-label={item.kind+' text'} maxLength={6000}
      onChange={e=>edit(e.target.value)} onBlur={()=>{void save();}}/>
    {item.kind==='quote' && <div className="freeform-citation">
      <input aria-label="Quotation source" placeholder="Author, title or source"
        value={source} maxLength={350} onChange={e=>editReference('source',e.target.value)}
        onBlur={()=>{void save();}}/>
      <input aria-label="Page number or reference" placeholder="Page / locator"
        value={locator} maxLength={80} onChange={e=>editReference('locator',e.target.value)}
        onBlur={()=>{void save();}}/>
    </div>}
    <div className="freeform-bottom">
      <small className={status==='conflict'||status==='error'?'freeform-problem':''}>
        {status==='saved'?'✓ Saved':status==='saving'?'Saving…':status==='unsaved'?'Unsaved':status==='conflict'?'Conflict — text kept':'Not saved'}
      </small>
      <span>{content.length}/6000</span>
    </div>
    {(status==='error'||status==='conflict')&&<div className="freeform-recovery" role="alert">
      <small>{message||'Your local text is kept.'}</small>
      <button onClick={()=>{void navigator.clipboard.writeText(content).catch(()=>window.prompt('Copy text',content));}}>Copy text</button>
      {status==='error'?<button onClick={()=>{void save();}}>Retry</button>:
        <button onClick={()=>{void discard();}}>Discard local & reload</button>}
    </div>}
    <button type="button" className="freeform-resize" aria-label="Resize card" title="Drag to resize"
      onPointerDown={resize}>◢</button>
  </section>;
}
