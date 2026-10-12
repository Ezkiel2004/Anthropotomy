'use strict';
let contentSystems = [];
const contentFields = ['system_name','system_code','color_hex','description','sort_order','model_url','source_text'];
async function contentRequest(url, options = {}) {
    const response = await fetch(API_BASE + url, {credentials:'same-origin', ...options});
    const result = await response.json();
    if (!result.success) throw new Error(result.message);
    return result.data;
}
function contentRow(kind, data = {}) {
    const row = document.createElement('div'); row.className = 'content-row';
    const fields = kind === 'fact' ? [['label','Fact label'],['value','Fact value']] : [['name','Structure name'],['desc','Description'],['mesh_name','Model part name (optional)']];
    for (const [name,label] of fields) {
        const wrapper = document.createElement('label'); wrapper.textContent = label;
        const input = document.createElement(name === 'desc' ? 'textarea' : 'input');
        input.dataset.field = name; input.value = data[name] || ''; input.required = name !== 'mesh_name';
        wrapper.append(input); row.append(wrapper);
    }
    const remove = document.createElement('button'); remove.type='button'; remove.className='btn btn-secondary'; remove.textContent='Remove'; remove.onclick=()=>row.remove(); row.append(remove);
    document.getElementById(kind === 'fact' ? 'factRows' : 'structureRows').append(row);
}
function editSystem(id = '') {
    const row = contentSystems.find(s => String(s.system_id) === String(id)) || {};
    document.getElementById('systemEditor').reset();
    document.getElementById('systemId').value = id;
    contentFields.forEach(key => document.getElementById('content_'+key).value = row[key] ?? (key === 'color_hex' ? '#3b82f6' : key === 'sort_order' ? 0 : ''));
    document.getElementById('content_is_active').checked = row.is_active ?? true;
    document.getElementById('factRows').replaceChildren(); document.getElementById('structureRows').replaceChildren();
    Object.entries(row.key_facts || {}).forEach(([label,value]) => contentRow('fact',{label,value}));
    (row.structures || []).forEach(s => contentRow('structure',s));
}
async function refreshContent() {
    const [systems, layers] = await Promise.all([
        contentRequest('/anatomy-content.php'),
        fetch('../system_model/layers/manifest.json').then(r => r.ok ? r.json() : {}).catch(() => ({}))
    ]);
    contentSystems=systems;
    const select=document.getElementById('systemSelect'); select.replaceChildren(new Option('Create a body system',''));
    systems.forEach(s => select.add(new Option(s.system_name + (s.is_active ? '' : ' (hidden)'),s.system_id)));
    const models=document.getElementById('modelChoices'); models.replaceChildren();
    Object.entries(layers).forEach(([code, layer]) => { const option=document.createElement('option'); option.value='../system_model/layers/'+layer.file; option.label=code; models.append(option); });
    document.getElementById('contentStatus').textContent=systems.length ? 'Choose a system to edit its learning content.' : 'No body systems yet. Create your first system below.';
}
document.getElementById('systemSelect').onchange=e=>editSystem(e.target.value);
document.getElementById('addFact').onclick=()=>contentRow('fact');
document.getElementById('addStructure').onclick=()=>contentRow('structure');
document.getElementById('systemEditor').onsubmit=async e=> {
    e.preventDefault(); const button=document.getElementById('saveContent'); button.disabled=true;
    try {
        const body={}; contentFields.forEach(key=>body[key]=document.getElementById('content_'+key).value.trim());
        body.is_active=document.getElementById('content_is_active').checked;
        body.key_facts={}; document.querySelectorAll('#factRows .content-row').forEach(row=>{body.key_facts[row.querySelector('[data-field="label"]').value.trim()]=row.querySelector('[data-field="value"]').value.trim();});
        body.structures=[...document.querySelectorAll('#structureRows .content-row')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value.trim()])));
        const id=document.getElementById('systemId').value;
        const result=await contentRequest('/anatomy-content.php'+(id?'?id='+id:''),{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        await refreshContent(); document.getElementById('systemSelect').value=result.system_id; editSystem(result.system_id); showToast('Anatomy content saved.','success');
    } catch(error) {showToast(error.message,'error');} finally {button.disabled=false;}
};
document.getElementById('schoolEditor').onsubmit=async e=> {
    e.preventDefault(); const button=e.target.querySelector('button'); button.disabled=true;
    try {await contentRequest('/config.php',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))}); showToast('School settings saved.','success'); await SiteConfig.load();}
    catch(error){showToast(error.message,'error');} finally{button.disabled=false;}
};
(async()=>{
    if (!await Auth.requireAuth('teacher')) return;
    try {
        const settings=await contentRequest('/config.php');
        Object.entries(settings).forEach(([key,value])=>{const input=document.querySelector('#schoolEditor [name="'+key+'"]');if(input)input.value=value;});
        await refreshContent();
        const requested=new URLSearchParams(location.search).get('system');
        const selected=contentSystems.find(system=>system.system_code===requested);
        document.getElementById('systemSelect').value=selected?.system_id || '';
        editSystem(selected?.system_id || '');
        if(selected)document.getElementById('systemEditor').scrollIntoView({block:'start'});
    } catch(error){document.getElementById('contentStatus').textContent=error.message;}
})();

async function refreshGoals(){const rows=await contentRequest('/achievements.php');const list=document.getElementById('achievementRules');list.replaceChildren();if(!rows.length)list.textContent='No goals configured.';rows.forEach(row=>{const item=document.createElement('p');item.textContent=row.title+' — target: '+row.threshold+' ';const button=document.createElement('button');button.type='button';button.className='btn btn-secondary btn-sm';button.textContent='Remove';button.onclick=async()=>{try{await contentRequest('/achievements.php?id='+row.achievement_id,{method:'DELETE'});await refreshGoals();}catch(error){showToast(error.message,'error');}};item.append(button);list.append(item);});}
document.getElementById('achievementEditor').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{await contentRequest('/achievements.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});e.target.reset();await refreshGoals();}catch(error){showToast(error.message,'error');}finally{button.disabled=false;}};
refreshGoals().catch(error=>document.getElementById('achievementRules').textContent=error.message);
