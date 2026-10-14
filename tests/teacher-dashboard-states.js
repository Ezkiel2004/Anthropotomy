// Evaluate in an authenticated teacher dashboard browser tab. All fixtures stay in memory.
(async () => {
    const assert = (ok, message) => { if (!ok) throw new Error(message); };
    const element = id => document.getElementById(id);
    const originalFetch = window.fetch;
    let fail = false;
    const stats = { total_students: 0, active_students: 0, class_average_score: null, total_modules: 3, total_lessons: 0, active_assessments: 0 };
    const config = { academic_year: '2026-2027', passing_score: '75' };
    let atRisk = [], systems = [], students = [];
    window.fetch = async (url, options) => {
        const path = String(url);
        if (path.endsWith('/dashboard/teacher-stats.php')) return Response.json({ success: !fail, data: { stats, recent_submissions: [], system_stats: systems, at_risk_students: atRisk, score_trend: [] } });
        if (path.endsWith('/students.php')) return Response.json({ success: true, data: { students } });
        if (path.endsWith('/config.php')) return Response.json({ success: true, data: config });
        return originalFetch(url, options);
    };
    const step = () => element('teacherNextStep');
    const primaryHref = () => step().querySelector('.btn-primary').getAttribute('href');
    try {
        await loadTeacherDashboard();
        assert(step().querySelectorAll('.setup-list li').length === 3 && element('teacherEncouragement').textContent.startsWith('0 of 3'), 'Checklist shows the three setup steps');
        assert(!step().textContent.includes('school year') && !document.querySelector('a[href^="content.html"]'), 'No school-year step or content links remain');
        assert(element('moduleProgressList').textContent.includes('No body systems are active'), 'No systems state');

        systems = [{ system_name: 'Skeletal System', system_code: 'skeletal', total_lessons: 0, avg_completion_pct: 0 }];
        await loadTeacherDashboard();
        assert(primaryHref() === 'modules.html' && step().textContent.includes('3 published modules'), 'No published lessons is next, naming the module count');
        assert(element('moduleProgressList').textContent.includes('No lessons are published yet'), 'Completion waits for published lessons');

        stats.total_lessons = 4;
        systems[0] = { ...systems[0], total_lessons: 4, avg_completion_pct: 25 };
        await loadTeacherDashboard();
        assert(primaryHref() === 'assessments.html', 'No open quiz is next');
        assert(element('moduleProgressList').textContent.includes('25% complete'), 'Completion shows once lessons exist');

        stats.active_assessments = 2;
        await loadTeacherDashboard();
        assert(primaryHref() === 'students.html', 'No students is next');

        stats.total_students = 5; stats.active_students = 5;
        atRisk = [{ full_name: 'Ana Reyes', section: 'Rizal', avg_score: 52, completed_lessons: 1 }];
        await loadTeacherDashboard();
        assert(primaryHref() === 'monitoring.html' && step().textContent.includes('1 student may need help'), 'Students needing help come after setup');
        assert(!step().querySelector('.setup-list') && element('teacherEncouragement').textContent.includes('set up'), 'Checklist hides once setup is complete');
        assert(element('atRiskList').textContent.includes('Ana Reyes') && element('atRiskList').textContent.includes('52%'), 'Attention list shows the student and score');

        atRisk = [];
        students = [{ full_name: 'Ben Cruz', section: 'Rizal', school_id: 'S-1', avg_quiz_score: 91 }];
        await loadTeacherDashboard();
        assert(primaryHref() === 'anatomy.html' && step().dataset.kind === 'explore', 'A set-up class gets the explorer');
        assert(element('leaderboardList').textContent.includes('Ben Cruz'), 'Top performers populated');

        fail = true;
        await loadTeacherDashboard();
        assert(step().dataset.kind === 'error' && step().textContent.includes('Unable to load'), 'API errors are stated, not hidden');
        return 'Passed setup order, attention, set-up, leaderboard, completion and API-error states.';
    } finally {
        window.fetch = originalFetch;
        await loadTeacherDashboard();
    }
})()
