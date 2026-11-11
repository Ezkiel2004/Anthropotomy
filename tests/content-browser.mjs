// Browser checks for the content redesign (PDF viewer now; studio pages later).
// Run through .superpowers/sdd/2026-11-11-content-redesign/run-suites.sh content: it starts PHP on 8091 and
// Chrome on 9225 after tests/integration.mjs has set up the fixtures (fixture-student and its password).
import fs from 'node:fs';
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
check(await evaluate(`!document.getElementById('addModuleModal')&&!/alert\\(|prompt\\(/.test(document.body.innerHTML)`),'Popups are gone');
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
check(await evaluate(`[...document.querySelectorAll('.cs-menu [role="menuitem"]')].map(b=>b.textContent.trim()).join('|')`)==='Edit details|Materials|Publish|Archive','Menu offers Edit details, Materials, Publish and Archive');
await key('ArrowDown');
check(await evaluate(`document.activeElement.textContent.trim()==='Materials'`),'Arrow down moves to the next item');
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

check(errors.length===0,'No uncaught page errors: '+errors.join(' | '));
console.log(`Content browser checks passed: ${checks}`);
socket.close();
