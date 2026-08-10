'use strict';

const fs=require('fs');
const vm=require('vm');
const app=fs.readFileSync('app.js','utf8');
assert(!app.includes('^AIza'), 'Frontend không được ép Gemini key phải bắt đầu bằng AIza');
const html=fs.readFileSync('index.html','utf8');
const backend=fs.readFileSync('google-apps-script.gs','utf8');

function assert(condition,message) { if (!condition) throw new Error(message); }
function extract(name,nextMarker) {
  const start=app.indexOf('const '+name+' = '); assert(start>=0,'Không tìm thấy '+name);
  const valueStart=start+('const '+name+' = ').length,end=app.indexOf(nextMarker,valueStart); assert(end>valueStart,'Không tìm thấy điểm kết thúc '+name);
  return vm.runInNewContext('('+app.slice(valueStart,end).trim().replace(/;$/,'')+')');
}

const roadmap=extract('roadmapData','\n  const practiceData');
const practice=extract('practiceData','\n\n  function saveState');
const levels=['A1','A2','B1','B2'];

levels.forEach(level=>{
  assert(roadmap[level]&&roadmap[level].length>=8,level+' cần ít nhất 8 roadmap node');
  assert(practice[level].listening.length>=5,level+' cần ít nhất 5 bài nghe');
  assert(practice[level].reading.length>=5,level+' cần ít nhất 5 bài đọc');
  assert(practice[level].speaking.length>=3,level+' cần ít nhất 3 câu nói');
  assert(practice[level].writing.length>=3,level+' cần ít nhất 3 đề viết');
  assert(practice[level].vocabulary.length>=6,level+' cần ít nhất 6 từ');
});

const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
assert(new Set(ids).size===ids.length,'HTML có ID bị trùng');
['nextListening','nextReading','nextSpeaking','nextWriting','practiceLevelSelect','listeningSummary','readingSummary','vocabularySummary','listeningTranscript'].forEach(id=>assert(ids.includes(id),'Thiếu #'+id));
assert(app.includes("bridgeCall('gemini'"),'Frontend chưa gọi Gemini qua Apps Script');
assert(backend.includes('UrlFetchApp.fetch'),'Apps Script chưa có Gemini proxy');
assert(backend.includes('CONFIG_PROPERTY_KEY'),'Apps Script chưa cache config trong Script Properties');
assert(backend.includes('callGeminiWithRefresh_'),'Apps Script chưa refresh key khi lỗi xác thực');
assert(!app.includes('x-goog-api-key'),'Frontend vẫn chứa logic gửi Gemini key');
assert(app.includes("renderFiniteSummary('vocabulary')"),'Flashcard chưa có điểm kết thúc');
assert(app.includes("return renderFiniteSummary(type)"),'Nghe/đọc chưa có điểm kết thúc');

console.log('Smoke test đạt: 4 level, 5 bài nghe/đọc mỗi level, session summary, flashcard stop và Gemini proxy.');
