// Browser checks for the content redesign: Modules and Assessments pages, module workspace, lesson sheet,
// question builder, PDF viewer and the student quiz filter. Needs the test server on 127.0.0.1:8091 and
// headless Chrome on 9225, run after tests/integration.mjs has set up the fixtures (fixture-student and its password).
import fs from 'node:fs';
import path from 'node:path';
const base='http://127.0.0.1:8091';
const credentials=JSON.parse(fs.readFileSync('.runtime/test-access.json','utf8'));
const studentPassword='replacement-test-password';
let checks=0;const errors=[];
function check(value,message){if(!value){console.error('FAIL: '+message);if(errors.length)console.error('Page errors: '+errors.join(' | '));process.exit(1);}checks++;}
const target=await (await fetch('http://127.0.0.1:9225/json/new?about:blank',{method:'PUT'})).json();
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
let next=0;const pending=new Map();
socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const entry=pending.get(data.id);pending.delete(data.id);data.error?entry.reject(new Error(data.error.message)):entry.resolve(data.result);}else if(data.method==='Runtime.exceptionThrown'){errors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);}});
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
// Every question the portal asks goes through its own dialogs; a native alert, confirm or prompt is recorded, dismissed and fails the suite at the end.
const nativeDialogs=[];
socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.method==='Page.javascriptDialogOpening'){nativeDialogs.push(data.params.type+': '+data.params.message);call('Page.handleJavaScriptDialog',{accept:false});}});
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
async function waitFor(expression,timeout=15000){for(let waited=0;waited<timeout;waited+=200){try{if(await evaluate(expression))return true;}catch{/* The page is mid-navigation. */}await new Promise(resolve=>setTimeout(resolve,200));}return false;}
async function navigate(path){
    await call('Page.navigate',{url:base+path});
    for(let i=0;i<60;i++){
        await new Promise(resolve=>setTimeout(resolve,200));
        if(await evaluate(`location.pathname===${JSON.stringify(path.split(/[?#]/)[0])} && document.readyState==='complete'`))break;
    }
    await new Promise(resolve=>setTimeout(resolve,450));
}
const key=async(name,extra={})=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key:name,...extra});await call('Input.dispatchKeyEvent',{type:'keyUp',key:name});};
await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
await call('Network.clearBrowserCookies');
async function signIn(username,password,home){
    await call('Network.clearBrowserCookies');
    await navigate('/login.html');
    await evaluate(`document.getElementById('username').value=${JSON.stringify(username)};document.getElementById('password').value=${JSON.stringify(password)};handleLogin();`);
    await waitFor(`location.pathname.startsWith(${JSON.stringify(home)}) && document.readyState==='complete'`);
    check((await evaluate('location.pathname')).startsWith(home),'Signed in as '+username);
}
// Posts a multipart request from inside the page so the session cookie goes along.
const fixture=name=>fs.readFileSync('tests/fixtures/'+name).toString('base64');
const upload=(path,fields,file,field,name)=>evaluate(`(async()=>{const fd=new FormData();for(const [k,v] of Object.entries(${JSON.stringify(fields)}))fd.append(k,v);
  const bytes=Uint8Array.from(atob(${JSON.stringify(fixture(file))}),c=>c.charCodeAt(0));fd.append(${JSON.stringify(field)},new Blob([bytes],{type:'application/pdf'}),${JSON.stringify(name)});
  return fetch(API_BASE+'/${path}',{method:'POST',credentials:'same-origin',body:fd}).then(r=>r.json());})()`);

// ── Teacher ─────────────────────────────────────────────────────
await signIn(credentials.username,credentials.password,'/teacher/');
await navigate('/teacher/lesson-plans.html');
check(await evaluate(`typeof PdfViewer==='object'&&typeof PdfViewer.open==='function'&&typeof PdfViewer.mount==='function'&&typeof PdfViewer.thumbnail==='function'`),'Lesson plans page loads the PDF viewer');
const mods=await evaluate(`fetch(API_BASE+'/modules.php',{credentials:'same-origin'}).then(r=>r.json())`);
const moduleId=mods.data.find(m=>m.status==='published').module_id;
const material=await upload('files.php',{kind:'material',module_id:moduleId,title:'Long reader'},'long.pdf','file','long.pdf');
check(material.success,'Upload the 60 page material');
const fileId=material.data.file_id;
check((await upload('files.php',{kind:'lesson_plan',title:'Plan one'},'sample.pdf','file','plan.pdf')).success,'Upload a lesson plan');
const lesson=await upload('lessons.php',{module_id:moduleId,title:'PDF lesson',lesson_type:'reading',content_text:'Read the handout.',status:'published'},'sample.pdf','lesson_file','sample.pdf');
check(lesson.success,'Create a published lesson with a PDF attachment');
const lessonId=lesson.data.lesson_id;

// Full-screen viewer on the 60 page file.
await evaluate(`PdfViewer.open({url:API_BASE+'/files.php?id=${fileId}',title:'Long'})`);
check(await waitFor(`document.querySelectorAll('.pv-stage [data-page]').length===60`),'Every page gets a placeholder');
check(await waitFor(`document.querySelectorAll('.pv-stage canvas[data-rendered]').length>=1`),'The first page renders');
check(await evaluate(`document.querySelectorAll('.pv-stage canvas[data-rendered]').length<=3`),'Only pages near the view render');
check(await evaluate(`document.querySelector('.pv-pages').textContent.includes('of 60')`),'Page count shows');
check(await evaluate(`Boolean(document.querySelector('.pv-overlay .pv-rail'))&&getComputedStyle(document.querySelector('.pv-rail')).display!=='none'`),'Thumbnail rail shows on a wide screen');
check(await waitFor(`document.querySelectorAll('.pv-rail canvas[data-rendered]').length>=1`),'Rail thumbnails render');
check(await evaluate(`[...document.querySelectorAll('.pv-overlay button, .pv-overlay a, .pv-overlay input')].every(el=>el.getAttribute('aria-label'))`),'Every control has an aria-label');
check(await evaluate(`document.querySelector('.pv-pages').getAttribute('aria-live')==='polite'`),'Page box is a polite live region');
check(await evaluate(`/files\\.php\\?id=${fileId}$/.test(document.querySelector('.pv-overlay a[aria-label="Download"]').getAttribute('href'))`),'Download link points at the file');
await key('ArrowRight');
check(await waitFor(`document.querySelector('.pv-pages input').value==='2'`),'Right arrow goes to page 2');
await key('ArrowLeft');
check(await waitFor(`document.querySelector('.pv-pages input').value==='1'`),'Left arrow goes back to page 1');
const before=await evaluate(`document.querySelector('.pv-zoom').textContent`);
await key('+',{text:'+'});
check(await waitFor(`document.querySelector('.pv-zoom').textContent!==${JSON.stringify(before)}`),'Plus changes the zoom');
await key('-',{text:'-'});
check(await waitFor(`document.querySelector('.pv-zoom').textContent===${JSON.stringify(before)}`),'Minus changes it back');
await key('Escape');
check(await waitFor(`!document.querySelector('.pv-overlay')`),'Escape closes the viewer');

// Lesson plans: the row opens the same viewer, never a browser tab.
await navigate('/teacher/lesson-plans.html');
check(await waitFor(`document.querySelector('.tf-item')`),'Lesson plan row is listed');
check(await evaluate(`!document.querySelector('.tf-item a[target=_blank]')`),'PDF rows no longer open a new tab');
await evaluate(`document.querySelector('.tf-item [data-open]').click()`);
check(await waitFor(`document.querySelector('.pv-overlay .pv-stage canvas[data-rendered]')`),'Lesson plan opens in the viewer');
await evaluate(`document.querySelector('.pv-overlay [aria-label="Close"]').click()`);
check(await waitFor(`!document.querySelector('.pv-overlay')`),'Close button closes the viewer');
await evaluate(`(()=>{const v=PdfViewer.open({url:API_BASE+'/files.php?id=${fileId}',title:'Again'});v.close();v.close();})()`);
check(await evaluate(`document.querySelectorAll('.pv-overlay').length===0`),'close() twice leaves no overlay');
await navigate('/teacher/modules.html');
check(await evaluate(`typeof PdfViewer==='object'`),'Modules page loads the PDF viewer');
check(await evaluate(`typeof LessonReader==='object'&&typeof LessonReader.show==='function'`),'Modules page loads the lesson reader');
check(await evaluate(`(()=>{const r=document.createElement('div');r.className='sd-reader';r.id='lrtest';r.hidden=true;document.body.append(r);let closed=0;LessonReader.show(r,{lesson_id:1,title:'Preview <b>',system_code:'MUS',system_name:'Muscular System',module_title:'Mod',content_text:'Body text'},{exploreHref:null,onClose:()=>closed++});const ok=!r.hidden&&r.querySelector('.sd-reader-doc')&&!/View in 3D|Practice in 3D/.test(r.textContent)&&!r.querySelector('a[href*="anatomy"]');r.querySelector('.sd-reader-foot button').click();window.__lrClosed=closed;return !!ok&&r.hidden&&document.body.style.overflow==='';})()`),'Reader without exploreHref has no 3D link and closes cleanly');
check(await evaluate(`window.__lrClosed===1`),'onClose runs once on close');

// A file that does not exist falls back to a download link.
await evaluate(`(()=>{const d=document.createElement('div');d.id='pvbad';document.body.append(d);PdfViewer.mount(d,{url:API_BASE+'/files.php?id=999999',title:'Missing'});})()`);
check(await waitFor(`document.querySelector('#pvbad .pv-fallback a[href*="files.php?id=999999"]')`),'A broken file shows the fallback with a Download link');

// Phone width: the toolbar wraps, there is no rail and no sideways scroll.
await call('Emulation.setDeviceMetricsOverride',{width:390,height:800,deviceScaleFactor:2,mobile:true});
await evaluate(`PdfViewer.open({url:API_BASE+'/files.php?id=${fileId}',title:'Long'})`);
check(await waitFor(`document.querySelector('.pv-overlay .pv-stage canvas[data-rendered]')`),'Viewer renders at 390px');
check(await evaluate(`getComputedStyle(document.querySelector('.pv-rail')).display==='none'`),'No thumbnail rail at 390px');
check(await evaluate(`(()=>{const o=document.querySelector('.pv-overlay'),b=document.querySelector('.pv-overlay .pv-bar');return o.scrollWidth<=o.clientWidth&&document.documentElement.scrollWidth<=innerWidth&&b.scrollWidth<=b.clientWidth+1;})()`),'No horizontal scroll at 390px');
check(await evaluate(`(()=>{const tops=[...document.querySelectorAll('.pv-overlay .pv-bar > *')].map(e=>e.getBoundingClientRect().top);return Math.max(...tops)-Math.min(...tops)>20;})()`),'Toolbar wraps to a second row at 390px');
await key('Escape');
await call('Emulation.clearDeviceMetricsOverride');

// ── Modules grid ────────────────────────────────────────────────
// A footer fits when its count text is not cut off and every control sits inside the card (cards clip with overflow:hidden).
const inside=(outer,inner)=>`(()=>{const o=${outer}.getBoundingClientRect(),r=${inner}.getBoundingClientRect();return r.left>=o.left-.5&&r.right<=o.right+.5&&r.top>=o.top-.5&&r.bottom<=o.bottom+.5;})()`;
const footFits=`[...document.querySelectorAll('.cs-mod')].every(card=>{const meta=card.querySelector('.cs-mod-foot .cs-meta');return meta.scrollWidth<=meta.clientWidth&&[...card.querySelector('.cs-mod-foot').children].every(el=>${inside('card','el')});})`;
// The widest footer: the longest count text next to the wider Add lesson button.
const longestFoot=`(()=>{const card=[...document.querySelectorAll('.cs-mod')].find(c=>c.querySelector('.cs-mod-foot a').textContent.trim()==='Add lesson');card.querySelector('.cs-mod-foot .cs-meta').textContent='12 lessons · 10 materials';return true;})()`;
const segFits=`[...document.querySelectorAll('#statusFilter button')].every(b=>b.scrollWidth<=b.clientWidth&&${inside(`document.getElementById('statusFilter')`,'b')})`;
const headingsInOrder=`(()=>{let last=0;for(const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6')){const level=+h.tagName[1];if(level>last+1)return false;last=level;}return true;})()`;
await call('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
await navigate('/teacher/modules.html');
check(await waitFor(`document.querySelectorAll('.cs-mod').length>0`),'Module cards render');
check(await evaluate(`[...document.querySelectorAll('.cs-mod')].every(c=>c.querySelector('.cs-eyebrow')&&c.querySelector('.cs-status'))`),'Every card has a system eyebrow and a status');
check(await evaluate(footFits),'Card actions are never clipped at 1366px');
check(await evaluate(headingsInOrder),'Modules page headings are sequential');
check(await evaluate(segFits),'Every status filter fits its control at 1366px');
check(await evaluate(`!document.getElementById('addModuleModal')&&!document.getElementById('materialsModal')&&!/alert\\(|prompt\\(/.test(document.body.innerHTML)`),'Popups are gone');
const testModule=(await evaluate(`fetch(API_BASE+'/modules.php',{credentials:'same-origin'}).then(r=>r.json())`)).data.find(m=>m.module_id===moduleId);
const card=`document.querySelector('.cs-mod[data-id="${moduleId}"]')`;
const many=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
check(testModule.lessons.some(l=>l.status==='draft')&&testModule.material_count>0,'Fixture module has a draft lesson and a material');
check(await evaluate(`${card}.querySelector('.cs-mod-foot .cs-meta').textContent`)===`${many(testModule.lessons.length,'lesson')} · ${many(testModule.material_count,'material')}`,'Card counts lessons (drafts included) and materials');
check(await evaluate(`[...${card}.querySelectorAll('.cs-mix span')].some(s=>s.textContent.includes('PDF'))&&[...${card}.querySelectorAll('.cs-mix span')].some(s=>s.textContent.includes('Reading'))`),'Card shows lesson-kind chips');
check(await evaluate(`/modules\\.html\\?module=${moduleId}$/.test(${card}.querySelector('.cs-mod-foot a').getAttribute('href'))&&${card}.querySelector('.cs-mod-foot a').textContent.trim()==='Open'`),'Open links to the module');
check(await evaluate(`document.querySelectorAll('.cs-btn--primary').length===1`),'One primary button on the page');

// New module through the sheet (POST), created as a draft.
await evaluate(`document.getElementById('newModuleBtn').click()`);
check(await waitFor(`document.querySelector('.cs-sheet[role="dialog"][aria-modal="true"]')`),'New module opens the sheet');
check(await evaluate(`document.activeElement.closest('.cs-sheet')!==null`),'Focus moves into the sheet');
check(await evaluate(`['title','system_id','description'].every(n=>document.querySelector('.cs-sheet [name="'+n+'"]'))&&document.querySelectorAll('.cs-sheet [name="status"]').length===2`),'Sheet asks for title, body system, description and status');
await evaluate(`(()=>{const s=document.querySelector('.cs-sheet');const set=(sel,v)=>{const el=s.querySelector(sel);el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));};
  set('[name="title"]','Sheet module');set('[name="system_id"]',s.querySelector('[name="system_id"] option[value]:not([value=""])').value);set('[name="description"]','Made in the sheet');
  s.querySelector('[name="status"][value="draft"]').click();document.querySelector('.cs-sheet-foot .cs-btn--primary').click();})()`);
check(await waitFor(`!document.querySelector('.cs-sheet')&&[...document.querySelectorAll('.cs-mod .cs-h3')].some(h=>h.textContent==='Sheet module')`),'Saving the sheet creates the module');
const sheetModule=`[...document.querySelectorAll('.cs-mod')].find(c=>c.querySelector('.cs-h3').textContent.startsWith('Sheet module'))`;
check(await evaluate(`${sheetModule}.classList.contains('cs-mod--draft')&&${sheetModule}.querySelector('.cs-status--draft')!==null`),'New draft shows the draft status');

// Filters: Draft shows drafts only; a lesson title finds its module only.
await evaluate(`document.querySelector('.cs-seg [data-status="draft"]').click()`);
check(await waitFor(`document.querySelectorAll('.cs-mod').length>0&&[...document.querySelectorAll('.cs-mod')].every(c=>c.querySelector('.cs-status--draft'))`),'Draft filter shows draft modules only');
await evaluate(`document.querySelector('.cs-seg [data-status="all"]').click()`);
await evaluate(`(()=>{const i=document.querySelector('.cs-search input');i.value='Second lesson';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
check(await waitFor(`document.querySelectorAll('.cs-mod').length===1&&document.querySelector('.cs-mod').dataset.id==='${moduleId}'`),'Searching a lesson title shows its module only');
await evaluate(`(()=>{const i=document.querySelector('.cs-search input');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
check(await waitFor(`document.querySelectorAll('.cs-mod').length>=2`),'Clearing the search shows every module again');

// More menu: arrow keys move, Escape closes and returns focus; Edit details opens the sheet.
await evaluate(`${sheetModule}.querySelector('[data-more]').click()`);
check(await waitFor(`document.querySelector('.cs-menu[role="menu"]')&&document.activeElement.getAttribute('role')==='menuitem'`),'More opens a menu with focus on the first item');
check(await evaluate(`[...document.querySelectorAll('.cs-menu [role="menuitem"]')].map(b=>b.textContent.trim()).join('|')`)==='Edit details|Publish|Archive','Menu offers Edit details, Publish and Archive');
await key('ArrowDown');
check(await evaluate(`document.activeElement.textContent.trim()==='Publish'`),'Arrow down moves to the next item');
await key('Escape');
check(await waitFor(`!document.querySelector('.cs-menu')&&document.activeElement.matches('[data-more]')`),'Escape closes the menu and returns focus');
await evaluate(`${sheetModule}.querySelector('[data-more]').click()`);
await waitFor(`document.querySelector('.cs-menu')`);
await evaluate(`[...document.querySelectorAll('.cs-menu [role="menuitem"]')].find(b=>b.textContent.trim()==='Edit details').click()`);
check(await waitFor(`document.querySelector('.cs-sheet [name="title"]')?.value==='Sheet module'`),'Edit details opens the sheet with the module filled in');
check(await evaluate(`!document.querySelector('.cs-sheet select')&&document.querySelector('.cs-sheet').textContent.includes('Test System')`),'Body system is shown read-only when editing');
await evaluate(`document.querySelector('.cs-sheet-foot .cs-btn--primary').focus()`);
await key('Tab');
check(await evaluate(`document.activeElement.closest('.cs-sheet')!==null`),'Tab stays inside the sheet');
await evaluate(`(()=>{const t=document.querySelector('.cs-sheet [name="title"]');t.focus();t.setSelectionRange(t.value.length,t.value.length);})()`);
await call('Input.insertText',{text:' renamed'});
await key('Escape');
check(await waitFor(`document.querySelector('dialog.toast-confirm[open]')?.textContent.includes('Discard changes?')`),'Escape with unsaved changes asks first');
await evaluate(`document.querySelector('dialog.toast-confirm .toast-confirm__stay').click()`);
check(await waitFor(`!document.querySelector('dialog.toast-confirm')&&document.querySelector('.cs-sheet')`),'Keep editing leaves the sheet open');
// The save is held back for a moment so Escape lands while it is in flight.
await evaluate(`(()=>{const real=window.fetch;window.__realFetch=real;window.fetch=(...a)=>new Promise(r=>setTimeout(()=>r(real(...a)),800));})()`);
await evaluate(`document.querySelector('.cs-sheet-foot .cs-btn--primary').click()`);
await key('Escape');
check(await evaluate(`!document.querySelector('dialog.toast-confirm')&&document.querySelector('.cs-sheet [data-sheet-close]').disabled&&document.querySelector('.cs-sheet-foot [data-cancel]').disabled`),'Escape while the module saves does not ask to discard');
await evaluate(`window.fetch=window.__realFetch`);
check(await waitFor(`!document.querySelector('.cs-sheet')&&[...document.querySelectorAll('.cs-mod .cs-h3')].some(h=>h.textContent==='Sheet module renamed')`),'Saving edits updates the card');

// Publish from the menu: a published module with no lessons shows the amber note and Add lesson.
await evaluate(`${sheetModule}.querySelector('[data-more]').click()`);
await waitFor(`document.querySelector('.cs-menu')`);
await evaluate(`[...document.querySelectorAll('.cs-menu [role="menuitem"]')].find(b=>b.textContent.trim()==='Publish').click()`);
check(await waitFor(`${sheetModule}?.querySelector('.cs-status--published')`),'Publish from the menu');
check(await evaluate(`${sheetModule}.querySelector('.cs-warn')!==null&&${sheetModule}.querySelector('.cs-mod-foot a').textContent.trim()==='Add lesson'&&/modules\\.html\\?module=\\d+$/.test(${sheetModule}.querySelector('.cs-mod-foot a').getAttribute('href'))`),'An empty published module warns and offers Add lesson');
check(await evaluate(footFits),'Add lesson footer fits at 1366px');
await evaluate(longestFoot);
check(await evaluate(footFits),'Long counts beside Add lesson still fit at 1366px');
check(await evaluate(headingsInOrder),'Headings stay sequential with every card kind');

// Archive asks first, then the card leaves the grid.
await evaluate(`${sheetModule}.querySelector('[data-more]').click()`);
await waitFor(`document.querySelector('.cs-menu')`);
await evaluate(`[...document.querySelectorAll('.cs-menu [role="menuitem"]')].find(b=>b.textContent.trim()==='Archive').click()`);
check(await waitFor(`document.querySelector('dialog.toast-confirm[open]')?.textContent.includes('Archive this module?')`),'Archive asks first');
await evaluate(`document.querySelector('dialog.toast-confirm .toast-confirm__go').click()`);
check(await waitFor(`!${sheetModule}&&document.querySelector('.cs-seg [data-status="archived"]')`),'Archived module leaves the grid and an Archived filter appears');

// Phone width: no sideways scroll, card actions and all four status filters still fit.
await call('Emulation.setDeviceMetricsOverride',{width:390,height:800,deviceScaleFactor:2,mobile:true});
await navigate('/teacher/modules.html');
check(await waitFor(`document.querySelectorAll('.cs-mod').length>0`),'Cards render at 390px');
check(await evaluate(`document.documentElement.scrollWidth<=390`),'No horizontal scroll at 390px');
check(await evaluate(footFits),'Card actions fit at 390px');
check(await evaluate(`document.querySelectorAll('#statusFilter button').length===4`),'All, Published, Draft and Archived filters show');
check(await evaluate(segFits),'Every status filter fits its control at 390px');
await evaluate(`document.querySelectorAll('#statusFilter em').forEach(e=>e.textContent='88')`);
check(await evaluate(segFits)&&await evaluate(`document.documentElement.scrollWidth<=390`),'Two-digit counts still fit at 390px');
await evaluate(`document.querySelector('#statusFilter [data-status="archived"]').click()`);
check(await waitFor(`document.querySelector('.cs-mod .cs-status--archived')`),'Archived filter shows the archived module');
await evaluate(longestFoot);
check(await evaluate(footFits),'Long counts beside Add lesson still fit at 390px');
check(await evaluate(`document.documentElement.scrollWidth<=390`),'Still no horizontal scroll at 390px');
await call('Emulation.clearDeviceMetricsOverride');

// ── Module workspace ────────────────────────────────────────────
// The fixture module: lessons in a saved order with a draft among them and the PDF lesson last, the Long reader material, the Test quiz.
await call('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
const moduleRow=async()=>(await evaluate(`fetch(API_BASE+'/modules.php',{credentials:'same-origin'}).then(r=>r.json())`)).data.find(m=>m.module_id===moduleId);
const ws=await moduleRow();
const lessonCount=ws.lessons.length;
const rowIds=`[...document.querySelectorAll('.cs-row')].map(r=>Number(r.dataset.lesson))`;
const rowById=id=>`document.querySelector('.cs-row[data-lesson="${id}"]')`;
const savedOrderIs=order=>`fetch(API_BASE+'/modules.php',{credentials:'same-origin'}).then(r=>r.json()).then(j=>JSON.stringify(j.data.find(m=>m.module_id===${moduleId}).lessons.map(l=>l.lesson_id))===${JSON.stringify(JSON.stringify(order))})`;
const shownOrderIs=order=>`JSON.stringify(${rowIds})===${JSON.stringify(JSON.stringify(order))}`;
const menuItems=`[...document.querySelectorAll('.cs-menu [role="menuitem"]')].map(b=>b.textContent.trim())`;
const pick=label=>`[...document.querySelectorAll('.cs-menu [role="menuitem"]')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`;
const openRowMenu=async id=>{await evaluate(`${rowById(id)}.querySelector('[data-row-more]').click()`);return waitFor(`document.querySelector('.cs-menu[role="menu"]')`);};
const materialRow=name=>`[...document.querySelectorAll('[data-materials] .cs-file')].find(f=>f.textContent.includes(${JSON.stringify(name)}))`;
const gridShown=`document.getElementById('moduleGrid').offsetParent!==null`;
await navigate('/teacher/modules.html?module='+moduleId);
check(await waitFor(`document.querySelector('.cs-hero h2')?.textContent==='Test module'`),'Workspace opens from the URL');
check(await evaluate(`document.activeElement===document.querySelector('.cs-hero h2')`),'Focus starts on the module title');
check(await evaluate(`!(${gridShown})`),'The grid is hidden in the workspace');
check(await evaluate(`document.querySelectorAll('.cs-row').length===${lessonCount}`),'Every lesson is listed, drafts included');
check(await evaluate(shownOrderIs(ws.lessons.map(l=>l.lesson_id))),'Lessons show in their saved order');
const draftLesson=ws.lessons.find(l=>l.status==='draft');
check(await evaluate(`${rowById(draftLesson.lesson_id)}.querySelector('.cs-status--draft')!==null&&${rowById(draftLesson.lesson_id)}.querySelector('.cs-meta').textContent==='Reading · no time set'`),'A draft shows its status, and a lesson without a duration says so');
check(await waitFor(`${rowById(lessonId)}.querySelector('.cs-meta').textContent==='PDF, 3 pages · no time set'`),'A PDF lesson shows its kind and page count');
check(await evaluate(`(()=>{const t=document.querySelector('.cs-hero .cs-meta').textContent;return t.startsWith(${JSON.stringify(many(lessonCount,'lesson'))})&&t.includes(${JSON.stringify(many(ws.material_count,'material'))})&&t.endsWith('Updated today');})()`),'Hero counts lessons and materials');
check(await evaluate(`document.querySelector('.cs-hero .cs-eyebrow').textContent==='Test System · Module'&&document.querySelector('.cs-hero .cs-status--published')!==null`),'Hero shows the body system and the status');
check(await evaluate(`document.querySelector('.cs-side').textContent.includes('Test quiz')`),'Linked quizzes show');
check(await evaluate(`[...document.querySelectorAll('.cs-quiz')].find(q=>q.querySelector('.cs-row-title').textContent==='Test quiz').querySelector('.cs-meta').textContent.startsWith('3 questions · 2 attempts · avg ')`),'A quiz shows its questions, attempts and average');
check(await evaluate(`/assessments\\.html/.test(document.querySelector('.cs-quiz').getAttribute('href'))`),'Quizzes link to the Assessments page');
check(await waitFor(`${materialRow('Long reader')}?.querySelector('canvas[data-rendered]')`),'Materials show a first-page thumbnail');
check(await waitFor(`${materialRow('Long reader')}.querySelector('.cs-meta').textContent.startsWith('PDF · 60 pages · ')`),'A PDF material shows its page count');
check(await evaluate(headingsInOrder),'Workspace headings are sequential');
check(await evaluate(`[...document.querySelectorAll('#workspaceView .cs-btn--primary')].filter(b=>b.offsetParent).length===1`),'One primary button in the workspace');
await evaluate(`${materialRow('Long reader')}.querySelector('[data-open]').click()`);
check(await waitFor(`document.querySelector('.pv-overlay .pv-stage canvas[data-rendered]')`),'A material PDF opens in the viewer');
check(await evaluate(`document.querySelector('.pv-overlay .pv-context').textContent===document.querySelector('#workspaceView .cs-hero h2').textContent+' · Materials'`),'The material viewer names the module it came from');
await key('Escape');
check(await waitFor(`!document.querySelector('.pv-overlay')`),'Escape closes the material viewer');

// Materials: Upload opens a small form; dropping a file on the panel also uploads; Delete asks first.
const pdfTransfer=name=>`(()=>{const b=Uint8Array.from(atob(${JSON.stringify(fixture('sample.pdf'))}),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([b],${JSON.stringify(name)},{type:'application/pdf'}));return dt;})()`;
await evaluate(`document.querySelector('[data-materials] [data-upload]').click()`);
check(await waitFor(`!document.querySelector('[data-materials] form').hidden&&document.activeElement===document.querySelector('[data-materials] input[type=file]')`),'Upload opens a small form');
await evaluate(`(()=>{const f=document.querySelector('[data-materials] form');f.elements.file.files=${pdfTransfer('form-upload.pdf')}.files;f.elements.title.value='Form handout';f.requestSubmit();})()`);
check(await waitFor(`${materialRow('Form handout')}&&document.querySelector('[data-materials] form').hidden`),'The form uploads the file and closes');
check(await waitFor(`document.querySelector('.cs-hero .cs-meta').textContent.includes(${JSON.stringify(many(ws.material_count+1,'material'))})`),'Hero material count follows uploads');
await evaluate(`(()=>{const dt=${pdfTransfer('dropped-sheet.pdf')};const p=document.querySelector('[data-materials]');for(const t of ['dragenter','dragover'])p.dispatchEvent(new DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:dt}));window.__dropShown=p.classList.contains('is-drop');p.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));})()`);
check(await evaluate(`window.__dropShown===true`),'Dragging a file over Materials shows the drop target');
check(await waitFor(`${materialRow('dropped-sheet')}&&!document.querySelector('[data-materials]').classList.contains('is-drop')`),'Dropping a file on Materials uploads it');
for(const name of ['Form handout','dropped-sheet']){
  await evaluate(`${materialRow(name)}.querySelector('[data-file-more]').click()`);
  await waitFor(`document.querySelector('.cs-menu')`);
  await evaluate(pick('Delete'));
  check(await waitFor(`document.querySelector('dialog.toast-confirm[open]')?.textContent.includes('Delete this file?')`),'Deleting a material asks first: '+name);
  await evaluate(`document.querySelector('dialog.toast-confirm .toast-confirm__go').click()`);
  check(await waitFor(`!${materialRow(name)}`),'A deleted material leaves the list: '+name);
}
check(await waitFor(`document.querySelector('.cs-hero .cs-meta').textContent.includes(${JSON.stringify(many(ws.material_count,'material'))})`),'Hero material count follows deletes');

// Reorder with the row menu: the first lesson cannot move up; the last moves up and stays there after a reload.
const lastId=ws.lessons.at(-1).lesson_id;
await openRowMenu(ws.lessons[0].lesson_id);
const firstItems=await evaluate(menuItems);
check(!firstItems.includes('Move up')&&firstItems.includes('Move down'),'The first lesson cannot move up');
await key('Escape');
await openRowMenu(lastId);
const lastItems=await evaluate(menuItems);
check(lastItems.includes('Move up')&&!lastItems.includes('Move down')&&lastItems.includes('Unpublish')&&lastItems.at(-1)==='Delete','Row menu offers Move up, Unpublish and Delete');
await evaluate(pick('Move up'));
const movedOrder=[...ws.lessons.slice(0,-2).map(l=>l.lesson_id),lastId,ws.lessons.at(-2).lesson_id];
check(await waitFor(shownOrderIs(movedOrder)),'Move up moves the row');
check(await evaluate(`document.activeElement===${rowById(lastId)}.querySelector('[data-row-more]')`),'Focus stays on the moved lesson');
check(await waitFor(`document.querySelector('#workspaceView [data-announce]').textContent==='Moved to position ${lessonCount-1} of ${lessonCount}.'`),'The move is announced');
check(await waitFor(savedOrderIs(movedOrder)),'The new order is saved');
await navigate('/teacher/modules.html?module='+moduleId);
check(await waitFor(shownOrderIs(movedOrder)),'The new order survives a reload');

// Drag the first lesson below the third (native drag and drop; the menu is the keyboard path).
const dragOrder=[movedOrder[1],movedOrder[2],movedOrder[0],...movedOrder.slice(3)];
await evaluate(`(()=>{const rows=[...document.querySelectorAll('.cs-row')],dt=new DataTransfer(),src=rows[0],dst=rows[2],y=dst.getBoundingClientRect().bottom-3;const fire=(el,type)=>el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientY:y}));fire(src,'dragstart');fire(dst,'dragover');window.__dropMark=dst.classList.contains('is-drop-after');fire(dst,'drop');fire(src,'dragend');})()`);
check(await evaluate(`window.__dropMark===true`),'Dragging over a row marks where the lesson will land');
check(await waitFor(shownOrderIs(dragOrder)),'Dragging a row reorders the lessons');
check(await waitFor(savedOrderIs(dragOrder)),'A dragged order is saved');

// Another tab adds a lesson: the next move is refused, a toast says so and the list reloads.
const elsewhere=await evaluate(`fetch(API_BASE+'/lessons.php',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({module_id:${moduleId},title:'Added elsewhere',lesson_type:'reading',content_text:'From another tab',status:'draft'})}).then(r=>r.json())`);
const added=Number(elsewhere.data?.lesson_id);
check(elsewhere.success&&await evaluate(`document.querySelectorAll('.cs-row').length===${lessonCount}`),'Another tab adds a lesson');
await openRowMenu(dragOrder[0]);
await evaluate(pick('Move down'));
check(await waitFor(`[...document.querySelectorAll('.toast')].some(t=>t.textContent.includes('The lesson list changed. Reload and try again.'))`),'A stale reorder shows a toast');
check(await waitFor(`document.querySelectorAll('.cs-row').length===${lessonCount+1}&&${rowById(added)}!==null`),'A stale reorder reloads the list');
check(JSON.stringify(await evaluate(rowIds))===JSON.stringify((await moduleRow()).lessons.map(l=>l.lesson_id)),'After the reload the list matches the saved order');

// Publish and unpublish a lesson from its menu; Delete asks first.
await openRowMenu(added);
await evaluate(pick('Publish'));
check(await waitFor(`${rowById(added)}?.querySelector('.cs-status--published')`),'Publish a lesson from its menu');
await openRowMenu(added);
await evaluate(pick('Unpublish'));
check(await waitFor(`${rowById(added)}?.querySelector('.cs-status--draft')`),'Unpublish a lesson from its menu');
await openRowMenu(added);
await evaluate(pick('Delete'));
check(await waitFor(`document.querySelector('dialog.toast-confirm[open]')?.textContent.includes('Delete this lesson?')&&document.querySelector('dialog.toast-confirm .toast-confirm__go').textContent==='Delete'`),'Deleting a lesson asks first');
await evaluate(`document.querySelector('dialog.toast-confirm .toast-confirm__go').click()`);
check(await waitFor(`!${rowById(added)}&&document.querySelectorAll('.cs-row').length===${lessonCount}`),'A deleted lesson leaves the list');

// Preview: the lesson reader without the 3D links; closing returns focus.
await evaluate(`${rowById(lessonId)}.querySelector('[data-preview]').click()`);
check(await waitFor(`!document.getElementById('lessonPreview').hidden&&document.querySelector('#lessonPreview .sd-reader-title')?.textContent==='PDF lesson'`),'Row Preview opens the lesson in the reader');
check(await evaluate(`!/View in 3D|Practice in 3D/.test(document.getElementById('lessonPreview').textContent)`),'The teacher preview has no 3D links');
check(await waitFor(`document.querySelector('#lessonPreview .pv canvas[data-rendered]')`),'A PDF lesson previews in the viewer');
await key('Escape');
check(await waitFor(`document.getElementById('lessonPreview').hidden&&document.activeElement===${rowById(lessonId)}.querySelector('[data-preview]')`),'Closing the preview returns focus to its button');
const firstPublished=(await moduleRow()).lessons.find(l=>l.status==='published');
await evaluate(`document.querySelector('.cs-hero [data-preview-module]').click()`);
check(await waitFor(`!document.getElementById('lessonPreview').hidden&&document.querySelector('#lessonPreview .sd-reader-title')?.textContent===${JSON.stringify(firstPublished.title)}`),'Preview as student opens the first published lesson');
await key('Escape');
check(await waitFor(`document.getElementById('lessonPreview').hidden`),'Escape closes the preview');

// Hero actions: Unpublish and Publish the module; Edit details opens the module sheet.
await evaluate(`document.querySelector('.cs-hero [data-module-status]').click()`);
check(await waitFor(`document.querySelector('.cs-hero .cs-status--draft')&&document.querySelector('.cs-hero [data-module-status]').textContent.trim()==='Publish'`),'Unpublish from the hero');
await evaluate(`document.querySelector('.cs-hero [data-module-status]').click()`);
check(await waitFor(`document.querySelector('.cs-hero .cs-status--published')&&document.querySelector('.cs-hero [data-module-status]').textContent.trim()==='Unpublish'`),'Publish from the hero');
await evaluate(`(()=>{const b=document.querySelector('.cs-hero [data-edit-module]');b.focus();b.click();})()`);
check(await waitFor(`document.querySelector('.cs-sheet [name="title"]')?.value==='Test module'`),'Edit details opens the module sheet');
await evaluate(`document.querySelector('.cs-sheet [data-sheet-close]').click()`);
check(await waitFor(`!document.querySelector('.cs-sheet')&&document.activeElement===document.querySelector('.cs-hero [data-edit-module]')`),'Closing the sheet returns focus to Edit details');
check(await evaluate(`typeof openLessonSheet==='function'&&document.querySelectorAll('#workspaceView [data-add-lesson]').length===2`),'Add lesson sits in the panel header and as the last row');

// History: Open from a filtered grid; Back returns to the same grid, Forward reopens the module.
await navigate('/teacher/modules.html');
check(await waitFor(`document.querySelectorAll('.cs-mod').length>0&&${gridShown}`),'The grid shows without a module in the URL');
await evaluate(`(()=>{const i=document.querySelector('.cs-search input');i.value='Test module';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
check(await waitFor(`document.querySelectorAll('.cs-mod').length===1`),'Search narrows the grid to the test module');
await evaluate(`${card}.querySelector('.cs-mod-foot a').click()`);
check(await waitFor(`document.querySelector('.cs-hero h2')?.textContent==='Test module'&&location.search==='?module=${moduleId}'&&!(${gridShown})`),'Open shows the workspace and updates the URL');
check(await evaluate(`document.activeElement===document.querySelector('.cs-hero h2')`),'Focus moves to the module title');
await evaluate(`history.back()`);
check(await waitFor(`document.querySelectorAll('.cs-mod').length>0&&${gridShown}&&!document.querySelector('.cs-hero')`),'Back returns to the grid');
check(await evaluate(`location.search===''&&document.querySelector('.cs-search input').value==='Test module'&&document.querySelectorAll('.cs-mod').length===1`),'Back keeps the grid filters');
check(await evaluate(`document.activeElement===${card}.querySelector('.cs-mod-foot a')`),'Focus returns to the module card');
await evaluate(`history.forward()`);
check(await waitFor(`document.querySelector('.cs-hero h2')?.textContent==='Test module'&&!(${gridShown})`),'Forward reopens the workspace');
await evaluate(`document.querySelector('#workspaceView .cs-crumb').click()`);
check(await waitFor(`location.search===''&&${gridShown}&&!document.querySelector('.cs-hero')`),'All modules returns to the grid');
await navigate('/teacher/modules.html?module_id='+moduleId);
check(await waitFor(`document.querySelector('.cs-hero h2')?.textContent==='Test module'`),'The explorer link (?module_id=) opens the workspace');

// Phone width: panels stack, rows fit with their actions showing, no sideways scroll; Preview opens the reader.
await call('Emulation.setDeviceMetricsOverride',{width:390,height:800,deviceScaleFactor:2,mobile:true});
await navigate('/teacher/modules.html?module='+moduleId);
check(await waitFor(`document.querySelectorAll('.cs-row').length===${lessonCount}&&document.querySelector('[data-materials] .cs-file')`),'Workspace renders at 390px');
check(await evaluate(`document.documentElement.scrollWidth<=390`),'No horizontal scroll in the workspace at 390px');
check(await evaluate(`(()=>{const l=document.querySelector('.cs-lessons').getBoundingClientRect(),s=document.querySelector('.cs-side').getBoundingClientRect();return s.top>=l.bottom&&Math.abs(s.left-l.left)<1;})()`),'Panels stack at 390px');
check(await evaluate(`[...document.querySelectorAll('.cs-row')].every(row=>[...row.children].filter(c=>c.offsetParent).every(c=>${inside('row','c')}))`),'Row contents fit at 390px');
check(await evaluate(`[...document.querySelectorAll('.cs-row-actions')].every(a=>getComputedStyle(a).opacity==='1')`),'Row actions show without hover at 390px');
check(await evaluate(`[...document.querySelectorAll('.cs-hero-row > *, .cs-panel-head > *, .cs-file > *, .cs-quiz > *')].filter(el=>el.getClientRects().length).every(el=>${inside(`el.closest('.cs-hero, .cs-panel')`,'el')})`),'Hero, panel headers, materials and quizzes fit at 390px');
await evaluate(`document.querySelector('.cs-hero [data-preview-module]').click()`);
check(await waitFor(`!document.getElementById('lessonPreview').hidden&&document.querySelector('#lessonPreview .sd-reader-doc')`),'Preview opens the reader at 390px');
check(await evaluate(`!/View in 3D/.test(document.getElementById('lessonPreview').textContent)`),'No View in 3D in the teacher preview at 390px');
await key('Escape');
await call('Emulation.clearDeviceMetricsOverride');

// ── Student ─────────────────────────────────────────────────────
await signIn('fixture-student',studentPassword,'/student/');
await navigate('/student/lessons.html');
await evaluate(`StudyClock.reading=()=>{window.__reads=(window.__reads||0)+1}`);
await evaluate(`startLesson(${lessonId})`);
check(await waitFor(`document.querySelector('.sd-reader .pv canvas[data-rendered]')`),'Lesson PDF renders inline');
// A PDF lesson reads on the wider page, and at a tablet width the toolbar shortens the name instead of wrapping its buttons.
const pdfBarOneRow=`(()=>{const tops=[...document.querySelectorAll('.sd-reader .pv-bar > *')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return r.top+r.height/2;});return Math.max(...tops)-Math.min(...tops)<4;})()`;
check(await evaluate(`!!document.querySelector('.sd-reader .sd-reader-doc--pdf')&&${pdfBarOneRow}`),'A PDF lesson uses the wide page and a one-row toolbar');
await call('Emulation.setDeviceMetricsOverride',{width:820,height:900,deviceScaleFactor:1,mobile:false});
check(await waitFor(pdfBarOneRow),'The PDF toolbar stays on one row at 820px');
await call('Emulation.clearDeviceMetricsOverride');
check(await evaluate(`window.__reads>=1`),'Opening a PDF lesson counts as study time');
check(await evaluate(`(async()=>{const before=window.__reads;const d=document.createElement('div');document.body.append(d);const v=await PdfViewer.mount(d,{url:API_BASE+'/files.php?id=${fileId}',title:'Count'});const ok=window.__reads>before;v.destroy();d.remove();return ok;})()`),'Mounting the inline viewer counts as study time');
check(await evaluate(`!document.querySelector('.sd-reader iframe')`),'No iframe left in the reader');
check(await evaluate(`document.querySelector('.sd-reader .pv-pages').textContent.includes('of ')`),'Inline viewer shows the page count');
await evaluate(`document.querySelector('.sd-reader .pv [aria-label="Full screen"]').click()`);
check(await waitFor(`document.querySelector('.pv-overlay .pv-stage canvas[data-rendered]')`),'Full screen opens from the inline viewer');
await key('Escape');
check(await waitFor(`!document.querySelector('.pv-overlay')`),'Escape closes full screen');
check(await evaluate(`!document.getElementById('lessonContentViewer').hidden`),'Escape in full screen leaves the reader open');
await evaluate(`closeLessonViewer()`);
check(await evaluate(`(()=>{document.addEventListener('click',e=>{if(e.target.closest('[data-reading]'))e.preventDefault();},true);const r=document.getElementById('lessonContentViewer');LessonReader.show(r,{lesson_id:1,title:'Slides',media_url:'deck.pptx',system_code:'MUS',content_text:'x'});const before=window.__reads;r.querySelector('[data-reading]').click();const ok=window.__reads===before+1;LessonReader.close(r);return ok;})()`),'A lesson attachment link counts as study time');
// Materials open in the viewer, not a tab.
await evaluate(`viewModule(${moduleId})`);
check(await waitFor(`document.querySelector('#lessonModalBody .sd-materials-title')`),'Student sees the module materials');
check(await evaluate(`!document.querySelector('#lessonModalBody a[target=_blank]')`),'Material PDFs do not open a new tab');
await evaluate(`[...document.querySelectorAll('#lessonModalBody .sd-lesson')].find(e=>/Long reader/.test(e.textContent)).click()`);
check(await waitFor(`document.querySelector('.pv-overlay .pv-stage canvas[data-rendered]')`),'Material opens in the viewer');
check(await evaluate(`document.querySelector('.pv-overlay .pv-context').textContent===document.getElementById('lessonModalTitle').textContent+' · Materials'`),'The student material viewer names the module');
check(await evaluate(`window.__reads>=4`),'Opening a material counts as study time');
check(await waitFor(`document.querySelectorAll('.pv-stage [data-page]').length===60`),'Student sees all 60 pages');
await key('Escape');
check(await waitFor(`!document.querySelector('.pv-overlay')`),'Escape closes the material viewer');

// A title that tries to break out of an attribute stays inert text.
await signIn(credentials.username,credentials.password,'/teacher/');
const evil=await upload('files.php',{kind:'material',module_id:moduleId,title:'x" data-pwned="1'},'sample.pdf','file','evil.pdf');
check(evil.success,'Upload a material with a quote in its title');
await signIn('fixture-student',studentPassword,'/student/');
await navigate('/student/lessons.html');
await evaluate(`viewModule(${moduleId})`);
check(await waitFor(`document.querySelectorAll('#lessonModalBody [data-material]').length>=2`),'Student sees the quoted-title material');
check(await evaluate(`!document.querySelector('[data-pwned]')&&[...document.querySelectorAll('#lessonModalBody [data-material]')].some(e=>e.dataset.title==='x" data-pwned="1')`),'A quote in a title cannot add an attribute');

// Announcement titles are never put into inline handlers.
await signIn(credentials.username,credentials.password,'/teacher/');
const hostile="Don't miss');window.__pwned=1;//";
await navigate('/teacher/announcements.html');
const made=await evaluate(`fetch(API_BASE+'/announcements.php',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:${JSON.stringify(hostile)},body:'Body',audience:'all'})}).then(r=>r.json())`);
check(made.success,'Create an announcement with an apostrophe title');
await navigate('/teacher/announcements.html');
const deleteButton=`document.querySelector('[onclick^="deleteAnnouncement(${made.data.announcement_id})"]')`;
check(await waitFor(deleteButton),'Delete button passes only the id');
await evaluate(deleteButton+'.click()');
check(await waitFor(`document.querySelector('dialog.toast-confirm[open]')?.textContent.includes(${JSON.stringify(hostile)})`),'Delete asks in the in-app dialog with the full title');
await evaluate(`document.querySelector('dialog.toast-confirm[open] .toast-confirm__stay').click()`);
check(await waitFor(`!document.querySelector('dialog.toast-confirm')`)&&await evaluate(deleteButton+'!==null'),'Keep closes the dialog and the announcement stays');
check(await evaluate('window.__pwned===undefined'),'The title did not run as script');

// ── Student password reset asks in the page, not with prompt() ──
const someStudent=(await evaluate(`fetch(API_BASE+'/students.php',{credentials:'same-origin'}).then(r=>r.json())`)).data?.students?.[0];
check(someStudent?.user_id,'A student exists for the password reset check');
await navigate('/teacher/students.html');
await evaluate(`viewStudentDetails(${Number(someStudent.user_id)})`);
check(await waitFor(`[...document.querySelectorAll('#studentDetailModal button')].some(b=>/reset student password/i.test(b.textContent))`),'Student profile offers a password reset');
await evaluate(`[...document.querySelectorAll('#studentDetailModal button')].find(b=>/reset student password/i.test(b.textContent)).click()`);
check(await waitFor(`document.querySelector('dialog.toast-confirm[open] input[type=password][autocomplete=new-password]')`),'Reset opens an in-app password field');
check(await evaluate(`document.activeElement===document.querySelector('dialog.toast-confirm[open] input')`),'The password field has focus');
await evaluate(`(()=>{const d=document.querySelector('dialog.toast-confirm[open]');d.querySelector('input').value='short';d.querySelector('.toast-confirm__go').click();})()`);
check(await waitFor(`document.querySelector('dialog.toast-confirm[open] .toast-confirm__error:not([hidden])')?.textContent==='Use at least 8 characters.'`),'A short password is refused in the dialog');
check(await evaluate(`document.querySelector('dialog.toast-confirm[open] input').getAttribute('aria-invalid')==='true'`),'The field is marked invalid');
await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
check(await waitFor(`!document.querySelector('dialog.toast-confirm')`),'Escape cancels the reset without sending anything');
await evaluate(`document.getElementById('detailToggleStatusBtn').click()`);
check(await waitFor(`/(Deactivate|Reactivate) this account\\?/.test(document.querySelector('dialog.toast-confirm[open]')?.textContent||'')`),'Account status change asks in the in-app dialog');
await evaluate(`document.querySelector('dialog.toast-confirm[open] .toast-confirm__stay').click()`);
check(await waitFor(`!document.querySelector('dialog.toast-confirm')`),'Cancel leaves the account as it was');

// ── Lesson editor sheet ─────────────────────────────────────────
await call('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
await navigate('/teacher/modules.html?module='+moduleId);
check(await waitFor(`document.querySelector('#workspaceView [data-add-lesson]')`),'Workspace is open for the lesson editor');
check(await evaluate(`!document.getElementById('addLessonModal')&&!/Lesson added successfully/.test(document.documentElement.innerHTML)`),'The old Add lesson modal is gone');
const sheetSet=(sel,v)=>evaluate(`(()=>{const el=document.querySelector('.cs-sheet ${sel}');el.value=${JSON.stringify(v)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
async function attachFile(file){
    const doc=await call('DOM.getDocument',{depth:1});
    const node=await call('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'.cs-sheet input[type="file"]'});
    await call('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[path.resolve('tests/fixtures/'+file)]});
}
await evaluate(`document.querySelector('#workspaceView [data-add-lesson]').click()`);
check(await waitFor(`document.querySelector('.cs-sheet[role="dialog"]')`),'Add lesson opens the sheet');
check(await evaluate(`document.querySelector('.cs-sheet h3').textContent==='New lesson'`),'The sheet is titled New lesson');
check(await evaluate(`[...document.querySelectorAll('.cs-sheet .cs-type')].map(t=>t.textContent.trim()).join('|')==='Reading|Video|3D model|Interactive|Quiz prep'`),'The five type tiles are shown');
check(await evaluate(`document.querySelectorAll('.cs-sheet [name="lesson_type"]').length===5&&document.querySelector('.cs-sheet [name="lesson_type"]:checked').value==='reading'`),'Reading is the default type');
// WCAG contrast of each tile's text over its own background (flattened onto the sheet colour).
const contrast=`(()=>{const nums=c=>c.match(/[\\d.]+/g).map(Number);const lum=([r,g,b])=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
  return [...document.querySelectorAll('.cs-sheet .cs-type')].map(t=>{const base=nums(getComputedStyle(document.querySelector('.cs-sheet')).backgroundColor);const raw=nums(getComputedStyle(t).backgroundColor);const a=raw.length>3?raw[3]:1;const back=[0,1,2].map(i=>raw[i]*a+base[i]*(1-a));const l1=lum(nums(getComputedStyle(t).color)),l2=lum(back);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);});})()`;
check((await evaluate(contrast)).every(r=>r>=4.5),'Type tile text has at least 4.5:1 contrast');
await evaluate(`document.querySelector('.cs-sheet [name="lesson_type"][value="video"]').click()`);
check((await evaluate(contrast)).every(r=>r>=4.5),'Contrast holds with another tile selected');
await evaluate(`document.querySelector('.cs-sheet [name="lesson_type"][value="reading"]').click()`);
// Size guard: a 600 MB file is refused before any upload starts.
await evaluate(`window.__posts=0;const realFetch=window.fetch;window.fetch=(...a)=>{if(a[1]&&a[1].method==='POST')window.__posts++;return realFetch(...a);};`);
await evaluate(`(()=>{const input=document.querySelector('.cs-sheet input[type="file"]');const big=new File([new Blob(['x'])],'big.mp4',{type:'video/mp4'});Object.defineProperty(big,'size',{value:600*1024*1024});const dt=new DataTransfer();dt.items.add(big);input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
check(await waitFor(`document.querySelector('.cs-sheet').textContent.includes('File too large. Maximum size is 500 MB.')`),'A file over 500 MB is refused');
check(await evaluate(`!document.querySelector('.cs-sheet .cs-attach')&&window.__posts===0`),'The oversize file is not attached and nothing was uploaded');
await sheetSet('[name="title"]','Editor lesson');
await sheetSet('[name="content_text"]','Written in the sheet.');
await sheetSet('[name="duration_mins"]','12');
await attachFile('sample.pdf');
check(await waitFor(`document.querySelector('.cs-sheet .cs-attach')?.textContent.includes('sample.pdf')`),'The attachment card shows the file name');
check(await waitFor(`document.querySelector('.cs-sheet .cs-attach canvas[data-rendered]')&&/\\d+ pages?/.test(document.querySelector('.cs-sheet .cs-attach').textContent)`),'The attachment card shows a thumbnail and the page count');
check(await evaluate(`/\\d+(\\.\\d+)? (KB|MB)/.test(document.querySelector('.cs-sheet .cs-attach').textContent)`),'The attachment card shows the size');
await evaluate(`document.querySelector('.cs-sheet-foot .cs-btn--primary').click()`);
check(await waitFor(`!document.querySelector('.cs-sheet')&&[...document.querySelectorAll('#workspaceView .cs-row-title')].some(t=>t.textContent==='Editor lesson')`),'Saving adds the lesson to the list');
const editorRow=`[...document.querySelectorAll('#workspaceView .cs-row')].find(r=>r.querySelector('.cs-row-title').textContent==='Editor lesson')`;
check(await waitFor(`${editorRow}.querySelector('[data-meta]').textContent.startsWith('PDF')`),'The new row shows kind PDF');
// Reopen: fields are filled in; Escape with a change asks first.
await evaluate(`${editorRow}.querySelector('[data-edit]').click()`);
check(await waitFor(`document.querySelector('.cs-sheet [name="title"]')?.value==='Editor lesson'&&document.querySelector('.cs-sheet [name="content_text"]').value==='Written in the sheet.'`),'Editing fills in the saved lesson text');
check(await evaluate(`document.querySelector('.cs-sheet h3').textContent==='Edit lesson'&&document.querySelector('.cs-sheet [name="duration_mins"]').value==='12'&&document.querySelector('.cs-sheet [name="status"]').checked`),'Editing fills in the title, time and published switch');
check(await evaluate(`document.querySelector('.cs-sheet .cs-sheet-head .cs-eyebrow').textContent.endsWith(' · Lesson '+([...document.querySelectorAll('#workspaceView .cs-row')].indexOf(${editorRow})+1))`),'The edit sheet names the lesson number');
check(await waitFor(`document.querySelector('.cs-sheet .cs-attach canvas[data-rendered]')`),'The saved PDF shows a thumbnail');
const dropOn=selector=>`(()=>{const e=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()});document.querySelector('${selector}').dispatchEvent(e);return e.defaultPrevented;})()`;
check(await evaluate(dropOn('.cs-sheet [name="content_text"]'))&&await evaluate(dropOn('.cs-scrim')),'A file dropped outside the attachment box is not opened by the browser');
await evaluate(`(()=>{const t=document.querySelector('.cs-sheet [name="title"]');t.focus();t.setSelectionRange(t.value.length,t.value.length);})()`);
await call('Input.insertText',{text:' two'});
await key('Escape');
check(await waitFor(`document.querySelector('dialog.toast-confirm[open]')?.textContent.includes('Discard changes?')`),'Escape with unsaved edits asks first');
await evaluate(`document.querySelector('dialog.toast-confirm .toast-confirm__stay').click()`);
check(await waitFor(`!document.querySelector('dialog.toast-confirm')&&document.querySelector('.cs-sheet')`),'Keep editing leaves the sheet open');
await key('Escape');
await waitFor(`document.querySelector('dialog.toast-confirm[open]')`);
await evaluate(`document.querySelector('dialog.toast-confirm .toast-confirm__go').click()`);
check(await waitFor(`!document.querySelector('.cs-sheet')`),'Discard closes the sheet');
check(!await evaluate(dropOn('body')),'Closing the lesson sheet stops blocking drops');
check(await evaluate(`[...document.querySelectorAll('#workspaceView .cs-row-title')].some(t=>t.textContent==='Editor lesson')&&![...document.querySelectorAll('#workspaceView .cs-row-title')].some(t=>t.textContent==='Editor lesson two')`),'Discard keeps the saved title');
// Remove attachment clears the media and the row falls back to the type.
const editorId=await evaluate(`${editorRow}.dataset.lesson`);
await evaluate(`${editorRow}.querySelector('[data-edit]').click()`);
await waitFor(`document.querySelector('.cs-sheet .cs-attach')`);
await evaluate(`document.querySelector('.cs-sheet .cs-attach [aria-label="Remove attachment"]').click()`);
check(await evaluate(`!document.querySelector('.cs-sheet .cs-attach')&&document.querySelector('.cs-sheet .cs-drop')!==null`),'Remove attachment empties the card');
await evaluate(`document.querySelector('.cs-sheet-foot .cs-btn--primary').click()`);
check(await waitFor(`!document.querySelector('.cs-sheet')&&${editorRow}.querySelector('[data-meta]').textContent.startsWith('Reading')`),'Saving after Remove drops the attachment');
check(!(await evaluate(`fetch(API_BASE+'/lessons.php?id=${editorId}',{credentials:'same-origin'}).then(r=>r.json())`)).data.media_url,'The server cleared media_url');
// Replace on a lesson that already has an attachment.
const oldMedia=(await evaluate(`fetch(API_BASE+'/lessons.php?id=${lessonId}',{credentials:'same-origin'}).then(r=>r.json())`)).data.media_url;
await evaluate(`[...document.querySelectorAll('#workspaceView .cs-row')].find(r=>r.dataset.lesson==='${lessonId}').querySelector('[data-edit]').click()`);
check(await waitFor(`document.querySelector('.cs-sheet .cs-attach canvas[data-rendered]')`),'A lesson with an attachment shows the card');
await attachFile('sample.pdf');
check(await waitFor(`document.querySelector('.cs-sheet .cs-attach .cs-meta')?.textContent.includes('replaces the current file')`),'Choosing a file shows it as the replacement');
await evaluate(`document.querySelector('.cs-sheet-foot .cs-btn--primary').click()`);
check(await waitFor(`!document.querySelector('.cs-sheet')`),'Saving a replacement closes the sheet');
const newMedia=(await evaluate(`fetch(API_BASE+'/lessons.php?id=${lessonId}',{credentials:'same-origin'}).then(r=>r.json())`)).data.media_url;
check(newMedia&&newMedia!==oldMedia,'The replacement changed the stored file');
// One save at a time, no closing mid-upload, and a toast instead of a footer note.
const lessonsTitled=title=>evaluate(`fetch(API_BASE+'/lessons.php?module_id=${moduleId}',{credentials:'same-origin'}).then(r=>r.json()).then(j=>j.data.filter(l=>l.title===${JSON.stringify(title)}).length)`);
await evaluate(`document.querySelector('#workspaceView [data-add-lesson]').click()`);
await waitFor(`document.querySelector('.cs-sheet')`);
await sheetSet('[name="title"]','Once only');
await evaluate(`window.__slow=true;const slowFetch=window.fetch;window.fetch=(url,opts)=>String(url).includes('lessons.php')&&opts&&opts.method==='POST'&&window.__slow?new Promise(r=>setTimeout(r,1500)).then(()=>slowFetch(url,opts)):slowFetch(url,opts);`);
await evaluate(`(()=>{const f=document.querySelector('.cs-sheet form');f.requestSubmit();f.requestSubmit();})()`);
check(await waitFor(`document.querySelector('.cs-sheet [type="submit"]').disabled`),'Save is disabled while saving');
await key('Escape');
await new Promise(resolve=>setTimeout(resolve,300));
check(await evaluate(`document.querySelector('.cs-sheet')!==null&&!document.querySelector('dialog.toast-confirm')`),'Escape does not close the sheet mid-save');
check(await evaluate(`document.querySelector('.cs-sheet [data-cancel]').disabled&&document.querySelector('.cs-sheet [data-sheet-close]').disabled`),'Cancel and Close are disabled mid-save');
await evaluate(`document.querySelector('.cs-scrim').click()`);
await new Promise(resolve=>setTimeout(resolve,200));
check(await evaluate(`document.querySelector('.cs-sheet')!==null`),'The scrim does not close the sheet mid-save');
check(await evaluate(`!/Saved/.test(document.querySelector('.cs-sheet-foot').textContent)`),'The footer never says Saved');
check(await waitFor(`!document.querySelector('.cs-sheet')`),'The sheet closes once the save finishes');
check(await waitFor(`[...document.querySelectorAll('.toast')].some(t=>t.textContent==='Lesson added.')`),'A toast says Lesson added.');
check(await waitFor(`[...document.querySelectorAll('#workspaceView .cs-row-title')].some(t=>t.textContent==='Once only')`),'The list is refreshed after the save');
check(await lessonsTitled('Once only')===1,'Submitting twice creates exactly one lesson');
await evaluate(`window.__slow=false`);
check(await evaluate(`document.body.style.overflow!=='hidden'&&![...document.body.children].some(el=>el.inert)`),'The page is usable again after the sheet closes');
// Phone width: the sheet is full screen with no sideways scroll.
await call('Emulation.setDeviceMetricsOverride',{width:390,height:800,deviceScaleFactor:2,mobile:true});
await evaluate(`document.querySelector('#workspaceView [data-add-lesson]').click()`);
check(await waitFor(`document.querySelector('.cs-sheet')&&document.querySelector('.cs-sheet').getAnimations().length===0`),'The sheet opens at 390px');
check(await evaluate(`(()=>{const s=document.querySelector('.cs-sheet').getBoundingClientRect();const b=document.querySelector('.cs-sheet-body');return s.width===innerWidth&&s.height===innerHeight&&b.scrollWidth<=b.clientWidth&&document.documentElement.scrollWidth<=innerWidth;})()`),'The sheet is full screen with no sideways scroll at 390px');
check(await evaluate(`[...document.querySelectorAll('.cs-sheet .cs-type')].every(t=>{const r=t.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&t.scrollWidth<=t.clientWidth;})`),'The type tiles fit at 390px');
await key('Escape');
await call('Emulation.clearDeviceMetricsOverride');

// ── Assessments ─────────────────────────────────────────────────
// Fixtures from the integration suite: "Test quiz" (open, mixed questions, 2 attempts, pass 75%), "Typed" (draft,
// no questions) and "Test quiz (copy)" (draft). Added here: one due tomorrow and one closed in another body system.
await call('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
await navigate('/teacher/assessments.html');
const api=(path,method='GET',body)=>evaluate(`fetch(API_BASE+'/${path}',{method:'${method}',credentials:'same-origin',headers:{'Content-Type':'application/json'}${body?`,body:${JSON.stringify(JSON.stringify(body))}`:''}}).then(r=>r.json())`);
const systemList=(await api('body-systems.php')).data;
const testSystem=systemList.find(s=>s.system_code==='test-system');
let otherSystem=systemList.find(s=>s.system_code!=='test-system');
if(!otherSystem){
  const made=await api('anatomy-content.php','POST',{system_name:'Second System',system_code:'second-system',color_hex:'#654321',description:'Second description',is_active:true,key_facts:{Fact:'Second fact'},structures:[{name:'Second Structure',desc:'Second structure',mesh_name:'second-part'}]});
  check(made.success,'Create a second body system');
  otherSystem={system_id:made.data.system_id,system_name:'Second System',system_code:'second-system'};
}
const pad=n=>String(n).padStart(2,'0');
const dayAfter=new Date(Date.now()+86400000);
const soonQuiz=await api('assessments.php','POST',{title:'Due tomorrow quiz',system_id:testSystem.system_id,status:'active',due_date:`${dayAfter.getFullYear()}-${pad(dayAfter.getMonth()+1)}-${pad(dayAfter.getDate())} 12:00:00`,time_limit_mins:15,passing_score:70,max_attempts:1});
check(soonQuiz.success&&(await api('questions.php','POST',{assessment_id:Number(soonQuiz.data.assessment_id),question_type:'multiple_choice',question_text:'Pick one',points:1,options:[{option_text:'Yes',is_correct:true},{option_text:'No',is_correct:false}]})).success,'Create an assessment due tomorrow');
const closedQuiz=await api('assessments.php','POST',{title:'Closed review',system_id:otherSystem.system_id,status:'closed'});
check(closedQuiz.success&&(await api('questions.php','POST',{assessment_id:Number(closedQuiz.data.assessment_id),question_type:'true_false',question_text:'True?',points:1,options:[{option_text:'True',is_correct:true,sort_order:1},{option_text:'False',is_correct:false,sort_order:2}]})).success,'Create a closed assessment in another body system');
await navigate('/teacher/assessments.html');
const arow=title=>`[...document.querySelectorAll('.cs-arow')].find(r=>r.querySelector('.cs-h3').textContent===${JSON.stringify(title)})`;
const openAssessMenu=async title=>{await evaluate(`${arow(title)}.querySelector('[data-more]').click()`);return waitFor(`document.querySelector('.cs-menu[role="menu"]')`);};
const confirmShows=text=>waitFor(`document.querySelector('dialog.toast-confirm[open]')?.textContent.includes(${JSON.stringify(text)})`);
check(await waitFor(`document.querySelectorAll('.cs-arow').length>0`),'Assessment rows render');
const heads=await evaluate(`[...document.querySelectorAll('.cs-alist .cs-h2')].map(h=>h.textContent)`);
check(heads.join()===['Open now','Drafts','Closed'].filter(h=>heads.includes(h)).join(),'Groups keep the order Open now, Drafts, Closed');
check(heads.join()==='Open now,Drafts,Closed','All three groups show');
check(await evaluate(`!/multiple_choice|diagram|submissions\\b/.test(document.querySelector('.cs-alist').textContent)`),'No raw enum names or "submissions"');
check(await evaluate(`[...document.querySelectorAll('.cs-arow .cs-btn--primary')].length===0`),'No mint buttons inside rows');
check(await evaluate(`!document.querySelector('input[name="assessType"],[data-assessment-type]')`),'No assessment type anywhere on the page');
check(await evaluate(`!/assessment_type|chapter quiz/i.test(document.documentElement.outerHTML)&&!document.querySelector('.chip')&&!/All Types|Hotspot Activity|Labeled Diagram|Multiple Choice Quiz/.test(document.body.textContent)`),'No type field, type filter chips or "Chapter quiz" left');
check(await evaluate(`document.querySelectorAll('.cs-btn--primary').length===1`),'One primary button on the Assessments page');
check(await evaluate(headingsInOrder),'Assessments headings are sequential');
const listed=(await api('assessments.php')).data;
check(JSON.stringify(await evaluate(`['sumOpen','sumDraft','sumClosed','sumAttempts'].map(id=>Number(document.getElementById(id).textContent))`))===JSON.stringify([listed.filter(a=>a.status==='active').length,listed.filter(a=>a.status==='draft'||a.status==='scheduled').length,listed.filter(a=>a.status==='closed').length,listed.reduce((sum,a)=>sum+a.submission_count,0)]),'Summary counts open, drafts, closed and every attempt');
check(await evaluate(`(()=>{const r=${arow('Test quiz')};return r.querySelector('.cs-tile.q-mixed use').getAttribute('href').endsWith('#stack')&&r.querySelector('.cs-eyebrow').textContent==='Test System';})()`),'A mixed assessment shows the stack tile and only its body system');
check(await evaluate(`${arow('Test quiz')}.querySelector('.cs-acopy .cs-meta').textContent==='10 min · pass 75% · 2 tries'`),'Row meta reads time, pass mark and tries');
check(await evaluate(`(()=>{const r=${arow('Test quiz')};return r.querySelector('.cs-qtotal').textContent==='3 questions'&&r.querySelectorAll('.cs-qchip').length===3;})()`),'Question count with one chip per question type');
check(await evaluate(`(()=>{const r=${arow('Test quiz')}.querySelector('.cs-result');return /^2 attempts · avg \\d+%$/.test(r.querySelector('.cs-meta').textContent)&&r.querySelector('.cs-bar--low')!==null;})()`),'Results show attempts, the average and an amber bar below the pass mark');
check(await evaluate(`${arow('Test quiz')}.querySelector('.cs-due b').textContent==='No due date'`),'No due date says so');
check(await evaluate(`(()=>{const r=${arow('Due tomorrow quiz')};return r.querySelector('.cs-due').classList.contains('cs-due--soon')&&r.querySelector('.cs-due b').textContent.endsWith('· tomorrow');})()`),'A due date within 3 days is amber and says tomorrow');
check(await evaluate(`(()=>{const r=${arow('Due tomorrow quiz')};return r.querySelector('.cs-tile.q-multiple_choice')!==null&&r.querySelector('.cs-result').textContent==='No attempts yet'&&r.querySelector('.cs-acopy .cs-meta').textContent==='15 min · pass 70% · 1 try';})()`),'One question type shows its own tile; no attempts says so');
check(await evaluate(`document.querySelector('.cs-agroup .cs-h3').textContent==='Due tomorrow quiz'`),'Open now lists the soonest due first');
check(await evaluate(`(()=>{const r=${arow('Typed')};return r.querySelector('.cs-result').textContent==='Not published'&&r.querySelector('.cs-tile.q-empty')!==null&&r.querySelector('.cs-qtotal').textContent==='No questions yet';})()`),'A draft with no questions reads Not published and No questions yet');
check(await evaluate(`[...document.querySelectorAll('.cs-arow')].every(r=>r.querySelector('.cs-aend .cs-btn').textContent.trim()==='Questions')`),'The row action is always Questions');
// Search and the body-system select narrow the rows.
await evaluate(`(()=>{const s=document.getElementById('assessSystemFilter');s.value=${JSON.stringify(otherSystem.system_code)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
check(await waitFor(`document.querySelectorAll('.cs-arow').length===1&&${arow('Closed review')}!==undefined`),'The body-system select narrows the rows');
check(await evaluate(`[...document.querySelectorAll('.cs-alist .cs-h2')].map(h=>h.textContent).join()==='Closed'`),'Only groups with rows show');
await evaluate(`(()=>{const s=document.getElementById('assessSystemFilter');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await evaluate(`(()=>{const i=document.getElementById('assessSearch');i.value='tomorrow';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
check(await waitFor(`document.querySelectorAll('.cs-arow').length===1&&${arow('Due tomorrow quiz')}!==undefined`),'Search narrows the rows');
await evaluate(`(()=>{const i=document.getElementById('assessSearch');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
check(await waitFor(`document.querySelectorAll('.cs-arow').length===${listed.length}`),'Clearing the filters shows every assessment');
// More menu: Pause asks first, moves the assessment to Drafts and Open brings it back.
await openAssessMenu('Test quiz');
check(JSON.stringify(await evaluate(menuItems))===JSON.stringify(['Pause','Close','Edit settings','Duplicate']),'An open assessment with attempts offers Pause, Close, Edit settings and Duplicate');
await evaluate(pick('Pause'));
check(await confirmShows('Pause this assessment?'),'Pause asks first');
await evaluate(`document.querySelector('dialog.toast-confirm .toast-confirm__stay').click()`);
check(await waitFor(`!document.querySelector('dialog.toast-confirm')`)&&await evaluate(`${arow('Test quiz')}.querySelector('.cs-status--active')!==null`),'Cancel leaves it open');
await openAssessMenu('Test quiz');
await evaluate(pick('Pause'));
await confirmShows('Pause this assessment?');
await evaluate(`document.querySelector('dialog.toast-confirm .toast-confirm__go').click()`);
check(await waitFor(`${arow('Test quiz')}?.querySelector('.cs-status--draft')&&${arow('Test quiz')}.closest('.cs-agroup').querySelector('.cs-h2').textContent==='Drafts'`),'Pause moves it to Drafts');
check(await waitFor(`document.activeElement===${arow('Test quiz')}.querySelector('[data-more]')`),'Focus returns to its more button');
await openAssessMenu('Test quiz');
check((await evaluate(menuItems))[0]==='Open','A draft offers Open first');
await evaluate(pick('Open'));
check(await waitFor(`${arow('Test quiz')}?.querySelector('.cs-status--active')&&${arow('Test quiz')}.closest('.cs-agroup').querySelector('.cs-h2').textContent==='Open now'`),'Open puts it back in Open now');
// Duplicate and Delete ask first; Delete is offered only while nobody has taken it.
await openAssessMenu('Due tomorrow quiz');
await evaluate(pick('Duplicate'));
check(await confirmShows('Duplicate this assessment?'),'Duplicate asks first');
await evaluate(`document.querySelector('dialog.toast-confirm .toast-confirm__go').click()`);
check(await waitFor(`${arow('Due tomorrow quiz (copy)')}?.querySelector('.cs-status--draft')`),'Duplicate adds a draft copy');
await openAssessMenu('Due tomorrow quiz (copy)');
check((await evaluate(menuItems)).at(-1)==='Delete','A draft nobody has taken offers Delete last');
await evaluate(pick('Delete'));
check(await confirmShows('Delete this assessment?'),'Delete asks first');
await evaluate(`document.querySelector('dialog.toast-confirm .toast-confirm__go').click()`);
check(await waitFor(`!${arow('Due tomorrow quiz (copy)')}`),'Delete removes the row');
// Edit settings: the sheet comes filled in; saving updates the row and links a module.
await openAssessMenu('Due tomorrow quiz');
await evaluate(pick('Edit settings'));
check(await waitFor(`document.querySelector('.cs-sheet [name="title"]')?.value==='Due tomorrow quiz'`),'Edit settings opens the sheet filled in');
check(await evaluate(`document.querySelector('.cs-sheet [name="system_id"]').value==='${testSystem.system_id}'&&document.querySelector('.cs-sheet [name="max_attempts"]').value==='1'&&document.querySelector('.cs-sheet [name="due_date"]').value.endsWith('T12:00')`),'The sheet shows the saved body system, tries and due date');
await sheetSet('[name="title"]','Due tomorrow check');
await evaluate(`(()=>{const m=document.querySelector('.cs-sheet [name="module_id"]');m.value='${moduleId}';m.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await evaluate(`document.querySelector('.cs-sheet-foot .cs-btn--primary').click()`);
check(await waitFor(`!document.querySelector('.cs-sheet')&&${arow('Due tomorrow check')}!==undefined`),'Saving settings updates the row');
check(Number((await api('assessments.php')).data.find(a=>a.title==='Due tomorrow check').module_id)===Number(moduleId),'Saving settings links the module');
// A title with quotes stays text: no attribute, no script.
const quoted=await api('assessments.php','POST',{title:`x" data-pwned="1 ');window.__pwned=1;//`,status:'draft'});
check(quoted.success,'Create an assessment with quotes in its title');
await navigate('/teacher/assessments.html');
check(await waitFor(`document.querySelectorAll('.cs-arow').length>0`),'Rows render with a quoted title');
check(await evaluate(`!document.querySelector('[data-pwned]')&&!document.querySelector('.cs-arow [onclick]')&&${arow(`x" data-pwned="1 ');window.__pwned=1;//`)}.querySelector('.cs-eyebrow').textContent==='All body systems'`),'A quoted title stays text and a row with no body system says All body systems');
await evaluate(`${arow(`x" data-pwned="1 ');window.__pwned=1;//`)}.querySelector('.cs-aend .cs-btn').click()`);
check(await waitFor(`document.querySelector('.cs-modal[role="dialog"]')`)&&await evaluate(`window.__pwned===undefined`),'Questions opens the builder without running the title');
check(await evaluate(`!document.querySelector('[data-pwned]')&&document.querySelector('.cs-modal h3').textContent===${JSON.stringify(`x" data-pwned="1 ');window.__pwned=1;//`)}`),'The builder shows a quoted title as text');
await evaluate(`document.querySelector('.cs-modal [data-sheet-close]').click()`);
check(await waitFor(`!document.querySelector('.cs-modal')`),'Close shuts the builder');
check((await api('assessments.php?id='+Number(quoted.data.assessment_id),'DELETE')).success,'Remove the quoted-title assessment');
// New assessment: no type to pick; Create and add questions saves a draft and opens the builder on it.
await navigate('/teacher/assessments.html');
await waitFor(`document.querySelectorAll('.cs-arow').length>0`);
await evaluate(`document.getElementById('newAssessmentBtn').click()`);
check(await waitFor(`document.querySelector('.cs-sheet[role="dialog"]')`),'New assessment opens the sheet');
check(await evaluate(`document.querySelector('.cs-sheet h3').textContent==='New assessment'&&document.activeElement===document.querySelector('.cs-sheet [name="title"]')`),'The sheet is titled New assessment and focus starts on the title');
check(await evaluate(`['title','system_id','module_id','instructions','time_limit_mins','passing_score','max_attempts','due_date'].every(n=>document.querySelector('.cs-sheet [name="'+n+'"]'))`),'The sheet asks for title, body system, module, instructions, time limit, pass mark, tries and due date');
check(await evaluate(`document.querySelector('.cs-sheet').textContent.includes('Any mix of question types')&&document.querySelectorAll('.cs-sheet .cs-qchip').length===4&&!document.querySelector('.cs-sheet input[type="radio"]')`),'The sheet notes any mix of question types and has no type to pick');
check(await evaluate(`document.querySelector('.cs-sheet-foot .cs-btn--primary').textContent.trim()==='Create and add questions'`),'The button reads Create and add questions');
await sheetSet('[name="title"]','Sheet quiz');
await evaluate(`document.querySelector('.cs-sheet-foot .cs-btn--primary').click()`);
check(await waitFor(`!document.querySelector('.cs-sheet')&&document.querySelector('.cs-modal[role="dialog"]')`),'Create and add questions opens the question builder');
check(await waitFor(`document.querySelector('.cs-modal .cs-sheet-body').textContent.includes('No questions yet')&&document.querySelector('.cs-modal h3').textContent==='Sheet quiz'`),'The builder opens on the new, empty assessment');
check(await evaluate(`(()=>{const p=[...document.querySelectorAll('.cs-modal .cs-btn--primary')];return p.length===1&&p[0].textContent.trim()==='Add question'&&!p[0].disabled;})()`),'An empty builder offers Add question');
const sheetQuiz=(await api('assessments.php')).data.find(a=>a.title==='Sheet quiz');
check(sheetQuiz&&sheetQuiz.status==='draft'&&sheetQuiz.question_count===0,'The new assessment is a draft with no questions');
await evaluate(`document.querySelector('.cs-modal [data-sheet-close]').click()`);
check(await waitFor(`${arow('Sheet quiz')}?.closest('.cs-agroup').querySelector('.cs-h2').textContent==='Drafts'`),'The new draft is listed under Drafts');
// Phone width: rows stack into cards, nothing scrolls sideways, the sheet is full screen.
await call('Emulation.setDeviceMetricsOverride',{width:390,height:800,deviceScaleFactor:2,mobile:true});
await navigate('/teacher/assessments.html');
check(await waitFor(`document.querySelectorAll('.cs-arow').length>0`),'Assessment rows render at 390px');
check(await evaluate(`document.documentElement.scrollWidth<=390`),'No horizontal scroll on Assessments at 390px');
check(await evaluate(`[...document.querySelectorAll('.cs-arow')].every(r=>{const c=r.querySelector('.cs-acopy').getBoundingClientRect(),q=r.querySelector('.cs-qmix').getBoundingClientRect(),e=r.querySelector('.cs-aend').getBoundingClientRect();return q.top>=c.bottom-1&&e.top>=q.bottom-1;})`),'Rows stack into cards at 390px');
check(await evaluate(`[...document.querySelectorAll('.cs-arow')].every(row=>[...row.querySelectorAll(':scope > *, .cs-aend > *')].every(el=>${inside('row','el')}))`),'Row contents fit at 390px');
check(await evaluate(`getComputedStyle(document.getElementById('assessSystemFilter').closest('.cs-select')).display!=='none'`),'The body-system select stays at 390px');
await evaluate(`document.getElementById('newAssessmentBtn').click()`);
check(await waitFor(`document.querySelector('.cs-sheet')&&document.querySelector('.cs-sheet').getAnimations().length===0`),'The assessment sheet opens at 390px');
check(await evaluate(`(()=>{const s=document.querySelector('.cs-sheet').getBoundingClientRect();const b=document.querySelector('.cs-sheet-body');return s.width===innerWidth&&b.scrollWidth<=b.clientWidth&&document.documentElement.scrollWidth<=innerWidth;})()`),'The assessment sheet is full screen with no sideways scroll at 390px');
await key('Escape');
await call('Emulation.clearDeviceMetricsOverride');

// ── Question builder ────────────────────────────────────────────
// "Builder quiz": a draft nobody has taken with one question of each type. "Test quiz" has attempts, so it is locked.
await call('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
await navigate('/teacher/assessments.html');
const builderQuiz=await api('assessments.php','POST',{title:'Builder quiz',system_id:testSystem.system_id,status:'draft',time_limit_mins:15,passing_score:70,max_attempts:2});
const bqId=Number(builderQuiz.data?.assessment_id);
const addQuestion=body=>api('questions.php','POST',{assessment_id:bqId,points:1,...body});
const bqMade=[
  await addQuestion({question_type:'multiple_choice',question_text:'Which bone protects the brain?',options:[{option_text:'Sternum',is_correct:false},{option_text:'Pelvis',is_correct:false},{option_text:'Skull',is_correct:true},{option_text:'Scapula',is_correct:false}]}),
  await addQuestion({question_type:'true_false',question_text:'The sternum is part of the appendicular skeleton.',options:[{option_text:'True',is_correct:false,sort_order:1},{option_text:'False',is_correct:true,sort_order:2}]}),
  await addQuestion({question_type:'identification',question_text:'The thigh bone, the longest bone in the body',hotspot_data:{target_label:'Femur'},options:[{option_text:'Femur',is_correct:true}]}),
  await addQuestion({question_type:'hotspot',question_text:'Click the sternum',points:2,hotspot_data:{target_label:'Sternum',image_url:'../assets/img/hero/skeletal.webp',x:.46,y:.58,radius:.07}}),
];
check(builderQuiz.success&&bqMade.every(r=>r.success),'Create an assessment nobody has taken with one question of each type');
await navigate('/teacher/assessments.html');
check(await waitFor(`${arow('Builder quiz')}!==undefined`),'The builder quiz is listed');
check(await evaluate(`!document.getElementById('questionBuilderModal')&&!document.getElementById('addQuestionModal')&&!document.getElementById('addQuestionForm')&&typeof QuestionBuilder==='object'&&typeof openQuestionBuilder==='function'&&typeof openQuestionForm==='function'`),'The old builder and add-question modals are gone');
const qcards=`[...document.querySelectorAll('.cs-modal .cs-q')]`;
const qcard=n=>`${qcards}[${n}]`;
const openQMenu=async n=>{await evaluate(`${qcard(n)}.querySelector('[data-q-more]').click()`);return waitFor(`document.querySelector('.cs-menu[role="menu"]')`);};
// The builder's footer is a .cs-sheet-foot too, so the form's controls are looked up inside .cs-sheet.
const saveForm=()=>evaluate(`document.querySelector('.cs-sheet .cs-sheet-foot .cs-btn--primary').click()`);
const clickPicture=(fx,fy)=>evaluate(`(()=>{const i=document.querySelector('.cs-sheet .cs-hs-pick img'),r=i.getBoundingClientRect();i.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width*${fx},clientY:r.top+r.height*${fy}}));})()`);
const pictureLoaded=scope=>`(()=>{const i=document.querySelector('${scope} img');return Boolean(i&&i.complete&&i.naturalWidth>0);})()`;
await evaluate(`${arow('Builder quiz')}.querySelector('[data-questions]').click()`);
check(await waitFor(`document.querySelector('.cs-modal[role="dialog"]')&&${qcards}.length===4`),'Questions opens the builder with every question');
check(await evaluate(`document.activeElement.closest('.cs-modal')!==null`),'Focus moves into the builder');
check(await evaluate(`document.querySelector('.cs-modal .cs-sheet-head .cs-eyebrow').textContent==='Test System'&&document.querySelector('.cs-modal h3').textContent==='Builder quiz'`),'The header shows the body system and the title');
check(JSON.stringify(await evaluate(`[...document.querySelectorAll('.cs-modal .cs-qhead > div')].map(d=>[d.querySelector('.cs-meta').textContent,d.querySelector('b').textContent])`))===JSON.stringify([['Questions','4'],['Points','5'],['Time','15 min'],['Pass mark','70%'],['Status','Draft']]),'The header shows questions, points, time, pass mark and status');
check(await evaluate(`!document.querySelector('.cs-modal .cs-lock')`),'An assessment nobody has taken is not locked');
check(JSON.stringify(await evaluate(`${qcards}.map(q=>q.querySelector('.cs-qtype').textContent.trim())`))===JSON.stringify(['Multiple choice','True or false','Identification','Hotspot']),'Each question shows its type label');
check(await evaluate(`${qcards}.map(q=>q.querySelector('.cs-qtype use').getAttribute('href').split('#')[1]).join()==='list-checks,toggle-left,textbox,crosshair'`),'Each type label has its icon');
check(await evaluate(`!/multiple_choice|true_false|\\bidentification\\b|\\bhotspot\\b|\\[Correct\\]|Type:/.test(document.querySelector('.cs-modal').textContent)`),'No raw type names and no [Correct]');
check(await evaluate(`(()=>{const q=${qcard(0)},ok=q.querySelectorAll('.cs-opt.ok');return q.querySelectorAll('.cs-opt').length===4&&ok.length===1&&ok[0].textContent.includes('Skull')&&ok[0].textContent.includes('Correct')&&ok[0].querySelector('use').getAttribute('href').endsWith('#check-circle');})()`),'Multiple choice shows every option with the correct one marked');
check(await evaluate(`(()=>{const q=${qcard(1)};return q.querySelectorAll('.cs-opt').length===2&&q.querySelectorAll('.cs-opt.ok').length===1&&q.querySelector('.cs-opt.ok').textContent.startsWith('False');})()`),'True or false marks the correct value');
check(await evaluate(`${qcard(2)}.querySelector('.cs-answer').textContent.includes('Answer: Femur')`),'Identification shows Answer: Femur');
check(await waitFor(pictureLoaded('.cs-modal .cs-q:nth-child(4) .cs-hs')),'The hotspot picture loads');
check(await evaluate(`(()=>{const q=${qcard(3)},f=q.querySelector('.cs-hs figure').getBoundingClientRect(),b=q.querySelector('.cs-hs figure b').getBoundingClientRect();const cx=(b.left+b.width/2-f.left)/f.width,cy=(b.top+b.height/2-f.top)/f.height;return Math.abs(b.width/f.width-.14)<.01&&Math.abs(cx-.46)<.01&&Math.abs(cy-.58)<.01;})()`),'The hotspot ring sits on the target, twice the tolerance across');
check(await evaluate(`${qcard(3)}.textContent.includes('Target: Sternum')&&${qcard(3)}.textContent.includes('Tolerance 7% of the picture')`),'The hotspot names its target and tolerance');
check(await evaluate(`${qcards}.map(q=>q.querySelector('.cs-q-top .cs-meta').textContent).join()==='1 point,1 point,1 point,2 points'`),'Each question shows its points');
check(await evaluate(headingsInOrder),'Headings stay sequential with the builder open');
check(await evaluate(`(()=>{const p=[...document.querySelectorAll('.cs-modal .cs-btn--primary')];return p.length===1&&p[0].textContent.trim()==='Add question'&&!p[0].disabled;})()`),'One primary button in the builder: Add question');
// Edit: the form opens over the builder, filled in; Escape closes only the form.
await openQMenu(0);
check(JSON.stringify(await evaluate(menuItems))===JSON.stringify(['Edit','Duplicate','Delete']),'A question menu offers Edit, Duplicate and Delete');
await evaluate(pick('Edit'));
check(await waitFor(`document.querySelector('.cs-sheet h3')?.textContent==='Edit question'`),'Edit opens the question form');
check(await evaluate(`(()=>{const f=document.querySelector('.cs-sheet form');return f.elements.question_text.value==='Which bone protects the brain?'&&f.querySelector('[name="question_type"]:checked').value==='multiple_choice'&&[...f.querySelectorAll('[name="choice"]')].slice(0,4).map(i=>i.value).join()==='Sternum,Pelvis,Skull,Scapula'&&f.querySelector('[name="correct"]:checked').value==='2'&&f.elements.points.value==='1';})()`),'The form is filled in with the question, its options and the correct one');
check(await evaluate(`document.querySelector('.cs-modal')?.inert===true`),'The builder waits behind the form');
await key('Escape');
check(await waitFor(`!document.querySelector('.cs-sheet')&&document.querySelector('.cs-modal')&&!document.querySelector('.cs-modal').inert`),'Escape closes only the form');
check(await waitFor(`document.activeElement===${qcard(0)}.querySelector('[data-q-more]')`),'Focus returns to the question menu button');
await openQMenu(0);
await evaluate(pick('Edit'));
await waitFor(`document.querySelector('.cs-sheet form')`);
await sheetSet('[name="question_text"]','Which bone protects the brain and eyes?');
await saveForm();
check(await waitFor(`!document.querySelector('.cs-sheet')&&${qcard(0)}?.querySelector('.cs-q-text').textContent==='Which bone protects the brain and eyes?'`),'Saving an edit updates the card');
check(await waitFor(`[...document.querySelectorAll('.toast')].some(t=>t.textContent==='Question saved.')`),'A toast says Question saved.');
check(await evaluate(`${qcards}.length===4&&${qcard(0)}.querySelector('.cs-opt.ok').textContent.includes('Skull')`),'The edit keeps the options and the correct answer');
check((await api('questions.php?assessment_id='+bqId)).data[0].question_text==='Which bone protects the brain and eyes?','The edit is saved');
check(await waitFor(`document.activeElement===${qcard(0)}.querySelector('[data-q-more]')`),'Focus returns to the edited question');
// Hotspot editor: picture, click to set the target, tolerance.
await openQMenu(3);
await evaluate(pick('Edit'));
check(await waitFor(`document.querySelector('.cs-sheet [name="image_url"]')?.value==='../assets/img/hero/skeletal.webp'`),'Editing a hotspot fills in its picture address');
check(await evaluate(`(()=>{const f=document.querySelector('.cs-sheet form');return f.querySelector('[name="question_type"]:checked').value==='hotspot'&&f.elements.target_label.value==='Sternum'&&f.elements.target_x.value==='46'&&f.elements.target_y.value==='58'&&f.elements.tolerance.value==='7'&&f.elements.points.value==='2';})()`),'The hotspot form shows the target, where it is and the tolerance');
check(await waitFor(`${pictureLoaded('.cs-sheet .cs-hs-pick')}&&document.querySelector('.cs-sheet .cs-hs-pick b')!==null`),'The form shows the picture with the target ring');
await clickPicture(.25,.75);
check(await evaluate(`(()=>{const f=document.querySelector('.cs-sheet form');return Math.abs(f.elements.target_x.value-25)<1&&Math.abs(f.elements.target_y.value-75)<1&&document.querySelector('.cs-sheet .cs-hs-pick b').style.left.startsWith('25');})()`),'Clicking the picture moves the target');
await saveForm();
check(await waitFor(`!document.querySelector('.cs-sheet')&&${qcard(3)}?.querySelector('.cs-hs figure b').style.left.startsWith('25')`),'Saving moves the ring on the card');
const savedHotspot=(await api('questions.php?assessment_id='+bqId)).data[3].hotspot_data;
check(Math.abs(savedHotspot.x-.25)<.01&&Math.abs(savedHotspot.y-.75)<.01&&Math.abs(savedHotspot.radius-.07)<.001&&savedHotspot.target_label==='Sternum','The new target is saved');
// Duplicate and Delete ask first.
await openQMenu(1);
await evaluate(pick('Duplicate'));
check(await confirmShows('Duplicate this question?'),'Duplicating a question asks first');
await evaluate(`document.querySelector('dialog.toast-confirm .toast-confirm__go').click()`);
check(await waitFor(`${qcards}.length===5&&${qcard(4)}.querySelector('.cs-q-text').textContent==='The sternum is part of the appendicular skeleton.'&&${qcard(4)}.querySelector('.cs-opt.ok').textContent.startsWith('False')`),'Duplicate adds a copy at the end');
await openQMenu(4);
await evaluate(pick('Delete'));
check(await waitFor(`document.querySelector('dialog.toast-confirm[open]')?.textContent.includes('Delete this question?')&&document.querySelector('dialog.toast-confirm .toast-confirm__go').textContent==='Delete'`),'Deleting a question asks first');
await evaluate(`document.querySelector('dialog.toast-confirm .toast-confirm__stay').click()`);
check(await waitFor(`!document.querySelector('dialog.toast-confirm')`)&&await evaluate(`${qcards}.length===5`),'Cancel keeps the question');
await openQMenu(4);
await evaluate(pick('Delete'));
await confirmShows('Delete this question?');
await evaluate(`document.querySelector('dialog.toast-confirm .toast-confirm__go').click()`);
check(await waitFor(`${qcards}.length===4`),'Delete removes the question');
check((await api('questions.php?assessment_id='+bqId)).data.length===4,'The question is deleted');
// Add a hotspot through the form.
await evaluate(`document.querySelector('.cs-modal .cs-btn--primary').click()`);
check(await waitFor(`document.querySelector('.cs-sheet h3')?.textContent==='New question'`),'Add question opens an empty form');
check(await evaluate(`[...document.querySelectorAll('.cs-sheet .cs-type')].map(t=>t.textContent.trim()).join('|')==='Multiple choice|True or false|Identification|Hotspot'&&document.querySelector('.cs-sheet [name="question_type"]:checked').value==='multiple_choice'`),'The form offers the four question types, multiple choice first');
await evaluate(`document.querySelector('.cs-sheet [name="question_type"][value="hotspot"]').click()`);
check(await evaluate(`!document.querySelector('.cs-sheet [data-for="hotspot"]').hidden&&document.querySelector('.cs-sheet [data-for="multiple_choice"]').hidden`),'Picking Hotspot shows the picture fields');
await sheetSet('[name="question_text"]','Click the skull');
await sheetSet('[name="target_label"]','Skull');
await evaluate(`(()=>{const i=document.querySelector('.cs-sheet [name="image_url"]');i.value='../assets/img/hero/skeletal.webp';i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
check(await waitFor(pictureLoaded('.cs-sheet .cs-hs-pick')),'The picture previews from its address');
await saveForm();
check(await waitFor(`document.querySelector('.cs-sheet .cs-sheet-foot .is-error')?.textContent==='Click the picture to set the target.'`),'Saving without a target asks for one');
await clickPicture(.5,.15);
await sheetSet('[name="tolerance"]','5');
await saveForm();
check(await waitFor(`!document.querySelector('.cs-sheet')&&${qcards}.length===5&&${qcard(4)}.querySelector('.cs-qtype').textContent.trim()==='Hotspot'&&${qcard(4)}.textContent.includes('Target: Skull')&&${qcard(4)}.textContent.includes('Tolerance 5% of the picture')`),'A hotspot added in the form shows on its card');
check(await waitFor(`[...document.querySelectorAll('.toast')].some(t=>t.textContent==='Question added.')`),'A toast says Question added.');
await evaluate(`document.querySelector('.cs-modal [data-sheet-close]').click()`);
check(await waitFor(`!document.querySelector('.cs-modal')&&${arow('Builder quiz')}?.querySelector('.cs-qtotal').textContent==='5 questions'`),'Closing the builder shows the new count on the row');
check(await waitFor(`document.activeElement===${arow('Builder quiz')}.querySelector('[data-questions]')`),'Focus returns to the row Questions button');
// Locked: Test quiz has attempts.
await evaluate(`${arow('Test quiz')}.querySelector('[data-questions]').click()`);
check(await waitFor(`document.querySelector('.cs-modal .cs-lock')&&${qcards}.length===3`),'An assessment with attempts opens locked');
check(await evaluate(`document.querySelector('.cs-modal .cs-lock').textContent.includes('its questions are locked to keep past results fair')&&document.querySelector('.cs-modal .cs-lock button').textContent.trim()==='Duplicate to edit'`),'The lock note explains and offers Duplicate to edit');
check(await evaluate(`!document.querySelector('.cs-modal [data-q-more]')&&![...document.querySelectorAll('.cs-modal button')].some(b=>/^(Edit|Delete)$/.test(b.textContent.trim()))`),'Locked questions offer no Edit or Delete');
check(await evaluate(`document.querySelector('.cs-modal .cs-sheet-foot .cs-btn--primary').disabled`),'Add question is unavailable while locked');
check(await evaluate(`(()=>{const t=document.querySelector('.cs-modal').textContent;return t.includes('Answer: SecretTerm')&&t.includes('Tolerance 5% of the picture')&&document.querySelector('.cs-modal .cs-opt.ok').textContent.includes('Correct fixture option');})()`),'Locked questions still show their answers');
check(await waitFor(`document.querySelector('.cs-modal .cs-hs figure.is-missing b')`),'A picture that does not load still shows the target ring');
check(await evaluate(`document.querySelector('.cs-modal .cs-qhead').textContent.includes('Open')`),'The header says Open');
const idsBefore=(await api('assessments.php')).data.map(a=>a.assessment_id);
await evaluate(`document.querySelector('.cs-modal .cs-lock button').click()`);
check(await waitFor(`document.querySelector('.cs-modal h3')?.textContent==='Test quiz (copy)'&&!document.querySelector('.cs-modal .cs-lock')&&${qcards}.length===3`),'Duplicate to edit opens the builder on the copy');
const lockedCopies=(await api('assessments.php')).data.filter(a=>!idsBefore.includes(a.assessment_id));
check(lockedCopies.length===1&&lockedCopies[0].title==='Test quiz (copy)'&&lockedCopies[0].status==='draft'&&lockedCopies[0].question_count===3&&lockedCopies[0].submission_count===0,'The copy is a new draft with every question and no attempts');
check(await evaluate(`document.querySelectorAll('.cs-modal [data-q-more]').length===3&&!document.querySelector('.cs-modal .cs-sheet-foot .cs-btn--primary').disabled&&document.querySelector('.cs-modal .cs-qhead').textContent.includes('Draft')&&document.querySelector('.cs-modal .cs-sheet-head .cs-eyebrow').textContent==='Test System'`),'The copy can be edited');
await key('Escape');
check(await waitFor(`!document.querySelector('.cs-modal')&&document.querySelector('.cs-arow[data-id="${lockedCopies[0].assessment_id}"]')?.closest('.cs-agroup').querySelector('.cs-h2').textContent==='Drafts'`),'The copy is listed under Drafts');
// Phone width: the builder and the form are full screen and nothing scrolls sideways.
await call('Emulation.setDeviceMetricsOverride',{width:390,height:800,deviceScaleFactor:2,mobile:true});
await navigate('/teacher/assessments.html');
await waitFor(`${arow('Builder quiz')}!==undefined`);
await evaluate(`${arow('Builder quiz')}.querySelector('[data-questions]').click()`);
check(await waitFor(`${qcards}.length===5`),'The builder opens at 390px');
const builderFits=`(()=>{const m=document.querySelector('.cs-modal').getBoundingClientRect(),b=document.querySelector('.cs-modal .cs-sheet-body');return m.width===innerWidth&&m.height===innerHeight&&b.scrollWidth<=b.clientWidth&&document.documentElement.scrollWidth<=innerWidth;})()`;
const cardsFit=`${qcards}.every(q=>[...q.querySelectorAll('.cs-q-top > *, .cs-q-text, .cs-opt, .cs-hs, .cs-hs > *, .cs-answer')].every(el=>${inside('q','el')}))`;
const chromeFits=`[...document.querySelectorAll('.cs-modal .cs-qhead > div, .cs-modal .cs-lock > *, .cs-modal .cs-sheet-foot > *')].every(el=>${inside(`el.closest('.cs-modal')`,'el')})`;
check(await evaluate(builderFits),'The builder is full screen with no sideways scroll at 390px');
check(await waitFor(pictureLoaded('.cs-modal .cs-q:nth-child(4) .cs-hs'))&&await evaluate(cardsFit),'Question cards fit at 390px');
check(await evaluate(chromeFits),'The builder header and footer fit at 390px');
await openQMenu(0);
await evaluate(pick('Edit'));
check(await waitFor(`document.querySelector('.cs-sheet form')&&document.querySelector('.cs-sheet').getAnimations().length===0`),'The question form opens at 390px');
check(await evaluate(`(()=>{const s=document.querySelector('.cs-sheet').getBoundingClientRect(),b=document.querySelector('.cs-sheet .cs-sheet-body');return s.width===innerWidth&&b.scrollWidth<=b.clientWidth;})()`),'The question form is full screen with no sideways scroll at 390px');
check(await evaluate(`[...document.querySelectorAll('.cs-sheet .cs-type')].every(t=>{const r=t.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&t.scrollWidth<=t.clientWidth;})`),'The question type tiles fit at 390px');
await key('Escape');
await waitFor(`!document.querySelector('.cs-sheet')`);
await key('Escape');
await waitFor(`!document.querySelector('.cs-modal')`);
await evaluate(`${arow('Test quiz')}.querySelector('[data-questions]').click()`);
check(await waitFor(`document.querySelector('.cs-modal .cs-lock')&&${qcards}.length===3`),'The locked builder opens at 390px');
check(await evaluate(builderFits)&&await evaluate(cardsFit)&&await evaluate(chromeFits),'The lock note and cards fit at 390px');
await key('Escape');
await call('Emulation.clearDeviceMetricsOverride');

// ── Question form: other types, validation, type switches, any positive points ──
// Builder quiz now holds: multiple choice, true or false, identification, hotspot (sternum), hotspot (skull).
await call('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
const bank=async()=>(await api('questions.php?assessment_id='+bqId)).data;
const openBuilder=async(title,count)=>{
  await navigate('/teacher/assessments.html');
  await waitFor(`${arow(title)}!==undefined`);
  await evaluate(`${arow(title)}.querySelector('[data-questions]').click()`);
  return waitFor(`${qcards}.length===${count}`);
};
const editQuestion=async n=>{await openQMenu(n);await evaluate(pick('Edit'));return waitFor(`document.querySelector('.cs-sheet h3')?.textContent==='Edit question'`);};
const formError=`document.querySelector('.cs-sheet .cs-sheet-foot .is-error')?.textContent`;
check(await openBuilder('Builder quiz',5),'The builder reopens on the builder quiz');
// True or false: the form shows the saved value; switching it moves the mark.
check(await editQuestion(1)&&await evaluate(`document.querySelector('.cs-sheet [name="question_type"]:checked').value==='true_false'&&!document.querySelector('.cs-sheet [data-for="true_false"]').hidden&&document.querySelector('.cs-sheet [name="tf"]:checked').value==='False'`),'Editing true or false shows the saved answer');
await evaluate(`document.querySelector('.cs-sheet [name="tf"][value="True"]').click()`);
await saveForm();
check(await waitFor(`!document.querySelector('.cs-sheet')&&${qcard(1)}?.querySelector('.cs-opt.ok')?.textContent.startsWith('True')`),'Saving true or false moves the correct mark');
check((await bank())[1].options.map(o=>`${o.option_text}:${o.is_correct}`).join()==='True:true,False:false','The true or false answer is saved');
// Identification: the form shows the term; a new term is saved as the answer and the option.
check(await editQuestion(2)&&await evaluate(`document.querySelector('.cs-sheet [name="question_type"]:checked').value==='identification'&&document.querySelector('.cs-sheet [name="term"]').value==='Femur'`),'Editing identification shows the saved answer');
await sheetSet('[name="term"]','Thighbone');
await saveForm();
check(await waitFor(`!document.querySelector('.cs-sheet')&&${qcard(2)}?.querySelector('.cs-answer').textContent.includes('Answer: Thighbone')`),'Saving identification shows the new answer');
const savedTerm=(await bank())[2];
check(savedTerm.hotspot_data.target_label==='Thighbone'&&savedTerm.options.length===1&&savedTerm.options[0].option_text==='Thighbone'&&savedTerm.options[0].is_correct,'The identification answer is saved');
// Multiple choice validation: fewer than two choices, no correct choice, a blank choice marked correct, points at 0.
await evaluate(`document.querySelector('.cs-modal .cs-btn--primary').click()`);
await waitFor(`document.querySelector('.cs-sheet h3')?.textContent==='New question'`);
await sheetSet('[name="question_text"]','Which bone is in the forearm?');
await evaluate(`document.querySelectorAll('.cs-sheet [name="choice"]')[0].value='Radius'`);
await saveForm();
check(await waitFor(`${formError}==='Add at least two answer choices.'`),'One choice is refused');
await evaluate(`(()=>{const c=document.querySelectorAll('.cs-sheet [name="choice"]');c[1].value='Femur';document.querySelectorAll('.cs-sheet [name="correct"]').forEach(r=>{r.checked=false;});})()`);
await saveForm();
check(await waitFor(`${formError}==='Mark a filled-in choice as the correct answer.'`),'No correct choice is refused');
await evaluate(`document.querySelectorAll('.cs-sheet [name="correct"]')[3].click()`);
await saveForm();
check(await waitFor(`${formError}==='Mark a filled-in choice as the correct answer.'`)&&await evaluate(`document.activeElement===document.querySelectorAll('.cs-sheet [name="choice"]')[3]`),'A blank choice marked correct is refused and focused');
await evaluate(`document.querySelectorAll('.cs-sheet [name="correct"]')[0].click()`);
await sheetSet('[name="points"]','0');
await saveForm();
check(await waitFor(`${formError}==='Points must be more than 0.'`),'Points of 0 are refused');
check((await bank()).length===5,'Nothing was saved while the form refused');
await sheetSet('[name="points"]','0.5');
await saveForm();
check(await waitFor(`!document.querySelector('.cs-sheet')&&${qcards}.length===6&&${qcard(5)}.querySelector('.cs-q-top .cs-meta').textContent==='0.5 points'`),'Half a point is accepted');
check((await bank())[5].points===.5&&(await bank())[5].options.map(o=>`${o.option_text}:${o.is_correct}`).join()==='Radius:true,Femur:false','The new question saves its choices and half a point');
// Type switch on edit: the skull hotspot becomes multiple choice and its old target is cleared.
check(await editQuestion(4)&&await evaluate(`document.querySelector('.cs-sheet [name="question_type"]:checked').value==='hotspot'`),'Editing the skull hotspot');
await evaluate(`document.querySelector('.cs-sheet [name="question_type"][value="multiple_choice"]').click()`);
check(await evaluate(`document.querySelector('.cs-sheet [data-for="hotspot"]').hidden&&!document.querySelector('.cs-sheet [data-for="multiple_choice"]').hidden`),'Switching to multiple choice shows the choices');
await sheetSet('[name="question_text"]','Which bone protects the brain?');
await evaluate(`(()=>{const c=document.querySelectorAll('.cs-sheet [name="choice"]');c[0].value='Sternum';c[1].value='Skull';document.querySelectorAll('.cs-sheet [name="correct"]')[1].click();})()`);
await saveForm();
check(await waitFor(`!document.querySelector('.cs-sheet')&&${qcard(4)}?.querySelector('.cs-qtype').textContent.trim()==='Multiple choice'&&!${qcard(4)}.querySelector('.cs-hs')&&${qcard(4)}.querySelector('.cs-opt.ok').textContent.includes('Skull')`),'The switched question shows as multiple choice');
const switched=(await bank())[4];
const staleHotspot=switched.hotspot_data&&typeof switched.hotspot_data==='object'?Object.keys(switched.hotspot_data):[];
check(switched.question_type==='multiple_choice'&&staleHotspot.length===0&&switched.options.map(o=>`${o.option_text}:${o.is_correct}`).join()==='Sternum:false,Skull:true','The old hotspot target is cleared and the choices saved');
// A question worth 12 points (made through the API) edits without touching its points.
const twelve=await addQuestion({question_type:'multiple_choice',question_text:'Worth twelve',points:12,sort_order:10,options:[{option_text:'Yes',is_correct:true},{option_text:'No',is_correct:false}]});
check(twelve.success,'Create a question worth 12 points');
await key('Escape');
check(await openBuilder('Builder quiz',7),'The builder shows the 12-point question');
check(await evaluate(`${qcard(6)}.querySelector('.cs-q-top .cs-meta').textContent==='12 points'`),'The card says 12 points');
check(await editQuestion(6)&&await evaluate(`document.querySelector('.cs-sheet [name="points"]').value==='12'`),'The form keeps 12 points');
await sheetSet('[name="question_text"]','Worth twelve, edited');
await saveForm();
check(await waitFor(`!document.querySelector('.cs-sheet')&&${qcard(6)}?.querySelector('.cs-q-text').textContent==='Worth twelve, edited'`),'A 12-point question saves a text change');
check((await bank())[6].points===12,'Its points stay 12');
await key('Escape');
await waitFor(`!document.querySelector('.cs-modal')`);

// ── A first attempt arrives while the builder is open: the next write is refused and the builder locks ──
// The student takes the quiz from another device (its own session, outside the browser).
function apiClient(){let cookie='';return async(path,method='GET',body)=>{const response=await fetch(base+'/api/'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const received=response.headers.getSetCookie();if(received.length)cookie=received.map(c=>c.split(';')[0]).join('; ');return {status:response.status,...await response.json()};};}
const otherDevice=apiClient();
check((await otherDevice('auth/login.php','POST',{username:'fixture-student',password:studentPassword})).success,'The student signs in on another device');
const takeQuiz=async id=>{const start=await otherDevice('quiz/start.php','POST',{assessment_id:id});if(!start.success)return false;return (await otherDevice('quiz/submit.php','POST',{submission_id:start.data.submission_id,answers:[],time_taken_secs:5})).success;};
const raceQuiz=async title=>{const made=await api('assessments.php','POST',{title,system_id:testSystem.system_id,status:'active',time_limit_mins:10,passing_score:50,max_attempts:1});const id=Number(made.data?.assessment_id);const q=await api('questions.php','POST',{assessment_id:id,question_type:'multiple_choice',question_text:'Race question',points:1,options:[{option_text:'Left',is_correct:true},{option_text:'Right',is_correct:false}]});return made.success&&q.success?id:0;};
const raceIds={edit:await raceQuiz('Race edit'),remove:await raceQuiz('Race delete'),add:await raceQuiz('Race add')};
check(Object.values(raceIds).every(Boolean),'Create three open assessments nobody has taken');
const raceBank=async id=>(await api('questions.php?assessment_id='+id)).data;
const lockedNow=`document.querySelector('.cs-modal .cs-lock')&&!document.querySelector('.cs-modal [data-q-more]')&&document.querySelector('.cs-modal .cs-sheet-foot .cs-btn--primary').disabled`;
const lockToast=`[...document.querySelectorAll('.toast')].some(t=>t.textContent.includes('its questions are locked. Duplicate it to edit.'))`;
// Edit: the form is open when the attempt lands; Save is refused.
check(await openBuilder('Race edit',1)&&await evaluate(`!document.querySelector('.cs-modal .cs-lock')`),'The builder opens unlocked');
check(await editQuestion(0),'Edit opens before anyone has taken it');
await sheetSet('[name="question_text"]','Changed after an attempt');
check(await takeQuiz(raceIds.edit),'A student takes it while the form is open');
await saveForm();
check(await waitFor(`!document.querySelector('.cs-sheet')&&${lockedNow}`),'Saving the edit locks the builder and shows the lock note');
check(await waitFor(lockToast),'A toast says the questions are locked');
check((await raceBank(raceIds.edit))[0].question_text==='Race question'&&await evaluate(`${qcard(0)}.querySelector('.cs-q-text').textContent==='Race question'`),'The question is unchanged');
await key('Escape');
await waitFor(`!document.querySelector('.cs-modal')`);
// Delete: the attempt lands while the builder is open; Delete is refused.
check(await openBuilder('Race delete',1),'A second builder opens unlocked');
check(await takeQuiz(raceIds.remove),'A student takes it while the builder is open');
await openQMenu(0);
await evaluate(pick('Delete'));
await confirmShows('Delete this question?');
await evaluate(`document.querySelector('dialog.toast-confirm .toast-confirm__go').click()`);
check(await waitFor(lockedNow)&&await waitFor(lockToast),'Deleting locks the builder and shows the lock note');
check((await raceBank(raceIds.remove)).length===1&&await evaluate(`${qcards}.length===1`),'The question is kept');
await key('Escape');
await waitFor(`!document.querySelector('.cs-modal')`);
// Add: the new-question form is open when the attempt lands; Add is refused.
check(await openBuilder('Race add',1),'A third builder opens unlocked');
await evaluate(`document.querySelector('.cs-modal .cs-btn--primary').click()`);
await waitFor(`document.querySelector('.cs-sheet h3')?.textContent==='New question'`);
await sheetSet('[name="question_text"]','Added after an attempt');
await evaluate(`(()=>{const c=document.querySelectorAll('.cs-sheet [name="choice"]');c[0].value='Up';c[1].value='Down';})()`);
check(await takeQuiz(raceIds.add),'A student takes it while the new-question form is open');
await saveForm();
check(await waitFor(`!document.querySelector('.cs-sheet')&&${lockedNow}`)&&await waitFor(lockToast),'Adding locks the builder and shows the lock note');
check((await raceBank(raceIds.add)).length===1&&await evaluate(`${qcards}.length===1`),'No question is added');
check(await evaluate(`document.querySelector('.cs-modal .cs-lock button').textContent.trim()==='Duplicate to edit'`),'The locked builder offers Duplicate to edit');
await key('Escape');
await waitFor(`!document.querySelector('.cs-modal')`);
await call('Emulation.clearDeviceMetricsOverride');

// ── Student quizzes filter by question type ───────────────────────
// Known fixtures, made as the teacher: one mixed quiz (multiple choice + hotspot) and one with no questions.
await signIn(credentials.username,credentials.password,'/teacher/');
await navigate('/teacher/assessments.html');
const fxSystem=(await api('assessments.php')).data.find(a=>a.title==='Test quiz').system_id;
const mixedFx=await api('assessments.php','POST',{title:'Mixed filter fixture',system_id:fxSystem,status:'active'});
const emptyFx=await api('assessments.php','POST',{title:'Empty filter fixture',system_id:fxSystem,status:'active'});
check(mixedFx.success&&emptyFx.success,'Create the mixed and the empty fixture quizzes');
check((await api('questions.php','POST',{assessment_id:Number(mixedFx.data.assessment_id),question_type:'multiple_choice',question_text:'Pick',points:1,options:[{option_text:'A',is_correct:true},{option_text:'B',is_correct:false}]})).success&&(await api('questions.php','POST',{assessment_id:Number(mixedFx.data.assessment_id),question_type:'hotspot',question_text:'Click it',points:1,hotspot_data:{target_label:'Spot',image_url:'/test-image.png',x:.4,y:.6,radius:.1}})).success,'Give the mixed fixture a multiple choice and a hotspot question');
await signIn('fixture-student',studentPassword,'/student/');
await navigate('/student/quiz.html');
check(await waitFor(`document.querySelectorAll('#availableAssessmentsGrid article').length>0`),'Student quiz cards render');
check(await evaluate(`[...document.querySelectorAll('#typeFilterChips [data-qtype]')].map(b=>b.dataset.qtype).join()==='all,multiple_choice,true_false,identification,hotspot'`),'Chips name question types');
check(await evaluate(`document.querySelector('#typeFilterChips [data-qtype="hotspot"] .chip-count').textContent==String([...document.querySelectorAll('#availableAssessmentsGrid article')].filter(c=>c.dataset.qtypes.split(' ').includes('hotspot')).length)&&Number(document.querySelector('#typeFilterChips [data-qtype="hotspot"] .chip-count').textContent)>0`),'Hotspot chip counts the assessments that hold a hotspot question');
await evaluate(`setQuestionTypeFilter('hotspot')`);
check(await evaluate(`(()=>{const c=[...document.querySelectorAll('#availableAssessmentsGrid article')];return c.length>0&&c.every(x=>x.dataset.qtypes.split(' ').includes('hotspot'));})()`),'Hotspot chip shows every assessment that holds a hotspot question');
await evaluate(`setQuestionTypeFilter('all')`);
check(await evaluate(`!/assessment_type|Chapter quiz/i.test(document.body.innerHTML)`),'No trace of the old type');
check(await evaluate(`[...document.querySelectorAll('#availableAssessmentsGrid article')].every(c=>c.querySelector('.sd-task-chips .sd-chip').textContent===(c.dataset.qtypes.split(' ').filter(Boolean).length>1?'Mixed questions':c.dataset.qtypes?ContentFormat.QUESTION_TYPES[c.dataset.qtypes].label:'No questions yet'))`),'Each card is labelled from its questions');
const titlesUnder=async qtype=>{await evaluate(`setQuestionTypeFilter(${JSON.stringify(qtype)})`);return evaluate(`[...document.querySelectorAll('#availableAssessmentsGrid article .sd-task-title')].map(h=>h.textContent)`);};
check((await titlesUnder('multiple_choice')).includes('Mixed filter fixture')&&(await titlesUnder('hotspot')).includes('Mixed filter fixture'),'A mixed quiz appears under both Multiple choice and Hotspot');
check(!(await titlesUnder('identification')).includes('Mixed filter fixture')&&!(await titlesUnder('true_false')).includes('Mixed filter fixture'),'A mixed quiz does not appear under types it does not hold');
await evaluate(`setQuestionTypeFilter('all')`);
check(await evaluate(`(()=>{const c=[...document.querySelectorAll('#availableAssessmentsGrid article')].find(x=>x.querySelector('.sd-task-title').textContent==='Mixed filter fixture');return c&&c.querySelector('.sd-task-chips .sd-chip').textContent==='Mixed questions'&&c.style.getPropertyValue('--card')===CARD_COLOURS.sky&&c.dataset.qtypes==='multiple_choice hotspot';})()`),'The mixed quiz says Mixed questions in the sky tone');
check(!(await titlesUnder('all')).includes('Empty filter fixture'),'A quiz with no questions is not offered to students');
const rows=(await api('assessments.php')).data;
check(await evaluate(`${JSON.stringify(['multiple_choice','true_false','identification','hotspot'])}.every(t=>document.querySelector('#typeFilterChips [data-qtype="'+t+'"] .chip-count').textContent===${JSON.stringify('')}+({${['multiple_choice','true_false','identification','hotspot'].map(t=>`${t}:${rows.filter(r=>r.question_types[t]>0).length}`).join(',')}})[t])&&document.getElementById('countAll').textContent===${JSON.stringify(String(rows.length))}`),'Each chip count equals the API rows holding that question type');
await navigate('/student/dashboard.html');
check(await waitFor(`document.getElementById('recentScoresTable')`),'Student dashboard loads');
check(await evaluate(`![...document.querySelectorAll('th')].some(h=>h.textContent==='Type')`),'Recent results have no Type column');

check(errors.length===0,'No uncaught page errors: '+errors.join(' | '));
check(nativeDialogs.length===0,'No native alert, confirm or prompt box ever opened: '+nativeDialogs.join(' | '));
console.log(`Content browser checks passed: ${checks}`);
socket.close();
