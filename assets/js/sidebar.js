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
      <a class="nav-item" href="dashboard.html" data-tooltip="Dashboard">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#layout"/></svg></span>
        <span class="nav-label">Dashboard</span>
      </a>
      <a class="nav-item" href="modules.html" data-tooltip="Modules">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#book-open"/></svg></span>
        <span class="nav-label">Modules and Lessons</span>
      </a>
      <a class="nav-item" href="students.html" data-tooltip="Students">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#users"/></svg></span>
        <span class="nav-label">Students</span>
        <span class="nav-badge" id="studentCountBadge">0</span>
      </a>
      <a class="nav-item" href="assessments.html" data-tooltip="Assessments">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#exam"/></svg></span>
        <span class="nav-label">Assessments</span>
      </a>

      <div class="nav-section-label">Management</div>
      <a class="nav-item" href="monitoring.html" data-tooltip="Monitoring">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#pulse"/></svg></span>
        <span class="nav-label">Monitoring</span>
      </a>
      <a class="nav-item" href="reports.html" data-tooltip="Reports">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#chart-bar"/></svg></span>
        <span class="nav-label">Reports</span>
      </a>
      <a class="nav-item" href="announcements.html" data-tooltip="Announcements">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#megaphone"/></svg></span>
        <span class="nav-label">Announcements</span>
        <span class="nav-badge">0</span>
      </a>
      <a class="nav-item" href="media.html" data-tooltip="Media Library">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#image"/></svg></span>
        <span class="nav-label">Media Library</span>
      </a>

      <div class="nav-section-label">System</div>
      <a class="nav-item" href="settings.html" data-tooltip="Settings">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#gear"/></svg></span>
        <span class="nav-label">Settings</span>
      </a>
    <a class="nav-item" href="content.html"><span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#building-apartment"/></svg></span><span class="nav-label">School & Anatomy Content</span></a><a class="nav-item" href="anatomy.html" data-tooltip="3D Anatomy Explorer"><span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#cube"/></svg></span><span class="nav-label">3D Anatomy Explorer</span></a></nav>

    <div class="sidebar-footer"><div class="user-card"><a class="sidebar-profile" href="settings.html" title="Settings and profile"><div class="avatar">&#8226;</div><div class="user-info"><div class="user-name">Teacher</div><div class="user-role">Teacher</div></div></a><button type="button" class="logout-btn" title="Sign out" aria-label="Sign out"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#sign-out"/></svg></button></div></div>`,
        student: `<div class="sidebar-logo">
      <div class="sidebar-logo-icon"><img src="../assets/brand/mark-96.png" alt="" width="36" height="36"/></div>
      <div class="sidebar-logo-text">
        <div class="sidebar-logo-name">Anthropotomy</div>
        <div class="sidebar-logo-sub">Student Portal</div>
      </div>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-section-label">Learning</div>
      <a class="nav-item" href="dashboard.html" data-tooltip="Dashboard">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#layout"/></svg></span>
        <span class="nav-label">Dashboard</span>
      </a>
      <a class="nav-item" href="anatomy.html" data-tooltip="3D Anatomy">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#cube"/></svg></span>
        <span class="nav-label">3D Anatomy Explorer</span>
      </a>
      <a class="nav-item" href="lessons.html" data-tooltip="Lessons">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#book-open"/></svg></span>
        <span class="nav-label">My Lessons</span>
      </a>
      <a class="nav-item" href="quiz.html" data-tooltip="Quizzes">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#exam"/></svg></span>
        <span class="nav-label">Quizzes and Activities</span>
        <span class="nav-badge" style="display:none;">0</span>
      </a>
      <div class="nav-section-label">My Progress</div>
      <a class="nav-item" href="progress.html" data-tooltip="Progress">
        <span class="nav-icon"><svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#chart-line"/></svg></span>
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
})();
