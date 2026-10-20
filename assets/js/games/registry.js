// The games a student can play, in the order of the Games page.

import matchPairs from './match-pairs.js';
import sortIt from './sort-it.js';
import beatTheClock from './beat-the-clock.js';
import unscramble from './unscramble.js';
import hunt3d from './hunt-3d.js';

export const games = [matchPairs, sortIt, beatTheClock, unscramble, hunt3d];

export const gameByKey = key => games.find(game => game.key === key) || null;
