/* Content format helpers shared by the teacher and student portals: body-system looks, lesson kinds,
   assessment labels drawn from their questions, and due-date wording. Pure functions, no DOM. */
'use strict';
const ContentFormat = (() => {
  // Card colours and renders from the landing page, one per body system.
  const CARD_COLOURS = { sky: '#3fb8f5', teal: '#2ccf9a', violet: '#6c63ff', purple: '#8b5cf6', coral: '#f2545b' };
  const SYSTEM_LOOKS = {
    skeletal: ['sky', 'skeletal'], muscular: ['purple', 'muscular'], circulatory: ['coral', 'circulatory'],
    nervous: ['violet', 'nervous'], lymphatic: ['coral', 'lymphatic'], respiratory: ['teal', 'respiratory'],
    digestive: ['violet', 'digestive'], urinary: ['sky', 'urinary'], endocrine: ['teal', 'endocrine'],
    reproductive: ['coral', null], 'reproductive-female': ['purple', null],
  };
  function systemLook(code) {
    const [tone, art] = SYSTEM_LOOKS[code] || ['sky', null];
    return { tone, colour: CARD_COLOURS[tone], art: art ? `../assets/img/hero/${art}.webp` : null };
  }

  const KINDS = {
    reading: { label: 'Reading', icon: 'book-open' },
    video: { label: 'Video', icon: 'video-camera' },
    pdf: { label: 'PDF', icon: 'file-pdf' },
    image: { label: 'Image', icon: 'image' },
    '3d': { label: '3D model', icon: 'cube' },
    interactive: { label: 'Interactive', icon: 'game-controller' },
    prep: { label: 'Quiz prep', icon: 'list-checks' },
  };
  const EXTENSION_KINDS = {
    pdf: 'pdf',
    png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image',
    mp4: 'video', webm: 'video', mov: 'video',
    glb: '3d', gltf: '3d',
  };
  const TYPE_KINDS = { video: 'video', '3d_model': '3d', interactive: 'interactive', quiz_prep: 'prep' };

  function extension(url) {
    const path = String(url).split(/[?#]/)[0];
    const dot = path.lastIndexOf('.');
    return dot < 0 ? '' : path.slice(dot + 1).toLowerCase();
  }
  function lessonKind({ lesson_type, media_url }) {
    return (media_url && EXTENSION_KINDS[extension(media_url)]) || TYPE_KINDS[lesson_type] || 'reading';
  }
  function kindCounts(lessons) {
    const counts = {};
    for (const lesson of lessons) {
      const kind = lessonKind(lesson);
      counts[kind] = (counts[kind] || 0) + 1;
    }
    return Object.keys(KINDS).filter(kind => counts[kind]).map(kind => ({ kind, ...KINDS[kind], count: counts[kind] }));
  }

  const QUESTION_TYPES = {
    multiple_choice: { label: 'Multiple choice', icon: 'list-checks' },
    true_false: { label: 'True or false', icon: 'toggle-left' },
    identification: { label: 'Identification', icon: 'textbox' },
    hotspot: { label: 'Hotspot', icon: 'crosshair' },
  };
  function questionMix(counts) {
    const parts = Object.keys(QUESTION_TYPES)
      .filter(type => counts[type] > 0)
      .map(type => ({ type, ...QUESTION_TYPES[type], count: counts[type] }));
    return { total: parts.reduce((sum, part) => sum + part.count, 0), parts };
  }
  function assessmentKind(questionTypes) {
    const { parts } = questionMix(questionTypes);
    if (parts.length === 1) return { label: parts[0].label, icon: parts[0].icon, tone: parts[0].type };
    if (parts.length > 1) return { label: 'Mixed questions', icon: 'stack', tone: 'mixed' };
    return { label: 'No questions yet', icon: 'exam', tone: 'empty' };
  }

  function dueLabel(due, now) {
    if (!due) return { label: 'No due date', tone: 'none' };
    const when = new Date(String(due).replace(' ', 'T'));
    const day = when.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    if (when < now) return { label: day, tone: 'past' };
    const days = Math.round((new Date(when.getFullYear(), when.getMonth(), when.getDate())
      - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    if (days === 0) return { label: `${day} · today`, tone: 'soon' };
    if (days === 1) return { label: `${day} · tomorrow`, tone: 'soon' };
    if (days === 2) return { label: `${day} · in 2 days`, tone: 'soon' };
    return { label: day, tone: 'later' };
  }

  return { CARD_COLOURS, SYSTEM_LOOKS, systemLook, KINDS, lessonKind, kindCounts, QUESTION_TYPES, questionMix, assessmentKind, dueLabel };
})();
if (typeof module === 'object' && module.exports) module.exports = ContentFormat;
