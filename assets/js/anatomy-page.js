'use strict';
const teacherExplorer=document.body.dataset.anatomyRole==='teacher';
const studentPreview=teacherExplorer && new URLSearchParams(location.search).get('preview')==='student';
let selectedSystem=null, activeSeconds=0, lastTick=Date.now(), interactions=0, viewed=new Set(), viewerReady=false, contextVersion=0, focusVersion=0;
const enabledOrder=[]; // ids of switched-on systems, oldest first
const modelMessage=document.getElementById('modelMessage');
const toggleBox=document.getElementById('systemToggles');
const anatomyEl=id=>document.getElementById(id);
const IDLE_HINT='Select a part of the model or a structure below.';
const textInfo=(title,description,systemName='')=>({title,description,systemName,unidentified:false,func:'',alsoPartOf:[],reference:''});

// ── Part info panel ──
function systemNames(){return Object.fromEntries(AnatomyData.systems.map(s=>[s.id,s.name]));}
function structureFor(part){
    if(part.userData.structure)return part.userData.structure;
    return AnatomyLayersCore.matchStructure(AnatomyData.getSystem(part.userData.system_id)?.structures,part);
}
function renderInfo(info,focused){
    anatomyEl('structureTitle').textContent=info.title;
    anatomyEl('structureSystem').textContent=info.systemName?'System: '+info.systemName:'';
    anatomyEl('structureBadge').hidden=!info.unidentified;
    anatomyEl('structureDescription').textContent=info.description;
    anatomyEl('structureFunction').textContent=info.func;anatomyEl('structureFunctionRow').hidden=!info.func;
    const also=anatomyEl('structureAlso');also.textContent=info.alsoPartOf.length?'Also part of: '+info.alsoPartOf.join(', '):'';also.hidden=!info.alsoPartOf.length;
    const reference=anatomyEl('structureReference');reference.href=info.reference||'#';reference.hidden=!info.reference;
    anatomyEl('exitFocus').hidden=!focused;
}
function recordView(name){if(name){viewed.add(name);interactions++;}}
async function focusOnPart(part){
    const version=++focusVersion;
    AnatomyViewer.focusPart(part);
    const system=AnatomyData.getSystem(part.userData.system_id);
    if(system && system!==selectedSystem)await setContext(system);
    if(version!==focusVersion)return;
    const structure=structureFor(part);
    renderInfo(AnatomyLayersCore.partInfo(part.userData,systemNames(),structure),true);
    recordView(structure?.name||part.userData.name);
}
function exitFocus(){
    focusVersion++;
    if(viewerReady)AnatomyViewer.clearFocus();
    renderInfo(textInfo('Choose a structure',IDLE_HINT),false);
}
function showStructure(structure){
    const part=viewerReady?AnatomyViewer.findPart(structure.mesh_name):null;
    if(part){focusOnPart(part);return;}
    focusVersion++;
    if(viewerReady)AnatomyViewer.clearFocus();
    renderInfo(textInfo(structure.name,structure.desc||'No description provided.',selectedSystem?.name),false);
    recordView(structure.name);
}
function handlePartClick(part){if(part)focusOnPart(part);else if(AnatomyViewer.focusedPart)exitFocus();}

// ── Context system: the side panel shows the system of the last clicked part or last switched-on system ──
async function flushExploration(){
    if(teacherExplorer || !selectedSystem || activeSeconds<1)return;
    const payload={system_id:selectedSystem.system_id,duration_secs:Math.floor(activeSeconds),interactions,structures_viewed:[...viewed]};
    activeSeconds=0;interactions=0;viewed.clear();
    try{const response=await fetch(API_BASE+'/analytics/exploration.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),credentials:'same-origin',keepalive:true});if(!response.ok)console.warn('Exploration progress could not be saved.');}catch(error){console.warn('Exploration progress could not be saved.');}
}
async function setContext(system){
    const version=++contextVersion;
    await flushExploration(); if(version!==contextVersion)return;
    selectedSystem=system;
    document.dispatchEvent(new CustomEvent('anatomysystemselected',{detail:system}));
    anatomyEl('systemTitle').textContent=system.name;
    anatomyEl('systemDescription').textContent=system.description || 'Your teacher has not added a description yet.';
    anatomyEl('systemSources').textContent=system.source;
    const facts=anatomyEl('systemFacts');facts.replaceChildren();
    Object.entries(system.keyFacts).forEach(([key,value])=>{const item=document.createElement('p');const strong=document.createElement('strong');strong.textContent=key+': ';item.append(strong,document.createTextNode(value));facts.append(item);});
    const structures=anatomyEl('structures');structures.replaceChildren();
    system.structures.forEach(s=>{const button=document.createElement('button');button.className='structure-button';button.textContent=s.name;button.onclick=()=>showStructure(s);structures.append(button);});
    if(!system.structures.length)structures.textContent='No structures added yet.';
    anatomyEl('practicePrompt').textContent='';anatomyEl('practiceResult').textContent='';anatomyEl('practiceChoices').replaceChildren();
    anatomyEl('practiceButton').disabled=system.structures.filter(s=>s.desc).length<2;
    if(!AnatomyViewer.focusedPart)renderInfo(textInfo('Choose a structure',IDLE_HINT),false);
    updateStage();
}

// ── System toggles ──
function createToggle(system){
    const button=document.createElement('button');button.type='button';button.className='system-toggle';button.dataset.system=system.id;
    button.setAttribute('role','switch');button.setAttribute('aria-checked','false');
    const dot=document.createElement('span');dot.className='system-toggle-dot';dot.style.setProperty('--system-color',system.color||'#64748b');
    const name=document.createElement('span');name.className='system-toggle-name';name.textContent=system.name+(teacherExplorer&&!studentPreview&&!system.isActive?' (hidden)':'');
    const status=document.createElement('span');status.className='system-toggle-status';
    button.append(dot,name,status);button.onclick=()=>toggleSystem(system);
    return button;
}
function renderToggle(system){
    const button=toggleBox.querySelector(`[data-system="${CSS.escape(system.id)}"]`);if(!button)return;
    button.setAttribute('aria-checked',String(enabledOrder.includes(system.id)));
    button.querySelector('.system-toggle-status').textContent=AnatomyLayersCore.toggleStatus(system,viewerReady?AnatomyViewer.layerState(system.id):null);
}
function renderAll(){AnatomyData.systems.forEach(renderToggle);updateStage();}
function updateStage(){
    const loading=enabledOrder.map(id=>AnatomyViewer.layerState(id)).find(state=>state&&state.status==='loading');
    let message='';
    if(!viewerReady)message='3D viewing is unavailable on this device. You can still read the anatomy content.';
    else if(AnatomyViewer.hasVisibleLayer())message='';
    else if(loading)message=loading.progress==null?'Loading model…':`Loading model: ${loading.progress}%`;
    else if(selectedSystem && !selectedSystem.modelUrl)message='No 3D model has been added for this system. You can read the available content alongside the viewer.';
    else if(AnatomyData.systems.some(s=>AnatomyViewer.layerState(s.id)?.status==='error'))message='The model could not be loaded. Select the system again to retry, or contact your teacher.';
    else message='Switch on a body system to begin.';
    modelMessage.textContent=message;modelMessage.style.display=message?'grid':'none';
    anatomyEl('layerNote').hidden=!enabledOrder.some(id=>{const state=AnatomyViewer.layerState(id);return state&&state.status==='ready'&&!state.layered;});
}
function disableSystem(id){
    const index=enabledOrder.indexOf(id);if(index<0)return;
    const next=AnatomyLayersCore.contextAfterDisable(enabledOrder,id,selectedSystem?.id);
    enabledOrder.splice(index,1);
    AnatomyViewer.setLayerVisible(AnatomyData.getSystem(id),false);
    if(!AnatomyViewer.focusedPart && !anatomyEl('exitFocus').hidden)exitFocus(); // the focused part's layer was switched off
    if(next && next!==selectedSystem?.id)setContext(AnatomyData.getSystem(next));
}
async function toggleSystem(system){
    if(!viewerReady || !system.modelUrl){await setContext(system);return;}
    if(enabledOrder.includes(system.id)){disableSystem(system.id);renderAll();return;}
    enabledOrder.push(system.id);
    setContext(system);
    renderAll();
    const layer=await AnatomyViewer.setLayerVisible(system,true,()=>{renderToggle(system);updateStage();});
    if(!enabledOrder.includes(system.id)){renderAll();return;} // switched off while loading
    if(layer.status==='error')enabledOrder.splice(enabledOrder.indexOf(system.id),1);
    else if(layer.status==='ready'){
        // A model made outside the layered export has its own frame, so it is never mixed with other layers.
        for(const other of [...enabledOrder]){
            if(other===system.id)continue;
            const state=AnatomyViewer.layerState(other);
            if(!layer.layered || (state && state.status==='ready' && !state.layered))disableSystem(other);
        }
        if(!layer.layered)AnatomyViewer.resetView();
    }
    renderAll();
}

// ── Practice and viewer tools ──
anatomyEl('practiceButton').onclick=()=>{
    const entries=selectedSystem?.structures.filter(s=>s.desc)||[];if(entries.length<2)return;
    const target=entries[Math.floor(Math.random()*entries.length)];
    anatomyEl('practicePrompt').textContent=target.desc;
    anatomyEl('practiceResult').textContent='';const list=anatomyEl('practiceChoices');list.replaceChildren();
    const shuffled=[...entries];for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
    const choices=[target,...shuffled.filter(s=>s!==target).slice(0,3)].sort(()=>Math.random()-.5);
    choices.forEach(s=>{const button=document.createElement('button');button.className='btn btn-secondary';button.textContent=s.name;button.onclick=()=>{anatomyEl('practiceResult').textContent=s===target?'Correct. '+target.desc:'Try again. Read the description carefully.';};list.append(button);});
};
anatomyEl('exitFocus').onclick=exitFocus;
anatomyEl('resetModel').onclick=()=>{if(!viewerReady)return;if(AnatomyViewer.focusedPart)exitFocus();AnatomyViewer.resetView();};
anatomyEl('zoomIn').onclick=()=>viewerReady&&AnatomyViewer.zoom(.85);
anatomyEl('zoomOut').onclick=()=>viewerReady&&AnatomyViewer.zoom(1.15);
anatomyEl('rotateModel').onclick=e=>{if(viewerReady){AnatomyViewer.controls.autoRotate=!AnatomyViewer.controls.autoRotate;e.target.setAttribute('aria-pressed',String(AnatomyViewer.controls.autoRotate));}};
anatomyEl('exportModel').onclick=()=>viewerReady&&AnatomyViewer.hasVisibleLayer()&&AnatomyViewer.screenshot();
// Capture phase, so Escape leaves focus before it can also leave presentation mode.
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&viewerReady&&AnatomyViewer.focusedPart){event.stopImmediatePropagation();exitFocus();}},true);
if(!teacherExplorer){
setInterval(()=>{const now=Date.now();if(!document.hidden && selectedSystem)activeSeconds+=Math.min((now-lastTick)/1000,2);lastTick=now;},1000);
setInterval(flushExploration,45000);window.addEventListener('pagehide',flushExploration);
document.addEventListener('visibilitychange',()=>{lastTick=Date.now();if(document.hidden)flushExploration();});
}
(async()=>{
    if(!await Auth.requireAuth(teacherExplorer?'teacher':'student'))return;
    try{
        await AnatomyData.load();
        if(studentPreview)AnatomyData.systems=AnatomyData.systems.filter(s=>s.isActive);
        const systems=AnatomyData.systems;toggleBox.replaceChildren();
        if(!systems.length){toggleBox.textContent='No body systems yet.';modelMessage.textContent='No anatomy content has been published yet.';anatomyEl('systemTitle').textContent='Anatomy content is coming soon';return;}
        try{AnatomyViewer.init(anatomyEl('anatomyCanvas'));AnatomyViewer.onPartClick=handlePartClick;AnatomyViewer.labelFor=part=>structureFor(part)?.name||part.userData.name;viewerReady=true;}catch(error){console.warn('3D viewing is unavailable.',error);}
        systems.forEach(s=>toggleBox.append(createToggle(s)));
        const params=new URLSearchParams(location.search);
        const lessonId=studentPreview?null:params.get('lesson_id');
        if(lessonId){const response=await fetch(API_BASE+'/lessons.php?id='+encodeURIComponent(lessonId));const result=await response.json();if(result.success && /\.glb$/i.test(result.data.media_url||'')){const system=AnatomyData.getSystem(result.data.system_code);if(system){system.modelUrl=result.data.media_url;system.name=result.data.title;}}}
        const first=AnatomyData.getSystem(params.get('system'))||systems.find(s=>s.modelUrl)||systems[0];
        await toggleSystem(first);
        renderAll();
    }catch(error){modelMessage.textContent='Unable to load anatomy content. Reload the page to try again.';}
})();
