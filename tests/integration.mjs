import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const base=process.env.ANTHROPOTOMY_TEST_URL || 'http://127.0.0.1:8091';
const credentials=JSON.parse(fs.readFileSync('.runtime/test-access.json','utf8'));
let assertions=0;
function check(value,message){assert.ok(value,message);assertions++;}
function client(){let cookie='';return async(path,method='GET',body)=>{const multipart=body instanceof FormData;const response=await fetch(base+'/api/'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined||multipart?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:multipart?body:JSON.stringify(body)});const received=response.headers.getSetCookie();if(received.length)cookie=received.map(c=>c.split(';')[0]).join('; ');let result;const raw=await response.text();try{result=JSON.parse(raw);}catch{throw new Error(path+' returned invalid JSON: '+raw.slice(0,300));}return {status:response.status,...result};};}
const guest=client(),teacher=client(),student=client();
check((await guest('students.php')).status===401,'Anonymous student access rejected');
check((await guest('config.php')).data.system_count===0,'Empty system count comes from database');
check((await teacher('auth/login.php','POST',credentials)).success,'Teacher login');
for(const path of ['students.php','modules.php','reports.php','dashboard/teacher-stats.php','settings.php','anatomy-content.php','achievements.php'])check((await teacher(path)).success,'Empty endpoint: '+path);
const config={school_name:'Integration School',academic_year:'Test Year',department:'Science',subject:'Biology',grade_level:'Custom Grade',recovery_contact:'School office',grade_a:'90',grade_b:'80',grade_c:'70',grade_d:'60',passing_score:'75',support_score:'60'};
check((await teacher('config.php','PUT',config)).success,'Save school settings');
check((await teacher('config.php','PUT',{grade_a:'50',grade_b:'90'})).status===422,'Inconsistent grade bands rejected');
check((await guest('config.php')).data.school_name===config.school_name,'Public school identity reads saved data');
check(!(await guest('auth/reset-password.php','POST',{action:'request',identifier:credentials.username})).data?.token,'Recovery never exposes tokens');
const system=await teacher('anatomy-content.php','POST',{system_name:'Test System',system_code:'test-system',color_hex:'#123456',description:'Database description',is_active:true,key_facts:{Fact:'Database fact'},structures:[{name:'Test Structure',desc:'Database structure',mesh_name:'part'}]});check(system.success,'Create anatomy content');const sid=system.data.system_id;
check((await guest('config.php')).data.system_count===1,'System count updates');
const module=await teacher('modules.php','POST',{system_id:sid,title:'Test module',description:'Fixture',status:'published'});check(module.success,'Create module');const mid=module.data.module_id;
const lesson=await teacher('lessons.php','POST',{module_id:mid,title:'Test lesson',lesson_type:'reading',content_text:'Database lesson body',status:'published'});check(lesson.success,'Create lesson');const lid=lesson.data.lesson_id;
const draft=await teacher('lessons.php','POST',{module_id:mid,title:'Draft lesson',lesson_type:'reading',content_text:'Hidden content',status:'draft'});check(draft.success,'Create draft');
const password='student-test-'+Date.now();const created=await teacher('students.php','POST',{username:'fixture-student',full_name:'Test Student',school_id:'TEST-STUDENT',section:'Rizal',school_year:'Test Year',password});check(created.success,'Create student with explicit profile');const uid=created.data.user_id;
check((await student('auth/login.php','POST',{username:'fixture-student',password})).success,'Student login');
check((await student('lessons.php?id='+draft.data.lesson_id)).status===403,'Draft content denied');
check((await student('config.php','PUT',config)).status===403,'Student cannot edit school settings');
check((await student('lessons.php?id='+lid)).data.content_text==='Database lesson body','Published lesson content');
check((await student('progress.php','POST',{lesson_id:lid,status:'completed',completion_pct:500})).status===422,'Progress percentage validated');
check((await student('progress.php','POST',{lesson_id:lid,status:'completed',completion_pct:100,time_spent_secs:999999})).success,'Completion saved with bounded study time');
const progress=await student('progress.php');check(progress.data.summary.completed_lessons===1 || Number(progress.data.summary.completed_lessons)===1,'Completion reflected in summary');check(Number(progress.data.summary.total_time_hours)<1,'Forged study time not accepted');
const assessment=await teacher('assessments.php','POST',{title:'Test quiz',system_id:sid,module_id:mid,status:'active',time_limit_mins:10,max_attempts:2,passing_score:75});check(assessment.success,'Create assessment');const aid=assessment.data.assessment_id;
const identification=await teacher('questions.php','POST',{assessment_id:aid,question_type:'identification',question_text:'Type the fixture term',hotspot_data:{target_label:'SecretTerm'},options:[{option_text:'SecretTerm',is_correct:true}],points:1});check(identification.success,'Create identification');
const mc=await teacher('questions.php','POST',{assessment_id:aid,question_type:'multiple_choice',question_text:'Choose one',points:1,options:[{option_text:'Correct fixture option',is_correct:true},{option_text:'Incorrect fixture option',is_correct:false}]});check(mc.success,'Create multiple choice');
const hot=await teacher('questions.php','POST',{assessment_id:aid,question_type:'hotspot',question_text:'Click the marked region',points:1,hotspot_data:{target_label:'Region',image_url:'/test-image.png',x:.4,y:.6,radius:.05}});check(hot.success,'Create configured hotspot');
const bank=await student('questions.php?assessment_id='+aid);check(!JSON.stringify(bank.data).includes('SecretTerm'),'Identification key omitted entirely');check(bank.data.find(q=>q.question_type==='hotspot').hotspot_data.x===undefined,'Hotspot answer coordinates omitted');
const full=await student('assessments.php?id='+aid);check(!JSON.stringify(full.data).includes('SecretTerm'),'Assessment endpoint hides identification key');
const attempt=await student('quiz/start.php','POST',{assessment_id:aid});check(attempt.success,'Start attempt');check(attempt.data.remaining_seconds<=600,'Server deadline returned');const subid=attempt.data.submission_id;
const correctBank=await teacher('questions.php?assessment_id='+aid);const correctOption=correctBank.data.find(q=>q.question_id===mc.data.question_id).options.find(o=>o.is_correct).option_id;
const answers=[{question_id:identification.data.question_id,response_text:'SecretTerm'},{question_id:mc.data.question_id,selected_option:correctOption},{question_id:hot.data.question_id,hotspot_clicked:{x:.4,y:.6}}];
check((await student('quiz/save.php','POST',{submission_id:subid,answers})).success,'Save draft');
const resumed=await student('quiz/start.php','POST',{assessment_id:aid});check(resumed.data.submission_id===subid && resumed.data.answers.length===3,'Resume restores same attempt and answers');
check((await teacher('questions.php?id='+mc.data.question_id,'DELETE')).status===409,'Questions locked once attempted');
const graded=await student('quiz/submit.php','POST',{submission_id:subid,answers,time_taken_secs:999999});check(graded.success && graded.data.score===100,'Server grades all three question types');check(graded.data.time_taken_secs<100,'Server calculates elapsed time');
const duplicate=await student('quiz/submit.php','POST',{submission_id:subid,answers:[]});check(duplicate.success && duplicate.data.score===100,'Submission retry is idempotent');
check((await student('quiz/result.php?submission_id='+subid)).data.responses.length===3,'Historical responses preserved');
const second=await student('quiz/start.php','POST',{assessment_id:aid});check(second.success,'Second attempt');
check((await student('quiz/save.php','POST',{submission_id:second.data.submission_id,answers:[answers[0]]})).success,'Save partial attempt');
execFileSync(process.env.PHP_BINARY||(fs.existsSync('C:/xampp/php/php.exe')?'C:/xampp/php/php.exe':'php'),['tests/database.php','expire'],{stdio:'pipe'});
check((await student('quiz/save.php','POST',{submission_id:second.data.submission_id,answers})).status===409,'Expired attempts cannot save new answers');
const expired=await student('quiz/submit.php','POST',{submission_id:second.data.submission_id,answers});check(expired.success && expired.data.score===33.33,'Late submission grades only pre-deadline answers');
check((await student('quiz/start.php','POST',{assessment_id:aid})).status===403,'Attempt limit enforced');
const report=await teacher('reports.php');check(report.success && report.data.score_trend.length===1,'Trend uses real dates');
const notice=await teacher('announcements.php','POST',{title:'Custom section notice',body:'For this class only',category:'general',audience:'section:Rizal'});
check(notice.success,'Announcements support arbitrary database section names');
check((await student('announcements.php')).data.announcements.some(a=>a.title==='Custom section notice'),'Section announcement reaches its student');
const notifications=await student('notifications.php');
const scoreNotice=notifications.data.find(n=>n.id.startsWith('score:'));
check(Boolean(scoreNotice),'Score notification uses a distinct database identifier');
check((await student('notifications/mark-read.php','POST',{id:scoreNotice.id})).success,'Mark notification read');
await student('auth/logout.php','POST');await student('auth/login.php','POST',{username:'fixture-student',password});
check(!(await student('notifications.php')).data.find(n=>n.id===scoreNotice.id).unread,'Notification read state survives logout');
await teacher('students.php?id='+uid,'PUT',{section:'Bonifacio'});
check(!(await student('announcements.php')).data.announcements.some(a=>a.title==='Custom section notice'),'Another section cannot see the announcement');
check((await student('notifications/mark-read.php','POST',{id:'announcement:'+notice.data.announcement_id})).status===404,'Cannot mark another section notification as read');
await teacher('students.php?id='+uid,'PUT',{section:'Rizal'});
await student('anatomy-content.php');
const exploration=await student('analytics/exploration.php','POST',{system_id:sid,duration_secs:999999,interactions:999999});
check(exploration.success && exploration.data.duration_secs<5,'Exploration time bounded by server elapsed time');
check((await teacher('achievements.php','POST',{title:'First completion',metric:'completed_lessons',threshold:1})).success,'Create configurable goal');
const goalStats=await student('dashboard/student-stats.php');
check(goalStats.data.achievements.find(a=>a.name==='First completion')?.earned,'Database goal evaluated');
check((await teacher('achievements.php')).data.some(r=>r.badge_key==='first-game'&&r.icon==='game-controller'),'Built-in badges seeded with icons');
check((await teacher('achievements.php','POST',{title:'Play 1',metric:'games_played',threshold:1,icon:'trophy'})).success,'Game metric accepted');
check((await teacher('achievements.php','POST',{title:'Bad',metric:'games_played',threshold:1,icon:'<b>'})).status===422,'Icon must be a sprite id');
check((await teacher('achievements.php','POST',{title:'Bad',metric:'nonsense',threshold:1})).status===422,'Unknown metric rejected');
const earnedCount=r=>r.data.achievements.filter(a=>a.earned).length;
const badgeRepeat=await student('dashboard/student-stats.php');
check(earnedCount(badgeRepeat)===earnedCount(goalStats)&&earnedCount(await student('dashboard/student-stats.php'))===earnedCount(goalStats),'Earned badge count is stable across repeated loads');
const firstCompletion=badgeRepeat.data.achievements.find(a=>a.name==='First completion');
check(firstCompletion.icon==='medal'&&Boolean(firstCompletion.earned_at),'Dashboard badges carry icon and earned_at');
check((await teacher('achievements.php')).data.filter(r=>r.badge_key).length===11,'Eleven built-in badges seeded');
check((await student('achievements.php')).status===403,'Students cannot manage badge rules');
const goalRule=(await teacher('achievements.php')).data.find(r=>r.title==='First completion');
check((await teacher('achievements.php?id='+goalRule.achievement_id,'PUT',{threshold:99,icon:'target'})).success,'Teacher edits a badge');
check((await teacher('achievements.php?id='+goalRule.achievement_id,'PUT',{metric:'nonsense'})).status===422,'Edit rejects an unknown metric');
check((await teacher('achievements.php?id='+goalRule.achievement_id,'PUT',{icon:'<b>'})).status===422,'Edit rejects a bad icon');
check((await teacher('achievements.php?id=999999','PUT',{threshold:5})).status===404,'Editing a missing badge is not found');
const raised=(await student('dashboard/student-stats.php')).data.achievements.find(a=>a.name==='First completion');
check(raised.earned&&raised.icon==='target','Earned badges stay earned after the target is raised');
check((await teacher('achievements.php?id='+goalRule.achievement_id,'PUT',{is_active:false})).success,'Teacher deactivates a badge');
check(!(await student('dashboard/student-stats.php')).data.achievements.some(a=>a.name==='First completion'),'Inactive badges are hidden from students');
// Practice games: teacher sets, then scored rounds, card stats and badges.
const cardsOf=n=>Array.from({length:n},(_,i)=>({term:'Term '+i,clue:'Clue '+i}));
const set=await teacher('games/sets.php','POST',{title:'Leg bones',system_id:null,cards:[['Femur','Thigh bone'],['Tibia','Shin bone'],['Fibula','Thin leg bone'],['Patella','Kneecap']].map(([term,clue])=>({term,clue}))});
check(set.success,'Teacher creates a game set');
check((await teacher('games/sets.php','POST',{title:'Dup',cards:[{term:'A',clue:'x'},{term:'a',clue:'y'},{term:'B',clue:'z'},{term:'C',clue:'w'}]})).status===422,'Terms unique ignoring case');
check((await teacher('games/sets.php','POST',{title:'Short',cards:[{term:'A',clue:'x'}]})).status===422,'At least 4 cards');
check((await student('games/sets.php','POST',{title:'x',cards:[]})).status===403,'Students cannot create sets');
for(const [label,body] of [
  ['blank title',{title:'  ',cards:cardsOf(4)}],
  ['title over 100 characters',{title:'t'.repeat(101),cards:cardsOf(4)}],
  ['more than 200 cards',{title:'Big',cards:cardsOf(201)}],
  ['cards not a list',{title:'Odd',cards:'Femur'}],
  ['card not an object',{title:'Odd',cards:[...cardsOf(3),'Femur']}],
  ['blank term',{title:'Odd',cards:[...cardsOf(3),{term:' ',clue:'c'}]}],
  ['term over 100 characters',{title:'Odd',cards:[...cardsOf(3),{term:'t'.repeat(101),clue:'c'}]}],
  ['blank clue',{title:'Odd',cards:[...cardsOf(3),{term:'Plain',clue:''}]}],
  ['clue over 300 characters',{title:'Odd',cards:[...cardsOf(3),{term:'Plain',clue:'c'.repeat(301)}]}],
  ['group over 60 characters',{title:'Odd',cards:[...cardsOf(3),{term:'Plain',clue:'c',group:'g'.repeat(61)}]}],
  ['mesh over 150 characters',{title:'Odd',cards:[...cardsOf(3),{term:'Plain',clue:'c',mesh:'m'.repeat(151)}]}],
  ['unknown system',{title:'Odd',system_id:999999,cards:cardsOf(4)}],
])check((await teacher('games/sets.php','POST',body)).status===422,'Set rejected: '+label);
const wide=await teacher('games/sets.php','POST',{title:'t'.repeat(100),system_id:sid,cards:[{term:'t'.repeat(100),clue:'c'.repeat(300),group:'g'.repeat(60),mesh:'m'.repeat(150)},...cardsOf(199)]});
check(wide.success,'Limits are inclusive: 100-character title, 200 cards, longest term, clue, group and mesh');
const listed=await student('games/sets.php');
const wideRow=listed.data.find(s=>s.set_id===wide.data.set_id);
check(wideRow.system_id===sid&&wideRow.system_name==='Test System'&&wideRow.cards.length===200&&wideRow.is_active===true,'Students see active sets with their system name');
check(listed.data.find(s=>s.set_id===set.data.set_id).system_name===null,'A set without a system has no system name');
check((await teacher('games/sets.php?id='+wide.data.set_id,'PUT',{cards:cardsOf(3)})).status===422,'Editing validates the cards too');
check((await teacher('games/sets.php?id='+wide.data.set_id,'PUT',{})).status===422,'Editing needs a change');
check((await teacher('games/sets.php?id='+wide.data.set_id,'PUT',{title:'Unicode set',cards:[...cardsOf(3),{term:'Tibia 骨 é',clue:'Shin'}]})).success,'Teacher edits a set');
check((await teacher('games/sets.php?id='+wide.data.set_id,'PUT',{is_active:false})).success,'Teacher hides a set');
check(!(await student('games/sets.php')).data.some(s=>s.set_id===wide.data.set_id),'Hidden sets are not listed for students');
const hidden=(await teacher('games/sets.php')).data.find(s=>s.set_id===wide.data.set_id);
check(hidden&&hidden.title==='Unicode set'&&hidden.is_active===false&&hidden.cards[3].term==='Tibia 骨 é','Teachers still see hidden sets, and unicode survives');
check((await teacher('games/sets.php?id=999999','PUT',{title:'x'})).status===404,'Editing a missing set is not found');
check((await student('games/sets.php?id='+wide.data.set_id,'PUT',{title:'x'})).status===403&&(await student('games/sets.php?id='+wide.data.set_id,'DELETE')).status===403,'Students cannot edit or delete sets');
check((await teacher('games/sets.php?id='+wide.data.set_id,'DELETE')).success,'Teacher deletes a set');
check(!(await teacher('games/sets.php')).data.some(s=>s.set_id===wide.data.set_id),'A deleted set is gone');
check((await teacher('games/sets.php?id='+wide.data.set_id,'DELETE')).status===404,'Deleting a missing set is not found');

check((await teacher('achievements.php','POST',{title:'Perfect round',metric:'perfect_rounds',threshold:1})).success,'Perfect-round goal created');
check((await teacher('achievements.php','POST',{title:'Two systems',metric:'game_systems_played',threshold:2})).success,'Systems goal created');
// Before any round: an empty mastery map is an object, the board is empty, and no badge is earned yet.
const noMastery=await student('games/mastery.php');
check(noMastery.success&&!Array.isArray(noMastery.data)&&Object.keys(noMastery.data).length===0,'No rounds yet: mastery is an empty object');
const noBoard=await student('games/leaderboard.php');
check(noBoard.success&&noBoard.data.top.length===0&&noBoard.data.me===null,'No rounds yet: empty board and no rank');
const noFirst=(await student('games/badges.php')).data.find(b=>b.title==='First Game');
check(noFirst&&noFirst.earned_at===null&&noFirst.value===0,'No rounds yet: First Game is not earned and the value is 0');
const student2=client();
check((await student2('auth/login.php','POST',{username:'fixture-student',password})).success,'Same student signs in on a second device');
const roundOf=(tag,n,correct=1)=>Array.from({length:n},(_,i)=>({card_key:'sys:test-system:'+tag+i,term:tag+i,correct}));
const titles=res=>res.data.new_badges.map(b=>b.title);
// Review Focus 5: two rounds saved at the same moment award each badge once.
const [raceA,raceB]=await Promise.all([
  student('games/plays.php','POST',{game_key:'match-pairs',difficulty:'easy',duration_sec:12,results:roundOf('racea',3)}),
  student2('games/plays.php','POST',{game_key:'match-pairs',difficulty:'easy',duration_sec:12,results:roundOf('raceb',3)}),
]);
check(raceA.success&&raceB.success,'Two simultaneous rounds are both saved');
check([raceA,raceB].filter(x=>titles(x).includes('First Game')).length===1,'Exactly one of two simultaneous rounds reports First Game');
check([raceA,raceB].filter(x=>titles(x).includes('Play 1')).length===1,'Exactly one of two simultaneous rounds reports a teacher goal');
check((await student('games/badges.php')).data.filter(b=>b.title==='First Game'&&b.earned_at).length===1,'First Game is held once');
check(raceA.data.points===36&&raceB.data.points===36&&raceA.data.new_badges.concat(raceB.data.new_badges).every(b=>b.title&&b.icon&&b.achievement_id===undefined),'Easy round scores (30+6)*1 and badges carry title and icon');
check(![raceA,raceB].some(x=>titles(x).includes('Perfect round')||titles(x).includes('Flawless')),'A perfect round of 3 cards is not a perfect round');

const r=(c)=>({card_key:'set:'+set.data.set_id+':'+c[0],term:c[0],correct:c[1]});
const setRound=[['femur',1],['tibia',1],['fibula',0],['patella',1]];
const play=await student('games/plays.php','POST',{game_key:'match-pairs',difficulty:'hard',set_id:set.data.set_id,duration_sec:20,results:setRound.map(r)});
check(play.data.correct===3&&play.data.best_streak===2&&play.data.points===Math.round((30+4)*2),'Server scores the round with the hard multiplier');
check(play.data.total===4&&!titles(play).includes('First Game')&&!titles(play).includes('Perfect round'),'An earned badge is not awarded twice, and 3 of 4 is not perfect');
for(const bad of [{difficulty:'insane'},{difficulty:null},{game_key:'Bad Key!'},{game_key:'x'},{game_key:'a'.repeat(41)},{duration_sec:2},{duration_sec:3601},{results:[]},{results:roundOf('many',51)},{results:[{card_key:'',term:'Femur',correct:1}]},{results:[{card_key:'a',term:' ',correct:1}]},{results:'femur'},{set_id:999999},{system_code:'no-such-system'}])
  check((await student('games/plays.php','POST',{game_key:'match-pairs',difficulty:'easy',duration_sec:20,results:[r(['femur',1]),r(['tibia',1]),r(['fibula',1])],...bad})).status===422,'Impossible round rejected: '+JSON.stringify(bad).slice(0,60));
check((await teacher('games/plays.php','POST',{game_key:'match-pairs',difficulty:'easy',duration_sec:20,results:roundOf('t',3)})).status===403,'Teachers cannot post rounds');
check((await guest('games/plays.php','POST',{})).status===401,'Anonymous rounds rejected');
check((await student('games/plays.php')).status===405,'Rounds are posted, not fetched');
const forms=await student('games/plays.php','POST',{game_key:'sort-it',difficulty:'medium',duration_sec:30,results:[true,0,1,'1','true','false'].map((correct,i)=>({card_key:'sys:test-system:form'+i,term:'form'+i,correct}))});
check(forms.data.correct===4&&forms.data.total===6&&forms.data.best_streak===3&&forms.data.points===Math.round((40+6)*1.5),'Correct may be 1/0/true/false; the streak follows result order');
const cut=await student('games/plays.php','POST',{game_key:'unscramble',difficulty:'easy',duration_sec:15,results:[{card_key:'k'.repeat(300),term:'é'.repeat(150),correct:1}]});
check(cut.success&&cut.data.total===1,'Over-long card keys and terms are cut, not refused');
// Task 3 carry-over: a perfect round needs 4 or more cards; only non-null systems count.
const perfect=await student('games/plays.php','POST',{game_key:'beat-the-clock',difficulty:'easy',duration_sec:20,results:roundOf('perfect',4)});
check(perfect.data.points===48&&titles(perfect).includes('Perfect round')&&titles(perfect).includes('Flawless'),'A perfect round of 4 cards earns the perfect-round badges');
const inSystem=(code,tag)=>student('games/plays.php','POST',{game_key:'beat-the-clock',difficulty:'easy',duration_sec:10,system_code:code,results:roundOf(tag,3)});
check(!titles(await inSystem('test-system','sysa')).includes('Two systems'),'Rounds with no system plus one system are not two systems');
check(!titles(await inSystem('test-system','sysa2')).includes('Two systems'),'Two rounds in the same system are still one system');
const extraSystem=await teacher('anatomy-content.php','POST',{system_name:'Second System',system_code:'second-system',color_hex:'#654321',description:'Second',is_active:true,key_facts:{},structures:[]});check(extraSystem.success,'Create a second system');
check(titles(await inSystem('second-system','sysb')).includes('Two systems'),'Two different systems earn the systems goal');
execFileSync(process.env.PHP_BINARY||(fs.existsSync('C:/xampp/php/php.exe')?'C:/xampp/php/php.exe':'php'),['tests/database.php','drop-system','second-system'],{stdio:'pipe'});
// Task 5: leaderboard, mastery and badges.
const dbAction=(...args)=>execFileSync(process.env.PHP_BINARY||(fs.existsSync('C:/xampp/php/php.exe')?'C:/xampp/php/php.exe':'php'),['tests/database.php',...args],{stdio:'pipe'});
const lb=await student('games/leaderboard.php?section=Bonifacio');
const totalPoints=(await student('games/badges.php')).data.find(b=>b.metric==='total_points').value;
check(lb.data.section==='Rizal'&&lb.data.top[0].full_name==='Test Student','Students only see their own section');
check(lb.data.top.length===1&&lb.data.top[0].rank===1&&lb.data.top[0].user_id===uid&&lb.data.top[0].points===totalPoints&&totalPoints>0,'Leaderboard rows carry rank, user, name and the week\'s points');
check(lb.data.me&&lb.data.me.rank===1&&lb.data.me.points===totalPoints,'A student always sees their own rank and points');
check(/^\d{4}-\d{2}-\d{2} 00:00:00$/.test(lb.data.week_start)&&new Date(lb.data.week_start.replace(' ','T')).getDay()===1,'The week starts on a Monday at 00:00');
check((await teacher('games/leaderboard.php')).status===422,'Teacher must pick a section');
check((await teacher('games/leaderboard.php?section=Nope')).status===422,'Teacher section must be official');
check((await teacher('games/leaderboard.php?section=Bonifacio')).data.top.length===0,'Other section is empty');
const teacherBoard=await teacher('games/leaderboard.php?section=Rizal');
check(teacherBoard.data.section==='Rizal'&&teacherBoard.data.top[0].full_name==='Test Student'&&teacherBoard.data.me===null,'Teachers see the chosen section and no personal rank');
check((await guest('games/leaderboard.php')).status===401&&(await student('games/leaderboard.php','POST',{})).status===405,'Leaderboard needs sign-in and is read-only');
// Review Focus 4: a section outside the official list still gets its own board.
dbAction('legacy-section','Old Section');
const legacy=await student('games/leaderboard.php');
check(legacy.success&&legacy.data.section==='Old Section'&&legacy.data.top[0].full_name==='Test Student'&&legacy.data.me.rank===1,'A section outside the official list still works for its students');
check((await teacher('games/leaderboard.php?section=Rizal')).data.top.length===0,'Teachers see only the students currently in the section');
dbAction('legacy-section','Rizal');

// Mastery: the student map follows the rounds played so far.
const keyOf=term=>'set:'+set.data.set_id+':'+term;
const pairOf=term=>[setRound.filter(x=>x[0]===term).length,setRound.filter(x=>x[0]===term&&x[1]).length];
const mastery=(await student('games/mastery.php?section=Bonifacio')).data;
check(Array.isArray(mastery[keyOf('fibula')]),'Student mastery map');
check(['femur','tibia','fibula','patella'].every(term=>JSON.stringify(mastery[keyOf(term)])===JSON.stringify(pairOf(term))),'Card stats count each card once per round and only the correct answers');
check(Object.values(mastery).every(pair=>Array.isArray(pair)&&pair.length===2&&pair.every(Number.isInteger)),'Mastery pairs are [seen, correct] whole numbers');
const missRound=cards=>student('games/plays.php','POST',{game_key:'match-pairs',difficulty:'easy',set_id:set.data.set_id,duration_sec:20,results:cards.map(r)});
check((await missRound([['fibula',0],['tibia',1],['femur',1]])).success&&(await missRound([['fibula',0],['tibia',0],['femur',1]])).success,'Two more rounds miss fibula');
check(JSON.stringify((await student('games/mastery.php')).data[keyOf('fibula')])==='[3,0]','Mastery follows the new rounds');
const weak=(await teacher('games/mastery.php?section=Rizal')).data;
check(weak[0].term==='fibula','Most-missed term comes first');
check(JSON.stringify(weak.map(w=>[w.term,w.seen,w.correct,w.miss_rate]))===JSON.stringify([['fibula',3,0,1],['tibia',3,2,0.33],['femur',3,3,0]]),'Only terms seen 3+ times, as numbers, by miss rate');
// The missed-terms list follows where the student is now: out of Rizal their terms leave it, back in they return.
dbAction('legacy-section','Old Section');
const movedOut=(await teacher('games/mastery.php?section=Rizal')).data;
check(movedOut.length===0&&!movedOut.some(w=>['fibula','tibia','femur'].includes(w.term)),'A student who left the section no longer counts in its missed terms');
dbAction('legacy-section','Rizal');
check(JSON.stringify((await teacher('games/mastery.php?section=Rizal')).data.map(w=>w.term))===JSON.stringify(['fibula','tibia','femur']),'Back in the section, their terms count again');
check(Array.isArray((await teacher('games/mastery.php?section=Bonifacio')).data)&&(await teacher('games/mastery.php?section=Bonifacio')).data.length===0,'Another section has no missed terms');
check((await teacher('games/mastery.php')).status===422&&(await teacher('games/mastery.php?section=Nope')).status===422,'Teacher mastery needs an official section');
check((await guest('games/mastery.php')).status===401&&(await student('games/mastery.php','POST',{})).status===405,'Mastery needs sign-in and is read-only');

// Badges: every active rule with the live value and the date it was earned.
const hiddenGoal=await teacher('achievements.php','POST',{title:'Hidden goal',metric:'games_played',threshold:1});
check(hiddenGoal.success&&(await teacher('achievements.php?id='+hiddenGoal.data.achievement_id,'PUT',{is_active:false})).success,'Create and hide a goal');
const metGoal=await teacher('achievements.php','POST',{title:'Already met',metric:'games_played',threshold:1});
check(metGoal.success,'Create a goal the student already meets');
const metBadge=(await student('games/badges.php')).data.find(b=>b.title==='Already met');
check(metBadge&&metBadge.earned_at,'Listing badges awards a goal the student already meets');
const badgeList=(await student('games/badges.php')).data;
const firstGame=badgeList.find(b=>b.title==='First Game');
check(firstGame.earned_at,'Badge list shows earned date');
check(firstGame.metric==='games_played'&&firstGame.threshold===1&&firstGame.icon==='game-controller'&&firstGame.value>=1,'A badge carries its metric, target, icon and current value');
const ace=badgeList.find(b=>b.title==='Anatomy Ace');
check(ace.earned_at===null&&ace.threshold===10000&&ace.value>0&&ace.value<10000,'An unearned badge shows progress toward the target');
check(badgeList.every(b=>Object.keys(b).sort().join()==='achievement_id,earned_at,icon,metric,threshold,title,value'&&(b.value===null||typeof b.value==='number')),'Every badge has the same fields, and the value is a number or null');
check(badgeList.every((b,i)=>i===0||b.achievement_id>badgeList[i-1].achievement_id)&&!badgeList.some(b=>b.title==='Hidden goal'),'Badges are in rule order and hidden rules are left out');
check((await teacher('games/badges.php')).status===403&&(await guest('games/badges.php')).status===401,'Badges are for signed-in students');

// A long tail of missed cards: the teacher list stops at the 20 most missed, ties broken by term.
for(let i=0;i<3;i++)check((await student('games/plays.php','POST',{game_key:'sort-it',difficulty:'easy',duration_sec:30,results:roundOf('cap',25,0)})).success,'Round of 25 missed cards '+(i+1));
const capped=(await teacher('games/mastery.php?section=Rizal')).data;
check(capped.length===20&&capped[0].term==='cap0'&&capped.every(w=>w.miss_rate===1&&w.seen===3&&w.correct===0),'Teacher mastery lists at most 20 terms');

// Ranking with real classmates: ties, the top-10 cut, students who are left out, and section isolation.
const wait=ms=>new Promise(done=>setTimeout(done,ms));
const addStudent=async(tag,section)=>{
  const pass='rank-test-'+Date.now()+'-'+tag,own=client();
  const made=await teacher('students.php','POST',{username:'rank-'+tag,full_name:'Rank '+tag,school_id:'RK-'+tag,section,school_year:'Test Year',password:pass});
  check(made.success&&(await own('auth/login.php','POST',{username:'rank-'+tag,password:pass})).success,'Ranking fixture student: '+tag);
  return {name:'Rank '+tag,id:made.data.user_id,own,tag,points:0,rounds:0};
};
// Plays one easy round of n cards through the student's own session; points follow the server's answer.
const playFor=async(who,n,correct=1)=>{
  const res=await who.own('games/plays.php','POST',{game_key:'match-pairs',difficulty:'easy',duration_sec:60,results:roundOf('rk'+who.tag+(++who.rounds)+'-',n,correct)});
  check(res.success,'Ranking round saved for '+who.tag);
  who.points+=res.data.points;
};
const tieLate=await addStudent('tielate','Rizal'); // created first, so it would win a tie decided by id alone
const tieEarly=await addStudent('tieearly','Rizal');
const fillers=[];
for(const tag of ['f1','f2','f3','f4','f5','f6','f7','f8'])fillers.push(await addStudent(tag,'Rizal'));
const low=await addStudent('low','Rizal'),idle=await addStudent('idle','Rizal'),gone=await addStudent('gone','Rizal'),otherClass=await addStudent('bonifacio','Bonifacio');
// Easy rounds score 12 per card when every card is right: the fillers land on both sides of the fixture student.
for(const [who,n] of fillers.map((who,i)=>[who,[50,45,40,36,34,30,25,20][i]]))await playFor(who,n);
await playFor(low,3);
await playFor(gone,49);
await playFor(otherClass,47);
await playFor(idle,4,0);
check(idle.points===0&&low.points===36&&gone.points===588,'Ranking rounds score as planned');
// Tie: the earlier student plays first, the later one reaches the same score a second or more after,
// then the earlier student plays a round that scores nothing.
await playFor(tieEarly,32);
await wait(1100);
await playFor(tieLate,32);
await wait(1100);
await playFor(tieEarly,4,0);
check(tieEarly.points===384&&tieLate.points===384,'Two students tie on 384 points');

const names=board=>board.data.top.map(t=>t.full_name);
const before=await student('games/leaderboard.php');
check(names(before).includes(gone.name)&&names(before)[1]===gone.name,'A student who is still active is ranked');
for(let i=0;i<4;i++)check((await gone.own('games/plays.php','POST',{game_key:'sort-it',difficulty:'easy',duration_sec:10,results:[{card_key:'sys:test-system:gonecard',term:'gonecard',correct:0}]})).success,'Missed-card round '+(i+1)+' for the student about to be deactivated');
check((await teacher('games/mastery.php?section=Rizal')).data[0].term==='gonecard','An active student\'s missed terms count toward the section');
check((await teacher('students.php?id='+gone.id,'PUT',{is_active:false})).success,'Deactivate a student with points');
const afterGone=(await teacher('games/mastery.php?section=Rizal')).data;
check(afterGone[0].term==='cap0'&&!afterGone.some(w=>w.term==='gonecard'),'A deactivated student\'s missed terms no longer count');
const fixtureRow={name:'Test Student',id:uid,points:(await student('games/badges.php')).data.find(b=>b.metric==='total_points').value};
// Expected order: points high to low; a tie keeps the order of this list, earliest to reach the score first.
const standing=[fixtureRow,...fillers,tieEarly,tieLate,low].sort((a,b)=>b.points-a.points);
check(standing.length===12&&new Set(standing.map(s=>s.points)).size===11&&fixtureRow.points>408&&fixtureRow.points<432,'Twelve students have points, only the tie shares a score, and the fixture student sits between the fillers');
const aheadOf=who=>1+standing.filter(s=>s.points>who.points).length;
const board=await student('games/leaderboard.php');
const tieNames=names(board).filter(n=>n===tieEarly.name||n===tieLate.name);
check(tieNames[0]===tieEarly.name&&tieNames[1]===tieLate.name&&names(board).indexOf(tieEarly.name)+1===names(board).indexOf(tieLate.name),'Whoever reached the score first stays ahead, even after a later round that scored nothing');
check(board.data.top.length===10&&JSON.stringify(board.data.top.map(t=>[t.rank,t.user_id,t.full_name,t.points]))===JSON.stringify(standing.slice(0,10).map((s,i)=>[i+1,s.id,s.name,s.points])),'The board lists the ten best, in order, ranked 1 to 10');
check(![gone,idle,otherClass].some(s=>names(board).includes(s.name)),'Deactivated, 0-point and other-section students are left out');
check(board.data.me.rank===5&&aheadOf(fixtureRow)===5&&board.data.me.points===fixtureRow.points,'A student inside the top ten sees their own rank');
const lowBoard=await low.own('games/leaderboard.php');
check(!names(lowBoard).includes(low.name)&&lowBoard.data.me.rank===12&&lowBoard.data.me.points===36&&aheadOf(low)===12,'A student outside the top ten still sees their own rank and points');
const lastTen=await fillers[7].own('games/leaderboard.php');
check(!names(lastTen).includes(fillers[7].name)&&lastTen.data.me.rank===11&&lastTen.data.me.points===240,'The eleventh student is outside the board and ranked 11');
const [earlyBoard,lateBoard]=[await tieEarly.own('games/leaderboard.php'),await tieLate.own('games/leaderboard.php')];
check(earlyBoard.data.me.rank===7&&lateBoard.data.me.rank===7&&aheadOf(tieEarly)===7&&aheadOf(tieLate)===7,'Tied students share one rank in me');
check(JSON.stringify(names(earlyBoard))===JSON.stringify(names(board))&&earlyBoard.data.top[6].rank===7&&earlyBoard.data.top[7].rank===8,'The board itself still counts 7 then 8 for the tied pair');
const idleBoard=await idle.own('games/leaderboard.php');
check(idleBoard.data.section==='Rizal'&&idleBoard.data.me===null&&names(idleBoard).length===10,'A student whose only round scored nothing is not ranked');
const rizalTeacher=await teacher('games/leaderboard.php?section=Rizal');
check(JSON.stringify(names(rizalTeacher))===JSON.stringify(names(board))&&rizalTeacher.data.me===null,'Teachers see the same Rizal board and no personal rank');
// Section isolation with real data on both sides.
const bonifacioTeacher=await teacher('games/leaderboard.php?section=Bonifacio');
check(JSON.stringify(bonifacioTeacher.data.top.map(t=>[t.rank,t.full_name,t.points]))===JSON.stringify([[1,otherClass.name,564]]),'Bonifacio lists only its own student');
const classBoard=await otherClass.own('games/leaderboard.php?section=Rizal');
check(classBoard.data.section==='Bonifacio'&&JSON.stringify(names(classBoard))===JSON.stringify([otherClass.name])&&classBoard.data.me.rank===1&&classBoard.data.me.points===564,'A Bonifacio student asking for Rizal still gets only Bonifacio');
const nosy=await student('games/leaderboard.php?section=Bonifacio');
check(nosy.data.section==='Rizal'&&!names(nosy).includes(otherClass.name)&&JSON.stringify(names(nosy))===JSON.stringify(names(board)),'A Rizal student asking for Bonifacio still gets only Rizal');
check((await teacher('students.php?id='+uid,'PUT',{is_active:false})).success,'Deactivate student');
check((await student('scores.php')).status===401,'Existing session denied immediately after deactivation');
check((await teacher('students.php?id='+uid,'PUT',{is_active:true})).success,'Reactivate test student');
check((await student('auth/login.php','POST',{username:'fixture-student',password})).success,'Student signs in again');
check((await teacher('auth/reset-password.php','POST',{action:'teacher_reset',student_id:uid,new_password:'replacement-test-password'})).success,'Teacher-managed reset');
check((await student('auth/session.php')).status===401,'Password reset revokes existing sessions');
for(const path of ['/database/reset_student_progress.php','/database/schema.php','/.runtime/test-access.json'])check((await fetch(base+path)).status===404,'Private route protected: '+path);
console.log(`Integration checks passed: ${assertions}`);
