// The games a student can play, in the order of the Games page. 3D Hunt joins this list when it is built.

import matchPairs from './match-pairs.js';
import sortIt from './sort-it.js';
import beatTheClock from './beat-the-clock.js';
import unscramble from './unscramble.js';

export const games = [matchPairs, sortIt, beatTheClock, unscramble];

export const gameByKey = key => games.find(game => game.key === key) || null;
