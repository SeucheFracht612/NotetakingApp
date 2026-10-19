/** Per-page autosave with optimistic revisions and session-scoped recovery drafts. */
export interface JsonDoc { type: 'doc'; content?: unknown[] }
export interface ServerDocument { noteId: string; pageId: string; revision: number; doc: JsonDoc; updatedAt: number | null }
export type SaveStatus = 'loading' | 'saved' | 'unsaved' | 'saving' | 'offline' | 'conflict';
export interface DraftSnapshot {
  doc: JsonDoc;
  revision: number;
  status: SaveStatus;
  error: string;
}
type Transport = (method: 'GET' | 'PUT', url: string, payload?: unknown) => Promise<ServerDocument>;
const emptyDoc: JsonDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
const memCache = new Map<string, string>();
const drafts = new Map<string, PageDraft>();
const same = (a: JsonDoc,b: JsonDoc) => JSON.stringify(a) === JSON.stringify(b);

export async function documentRequest(method: 'GET' | 'PUT', url: string, payload?: unknown): Promise<ServerDocument> {
  const result = await fetch(url, {
    method, credentials:'same-origin',cache:'no-store',
    headers: method === 'PUT' ? { 'Content-Type':'application/json' } : undefined,
    body: method === 'PUT' ? JSON.stringify(payload) : undefined
  });
  if (!result.ok) {
    const response = await result.json().catch(() => ({})) as {error?:string};
    const error = new Error(response.error ?? 'Document request failed ('+result.status+')');
    (error as Error & {status:number}).status=result.status;
    throw error;
  }
  return result.json() as Promise<ServerDocument>;
}

function readCache(key: string): {revision:number;doc:JsonDoc}|null {
  let raw:string|null;
  try { raw=sessionStorage.getItem(key)??memCache.get(key)??null; } catch { raw=memCache.get(key)??null; }
  if (!raw) return null;
  try {
    const parsed=JSON.parse(raw) as {revision:number;doc:JsonDoc};
    if (Number.isSafeInteger(parsed.revision) && parsed.revision>=0 &&
      parsed.doc?.type==='doc' && Array.isArray(parsed.doc.content)) return parsed;
  } catch { /* A corrupt cache is not trusted or uploaded. */ }
  return null;
}
function cache(key:string, revision:number, doc:JsonDoc) {
  const raw=JSON.stringify({revision,doc});
  memCache.set(key,raw);
  try {sessionStorage.setItem(key,raw);} catch { /* Memory fallback survives page changes. */ }
}
function clearCache(key:string) {
  memCache.delete(key);
  try {sessionStorage.removeItem(key);} catch { /* Storage may be unavailable. */ }
}
export class PageDraft {
  private snapshot:DraftSnapshot={doc:emptyDoc,revision:0,status:'loading',error:''};
  private listeners=new Set<()=>void>();
  private loadPromise:Promise<void>|null=null;
  private saving:Promise<void>|null=null;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private readonly url:string;
  private readonly key:string;
  constructor(noteId:string,pageId:string,private readonly transport:Transport=documentRequest,
    private readonly debounce=1000) {
    this.url='/api/notes/'+noteId+'/pages/'+pageId+'/document';
    this.key='notetaking:draft:'+noteId+':'+pageId;
  }
  getSnapshot=()=>this.snapshot;
  subscribe=(notify:()=>void)=>{this.listeners.add(notify);return ()=>{this.listeners.delete(notify);};};
  private set(fields:Partial<DraftSnapshot>) {
    this.snapshot={...this.snapshot,...fields};
    for(const fn of this.listeners)fn();
  }
  get hasPending() {return ['unsaved','saving','offline','conflict'].includes(this.snapshot.status);}
  async load():Promise<void> {
    if(this.loadPromise) return this.loadPromise;
    this.loadPromise=(async()=>{
      try{
        const remote=await this.transport('GET',this.url);
        const local=readCache(this.key);
        if(local && !same(local.doc,remote.doc)) {
          const conflict=local.revision!==remote.revision;
          this.set({doc:local.doc,revision:local.revision,
            status:conflict?'conflict':'unsaved',
            error:conflict?'Server content changed; your recovered draft was kept.':''});
          if(!conflict)this.schedule();
        } else {
          clearCache(this.key);
          this.set({doc:remote.doc,revision:remote.revision,status:'saved',error:''});
        }
      } catch(cause) {
        const local=readCache(this.key);
        if(local) this.set({doc:local.doc,revision:local.revision,status:'offline',
          error:cause instanceof Error?cause.message:'Unable to reach server'});
        else this.set({status:'offline',error:cause instanceof Error?cause.message:'Unable to load document'});
      }
    })();
    return this.loadPromise;
  }
  edit(doc:JsonDoc) {
    const changed=!same(this.snapshot.doc,doc);
    if(!changed)return;
    cache(this.key,this.snapshot.revision,doc);
    if(this.snapshot.status==='conflict') {
      this.set({doc});
      return;
    }
    this.set({doc,status:'unsaved',error:''});
    this.schedule();
  }
  private schedule() {
    if(this.timer)clearTimeout(this.timer);
    this.timer=setTimeout(()=>{void this.save();},this.debounce);
  }
  async save():Promise<void> {
    if(this.timer){clearTimeout(this.timer);this.timer=null;}
    if(this.saving) return this.saving;
    if(!['unsaved','offline'].includes(this.snapshot.status))return;
    const sent=this.snapshot.doc, expected=this.snapshot.revision;
    this.set({status:'saving',error:''});
    this.saving=(async()=>{
      try {
        const result=await this.transport('PUT',this.url,{expectedRevision:expected,doc:sent});
        const changedSince= !same(sent,this.snapshot.doc);
        if(changedSince){
          cache(this.key,result.revision,this.snapshot.doc);
          this.set({revision:result.revision,status:'unsaved',error:''});
        } else {
          clearCache(this.key);
          this.set({revision:result.revision,status:'saved',error:''});
        }
      } catch(cause) {
        const error=cause as Error & {status?:number};
        this.set({status:error.status===409?'conflict':'offline',
          error:error.message || 'Save failed. The draft is kept locally.'});
      }
    })().finally(()=>{
      this.saving=null;
      if(this.snapshot.status==='unsaved')this.schedule();
    });
    return this.saving;
  }
  /** Called only after confirmed page deletion. No draft should survive a deleted page. */
  forget() {
    if(this.timer){clearTimeout(this.timer);this.timer=null;}
    clearCache(this.key);
    this.set({status:'saved',error:''});
  }
  /** Explicit user action: throw away the recovered draft after confirmation. */
  async discardDraft():Promise<void>{
    if(this.timer){clearTimeout(this.timer);this.timer=null;}
    if(this.saving)await this.saving;
    const remote=await this.transport('GET',this.url);
    clearCache(this.key);
    this.set({doc:remote.doc,revision:remote.revision,status:'saved',error:''});
  }
}
export function getDraft(noteId:string,pageId:string):PageDraft {
  const key=noteId+':'+pageId;
  let draft=drafts.get(key);
  if(!draft){draft=new PageDraft(noteId,pageId);drafts.set(key,draft);}
  return draft;
}
export function hasUnsavedDrafts():boolean {return [...drafts.values()].some(d=>d.hasPending);}
export function flushDrafts() {for(const draft of drafts.values())void draft.save();}

export function forgetDeletedPageDraft(noteId:string,pageId:string) {
  const key=noteId+':'+pageId;
  const draft=drafts.get(key);
  if(draft){draft.forget();drafts.delete(key);}
}
