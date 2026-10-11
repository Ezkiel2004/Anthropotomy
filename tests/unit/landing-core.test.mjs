import test from 'node:test';
import assert from 'node:assert/strict';
import {portalFor, dashboardFor, explorerFor, firstName, sessionCheck, sessionState, partTotals, formatParts} from '../../assets/js/landing-core.js';

test('teachers and admins use the teacher portal, everyone else the student portal', () => {
    assert.equal(portalFor('teacher'), 'teacher');
    assert.equal(portalFor('admin'), 'teacher');
    assert.equal(portalFor('student'), 'student');
    assert.equal(portalFor(undefined), 'student');
    assert.equal(dashboardFor('admin'), 'teacher/dashboard.html');
    assert.equal(dashboardFor('student'), 'student/dashboard.html');
    assert.equal(explorerFor('teacher'), 'teacher/anatomy.html');
    assert.equal(explorerFor('student'), 'student/anatomy.html');
});

test('firstName takes the first word and tolerates empty values', () => {
    assert.equal(firstName('  Maria Clara Santos '), 'Maria');
    assert.equal(firstName('Kiel'), 'Kiel');
    assert.equal(firstName(''), '');
    assert.equal(firstName(null), '');
});

test('sessionCheck tells a clear "no session" apart from an error', () => {
    const user = {full_name: 'A B', role: 'student'};
    assert.deepEqual(sessionCheck(200, {success: true, data: user}), {status: 'ok', user});
    assert.deepEqual(sessionCheck(401, {success: false}), {status: 'none'});
    assert.deepEqual(sessionCheck(403, null), {status: 'none'});
    assert.deepEqual(sessionCheck(200, {success: false}), {status: 'none'});
    assert.deepEqual(sessionCheck(500, {success: false}), {status: 'error'});
    assert.deepEqual(sessionCheck(0, null), {status: 'error'});
    assert.deepEqual(sessionCheck(200, null), {status: 'error'});
});

test('sessionState keeps a cached user on errors and drops it on a clear "no session"', () => {
    const cached = {full_name: 'Cached User', role: 'student'};
    const fresh = {full_name: 'Fresh User', role: 'teacher'};
    assert.deepEqual(sessionState(cached, {status: 'ok', user: fresh}), {state: 'signed-in', user: fresh});
    assert.deepEqual(sessionState(null, {status: 'ok', user: fresh}), {state: 'signed-in', user: fresh});
    assert.deepEqual(sessionState(cached, {status: 'none'}), {state: 'signed-out', user: null});
    assert.deepEqual(sessionState(cached, {status: 'error'}), {state: 'signed-in', user: cached});
    assert.deepEqual(sessionState(null, {status: 'error'}), {state: 'signed-out', user: null});
    assert.deepEqual(sessionState(cached, undefined), {state: 'signed-in', user: cached});
});

test('partTotals reads whole-number part counts from the layer manifest', () => {
    const totals = partTotals({skeletal: {parts: 686}, muscular: {parts: 585}, broken: {parts: '12'}, empty: {}, endocrine: {parts: 10}});
    assert.deepEqual(totals.systems, [{id: 'skeletal', parts: 686}, {id: 'muscular', parts: 585}, {id: 'endocrine', parts: 10}]);
    assert.equal(totals.total, 1281);
    assert.deepEqual(partTotals(null), {systems: [], total: 0});
});

test('formatParts groups thousands and handles one part', () => {
    assert.equal(formatParts(2788), '2,788 parts');
    assert.equal(formatParts(1), '1 part');
    assert.equal(formatParts(10), '10 parts');
});
