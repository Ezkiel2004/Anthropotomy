/* Shared portal sidebars. Keep navigation changes here so every page stays consistent. */
'use strict';
(() => {
    const host=document.currentScript.parentElement;
    const templates={
        teacher: `<div class="sidebar-logo">
      <div class="sidebar-logo-icon"><img src="../assets/brand/mark-96.png" alt="" width="36" height="36"/></div>
      <div class="sidebar-logo-text">
        <div class="sidebar-logo-name">Anthropotomy</div>
        <div class="sidebar-logo-sub">Teacher Portal</div>
      </div>
    </div>

    <nav class="sidebar-nav">
      <div class="nav-section-label">Main</div>
      <a class="nav-item" href="../index.html" data-tooltip="Home">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#house"/></svg></span>
        <span class="nav-label">Home</span>
      </a>
      <a class="nav-item" href="dashboard.html" data-tooltip="Dashboard">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#layout"/></svg></span>
        <span class="nav-label">Dashboard</span>
      </a>
      <a class="nav-item" href="modules.html" data-tooltip="Modules">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#book-open"/></svg></span>
        <span class="nav-label">Modules and Lessons</span>
      </a>
      <a class="nav-item" href="students.html" data-tooltip="Students">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#users"/></svg></span>
        <span class="nav-label">Students</span>
        <span class="nav-badge" id="studentCountBadge">0</span>
      </a>
      <a class="nav-item" href="assessments.html" data-tooltip="Assessments">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#exam"/></svg></span>
        <span class="nav-label">Assessments</span>
      </a>

      <div class="nav-section-label">Management</div>
      <a class="nav-item" href="monitoring.html" data-tooltip="Monitoring">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#pulse"/></svg></span>
        <span class="nav-label">Monitoring</span>
      </a>
      <a class="nav-item" href="reports.html" data-tooltip="Reports">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#chart-bar"/></svg></span>
        <span class="nav-label">Reports</span>
      </a>
      <a class="nav-item" href="announcements.html" data-tooltip="Announcements">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#megaphone"/></svg></span>
        <span class="nav-label">Announcements</span>
        <span class="nav-badge">0</span>
      </a>

      <div class="nav-section-label">System</div>
      <a class="nav-item" href="settings.html" data-tooltip="Settings">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#gear"/></svg></span>
        <span class="nav-label">Settings</span>
      </a>
<a class="nav-item" href="anatomy.html" data-tooltip="3D Anatomy Explorer"><span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#cube"/></svg></span><span class="nav-label">3D Anatomy Explorer</span></a></nav>
`,
        student: `<div class="sidebar-logo">
      <div class="sidebar-logo-icon"><img src="../assets/brand/mark-96.png" alt="" width="36" height="36"/></div>
      <div class="sidebar-logo-text">
        <div class="sidebar-logo-name">Anthropotomy</div>
        <div class="sidebar-logo-sub">Student Portal</div>
      </div>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-section-label">Learning</div>
      <a class="nav-item" href="../index.html" data-tooltip="Home">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#house"/></svg></span>
        <span class="nav-label">Home</span>
      </a>
      <a class="nav-item" href="dashboard.html" data-tooltip="Dashboard">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#layout"/></svg></span>
        <span class="nav-label">Dashboard</span>
      </a>
      <a class="nav-item" href="anatomy.html" data-tooltip="3D Anatomy">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#cube"/></svg></span>
        <span class="nav-label">3D Anatomy Explorer</span>
      </a>
      <a class="nav-item" href="lessons.html" data-tooltip="Lessons">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#book-open"/></svg></span>
        <span class="nav-label">My Lessons</span>
      </a>
      <a class="nav-item" href="quiz.html" data-tooltip="Quizzes">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#exam"/></svg></span>
        <span class="nav-label">Quizzes and Activities</span>
        <span class="nav-badge" style="display:none;">0</span>
      </a>
      <a class="nav-item" href="games.html" data-tooltip="Games">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#game-controller"/></svg></span>
        <span class="nav-label">Games</span>
      </a>
      <div class="nav-section-label">My Progress</div>
      <a class="nav-item" href="progress.html" data-tooltip="Progress">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#chart-line"/></svg></span>
        <span class="nav-label">My Progress &amp; Scores</span>
      </a>
    </nav>
`
    };
    const template=templates[host.dataset.portal];
    if(!template)return;
    host.innerHTML=template;
    const current=location.pathname.split('/').pop();
    host.querySelectorAll('.nav-item').forEach(link=>{
        const label=link.querySelector('.nav-label').textContent.trim();
        link.dataset.tooltip=label;
        link.title=label;
        if(link.getAttribute('href')===current){link.classList.add('active');link.setAttribute('aria-current','page');}
        // A new page URL also bypasses HTML cached before revalidation was enabled.
        const destination=new URL(link.href);
        destination.searchParams.set('nav','20261005-brand1');
        link.href=destination.pathname+destination.search;
    });
    // Student phones get a bottom tab bar instead of the drawer (styled in stage-portal.css).
    if(host.dataset.portal!=='student')return;
    const tabs=[['dashboard','house','Home'],['anatomy','cube','3D'],['lessons','book-open','Lessons'],['quiz','exam','Quizzes'],['progress','chart-line','Progress']];
    const pending=Number(sessionStorage.getItem('anthropotomy_pending_assessments'))||0;
    host.insertAdjacentHTML('afterend',`<nav class="sd-tabbar" aria-label="Student sections">${tabs.map(([page,glyph,label])=>`<a href="${page}.html"${current===page+'.html'?' aria-current="page"':''}><svg viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#${glyph}"/></svg><span>${label}</span>${page==='quiz'?`<span class="sd-tab-badge" id="tabQuizBadge"${pending>0?'':' hidden'}>${pending}</span>`:''}</a>`).join('')}</nav>`);
})();
