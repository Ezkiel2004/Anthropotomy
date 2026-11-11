import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {lessonKind, kindCounts, assessmentKind, questionMix, dueLabel, systemLook} = require('../../assets/js/content-format.js');

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
