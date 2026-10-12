# Teacher dashboard: clear next step — design

Date: 2026-10-12

## Goal

`teacher/dashboard.html` should tell the teacher what to do next and why. Today the school has 17 published modules but no published lessons, and no school year is set, so students cannot register. Nothing on the dashboard says so. The page also uses the generic card look the student dashboard just dropped: pastel icon tiles, colored title badges, boxes inside cards, and a chart that repeats a list.

## Scope

- In scope: `teacher/dashboard.html`, plus `assets/css/teacher-dashboard.css`, which both dashboards load.
  - The dark next-step panel and the stats strip move from `student-portal.css` into this file, scoped to `.dashboard-page`.
- Also in scope: `tests/browser.mjs`, where the explorer-link assertion changes.
- Also in scope: version strings for `sidebar.js` and `teacher-dashboard.css`, so browsers stop using cached copies that still list the Media Library.
- Out of scope: APIs and other pages.

## Design

1. **Header.**
   - Greeting.
   - One line in `#teacherEncouragement`:
     - setup incomplete: "N of 4 setup steps done. Your next step is below."
     - complete: "Your class is set up. Here's how it's going."
   - The duplicate "New Assessment" button is removed. Quick actions keep it.
2. **Next step panel.** This is the dark X-ray panel shared with the student dashboard. The first match wins:
   1. School year empty: "Students can't sign up yet". The button is "Set the school year" and goes to `content.html`.
   2. No published lessons: "Publish your first lesson". If modules already exist, the panel says so. Goes to `modules.html`.
   3. No open quiz: "Open your first quiz". Goes to `assessments.html`.
   4. No students: "Add your students". Goes to `students.html`.
   5. Students need attention: "N students may need help". Goes to `monitoring.html`.
   6. Otherwise: "Your class is set up". Goes to `anatomy.html`.

   While setup is incomplete, the panel lists four checks:
   - School year set
   - Lessons published
   - A quiz is open
   - Students enrolled

   Each check is linked and shows a check or an empty-circle icon. Every next step except the explorer one has an "or open the 3D explorer" link.
3. **Stats strip.**
   - Students: total, with active accounts as the hint.
   - Class average: "Not yet" with no scores.
   - Published lessons: the hint gives the module count.
   - Open quizzes.

   No icon tiles, and no red hint.
4. **Rows.**
   - Students needing attention, next to Quick actions. Quick actions become plain rows with Phosphor icons, and their labels match their pages.
   - Recent class quiz scores, next to Top performers.
   - System completion: the full list. When no lessons are published, it shows an empty state that links to Modules.
   - The duplicate "Lesson completion by body system" chart is removed.
   - Recent submissions table.
5. **Copy.**
   - No colored badges in section titles.
   - No em or en dashes in our own copy.
   - The attention empty state explains the rule: a quiz average below the passing score, or a turned-off account.

## Verification

- playwright-skill as a temporary teacher at desktop and 375 px.
- Console clean apart from the existing 401.
- Hover contrast check.
- The student dashboard is re-checked, since the shared CSS moved.
- The student dashboard state test.
