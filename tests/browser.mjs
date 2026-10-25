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
// Every round the Games page sends, as the raw request body.
const playPosts=[];
socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.method==='Network.requestWillBeSent' && data.params.request.method==='POST' && data.params.request.url.includes('/games/plays.php'))playPosts.push(data.params.request.postData);});
// The HTTP status of every plays.php answer, in order.
const playResponses=[];
socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.method==='Network.responseReceived' && data.params.response.url.includes('/games/plays.php'))playResponses.push(data.params.response.status);});
async function waitFor(expression,timeout=15000){for(let waited=0;waited<timeout;waited+=200){try{if(await evaluate(expression))return true;}catch{/* The page is mid-navigation. */}await new Promise(resolve=>setTimeout(resolve,200));}return false;}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function navigate(path){
    await call('Page.navigate',{url:base+path});
    for(let i=0;i<60;i++){
        await new Promise(resolve=>setTimeout(resolve,200));
        if(await evaluate(`location.pathname===${JSON.stringify(path.split(/[?#]/)[0])} && document.readyState==='complete'`))break;
    }
    await new Promise(resolve=>setTimeout(resolve,450));
}
// Public landing page: one h1, sequential headings, real routes and the current name only.
await navigate('/index.html');
assert.ok((await evaluate('document.title')).includes('Anthropotomy'),'Landing page title uses the product name');
assert.equal(await evaluate(`document.querySelectorAll('h1').length`),1,'Landing page has one h1');
assert.ok(await evaluate(`(()=>{let last=0;for(const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6')){const level=+h.tagName[1];if(level>last+1)return false;last=level;}return true;})()`),'Landing headings are sequential');
assert.ok(await evaluate(`!/AnatomIQ/i.test(document.body.innerText+[...document.querySelectorAll('[alt],[aria-label],title')].map(e=>(e.getAttribute('alt')||'')+(e.getAttribute('aria-label')||'')+e.textContent).join(' '))`),'No outdated product name on the landing page');
assert.ok(await evaluate(`[...document.querySelectorAll('img')].every(img=>img.hasAttribute('alt'))`),'Every landing image has alt text');
assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-primary-cta]:is([data-auth="guest"],[data-auth="guest"] *)')].map(a=>a.getAttribute('href'))`),['login.html#register','login.html#register'],'Primary CTAs open registration');
assert.ok(await evaluate(`[...document.querySelectorAll('a[href]')].filter(a=>a.textContent.trim()==='Sign in').every(a=>a.getAttribute('href')==='login.html#login')`),'Sign in links open the login view');
await navigate('/login.html#register');
assert.ok(await evaluate(`!document.getElementById('registerView').hidden && document.getElementById('loginView').hidden`),'Register deep link opens the registration form');
await navigate('/login.html');
await evaluate(`document.getElementById('username').value=${JSON.stringify(credentials.username)};document.getElementById('password').value=${JSON.stringify(credentials.password)};handleLogin();`);
await waitFor(`location.pathname.startsWith('/teacher/') && document.readyState==='complete' && Boolean(document.querySelector('.sidebar-nav .nav-item'))`);
assert.ok((await evaluate('location.pathname')).includes('/teacher/'),'Teacher login redirects');
let checked=0;
for(const page of ['dashboard','students','modules','assessments','games','monitoring','reports','announcements','settings','anatomy']){
    await navigate('/teacher/'+page+'.html');
    assert.ok(!(await evaluate('location.pathname')).includes('login.html'),'Teacher stays authenticated: '+page);
    if(page==='dashboard')assert.ok(await evaluate(`Boolean(document.querySelector('.page-content a[href="anatomy.html"]'))`),'Dashboard links to teacher explorer');
    if(page==='anatomy'){
        assert.ok((await evaluate('document.body.innerText')).includes('No 3D model has been added'),'Missing model has an honest empty state');
        await evaluate(`localStorage.removeItem('anatomy.systemsOpen')`);
        await navigate('/teacher/anatomy.html');
        assert.equal(await evaluate(`document.getElementById('systemsToggle').getAttribute('aria-expanded')`),'true','Systems panel starts open on desktop');
        assert.ok(await evaluate(`document.getElementById('systemsMenu').contains(document.getElementById('systemChips'))&&getComputedStyle(document.getElementById('systemChips')).position!=='absolute'`),'The list sits inside the same panel as its header, not in a dropdown');
        await evaluate(`document.getElementById('anatomyCanvas').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
        assert.equal(await evaluate(`document.getElementById('systemsToggle').getAttribute('aria-expanded')`),'true','Clicking the model does not collapse the systems panel');
        await evaluate(`document.getElementById('systemsToggle').click()`);
        await new Promise(resolve=>setTimeout(resolve,400));
        assert.equal(await evaluate(`document.getElementById('systemsToggle').getAttribute('aria-expanded')`),'false','The header collapses the systems panel');
        assert.equal(await evaluate(`document.getElementById('systemChips').inert`),true,'A collapsed list leaves the tab order');
        await navigate('/teacher/anatomy.html');
        assert.equal(await evaluate(`document.getElementById('systemsToggle').getAttribute('aria-expanded')`),'false','The collapsed state is remembered');
        await evaluate(`document.getElementById('systemsToggle').click()`);
        assert.equal(await evaluate(`document.getElementById('systemsToggle').getAttribute('aria-expanded')`),'true','The header expands it again');
        assert.equal(await evaluate(`document.querySelector('[data-action="zoom-in"]').disabled`),true,'Tools disabled without a model');
        const model=fs.readdirSync('system_model').find(name=>name.endsWith('.glb'));
        await evaluate(`(async()=>{
            const request=async(path,method,body)=>(await (await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})).json());
            const system=(await request('anatomy-content.php','GET')).data[0];system.model_url=${JSON.stringify('/system_model/'+model)};
            await request('anatomy-content.php?id='+system.system_id,'PUT',system);
            await request('anatomy-content.php','POST',{system_name:'Hidden anatomy',system_code:'hidden-anatomy',is_active:false,color_hex:'#123456',structures:[],key_facts:{}});
        })()`);
        await navigate('/teacher/anatomy.html');
        for(let i=0;i<25;i++){if(await evaluate('AnatomyViewer.hasVisibleLayer()'))break;await new Promise(resolve=>setTimeout(resolve,400));}
        assert.ok(await evaluate('AnatomyViewer.hasVisibleLayer()'),'Teacher loads the real GLB');
        assert.equal(await evaluate(`document.querySelectorAll('#systemChips .system-chip').length`),2,'Teacher sees hidden systems');
        assert.equal(await evaluate(`document.querySelector('#systemChips .system-chip[aria-checked="true"]').dataset.system`),'test-system','The system with a model starts switched on');
        assert.match(await evaluate(`document.getElementById('systemsToggle').textContent`),/1 on/,'The systems button counts the systems switched on');
        await evaluate(`document.querySelector('.structure-chip').click();AnatomyExplorer.activeSeconds=10;AnatomyExplorer.flushExploration()`);
        assert.equal(await evaluate(`document.getElementById('selectedPartDescription').textContent`),'Database structure');
        assert.deepEqual(explorationPosts,[],'Teacher viewing never posts student exploration progress');
        assert.ok(await evaluate(`Boolean(document.querySelector('#relatedModules a[href*="module_id="]'))`),'Related module comes from database');
        assert.equal(await evaluate(`document.querySelector('[data-action="zoom-in"]').disabled`),false);
        await evaluate(`(()=>{const e=document.getElementById('explorer');e.requestFullscreen=undefined;e.webkitRequestFullscreen=undefined;document.querySelector('[data-action="fullscreen"]').click();})()`);
        await new Promise(resolve=>setTimeout(resolve,300));
        assert.ok(await evaluate(`(()=>{const r=document.getElementById('explorer').getBoundingClientRect();return r.top===0&&Math.abs(r.width-innerWidth)<=1&&Math.abs(r.height-innerHeight)<=1;})()`),'Fullscreen covers navigation');
        assert.equal(await evaluate(`document.querySelector('[data-action="fullscreen"]').getAttribute('aria-label')`),'Exit fullscreen');
        await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await new Promise(resolve=>setTimeout(resolve,300));
        assert.equal(await evaluate(`document.getElementById('explorer').classList.contains('is-pseudo-fullscreen')`),false,'Escape exits fullscreen');
        // A structure chip mapped to a part of a layered model shows the structure, even when the part's own system code differs.
        const editStructures=async layered=>evaluate(`(async()=>{
            const request=async(path,method,body)=>(await (await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})).json());
            const system=(await request('anatomy-content.php','GET')).data.find(s=>s.system_code==='test-system');
            system.model_url=${JSON.stringify('/system_model/'+model)};
            system.structures=system.structures.filter(s=>s.name!=='Mapped bone');
            if(${layered}){system.model_url='/system_model/layers/skeletal.glb';system.structures.push({name:'Mapped bone',desc:'A real part from the layered skeleton.',mesh_name:'za_femur_l'});}
            await request('anatomy-content.php?id='+system.system_id,'PUT',system);
        })()`);
        const setModel=(code,url)=>evaluate(`(async()=>{
            const request=async(path,method,body)=>(await (await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})).json());
            const system=(await request('anatomy-content.php','GET')).data.find(s=>s.system_code===${JSON.stringify(code)});
            system.model_url=${JSON.stringify(url)};
            await request('anatomy-content.php?id='+system.system_id,'PUT',system);
        })()`);
        const waitFor=async expression=>{for(let i=0;i<40;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,250));}};
        const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        await editStructures(true);
        await evaluate(`localStorage.setItem('anatomy.panelOpen','1')`);
        await navigate('/teacher/anatomy.html');
        await waitFor(`AnatomyViewer.layerState('test-system')?.status==='ready'`);
        assert.ok(await evaluate(`AnatomyViewer.renderer.outputEncoding===THREE.sRGBEncoding&&AnatomyViewer.renderer.toneMapping===THREE.ACESFilmicToneMapping&&!!AnatomyViewer.scene.environment`),'Realistic renderer: sRGB output, filmic tone mapping and environment lighting');
        assert.ok(await evaluate(`(()=>{const part=AnatomyViewer.layerState('test-system').parts.get('za_femur_l');let mesh=part.isMesh?part:null;if(!mesh)part.traverse(o=>{if(!mesh&&o.isMesh)mesh=o;});const bone=[].concat(mesh.userData.baseMaterial)[0];return bone.roughness===AnatomyLayersCore.TISSUE.bone.roughness&&'#'+bone.color.clone().convertLinearToSRGB().getHexString()===AnatomyLayersCore.TISSUE.bone.color;})()`),'The femur is coloured and finished like bone');
        assert.equal(await evaluate(`(()=>{let glowing=0;AnatomyViewer.layerState('test-system').root.traverse(o=>{if(o.isMesh)[].concat(o.userData.baseMaterial).forEach(m=>{if(m.emissive&&m.emissive.getHex()!==0)glowing++;});});return glowing;})()`),0,'No part glows: Z-Anatomy emissive white is removed');
        await evaluate(`[...document.querySelectorAll('.structure-chip')].find(b=>b.textContent==='Mapped bone').click()`);
        await new Promise(resolve=>setTimeout(resolve,300));
        assert.equal(await evaluate('AnatomyViewer.focusedPart?.userData.part_id'),'za_femur_l','Structure chip highlights its part');
        assert.equal(await evaluate(`document.getElementById('selectedPartTitle').textContent`),'Mapped bone','Card shows the clicked structure');
        assert.equal(await evaluate(`document.getElementById('selectedPartDescription').textContent`),'A real part from the layered skeleton.');
        assert.equal(await evaluate(`[...document.querySelectorAll('.structure-chip')].find(b=>b.textContent==='Mapped bone').getAttribute('aria-pressed')`),'true','Clicked structure chip is pressed');
        await sleep(1000);
        const partScreen=`(()=>{const p=AnatomyViewer.focusedPart;const c=new THREE.Box3().setFromObject(p).getCenter(new THREE.Vector3()).project(AnatomyViewer.camera);const e=document.getElementById('explorer').getBoundingClientRect();const panel=document.getElementById('infoPanel').getBoundingClientRect();return {x:(c.x+1)/2*e.width,y:(1-c.y)/2*e.height,panelLeft:panel.left-e.left,sheetTop:panel.top-e.top};})()`;
        const wide=await evaluate(partScreen);
        assert.ok(Math.abs(wide.x-wide.panelLeft/2)<24,'A selected part is centred in the area the panel leaves visible: '+JSON.stringify(wide));
        await evaluate(`document.getElementById('exitFocus').focus();document.getElementById('exitFocus').click()`);
        await sleep(300);
        assert.ok(await evaluate('document.activeElement!==document.body&&document.activeElement.getClientRects().length>0'),'Back to full body keeps keyboard focus in the panel');
        await evaluate(`(()=>{const parts=[...AnatomyViewer.layerState('test-system').parts.values()];const radius=p=>new THREE.Box3().setFromObject(p).getBoundingSphere(new THREE.Sphere()).radius;window.__small=parts.reduce((a,b)=>radius(a)<=radius(b)?a:b);AnatomyViewer.focusPart(window.__small);})()`);
        await sleep(1100);
        assert.ok(await evaluate(`(()=>{const s=new THREE.Box3().setFromObject(window.__small).getBoundingSphere(new THREE.Sphere());const fit=AnatomyLayersCore.fitDistance(s.radius,AnatomyViewer.camera.fov,AnatomyViewer.camera.aspect);const d=AnatomyViewer.camera.position.distanceTo(AnatomyViewer.controls.target);return Math.abs(d-fit)/fit<0.05;})()`),'The smallest part is framed at its fit distance, not the model-wide minimum');
        await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        await sleep(1200);
        const phone=await evaluate(partScreen);
        assert.ok(phone.y<phone.sheetTop,'On phones the selected part stays above the open sheet: '+JSON.stringify(phone));
        await call('Emulation.setDeviceMetricsOverride',{width:812,height:375,deviceScaleFactor:1,mobile:true});
        await sleep(600);
        assert.ok(await evaluate(`(()=>{const e=document.getElementById('explorer').getBoundingClientRect(),c=document.getElementById('systemsToggle').getBoundingClientRect();return [...document.querySelectorAll('.toolbar .tool-btn')].every(b=>{const r=b.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return r.top>=e.top&&r.bottom<=e.bottom&&!(x>=c.left&&x<=c.right&&y>=c.top&&y<=c.bottom)&&b.contains(document.elementFromPoint(x,y));});})()`),'Every toolbar button is reachable on a landscape phone');
        await call('Emulation.clearDeviceMetricsOverride');
        await sleep(500);
        await setModel('hidden-anatomy','/system_model/layers/urinary.glb');
        await navigate('/teacher/anatomy.html');
        await waitFor(`AnatomyViewer.layerState('test-system')?.status==='ready'`);
        await evaluate(`(()=>{const c=document.querySelector('.system-chip[data-system="hidden-anatomy"]');c.click();c.click();c.click();})()`);
        await waitFor(`AnatomyViewer.layerState('hidden-anatomy')?.status==='ready'`);
        await sleep(1500);
        assert.equal(await evaluate(`document.querySelector('.system-chip[data-system="test-system"]').getAttribute('aria-checked')`),'true','Other systems stay on after a chip is toggled off and on during its download');
        assert.equal(await evaluate('AnatomyViewer.world.children.length'),2,'Both layers are in the scene once');
        await editStructures(false);
        await navigate('/teacher/anatomy.html');
        await waitFor('AnatomyViewer.hasVisibleLayer()');
        await evaluate(`document.querySelector('.system-chip[data-system="hidden-anatomy"]').click()`);
        await waitFor(`AnatomyViewer.layerState('hidden-anatomy')?.status==='ready'`);
        await sleep(500);
        assert.ok(await evaluate(`new THREE.Box3().setFromObject(AnatomyViewer.layerState('hidden-anatomy').root).containsPoint(AnatomyViewer.controls.target)`),'Switching from a non-layered model frames the layered one');
        await setModel('hidden-anatomy','/system_model/layers/missing-file.glb');
        await navigate('/teacher/anatomy.html?system=hidden-anatomy');
        await waitFor(`!document.querySelector('.viewer__retry').hidden`);
        await evaluate(`document.querySelector('.viewer__retry').focus();document.querySelector('.viewer__retry').click()`);
        await sleep(1500);
        assert.ok(await evaluate('document.activeElement!==document.body&&document.activeElement.getClientRects().length>0'),'Retry keeps keyboard focus in the viewer');
        await setModel('hidden-anatomy','');
        await navigate('/teacher/anatomy.html');
        await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'),'Teacher explorer fits mobile');
        await call('Emulation.clearDeviceMetricsOverride');
        const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.runtime/teacher-anatomy.png',Buffer.from(shot.data,'base64'));
        await navigate('/teacher/anatomy.html?preview=student&system=hidden-anatomy');
        assert.equal(await evaluate(`document.querySelectorAll('#systemChips .system-chip').length`),1,'Student preview excludes hidden systems');
        assert.equal(await evaluate('AnatomyExplorer.contextSystem.id'),'test-system','Hidden requested system falls back to visible content');
        assert.equal(await evaluate(`Auth.getUser().role`),'teacher','Preview preserves teacher session');
    }
    if(page==='students'){
        assert.ok((await evaluate(`document.getElementById('studentListTbody').innerText`)).includes('Test Student'),'Student table loaded');
        assert.equal(await evaluate(`document.getElementById('studentCountBadge').textContent`),await evaluate(`document.getElementById('statTotal').textContent`),'Sidebar count matches loaded records');
        await evaluate(`document.getElementById('studentCountBadge').remove();loadStudents()`);
        assert.ok((await evaluate(`document.getElementById('studentListTbody').innerText`)).includes('Test Student'),'Missing optional sidebar badge cannot break the student table');
        await evaluate(`(async()=>{openModal('addStudentModal');const values={addFullName:'Browser Created Student',addSchoolId:'BROWSER-STUDENT',addUsername:'browser-student',addPassword:'browser-password-123',addSection:'Rizal',addSchoolYear:'Browser Year'};Object.entries(values).forEach(([id,value])=>document.getElementById(id).value=value);await handleAddStudent({preventDefault(){}});})()`);
        await new Promise(resolve=>setTimeout(resolve,350));
        assert.ok((await evaluate('document.body.innerText')).includes('Browser Created Student'),'Student form saves and reloads the database roster');
    }
    if(page==='games'){
        // Teacher Games page: a set made by pasting, turned off, the section lists and a new badge. Review Focus 1: pasted HTML stays text.
        const api=path=>evaluate(`fetch('/api/${path}').then(r=>r.json()).then(r=>r.data)`);
        const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        const shown=id=>`getComputedStyle(document.getElementById('${id}')).display!=='none'`;
        const pickSection=(id,value)=>evaluate(`(()=>{const s=document.getElementById('${id}');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        assert.ok(await waitFor(`document.querySelectorAll('#setRows tr[data-set-id]').length>0`),'The game sets list loads');
        assert.deepEqual(await evaluate(`[...document.querySelectorAll('#gamesTabs [role="tab"]')].map(t=>[t.textContent.trim(),t.getAttribute('aria-selected')])`),[['Game sets','true'],['Most-missed terms','false'],['Leaderboard','false'],['Badges','false']],'Four tabs, with Game sets selected');
        assert.ok(await evaluate(`[...document.querySelectorAll('#gamesTabs [role="tab"]')].every(t=>{const p=document.getElementById(t.getAttribute('aria-controls'));return p&&p.getAttribute('role')==='tabpanel'&&p.getAttribute('aria-labelledby')===t.id&&p.hidden===(t.getAttribute('aria-selected')!=='true');})`),'Each tab controls its own panel, and only the selected panel shows');
        await evaluate(`document.getElementById('tab-sets').focus()`);
        await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
        assert.ok(await evaluate(`document.activeElement.id==='tab-missed'&&document.getElementById('tab-missed').getAttribute('aria-selected')==='true'&&!document.getElementById('panel-missed').hidden`),'Arrow keys move between tabs');
        await evaluate(`document.getElementById('tab-sets').click()`);
        // A new set from four pasted lines.
        await evaluate(`document.getElementById('newSetBtn').click()`);
        assert.ok(await evaluate(`${shown('setModal')}&&document.getElementById('setModal').contains(document.activeElement)`),'New set opens the editor with focus inside it');
        const pasted=['<b>Pasted</b> term, Markup stays text','Radius, Forearm bone, thumb side, Arm','Ulna, Forearm bone, Arm','Humerus, Upper arm bone, Arm'];
        await evaluate(`(()=>{document.getElementById('setTitle').value='Browser pasted set';document.getElementById('pasteText').value=${JSON.stringify(pasted.join('\n'))};document.getElementById('pasteAdd').click();})()`);
        assert.deepEqual(await evaluate(`[...document.querySelectorAll('#cardRows tr')].map(r=>[...r.querySelectorAll('input')].map(i=>i.value))`),[['<b>Pasted</b> term','Markup stays text',''],['Radius','Forearm bone, thumb side','Arm'],['Ulna','Forearm bone','Arm'],['Humerus','Upper arm bone','Arm']],'Four pasted lines become four editable cards, the HTML term as typed');
        assert.equal(await evaluate(`document.querySelectorAll('#setModal b').length`),0,'No element is built from a pasted term');
        await evaluate(`document.getElementById('setSave').click()`);
        assert.ok(await waitFor(`!(${shown('setModal')})&&[...document.querySelectorAll('#setRows .tg-set-title')].some(e=>e.textContent==='Browser pasted set')`),'The new set appears in the list');
        const pastedRow=`[...document.querySelectorAll('#setRows tr[data-set-id]')].find(r=>r.querySelector('.tg-set-title').textContent==='Browser pasted set')`;
        assert.ok(await evaluate(`${pastedRow}.textContent.includes('4 cards')&&${pastedRow}.querySelector('.tg-status').textContent==='On'`),'The new set shows 4 cards and is on');
        assert.equal(await evaluate(`document.activeElement.id`),'newSetBtn','Saving returns focus to New set');
        assert.deepEqual((await api('games/sets.php')).find(s=>s.title==='Browser pasted set').cards,[{term:'<b>Pasted</b> term',clue:'Markup stays text'},{term:'Radius',clue:'Forearm bone, thumb side',group:'Arm'},{term:'Ulna',clue:'Forearm bone',group:'Arm'},{term:'Humerus',clue:'Upper arm bone',group:'Arm'}],'The set is saved with the pasted cards');
        await evaluate(`${pastedRow}.querySelector('[data-action="toggle"]').click()`);
        assert.ok(await waitFor(`${pastedRow}?.querySelector('.tg-status').textContent==='Off'`),'A set turned off shows as off');
        assert.equal(await evaluate(`${pastedRow}.querySelector('[data-action="toggle"]').textContent.trim()`),'Turn on','Its button now turns it back on');
        assert.equal((await api('games/sets.php')).find(s=>s.title==='Browser pasted set').is_active,false,'The set is saved as off');
        await evaluate(`${pastedRow}.querySelector('[data-action="edit"]').click()`);
        assert.equal(await evaluate(`document.querySelector('#cardRows .tg-term').value`),'<b>Pasted</b> term','The editor shows a saved HTML term as text');
        await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        assert.ok(await evaluate(`!(${shown('setModal')})&&document.activeElement===${pastedRow}.querySelector('[data-action="edit"]')`),'Escape closes the editor and focus returns to Edit');
        // Most-missed terms and the leaderboard, one section at a time.
        const sections=['Rizal','Bonifacio','Mabini','Luna'];
        for(const id of ['missedSection','boardSection'])assert.deepEqual(await evaluate(`[...document.getElementById('${id}').options].map(o=>o.value)`),sections,'The section picker lists the 4 sections: '+id);
        await evaluate(`document.getElementById('tab-missed').click()`);
        assert.equal(await evaluate(`document.getElementById('missedSection').value`),'Rizal','The section picker starts on the first section');
        const missed=(await api('games/mastery.php?section=Rizal')).map(row=>row.term);
        assert.ok(missed.length>0,'The fixture has missed terms in Rizal');
        assert.ok(await waitFor(`!document.getElementById('panel-missed').hidden&&document.querySelectorAll('#missedRows tr').length===${missed.length}`),'Most-missed terms load for the first section');
        assert.deepEqual(await evaluate(`[...document.querySelectorAll('#missedRows .tg-term-name')].map(e=>e.textContent)`),missed,'Most-missed terms keep the server order');
        assert.equal((await api('games/mastery.php?section=Luna')).length,0,'Luna has no missed terms in the fixture');
        await pickSection('missedSection','Luna');
        assert.ok(await waitFor(`!document.getElementById('missedEmpty').hidden&&document.querySelectorAll('#missedRows tr').length===0`),'A section without missed terms says so');
        await pickSection('missedSection','Rizal');
        await evaluate(`document.getElementById('tab-leaderboard').click()`);
        const board=(await api('games/leaderboard.php?section=Rizal')).top.map(row=>row.full_name);
        assert.ok(board.length>0,'The fixture has points in Rizal this week');
        assert.ok(await waitFor(`document.getElementById('boardSection').value==='Rizal'&&document.querySelectorAll('#boardRows tr').length===${board.length}`),'The leaderboard loads for the chosen section');
        assert.deepEqual(await evaluate(`[...document.querySelectorAll('#boardRows .tg-board-name')].map(e=>e.textContent)`),board,'Leaderboard names keep the server order');
        const other=(await api('games/leaderboard.php?section=Bonifacio')).top.map(row=>row.full_name);
        await pickSection('boardSection','Bonifacio');
        assert.ok(await waitFor(`JSON.stringify([...document.querySelectorAll('#boardRows .tg-board-name')].map(e=>e.textContent))===${JSON.stringify(JSON.stringify(other))}`),'Changing the section reloads the leaderboard');
        await pickSection('boardSection','Rizal');
        // Badges: built-ins can be turned off but not deleted; a new badge with the trophy icon.
        await evaluate(`document.getElementById('tab-badges').click()`);
        assert.ok(await waitFor(`document.querySelectorAll('#badgeRows tr.is-builtin').length===11`),'The badges list loads with the built-in badges');
        assert.ok(await evaluate(`[...document.querySelectorAll('#badgeRows tr.is-builtin')].every(r=>!r.querySelector('[data-action="delete"]')&&r.querySelector('[data-action="toggle"]'))`),'Built-in badges can be turned off but not deleted');
        await evaluate(`document.getElementById('newBadgeBtn').click()`);
        assert.ok(await evaluate(`${shown('badgeModal')}&&document.getElementById('badgeModal').contains(document.activeElement)`),'Add badge opens its dialog with focus inside it');
        assert.deepEqual(await evaluate(`[...document.querySelectorAll('input[name="badgeIcon"]')].map(i=>i.value)`),['game-controller','trophy','check-circle','target','flag','medal'],'The icon picker offers only the six badge icons');
        await evaluate(`(()=>{document.getElementById('badgeTitle').value='<i>Teacher badge</i>';document.getElementById('badgeMetric').value='total_points';document.getElementById('badgeThreshold').value='999999';document.querySelector('input[name="badgeIcon"][value="trophy"]').click();document.getElementById('badgeSave').click();})()`);
        const badgeRow=`[...document.querySelectorAll('#badgeRows tr[data-badge-id]')].find(r=>r.querySelector('.tg-badge-title').textContent==='<i>Teacher badge</i>')`;
        assert.ok(await waitFor(`!(${shown('badgeModal')})&&Boolean(${badgeRow})`),'The new badge appears in the list');
        assert.ok(await evaluate(`${badgeRow}.querySelector('use').getAttribute('href').endsWith('#trophy')&&!${badgeRow}.querySelector('i')&&Boolean(${badgeRow}.querySelector('[data-action="delete"]'))`),'It shows the trophy icon and its title as text, and can be deleted');
        const made=(await api('achievements.php')).find(b=>b.title==='<i>Teacher badge</i>');
        assert.ok(made&&made.icon==='trophy'&&made.metric==='total_points'&&Number(made.threshold)===999999,'The badge is saved with its metric, target and icon');
        // Phones: every tab and the set editor fit 375px.
        await call('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
        for(const tab of ['sets','missed','leaderboard','badges']){
            await evaluate(`document.getElementById('tab-${tab}').click()`);
            await wait(250);
            assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'The '+tab+' tab fits a 375px phone');
        }
        await evaluate(`document.getElementById('tab-sets').click();document.getElementById('newSetBtn').click()`);
        await wait(250);
        assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('#setModal .modal-box').getBoundingClientRect().right<=innerWidth`),'The set editor fits a 375px phone');
        await evaluate(`document.querySelector('#setModal .modal-close').click()`);
        await call('Emulation.clearDeviceMetricsOverride');
        await wait(250);
    }
    checked++;
}
// Germ Smash preview: a teacher plays a full Easy round. The tag stays up, and nothing is posted.
{
    const postsBeforePreview=playPosts.length;
    await navigate('/student/play.html?game=germ-smash&seed=2');
    assert.ok(await waitFor(`window.__gameDebug?.screen==='tap'`),'Germ Smash opens for a teacher');
    const tagShown=`(()=>{const tag=document.getElementById('previewTag');return !tag.hidden&&tag.textContent.trim()==="Preview: scores aren't saved"&&tag.getBoundingClientRect().width>0;})()`;
    assert.ok(await evaluate(tagShown),'A teacher sees the "Preview: scores aren\'t saved" tag');
    await evaluate(`document.getElementById('tapStart').click();document.querySelector('#s-menu [data-action="new"]').click()`);
    await evaluate(`document.querySelector('[data-level="easy"]').click();document.getElementById('startRound').click()`);
    assert.ok(await waitFor(`window.__gameDebug.screen==='playing'`,8000),'The teacher preview round starts');
    assert.ok(await evaluate(tagShown),'The preview tag stays visible during the round');
    assert.ok(await waitFor(`window.__gameDebug.screen==='over'`,75000),'The teacher preview round reaches game over');
    assert.ok(await evaluate(tagShown),'The preview tag is still visible at game over');
    assert.equal(await evaluate(`document.getElementById('saveStatus').textContent.trim()`),"Preview: scores aren't saved",'Game over in preview says the score is not saved');
    assert.equal(await evaluate(`document.getElementById('retrySave').hidden`),true,'Preview offers no Retry');
    await pause(500);
    assert.equal(playPosts.length,postsBeforePreview,'A teacher preview round posts nothing');
    await evaluate(`document.getElementById('overExit').click()`);
    assert.ok(await waitFor(`location.pathname==='/teacher/games.html'`),'Exit takes a teacher back to the teacher Games page');
}
// Prepare the existing isolated fixture for student browser checks.
const studentPassword='browser-test-'+Date.now();
const glb=fs.readdirSync('system_model').find(name=>name.endsWith('.glb'));
const browserQuiz=await evaluate(`(async()=>{
const request=async(path,method='GET',body)=>{const r=await fetch('/api/'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return r.json();};
const roster=await request('students.php');const student=roster.data.students.find(s=>s.username==='fixture-student');
await request('students.php?id='+student.user_id,'PUT',{is_active:true});
await request('auth/reset-password.php','POST',{action:'teacher_reset',student_id:student.user_id,new_password:${JSON.stringify(studentPassword)}});
const systems=await request('anatomy-content.php');const system=systems.data[0];system.model_url=${JSON.stringify('/system_model/'+glb)};
await request('anatomy-content.php?id='+system.system_id,'PUT',system);
const quiz=await request('assessments.php','POST',{title:'Browser Quiz',system_id:system.system_id,status:'active',time_limit_mins:5,max_attempts:2,passing_score:75});
await request('questions.php','POST',{assessment_id:quiz.data.assessment_id,question_type:'identification',question_text:'Type the browser term',hotspot_data:{target_label:'BrowserTerm'},points:1});
await Auth.logout();
return quiz.data.assessment_id;
})()`);
await new Promise(resolve=>setTimeout(resolve,700));
await evaluate(`document.getElementById('username').value='fixture-student';document.getElementById('password').value=${JSON.stringify(studentPassword)};handleLogin();`);
await waitFor(`location.pathname.startsWith('/student/') && document.readyState==='complete' && Boolean(document.querySelector('.sidebar-nav .nav-item'))`);
// Germ Smash on its own page. ?seed= makes the round reproducible and exposes window.__gameDebug.
{
    const screen=()=>evaluate(`window.__gameDebug?.screen`);
    const onScreen=name=>waitFor(`window.__gameDebug?.screen===${JSON.stringify(name)}`);
    // Enter needs its text ('\r') for the browser to press the focused button, as a real key would.
    const press=(key,code,keyCode)=>call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:keyCode,...(key==='Enter'?{text:'\r'}:{})}).then(()=>call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:keyCode}));
    const tap=async(x,y)=>{for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});};
    const focused=()=>evaluate('document.activeElement.textContent.trim()');
    const visibleButtons=id=>evaluate(`[...document.querySelectorAll('#${id} button')].filter(b=>b.getClientRects().length).map(b=>b.textContent.trim())`);
    const seconds=text=>{const [m,s]=text.split(':').map(Number);return m*60+s;};
    // Taps a fully risen germ through the real page (CDP mouse events at poreCenter) until the score goes up.
    const smashGerm=async()=>{
        for(let tries=0;tries<20;tries++){
            const target=await evaluate(`(()=>{const d=window.__gameDebug;const i=d.state.pores.findIndex(p=>p.kind==='germ'&&p.age>0.2&&p.upFor-p.age>0.45);return i<0?null:{i,score:d.state.score,...d.poreCenter(i)};})()`);
            if(target){await tap(target.x,target.y);if(await waitFor(`window.__gameDebug.state.score>${target.score}`,1000))return true;}
            await pause(150);
        }
        return false;
    };
    const setHidden=hidden=>evaluate(hidden?`Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))`:`delete document.visibilityState;delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))`);
    await navigate('/student/play.html?game=germ-smash&seed=1');
    assert.ok(!(await evaluate('location.pathname')).includes('login.html'),'A student can open the play page');
    assert.ok(await onScreen('tap'),'The loading screen gives way to Tap to start');
    assert.ok(await evaluate(`document.getElementById('s-loading').hidden&&document.querySelector('#s-loading [role="progressbar"]').getAttribute('aria-valuenow')==='100'`),'Loading filled its progress bar and closed');
    await evaluate(`document.getElementById('tapStart').click()`);
    assert.ok(await onScreen('menu'),'Tap to start opens the menu');
    assert.deepEqual(await visibleButtons('s-menu'),['New game','How to play','Settings','High scores','Exit to Games'],'The menu shows its five buttons');
    assert.equal(await focused(),'New game','Focus starts on New game');
    await press('ArrowDown','ArrowDown',40);
    assert.equal(await focused(),'How to play','Arrow Down moves through the menu');
    await press('Enter','Enter',13);
    assert.ok(await onScreen('how'),'Enter opens How to play');
    assert.ok(await evaluate(`document.querySelectorAll('#s-how .steps li').length>=3&&[...document.querySelectorAll('#s-how .steps use')].every(u=>/interface\\.svg\\?v=[^#]+#[a-z-]+$/.test(u.getAttribute('href')))`),'How to play lists its steps with sprite icons');
    assert.ok(await evaluate(`(()=>{const t=document.querySelector('#s-how .keys').textContent;return ['7','Q','V','1'].every(k=>t.includes(k));})()`),'How to play shows the keys for every grid');
    await evaluate(`document.querySelector('#s-how .back').click()`);
    assert.ok(await onScreen('menu'),'Back returns to the menu');
    assert.equal(await focused(),'How to play','Focus returns to the button that opened the screen');
    await evaluate(`document.querySelector('#s-menu [data-action="scores"]').click()`);
    assert.ok(await onScreen('scores'),'High scores opens');
    assert.ok((await evaluate(`document.getElementById('s-scores').textContent`)).includes('Scores appear after your first saved game'),'High scores waits for a first saved game');
    await press('Escape','Escape',27);
    assert.ok(await onScreen('menu'),'Escape goes back to the menu');
    // Settings: Music off survives a reload.
    await evaluate(`document.querySelector('#s-menu [data-action="settings"]').click()`);
    assert.ok(await onScreen('settings'),'Settings opens');
    assert.equal(await evaluate(`document.getElementById('setMusic').checked`),true,'Music starts on');
    await evaluate(`document.getElementById('setMusic').click()`);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('anthropotomy_game_settings')).music`),false,'Turning Music off is stored');
    await navigate('/student/play.html?game=germ-smash&seed=1');
    assert.ok(await onScreen('tap'));
    await evaluate(`document.getElementById('tapStart').click();document.querySelector('#s-menu [data-action="settings"]').click()`);
    assert.ok(await onScreen('settings'));
    assert.equal(await evaluate(`document.getElementById('setMusic').checked`),false,'Music stays off after a reload');
    await evaluate(`document.getElementById('setMusic').click()`);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('anthropotomy_game_settings')).music`),true,'Music can be turned back on');
    await evaluate(`document.querySelector('#s-settings .back').click()`);
    assert.ok(await onScreen('menu'));
    // New game, Easy, the countdown, then the HUD.
    await evaluate(`document.querySelector('#s-menu [data-action="new"]').click()`);
    assert.ok(await onScreen('new'),'New game opens the difficulty cards');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('#s-new [data-level]')].map(c=>c.querySelector('.mult').textContent)`),['×1','×1.5','×2'],'Each difficulty shows its points multiplier');
    await evaluate(`document.querySelector('[data-level="easy"]').click()`);
    assert.equal(await evaluate(`document.querySelector('[data-level="easy"]').getAttribute('aria-checked')`),'true','Easy is selected');
    await evaluate(`document.getElementById('startRound').click()`);
    assert.equal(await screen(),'countdown','Start begins the countdown');
    assert.ok(await onScreen('playing'),'The countdown ends and the round starts');
    assert.equal(await evaluate(`document.getElementById('hudScore').textContent`),'0','The HUD starts at 0');
    assert.equal(await evaluate(`document.getElementById('hudTimeText').textContent`),'1:00','The HUD starts at 1:00');
    assert.ok(await smashGerm(),'Tapping a germ where it is drawn raises the score');
    assert.equal(await evaluate(`document.getElementById('hudScore').textContent`),String(await evaluate('window.__gameDebug.state.score')),'The HUD shows the new score');
    await press('p','KeyP',80);
    assert.ok(await onScreen('paused'),'P pauses');
    assert.deepEqual(await visibleButtons('s-pause'),['Resume','Restart','Settings','Quit to menu'],'Pause offers Resume, Restart, Settings and Quit to menu');
    await press('Escape','Escape',27);
    assert.ok(await onScreen('playing'),'Escape resumes');
    // Review Focus 1: a hidden tab pauses the round and the paused time does not count.
    const timeBefore=await evaluate('window.__gameDebug.state.time');
    const hudBefore=seconds(await evaluate(`document.getElementById('hudTimeText').textContent`));
    await setHidden(true);
    assert.equal(await screen(),'paused','Hiding the page pauses the round');
    await pause(3000);
    await setHidden(false);
    assert.equal(await screen(),'paused','Coming back keeps the round paused until Resume');
    await evaluate(`document.getElementById('resumeBtn').click()`);
    assert.ok(await onScreen('playing'),'Resume returns to the round');
    const timeAfter=await evaluate('window.__gameDebug.state.time');
    assert.ok(timeAfter>=timeBefore&&timeAfter-timeBefore<1,`The round clock barely moved across a 3 s pause: ${timeBefore} -> ${timeAfter}`);
    assert.ok(Math.abs(hudBefore-seconds(await evaluate(`document.getElementById('hudTimeText').textContent`)))<=1,'The HUD time left changed by under a second');
    // Review Focus 2: a phone-sized viewport mid-round re-lays out the board, and a tap at a germ's new position hits it.
    const wideCenter=await evaluate('window.__gameDebug.poreCenter(0)');
    await call('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
    await pause(400);
    const phoneCenter=await evaluate('window.__gameDebug.poreCenter(0)');
    assert.ok(phoneCenter.x!==wideCenter.x&&phoneCenter.x>0&&phoneCenter.x<375,'The board is laid out again for the phone: '+JSON.stringify([wideCenter,phoneCenter]));
    assert.equal(await screen(),'playing','Resizing keeps the round going');
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'The round fits a 375px phone');
    const scoreBeforePhone=await evaluate('window.__gameDebug.state.score');
    assert.ok(await smashGerm(),'A tap at a germ\'s new position still hits it');
    assert.ok(await evaluate('window.__gameDebug.state.score')>scoreBeforePhone);
    await call('Emulation.clearDeviceMetricsOverride');
    // The round runs out; the shell posts the new body once (the server takes it from Task 4 on).
    const postsBeforeEnd=playPosts.length;
    assert.ok(await waitFor(`window.__gameDebug.screen==='over'`,75000),'The round reaches game over');
    const final=await evaluate('JSON.parse(JSON.stringify(window.__gameDebug.state))');
    assert.equal(await evaluate(`document.getElementById('overScore').textContent`),final.score.toLocaleString('en-US'),'Game over shows the score');
    assert.ok(await waitFor(`document.getElementById('saveStatus').textContent.trim()!=='Saving…'`),'The save settles');
    assert.equal(playPosts.length,postsBeforeEnd+1,'The round is posted once');
    const posted=JSON.parse(playPosts.at(-1));
    assert.deepEqual(Object.keys(posted).sort(),['difficulty','duration_sec','game_key','score','stats'],'The new plays body: '+playPosts.at(-1));
    assert.deepEqual([posted.game_key,posted.difficulty,posted.score,posted.duration_sec],['germ-smash','easy',final.score,60],'Game, difficulty, score and playing seconds (pause and countdown excluded)');
    assert.deepEqual(posted.stats,{hits:final.hits,misses:final.misses,friendly_hits:final.friendlyHits,best_combo:final.bestCombo},'The round stats');
    const saveStatus=await evaluate(`document.getElementById('saveStatus').textContent.trim()`);
    if(playResponses.at(-1)===422){
        assert.equal(saveStatus,"This score couldn't be saved",'A 422 says the score could not be saved');
        assert.equal(await evaluate(`document.getElementById('retrySave').hidden`),true,'A 422 offers no Retry');
    }else{
        assert.ok(playResponses.at(-1)<300&&saveStatus.startsWith('Saved'),'A saved round says so: '+saveStatus);
    }
    assert.deepEqual(await visibleButtons('s-over'),['Play again','Main menu','Exit to Games'],'Game over offers Play again, Main menu and Exit');
    assert.match(await evaluate(`document.getElementById('overStars').getAttribute('aria-label')`),/^[0-3] of 3 stars$/,'Game over shows the stars');
    await evaluate(`document.getElementById('overMenu').click()`);
    assert.ok(await onScreen('menu'),'Main menu returns to the menu');
    assert.equal(await evaluate(`document.getElementById('menuBest').textContent`),final.score.toLocaleString('en-US'),'The menu shows the best score');
    await call('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
    await pause(300);
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1&&document.getElementById('panel').getBoundingClientRect().right<=innerWidth`),'The menu fits a 375px phone');
    await call('Emulation.clearDeviceMetricsOverride');
    // No debug hook without a seed; an unknown game says so.
    await navigate('/student/play.html?game=germ-smash');
    assert.ok(await waitFor(`!document.getElementById('s-tap').hidden`),'The game loads without a seed');
    assert.equal(await evaluate('typeof window.__gameDebug'),'undefined','No debug hook without ?seed=');
    for(const key of ['nope','constructor','']){
        await navigate('/student/play.html?game='+key);
        assert.ok(await waitFor(`!document.getElementById('s-missing').hidden`),'An unknown game shows its own screen: '+key);
        assert.ok((await evaluate('document.body.innerText')).includes("That game doesn't exist"),'It says the game does not exist');
        assert.ok(await evaluate(`document.getElementById('missingExit').getClientRects().length>0`),'It offers a way back to the Games page');
    }
    await evaluate(`document.getElementById('missingExit').click()`);
    assert.ok(await waitFor(`location.pathname==='/student/games.html'`),'Back to Games takes a student to the student Games page');
}
for(const page of ['dashboard','lessons','quiz','progress','scores','notifications','settings','anatomy']){
    await navigate('/student/'+page+'.html');
    assert.ok(!(await evaluate('location.pathname')).includes('login.html'),'Student stays authenticated: '+page);
    if(page==='quiz'){
        await evaluate(`initiateQuiz(${browserQuiz})`);
        assert.equal(await evaluate('questions.length'),1,'Quiz questions loaded');
        await evaluate(`(async()=>{handleIdentificationInput('BrowserTerm');await saveQuizDraft();})()`);
        const previous=await evaluate('currentSubmissionId');
        await navigate('/student/quiz.html');await evaluate(`initiateQuiz(${browserQuiz})`);
        assert.equal(await evaluate('currentSubmissionId'),previous,'Browser resumes same attempt');
        assert.equal(await evaluate('userAnswers[0].response_text'),'BrowserTerm','Browser restores saved answer');
        await evaluate('submitQuiz()');
        assert.equal(await evaluate(`document.getElementById('resultScore').textContent`),'100%','Quiz submission displays correct result');
    }
    if(page==='anatomy'){
        for(let i=0;i<25;i++){if(await evaluate('AnatomyViewer.hasVisibleLayer()'))break;await new Promise(resolve=>setTimeout(resolve,400));}
        assert.equal(await evaluate('AnatomyData.systems[0].description'),'Database description');
        assert.ok(await evaluate('AnatomyViewer.hasVisibleLayer()'),'Real GLB model loaded');
        assert.ok(await evaluate('document.documentElement.scrollHeight<=innerHeight+1'),'Explorer page does not scroll');
        assert.ok(await evaluate(`(()=>{const r=document.getElementById('explorer').getBoundingClientRect();return Math.abs(r.bottom-innerHeight)<=1&&Math.abs(r.top-document.querySelector('.topbar').getBoundingClientRect().bottom)<=1;})()`),'Viewer fills the content area');
        assert.equal(await evaluate(`document.querySelectorAll('.model-tools, #zoomIn, #exportModel, .page-content').length`),0,'No text buttons below the viewer');
        assert.equal(await evaluate(`document.querySelector('[data-action="zoom-in"]').disabled`),false,'Tools enabled with a model');
        const desktop={width:1280,height:800,deviceScaleFactor:1,mobile:false};
        await call('Emulation.setDeviceMetricsOverride',desktop);
        await evaluate(`localStorage.removeItem('anatomy.panelOpen')`);
        await navigate('/student/anatomy.html');
        assert.equal(await evaluate(`document.querySelector('[data-action="info"]').getAttribute('aria-expanded')`),'true','Panel opens by default on desktop');
        const canvasWidth=await evaluate(`document.getElementById('anatomyCanvas').clientWidth`);
        await evaluate(`document.querySelector('[data-action="info"]').click()`);
        assert.equal(await evaluate(`document.querySelector('[data-action="info"]').getAttribute('aria-expanded')`),'false');
        assert.equal(await evaluate(`document.getElementById('anatomyCanvas').clientWidth`),canvasWidth,'Panel does not resize the canvas');
        await navigate('/student/anatomy.html');
        assert.equal(await evaluate(`document.getElementById('infoPanel').classList.contains('is-open')`),false,'Panel state persists after reload');
        await evaluate(`document.querySelector('[data-action="info"]').click()`);
        assert.equal(await evaluate(`localStorage.getItem('anatomy.panelOpen')`),'1');
        for(let i=0;i<25;i++){if(await evaluate('AnatomyViewer.hasVisibleLayer()'))break;await new Promise(resolve=>setTimeout(resolve,400));}
        // Force the fallback path so the check is deterministic; native fullscreen is verified manually.
        await evaluate(`(()=>{const e=document.getElementById('explorer');e.requestFullscreen=undefined;e.webkitRequestFullscreen=undefined;document.querySelector('[data-action="fullscreen"]').click();})()`);
        await new Promise(resolve=>setTimeout(resolve,300));
        assert.ok(await evaluate(`document.getElementById('explorer').classList.contains('is-pseudo-fullscreen')`),'Fullscreen fallback is active');
        assert.ok(await evaluate(`getComputedStyle(document.querySelector('.toolbar')).visibility==='visible'&&getComputedStyle(document.getElementById('infoPanel')).visibility==='visible'`),'Toolbar and panel stay visible in fullscreen');
        await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await new Promise(resolve=>setTimeout(resolve,300));
        assert.equal(await evaluate(`document.getElementById('explorer').classList.contains('is-pseudo-fullscreen')`),false,'Escape leaves fullscreen');
        await evaluate(`window.__saved=null;window.__click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__saved=this.download;return;}return window.__click.call(this);};document.querySelector('[data-action="save"]').click()`);
        for(let i=0;i<20&&!(await evaluate('window.__saved'));i++)await new Promise(resolve=>setTimeout(resolve,150));
        await evaluate(`HTMLAnchorElement.prototype.click=window.__click`);
        assert.match(await evaluate('window.__saved')||'',/^anatomy-test-system-\d{8}\.png$/,'Save image downloads a PNG named after the system and date');
        await evaluate(`document.querySelector('[data-action="reset"]').focus()`);
        await new Promise(resolve=>setTimeout(resolve,400));
        assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-action="reset"]'),'::after').opacity`),'1','Tooltip shows on keyboard focus');
        const chip=await evaluate(`document.querySelector('.system-chip[aria-checked="true"]').dataset.system`);
        const before=await evaluate('AnatomyViewer.renderer.info.memory.geometries');
        await evaluate(`document.querySelector('.system-chip[aria-checked="true"]').click()`);
        await new Promise(resolve=>setTimeout(resolve,300));
        assert.equal(await evaluate(`AnatomyViewer.layerState(${JSON.stringify(chip)})`),null,'Switching off disposes the layer');
        assert.ok(await evaluate('AnatomyViewer.renderer.info.memory.geometries')<before,'Geometries are released');
        assert.equal(await evaluate(`document.querySelector('[data-action="zoom-in"]').disabled`),true,'Tools disabled without a visible model');
        assert.equal(await evaluate(`document.querySelector('[data-action="fullscreen"]').disabled`),false,'Fullscreen stays enabled');
        await evaluate(`(()=>{const c=document.querySelector('.system-chip[data-system=${JSON.stringify(chip)}]');c.click();c.click();})()`);
        await new Promise(resolve=>setTimeout(resolve,4000));
        assert.equal(await evaluate('AnatomyViewer.world.children.length'),0,'A model switched off mid-download never joins the scene');
        await evaluate(`document.querySelector('.system-chip[data-system=${JSON.stringify(chip)}]').click()`);
        for(let i=0;i<25;i++){if(await evaluate('AnatomyViewer.hasVisibleLayer()'))break;await new Promise(resolve=>setTimeout(resolve,400));}
        await evaluate(`document.querySelector('.structure-chip').click()`);
        assert.equal(await evaluate(`document.getElementById('selectedPartDescription').textContent`),'Database structure');
        assert.equal(await evaluate(`document.querySelector('.structure-chip').getAttribute('aria-pressed')`),'true');
        assert.equal(await evaluate(`document.getElementById('sysDescription').hidden`),false,'Description shows');
        assert.ok(await evaluate(`[...document.querySelectorAll('#sysSources a')].every(a=>a.target==='_blank'&&a.rel==='noopener noreferrer'&&/^https?:/.test(a.href))`),'Source links are safe');
        assert.ok(await evaluate(`document.getElementById('sysTrivia').hidden||document.getElementById('triviaText').textContent.length>0`),'Trivia renders when present');
        assert.equal(await evaluate(`document.getElementById('sysStructures').hidden`),false,'Structures section never hides');
        // test-system has no data.js entry; its only trivia is the fixture key fact {Fact: 'Database fact'}.
        assert.equal(await evaluate(`document.getElementById('sysFunctions').hidden`),true,'Empty functions section hides');
        assert.equal(await evaluate(`document.getElementById('triviaText').textContent`),'Fact: Database fact');
        assert.equal(await evaluate(`document.getElementById('triviaNext').hidden`),true,'Single fact hides Next');
        const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.runtime/student-anatomy.png',Buffer.from(shot.data,'base64'));
        await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        await new Promise(resolve=>setTimeout(resolve,300));
        assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'),'Mobile anatomy page fits viewport');
        assert.equal(await evaluate(`document.querySelector('.toolbar').getAttribute('aria-orientation')`),'horizontal','Mobile toolbar is horizontal');
        await call('Emulation.setDeviceMetricsOverride',desktop);
        await new Promise(resolve=>setTimeout(resolve,300));
        assert.equal(await evaluate(`document.querySelector('.toolbar').getAttribute('aria-orientation')`),'vertical','Desktop toolbar is vertical again');
        await call('Emulation.clearDeviceMetricsOverride');
    }
    checked++;
}
// Practice games. Review Focus 1: a teacher card whose term is HTML plays and shows as literal text.
const teacherApi=(()=>{let cookie='';return async(path,method='GET',body)=>{const response=await fetch(base+'/api/'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const received=response.headers.getSetCookie();if(received.length)cookie=received.map(c=>c.split(';')[0]).join('; ');return response.json();};})();
assert.ok((await teacherApi('auth/login.php','POST',credentials)).success,'Teacher signs in to add game content');
const xssTerm='<img src=x onerror=window.__xss=1>';
const setCards=[{term:xssTerm,clue:'Markup that must stay text'},{term:'Femur',clue:'Thigh bone'},{term:'Tibia',clue:'Shin bone'},{term:'Patella',clue:'Kneecap'}];
const xssSet=await teacherApi('games/sets.php','POST',{title:'Browser <b>set</b>',system_id:null,cards:setCards});
assert.ok(xssSet.success,'Teacher makes a set whose first term is HTML');
assert.ok((await teacherApi('anatomy-content.php','POST',{system_name:'Endocrine System',system_code:'endocrine',color_hex:'#2ccf9a',description:'Glands',is_active:true,key_facts:{},structures:[],model_url:'/system_model/layers/endocrine.glb'})).success,'Add the endocrine system with its layered model');
const gamesPlayed=await evaluate(`fetch('/api/games/badges.php').then(r=>r.json()).then(r=>r.data.find(b=>b.metric==='games_played').value)`);
assert.ok((await teacherApi('achievements.php','POST',{title:'<i>Browser badge</i>',metric:'games_played',threshold:gamesPlayed+1,icon:'trophy'})).success,'Add a badge the next round earns');
const pickPool=value=>evaluate(`(()=>{const select=document.getElementById('gamePool');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const gameCard=key=>`document.querySelector('#gameCards .game-card[data-game="${key}"]')`;
// Reads every tile while Easy shows them face up, then matches the set's cards in order. With missFirst,
// the first term is first paired with the second card's clue, so both of those cards count as missed.
const playMatchPairs=async({missFirst})=>{
    assert.ok(await waitFor(`document.querySelectorAll('#gameRun .game-tile.is-up').length===${setCards.length*2}`),'Easy shows every tile first');
    const faces=await evaluate(`[...document.querySelectorAll('#gameRun .game-tile')].map(tile=>tile.textContent)`);
    assert.ok(await waitFor(`document.querySelectorAll('#gameRun .game-tile.is-up').length===0`),'The tiles turn face down after the preview');
    const flip=async text=>{assert.ok(faces.includes(text),'A tile shows '+text);await evaluate(`document.querySelectorAll('#gameRun .game-tile')[${faces.indexOf(text)}].click()`);await pause(150);};
    if(missFirst){
        await flip(setCards[0].term);await flip(setCards[1].clue);
        assert.ok(await waitFor(`document.querySelectorAll('#gameRun .game-tile.is-up').length===0`),'A wrong pair turns back over');
    }
    for(const card of setCards){await flip(card.term);await flip(card.clue);}
    return faces;
};
const resultStats=()=>evaluate(`Object.fromEntries([...document.querySelectorAll('#gameRun .game-results [data-stat]')].map(e=>[e.dataset.stat,e.textContent.trim()]))`);
await evaluate(`localStorage.removeItem('anthropotomy_game_difficulty')`);
await navigate('/student/games.html');
assert.ok(!(await evaluate('location.pathname')).includes('login.html'),'Student stays authenticated: games');
assert.ok(await waitFor(`document.querySelectorAll('#gameCards .game-card').length===5`),'The page shows one card per game');
const poolNames=await evaluate(`[...document.getElementById('gamePool').options].map(o=>o.textContent)`);
assert.ok(poolNames[0]==='All systems'&&poolNames.includes('Endocrine System')&&poolNames.includes('Leg bones')&&poolNames.includes('Browser <b>set</b>'),'The pool picker lists all systems, each system with cards and each set, titles as text: '+JSON.stringify(poolNames));
assert.equal(await evaluate(`document.querySelector('input[name="gameDifficulty"]:checked').value`),'medium','Difficulty starts on Medium');
assert.deepEqual(await evaluate(`[...document.querySelectorAll('input[name="gameDifficulty"]')].map(input=>input.closest('label').textContent.replace(/\\s+/g,' ').trim())`),['Easy ×1','Medium ×1.5','Hard ×2'],'Each difficulty shows its points multiplier');
assert.equal(await evaluate(`document.getElementById('leaderboardTitle').textContent`),'This week in your section','Leaderboard heading');
assert.ok(await waitFor(`document.querySelectorAll('#leaderboardList li').length===10&&document.querySelector('#leaderboardList li.is-me')?.textContent.includes('Test Student')&&document.getElementById('leaderboardMe').hidden`),'The board lists the top ten and highlights the student instead of repeating their rank');
assert.equal(await evaluate(`document.getElementById('badgesTitle').textContent`),'Badges','Badges heading');
assert.ok(await waitFor(`document.querySelectorAll('#badgeList .game-badge.is-earned').length>0&&document.querySelectorAll('#badgeList .game-badge:not(.is-earned)').length>0`),'The badges list shows earned and locked badges');
assert.ok(await evaluate(`[...document.querySelectorAll('#badgeList .game-badge:not(.is-earned)')].some(b=>/\\d+ \\/ 10,?000/.test(b.textContent))`),'A locked badge shows progress toward its target');
assert.ok(await evaluate(`${gameCard('hunt-3d')}.classList.contains('is-unavailable')&&${gameCard('hunt-3d')}.querySelector('.game-play').disabled`),'3D Hunt needs a single body system');
await call('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
await pause(400);
assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'The Games picker fits a 375px phone');
await call('Emulation.clearDeviceMetricsOverride');
await pause(300);
await pickPool('set:'+xssSet.data.set_id);
assert.ok(await evaluate(`${gameCard('match-pairs')}.classList.contains('is-unavailable')&&${gameCard('match-pairs')}.querySelector('.game-play').disabled&&${gameCard('match-pairs')}.textContent.includes('Needs at least 6 terms')`),'Medium Match Pairs needs 6 terms, so a 4-card set greys it out with the reason');
await evaluate(`document.querySelector('input[name="gameDifficulty"][value="easy"]').click()`);
assert.equal(await evaluate(`localStorage.getItem('anthropotomy_game_difficulty')`),'easy','The chosen difficulty is remembered');
assert.ok(await evaluate(`!${gameCard('match-pairs')}.classList.contains('is-unavailable')&&!${gameCard('match-pairs')}.querySelector('.game-play').disabled`),'Easy Match Pairs plays a 4-card set');
// Round 1: one wrong pair first, then every match.
await evaluate(`${gameCard('match-pairs')}.querySelector('.game-play').click()`);
assert.ok(await evaluate(`document.getElementById('gamesPicker').hidden&&!document.getElementById('gamePlay').hidden`),'The game takes over the page');
assert.equal(await evaluate(`document.querySelectorAll('#gamePlay .game-back, #gamePlay .game-again').length`),0,'A running round offers no way back');
const faces=await playMatchPairs({missFirst:true});
assert.ok(faces.includes(xssTerm),'The HTML term is shown on its tile as text');
assert.ok(await waitFor(`Boolean(document.querySelector('#gameRun .game-results'))`),'The results screen appears');
assert.equal(await evaluate('typeof window.__xss'),'undefined','A term made of HTML never runs');
assert.equal(await evaluate(`document.querySelectorAll('#gamePlay img, .game-toasts img').length`),0,'No element is built from the term');
assert.ok(await waitFor(`document.querySelector('#gameRun .game-save').textContent.includes('Saved')`),'The round is saved');
assert.deepEqual(await resultStats(),{correct:'2 / 4',points:'24',streak:'2'},'Results show correct of total, the server points and the best streak');
assert.deepEqual(await evaluate(`[...document.querySelectorAll('#gameRun .game-missed-term')].map(e=>e.textContent)`),[xssTerm,'Femur'],'The missed cards are listed, the HTML term as literal text');
assert.ok(await evaluate(`[...document.querySelectorAll('#gameRun .game-missed li')].some(li=>li.textContent.includes('Markup that must stay text'))`),'Missed cards show their clues');
assert.ok((await evaluate('document.body.innerText')).includes(xssTerm),'The term is visible on the page as typed');
const firstRound=JSON.parse(playPosts.at(-1));
assert.ok(firstRound.game_key==='match-pairs'&&firstRound.difficulty==='easy'&&firstRound.set_id===xssSet.data.set_id&&!('system_code' in firstRound)&&firstRound.duration_sec>=4,'The round posts its game, difficulty, set and duration: '+JSON.stringify(firstRound).slice(0,160));
assert.deepEqual(firstRound.results.map(r=>[r.card_key,r.term,r.correct]),setCards.map((card,i)=>['set:'+xssSet.data.set_id+':'+card.term.toLowerCase(),card.term,i>1]),'Each card is posted once, in the order it was decided');
assert.ok(await waitFor(`[...document.querySelectorAll('.game-toasts .game-toast')].some(t=>t.textContent.includes('<i>Browser badge</i>')&&t.querySelector('use')?.getAttribute('href').endsWith('#trophy')&&!t.querySelector('i'))`),'A new badge pops up with its icon and its title as text');
await call('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
await pause(400);
assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'The results screen fits a 375px phone');
await call('Emulation.clearDeviceMetricsOverride');
await pause(300);
// Round 2, from Play again, with the network down: the results still show, and Retry sends the same round.
await call('Fetch.enable',{patterns:[{urlPattern:'*/api/games/plays.php*'}]});
const offline=event=>{const data=JSON.parse(event.data);if(data.method==='Fetch.requestPaused')call('Fetch.failRequest',{requestId:data.params.requestId,errorReason:'InternetDisconnected'}).catch(()=>{});};
socket.addEventListener('message',offline);
const postsBefore=playPosts.length;
await evaluate(`document.querySelector('#gameRun .game-again').click()`);
await playMatchPairs({missFirst:false});
assert.ok(await waitFor(`document.querySelector('#gameRun .game-results .game-save')?.textContent.includes("Couldn't save this round")`),'A failed save still shows the results');
assert.equal((await resultStats()).correct,'4 / 4','The unsaved round still shows its score');
assert.equal(await evaluate(`document.querySelector('#gameRun .game-retry').hidden`),false,'Retry is offered');
socket.removeEventListener('message',offline);
await call('Fetch.disable');
await evaluate(`document.querySelector('#gameRun .game-retry').click()`);
assert.ok(await waitFor(`document.querySelector('#gameRun .game-save').textContent.includes('Saved')`),'Retry saves the round');
assert.equal(playPosts.length,postsBefore+2,'One failed post and one retry');
assert.equal(playPosts.at(-1),playPosts.at(-2),'Retry resends the same request body');
assert.deepEqual(await resultStats(),{correct:'4 / 4',points:'48',streak:'4'},'The retried round shows its points');
assert.equal(await evaluate(`document.querySelector('#gameRun .game-retry').hidden`),true,'Retry goes away once saved');
// Round 3: 3D Hunt on the smallest system. The engine hands onPartClick the part under a click.
await evaluate(`document.querySelector('#gameRun .game-back').click()`);
assert.ok(await evaluate(`!document.getElementById('gamesPicker').hidden&&document.getElementById('gamePlay').hidden`),'Choose another game returns to the picker');
await pickPool('sys:endocrine');
assert.ok(await evaluate(`!${gameCard('hunt-3d')}.classList.contains('is-unavailable')`),'3D Hunt is offered for one body system');
await evaluate(`${gameCard('hunt-3d')}.querySelector('.game-play').click()`);
assert.ok(await waitFor(`/^Find: /.test(document.querySelector('#gameRun .game-hunt-3d:not(.is-loading) .game-prompt')?.textContent||'')`,30000),'3D Hunt loads the endocrine model and names a part');
assert.ok(await evaluate(`document.querySelector('#gameRun .game-viewer').getBoundingClientRect().height>200`),'The 3D viewer has room on the page');
await evaluate(`(()=>{const term=document.querySelector('#gameRun .game-prompt').textContent.slice(6);AnatomyViewer.onPartClick([...AnatomyViewer.layerState('endocrine').parts.values()].find(part=>part.userData.name===term));})()`);
for(let i=0;i<2;i++){await pause(1200);await evaluate(`document.querySelector('#gameRun .game-skip').click()`);await pause(1700);}
assert.ok(await waitFor(`document.querySelector('#gameRun .game-results .game-save')?.textContent.includes('Saved')`),'The 3D Hunt round ends with saved results');
const huntRound=JSON.parse(playPosts.at(-1));
assert.ok(huntRound.game_key==='hunt-3d'&&huntRound.difficulty==='easy'&&huntRound.system_code==='endocrine'&&!('set_id' in huntRound),'A system round posts its system code: '+JSON.stringify(huntRound).slice(0,160));
assert.deepEqual(huntRound.results.map(r=>r.correct),[true,false,false],'A found part scores; skipped parts are missed');
assert.ok(huntRound.results.every(r=>r.card_key.startsWith('sys:endocrine:')),'3D Hunt cards are keyed to the system');
assert.equal(await evaluate('AnatomyViewer.world.children.length'),0,'The model is released after the round');
checked++;
await call('Page.close');socket.close();
assert.deepEqual(errors,[],'No uncaught browser exceptions');
console.log(`Browser pages checked: ${checked}; real GLB load and mobile layout passed.`);
