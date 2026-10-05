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
        const model=fs.readdirSync('system_model').find(name=>name.endsWith('.glb'));
        await evaluate(`(async()=>{
            const request=async(path,method,body)=>(await (await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})).json());
            const system=(await request('anatomy-content.php','GET')).data[0];system.model_url=${JSON.stringify('/system_model/'+model)};
            await request('anatomy-content.php?id='+system.system_id,'PUT',system);
            await request('anatomy-content.php','POST',{system_name:'Hidden anatomy',system_code:'hidden-anatomy',is_active:false,color_hex:'#123456',structures:[],key_facts:{}});
        })()`);
        await navigate('/teacher/anatomy.html');
        for(let i=0;i<25;i++){if(await evaluate('Boolean(AnatomyViewer.root)'))break;await new Promise(resolve=>setTimeout(resolve,400));}
        assert.ok(await evaluate('Boolean(AnatomyViewer.root)'),'Teacher loads the real GLB');
        assert.equal(await evaluate(`document.querySelectorAll('#systemSelect option').length`),2,'Teacher sees hidden systems');
        await evaluate(`document.querySelector('.structure-button').click();activeSeconds=10;flushExploration()`);
        assert.equal(await evaluate(`document.getElementById('structureDescription').textContent`),'Database structure');
        assert.deepEqual(explorationPosts,[],'Teacher viewing never posts student exploration progress');
        assert.ok(await evaluate(`Boolean(document.querySelector('#relatedModules a[href*="module_id="]'))`),'Related module comes from database');
        const editPath=await evaluate(`new URL(document.getElementById('editAnatomy').href).pathname+new URL(document.getElementById('editAnatomy').href).search`);
        await evaluate(`document.getElementById('presentationToggle').click()`);
        assert.equal(await evaluate(`getComputedStyle(document.getElementById('sidebar')).display`),'none','Presentation hides navigation');
        assert.equal(await evaluate(`document.getElementById('presentationToggle').getAttribute('aria-pressed')`),'true');
        await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        assert.equal(await evaluate(`document.body.classList.contains('anatomy-presenting')`),false,'Escape exits presentation');
        await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'),'Teacher explorer fits mobile');
        await call('Emulation.clearDeviceMetricsOverride');
        const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.runtime/teacher-anatomy.png',Buffer.from(shot.data,'base64'));
        await navigate('/teacher/anatomy.html?preview=student&system=hidden-anatomy');
        assert.equal(await evaluate(`document.querySelectorAll('#systemSelect option').length`),1,'Student preview excludes hidden systems');
        assert.equal(await evaluate('selectedSystem.id'),'test-system','Hidden requested system falls back to visible content');
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
        for(let i=0;i<25;i++){if(await evaluate('Boolean(AnatomyViewer.root)'))break;await new Promise(resolve=>setTimeout(resolve,400));}
        assert.equal(await evaluate('AnatomyData.systems[0].description'),'Database description');
        assert.ok(await evaluate('Boolean(AnatomyViewer.root)'),'Real GLB model loaded');
        await evaluate(`document.querySelector('.structure-button').click()`);
        assert.equal(await evaluate(`document.getElementById('structureDescription').textContent`),'Database structure');
        const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.runtime/student-anatomy.png',Buffer.from(shot.data,'base64'));
        await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        await new Promise(resolve=>setTimeout(resolve,300));
        assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'),'Mobile anatomy page fits viewport');
    }
    checked++;
}
await call('Page.close');socket.close();
assert.deepEqual(errors,[],'No uncaught browser exceptions');
console.log(`Browser pages checked: ${checked}; real GLB load and mobile layout passed.`);
