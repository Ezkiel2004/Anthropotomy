import fs from 'node:fs';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:8091';
const credentials=JSON.parse(fs.readFileSync('.runtime/test-access.json','utf8'));
const target=await (await fetch('http://127.0.0.1:9225/json/new?about:blank',{method:'PUT'})).json();
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
let next=0;const pending=new Map(),errors=[];
socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const entry=pending.get(data.id);pending.delete(data.id);data.error?entry.reject(new Error(data.error.message)):entry.resolve(data.result);}else if(data.method==='Runtime.exceptionThrown'){errors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);}});
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
await call('Runtime.enable');await call('Page.enable');
await call('Network.enable');
// Start signed out, whatever an earlier suite left in this browser profile.
await call('Network.clearBrowserCookies');
const explorationPosts=[];
socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.method==='Network.requestWillBeSent' && data.params.request.method==='POST' && data.params.request.url.includes('/analytics/exploration.php'))explorationPosts.push(data.params.request.url);});
async function waitFor(expression,timeout=15000){for(let waited=0;waited<timeout;waited+=200){try{if(await evaluate(expression))return true;}catch{/* The page is mid-navigation. */}await new Promise(resolve=>setTimeout(resolve,200));}return false;}
async function navigate(path){
    await call('Page.navigate',{url:base+path});
    for(let i=0;i<60;i++){
        await new Promise(resolve=>setTimeout(resolve,200));
        if(await evaluate(`location.pathname===${JSON.stringify(path.split('?')[0])} && document.readyState==='complete'`))break;
    }
    await new Promise(resolve=>setTimeout(resolve,450));
}
await navigate('/login.html');
await evaluate(`document.getElementById('username').value=${JSON.stringify(credentials.username)};document.getElementById('password').value=${JSON.stringify(credentials.password)};handleLogin();`);
await waitFor(`location.pathname.startsWith('/teacher/') && document.readyState==='complete' && Boolean(document.querySelector('.sidebar-nav .nav-item'))`);
assert.ok((await evaluate('location.pathname')).includes('/teacher/'),'Teacher login redirects');

const expected={
 teacher:['dashboard','modules','students','assessments','games','monitoring','reports','announcements','settings','anatomy'],
 student:['dashboard','anatomy','lessons','quiz','games','progress']
};
// Both sidebars start with a Home link to the public landing page.
const menu=role=>['index.html',...expected[role].map(p=>p+'.html')];
// Pages checked per portal. Student notifications and settings are reached from the top bar
// (bell and account menu), not the sidebar; scores.html redirects to "My Progress & Scores".
const pages={teacher:expected.teacher,student:[...expected.student,'notifications','settings']};
// Follow the reported navigation path with normal browser caching enabled.
for(const page of ['assessments','monitoring','dashboard','assessments','monitoring']){
 await evaluate(`document.querySelector('.sidebar-nav a[href*="${page}.html"]').click()`);
 for(let i=0;i<60;i++){
   await new Promise(resolve=>setTimeout(resolve,200));
   if(await evaluate(`location.pathname==='/teacher/${page}.html' && document.readyState==='complete' && Boolean(document.querySelector('.sidebar-nav a[aria-current="page"][href*="${page}.html"]'))`))break;
 }
 assert.equal(await evaluate('location.pathname'),'/teacher/'+page+'.html','Sidebar click reaches '+page);
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('.sidebar-nav a')].map(a=>new URL(a.href).pathname.split('/').pop())`),menu('teacher'),'Every menu remains present after clicking '+page);
 for(const link of ['settings','anatomy']){
   assert.ok(await evaluate(`(()=>{const link=document.querySelector('.sidebar-nav a[href*="${link}.html"]');link.scrollIntoView({block:'center'});const r=link.getBoundingClientRect();return link.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`),'Lower sidebar link is reachable on '+page+': '+link);
 }
}
let checked=0;
for(const role of ['teacher','student']){
 if(role==='student'){
   const created=await evaluate(`(async()=>{const response=await fetch('/api/students.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'navigation-student',full_name:'Navigation Student',school_id:'NAV-TEST',section:'Rizal',password:'navigation-test-password',school_year:'Test'})});return response.json();})()`);
   assert.ok(created.success,'Create isolated student fixture');
   await evaluate('Auth.logout()');await navigate('/login.html');
   await evaluate(`document.getElementById('username').value='navigation-student';document.getElementById('password').value='navigation-test-password';handleLogin();`);
   await waitFor(`location.pathname.startsWith('/student/') && document.readyState==='complete' && Boolean(document.querySelector('.sidebar-nav .nav-item'))`);
 }
 let baseline;
 for(const page of pages[role]){
   await navigate('/'+role+'/'+page+'.html');
   assert.equal(await evaluate('location.pathname'),'/'+role+'/'+page+'.html');
   const navigation=await evaluate(`[...document.querySelectorAll('.sidebar-nav .nav-item')].map(a=>({href:new URL(a.href).pathname.split('/').pop(),label:a.querySelector('.nav-label').textContent.trim(),icon:!!a.querySelector('.nav-icon svg')}))`);
   assert.deepEqual(navigation.map(a=>a.href),menu(role),role+'/'+page+' has every navigation link in the same order');
   if(role==='teacher'){
     const games=navigation.findIndex(a=>a.href==='games.html');
     assert.ok(games>0&&navigation[games-1].href==='assessments.html'&&navigation[games].label==='Games','Games sits right after Assessments in the teacher sidebar');
     assert.equal(await evaluate(`document.querySelector('.sidebar-nav a[href*="games.html"] use').getAttribute('href').split('#').pop()`),'game-controller','Teacher Games uses the game-controller icon');
   }
   // A fresh database has no sets, plays or teacher badges: each teacher tab shows its empty state, and the built-in badges list.
   if(role==='teacher'&&page==='games'){
     assert.ok(await waitFor(`!document.getElementById('setsEmpty').hidden&&document.querySelectorAll('#setRows tr').length===0`),'No sets yet: the Game sets tab says so');
     assert.ok(await waitFor(`!document.getElementById('missedEmpty').hidden&&!document.getElementById('boardEmpty').hidden`),'No plays yet: most-missed terms and the leaderboard say so');
     assert.ok(await waitFor(`document.querySelectorAll('#badgeRows tr.is-builtin').length===11`),'The built-in badges are listed');
   }
   if(role==='student'){
     assert.equal(navigation.length,7,'The student sidebar has seven links');
     const games=navigation.findIndex(a=>a.href==='games.html');
     assert.ok(games>0&&navigation[games-1].href==='quiz.html'&&navigation[games].label==='Games','Games sits right after Quizzes');
     assert.equal(await evaluate(`document.querySelector('.sidebar-nav a[href*="games.html"] use').getAttribute('href').split('#').pop()`),'game-controller','Games uses the game-controller icon');
   }
   // A fresh database has no systems and no sets, so every pool is empty.
   if(role==='student'&&page==='games')assert.ok(await waitFor(`!document.getElementById('gamesEmpty').hidden&&document.getElementById('gamesEmpty').textContent.includes('No game content yet')&&document.getElementById('gamesPicker').hidden`),'An empty install shows "No game content yet"');
   assert.ok(navigation.every(a=>a.icon),'Every link has an icon when collapsed');
   baseline??=navigation;assert.deepEqual(navigation,baseline,'Labels and icons are consistent');
   const inMenu=expected[role].includes(page);
   assert.deepEqual(await evaluate(`[...document.querySelectorAll('.sidebar-nav [aria-current="page"]')].map(a=>new URL(a.href).pathname.split('/').pop())`),inMenu?[page+'.html']:[],'Correct page is selected');
   assert.equal(await evaluate(`document.querySelectorAll('.sidebar-nav .active').length`),inMenu?1:0,'At most one active navigation item');
   // Both portals open the profile from the top bar account menu (the teacher sidebar footer card is gone).
   assert.equal(await evaluate(`document.querySelector('#accountDropdown a')?.getAttribute('href')`),'settings.html#profile','Account menu opens the profile');
   await evaluate(`document.getElementById('sidebarToggle').click()`);
   assert.equal(await evaluate(`document.getElementById('sidebar').classList.contains('collapsed')`),true,'Desktop collapse works');
   await evaluate(`document.getElementById('sidebarToggle').click()`);
   await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
   await evaluate(`document.getElementById('sidebarToggle').click()`);
   assert.equal(await evaluate(`document.getElementById('sidebarToggle').getAttribute('aria-expanded')`),'true','Mobile menu opens');
   assert.equal(await evaluate(`document.getElementById('sidebar').classList.contains('mobile-open')`),true);
   // Teachers have no phone tab bar, so Games must be reachable in the open menu.
   if(role==='teacher')for(const [width,height] of [[360,740],[375,812]]){
     await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
     await new Promise(resolve=>setTimeout(resolve,350));
     assert.ok(await evaluate(`(()=>{const link=document.querySelector('.sidebar-nav a[href*="games.html"]');link.scrollIntoView({block:'center'});const r=link.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&link.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`),`Games is reachable in the open phone menu at ${width}px on ${page}`);
   }
   await evaluate(`document.getElementById('sidebarOverlay').click()`);
   assert.equal(await evaluate(`document.getElementById('sidebarToggle').getAttribute('aria-expanded')`),'false','Overlay closes mobile menu');
   await evaluate(`document.getElementById('sidebarToggle').click()`);
   await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   assert.equal(await evaluate(`document.getElementById('sidebar').classList.contains('mobile-open')`),false,'Escape closes mobile menu');
   await call('Emulation.clearDeviceMetricsOverride');
   // Student phones: six tabs in one row, Games after Quizzes, every label inside its own tab, the current page marked.
   if(role==='student'){
     const tabPages=['dashboard','anatomy','lessons','quiz','games','progress'];
     for(const [width,height] of [[360,740],[375,812]]){
       await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
       await new Promise(resolve=>setTimeout(resolve,250));
       const tabs=await evaluate(`[...document.querySelectorAll('.sd-tabbar a')].map(a=>{const r=a.getBoundingClientRect(),l=a.querySelector('span').getBoundingClientRect();return {href:a.getAttribute('href'),current:a.getAttribute('aria-current'),fits:l.width>0&&l.left>=r.left-.5&&l.right<=r.right+.5&&l.bottom<=innerHeight+.5,top:Math.round(r.top)};})`);
       assert.deepEqual(tabs.map(t=>t.href),tabPages.map(p=>p+'.html'),'The phone tab bar has six tabs with Games after Quizzes');
       assert.ok(tabs.every(t=>t.fits)&&new Set(tabs.map(t=>t.top)).size===1,`All six tabs sit in one row and every label fits its tab at ${width}px on ${page}`);
       assert.deepEqual(tabs.filter(t=>t.current==='page').map(t=>t.href),tabPages.includes(page)?[page+'.html']:[],'The current page has the marked tab');
       assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),`No horizontal scroll at ${width}px on ${page}`);
     }
     await call('Emulation.clearDeviceMetricsOverride');
   }
   if(role==='teacher' && page==='assessments'){
      await new Promise(resolve=>setTimeout(resolve,350));
      const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.runtime/assessment-sidebar.png',Buffer.from(shot.data,'base64'));
   }
   checked++;
 }
}
await call('Page.close');socket.close();
assert.deepEqual(errors,[],'No uncaught browser errors');
console.log('Sidebar checks passed across '+checked+' pages: complete menus, active links, icons, desktop collapse, mobile menu, overlay and Escape.');
