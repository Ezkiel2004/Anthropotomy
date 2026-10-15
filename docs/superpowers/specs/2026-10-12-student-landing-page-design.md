# Student-persuasive landing page, signed-in aware — design

Date: 2026-10-12

## Goal

The public landing page (`index.html`) should encourage students and convince them to use Anthropotomy. It must work for signed-out and signed-in visitors alike. Dashboards stay their own pages.

## Scope

In scope:

- `index.html`: rewritten copy, reordered and new sections.
- `landing-src/src/public.css`, rebuilt to `assets/css/public.css`: styles for the new sections.
- `assets/js/landing.js`: session-aware header and calls to action.
- `assets/js/sidebar.js`: a "Home" link in both portal sidebars that opens the landing page.

Out of scope: `login.html`, dashboards, the explorer, every API.

## Content rules

- Every claim must be true of the system today. No testimonials, invented statistics or "trusted by" lines.
- Second person, encouraging, plain words. Name the student's benefit first, then the feature.
- The real numbers come from `system_model/layers/manifest.json`: 11 body systems and 2,788 named structures. The other facts are 4 question types and answers that autosave during a quiz.

## Page flow

1. **Hero.** A benefit headline about understanding the body rather than memorising flat diagrams, plus an encouraging sub-line. The calls to action are Create account and Sign in. The live 3D skeleton plate stays as it is.
2. **Proof strip.** Four facts: 11 body systems, 2,788 named structures, 4 question types, answers save as you go.
3. **Why it's easier.** Three pain-to-relief pairs:
   - Flat diagrams become a model you can turn and isolate.
   - Exam nerves are eased by ungraded practice first.
   - Lost work is prevented by autosave and resume.
4. **Features.** The four figures stay (explorer, lessons, quiz demo, progress). Only their copy is rewritten as student wins. All markup hooks are unchanged.
5. **How it works.** Three short, reassuring steps.
6. **FAQ.** Native `<details>` elements, so no JavaScript:
   - Is it graded?
   - Do I need to install anything?
   - Does it work on my phone?
   - What if I forget my password?
   - What if my school hasn't added lessons yet?
7. **Closing call to action.** Encouraging copy.

## Signed-in behaviour

`landing.js` calls `api/auth/session.php`, using the same origin and credentials.

- **Signed out, or the request fails:** the page is unchanged. It shows Create account and Sign in, so the static HTML is the signed-out state.
- **Signed in:**
  - Every `[data-auth="guest"]` element is hidden. Every `[data-auth="member"]` element is shown.
  - The hero eyebrow reads "Welcome back, <first name>". The text is set with `textContent`, never HTML.
  - The calls to action become "Go to my dashboard" and "Sign out".
  - The dashboard link is `teacher/dashboard.html` for the teacher and admin roles, and `student/dashboard.html` for everyone else. This mirrors `destination()` in `login.js`.
  - Sign out posts to `api/auth/logout.php`, clears `sessionStorage.anthropotomy_user`, then reloads the landing page in its signed-out state.
- The dashboards stay separate pages. Signing in still lands on the dashboard (`login.js` is unchanged).
- Both portal sidebars get a "Home" item linking to `../index.html`, so a signed-in user can return to the landing page.

## Visual direction

Keep the established identity:

- The dark X-ray plate and paper sections.
- Instrument Serif headlines, Plus Jakarta Sans body text and JetBrains Mono captions.

New sections reuse the existing tokens and components. design-taste-frontend audits spacing, hierarchy and repetition. Phone width needs a 16 px gutter and no horizontal scroll.

## Verification

Use playwright-skill against `http://localhost/Anthropotomy/`:

- Desktop and 375 px phone screenshots.
- No console errors.
- The quiz demo tabs work.
- The FAQ opens.
- Signed-out state shows Create account.
- Signed-in state, using a test student session, shows Welcome back and Go to my dashboard, and Sign out returns to the signed-out state.
- The sidebar Home link works.
- Existing tests in `tests/` still pass where they run without extra setup.
