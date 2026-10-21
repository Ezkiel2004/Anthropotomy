// The teacher Games page's paste-to-add parser. Importing the page module must not touch the DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePastedCards} from '../../assets/js/games/teacher-page.js';

test('parsePastedCards reads term, clue and an optional group, skipping blank lines', () => {
    assert.deepEqual(parsePastedCards('Femur, thigh bone\n\nHeart, pumps blood, Circulatory'), [
        {term: 'Femur', clue: 'thigh bone'},
        {term: 'Heart', clue: 'pumps blood', group: 'Circulatory'},
    ]);
});
test('parsePastedCards keeps every comma between the first and the last in the clue', () => {
    assert.deepEqual(parsePastedCards('A, b, c, G'), [{term: 'A', clue: 'b, c', group: 'G'}]);
});
test('parsePastedCards trims fields, accepts Windows line ends and leaves out an empty group', () => {
    assert.deepEqual(parsePastedCards('  Tibia ,  shin bone  \r\n   \r\nFibula, thin leg bone,  \r\n'), [
        {term: 'Tibia', clue: 'shin bone'},
        {term: 'Fibula', clue: 'thin leg bone'},
    ]);
});
test('parsePastedCards keeps a line without a comma as a term with an empty clue, to fix in the editor', () => {
    assert.deepEqual(parsePastedCards('Patella'), [{term: 'Patella', clue: ''}]);
});
test('parsePastedCards keeps markup as plain text', () => {
    assert.deepEqual(parsePastedCards('<img src=x>, <b>bold</b> clue'), [{term: '<img src=x>', clue: '<b>bold</b> clue'}]);
});
test('parsePastedCards returns nothing for empty input', () => {
    assert.deepEqual(parsePastedCards(''), []);
    assert.deepEqual(parsePastedCards('\n \n'), []);
});
