// The portal's count-up reads and redraws headline numbers. Importing the module must not touch the DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCount, formatCount} from '../../assets/js/portal-motion.js';

test('parseCount reads a number with its prefix and suffix', () => {
    assert.deepEqual(parseCount('72%'), {prefix: '', suffix: '%', value: 72, decimals: 0, grouped: false});
    assert.deepEqual(parseCount(' 4.5 pts '), {prefix: '', suffix: ' pts', value: 4.5, decimals: 1, grouped: false});
    assert.deepEqual(parseCount('#1,240'), {prefix: '#', suffix: '', value: 1240, decimals: 0, grouped: true});
});

test('parseCount refuses text that is not exactly one number', () => {
    for (const text of ['Not yet', '–', '', '3 / 5', 'Grade 11', '1,2,3', '12:30']) {
        assert.equal(parseCount(text), null, text);
    }
});

test('formatCount redraws a value in the original format', () => {
    assert.equal(formatCount(parseCount('72%'), 35.6), '36%');
    assert.equal(formatCount(parseCount('4.5 pts'), 2.25), '2.3 pts');
    assert.equal(formatCount(parseCount('1,240'), 1003.4), '1,003');
    assert.equal(formatCount(parseCount('1240'), 1003.4), '1003');
});
