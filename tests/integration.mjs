import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
const base=process.env.ANTHROPOTOMY_TEST_URL || 'http://127.0.0.1:8091';
const credentials=JSON.parse(fs.readFileSync('.runtime/test-access.json','utf8'));
let assertions=0;
function check(value,message){assert.ok(value,message);assertions++;}
// contentType sends body as it is with that Content-Type (a raw, hand-made request body).
// client() returns a function that sends a request and parses the JSON answer; its .raw(path,{method,headers}) returns the fetch Response
// itself (a served file, a range, headers) with the same session cookie.
function client(){let cookie='';const call=async(path,method='GET',body,contentType)=>{const multipart=body instanceof FormData;const response=await fetch(base+'/api/'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(contentType?{'Content-Type':contentType}:body===undefined||multipart?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:multipart||contentType?body:JSON.stringify(body)});const received=response.headers.getSetCookie();if(received.length)cookie=received.map(c=>c.split(';')[0]).join('; ');let result;const raw=await response.text();try{result=JSON.parse(raw);}catch{throw new Error(path+' returned invalid JSON: '+raw.slice(0,300));}return {status:response.status,...result};};call.raw=(path,{method='GET',headers={}}={})=>fetch(base+'/api/'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...headers}});return call;}
const guest=client(),teacher=client(),student=client();
const phpBinary=process.env.PHP_BINARY||(fs.existsSync('C:/xampp/php/php.exe')?'C:/xampp/php/php.exe':'php');
const dbAction=(...args)=>execFileSync(phpBinary,['tests/database.php',...args],{stdio:'pipe'});
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
const lesson2=await teacher('lessons.php','POST',{module_id:mid,title:'Second lesson',lesson_type:'reading',content_text:'Second body',status:'published'});check(lesson2.success,'Create second lesson');const lid2=lesson2.data.lesson_id;
const mods=(await teacher('modules.php')).data,mine=mods.find(m=>m.module_id===mid);
check(mine.lessons.some(l=>l.status==='draft')&&typeof mine.material_count==='number'&&mine.updated_at,'Teacher module list carries lessons and materials');
check((await student('modules.php')).data.every(m=>!('lessons' in m)),'Students get the old shape');
check((await teacher('lessons.php?reorder=1','PUT',{module_id:mid,order:[lid]})).status===422,'Stale order rejected');
check((await teacher('lessons.php?reorder=1','PUT',{module_id:mid,order:mine.lessons.map(l=>l.lesson_id).reverse()})).success,'Reorder');
check((await teacher('modules.php')).data.find(m=>m.module_id===mid).lessons[0].lesson_id===mine.lessons.at(-1).lesson_id,'New order is kept');
check((await student('lessons.php?reorder=1','PUT',{module_id:mid,order:[]})).status===403,'Students cannot reorder');
const orderOf=async()=>(await teacher('modules.php')).data.find(m=>m.module_id===mid).lessons.map(l=>l.lesson_id);
const orderBefore=await orderOf();
for(const [label,bad] of [['short list',orderBefore.slice(1)],['foreign id',[...orderBefore.slice(1),999999999]],['duplicated id',[orderBefore[0],orderBefore[0],...orderBefore.slice(2)]],['extra id',[...orderBefore,999999999]]]){
  const res=await teacher('lessons.php?reorder=1','PUT',{module_id:mid,order:bad});
  check(res.status===422,'Stale order rejected: '+label);
  check(JSON.stringify(await orderOf())===JSON.stringify(orderBefore),'Order unchanged after rejected reorder: '+label);
}
const pdf=new FormData();pdf.append('lesson_file',new Blob([fs.readFileSync('tests/fixtures/sample.pdf')],{type:'application/pdf'}),'sample.pdf');pdf.append('title','Renamed');
const up=await teacher('lessons.php?id='+lid,'POST',pdf);check(up.success&&up.data.media_url.endsWith('.pdf'),'Multipart update attaches a PDF');
check((await teacher('lessons.php?id='+lid)).data.title==='Renamed','Multipart update saves fields');
const pdf2=new FormData();pdf2.append('lesson_file',new Blob([fs.readFileSync('tests/fixtures/sample.pdf')],{type:'application/pdf'}),'sample.pdf');
const swap=await teacher('lessons.php?id='+lid,'POST',pdf2);const oldFile='uploads/lessons/'+up.data.media_url.split('/').pop(),newFile='uploads/lessons/'+swap.data.media_url.split('/').pop();
check(swap.success&&swap.data.media_url!==up.data.media_url&&swap.data.media_url.endsWith('.pdf'),'Replacing a PDF stores a new file');
check(!fs.existsSync(oldFile)&&fs.existsSync(newFile),'Replaced file is deleted and the new one exists');
const swapBack=new FormData();swapBack.append('remove_media','1');await teacher('lessons.php?id='+lid,'POST',swapBack);check(!fs.existsSync(newFile),'Fixture file removed after the replace check');
const pdf3=new FormData();pdf3.append('lesson_file',new Blob([fs.readFileSync('tests/fixtures/sample.pdf')],{type:'application/pdf'}),'sample.pdf');up.data.media_url=(await teacher('lessons.php?id='+lid,'POST',pdf3)).data.media_url;
const bad=new FormData();bad.append('lesson_file',new Blob(['not a pdf'],{type:'text/plain'}),'x.txt');
check((await teacher('lessons.php?id='+lid,'POST',bad)).status===422,'Bad replacement rejected');
check((await teacher('lessons.php?id='+lid)).data.media_url===up.data.media_url,'Failed replace keeps the old file');
check(fs.existsSync('uploads/lessons/'+up.data.media_url.split('/').pop()),'Old file survives a failed replace');
const rm=new FormData();rm.append('remove_media','1');
check((await teacher('lessons.php?id='+lid,'POST',rm)).data.media_url===null,'Attachment removed');
check(!fs.existsSync('uploads/lessons/'+up.data.media_url.split('/').pop()),'Removed file is deleted from disk');
// Lesson files can be PowerPoint and Word too: checked by extension and by the file's first bytes, stored with their real extension.
const office=(file,name,bytes)=>{const fd=new FormData();fd.append('lesson_file',new Blob([bytes||fs.readFileSync('tests/fixtures/'+file)],{type:'application/octet-stream'}),name);return fd;};
const onDisk=url=>'uploads/lessons/'+url.split('/').pop();
const word=await teacher('lessons.php?id='+lid,'POST',office('sample.docx','worksheet.docx'));
check(word.success&&word.data.media_url.endsWith('.docx')&&fs.existsSync(onDisk(word.data.media_url)),'A Word .docx lesson file uploads and keeps its extension');
const slides=office('sample.pptx','deck.pptx');slides.append('module_id',String(mid));slides.append('title','Slides lesson');slides.append('status','draft');
const deck=await teacher('lessons.php','POST',slides);
check(deck.success&&deck.data.media_url.endsWith('.pptx')&&fs.existsSync(onDisk(deck.data.media_url)),'A new lesson with a PowerPoint .pptx file is created with a .pptx media_url');
const ole=Buffer.concat([Buffer.from([0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1]),Buffer.alloc(504)]);
const legacyDoc=await teacher('lessons.php?id='+deck.data.lesson_id,'POST',office(null,'old.ppt',ole));
check(legacyDoc.success&&legacyDoc.data.media_url.endsWith('.ppt')&&!fs.existsSync(onDisk(deck.data.media_url)),'An old .ppt (OLE file) replaces the .pptx and keeps its extension');
const legacyWord=await teacher('lessons.php?id='+deck.data.lesson_id,'POST',office(null,'old.doc',ole));
check(legacyWord.success&&legacyWord.data.media_url.endsWith('.doc'),'An old .doc (OLE file) uploads');
const lessonWithWord=(await teacher('lessons.php?id='+lid)).data;
const fakeDeck=await teacher('lessons.php?id='+lid,'POST',office('sample.pdf','fake.pptx'));
check(fakeDeck.status===422&&fakeDeck.message==='That file does not look like a real .pptx file.','A .pptx that is not a zip is refused with 422');
check(JSON.stringify((await teacher('lessons.php?id='+lid)).data)===JSON.stringify(lessonWithWord)&&fs.existsSync(onDisk(lessonWithWord.media_url)),'A refused .pptx leaves the lesson and its file unchanged');
const zipAsDoc=await teacher('lessons.php?id='+lid,'POST',office('sample.docx','renamed.doc'));
check(zipAsDoc.status===422&&zipAsDoc.message==='That file does not look like a real .doc file.','A zip named .doc is refused');
const fakeCreate=office(null,'fake.docx',Buffer.from('not really a word file'));fakeCreate.append('module_id',String(mid));fakeCreate.append('title','Fake word');
const countBeforeFake=(await teacher('lessons.php?module_id='+mid)).data.length;
check((await teacher('lessons.php','POST',fakeCreate)).status===422&&(await teacher('lessons.php?module_id='+mid)).data.length===countBeforeFake,'A fake .docx on create is refused and no lesson is made');
for(const id of [lid,deck.data.lesson_id]){const clear=new FormData();clear.append('remove_media','1');await teacher('lessons.php?id='+id,'POST',clear);}
check(!fs.existsSync(onDisk(word.data.media_url))&&!fs.existsSync(onDisk(legacyWord.data.media_url)),'Office test files are removed again');
check((await teacher('lessons.php?id='+deck.data.lesson_id,'DELETE')).success,'The slides test lesson is archived');
// A body over post_max_size reaches PHP with $_POST and $_FILES empty. Raising post_max_size per request is not possible
// from here, so a multipart body whose boundary never matches (PHP parses it to the same empty arrays) stands in for it.
const unparsed=['multipart/form-data; boundary=never-matches-'+Date.now(),'--some-other-boundary\r\nContent-Disposition: form-data; name="title"\r\n\r\nHijacked\r\n--some-other-boundary--\r\n'];
const lessonBefore=(await teacher('lessons.php?id='+lid)).data;
const oversize=await teacher('lessons.php?id='+lid,'POST',unparsed[1],unparsed[0]);
check(oversize.status===413&&oversize.message==='File too large for this server.','Unparsable multipart update answers 413 File too large');
const lessonAfter=(await teacher('lessons.php?id='+lid)).data;
check(['title','lesson_type','content_text','duration_mins','status','media_url'].every(k=>lessonAfter[k]===lessonBefore[k]),'Lesson unchanged after the 413');
const lessonCount=async()=>(await teacher('lessons.php?module_id='+mid)).data.length;
const countBefore=await lessonCount();
check((await teacher('lessons.php','POST',unparsed[1],unparsed[0])).status===413,'Unparsable multipart create answers 413');
check(await lessonCount()===countBefore,'No lesson created by the 413');
check((await teacher('lessons.php?id='+lid,'PUT',{lesson_type:'podcast'})).status===422,'Unknown lesson type rejected');
check((await student('study.php','POST',{})).success,'Study minute recorded');
check((await student('study.php','POST',{})).success,'Second tab beat accepted');
const progress=await student('progress.php');check(Number(progress.data.summary.study_days_week)===1,'Study day reflected in summary');check(Math.round(Number(progress.data.summary.total_time_hours)*60)===1,'A beat within 50 seconds adds no time');check(progress.data.study_calendar.length===28,'Four weeks of study days');
const assessment=await teacher('assessments.php','POST',{title:'Test quiz',system_id:sid,module_id:mid,status:'active',time_limit_mins:10,max_attempts:2,passing_score:75});check(assessment.success,'Create assessment');const aid=assessment.data.assessment_id;
const identification=await teacher('questions.php','POST',{assessment_id:aid,question_type:'identification',question_text:'Type the fixture term',hotspot_data:{target_label:'SecretTerm'},options:[{option_text:'SecretTerm',is_correct:true}],points:1});check(identification.success,'Create identification');
const mc=await teacher('questions.php','POST',{assessment_id:aid,question_type:'multiple_choice',question_text:'Choose one',points:1,options:[{option_text:'Correct fixture option',is_correct:true},{option_text:'Incorrect fixture option',is_correct:false}]});check(mc.success,'Create multiple choice');
const hot=await teacher('questions.php','POST',{assessment_id:aid,question_type:'hotspot',question_text:'Click the marked region',points:1,hotspot_data:{target_label:'Region',image_url:'/test-image.png',x:.4,y:.6,radius:.05}});check(hot.success,'Create configured hotspot');
const bank=await student('questions.php?assessment_id='+aid);check(!JSON.stringify(bank.data).includes('SecretTerm'),'Identification key omitted entirely');check(bank.data.find(q=>q.question_type==='hotspot').hotspot_data.x===undefined,'Hotspot answer coordinates omitted');
const typed=await teacher('assessments.php','POST',{title:'Typed',assessment_type:'identification',system_id:sid,module_id:mid});
check(typed.success,'A type sent by an old client is ignored, not an error');
check(!('assessment_type' in typed.data),'The create response carries no type');
check(!('assessment_type' in (await teacher('assessments.php?id='+aid)).data)&&!('assessment_type' in (await student('assessments.php?id='+aid)).data),'The single-assessment response carries no type');
const listed=(await teacher('assessments.php?module_id='+mid)).data;
check(listed.every(a=>a.module_id===mid&&!('assessment_type' in a))&&listed.some(a=>a.assessment_id===aid),'module_id filter; rows carry no type');
check(listed.find(a=>a.assessment_id===typed.data.assessment_id).avg_score===null,'No finished attempts: the average is null, not 0');
check(listed.find(a=>a.assessment_id===aid).question_types.multiple_choice>=1,'question_types counts per type');
check((await teacher('assessments.php?type=identification')).data.some(a=>a.assessment_id===aid),'The type filter is gone');
check((await student('assessments.php')).data.every(a=>typeof a.question_types==='object'),'Students get the question mix too');
const copy=await teacher('assessments.php?duplicate='+aid,'POST',{});
check(copy.status===201&&copy.success,'Duplicate created');
const copyRow=(await teacher('assessments.php?module_id='+mid)).data.find(a=>a.assessment_id===copy.data.assessment_id);
check(copyRow.status==='draft'&&copyRow.title.endsWith('(copy)')&&copyRow.question_count===listed.find(a=>a.assessment_id===aid).question_count,'Duplicate is a draft with every question');
const qShape=qs=>JSON.stringify(qs.map(q=>[q.question_text,q.question_type,q.hotspot_data,q.points,q.options.map(o=>[o.option_text,o.is_correct])]));
check(qShape((await teacher('questions.php?assessment_id='+aid)).data)===qShape((await teacher('questions.php?assessment_id='+copy.data.assessment_id)).data),'Duplicate copies question text, options and hotspot data');
check((await student('assessments.php?duplicate='+aid,'POST',{})).status===403,'Students cannot duplicate');
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
check(!JSON.stringify([await student('quiz/result.php?submission_id='+subid),await student('scores.php'),await student('scores.php?id='+subid),await student('dashboard/student-stats.php')]).includes('assessment_type'),'Student score and result responses carry no assessment_type');
const second=await student('quiz/start.php','POST',{assessment_id:aid});check(second.success,'Second attempt');
check((await student('quiz/save.php','POST',{submission_id:second.data.submission_id,answers:[answers[0]]})).success,'Save partial attempt');
dbAction('expire');
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
check((await teacher('achievements.php','POST',{title:'First study day',metric:'study_days_total',threshold:1})).success,'Create configurable goal');
const goalStats=await student('dashboard/student-stats.php');
check(goalStats.data.achievements.find(a=>a.name==='First study day')?.earned,'Database goal evaluated');
check((await teacher('achievements.php')).data.some(r=>r.badge_key==='first-game'&&r.icon==='game-controller'),'Built-in badges seeded with icons');
check((await teacher('achievements.php','POST',{title:'Play 1',metric:'games_played',threshold:1,icon:'trophy'})).success,'Game metric accepted');
check((await teacher('achievements.php','POST',{title:'Bad',metric:'games_played',threshold:1,icon:'<b>'})).status===422,'Icon must be a sprite id');
check((await teacher('achievements.php','POST',{title:'Bad',metric:'nonsense',threshold:1})).status===422,'Unknown metric rejected');
const earnedCount=r=>r.data.achievements.filter(a=>a.earned).length;
const badgeRepeat=await student('dashboard/student-stats.php');
check(earnedCount(badgeRepeat)===earnedCount(goalStats)&&earnedCount(await student('dashboard/student-stats.php'))===earnedCount(goalStats),'Earned badge count is stable across repeated loads');
const firstStudyDay=badgeRepeat.data.achievements.find(a=>a.name==='First study day');
check(firstStudyDay.icon==='medal'&&Boolean(firstStudyDay.earned_at),'Dashboard badges carry icon and earned_at');
const builtIns=(await teacher('achievements.php')).data;
const builtIn=key=>builtIns.find(r=>r.badge_key===key);
check(builtIns.filter(r=>r.badge_key).length===14,'Fourteen built-in badges seeded');
check([['combo-20','On a Roll','best_game_streak',20,'target'],['combo-40','Unstoppable','best_game_streak',40,'target'],['all-rounder','All-Rounder','games_variety',3,'flag']].every(([key,title,metric,threshold,icon])=>{const rule=builtIn(key);return rule&&rule.title===title&&rule.metric===metric&&Number(rule.threshold)===threshold&&rule.icon===icon&&Number(rule.is_active)===1;}),'The arcade badges are seeded and active');
check(['perfect-1','explorer-3','explorer-6','streak-10','streak-25'].every(key=>builtIn(key)&&Number(builtIn(key).is_active)===0),'The quiz-only badges are switched off');
check(['first-game','games-10','games-50','points-500','points-2000','points-10000'].every(key=>builtIn(key)&&Number(builtIn(key).is_active)===1),'The badges that still make sense stay on');
// Migrating again must not overrule a teacher who turned an old badge back on.
check((await teacher('achievements.php?id='+builtIn('streak-10').achievement_id,'PUT',{is_active:true})).success,'Teacher turns an old badge back on');
execFileSync(phpBinary,['database/migrate.php'],{stdio:'pipe'});
const afterMigrate=(await teacher('achievements.php')).data;
check(Number(afterMigrate.find(r=>r.badge_key==='streak-10').is_active)===1&&afterMigrate.filter(r=>r.badge_key).length===14,'Migrating again keeps a re-enabled badge on and seeds nothing twice');
check((await teacher('achievements.php?id='+builtIn('streak-10').achievement_id,'PUT',{is_active:false})).success,'Switch it off again for the rest of the run');
check((await student('achievements.php')).status===403,'Students cannot manage badge rules');
const goalRule=(await teacher('achievements.php')).data.find(r=>r.title==='First study day');
check((await teacher('achievements.php?id='+goalRule.achievement_id,'PUT',{threshold:99,icon:'target'})).success,'Teacher edits a badge');
check((await teacher('achievements.php?id='+goalRule.achievement_id,'PUT',{metric:'nonsense'})).status===422,'Edit rejects an unknown metric');
check((await teacher('achievements.php?id='+goalRule.achievement_id,'PUT',{icon:'<b>'})).status===422,'Edit rejects a bad icon');
check((await teacher('achievements.php?id=999999','PUT',{threshold:5})).status===404,'Editing a missing badge is not found');
const raised=(await student('dashboard/student-stats.php')).data.achievements.find(a=>a.name==='First study day');
check(raised.earned&&raised.icon==='target','Earned badges stay earned after the target is raised');
check((await teacher('achievements.php?id='+goalRule.achievement_id,'PUT',{is_active:false})).success,'Teacher deactivates a badge');
check(!(await student('dashboard/student-stats.php')).data.achievements.some(a=>a.name==='First study day'),'Inactive badges are hidden from students');
// Practice games: the retired quiz APIs and metrics, then arcade rounds, badges and the leaderboards.
check((await Promise.all(['sets','mastery'].map(name=>fetch(`${base}/api/games/${name}.php`)))).every(response=>response.status===404),'The card-set and mastery APIs are gone');
check((await teacher('achievements.php','POST',{title:'Perfect round',metric:'perfect_rounds',threshold:1})).status===422,'The retired perfect-rounds metric is rejected');
check((await teacher('achievements.php','POST',{title:'Systems goal',metric:'game_systems_played',threshold:2})).status===422,'The retired game-systems metric is rejected');
check((await teacher('achievements.php','POST',{title:'Mixed bag',metric:'games_variety',threshold:2})).success,'The different-games metric is accepted');
// Before any round: the boards are empty and no badge is earned yet.
const noBoard=await student('games/leaderboard.php');
check(noBoard.success&&noBoard.data.top.length===0&&noBoard.data.me===null,'No rounds yet: empty board and no rank');
const noGameBoard=await student('games/leaderboard.php?game=germ-smash');
check(noGameBoard.success&&noGameBoard.data.game==='germ-smash'&&noGameBoard.data.section==='Rizal'&&noGameBoard.data.top.length===0&&noGameBoard.data.me===null&&JSON.stringify(noGameBoard.data.best)==='{"all_time":0,"week":null}','No rounds yet: empty game board, no rank and no best');
const noFirst=(await student('games/badges.php')).data.find(b=>b.title==='First Game');
check(noFirst&&noFirst.earned_at===null&&noFirst.value===0,'No rounds yet: First Game is not earned and the value is 0');
const student2=client();
check((await student2('auth/login.php','POST',{username:'fixture-student',password})).success,'Same student signs in on a second device');
const round=(over={})=>({game_key:'germ-smash',difficulty:'hard',score:800,duration_sec:60,stats:{hits:60,misses:4,friendly_hits:1,best_combo:22},...over});
const arcade=(who,score,difficulty='easy')=>who('games/plays.php','POST',round({difficulty,score,stats:{hits:10,misses:2,friendly_hits:0,best_combo:3}}));
const titles=res=>res.data.new_badges.map(b=>b.title);
// Two rounds saved at the same moment award each badge once.
const [raceA,raceB]=await Promise.all([arcade(student,100),arcade(student2,100)]);
check(raceA.success&&raceB.success,'Two simultaneous rounds are both saved');
check([raceA,raceB].filter(x=>titles(x).includes('First Game')).length===1,'Exactly one of two simultaneous rounds reports First Game');
check([raceA,raceB].filter(x=>titles(x).includes('Play 1')).length===1,'Exactly one of two simultaneous rounds reports a teacher goal');
check((await student('games/badges.php')).data.filter(b=>b.title==='First Game'&&b.earned_at).length===1,'First Game is held once');
check(raceA.data.score===100&&raceA.data.points===100&&raceB.data.points===100&&raceA.data.new_badges.concat(raceB.data.new_badges).every(b=>b.title&&b.icon&&b.achievement_id===undefined),'Easy rounds score x1 and badges carry title and icon');

// The arcade round.
const saved=await student('games/plays.php','POST',round());
check(saved.data.score===800&&saved.data.points===1600,'Arcade score saved with the hard multiplier');
check(saved.data.new_badges.some(b=>b.title==='On a Roll'),'A 22 combo earns On a Roll');
check(!titles(saved).includes('Unstoppable')&&!titles(saved).includes('All-Rounder'),'A 22 combo and one game earn nothing more');
const lastPlay=JSON.parse(dbAction('last-play',String(uid)).toString());
check(lastPlay.game_key==='germ-smash'&&lastPlay.difficulty==='hard'&&Number(lastPlay.score)===800&&Number(lastPlay.points)===1600&&Number(lastPlay.correct)===60&&Number(lastPlay.total)===65&&Number(lastPlay.best_streak)===22&&Number(lastPlay.duration_sec)===60&&lastPlay.set_id===null&&lastPlay.system_id===null,'The round is stored: correct = hits, total = every tap, best_streak = best combo, score and points');
for(const bad of [{game_key:'match-pairs'},{difficulty:'insane'},{score:20001},{score:-1},{score:1.5},{duration_sec:54},{duration_sec:76},{stats:{hits:1,misses:0,friendly_hits:0,best_combo:2}},{stats:{hits:-1,misses:0,friendly_hits:0,best_combo:0}},
  {game_key:null},{game_key:['germ-smash']},{difficulty:null},{difficulty:'HARD'},{score:'800'},{score:null},{score:undefined},{duration_sec:'60'},{duration_sec:null},{duration_sec:60.5},
  {stats:null},{stats:[60,4,1,22]},{stats:{hits:60,misses:4,friendly_hits:1}},{stats:{hits:60.5,misses:4,friendly_hits:1,best_combo:22}},{stats:{hits:'60',misses:4,friendly_hits:1,best_combo:22}},{stats:{hits:60,misses:-4,friendly_hits:1,best_combo:22}},{stats:{hits:60,misses:4,friendly_hits:null,best_combo:22}},{stats:{hits:60,misses:4,friendly_hits:1,best_combo:-1}},{stats:{hits:65535,misses:1,friendly_hits:0,best_combo:0}}])
  check((await student('games/plays.php','POST',round(bad))).status===422,'Rejected: '+JSON.stringify(bad));
check((await student('games/plays.php','POST',{game_key:'match-pairs',difficulty:'easy',duration_sec:20,results:[{card_key:'a',term:'Femur',correct:1}]})).status===422,'The old quiz body is no longer accepted');
check((await teacher('games/plays.php','POST',round())).status===403,'Teachers cannot save scores');
check((await guest('games/plays.php','POST',{})).status===401,'Anonymous rounds rejected');
check((await student('games/plays.php')).status===405,'Rounds are posted, not fetched');
check((await student('games/badges.php')).data.find(b=>b.title==='First Game').value===3,'Rejected rounds saved nothing: three rounds are on record');
// A second, lower round. The fixture student's total is now 100 + 100 + 1600 + 300 = 2100 points.
const lowerRound=await arcade(student,300);
check(lowerRound.success&&lowerRound.data.score===300&&lowerRound.data.points===300,'A lower second round is saved');
const gameBoard=await student('games/leaderboard.php?game=germ-smash&section=Bonifacio');
check(gameBoard.success&&gameBoard.data.section==='Rizal'&&gameBoard.data.game==='germ-smash','The game board is the student\'s own section, whatever section is asked for');
check(JSON.stringify(gameBoard.data.top)===JSON.stringify([{rank:1,user_id:uid,full_name:'Test Student',score:800}]),'The game board ranks the weekly best score, not the sum or the latest round');
check(gameBoard.data.me.rank===1&&gameBoard.data.me.score===800&&gameBoard.data.best.all_time===800&&gameBoard.data.best.week===800,'A second, lower round does not lower the best');
check(/^\d{4}-\d{2}-\d{2} 00:00:00$/.test(gameBoard.data.week_start),'The game board carries the week start');
check((await student('games/leaderboard.php?game=nope')).status===422&&(await student('games/leaderboard.php?game=')).status===422&&(await student('games/leaderboard.php?game[]=germ-smash')).status===422,'An unknown game is rejected for students');
check((await teacher('games/leaderboard.php?game=germ-smash')).status===422,'A teacher must pick a section for the game board too');
check((await teacher('games/leaderboard.php?game=germ-smash&section=Nope')).status===422&&(await teacher('games/leaderboard.php?game=nope&section=Rizal')).status===422,'A teacher needs an official section and a known game');
check((await guest('games/leaderboard.php?game=germ-smash')).status===401&&(await student('games/leaderboard.php?game=germ-smash','POST',{})).status===405,'The game board needs sign-in and is read-only');
const teacherGameBoard=await teacher('games/leaderboard.php?game=germ-smash&section=Rizal');
check(teacherGameBoard.success&&teacherGameBoard.data.top[0].score===800&&teacherGameBoard.data.me===null&&teacherGameBoard.data.best===null,'Teachers see the board but no personal rank or best');
check((await teacher('games/leaderboard.php?game=germ-smash&section=Bonifacio')).data.top.length===0,'Another section has an empty game board');

// Leaderboard (total points): the board without a game is unchanged.
const lb=await student('games/leaderboard.php?section=Bonifacio');
const totalPoints=(await student('games/badges.php')).data.find(b=>b.metric==='total_points').value;
check(lb.data.section==='Rizal'&&lb.data.top[0].full_name==='Test Student','Students only see their own section');
check(totalPoints===2100&&lb.data.top.length===1&&lb.data.top[0].rank===1&&lb.data.top[0].user_id===uid&&lb.data.top[0].points===totalPoints,'Leaderboard rows carry rank, user, name and the week\'s points');
check(lb.data.me&&lb.data.me.rank===1&&lb.data.me.points===totalPoints,'A student always sees their own rank and points');
check(/^\d{4}-\d{2}-\d{2} 00:00:00$/.test(lb.data.week_start)&&new Date(lb.data.week_start.replace(' ','T')).getDay()===1,'The week starts on a Monday at 00:00');
check((await teacher('games/leaderboard.php')).status===422,'Teacher must pick a section');
check((await teacher('games/leaderboard.php?section=Nope')).status===422,'Teacher section must be official');
check((await teacher('games/leaderboard.php?section=Bonifacio')).data.top.length===0,'Other section is empty');
const teacherBoard=await teacher('games/leaderboard.php?section=Rizal');
check(teacherBoard.data.section==='Rizal'&&teacherBoard.data.top[0].full_name==='Test Student'&&teacherBoard.data.me===null,'Teachers see the chosen section and no personal rank');
check((await guest('games/leaderboard.php')).status===401&&(await student('games/leaderboard.php','POST',{})).status===405,'Leaderboard needs sign-in and is read-only');
// A section outside the official list still gets its own board.
dbAction('legacy-section','Old Section');
const legacy=await student('games/leaderboard.php');
check(legacy.success&&legacy.data.section==='Old Section'&&legacy.data.top[0].full_name==='Test Student'&&legacy.data.me.rank===1,'A section outside the official list still works for its students');
const legacyGame=await student('games/leaderboard.php?game=germ-smash');
check(legacyGame.success&&legacyGame.data.section==='Old Section'&&legacyGame.data.top[0].score===800&&legacyGame.data.me.rank===1,'The game board works for a section outside the official list too');
check((await teacher('games/leaderboard.php?section=Rizal')).data.top.length===0&&(await teacher('games/leaderboard.php?game=germ-smash&section=Rizal')).data.top.length===0,'Teachers see only the students currently in the section');
dbAction('legacy-section','Rizal');

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
const roll=badgeList.find(b=>b.title==='On a Roll'),unstoppable=badgeList.find(b=>b.title==='Unstoppable'),allRounder=badgeList.find(b=>b.title==='All-Rounder');
check(roll.earned_at&&roll.metric==='best_game_streak'&&roll.threshold===20&&roll.value===22,'On a Roll tracks the best combo');
check(unstoppable.earned_at===null&&unstoppable.threshold===40&&unstoppable.value===22,'Unstoppable shows progress toward a 40 combo');
check(allRounder.earned_at===null&&allRounder.metric==='games_variety'&&allRounder.threshold===3&&allRounder.icon==='flag'&&allRounder.value===1,'All-Rounder counts the different games played');
check(!badgeList.some(b=>['Flawless','Explorer','Globetrotter'].includes(b.title))&&badgeList.filter(b=>b.title==='On a Roll'||b.title==='Unstoppable').length===2,'The quiz-only badges are no longer listed');

// Ranking with real classmates: ties, the top-10 cut, students who are left out, and section isolation.
// Every ranking round is an easy Germ Smash round, so its points equal its score.
const wait=ms=>new Promise(done=>setTimeout(done,ms));
const addStudent=async(tag,section)=>{
  const pass='rank-test-'+Date.now()+'-'+tag,own=client();
  const made=await teacher('students.php','POST',{username:'rank-'+tag,full_name:'Rank '+tag,school_id:'RK-'+tag,section,school_year:'Test Year',password:pass});
  check(made.success&&(await own('auth/login.php','POST',{username:'rank-'+tag,password:pass})).success,'Ranking fixture student: '+tag);
  return {name:'Rank '+tag,id:made.data.user_id,own,tag,points:0,rounds:0};
};
// Plays one easy round through the student's own session; points follow the server's answer.
const playFor=async(who,score,difficulty='easy')=>{
  const res=await arcade(who.own,score,difficulty);
  check(res.success&&res.data.score===score,'Ranking round saved for '+who.tag);
  who.points+=res.data.points;
  who.rounds++;
  return res;
};
// The limits of a round and the three multipliers, played by a student in a section of their own.
const edge=await addStudent('edge','Luna');
const edgeTop=await edge.own('games/plays.php','POST',round({difficulty:'easy',score:20000,duration_sec:55,stats:{hits:5,misses:0,friendly_hits:0,best_combo:5}}));
check(edgeTop.success&&edgeTop.data.score===20000&&edgeTop.data.points===20000,'The top score, the shortest round and best_combo equal to hits are accepted');
const edgeMid=await edge.own('games/plays.php','POST',round({difficulty:'medium',score:101,duration_sec:75,stats:{hits:0,misses:0,friendly_hits:0,best_combo:0}}));
check(edgeMid.success&&edgeMid.data.points===152,'Medium scores x1.5, rounded (101 x 1.5 = 151.5 -> 152), and the longest round is accepted');
const edgeZero=await edge.own('games/plays.php','POST',round({difficulty:'hard',score:0,duration_sec:60,stats:{hits:0,misses:9,friendly_hits:3,best_combo:0}}));
check(edgeZero.success&&edgeZero.data.score===0&&edgeZero.data.points===0&&edgeZero.data.new_badges.every(b=>b.title!=='Unstoppable'),'A score of 0 is a valid round worth nothing');
const lunaGame=await edge.own('games/leaderboard.php?game=germ-smash');
check(JSON.stringify(lunaGame.data.top)===JSON.stringify([{rank:1,user_id:edge.id,full_name:edge.name,score:20000}])&&lunaGame.data.me.rank===1&&lunaGame.data.best.all_time===20000&&lunaGame.data.best.week===20000,'The game board shows the best score, whatever the difficulty');
const lunaPoints=await edge.own('games/leaderboard.php');
check(lunaPoints.data.top[0].points===20152&&lunaPoints.data.me.points===20152,'The points board totals every round (20000 + 152 + 0)');
// Last week's rounds count toward the all-time best but not the weekly boards.
const vet=await addStudent('vet','Luna');
await playFor(vet,700);
dbAction('backdate-plays','rank-vet','8');
const vetLast=await vet.own('games/leaderboard.php?game=germ-smash');
check(vetLast.data.me===null&&JSON.stringify(vetLast.data.best)==='{"all_time":700,"week":null}'&&vetLast.data.top.length===1&&vetLast.data.top[0].full_name===edge.name,'A round from last week is the all-time best but is not on this week\'s board');
check((await vet.own('games/leaderboard.php')).data.me===null,'The points board ignores last week\'s rounds too');
await playFor(vet,400);
const vetNow=await vet.own('games/leaderboard.php?game=germ-smash');
check(vetNow.data.me.rank===2&&vetNow.data.me.score===400&&vetNow.data.best.all_time===700&&vetNow.data.best.week===400&&JSON.stringify(vetNow.data.top.map(t=>[t.rank,t.full_name,t.score]))===JSON.stringify([[1,edge.name,20000],[2,vet.name,400]]),'This week\'s best (400) is ranked while the all-time best (700) is kept apart');
check((await vet.own('games/leaderboard.php')).data.me.points===400,'The points board counts only this week\'s round');

const tieLate=await addStudent('tielate','Rizal'); // created first, so it would win a tie decided by id alone
const tieEarly=await addStudent('tieearly','Rizal');
const fillers=[];
for(const tag of ['f1','f2','f3','f4','f5','f6','f7','f8'])fillers.push(await addStudent(tag,'Rizal'));
const low=await addStudent('low','Rizal'),idle=await addStudent('idle','Rizal'),gone=await addStudent('gone','Rizal'),otherClass=await addStudent('bonifacio','Bonifacio');
// The fillers land on both sides of the fixture student, who has 2100 points and a best score of 800.
for(const [who,score] of fillers.map((who,i)=>[who,[3000,2700,2400,2160,2040,1800,1500,1200][i]]))await playFor(who,score);
await playFor(low,180);
await playFor(gone,2940);
await playFor(otherClass,2820);
await playFor(idle,0);
check(idle.points===0&&low.points===180&&gone.points===2940,'Ranking rounds score as planned');
// Tie: the earlier student plays first, the later one reaches the same score a second or more after,
// then the earlier student plays a round that scores nothing.
await playFor(tieEarly,1920);
await wait(1100);
await playFor(tieLate,1920);
await wait(1100);
await playFor(tieEarly,0);
check(tieEarly.points===1920&&tieLate.points===1920,'Two students tie on 1920 points');

const names=board=>board.data.top.map(t=>t.full_name);
const before=await student('games/leaderboard.php');
check(names(before).includes(gone.name)&&names(before)[1]===gone.name,'A student who is still active is ranked');
const beforeGame=await student('games/leaderboard.php?game=germ-smash');
check(names(beforeGame).includes(gone.name)&&names(beforeGame)[1]===gone.name,'A student who is still active is on the game board');
check((await teacher('students.php?id='+gone.id,'PUT',{is_active:false})).success,'Deactivate a student with points');
const fixtureRow={name:'Test Student',id:uid,points:(await student('games/badges.php')).data.find(b=>b.metric==='total_points').value};
// Expected order: points high to low; a tie keeps the order of this list, earliest to reach the score first.
const standing=[fixtureRow,...fillers,tieEarly,tieLate,low].sort((a,b)=>b.points-a.points);
check(standing.length===12&&new Set(standing.map(s=>s.points)).size===11&&fixtureRow.points===2100,'Twelve students have points, only the tie shares a score, and the fixture student sits between the fillers');
const aheadOf=who=>1+standing.filter(s=>s.points>who.points).length;
const board=await student('games/leaderboard.php');
const tieNames=names(board).filter(n=>n===tieEarly.name||n===tieLate.name);
check(tieNames[0]===tieEarly.name&&tieNames[1]===tieLate.name&&names(board).indexOf(tieEarly.name)+1===names(board).indexOf(tieLate.name),'Whoever reached the score first stays ahead, even after a later round that scored nothing');
check(board.data.top.length===10&&JSON.stringify(board.data.top.map(t=>[t.rank,t.user_id,t.full_name,t.points]))===JSON.stringify(standing.slice(0,10).map((s,i)=>[i+1,s.id,s.name,s.points])),'The board lists the ten best, in order, ranked 1 to 10');
check(![gone,idle,otherClass].some(s=>names(board).includes(s.name)),'Deactivated, 0-point and other-section students are left out');
check(board.data.me.rank===5&&aheadOf(fixtureRow)===5&&board.data.me.points===fixtureRow.points,'A student inside the top ten sees their own rank');
const lowBoard=await low.own('games/leaderboard.php');
check(!names(lowBoard).includes(low.name)&&lowBoard.data.me.rank===12&&lowBoard.data.me.points===180&&aheadOf(low)===12,'A student outside the top ten still sees their own rank and points');
const lastTen=await fillers[7].own('games/leaderboard.php');
check(!names(lastTen).includes(fillers[7].name)&&lastTen.data.me.rank===11&&lastTen.data.me.points===1200,'The eleventh student is outside the board and ranked 11');
const [earlyBoard,lateBoard]=[await tieEarly.own('games/leaderboard.php'),await tieLate.own('games/leaderboard.php')];
check(earlyBoard.data.me.rank===7&&lateBoard.data.me.rank===7&&aheadOf(tieEarly)===7&&aheadOf(tieLate)===7,'Tied students share one rank in me');
check(JSON.stringify(names(earlyBoard))===JSON.stringify(names(board))&&earlyBoard.data.top[6].rank===7&&earlyBoard.data.top[7].rank===8,'The board itself still counts 7 then 8 for the tied pair');
const idleBoard=await idle.own('games/leaderboard.php');
check(idleBoard.data.section==='Rizal'&&idleBoard.data.me===null&&names(idleBoard).length===10,'A student whose only round scored nothing is not ranked');
const rizalTeacher=await teacher('games/leaderboard.php?section=Rizal');
check(JSON.stringify(names(rizalTeacher))===JSON.stringify(names(board))&&rizalTeacher.data.me===null,'Teachers see the same Rizal board and no personal rank');
// Section isolation with real data on both sides.
const bonifacioTeacher=await teacher('games/leaderboard.php?section=Bonifacio');
check(JSON.stringify(bonifacioTeacher.data.top.map(t=>[t.rank,t.full_name,t.points]))===JSON.stringify([[1,otherClass.name,2820]]),'Bonifacio lists only its own student');
const classBoard=await otherClass.own('games/leaderboard.php?section=Rizal');
check(classBoard.data.section==='Bonifacio'&&JSON.stringify(names(classBoard))===JSON.stringify([otherClass.name])&&classBoard.data.me.rank===1&&classBoard.data.me.points===2820,'A Bonifacio student asking for Rizal still gets only Bonifacio');
const nosy=await student('games/leaderboard.php?section=Bonifacio');
check(nosy.data.section==='Rizal'&&!names(nosy).includes(otherClass.name)&&JSON.stringify(names(nosy))===JSON.stringify(names(board)),'A Rizal student asking for Bonifacio still gets only Rizal');

// The game board: each student's best score this week, with the same ties, cut and isolation.
// The fixture student's best is the 800 of the hard round, so the fixture student ranks below the fillers by score.
const gameStanding=[...fillers.map(f=>({name:f.name,id:f.id,score:f.points})),{name:tieEarly.name,id:tieEarly.id,score:1920},{name:tieLate.name,id:tieLate.id,score:1920},{name:'Test Student',id:uid,score:800},{name:low.name,id:low.id,score:180}].sort((a,b)=>b.score-a.score);
const gBoard=await student('games/leaderboard.php?game=germ-smash');
check(gBoard.data.top.length===10&&JSON.stringify(gBoard.data.top.map(t=>[t.rank,t.user_id,t.full_name,t.score]))===JSON.stringify(gameStanding.slice(0,10).map((s,i)=>[i+1,s.id,s.name,s.score])),'The game board lists the ten best weekly scores, in order, ranked 1 to 10');
check(![gone,idle,otherClass].some(s=>names(gBoard).includes(s.name)),'The game board leaves out deactivated, zero-score and other-section students');
const gTie=names(gBoard).filter(n=>n===tieEarly.name||n===tieLate.name);
check(gTie[0]===tieEarly.name&&gTie[1]===tieLate.name&&names(gBoard).indexOf(tieEarly.name)+1===names(gBoard).indexOf(tieLate.name),'On a tied best score, whoever reached it first stays ahead, even after a later round that scored nothing');
check(gBoard.data.me.rank===11&&gBoard.data.me.score===800&&gBoard.data.best.all_time===800&&gBoard.data.best.week===800&&!names(gBoard).includes('Test Student'),'A student outside the top ten still sees their own rank and best');
check((await low.own('games/leaderboard.php?game=germ-smash')).data.me.rank===12,'The last student is ranked 12');
const [gEarly,gLate]=[await tieEarly.own('games/leaderboard.php?game=germ-smash'),await tieLate.own('games/leaderboard.php?game=germ-smash')];
check(gEarly.data.me.rank===6&&gLate.data.me.rank===6&&gEarly.data.top[5].rank===6&&gEarly.data.top[6].rank===7&&gEarly.data.best.week===1920,'Tied scores share one rank in me, while the board counts 6 then 7');
const gIdle=await idle.own('games/leaderboard.php?game=germ-smash');
check(gIdle.data.me===null&&JSON.stringify(gIdle.data.best)==='{"all_time":0,"week":0}'&&gIdle.data.top.length===10,'A student whose only round scored 0 is not ranked, and their best is 0');
const gRizalTeacher=await teacher('games/leaderboard.php?game=germ-smash&section=Rizal');
check(JSON.stringify(names(gRizalTeacher))===JSON.stringify(names(gBoard))&&gRizalTeacher.data.me===null&&gRizalTeacher.data.best===null,'Teachers see the same Rizal game board and no personal rank');
const gBonifacio=await teacher('games/leaderboard.php?game=germ-smash&section=Bonifacio');
check(JSON.stringify(gBonifacio.data.top.map(t=>[t.rank,t.full_name,t.score]))===JSON.stringify([[1,otherClass.name,2820]]),'The Bonifacio game board lists only its own student');
const gClass=await otherClass.own('games/leaderboard.php?game=germ-smash&section=Rizal');
check(gClass.data.section==='Bonifacio'&&JSON.stringify(names(gClass))===JSON.stringify([otherClass.name])&&gClass.data.me.rank===1,'A Bonifacio student asking for the Rizal game board still gets only Bonifacio');
const gLuna=await teacher('games/leaderboard.php?game=germ-smash&section=Luna');
check(JSON.stringify(gLuna.data.top.map(t=>[t.rank,t.full_name,t.score]))===JSON.stringify([[1,edge.name,20000],[2,vet.name,400]]),'The Luna game board holds only Luna students');
// Quiz-game rounds from before Germ Smash still count as games played and points, but not as different
// games or toward the combo badges: only keys in GAMES do.
const legacyPlayer=await addStudent('legacy','Mabini');
dbAction('legacy-play','rank-legacy','match-pairs','30','40');
dbAction('legacy-play','rank-legacy','sort-it','25','40');
await playFor(legacyPlayer,100);
const legacyBadges=(await legacyPlayer.own('games/badges.php')).data;
const legacyBadge=title=>legacyBadges.find(b=>b.title===title);
check(legacyBadge('All-Rounder').value===1&&legacyBadge('All-Rounder').earned_at===null,'Legacy quiz rounds are not different games: All-Rounder counts 1 after one Germ Smash round');
check(legacyBadge('On a Roll').value===3&&legacyBadge('On a Roll').earned_at===null,'A legacy quiz streak of 30 is not a combo: On a Roll counts the Germ Smash combo of 3');
check(legacyBadge('First Game').value===3&&legacyBadges.find(b=>b.metric==='total_points').value===180,'Legacy quiz rounds still count as games played (3) and points (40 + 40 + 100)');
check((await teacher('students.php?id='+legacyPlayer.id,'PUT',{is_active:false})).success,'The legacy-rounds student leaves the boards, so Mabini has no scores');
{
    const playedCount=async()=>(await student('games/badges.php')).data.find(b=>b.metric==='games_played').value;
    const before=await playedCount(), roundId='a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const first=await student('games/plays.php','POST',round({round_id:roundId,difficulty:'easy',score:640}));
    const again=await student('games/plays.php','POST',round({round_id:roundId,difficulty:'easy',score:640}));
    check(first.success&&again.success&&again.data.points===first.data.points&&again.data.new_badges.length===0,'Resending a round with the same round_id answers like the first save');
    check(await playedCount()===before+1,'A round resent with the same round_id is saved once');
    check((await student('games/plays.php','POST',round({round_id:'f'.repeat(32)}))).success&&await playedCount()===before+2,'A different round_id is a new round');
    for(const bad of ['short','Z'.repeat(32),123])check((await student('games/plays.php','POST',round({round_id:bad}))).status===422,'Malformed round_id rejected: '+JSON.stringify(bad));
}
{
    const run=(over={})=>({game_key:'cell-runner',difficulty:'easy',score:3000,duration_sec:120,stats:{hits:12,misses:3,friendly_hits:0,best_combo:7},...over});
    const saved=await student('games/plays.php','POST',run());
    check(saved.success&&saved.data.points===3000,'A Cell Runner run saves');
    for(const ok of [{duration_sec:5},{duration_sec:900},{score:250000}])check((await student('games/plays.php','POST',run(ok))).success,'Cell Runner accepts '+JSON.stringify(ok));
    for(const bad of [{duration_sec:4},{duration_sec:901},{score:250001}])check((await student('games/plays.php','POST',run(bad))).status===422,'Cell Runner rejects '+JSON.stringify(bad));
    const board=await student('games/leaderboard.php?game=cell-runner');
    check(board.success&&board.data.game==='cell-runner'&&board.data.best.all_time===250000,'Cell Runner has its own board and best');
}
{
    const round=(over={})=>({game_key:'neuron-link',difficulty:'easy',score:3000,duration_sec:120,stats:{hits:6,misses:9,friendly_hits:0,best_combo:2},...over});
    const saved=await student('games/plays.php','POST',round());
    check(saved.success&&saved.data.points===3000,'A Neuron Link round saves');
    for(const ok of [{duration_sec:115},{duration_sec:135},{score:100000}])check((await student('games/plays.php','POST',round(ok))).success,'Neuron Link accepts '+JSON.stringify(ok));
    for(const bad of [{duration_sec:114},{duration_sec:136},{score:100001}])check((await student('games/plays.php','POST',round(bad))).status===422,'Neuron Link rejects '+JSON.stringify(bad));
    const board=await student('games/leaderboard.php?game=neuron-link');
    check(board.success&&board.data.game==='neuron-link'&&board.data.best.all_time===100000,'Neuron Link has its own board and best');
}
check((await teacher('students.php?id='+uid,'PUT',{is_active:false})).success,'Deactivate student');
check((await student('scores.php')).status===401,'Existing session denied immediately after deactivation');
check((await teacher('students.php?id='+uid,'PUT',{is_active:true})).success,'Reactivate test student');
check((await student('auth/login.php','POST',{username:'fixture-student',password})).success,'Student signs in again');
check((await teacher('auth/reset-password.php','POST',{action:'teacher_reset',student_id:uid,new_password:'replacement-test-password'})).success,'Teacher-managed reset');
check((await student('auth/session.php')).status===401,'Password reset revokes existing sessions');
for(const path of ['/database/reset_student_progress.php','/database/schema.php','/.runtime/test-access.json'])check((await fetch(base+path)).status===404,'Private route protected: '+path);
{
    const login=await fetch(base+'/api/auth/login.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)});
    const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
    const form=new FormData();form.append('kind','material');form.append('module_id',mid);form.append('title','Range fixture');
    form.append('file',new Blob([fs.readFileSync('tests/fixtures/sample.pdf')],{type:'application/pdf'}),'sample.pdf');
    const material=await teacher('files.php','POST',form);check(material.success,'Upload a material for range checks');
    const url=base+'/api/files.php?id='+material.data.file_id,whole=fs.readFileSync('tests/fixtures/sample.pdf'),size=whole.length;
    const get=range=>fetch(url,{headers:{Cookie:cookie,...(range?{Range:range}:{})}});
    let r=await get();check(r.status===200&&r.headers.get('accept-ranges')==='bytes'&&Number(r.headers.get('content-length'))===size,'File served whole advertises byte ranges');
    r=await get('bytes=0-99');check(r.status===206&&r.headers.get('content-range')===`bytes 0-99/${size}`&&Buffer.from(await r.arrayBuffer()).equals(whole.subarray(0,100)),'Range 0-99 returns 100 bytes');
    r=await get('bytes=-10');check(r.status===206&&r.headers.get('content-range')===`bytes ${size-10}-${size-1}/${size}`&&Buffer.from(await r.arrayBuffer()).equals(whole.subarray(size-10)),'Suffix range returns the last 10 bytes');
    r=await get(`bytes=${size-5}-`);check(r.status===206&&Buffer.from(await r.arrayBuffer()).equals(whole.subarray(size-5)),'Open range runs to the end');
    r=await get(`bytes=${size}-`);check(r.status===416&&r.headers.get('content-range')===`bytes */${size}`,'Range past the end is 416');
    r=await get('bytes=0-1,5-9');check(r.status===200&&Number(r.headers.get('content-length'))===size,'Multi-range is ignored');
    r=await get('bytes=abc');check(r.status===200,'Malformed range is ignored');
    check((await fetch(url,{headers:{Range:'bytes=0-9'}})).status===401,'Ranges do not skip the access check');
}
// Headers of a served file (the streaming function is shared by materials, lesson files and previews).
{
    const upload=(file,name,type)=>{const form=new FormData();form.append('kind','material');form.append('module_id',mid);form.append('title','Header fixture '+name);form.append('file',new Blob([fs.readFileSync('tests/fixtures/'+file)],{type}),name);return teacher('files.php','POST',form);};
    const pdf=await upload('sample.pdf','sample.pdf','application/pdf');check(pdf.success,'Upload a PDF material for header checks');
    let r=await teacher.raw('files.php?id='+pdf.data.file_id);
    check(r.status===200&&r.headers.get('content-type')==='application/pdf','A PDF material is served as application/pdf');
    const disposition=r.headers.get('content-disposition')||'';
    check(disposition.startsWith('inline;')&&disposition.includes("filename*=UTF-8''sample.pdf"),'A PDF opens inline under its own name');
    check(r.headers.get('x-content-type-options')==='nosniff'&&r.headers.get('cache-control')==='private, no-store','Served files are never sniffed or cached');
    await r.arrayBuffer();
    const deck=await upload('sample.pptx','deck.pptx','application/octet-stream');check(deck.success,'Upload a PowerPoint material for header checks');
    r=await teacher.raw('files.php?id='+deck.data.file_id);
    check(r.status===200&&(r.headers.get('content-disposition')||'').startsWith('attachment;'),'A PowerPoint material still downloads as an attachment');
    await r.arrayBuffer();
}
// Previews of PowerPoint and Word materials. The suite's server runs the fake converter (tests/fixtures/fake-soffice.cmd, run with -Stub):
// a file containing FAIL-CONVERT cannot be converted and one containing HANG-CONVERT never finishes (the server's timeout is 5 seconds).
{
    const teacher2=client();
    dbAction('add-teacher','fixture-teacher-2','second-teacher-test-password');
    check((await teacher2('auth/login.php','POST',{username:'fixture-teacher-2',password:'second-teacher-test-password'})).success,'Second teacher signs in');
    check((await student('auth/login.php','POST',{username:'fixture-student',password:'replacement-test-password'})).success,'Student signs in for preview checks');
    const send=(who,file,name,{kind='material',title=name,allow,bytes}={})=>{const form=new FormData();form.append('kind',kind);if(kind==='material')form.append('module_id',mid);form.append('title',title);if(allow!==undefined)form.append('allow_download',allow?'1':'0');form.append('file',new Blob([bytes||fs.readFileSync('tests/fixtures/'+file)],{type:'application/octet-stream'}),name);return who('files.php','POST',form);};
    const previewFiles=()=>fs.readdirSync('storage/files').filter(n=>n.endsWith('.preview.pdf')).length;
    const workFolders=()=>fs.existsSync('storage/preview-work')?fs.readdirSync('storage/preview-work').length:0;
    const row=async(who,id)=>(await who('files.php?kind=material&module_id='+mid)).data.find(f=>f.file_id===id);
    const drain=async r=>{await r.arrayBuffer();return r;};

    const deck=await send(teacher,'sample.pptx','Deck.pptx',{title:'Skeleton deck'});const fid=deck.data?.file_id;
    check(deck.success&&deck.data.preview===true,'Material upload makes a preview');
    let r=await row(teacher,fid);
    check(r.has_preview===true&&r.allow_download===false&&r.can_download===true&&!('stored_name' in r),'Teacher list row: preview made, downloads off, teacher may still download, no stored name leaks');
    let res=await teacher.raw('files.php?id='+fid+'&preview=1');
    check(res.status===200&&res.headers.get('content-type')==='application/pdf'&&(res.headers.get('content-disposition')||'').startsWith('inline;')&&(res.headers.get('content-disposition')||'').includes("filename*=UTF-8''Deck.pdf"),'Preview streams inline as a PDF named after the file');
    check(Buffer.from(await res.arrayBuffer()).subarray(0,4).toString()==='%PDF','Preview body is a PDF');
    res=await drain(await teacher.raw('files.php?id='+fid+'&preview=1',{headers:{Range:'bytes=0-3'}}));check(res.status===206,'Preview supports byte ranges');

    // A student of a published module views the preview but is not sent the original.
    res=await drain(await student.raw('files.php?id='+fid+'&preview=1'));check(res.status===200&&res.headers.get('content-type')==='application/pdf','Student gets the preview');
    let denied=await student('files.php?id='+fid);check(denied.status===403&&denied.message==='This file is view-only.','Student is refused the original of a view-only file');
    r=await row(student,fid);check(r.has_preview===true&&r.can_download===false,'Student list row says view-only');
    check((await student('files.php?id='+fid,'PUT',{allow_download:true})).status===403,'A student cannot change the download switch');
    check((await teacher2('files.php?id='+fid,'PUT',{allow_download:true})).status===404,'Another teacher cannot change the download switch');
    // The teacher's switch.
    check((await teacher('files.php?id='+fid,'PUT',{allow_download:true})).success,'Teacher switches downloads on');
    res=await drain(await student.raw('files.php?id='+fid));check(res.status===200&&(res.headers.get('content-disposition')||'').startsWith('attachment;'),'Student gets the original once downloads are on');
    r=await row(student,fid);check(r.can_download===true&&r.allow_download===true,'Student list row says downloadable');
    check((await teacher('files.php?id='+fid,'PUT',{allow_download:false})).success,'Teacher switches downloads off again');
    check((await student('files.php?id='+fid)).status===403,'The original is refused again');
    // An upload can start with downloads on.
    const open=await send(teacher,'sample.docx','Handout.docx',{allow:true});check(open.success&&(await row(student,open.data.file_id)).can_download===true,'Upload with the switch on is downloadable for students');
    // Unpublished module.
    check((await teacher('modules.php?id='+mid,'PUT',{status:'draft'})).success,'Module set to draft');
    check((await student('files.php?id='+fid+'&preview=1')).status===404&&(await student('files.php?id='+fid)).status===404,'A draft module hides both the preview and the original');
    check((await teacher('modules.php?id='+mid,'PUT',{status:'published'})).success,'Module published again');
    // Lesson plans stay private.
    const plan=await send(teacher,'sample.pptx','Plan.pptx',{kind:'lesson_plan'});
    check(plan.success&&plan.data.preview===true,'A lesson plan gets a preview too');
    res=await drain(await teacher.raw('files.php?id='+plan.data.file_id+'&preview=1'));check(res.status===200,'Its owner opens the plan preview');
    check((await student('files.php?id='+plan.data.file_id+'&preview=1')).status===404&&(await teacher2('files.php?id='+plan.data.file_id+'&preview=1')).status===404,'Nobody else can open a lesson plan preview');
    // A file that cannot be converted still uploads and still downloads.
    const bad=await send(teacher,'','bad.pptx',{bytes:Buffer.from('PK\x03\x04FAIL-CONVERT')});
    check(bad.success&&bad.data.preview===false,'A deck the converter rejects still uploads, with no preview');
    r=await row(student,bad.data.file_id);check(r.has_preview===false&&r.can_download===true,'Without a preview the student may download it');
    res=await drain(await student.raw('files.php?id='+bad.data.file_id));check(res.status===200,'The student gets the original of a deck with no preview');
    check((await student('files.php?id='+bad.data.file_id+'&preview=1')).status===404,'There is no preview to open');
    // The material's row is saved only after its preview exists. Saved first, a student could list the material and download the
    // original while a slow conversion was still running. The fake converter records how many "Probe deck" rows exist when it runs.
    const probeFile=os.tmpdir()+'/anthropotomy-probe.txt';fs.rmSync(probeFile,{force:true});
    const probe=await send(teacher,'','probe.pptx',{title:'Probe deck',bytes:Buffer.from('PK\x03\x04PROBE-ROWS')});
    check(probe.success&&probe.data.preview===true&&fs.existsSync(probeFile),'A probe deck uploads, gets a preview and the converter saw it');
    check(fs.readFileSync(probeFile,'utf8').trim()==='0','The material row does not exist yet while the converter runs');
    // A converter that never finishes does not hang the upload.
    const started=Date.now();const hung=await send(teacher,'','hang.pptx',{bytes:Buffer.from('PK\x03\x04HANG-CONVERT')});
    check(hung.success&&hung.data.preview===false&&Date.now()-started<20000,'A hung converter is stopped and the upload still succeeds ('+(Date.now()-started)+' ms)');
    check(workFolders()===0,'The hung run leaves no work folder');
    // Two uploads at once.
    const both=await Promise.all([send(teacher,'sample.pptx','one.pptx'),send(teacher2,'sample.docx','two.docx')]);
    check(both.every(x=>x.success&&x.data.preview===true),'Two simultaneous uploads both get previews');
    // Unusual file name.
    const odd=await send(teacher,'sample.docx','Ligaments & Joints - réview.docx');
    res=await drain(await teacher.raw('files.php?id='+odd.data.file_id+'&preview=1'));
    check(res.status===200&&(res.headers.get('content-disposition')||'').includes("filename*=UTF-8''Ligaments%20%26%20Joints%20-%20r%C3%A9view.pdf"),'A name with spaces, an ampersand and an accent streams under a sane name');
    // PDFs are unchanged.
    const pdf=await send(teacher,'sample.pdf','Notes.pdf');
    check(pdf.success&&pdf.data.preview===false,'A PDF gets no preview');
    r=await row(student,pdf.data.file_id);check(r.has_preview===false&&r.can_download===true,'A PDF stays downloadable whatever the switch says');
    // Deleting removes the preview.
    const before=previewFiles();check((await teacher('files.php?id='+both[0].data.file_id,'DELETE')).success,'Delete a deck material');
    check(previewFiles()===before-1,'Deleting a material deletes its preview');
}
// Previews of PowerPoint and Word lesson files (same fake converter). A lesson file is only fetched through lessons.php?id=N&file=preview|original.
{
    const make=(name,{file='sample.pptx',bytes,title=name,status='published',allow}={})=>{const fd=office(file,name,bytes);fd.append('module_id',String(mid));fd.append('title',title);fd.append('lesson_type','reading');fd.append('status',status);if(allow!==undefined)fd.append('allow_download',allow?'1':'0');return teacher('lessons.php','POST',fd);};
    const one=async(who,id)=>(await who('lessons.php?id='+id)).data;
    const listed=async(who,id)=>(await who('lessons.php?module_id='+mid)).data.find(l=>l.lesson_id===id);
    const drain=async r=>{await r.arrayBuffer();return r;};
    const previewOf=url=>onDisk(url)+'.preview.pdf';

    const deck=await make('Deck.pptx',{title:'Skeleton slides'});const lid=deck.data?.lesson_id;
    check(deck.success&&deck.data.preview===true&&fs.existsSync(previewOf(deck.data.media_url)),'A new PowerPoint lesson gets a preview next to its file');
    let t=await one(teacher,lid);
    check(t.has_preview===true&&t.allow_download===false&&t.can_download===true&&t.view_url?.endsWith('lessons.php?id='+lid+'&file=preview')&&t.download_url?.endsWith('lessons.php?id='+lid+'&file=original'),'Teacher sees the preview and download addresses');
    let s=await one(student,lid);
    check(s.has_preview===true&&s.can_download===false&&s.download_url===null&&s.view_url?.endsWith('&file=preview'),'Student gets a view address and no download address');
    let row=await listed(student,lid);check(row.has_preview===true&&row.can_download===false&&!('allow_download' in row),'The student lesson list says view-only');
    let res=await student.raw('lessons.php?id='+lid+'&file=preview');
    check(res.status===200&&res.headers.get('content-type')==='application/pdf'&&(res.headers.get('content-disposition')||'').startsWith('inline;')&&(res.headers.get('content-disposition')||'').includes("filename*=UTF-8''Skeleton%20slides.pdf"),'Student streams the preview inline under the lesson title');
    check(Buffer.from(await res.arrayBuffer()).subarray(0,4).toString()==='%PDF','The preview is a PDF');
    res=await drain(await student.raw('lessons.php?id='+lid+'&file=preview',{headers:{Range:'bytes=0-3'}}));check(res.status===206,'The preview supports byte ranges');
    let denied=await student('lessons.php?id='+lid+'&file=original');check(denied.status===403&&denied.message==='This file is view-only.','Student is refused the original of a view-only lesson file');
    check((await student('lessons.php?id='+lid+'&file=other')).status===422,'An unknown file kind is rejected');
    // The switch: JSON update, and a multipart update that carries only the switch.
    check((await teacher('lessons.php?id='+lid,'PUT',{allow_download:true})).success,'Teacher switches downloads on');
    s=await one(student,lid);check(s.can_download===true&&s.allow_download===true&&s.download_url?.endsWith('&file=original'),'Student now gets a download address');
    res=await drain(await student.raw('lessons.php?id='+lid+'&file=original'));check(res.status===200&&(res.headers.get('content-disposition')||'').includes("attachment;")&&(res.headers.get('content-disposition')||'').includes("Skeleton%20slides.pptx"),'Student gets the original as an attachment');
    const off=new FormData();off.append('allow_download','0');check((await teacher('lessons.php?id='+lid,'POST',off)).success&&(await one(teacher,lid)).allow_download===false,'A multipart update can switch downloads off');
    check((await student('lessons.php?id='+lid+'&file=original')).status===403,'The original is refused again');
    // Drafts stay hidden.
    check((await teacher('lessons.php?id='+lid,'PUT',{status:'draft'})).success,'Lesson set to draft');
    check((await student('lessons.php?id='+lid+'&file=preview')).status===403&&(await student('lessons.php?id='+lid+'&file=original')).status===403,'A draft lesson file is hidden from students');
    check((await teacher('lessons.php?id='+lid,'PUT',{status:'published'})).success,'Lesson published again');
    // An older deck with no preview (made before this feature, or with no converter) still downloads.
    fs.unlinkSync(previewOf(deck.data.media_url));
    s=await one(student,lid);check(s.has_preview===false&&s.can_download===true&&s.view_url===null,'A deck with no preview is downloadable for students');
    res=await drain(await student.raw('lessons.php?id='+lid+'&file=original'));check(res.status===200,'The original of a deck with no preview streams through the API');
    check((await student('lessons.php?id='+lid+'&file=preview')).status===404,'There is no preview to open');
    // A deck the converter rejects.
    const bad=await make('bad.pptx',{bytes:Buffer.from('PK\x03\x04FAIL-CONVERT')});
    check(bad.success&&bad.data.preview===false,'A deck the converter rejects still saves, with no preview');
    s=await one(student,bad.data.lesson_id);check(s.has_preview===false&&s.can_download===true,'Students can download a deck that has no preview');
    // Replacing a deck with a PDF removes the old file and its preview.
    const swapDeck=await make('Swap.pptx');const oldUrl=swapDeck.data.media_url;
    const toPdf=office('sample.pdf','Swap.pdf');const swapped=await teacher('lessons.php?id='+swapDeck.data.lesson_id,'POST',toPdf);
    check(swapped.success&&swapped.data.preview===false&&!fs.existsSync(onDisk(oldUrl))&&!fs.existsSync(previewOf(oldUrl)),'Replacing a deck with a PDF deletes the old file and its preview');
    s=await one(student,swapDeck.data.lesson_id);check(s.has_preview===false&&s.can_download===true,'The PDF lesson is downloadable and has no preview');
    // Replacing a PDF with a deck makes a preview.
    const toDeck=await teacher('lessons.php?id='+swapDeck.data.lesson_id,'POST',office('sample.pptx','Back.pptx'));
    check(toDeck.success&&toDeck.data.preview===true&&fs.existsSync(previewOf(toDeck.data.media_url)),'Replacing a PDF with a deck makes a preview');
    // Removing the file removes the preview; archiving keeps both.
    const removeIt=new FormData();removeIt.append('remove_media','1');const goneUrl=toDeck.data.media_url;
    check((await teacher('lessons.php?id='+swapDeck.data.lesson_id,'POST',removeIt)).success&&!fs.existsSync(onDisk(goneUrl))&&!fs.existsSync(previewOf(goneUrl)),'Removing the file deletes the preview too');
    const keep=await make('Keep.pptx');check((await teacher('lessons.php?id='+keep.data.lesson_id,'DELETE')).success&&fs.existsSync(onDisk(keep.data.media_url))&&fs.existsSync(previewOf(keep.data.media_url)),'Archiving a lesson keeps its file and preview');
    // A title with spaces, an ampersand and an accent.
    const odd=await make('odd.pptx',{title:'Joints & ligaments — révision'});
    res=await drain(await teacher.raw('lessons.php?id='+odd.data.lesson_id+'&file=preview'));
    check(res.status===200&&(res.headers.get('content-disposition')||'').includes("filename*=UTF-8''Joints%20%26%20ligaments%20%E2%80%94%20r%C3%A9vision.pdf"),'A title with spaces, an ampersand and accents streams under a sane name');
    // Two uploads at once.
    const both=await Promise.all([make('one.pptx'),make('two.docx',{file:'sample.docx'})]);
    check(both.every(x=>x.success&&x.data.preview===true),'Two simultaneous lesson uploads both get previews');
    // A PDF lesson is unchanged.
    const pdf=await make('Notes.pdf',{file:'sample.pdf'});
    s=await one(student,pdf.data.lesson_id);check(pdf.data.preview===false&&s.has_preview===false&&s.can_download===true,'A PDF lesson has no preview and stays downloadable');
}
console.log(`Integration checks passed: ${assertions}`);
