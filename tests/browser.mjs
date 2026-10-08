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
const explorationPosts=[];
socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.method==='Network.requestWillBeSent' && data.params.request.method==='POST' && data.params.request.url.includes('/analytics/exploration.php'))explorationPosts.push(data.params.request.url);});
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
assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-primary-cta]')].map(a=>a.getAttribute('href'))`),['login.html#register','login.html#register'],'Primary CTAs open registration');
assert.ok(await evaluate(`[...document.querySelectorAll('a[href]')].filter(a=>a.textContent.trim()==='Sign in').every(a=>a.getAttribute('href')==='login.html#login')`),'Sign in links open the login view');
await navigate('/login.html#register');
assert.ok(await evaluate(`!document.getElementById('registerView').hidden && document.getElementById('loginView').hidden`),'Register deep link opens the registration form');
await navigate('/login.html');
await evaluate(`document.getElementById('username').value=${JSON.stringify(credentials.username)};document.getElementById('password').value=${JSON.stringify(credentials.password)};handleLogin();`);
await new Promise(resolve=>setTimeout(resolve,1200));
assert.ok((await evaluate('location.pathname')).includes('/teacher/'),'Teacher login redirects');
let checked=0;
for(const page of ['dashboard','students','modules','assessments','monitoring','reports','announcements','media','settings','content','anatomy']){
    await navigate('/teacher/'+page+'.html');
    assert.ok(!(await evaluate('location.pathname')).includes('login.html'),'Teacher stays authenticated: '+page);
    if(page==='dashboard')assert.equal(await evaluate(`document.querySelector('#anatomyShortcutTitle').parentElement.parentElement.querySelector('a').getAttribute('href')`),'anatomy.html','Dashboard links to teacher explorer');
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
        const editPath=await evaluate(`new URL(document.getElementById('editAnatomy').href).pathname+new URL(document.getElementById('editAnatomy').href).search`);
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
            if(${layered}){system.model_url='/system_model/layers/skeletal.glb';system.structures.push({name:'Mapped bone',desc:'A real part from the layered skeleton.',mesh_name:'anatomy_00053'});}
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
        assert.equal(await evaluate(`(()=>{let mesh;AnatomyViewer.layerState('test-system').root.traverse(o=>{if(!mesh&&o.isMesh)mesh=o;});return mesh.userData.baseMaterial.roughness;})()`),0.8,'Bone gets a matte finish');
        await evaluate(`[...document.querySelectorAll('.structure-chip')].find(b=>b.textContent==='Mapped bone').click()`);
        await new Promise(resolve=>setTimeout(resolve,300));
        assert.equal(await evaluate('AnatomyViewer.focusedPart?.userData.part_id'),'anatomy_00053','Structure chip highlights its part');
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
        assert.equal(await evaluate(`getComputedStyle(document.getElementById('editAnatomy')).display`),'none');
        assert.equal(await evaluate(`Auth.getUser().role`),'teacher','Preview preserves teacher session');
        await navigate(editPath);
        assert.equal(await evaluate(`document.getElementById('content_system_code').value`),'test-system','Edit link opens selected system');
    }
    if(page==='students'){
        assert.ok((await evaluate(`document.getElementById('studentListTbody').innerText`)).includes('Test Student'),'Student table loaded');
        assert.equal(await evaluate(`document.getElementById('studentCountBadge').textContent`),await evaluate(`document.getElementById('statTotal').textContent`),'Sidebar count matches loaded records');
        await evaluate(`document.getElementById('studentCountBadge').remove();loadStudents()`);
        assert.ok((await evaluate(`document.getElementById('studentListTbody').innerText`)).includes('Test Student'),'Missing optional sidebar badge cannot break the student table');
        await evaluate(`(async()=>{openModal('addStudentModal');const values={addFullName:'Browser Created Student',addSchoolId:'BROWSER-STUDENT',addUsername:'browser-student',addPassword:'browser-password-123',addSection:'Browser Section',addGrade:'Browser Grade',addSchoolYear:'Browser Year'};Object.entries(values).forEach(([id,value])=>document.getElementById(id).value=value);await handleAddStudent({preventDefault(){}});})()`);
        await new Promise(resolve=>setTimeout(resolve,350));
        assert.ok((await evaluate('document.body.innerText')).includes('Browser Created Student'),'Student form saves and reloads the database roster');
    }
    if(page==='content'){
        assert.equal(await evaluate(`document.querySelector('[name="school_name"]').value`),'Integration School');
        await evaluate(`document.getElementById('systemSelect').value=contentSystems[0].system_id;editSystem(contentSystems[0].system_id);`);
        assert.equal(await evaluate(`document.getElementById('content_system_name').value`),'Test System');
        const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.runtime/teacher-content.png',Buffer.from(shot.data,'base64'));
    }
    checked++;
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
await new Promise(resolve=>setTimeout(resolve,1200));
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
await call('Page.close');socket.close();
assert.deepEqual(errors,[],'No uncaught browser exceptions');
console.log(`Browser pages checked: ${checked}; real GLB load and mobile layout passed.`);
