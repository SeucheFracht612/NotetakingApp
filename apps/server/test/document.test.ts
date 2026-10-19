import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOwner } from '../src/auth.js';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { EMPTY_DOCUMENT, validateDocument } from '../src/document-schema.js';
import type { AppConfig } from '../src/config.js';

const origin='http://localhost:5173';
const rich = {
  type:'doc',content:[
    {type:'heading',attrs:{level:2},content:[{type:'text',text:'Primary sources'}]},
    {type:'paragraph',content:[{type:'text',text:'A bold detail',marks:[{type:'bold'}]},
      {type:'hardBreak'},{type:'text',text:'and a note',marks:[{type:'italic'},{type:'underline'}]}]},
    {type:'bulletList',content:[{type:'listItem',content:[
      {type:'paragraph',content:[{type:'text',text:'First item'}]},
      {type:'orderedList',attrs:{start:3},content:[{type:'listItem',content:[
        {type:'paragraph',content:[{type:'text',text:'Nested list'}]}]}]}
    ]}]},
    {type:'blockquote',content:[{type:'paragraph',content:[{type:'text',text:'Original quotation'}]}]},
    {type:'horizontalRule'}
  ]
};

test('page content schema: nested rich text accepted; untrusted nodes/attrs bounded',()=>{
  assert.deepEqual(validateDocument(rich),rich);
  assert.deepEqual(validateDocument(EMPTY_DOCUMENT),EMPTY_DOCUMENT);
  const rejects=[
    {type:'doc',content:[{type:'image',attrs:{src:'javascript:alert(1)'}}]},
    {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'hello',marks:[{type:'link',attrs:{href:'javascript:1'}}]}]}]},
    {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'hello',marks:[{type:'bold',attrs:{onclick:'attack'}}]}]}]},
    {type:'doc',content:[{type:'heading',attrs:{level:5}}]},
    {type:'doc',content:[{type:'paragraph',attrs:{onclick:'x'}}]},
    {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'x'.repeat(81000)}]}]},
    {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'x'.repeat(101000)}]}]},
    {type:'doc',content:[{type:'bulletList',content:[{type:'paragraph'}]}]},
    {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'hello',marks:[{type:'bold'},{type:'bold'}]}]}]}
  ];
  for(const bad of rejects) assert.throws(()=>validateDocument(bad),/Invalid document/);
});

test('document API: independent revision, CAS conflict, auth, invalid payloads, deletion, restart', async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'notetaking-document-test-'));
  const filename=path.join(dir,'state.sqlite');
  const config:AppConfig={appOrigin:origin,databasePath:filename,host:'127.0.0.1',port:3000,isProduction:false};
  let db=openDatabase(filename),app=await buildApp({db,config});
  const request=(method:string,url:string,payload?:unknown,cookie?:string,from=origin)=>
    app.inject({method,url,headers:{...(method!=='GET'?{origin:from}:{}),...(cookie?{cookie}:{})},
      ...(payload===undefined?{}:{payload})});
  try {
    await app.ready();
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as {n:number}).n,4);
    await createOwner(db,'very-long-password-for-docs');
    const login=await request('POST','/api/auth/login',{password:'very-long-password-for-docs'});
    const cookie=String(login.headers['set-cookie']).split(';')[0];
    const folder=(await request('POST','/api/folders',{name:'Course'},cookie)).json().folder.id as string;
    const note=(await request('POST','/api/notes',{title:'Lecture',folderId:folder},cookie)).json().note.id as string;
    const note2=(await request('POST','/api/notes',{title:'Other',folderId:folder},cookie)).json().note.id as string;
    const created=await request('POST','/api/notes/'+note+'/pages/initialize',{expectedVersion:0},cookie);
    const page=created.json().pages[0].id as string;
    const base='/api/notes/'+note+'/pages/'+page+'/document';
    assert.equal((await request('GET',base)).statusCode,401);
    const fresh=await request('GET',base,undefined,cookie);
    assert.equal(fresh.statusCode,200);
    assert.deepEqual(fresh.json().doc,EMPTY_DOCUMENT);
    assert.equal(fresh.json().revision,0);
    assert.equal((await request('PUT',base,{expectedRevision:0,doc:rich},cookie,'https://evil.example')).statusCode,403);
    assert.equal((await request('PUT',base,{expectedRevision:0,doc:rich})).statusCode,401);
    const saved=await request('PUT',base,{expectedRevision:0,doc:rich},cookie);
    assert.equal(saved.statusCode,200,saved.body);
    assert.equal(saved.json().revision,1);
    assert.deepEqual(saved.json().doc,rich);
    assert.equal((await request('PUT',base,{expectedRevision:0,doc:EMPTY_DOCUMENT},cookie)).statusCode,409);
    assert.equal((await request('PUT',base,{expectedRevision:1,doc:{type:'doc',content:[
      {type:'paragraph',content:[{type:'text',text:'<script>alert(1)</script>',marks:[{type:'link'}]}]}
    ]}},cookie)).statusCode,400);
    assert.deepEqual((await request('GET',base,undefined,cookie)).json().doc,rich);
    const otherPage=(await request('POST','/api/notes/'+note2+'/pages/initialize',{expectedVersion:0},cookie)).json().pages[0].id as string;
    assert.equal((await request('GET','/api/notes/'+note2+'/pages/'+page+'/document',undefined,cookie)).statusCode,404);
    assert.equal((await request('GET','/api/notes/'+note+'/pages/'+otherPage+'/document',undefined,cookie)).statusCode,404);
    assert.equal((await request('GET','/api/notes/'+note+'/pages/not-valid/document',undefined,cookie)).statusCode,400);
    assert.equal((await request('PUT',base,{expectedRevision:1,doc:EMPTY_DOCUMENT},cookie)).statusCode,200);
    assert.equal((await request('GET',base,undefined,cookie)).json().revision,2);
    assert.equal((await request('GET','/api/notes/'+note+'/pages',undefined,cookie)).json().version,1);
    await app.close();db.close();
    db=openDatabase(filename);app=await buildApp({db,config});await app.ready();
    assert.equal((await request('GET',base,undefined,cookie)).json().revision,2);
    assert.deepEqual((await request('GET',base,undefined,cookie)).json().doc,EMPTY_DOCUMENT);
    assert.equal((await request('DELETE','/api/notes/'+note+'/pages/'+page,{expectedVersion:1},cookie)).statusCode,200);
    assert.equal((await request('GET',base,undefined,cookie)).statusCode,404);
    const left=db.prepare('SELECT COUNT(*) AS n FROM page_documents WHERE note_id = ?').get(note) as {n:number};
    assert.equal(left.n,0);
  } finally {
    await app.close();db.close();rmSync(dir,{recursive:true,force:true});
  }
});
