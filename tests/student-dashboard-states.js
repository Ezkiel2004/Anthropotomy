// Evaluate in an authenticated student dashboard browser tab. All fixtures stay in memory.
(async () => {
    const assert = (ok, message) => { if (!ok) throw new Error(message); };
    const element = id => document.getElementById(id);
    const originalFetch = window.fetch;
    let fail = false;
    const data = {
        profile: { full_name: 'Dashboard Test', total_lessons: 0, systems_explored: 0, avg_quiz_score: null, quizzes_taken: 0, quizzes_passed: 0, study_days_week: 0, study_days_month: 0, total_time_hours: 0, last_studied_on: null },
        systems: [{ system_name: 'Skeletal System', system_code: 'skeletal', total_lessons: 0 }],
        newest_lesson: null, upcoming_assessments: [], pending_assessments_count: 0, achievements: []
    };
    let submissions = [];
    window.fetch = async (url, options) => {
        if (String(url).endsWith('/dashboard/student-stats.php')) return Response.json({ success: !fail, data });
        if (String(url).endsWith('/scores.php')) return Response.json({ success: !fail, data: { submissions } });
        return originalFetch(url, options);
    };
    const render = () => Promise.all([loadStudentDashboard(), loadRecentScoresAndChart()]);
    try {
        await render();
        assert(element('continueLearningGrid').dataset.kind === 'explore' && element('continueLearningGrid').textContent.includes('No lessons yet'), 'With nothing published, the next step is the 3D explorer');
        assert(element('systemProgressGrid').textContent.includes('No lessons yet') && element('systemProgressGrid').querySelector('a[href^="anatomy.html"]'), 'Empty system offers the 3D explorer');
        assert(element('dashboardEncouragement').textContent.includes('good place to start'), 'No study days yet');
        assert(!element('scoreChartCta').hidden && element('scoreChartContainer').hidden && element('scoreChartEmpty').textContent.includes('No scores yet'), 'Empty score history offers a quiz, not a chart');
        assert(element('recentScoresWrap').hidden && element('recentScoresEmpty').textContent.includes('No quiz submissions'), 'Empty results message');
        assert(element('achievementsCard').hidden && element('scoreRow').classList.contains('is-single'), 'Without goals, achievements hide and score history takes the row');

        data.profile.total_lessons = 2;
        data.profile.study_days_week = 3;
        data.systems[0].total_lessons = 2;
        data.newest_lesson = { title: 'Learn the skeleton', module_title: 'Bones', system_name: 'Skeletal System', system_code: 'skeletal' };
        data.achievements = [{ name: 'First study day', earned: true }, { name: 'Quiz expert', earned: false }];
        const submission = { assessment_title: 'Anatomy quiz', assessment_type: 'quiz', system_name: 'Skeletal', score: 80, passed: true, submitted_at: '2026-09-15' };
        submissions = [submission, { ...submission, score: 0, passed: false }];
        await render();
        assert(element('continueLearningGrid').dataset.kind === 'lesson' && element('continueLearningGrid').textContent.includes('Learn the skeleton') && element('continueLearningGrid').textContent.includes('Newest lesson'), 'The newest lesson is the next step');
        assert(element('dashboardEncouragement').textContent.includes('3 of the last 7 days'), 'Encouragement counts study days');
        assert(element('systemProgressGrid').textContent.includes('2 lessons') && !/\d of \d/.test(element('systemProgressGrid').textContent), 'System cards count lessons, not completion');
        assert(element('scoreChartCta').hidden && !element('scoreChartContainer').hidden && element('scoreChartContainer').querySelectorAll('.sd-bar').length === 2, 'Score bars drawn once scores exist');
        assert(element('scoreChartContainer').querySelector('.sd-bar').style.getPropertyValue('--v') === '0', 'Real zero scores preserved, oldest first');
        assert(element('recentScoresTable').rows.length === 2, 'Recent results populated');
        assert(element('achievementList').children.length === 2 && !element('achievementsCard').hidden, 'Achievement badges shown when goals exist');

        data.upcoming_assessments = [{ assessment_id: 5, title: 'Bones quiz', due_date: '2020-01-01', time_limit_mins: 20 }];
        await loadStudentDashboard();
        assert(element('continueLearningGrid').dataset.kind === 'quiz' && element('continueLearningGrid').querySelector('a[href="quiz.html?assessment_id=5"]'), 'An open quiz comes before the newest lesson');
        assert(element('upcomingList').textContent.includes('Due date passed. Still open'), 'Past due dates are stated, and the quiz is still open');
        data.upcoming_assessments = [];

        submissions = [{ ...submission, score: null }, { ...submission, score: 'invalid' }];
        await loadRecentScoresAndChart();
        assert(element('scoreChartContainer').hidden, 'Invalid scores cannot draw a chart');
        assert(!element('recentScoresTable').textContent.includes('NaN'), 'Invalid scores cannot render NaN in results');

        fail = true;
        await render();
        assert(element('scoreChartEmpty').textContent.includes('Unable to load') && element('scoreChartCta').hidden, 'Score errors are distinct from empty history');
        assert(element('continueLearningGrid').textContent.includes('Unable to load'), 'Dashboard errors are stated, not hidden');
        fail = false;
        submissions = [];
        data.systems = [];
        await render();
        assert(element('systemProgressGrid').textContent.includes('No body systems'), 'No systems state');
        return 'Passed empty, study-days, populated, open-quiz, invalid-score, API-error and recovery states.';
    } finally {
        window.fetch = originalFetch;
        await render();
    }
})()
