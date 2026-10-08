// Teacher extras for the explorer, loaded by main.js only on teacher/anatomy.html:
// the preview status line, Student preview / Edit content links, related lessons for the
// context system, and keeping ?system= in the URL in sync. Teacher exploration sends no analytics.
export function initTeacher({preview}) {
    const tools = document.getElementById('teacherTools');
    const status = Object.assign(document.createElement('p'), {
        id: 'previewStatus', className: 'info-hint',
        textContent: preview
            ? 'Student preview: only student-visible systems are shown. Your teacher account remains signed in.'
            : 'Teacher view includes systems hidden from students.'
    });
    status.setAttribute('role', 'status');
    const previewLink = Object.assign(document.createElement('a'), {
        id: 'previewToggle', className: 'panel-btn',
        textContent: preview ? 'Return to teacher view' : 'Student preview',
        href: preview ? 'anatomy.html' : 'anatomy.html?preview=student'
    });
    const editLink = Object.assign(document.createElement('a'), {id: 'editAnatomy', className: 'panel-btn', textContent: 'Edit content', href: 'content.html', hidden: preview});
    const links = Object.assign(document.createElement('div'), {className: 'teacher-tools__links'});
    links.append(previewLink, editLink);
    tools.append(status, links);
    tools.hidden = false;

    const related = document.getElementById('relatedContent');
    const relatedModules = document.getElementById('relatedModules');
    related.hidden = preview;
    let requestVersion = 0;

    return {
        async onContext(system) {
            const version = ++requestVersion;
            editLink.href = 'content.html?system=' + encodeURIComponent(system.id);
            previewLink.href = 'anatomy.html?' + new URLSearchParams({...(!preview ? {preview: 'student'} : {}), system: system.id});
            const url = new URL(location.href); url.searchParams.set('system', system.id); history.replaceState(null, '', url);
            if (preview) return;
            relatedModules.textContent = 'Loading related modules...';
            try {
                const response = await fetch(API_BASE + '/modules.php?system=' + encodeURIComponent(system.id), {credentials: 'same-origin'});
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error('Unable to load related lessons.');
                if (version !== requestVersion) return;
                relatedModules.replaceChildren();
                if (!result.data.length) relatedModules.textContent = 'No modules or lessons are linked to this system yet. ';
                result.data.forEach(module => {
                    const link = Object.assign(document.createElement('a'), {className: 'panel-btn', href: 'modules.html?module_id=' + encodeURIComponent(module.module_id)});
                    link.textContent = module.title + ' (' + module.status + ')';
                    relatedModules.append(link);
                });
                relatedModules.append(Object.assign(document.createElement('a'), {className: 'panel-btn', href: 'modules.html', textContent: 'Manage modules and lessons'}));
            } catch {
                if (version === requestVersion) relatedModules.textContent = 'Related lessons could not be loaded. Select the system again to retry.';
            }
        }
    };
}
