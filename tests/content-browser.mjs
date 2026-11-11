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

// ── Student ─────────────────────────────────────────────────────
await signIn('fixture-student',studentPassword,'/student/');
await navigate('/student/lessons.html');
await evaluate(`startLesson(${lessonId})`);
check(await waitFor(`document.querySelector('.sd-reader .pv canvas[data-rendered]')`),'Lesson PDF renders inline');
check(await evaluate(`!document.querySelector('.sd-reader iframe')`),'No iframe left in the reader');
check(await evaluate(`document.querySelector('.sd-reader .pv-pages').textContent.includes('of ')`),'Inline viewer shows the page count');
await evaluate(`document.querySelector('.sd-reader .pv [aria-label="Full screen"]').click()`);
check(await waitFor(`document.querySelector('.pv-overlay .pv-stage canvas[data-rendered]')`),'Full screen opens from the inline viewer');
await key('Escape');
check(await waitFor(`!document.querySelector('.pv-overlay')`),'Escape closes full screen');
check(await evaluate(`!document.getElementById('lessonContentViewer').hidden`),'Escape in full screen leaves the reader open');
await evaluate(`closeLessonViewer()`);
// Materials open in the viewer, not a tab.
await evaluate(`viewModule(${moduleId})`);
check(await waitFor(`document.querySelector('#lessonModalBody .sd-materials-title')`),'Student sees the module materials');
check(await evaluate(`!document.querySelector('#lessonModalBody a[target=_blank]')`),'Material PDFs do not open a new tab');
await evaluate(`[...document.querySelectorAll('#lessonModalBody .sd-lesson')].find(e=>/Long reader/.test(e.textContent)).click()`);
check(await waitFor(`document.querySelector('.pv-overlay .pv-stage canvas[data-rendered]')`),'Material opens in the viewer');
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
