import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { createOwner } from '../src/auth.js';
import { openDatabase } from '../src/db.js';
import type { AppConfig } from '../src/config.js';

const origin='http://localhost:5173';
test('freeform canvas CRUD, auth, versioned edits and note isolation survive restart',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'notetaking-freeform-'));
  const filename=path.join(dir,'state.sqlite');
  const config:AppConfig={appOrigin:origin,databasePath:filename,host:'127.0.0.1',port:3000,isProduction:false};
  let db=openDatabase(filename),app=await buildApp({db,config});
  const request=(method:string,url:string,payload?:unknown,cookie?:string,from=origin)=>
    app.inject({method,url,headers:{...(method!=='GET'?{origin:from}:{}),...(cookie?{cookie}:{})},
      ...(payload===undefined?{}:{payload})});
  try{
    await app.ready();
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as {n:number}).n,7);
    await createOwner(db,'another-strong-test-password');
    const cookie=String((await request('POST','/api/auth/login',{password:'another-strong-test-password'})).headers['set-cookie']).split(';')[0];
    const folder=(await request('POST','/api/folders',{name:'Sources'},cookie)).json().folder.id as string;
    const note1=(await request('POST','/api/notes',{title:'One',folderId:folder},cookie)).json().note.id as string;
    const note2=(await request('POST','/api/notes',{title:'Two',folderId:folder},cookie)).json().note.id as string;
    const base='/api/notes/'+note1+'/canvas',other='/api/notes/'+note2+'/canvas';
    assert.equal((await request('GET',base)).statusCode,401);
    assert.equal((await request('POST',base+'/items',{kind:'sticky'})).statusCode,401);
    assert.equal((await request('POST',base+'/items',{kind:'sticky'},cookie,'https://malicious.invalid')).statusCode,403);
    const empty=await request('GET',base,undefined,cookie);
    assert.equal(empty.statusCode,200);
    assert.deepEqual(empty.json().items,[]);
    assert.equal(empty.json().version,0);
    const props={kind:'sticky',x:-125,y:49,width:240,height:170,content:'<script>alert(1)</script>',expectedVersion:0};
    const created=await request('POST',base+'/items',props,cookie);
    assert.equal(created.statusCode,201,created.body);
    assert.equal(created.json().version,1);
    const id=created.json().item.id as string;
    assert.equal(created.json().item.content,props.content);
    assert.equal(created.json().item.revision,1);
    assert.equal(created.json().item.source,'');
    assert.equal(created.json().item.locator,'');
    assert.equal((await request('POST',base+'/items',props,cookie)).statusCode,409);
    assert.equal((await request('PATCH',other+'/items/'+id,{expectedRevision:1,content:'stolen'},cookie)).statusCode,404);
    assert.equal((await request('PATCH',base+'/items/'+id,{expectedRevision:0,x:10},cookie)).statusCode,409);
    for(const invalid of [
      {expectedRevision:1,width:100}, {expectedRevision:1,content:'x'.repeat(6100)},
      {expectedRevision:1,x:0.3}, {expectedRevision:1,style:'javascript:alert(1)'},
      {expectedRevision:1,kind:'image'}, {expectedRevision:1,source:'a'.repeat(351)},
      {expectedRevision:1,locator:'p'.repeat(81)}, {expectedRevision:1}
    ])assert.equal((await request('PATCH',base+'/items/'+id,invalid,cookie)).statusCode,400);
    const patched=await request('PATCH',base+'/items/'+id,{expectedRevision:1,content:'Working note',source:'Hobsbawm, The Age of Revolution',locator:'p. 46',x:530,y:220,width:300,height:260},cookie);
    assert.equal(patched.statusCode,200,patched.body);
    assert.equal(patched.json().item.revision,2);
    assert.equal(patched.json().item.source,'Hobsbawm, The Age of Revolution');
    assert.equal(patched.json().item.locator,'p. 46');
    assert.equal(patched.json().version,2);
    assert.equal((await request('DELETE',base+'/items/'+id,{expectedRevision:1},cookie)).statusCode,409);
    assert.equal((await request('GET',other,undefined,cookie)).json().items.length,0);
    await app.close();db.close();
    db=openDatabase(filename);app=await buildApp({db,config});await app.ready();
    const restored=await request('GET',base,undefined,cookie);
    assert.equal(restored.json().items.length,1);
    assert.equal(restored.json().items[0].x,530);
    assert.equal(restored.json().items[0].content,'Working note');
    assert.equal(restored.json().items[0].source,'Hobsbawm, The Age of Revolution');
    assert.equal((await request('DELETE',base+'/items/'+id,{expectedRevision:2},cookie)).statusCode,200);
    assert.equal((await request('GET',base,undefined,cookie)).json().items.length,0);
    assert.equal((await request('POST',base+'/items',{kind:'quote',x:0,y:0,width:240,height:140,expectedVersion:3},cookie)).statusCode,201);
    assert.equal((await request('DELETE','/api/notes/'+note1,undefined,cookie)).statusCode,204);
    const num=(db.prepare('SELECT COUNT(*) AS n FROM canvas_items WHERE note_id=?').get(note1) as {n:number}).n;
    assert.equal(num,0);
  }finally{
    await app.close();db.close();rmSync(dir,{recursive:true,force:true});
  }
});
