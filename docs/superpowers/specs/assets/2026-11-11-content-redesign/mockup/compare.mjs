// Side-by-side before/after images: node docs/superpowers/specs/assets/2026-11-11-content-redesign/mockup/compare.mjs
import { execFileSync } from 'node:child_process';
const DIR = 'C:/xampp/htdocs/Anthropotomy/docs/superpowers/specs/assets/2026-11-11-content-redesign';
const FONT = 'C\\:/Windows/Fonts/arialbd.ttf';
const pairs = [
  ['compare-1-modules', 'before-01-teacher-modules', 'after-01-teacher-modules', 'Teacher Modules page'],
  ['compare-2-module-workspace', 'before-03-teacher-materials', 'after-02-module-workspace', 'Module: lessons + materials (was alert() + a materials popup)'],
  ['compare-3-lesson-editor', 'before-02-teacher-add-lesson', 'after-03-lesson-editor', 'Add / edit lesson'],
  ['compare-4-pdf-lesson', 'before-08-student-pdf-lesson', 'after-04-student-pdf-lesson', 'PDF in the lesson reader'],
  ['compare-5-assessments', 'before-04-teacher-assessments', 'after-06-teacher-assessments', 'Teacher Assessments page'],
  ['compare-6-question-builder', 'before-05-teacher-question-builder', 'after-07-question-builder', 'Question builder'],
  ['compare-8-new-assessment', 'before-06-teacher-create-assessment', 'after-09-new-assessment', 'New assessment: no type to pick'],
  ['compare-7-phone', 'before-09-teacher-modules-phone', 'after-08-teacher-modules-phone', 'Modules on a phone'],
];
const size = f => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim().split(',').map(Number);
for (const [out, before, after, title] of pairs) {
  const a = `${DIR}/${before}.png`, b = `${DIR}/${after}.png`;
  const [wa, ha] = size(a), [wb, hb] = size(b), w = Math.max(wa, wb), h = Math.max(ha, hb) + 90;
  const label = (t, c) => `drawtext=fontfile='${FONT}':text='${t}':fontcolor=${c}:fontsize=${w < 600 ? 22 : 34}:x=24:y=28`;
  const graph = [
    `[0]pad=${w}:${h}:0:90:color=0x0a0a0a,${label('BEFORE', '0xf2545b')}[a]`,
    `[1]pad=${w}:${h}:0:90:color=0x0a0a0a,${label('AFTER', '0x36e2c0')}[b]`,
    `color=c=0x0a0a0a:s=40x${h}[gap]`,
    `[a][gap][b]hstack=3${w * 2 + 40 > 2400 ? ',scale=2400:-1' : ''}[o]`,
  ].join(';');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', a, '-i', b, '-filter_complex', graph, '-map', '[o]', '-frames:v', '1', `${DIR}/${out}.png`]);
  console.log(out, title);
}
