import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PageDraft, type JsonDoc, type ServerDocument } from '../../web/src/document-autosave.js';

const doc=(text:string):JsonDoc=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
const response=(revision:number,value:JsonDoc):ServerDocument=>({noteId:'n',pageId:'p',revision,doc:value,updatedAt:Date.now()});
test('autosave serializes changes; never claims saved until acknowledgment',async()=>{
  let current=response(0,doc('start'));
  let resolveSave:((value:ServerDocument)=>void)|null=null;
  const transport=async(method:'GET'|'PUT',_url:string,payload?:unknown)=>{
    if(method==='GET')return current;
    const sent=payload as {expectedRevision:number;doc:JsonDoc};
    assert.equal(sent.expectedRevision,current.revision);
    if(sent.expectedRevision===1){current=response(2,doc('second'));return current;}
    return new Promise<ServerDocument>(resolve=>{resolveSave=resolve;});
  };
  const manager=new PageDraft('test','a',transport,10);
  await manager.load();
  assert.equal(manager.getSnapshot().status,'saved');
  manager.edit(doc('first'));
  assert.equal(manager.getSnapshot().status,'unsaved');
  const pending=manager.save();
  assert.equal(manager.getSnapshot().status,'saving');
  manager.edit(doc('second'));
  current=response(1,doc('first'));
  assert.ok(resolveSave);
  const finish=resolveSave as unknown as (value:ServerDocument)=>void;
  finish(current);
  await pending;
  assert.equal(manager.getSnapshot().status,'unsaved');
  assert.deepEqual(manager.getSnapshot().doc,doc('second'));
  assert.equal(manager.getSnapshot().revision,1);
});

test('revision conflicts preserve the edited document',async()=>{
  const remote=response(3,doc('remote'));
  const transport=async(method:'GET'|'PUT')=>{
    if(method==='GET')return remote;
    const error=new Error('Stale document') as Error&{status:number};
    error.status=409;throw error;
  };
  const manager=new PageDraft('test','conflict',transport,10);
  await manager.load();
  manager.edit(doc('mine'));
  await manager.save();
  assert.equal(manager.getSnapshot().status,'conflict');
  assert.deepEqual(manager.getSnapshot().doc,doc('mine'));
  await manager.discardDraft();
  assert.equal(manager.getSnapshot().status,'saved');
  assert.deepEqual(manager.getSnapshot().doc,doc('remote'));
});
