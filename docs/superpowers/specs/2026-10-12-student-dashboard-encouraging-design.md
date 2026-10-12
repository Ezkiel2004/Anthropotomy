# Encouraging student dashboard — design

Date: 2026-10-12

## Goal

`student/dashboard.html` should encourage students and always show them one clear next step. Today a new student sees zeros, four empty boxes and seven past-due activities in red.

## Scope

- In scope: `student/dashboard.html` (markup and inline script), `assets/css/student-portal.css`, and `tests/student-dashboard-states.js` where wording changes.
- Out of scope: APIs, other portal pages, the portal design system.

## Design

1. **Header.**
   - Greeting.
   - One state-aware line in `#dashboardEncouragement`:
     - no progress: "Here's a good place to start."
     - lessons done: "You've finished N of M lessons. Keep going."
     - all done: "You've finished every published lesson. Nice work."
     - quizzes only: "You've taken N quizzes. Keep it up."
   - The date stays. The duplicate Explore button is removed.
2. **Your next step.** `#continueLearningGrid` becomes a banner card (reusing the `.anatomy-shortcut` look) with one primary action. The first match wins:
   1. A lesson in progress: "Continue lesson".
   2. The first open quiz: "Start quiz", linking to `quiz.html?assessment_id=`.
   3. A lesson not started: "Start lesson".
   4. Otherwise the explorer. Its copy depends on state:
      - no lessons: "No lessons available yet."
      - all done: "All published lessons are complete."
      - otherwise: "Visit My Lessons to continue learning."

   Every card except the explorer card adds a secondary "or explore the body in 3D" link.
3. **Stats.** The labels become "Lessons finished", "Body systems explored", "Quiz average" and "Quizzes to try". Zero values get a friendly hint. The fourth card loses its red styling.
4. **Quizzes and activities.**
   - A passed due date reads "Due date passed. Still open". This is true because the assessment is still active and attempts remain.
   - The empty state reads "You're all caught up."
5. **Empty states.**
   - Score history keeps "No scores yet" and adds a "Try a quiz" link. API errors do not show the link.
   - Systems with no lessons show "No lessons yet" and an "Explore in 3D" link to `anatomy.html?system=<code>`.
   - Achievements with no goals read "Your teacher hasn't set any goals yet."
   - Results with no rows read "No quiz submissions yet."
6. **Unchanged.** The chart, the results table, the API calls and the element IDs. No visible em or en dashes.

## Verification

- playwright-skill as a temporary student, which is the brand-new state on today's data, at desktop and 375 px.
- No console errors other than the existing 401.
- `tests/student-dashboard-states.js` is run in the authenticated tab. It covers the empty, completed, populated, invalid-score, error, recovery and resize states.
