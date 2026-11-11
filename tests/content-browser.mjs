// Browser checks for the content redesign (PDF viewer now; studio pages later).
// Run through .superpowers/sdd/2026-11-11-content-redesign/run-suites.sh content: it starts PHP on 8091 and
// Chrome on 9225 after tests/integration.mjs has set up the fixtures (fixture-student and its password).
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
await evaluate(`document.querySelector('.cs-sheet-foot .cs-btn--primary').click()`);
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
const dialogs=[];
socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.method==='Page.javascriptDialogOpening'){dialogs.push(data.params.message);call('Page.handleJavaScriptDialog',{accept:false});}});
await evaluate(deleteButton+'.click()');
check(await waitFor('true')&&dialogs.length===1&&dialogs[0].includes(hostile),'Delete asks for confirmation with the full title');
check(await evaluate('window.__pwned===undefined'),'The title did not run as script');

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
check(await waitFor(`document.querySelector('.cs-sheet .cs-attach canvas[data-rendered]')`),'The saved PDF shows a thumbnail');
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
check(await waitFor(`document.querySelector('.cs-sheet .cs-attach .cs-meta')?.textContent.includes('Replaces the current file')`),'Choosing a file shows it as the replacement');
await evaluate(`document.querySelector('.cs-sheet-foot .cs-btn--primary').click()`);
check(await waitFor(`!document.querySelector('.cs-sheet')`),'Saving a replacement closes the sheet');
const newMedia=(await evaluate(`fetch(API_BASE+'/lessons.php?id=${lessonId}',{credentials:'same-origin'}).then(r=>r.json())`)).data.media_url;
check(newMedia&&newMedia!==oldMedia,'The replacement changed the stored file');
// Phone width: the sheet is full screen with no sideways scroll.
await call('Emulation.setDeviceMetricsOverride',{width:390,height:800,deviceScaleFactor:2,mobile:true});
await evaluate(`document.querySelector('#workspaceView [data-add-lesson]').click()`);
check(await waitFor(`document.querySelector('.cs-sheet')&&document.querySelector('.cs-sheet').getAnimations().length===0`),'The sheet opens at 390px');
check(await evaluate(`(()=>{const s=document.querySelector('.cs-sheet').getBoundingClientRect();const b=document.querySelector('.cs-sheet-body');return s.width===innerWidth&&s.height===innerHeight&&b.scrollWidth<=b.clientWidth&&document.documentElement.scrollWidth<=innerWidth;})()`),'The sheet is full screen with no sideways scroll at 390px');
check(await evaluate(`[...document.querySelectorAll('.cs-sheet .cs-type')].every(t=>{const r=t.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&t.scrollWidth<=t.clientWidth;})`),'The type tiles fit at 390px');
await key('Escape');
await call('Emulation.clearDeviceMetricsOverride');

check(errors.length===0,'No uncaught page errors: '+errors.join(' | '));
console.log(`Content browser checks passed: ${checks}`);
socket.close();
