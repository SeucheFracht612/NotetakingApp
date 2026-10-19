import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { spatialNavigationShortcut } from './spatial-shortcuts';
import { PageEditor } from './PageEditor';
import { FreeformCard,useFreeformCanvas,hasUnsavedFreeform,type CanvasKind } from './FreeformCanvas';
import { flushDrafts, hasUnsavedDrafts, forgetDeletedPageDraft } from './document-autosave';

type Direction = 'N' | 'E' | 'S' | 'W';
const DIRECTIONS: Direction[] = ['N','E','S','W'];
const DELTA: Record<Direction, [number,number]> = { N:[0,-1],E:[1,0],S:[0,1],W:[-1,0] };
const OPPOSITE: Record<Direction,Direction> = { N:'S',E:'W',S:'N',W:'E' };
const NAME:Record<Direction,string>={N:'up',E:'right',S:'down',W:'left'};
const ARROW:Record<Direction,string>={N:'↑',E:'→',S:'↓',W:'←'};

interface Page { id:string; gx:number; gy:number; createdAt:number }
interface Edge { id:string; fromPageId:string; toPageId:string; direction:Direction }
interface Layout { noteId:string; version:number; pages:Page[]; edges:Edge[] }
interface Shift { id:string; fromGx:number;fromGy:number;gx:number;gy:number }
interface Plan { anchorPageId:string;direction:Direction;gx:number;gy:number;
  replacedEdgeId:string|null;previousNeighborId:string|null;shifts:Shift[];pushedIndependentGroups:number }
interface Preview { version:number;plan:Plan }

async function json<T>(url:string, method='GET', body?:unknown):Promise<T> {
  const response=await fetch(url,{
    method,credentials:'same-origin',cache:'no-store',
    headers:body===undefined?undefined:{'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  if(!response.ok) {
    const result=await response.json().catch(()=>({})) as {error?:string};
    throw new Error(result.error??'Request failed ('+response.status+')');
  }
  return response.json() as Promise<T>;
}
export function attachedNeighbor(pageId:string, direction:Direction, edges:Edge[]):string|null {
  for(const edge of edges){
    if(edge.fromPageId===pageId && edge.direction===direction) return edge.toPageId;
    if(edge.toPageId===pageId && OPPOSITE[edge.direction]===direction) return edge.fromPageId;
  }
  return null;
}
const emptyLayout=(id:string):Layout=>({noteId:id,version:0,pages:[],edges:[]});

export interface SpatialPagesProps {
  noteId:string;
  noteTitle:string;
  onBack():void;
  onToggleLibrary():void;
}
export function SpatialPages({noteId,noteTitle,onBack,onToggleLibrary}:SpatialPagesProps) {
  const [layout,setLayout]=useState<Layout>(()=>emptyLayout(noteId));
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [working,setWorking]=useState(false);
  const [error,setError]=useState('');
  const [zoom,setZoom]=useState(0.82);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [showPageActions,setShowPageActions]=useState(false);
  const [selectedItemId,setSelectedItemId]=useState<string|null>(null);
  const [showOverview,setShowOverview]=useState(false);
  const [pagePreviews,setPagePreviews]=useState<Record<string,string>>({});
  const freeform=useFreeformCanvas(noteId);
  const scrollRef=useRef<HTMLDivElement>(null);
  const shellRef=useRef<HTMLElement>(null);
  useEffect(()=>{shellRef.current?.focus({preventScroll:true});},[noteId]);
  useEffect(()=>{
    const warn=(event:BeforeUnloadEvent)=>{
      if(!hasUnsavedDrafts()&&!hasUnsavedFreeform())return;
      event.preventDefault(); event.returnValue='';
    };
    const flush=()=>flushDrafts();
    window.addEventListener('beforeunload',warn);
    window.addEventListener('pagehide',flush);
    return ()=>{window.removeEventListener('beforeunload',warn);window.removeEventListener('pagehide',flush);flush();};
  },[]);
  // Previews show the actual writing on non-selected pages, without mounting
  // a separate ProseMirror instance for every page on the canvas.
  useEffect(()=>{
    let alive=true;
    void fetch('/api/notes/'+noteId+'/page-previews',{credentials:'same-origin',cache:'no-store'})
      .then(async response=>{
        if(!response.ok)throw new Error('Preview request failed');
        return response.json() as Promise<{previews:Record<string,string>}>;
      }).then(result=>{if(alive)setPagePreviews(result.previews);})
      .catch(()=>{});
    return ()=>{alive=false;};
  },[noteId,layout.pages.length,selectedId]);
  const selectedPage=layout.pages.find(page=>page.id===selectedId)??layout.pages[0]??null;
  const displayOrder=useMemo(()=>[...layout.pages].sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id)),[layout.pages]);
  const pageNumbers=useMemo(()=>new Map(displayOrder.map((p,index)=>[p.id,index+1])),[displayOrder]);
  const byCoord=useMemo(()=>new Map(layout.pages.map(p=>[p.gx+':'+p.gy,p])),[layout.pages]);

  const refresh=useCallback(async():Promise<Layout>=>{
    const result=await json<Layout>('/api/notes/'+noteId+'/pages');
    setLayout(result);
    return result;
  },[noteId]);

  useEffect(()=>{
    let active=true;
    void json<Layout>('/api/notes/'+noteId+'/pages')
      .then(result=>{
        if(active) {
          setLayout(result);
          setSelectedId(current=>result.pages.some(p=>p.id===current)?current:result.pages[0]?.id??null);
        }
      })
      .catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Could not load note');})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[noteId]);

  const bounds=useMemo(()=>{
    if(!layout.pages.length)return {minX:0,maxX:0,minY:0,maxY:0};
    return {
      minX:Math.min(...layout.pages.map(p=>p.gx)),maxX:Math.max(...layout.pages.map(p=>p.gx)),
      minY:Math.min(...layout.pages.map(p=>p.gy)),maxY:Math.max(...layout.pages.map(p=>p.gy))
    };
  },[layout.pages]);

  // Documents occupy a stable A4 grid; cards have independent world coordinates.
  // Calculate view bounds from *both* so freeform items can be placed anywhere.
  const cellW=730*zoom,cellH=1000*zoom,pageW=650*zoom,pageH=920*zoom,pad=100*zoom;
  const minWorldX=Math.min(bounds.minX*730,...freeform.items.map(item=>item.x));
  const minWorldY=Math.min(bounds.minY*1000,...freeform.items.map(item=>item.y));
  const maxWorldX=Math.max(bounds.maxX*730+650,...freeform.items.map(item=>item.x+item.width));
  const maxWorldY=Math.max(bounds.maxY*1000+920,...freeform.items.map(item=>item.y+item.height));
  const canvasWidth=(maxWorldX-minWorldX)*zoom+pad*2;
  const canvasHeight=(maxWorldY-minWorldY)*zoom+pad*2;
  const position=(page:{gx:number;gy:number})=>({
    x:pad+(page.gx*730-minWorldX)*zoom,
    y:pad+(page.gy*1000-minWorldY)*zoom
  });
  const itemPosition=(item:{x:number;y:number})=>({
    x:pad+(item.x-minWorldX)*zoom,
    y:pad+(item.y-minWorldY)*zoom
  });

  const centerPage=useCallback((pageId:string,behavior:ScrollBehavior='smooth')=>{
    const viewport=scrollRef.current;
    const page=layout.pages.find(value=>value.id===pageId);
    if(!viewport||!page)return;
    const x=pad+(page.gx*730-minWorldX)*zoom;
    const y=pad+(page.gy*1000-minWorldY)*zoom;
    viewport.scrollTo({left:Math.max(0,x+pageW/2-viewport.clientWidth/2),
      top:Math.max(0,y+pageH/2-viewport.clientHeight/2),behavior});
  },[layout.pages,minWorldX,minWorldY,zoom,pageW,pageH,pad]);
  useEffect(()=>{
    if(selectedPage?.id)centerPage(selectedPage.id,'instant');
  },[centerPage,selectedPage?.id]);

  useEffect(()=>{
    if(!selectedItemId)return;
    const frame=requestAnimationFrame(()=>{
      const card=[...(scrollRef.current?.querySelectorAll<HTMLElement>('.freeform-position')??[])]
        .find(node=>node.dataset.canvasId===selectedItemId);
      card?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
    });
    return ()=>cancelAnimationFrame(frame);
  },[selectedItemId,freeform.items.length]);
  function selectPage(id:string){setSelectedItemId(null);setSelectedId(id);setPreview(null);}
  function navigate(side:Direction){
    if(!selectedPage)return;
    const to=attachedNeighbor(selectedPage.id,side,layout.edges);
    if(to)selectPage(to);
  }
  function keyboard(event:KeyboardEvent<HTMLDivElement>){
    // Capture AltGr+Arrow before ProseMirror processes keydown, including when
    // the caret is inside the editable page. Never intercept Ctrl+Arrow.
    if(preview || (event.target instanceof HTMLElement &&
      ['INPUT','SELECT'].includes(event.target.tagName))) return;
    const side=spatialNavigationShortcut(event);
    if(side) {
      event.preventDefault();
      event.stopPropagation();
      navigate(side);
    }
  }
  async function change(action:()=>Promise<Layout>,highlightNew=false):Promise<Layout|null>{
    if(working)return null;
    setWorking(true);setError('');
    try {
      const oldIds=new Set(layout.pages.map(page=>page.id));
      const result=await action();
      setLayout(result);
      if(highlightNew){
        const added=result.pages.find(page=>!oldIds.has(page.id));
        if(added)setSelectedId(added.id);
      }else{
        setSelectedId(current=>result.pages.some(page=>page.id===current)?current:result.pages[0]?.id??null);
      }
      setPreview(null);
      return result;
    } catch(cause) {
      setError(cause instanceof Error?cause.message:'Could not change page layout');
      try {await refresh();} catch { /* The initial error is more useful. */ }
      setPreview(null);
      return null;
    } finally {setWorking(false);}
  }
  const base='/api/notes/'+noteId+'/pages';
  async function firstPage(){
    await change(()=>json<Layout>(base+'/initialize','POST',{expectedVersion:layout.version}),true);
  }
  async function showPreview(side:Direction){
    if(!selectedPage||working)return;
    setError('');
    try{
      const result=await json<Preview>(base+'/preview','POST',{
        anchorId:selectedPage.id,direction:side,expectedVersion:layout.version
      });
      if(result.plan.shifts.length===0){
        await change(()=>json<Layout>(base+'/insert','POST',{
          anchorId:result.plan.anchorPageId,direction:result.plan.direction,expectedVersion:result.version
        }),true);
      }else{
        setPreview(result);
      }
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Cannot insert a page here');
      try{await refresh();}catch{/* The error is already shown. */}
    }
  }
  async function commitPreview(){
    if(!preview)return;
    await change(()=>json<Layout>(base+'/insert','POST',{
      anchorId:preview.plan.anchorPageId,direction:preview.plan.direction,
      expectedVersion:preview.version
    }),true);
  }
  async function linkAdjacent(side:Direction,otherId:string){
    if(!selectedPage)return;
    await change(()=>json<Layout>(base+'/link','POST',{
      fromPageId:selectedPage.id,toPageId:otherId,direction:side,expectedVersion:layout.version
    }));
  }
  async function unlink(side:Direction){
    if(!selectedPage)return;
    if(!window.confirm('Detach this page edge? The pages will stay in place, but arrow navigation will no longer cross it.'))return;
    await change(()=>json<Layout>(base+'/unlink','POST',{
      fromPageId:selectedPage.id,direction:side,expectedVersion:layout.version
    }));
  }
  async function deletePage(){
    if(!selectedPage)return;
    if(!window.confirm('Permanently delete this page AND ALL text written on it? This cannot be undone.'))return;
    const deletedId=selectedPage.id;
    const result=await change(()=>json<Layout>(base+'/'+deletedId,'DELETE',{expectedVersion:layout.version}));
    if(result)forgetDeletedPageDraft(noteId,deletedId);
  }

  async function addCard(kind:CanvasKind) {
    // Create near the current writing area, outside the page's right margin.
    const jitter=(freeform.items.length%5)*36;
    const x=(selectedPage?.gx??0)*730+675+jitter;
    const y=(selectedPage?.gy??0)*1000+90+jitter;
    try{
      const item=await freeform.create(kind,x,y);
      setSelectedItemId(item.id);
      setShowPageActions(false);
    }catch{/* The canvas error is shown next to the toolbar. */}
  }
  const pan=useRef<{x:number;y:number;left:number;top:number;id:number}|null>(null);
  function pointerDown(event:PointerEvent<HTMLDivElement>) {
    if(event.button!==0 && event.button!==1)return;
    const target=event.target as HTMLElement;
    if(event.button===0 && target.closest('.spatial-page,.freeform-card,.spatial-edge-action,button,textarea'))return;
    const viewport=scrollRef.current;
    if(!viewport)return;
    pan.current={x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop,id:event.pointerId};
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function pointerMove(event:PointerEvent<HTMLDivElement>) {
    const p=pan.current,viewport=scrollRef.current;
    if(!p||!viewport||p.id!==event.pointerId)return;
    viewport.scrollLeft=p.left+p.x-event.clientX;
    viewport.scrollTop=p.top+p.y-event.clientY;
  }
  function pointerUp(event:PointerEvent<HTMLDivElement>) {
    if(!pan.current||pan.current.id!==event.pointerId)return;
    const viewport=scrollRef.current;
    if(viewport?.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);
    pan.current=null;
  }

  const miniUnit=22,miniGap=4;
  const miniWidth=(bounds.maxX-bounds.minX+1)*(miniUnit+miniGap)+16;
  const miniHeight=(bounds.maxY-bounds.minY+1)*(miniUnit*1.414+miniGap)+16;
  const degree=selectedPage?layout.edges.filter(e=>e.fromPageId===selectedPage.id||e.toPageId===selectedPage.id).length:0;

  return (
    <section className="spatial-shell" ref={shellRef} onKeyDownCapture={keyboard}
      tabIndex={0} aria-label="Spatial note pages">
      <header className="spatial-topbar">
        <div className="spatial-heading">
          <button type="button" className="spatial-library-toggle" title="Toggle library" aria-label="Toggle library" onClick={onToggleLibrary}>☷</button>
          <button type="button" className="spatial-back" onClick={onBack}>← Notes</button>
          <div className="spatial-heading-title"><strong>{noteTitle}</strong>
            <small>{layout.pages.length} {layout.pages.length===1?'page':'pages'} · layout v{layout.version}</small></div>
        </div>
        <div className="spatial-toolbar">
          <div className="spatial-save-slot" id="spatial-save-slot" aria-live="polite"></div>
          <span className="spatial-label">Zoom</span>
          <button type="button" className="spatial-tool" aria-label="Zoom out" onClick={()=>setZoom(z=>Math.max(.38,Math.round((z-.1)*100)/100))}>−</button>
          <span className="spatial-zoom">{Math.round(zoom*100)}%</span>
          <button type="button" className="spatial-tool" aria-label="Zoom in" onClick={()=>setZoom(z=>Math.min(1.5,Math.round((z+.1)*100)/100))}>＋</button>
          <button type="button" className="spatial-tool text-tool" onClick={()=>setZoom(.82)}>Reset</button>
          {selectedPage && <button type="button" className="spatial-tool text-tool" onClick={()=>centerPage(selectedPage.id)}>Center page</button>}
        </div>
      </header>
      {error && <div className="spatial-error" role="alert">{error}
        <button type="button" onClick={()=>setError('')} aria-label="Dismiss error">×</button></div>}
      <div className="spatial-actionbar">
        <div className="spatial-format-slot" id="spatial-format-slot" aria-label="Document formatting"/>
        <div className="spatial-add-items" aria-label="Add objects">
          {!layout.pages.length && <button type="button" title="Add the first A4 document page" onClick={()=>{void firstPage();}}>＋ A4 page</button>}
          <button type="button" title="Add a movable sticky note" onClick={()=>{void addCard('sticky');}}>＋ Sticky</button>
          <button type="button" title="Add movable plain text" onClick={()=>{void addCard('text');}}>＋ Text</button>
          <button type="button" title="Add a movable quotation" onClick={()=>{void addCard('quote');}}>＋ Quote</button>
          <button type="button" className={showPageActions?'active':''} onClick={()=>setShowPageActions(v=>!v)}>Page actions</button>
          <button type="button" className={showOverview?'active':''} onClick={()=>setShowOverview(v=>!v)}>Overview</button>
        </div>
      </div>
      {freeform.error && <div role="alert" className="spatial-error">{freeform.error}
        <button type="button" onClick={freeform.clearError}>×</button></div>}
      <div className="spatial-body">
        <div className="spatial-canvas-viewport" ref={scrollRef}
          onPointerDown={pointerDown} onPointerMove={pointerMove}
          onPointerUp={pointerUp} onPointerCancel={pointerUp}>
          {loading || freeform.loading ? <p className="spatial-center-message">Loading canvas…</p> : !layout.pages.length && !freeform.items.length ? (
            <div className="spatial-first-page">
              <div className="spatial-page-empty-icon" aria-hidden="true">▤</div>
              <h2>This note has no pages yet.</h2>
              <p>Begin with an A4 page. You can attach more pages in any of the four directions.</p>
              <button type="button" disabled={working} className="primary-button"
                onClick={()=>{void firstPage();}}>Create first page</button>
            </div>
          ) : (
            <div className="spatial-grid" style={{width:canvasWidth,height:canvasHeight}}>
              <div className="spatial-grid-dots" style={{backgroundSize:cellW+'px '+cellH+'px'}} aria-hidden="true"/>
              <svg className="spatial-links" width={canvasWidth} height={canvasHeight} aria-hidden="true">
                {layout.edges.map(edge=>{
                  const a=layout.pages.find(page=>page.id===edge.fromPageId);
                  const b=layout.pages.find(page=>page.id===edge.toPageId);
                  if(!a||!b)return null;
                  const p1=position(a),p2=position(b),[dx,dy]=DELTA[edge.direction];
                  return <line key={edge.id}
                    x1={p1.x+pageW/2+dx*pageW/2} y1={p1.y+pageH/2+dy*pageH/2}
                    x2={p2.x+pageW/2-dx*pageW/2} y2={p2.y+pageH/2-dy*pageH/2}
                    stroke="currentColor" strokeWidth={Math.max(2,3*zoom)} strokeLinecap="round"/>;
                })}
              </svg>
              {displayOrder.map(page=>{
                const active=page.id===selectedPage?.id;
                const p=position(page);
                return (
                  <div key={page.id} role={active?'group':'button'}
                    tabIndex={active?-1:0}
                    onKeyDown={event=>{
                      if(!active&&(event.key==='Enter'||event.key===' ')) {
                        event.preventDefault();selectPage(page.id);
                      }
                    }}
                    className={'spatial-page'+(active?' is-selected':'')}
                    style={{left:p.x,top:p.y,width:pageW,height:pageH}}
                    onClick={()=>{if(!active)selectPage(page.id);}}
                    aria-label={'Page '+pageNumbers.get(page.id)+' at '+page.gx+', '+page.gy}>
                    <span className="spatial-page-top">
                      <span>PAGE {pageNumbers.get(page.id)}</span><span>A4</span>
                    </span>
                    <div className="spatial-page-sheet">
                      {active
                        ? <PageEditor noteId={noteId} pageId={page.id} zoom={zoom}/>
                        : <div className="page-inactive-preview">
                            {pagePreviews[page.id]
                              ? <div className="page-preview-writing">{pagePreviews[page.id]}</div>
                              : <span>Blank page · Select to write</span>}
                          </div>}
                    </div>
                    <span className="spatial-page-footer">{page.gx}, {page.gy}</span>
                  </div>
                );
              })}
              {freeform.items.map(item=>{
                const p=itemPosition(item);
                return <div key={item.id} className="freeform-position" data-canvas-id={item.id}
                  style={{left:p.x,top:p.y,width:item.width*zoom,height:item.height*zoom,
                    fontSize:Math.max(12,14*zoom)}}>
                  <FreeformCard noteId={noteId} item={item} zoom={zoom}
                    selected={selectedItemId===item.id} onSelect={setSelectedItemId}
                    onUpdate={freeform.update} onDelete={freeform.remove} onRefresh={freeform.refresh}/>
                </div>;
              })}
              {selectedPage&&DIRECTIONS.map(side=>{
                const link=attachedNeighbor(selectedPage.id,side,layout.edges);
                const near=byCoord.get((selectedPage.gx+DELTA[side][0])+':'+(selectedPage.gy+DELTA[side][1]));
                const center=position(selectedPage);
                const placement=side==='N'?{left:center.x+pageW/2-18,top:center.y-43}:
                  side==='S'?{left:center.x+pageW/2-18,top:center.y+pageH+8}:
                  side==='E'?{left:center.x+pageW+8,top:center.y+pageH/2-18}:
                  {left:center.x-43,top:center.y+pageH/2-18};
                return <button type="button" key={side} className="spatial-edge-action"
                  title={link?'Insert a page into this attachment':near?'Attach neighboring page':'Add an attached A4 page'}
                  style={placement}
                  onClick={()=>{
                    if(near&&!link){void linkAdjacent(side,near.id);}
                    else void showPreview(side);
                  }}>{near&&!link?'↔':'＋'}</button>;
              })}
            </div>
          )}
        </div>
        {showOverview && !!layout.pages.length && <div className="spatial-floating-overview">
          <p className="eyebrow">PAGE OVERVIEW</p>
          <div className="spatial-minimap-scroll"><div className="spatial-minimap"
            style={{width:miniWidth,height:miniHeight}}>
            {layout.pages.map(page=><button key={page.id} type="button"
              className={'spatial-mini-page'+(page.id===selectedPage?.id?' active':'')}
              aria-label={'Go to page '+pageNumbers.get(page.id)}
              style={{left:8+(page.gx-bounds.minX)*(miniUnit+miniGap),
                top:8+(page.gy-bounds.minY)*(miniUnit*1.414+miniGap),
                width:miniUnit,height:miniUnit*1.414}}
              onClick={()=>selectPage(page.id)}/>)}
          </div></div>
        </div>}
        {showPageActions && !loading && !!layout.pages.length &&
          <aside className="spatial-inspector" aria-label="Page controls">
            <div className="spatial-inspector-head">
              <span className="eyebrow">CURRENT PAGE</span>
              <h2>Page {selectedPage?pageNumbers.get(selectedPage.id):'—'}</h2>
              <p>Grid {selectedPage?.gx}, {selectedPage?.gy}</p>
            </div>
            <p className="spatial-help">Navigate only through solid attachment links. Nearby pages without a link are separate.</p>
            <div className="spatial-direction-list">
              {DIRECTIONS.map(side=>{
                const link=selectedPage?attachedNeighbor(selectedPage.id,side,layout.edges):null;
                const coord=selectedPage?[selectedPage.gx+DELTA[side][0],selectedPage.gy+DELTA[side][1]]:null;
                const nearby=coord?byCoord.get(coord[0]+':'+coord[1]):undefined;
                return <div className="spatial-direction" key={side}>
                  <div className="spatial-direction-head"><strong>{ARROW[side]} {NAME[side]}</strong>
                    <span>{link?'Attached':nearby?'Adjacent, not attached':'Open edge'}</span>
                  </div>
                  <div className="spatial-direction-actions">
                    {link && <button type="button" disabled={working}
                      onClick={()=>navigate(side)}>Go {ARROW[side]}</button>}
                    <button type="button" disabled={working}
                      onClick={()=>{void showPreview(side);}}>{link?'Insert':'Add'} page {ARROW[side]}</button>
                    {!link && nearby && <button type="button" disabled={working}
                      onClick={()=>{void linkAdjacent(side,nearby.id);}}>Attach existing</button>}
                    {link && <button type="button" className="spatial-subtle" disabled={working}
                      onClick={()=>{void unlink(side);}}>Detach</button>}
                  </div>
                </div>;
              })}
            </div>
            <div className="spatial-inspector-bottom">
              <button type="button" className="spatial-delete" disabled={working||degree>1}
                title={degree>1?'Detach or remove other connections first':'Delete this blank page'}
                onClick={()=>{void deletePage();}}>Delete {degree>1?'(not a leaf)':'page'}</button>
              <small><strong>Shortcut:</strong> AltGr + Arrow to follow attached pages, even while typing. Ctrl + Arrow remains for text navigation.</small>
            </div>
            <div className="spatial-minimap-wrap">
              <p className="eyebrow">OVERVIEW</p>
              <div className="spatial-minimap-scroll">
                <div className="spatial-minimap" style={{width:miniWidth,height:miniHeight}}>
                  {layout.pages.map(page=>(
                    <button type="button" key={page.id} className={'spatial-mini-page'+(page.id===selectedPage?.id?' active':'')}
                      title={'Page '+pageNumbers.get(page.id)} onClick={()=>selectPage(page.id)}
                      style={{left:8+(page.gx-bounds.minX)*(miniUnit+miniGap),
                        top:8+(page.gy-bounds.minY)*(miniUnit*1.414+miniGap),
                        width:miniUnit,height:miniUnit*1.414}}
                      aria-label={'Go to page '+pageNumbers.get(page.id)} />
                  ))}
                </div>
              </div>
            </div>
          </aside>}
      </div>
      {preview && <div className="spatial-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!working)setPreview(null);}}>
        <section role="dialog" aria-modal="true" aria-labelledby="spatial-preview-title" className="spatial-preview"
          onKeyDown={event=>{if(event.key==='Escape'&&!working)setPreview(null);}}>
          <p className="eyebrow">INSERTION PREVIEW</p>
          <h2 id="spatial-preview-title">
            {preview.plan.previousNeighborId?'Insert between pages':'Attach a new page'} {ARROW[preview.plan.direction]}
          </h2>
          <p>New A4 page at grid ({preview.plan.gx}, {preview.plan.gy}). Existing attachments will be preserved.</p>
          <div className="spatial-impact">
            <strong>{preview.plan.shifts.length}</strong><span>existing pages shift by one cell</span>
            <strong>{preview.plan.pushedIndependentGroups}</strong><span>independent attached groups pushed</span>
          </div>
          {preview.plan.shifts.length>0 &&
            <p className="spatial-impact-details">Moving pages: {preview.plan.shifts.map(s=>'#'+pageNumbers.get(s.id)).join(', ')}</p>}
          <div className="spatial-modal-actions">
            <button type="button" className="secondary-button" disabled={working} onClick={()=>setPreview(null)}>Cancel</button>
            <button type="button" className="primary-button" disabled={working} onClick={()=>{void commitPreview();}}>
              {working?'Applying…':'Confirm insertion'}
            </button>
          </div>
        </section>
      </div>}
    </section>
  );
}
