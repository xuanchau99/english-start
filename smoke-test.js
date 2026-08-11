'use strict';

const fs=require('fs');
const vm=require('vm');
const app=fs.readFileSync('app.js','utf8');
const curriculumSource=fs.readFileSync('curriculum-data.js','utf8');
assert(!app.includes('^AIza'), 'Frontend không được ép Gemini key phải bắt đầu bằng AIza');
const html=fs.readFileSync('index.html','utf8');
const backend=fs.readFileSync('google-apps-script.gs','utf8');

function assert(condition,message) { if (!condition) throw new Error(message); }
function extract(name,nextMarker) {
  const start=app.indexOf('const '+name+' = '); assert(start>=0,'Không tìm thấy '+name);
  const valueStart=start+('const '+name+' = ').length,end=app.indexOf(nextMarker,valueStart); assert(end>valueStart,'Không tìm thấy điểm kết thúc '+name);
  return vm.runInNewContext('('+app.slice(valueStart,end).trim().replace(/;$/,'')+')');
}

function loadAiHelpers() {
  const start=app.indexOf('  function parseJsonObject');
  const end=app.indexOf('\n  function routeTo',start);
  assert(start>=0&&end>start,'Không tìm thấy AI response helpers');
  const context={};
  vm.runInNewContext(app.slice(start,end)+'\nthis.normalizeAiResponse=normalizeAiResponse;this.aiText=aiText;',context);
  return context;
}

const roadmap=extract('roadmapData','\n  const practiceData');
const practice=extract('practiceData','\n\n  function currentGoalId');
const levels=['A1','A2','B1','B2'];
const curriculumContext={window:{}};
vm.runInNewContext(curriculumSource,curriculumContext);
const curriculum=curriculumContext.window.FLUENTGO_CURRICULUM;

levels.forEach(level=>{
  assert(roadmap[level]&&roadmap[level].length>=8,level+' cần ít nhất 8 roadmap node');
  assert(practice[level].listening.length>=5,level+' cần ít nhất 5 bài nghe');
  assert(practice[level].reading.length>=5,level+' cần ít nhất 5 bài đọc');
  assert(practice[level].speaking.length>=3,level+' cần ít nhất 3 câu nói');
  assert(practice[level].writing.length>=3,level+' cần ít nhất 3 đề viết');
  assert(practice[level].vocabulary.length>=6,level+' cần ít nhất 6 từ');
});
assert(curriculum.stats.goals>=6,'Kho học cần ít nhất 6 mục tiêu');
assert(curriculum.stats.units===288,'Lộ trình cần 12 chặng cho mỗi mục tiêu và trình độ');
assert(curriculum.stats.lessons===1728,'Kho lộ trình cần 1.728 bài học');
assert(curriculum.stats.exercises>=5000,'Kho bài tập phải có trên 5.000 dữ liệu');
assert(curriculum.stats.types>=10,'Kho bài tập cần ít nhất 10 dạng');
assert(new Set(curriculum.exerciseBank.map(item=>item.id)).size===curriculum.exerciseBank.length,'Exercise ID phải duy nhất');
assert(curriculum.exerciseBank.filter(item=>!['speaking','writing'].includes(item.type)).every(item=>Array.isArray(item.options)&&item.options.includes(item.answer)),'Mọi bài lựa chọn phải chứa đáp án đúng');
assert(curriculum.getExercises('developer','A1','listening','all')[0].audio!==curriculum.getExercises('developer','B2','listening','all')[0].audio,'Nội dung phải tăng độ khó theo level');
Object.keys(curriculum.goals).forEach(goal=>levels.forEach(level=>{
  assert(curriculum.getRoadmap(goal,level).length===12,goal+' '+level+' cần đúng 12 chặng');
  assert(curriculum.getVocabulary(goal,level,'all').length>=24,goal+' '+level+' cần ít nhất 24 flashcard');
  ['listening','reading','speaking','writing'].forEach(type=>assert(curriculum.toPracticeDeck(goal,level,type,'all').length>=24,goal+' '+level+' cần ít nhất 24 bài '+type));
}));

const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
assert(new Set(ids).size===ids.length,'HTML có ID bị trùng');
['nextListening','nextReading','nextSpeaking','nextWriting','practiceLevelSelect','practiceGoalSelect','roadmapGoalSelect','roadmapUnitSelect','vocabularyTopicSelect','challengeTypeSelect','nextChallenge','listeningSummary','readingSummary','vocabularySummary','listeningTranscript'].forEach(id=>assert(ids.includes(id),'Thiếu #'+id));
assert(html.includes('curriculum-data.js'),'Frontend chưa nạp curriculum engine');
assert(app.includes("bridgeCall('gemini'"),'Frontend chưa gọi Gemini qua Apps Script');
assert(backend.includes('UrlFetchApp.fetch'),'Apps Script chưa có Gemini proxy');
assert(backend.includes('CONFIG_PROPERTY_KEY'),'Apps Script chưa cache config trong Script Properties');
assert(backend.includes('callGeminiWithRefresh_'),'Apps Script chưa refresh key khi lỗi xác thực');
assert(backend.includes('normalizeGeminiPayload_'),'Apps Script chưa unwrap JSON nhiều lớp');
assert(backend.includes("'explain'"),'Apps Script chưa hỗ trợ AI giải thích bài tập');
assert(!app.includes('x-goog-api-key'),'Frontend vẫn chứa logic gửi Gemini key');
assert(app.includes("renderFiniteSummary('vocabulary')"),'Flashcard chưa có điểm kết thúc');
assert(app.includes("return renderFiniteSummary(type)"),'Nghe/đọc chưa có điểm kết thúc');
assert(app.includes('instance.continuous=true'),'Chat microphone chưa bật nhận diện liên tục');
assert(app.includes('chatRecognitionShouldRun'),'Chat microphone chưa giữ trạng thái cho tới khi user bấm Stop');
assert(app.includes('startChatRecognitionCycle(SpeechRecognition),180'),'Chat microphone chưa tự nối lại khi trình duyệt kết thúc phiên');
assert(app.includes('Hãy nhấn nút Stop'),'Chat vẫn có thể gửi khi microphone đang ghi');
assert(app.includes('function startSpeakingRecognitionCycle'),'Luyện nói chưa có chu kỳ nhận diện liên tục');
assert(app.includes('instance.continuous=true'),'Microphone chưa bật chế độ continuous');
assert(app.includes('speakingRecognitionRestartTimer=setTimeout(startSpeakingRecognitionCycle,180)'),'Luyện nói chưa tự nối lại nhận diện');
assert(app.includes('if (speakingRecordingActive) return stopSpeakingRecording()'),'Nút Luyện nói chưa dừng thủ công');

const aiHelpers=loadAiHelpers();
const nestedReply=JSON.stringify({reply:'Sure! Would you like that hot or iced?',suggestions:['Iced coffee, please.']});
const normalized=aiHelpers.normalizeAiResponse({ok:true,reply:JSON.stringify(nestedReply)});
assert(aiHelpers.aiText(normalized.reply,'')==='Sure! Would you like that hot or iced?','Chat vẫn hiển thị nguyên object JSON');

console.log('Smoke test đạt: 6 mục tiêu, 288 chặng, 1.728 bài lộ trình, '+curriculum.stats.exercises+' bài tập, 10 dạng và Gemini proxy.');
