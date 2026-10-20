import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync,rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { createOwner } from '../src/auth.js';
import type { AppConfig } from '../src/config.js';

const origin='http://localhost:5173';
const formatted={type:'doc',content:[
  {type:'heading',attrs:{level:2},content:[{type:'text',text:'Lecture'}]},
  {type:'paragraph',content:[{type:'text',text:'A whole paragraph of rich writing',marks:[{type:'bold'}]}]}
]};
test('flow saves a canonical rich document and appends physical downward continuation without losing another branch',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'notes-flows-'));
  const filename=path.join(dir,'db.sqlite');
  const config:AppConfig={appOrigin:origin,databasePath:filename,host:'127.0.0.1',port:3000,isProduction:false};
  let db=openDatabase(filename),app=await buildApp({db,config});
  const send=(method:string,url:string,payload?:unknown,cookie?:string,from=origin)=>
    app.inject({method,url,headers:{...(method!=='GET'?{origin:from}:{}),...(cookie?{cookie}:{})},
      ...(payload===undefined?{}:{payload})});
  try{
    await app.ready();
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as {n:number}).n,7);
    await createOwner(db,'a-very-long-test-password');
    const cookie=String((await send('POST','/api/auth/login',{password:'a-very-long-test-password'}))
      .headers['set-cookie']).split(';')[0];
    const folder=(await send('POST','/api/folders',{name:'Seminar'},cookie)).json().folder.id as string;
    const note=(await send('POST','/api/notes',{title:'History',folderId:folder},cookie)).json().note.id as string;
    const initial=await send('POST','/api/notes/'+note+'/pages/initialize',{expectedVersion:0},cookie);
    assert.equal(initial.statusCode,200,initial.body);
    const root=initial.json().pages[0].id as string;
    const flowPath='/api/notes/'+note+'/pages/'+root+'/flow';
    assert.equal((await send('GET',flowPath)).statusCode,401);
    assert.equal((await send('PUT',flowPath,{expectedRevision:0,doc:formatted})).statusCode,401);
    assert.equal((await send('PUT',flowPath,{expectedRevision:0,doc:formatted},cookie,'https://evil.invalid')).statusCode,403);
    const starting=await send('GET',flowPath,undefined,cookie);
    assert.equal(starting.statusCode,200,starting.body);
    assert.equal(starting.json().revision,0);
    assert.deepEqual(starting.json().pageIds,[root]);
    const saved=await send('PUT',flowPath,{expectedRevision:0,doc:formatted},cookie);
    assert.equal(saved.statusCode,200,saved.body);
    assert.equal(saved.json().revision,1);
    assert.deepEqual(saved.json().doc,formatted);
    assert.equal((await send('PUT',flowPath,{expectedRevision:0,doc:{type:'doc',content:[]}},cookie)).statusCode,409);
    const bad=await send('PUT',flowPath,{expectedRevision:1,doc:{type:'doc',content:[{type:'iframe'}]}},cookie);
    assert.equal(bad.statusCode,400);
    assert.equal((await send('GET',flowPath,undefined,cookie)).json().revision,1);
    // A separate manual page to the south has its own writing flow.
    const branch=await send('POST','/api/notes/'+note+'/pages/insert',{anchorId:root,direction:'S',expectedVersion:1},cookie);
    assert.equal(branch.statusCode,200,branch.body);
    const other=branch.json().pages.find((p:{id:string})=>p.id!==root).id as string;
    const otherFlow='/api/notes/'+note+'/pages/'+other+'/flow';
    assert.equal((await send('GET',otherFlow,undefined,cookie)).json().revision,0);
    const appended=await send('POST','/api/notes/'+note+'/pages/'+root+'/continue',{
      expectedFlowRevision:1,expectedLayoutVersion:2
    },cookie);
    assert.equal(appended.statusCode,200,appended.body);
    assert.equal(appended.json().flow.pageIds.length,2);
    assert.equal(appended.json().layout.version,3);
    const continuation=appended.json().flow.pageIds[1] as string;
    assert.equal(appended.json().layout.pages.find((p:{id:string})=>p.id===continuation).gy,1);
    assert.equal(appended.json().layout.pages.find((p:{id:string})=>p.id===other).gy,2);
    assert.deepEqual((await send('GET','/api/notes/'+note+'/pages/'+continuation+'/flow',undefined,cookie)).json().doc,formatted);
    assert.equal((await send('GET',otherFlow,undefined,cookie)).json().pageIds.length,1);
    assert.equal((await send('POST','/api/notes/'+note+'/pages/'+root+'/continue',{
      expectedFlowRevision:1,expectedLayoutVersion:2
    },cookie)).statusCode,409);
    assert.equal((await send('POST','/api/notes/'+note+'/pages/'+root+'/continue',{
      expectedFlowRevision:0,expectedLayoutVersion:3
    },cookie)).statusCode,409);
    const changed=await send('PUT',flowPath,{expectedRevision:1,doc:{type:'doc',content:[{type:'paragraph'}]}},cookie);
    assert.equal(changed.statusCode,200);
    assert.equal(changed.json().revision,2);
    const different=await send('GET',otherFlow,undefined,cookie);
    assert.notDeepEqual(different.json().doc,formatted);
    await app.close();db.close();
    db=openDatabase(filename);app=await buildApp({db,config});await app.ready();
    assert.equal((await send('GET',flowPath,undefined,cookie)).json().pageIds.length,2);
    assert.equal((await send('GET',flowPath,undefined,cookie)).json().revision,2);
  }finally{await app.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
