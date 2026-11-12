import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {KINDS, lessonKind, kindCounts, opensInViewer, assessmentKind, questionMix, dueLabel, systemLook} = require('../../assets/js/content-format.js');

test('lessonKind reads the attachment before the type', () => {
  assert.equal(lessonKind({lesson_type: 'reading', media_url: null}), 'reading');
  assert.equal(lessonKind({lesson_type: 'reading', media_url: '../uploads/lessons/a.PDF?v=2'}), 'pdf');
  assert.equal(lessonKind({lesson_type: 'reading', media_url: '../assets/img/hero/skeletal.webp'}), 'image');
  assert.equal(lessonKind({lesson_type: 'reading', media_url: 'x.mp4'}), 'video');
  assert.equal(lessonKind({lesson_type: 'video', media_url: null}), 'video');
  assert.equal(lessonKind({lesson_type: 'reading', media_url: 'skeletal.glb'}), '3d');
  assert.equal(lessonKind({lesson_type: '3d_model', media_url: null}), '3d');
  assert.equal(lessonKind({lesson_type: 'interactive', media_url: null}), 'interactive');
  assert.equal(lessonKind({lesson_type: 'quiz_prep', media_url: null}), 'prep');
});
test('kindCounts keeps KINDS order and drops zeros', () => {
  const lessons = [{lesson_type: 'quiz_prep'}, {lesson_type: 'reading'}, {lesson_type: 'reading', media_url: 'a.pdf'}, {lesson_type: 'reading'}];
  assert.deepEqual(kindCounts(lessons).map(k => [k.kind, k.count]), [['reading', 2], ['pdf', 1], ['prep', 1]]);
});
test('PowerPoint and Word files are their own kinds, read from the extension', () => {
  assert.equal(lessonKind({lesson_type: 'reading', media_url: '../uploads/lessons/deck.pptx'}), 'slides');
  assert.equal(lessonKind({lesson_type: 'video', media_url: '../uploads/lessons/OLD.PPT?v=2'}), 'slides');
  assert.equal(lessonKind({lesson_type: 'reading', media_url: '../uploads/lessons/worksheet.docx#page=1'}), 'document');
  assert.equal(lessonKind({lesson_type: 'quiz_prep', media_url: 'notes.doc'}), 'document');
  assert.deepEqual(KINDS.slides, {label: 'PowerPoint', icon: 'file-ppt'});
  assert.deepEqual(KINDS.document, {label: 'Word', icon: 'file-doc'});
  assert.deepEqual(Object.keys(KINDS), ['reading', 'video', 'pdf', 'slides', 'document', 'image', '3d', 'interactive', 'prep']);
});
test('kindCounts puts PowerPoint and Word right after PDF', () => {
  const lessons = [{lesson_type: 'quiz_prep'}, {media_url: 'w.docx'}, {lesson_type: 'reading'}, {media_url: 'a.pdf'}, {media_url: 's.ppt'}, {media_url: 'v.mp4'}, {media_url: 't.pptx'}];
  assert.deepEqual(kindCounts(lessons).map(k => [k.kind, k.count]), [['reading', 1], ['video', 1], ['pdf', 1], ['slides', 2], ['document', 1], ['prep', 1]]);
});
test('opensInViewer is true only for PDF', () => {
  assert.equal(opensInViewer('pdf'), true);
  for (const kind of ['slides', 'document', 'reading', 'video', 'image', '3d', 'interactive', 'prep', undefined]) assert.equal(opensInViewer(kind), false);
});
test('assessmentKind comes from the questions, not a type', () => {
  assert.deepEqual(assessmentKind({identification: 4}), {label: 'Identification', icon: 'textbox', tone: 'identification'});
  assert.deepEqual(assessmentKind({hotspot: 3, true_false: 0}), {label: 'Hotspot', icon: 'crosshair', tone: 'hotspot'});
  assert.deepEqual(assessmentKind({multiple_choice: 4, true_false: 2}), {label: 'Mixed questions', icon: 'stack', tone: 'mixed'});
  assert.deepEqual(assessmentKind({}), {label: 'No questions yet', icon: 'exam', tone: 'empty'});
});
test('questionMix totals and orders parts', () => {
  const mix = questionMix({hotspot: 1, multiple_choice: 4, true_false: 2});
  assert.equal(mix.total, 7);
  assert.deepEqual(mix.parts.map(p => [p.type, p.count]), [['multiple_choice', 4], ['true_false', 2], ['hotspot', 1]]);
});
test('dueLabel counts calendar days in local time', () => {
  const now = new Date(2026, 10, 11, 10, 0);            // Wed, Nov 11 2026, 10:00
  assert.deepEqual(dueLabel(null, now), {label: 'No due date', tone: 'none'});
  assert.deepEqual(dueLabel('2026-11-11 23:59:00', now), {label: 'Wed, Nov 11 · today', tone: 'soon'});
  assert.deepEqual(dueLabel('2026-11-12 23:59:00', now), {label: 'Thu, Nov 12 · tomorrow', tone: 'soon'});
  assert.deepEqual(dueLabel('2026-11-13 23:59:00', now), {label: 'Fri, Nov 13 · in 2 days', tone: 'soon'});
  assert.deepEqual(dueLabel('2026-11-14 23:59:00', now), {label: 'Sat, Nov 14', tone: 'later'});
  assert.deepEqual(dueLabel('2026-11-11 08:00:00', now), {label: 'Wed, Nov 11', tone: 'past'});
  assert.deepEqual(dueLabel('2026-11-08 23:59:00', now), {label: 'Sun, Nov 8', tone: 'past'});
});
test('circulatory no longer shares the skeletal colour', () => {
  assert.notEqual(systemLook('circulatory').colour, systemLook('skeletal').colour);
  assert.deepEqual(systemLook('nope'), {tone: 'sky', colour: '#3fb8f5', art: null});
});
