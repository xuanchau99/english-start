/* global jQuery */
(function ($) {
  'use strict';

  const LEGACY_STORAGE_KEY = 'fluentgo_state_v1';
  const USER_STORAGE_PREFIX = 'fluentgo_state_v2_';
  const SESSION_TOKEN_KEY = 'fluentgo_session_token';
  const APPS_SCRIPT_URL = String(window.FLUENTGO_CONFIG?.appsScriptUrl || '').trim();
  const CURRICULUM = window.FLUENTGO_CURRICULUM || null;
  const SPEAKING_PASS_SCORE = 80;
  const SPEAKING_MIN_COVERAGE = 100;
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const localDayKey = (date) => { const value=date||new Date(); return [value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-'); };
  const defaults = {
    userId: '', username:'', name: 'Người học', email:'', level: 'A1', dailyGoal: 15,
    learningGoal:'general', roadmapUnit:0, practiceTopic:'all', vocabularyTopic:'all', challengeTopic:'all', challengeType:'all', voiceName:'', speechRate:0.9,
    xp: 1240, streak: 7, longestStreak: 12, minutesWeek: 78,
    lastActive: todayKey(), lastCompletedDay: '', completedToday: ['warmup'],
    completedLessons: ['A1-0','A1-1','A1-2','A1-3','A1-4'], lessonProgress: { daily: 35 },
    wordsLearned: 24, visitDates:[], visitDays:0, totalActiveSeconds:0, vocabularyReview:{}, exerciseMastery:{}, practiceOffsets:{}, examResults:{}, practiceStats:{listening:{done:0,correct:0},reading:{done:0,correct:0},speaking:{done:0},writing:{done:0}}, mistakes: [
      { type: 'Ngữ pháp', wrong: 'I am live in Hanoi.', right: 'I live in Hanoi.', note: 'Không dùng “am” trước động từ thường.' },
      { type: 'Từ vựng', wrong: 'Nice to see you.', right: 'Nice to meet you.', note: 'Dùng “meet” khi gặp lần đầu.' },
      { type: 'Phát âm', wrong: '/nɪs/', right: '/naɪs/', note: 'Âm /aɪ/ kéo nhẹ trong “nice”.' }
    ],
    week: [12, 18, 0, 16, 17, 15, 0], memoryIndex: 0
  };

  function readJsonStorage(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch (_) { return null; }
  }
  let state = $.extend(true,{},defaults);
  let authUser = null;
  let currentSessionToken = localStorage.getItem(SESSION_TOKEN_KEY) || '';
  let serverStatus = { gemini:false, sheets:false, mode:'bridge' };
  let bridgeFrame = null;
  let bridgeMessageWindow = null;
  let bridgeReady = false;
  let bridgeSequence = 0;
  const bridgeRequests = new Map();
  let currentLessonStep = 0;
  let selectedLessonAnswer = null;
  let activeRoadmapLesson = null;
  let recognition = null;
  let speakingRecognitionCtor = null;
  let speakingRecordingActive = false;
  let speakingRecognitionShouldRun = false;
  let speakingRecognitionRestartTimer = null;
  let speakingTranscriptBase = '';
  let transcript = '';
  let listeningSpeedMultiplier = 1;
  let speechPlaybackToken = 0;
  let mediaRecorder = null;
  let mediaStream = null;
  let audioChunks = [];
  let recordedAudio = null;
  let syncTimer = null;
  let syncInFlight = false;
  let syncPending = false;
  let lastSyncedFingerprint = '';
  let activityTimer = null;
  let activityLastTick = Date.now();
  let activityLastInteraction = Date.now();
  let activityCounting = false;
  let activityUnsavedSeconds = 0;
  let activitySyncSeconds = 0;
  let aiRequestInFlight = false;
  let lastAiRequestAt = 0;
  let selectedScenario = null;
  let aiVoiceEnabled = true;
  let chatRecognition = null;
  let chatRecognitionShouldRun = false;
  let chatRecognitionRestartTimer = null;
  let chatDictationBase = '';
  const practiceSession = {level:'',goal:'',topic:'all',listening:0,reading:0,speaking:0,writing:0,vocabulary:0,challenge:0,listeningQueue:null,readingQueue:null,vocabularyQueue:null,challengeQueue:null,aiChallengeDeck:null,vocabularyQuiz:null,listeningResults:[],readingResults:[],speakingResults:[],writingResults:[],vocabularyResults:[],challengeResults:[]};
  const examSession = {active:false,exam:null,index:0,scores:[],answers:[],startedAt:0,secondsLeft:0,timer:null,answered:false};
  let examRecognition=null,examRecognitionBase='',examRecognitionRestartTimer=null,examRecording=false,examRecorder=null,examStream=null,examChunks=[],examAudio=null,examTranscript='',examAudioReady=null;
  const conversation = { active:false,scenario:'',aiRole:'',userRole:'',first:'user',history:[],turns:0,messageSequence:0 };

  const roadmapData = {
    A1: [
      ['Chào hỏi đầu tiên', 'TỪ VỰNG · 5 PHÚT'], ['Tôi tên là...', 'NÓI · 7 PHÚT'], ['Bạn đến từ đâu?', 'NGHE · 8 PHÚT'],
      ['Số đếm 1–20', 'TỪ VỰNG · 6 PHÚT'], ['Gặp gỡ bạn mới', 'HỘI THOẠI · 10 PHÚT'], ['Giới thiệu bản thân', 'VIẾT · 8 PHÚT'],
      ['Gia đình của tôi', 'TỪ VỰNG · 8 PHÚT'], ['Một ngày thường lệ', 'ĐỌC · 10 PHÚT'], ['Kiểm tra chặng 1', 'THỬ THÁCH · 12 PHÚT']
    ],
    A2: [['Thói quen mỗi ngày','TỪ VỰNG · 7 PHÚT'],['Đi mua sắm','HỘI THOẠI · 10 PHÚT'],['Hỏi đường','NGHE · 9 PHÚT'],['Kỳ nghỉ gần nhất','NÓI · 10 PHÚT'],['Kế hoạch cuối tuần','VIẾT · 10 PHÚT'],['Ở khách sạn','HỘI THOẠI · 10 PHÚT'],['Sức khỏe thường ngày','ĐỌC · 11 PHÚT'],['Kiểm tra A2','THỬ THÁCH · 15 PHÚT']],
    B1: [['Kể một câu chuyện','NÓI · 12 PHÚT'],['Tin tức hôm nay','ĐỌC · 12 PHÚT'],['Nêu quan điểm','VIẾT · 15 PHÚT'],['Phỏng vấn công việc','HỘI THOẠI · 15 PHÚT'],['Podcast ngắn','NGHE · 14 PHÚT'],['Giải quyết vấn đề','NÓI · 13 PHÚT'],['Email chuyên nghiệp','VIẾT · 14 PHÚT'],['Kiểm tra B1','THỬ THÁCH · 18 PHÚT']],
    B2: [['Tranh luận thuyết phục','NÓI · 15 PHÚT'],['Thành ngữ tự nhiên','TỪ VỰNG · 12 PHÚT'],['Bài luận học thuật','VIẾT · 18 PHÚT'],['Thuyết trình ý tưởng','HỘI THOẠI · 18 PHÚT'],['Tin tức chuyên sâu','NGHE · 16 PHÚT'],['Đàm phán công việc','NÓI · 16 PHÚT'],['Phân tích quan điểm','ĐỌC · 17 PHÚT'],['Kiểm tra B2','THỬ THÁCH · 20 PHÚT']]
  };
  const practiceData = {
    A1:{
      listening:[
        {audio:'Hello! My name is Linh. I am from Vietnam, but I live in London now.',question:'Linh đến từ đâu?',options:['London','Vietnam','Một thị trấn nhỏ'],correct:1,explanation:'Linh nói “I am from Vietnam”.'},
        {audio:'I would like a small hot coffee with milk, please.',question:'Người nói gọi món gì?',options:['Một cà phê nóng nhỏ có sữa','Một trà đá lớn','Một cà phê đen lớn'],correct:0,explanation:'Cụm chính là “a small hot coffee with milk”.'},
        {audio:'The class starts at nine o’clock on Monday morning.',question:'Lớp học bắt đầu khi nào?',options:['8 giờ thứ Hai','9 giờ thứ Hai','9 giờ thứ Ba'],correct:1,explanation:'Bạn nghe được “nine o’clock on Monday”.'},
        {audio:'My brother is tall and he has short black hair. He wears glasses.',question:'Người anh có đặc điểm gì?',options:['Tóc dài màu nâu','Tóc đen ngắn và đeo kính','Thấp và không đeo kính'],correct:1,explanation:'Các từ khóa là “short black hair” và “wears glasses”.'},
        {audio:'Please open your book to page twelve and read the first sentence.',question:'Người nghe cần mở trang nào?',options:['Trang 10','Trang 12','Trang 20'],correct:1,explanation:'Bạn nghe được “page twelve”.'}
      ],
      reading:[
        {title:'Một buổi sáng của Mia',passage:'Every morning, Mia wakes up at seven o’clock. She drinks water and makes breakfast. She likes mornings because the streets are quiet and the air is fresh.',question:'Why does Mia like mornings?',options:['She can sleep late.','The streets are quiet and the air is fresh.','She meets Leo.'],correct:1},
        {title:'Gia đình của Ben',passage:'Ben lives with his parents and his little sister. His mother is a nurse and his father is a cook. On Sundays, they eat lunch together.',question:'What does Ben’s father do?',options:['He is a nurse.','He is a teacher.','He is a cook.'],correct:2},
        {title:'Sở thích của Anna',passage:'Anna loves music. She plays the guitar after school and listens to pop songs before bed. She practices every day.',question:'When does Anna play the guitar?',options:['After school.','Before breakfast.','On Sunday only.'],correct:0},
        {title:'Tin nhắn của Tom',passage:'Hi Amy, I am at the library. I will meet you at the café at four o’clock. Please bring my blue notebook.',question:'What should Amy bring?',options:['A blue notebook.','A library book.','A cup of coffee.'],correct:0},
        {title:'Cửa hàng mới',passage:'The new shop opens at ten in the morning and closes at eight in the evening. It sells fruit, bread and drinks.',question:'What time does the shop close?',options:['At six.','At eight.','At ten.'],correct:1}
      ],
      speaking:[{target:'Hi, my name is An. Nice to meet you!',vi:'Xin chào, mình tên An. Rất vui được gặp bạn!'},{target:'I live in Hanoi with my family.',vi:'Tôi sống ở Hà Nội cùng gia đình.'},{target:'I like reading books in my free time.',vi:'Tôi thích đọc sách lúc rảnh.'}],
      writing:[{title:'Giới thiệu bản thân',instruction:'Viết 3–5 câu về tên, nơi ở và sở thích.',chips:['My name is...','I live in...','I like...'],minWords:8},{title:'Một ngày của bạn',instruction:'Viết 3–5 câu về những việc bạn làm mỗi ngày.',chips:['Every morning...','I usually...','In the evening...'],minWords:10},{title:'Gia đình tôi',instruction:'Giới thiệu ngắn về hai người trong gia đình.',chips:['There are...','My mother...','We like...'],minWords:10}],
      vocabulary:[{word:'greet',phonetic:'/ɡriːt/ · verb',icon:'👋',meaning:'chào hỏi',example:'She greeted me with a smile.',vi:'Cô ấy mỉm cười chào tôi.'},{word:'introduce',phonetic:'/ˌɪn.trəˈdjuːs/ · verb',icon:'🤝',meaning:'giới thiệu',example:'Let me introduce my friend.',vi:'Để tôi giới thiệu bạn của mình.'},{word:'hometown',phonetic:'/ˈhəʊm.taʊn/ · noun',icon:'🏡',meaning:'quê nhà',example:'My hometown is peaceful.',vi:'Quê tôi rất yên bình.'},{word:'hobby',phonetic:'/ˈhɒb.i/ · noun',icon:'🎨',meaning:'sở thích',example:'Painting is my hobby.',vi:'Vẽ là sở thích của tôi.'},{word:'friendly',phonetic:'/ˈfrend.li/ · adj',icon:'😊',meaning:'thân thiện',example:'Our teacher is friendly.',vi:'Giáo viên của chúng tôi thân thiện.'},{word:'practice',phonetic:'/ˈpræk.tɪs/ · verb',icon:'🎯',meaning:'luyện tập',example:'I practice every day.',vi:'Tôi luyện tập mỗi ngày.'}]
    },
    A2:{
      listening:[{audio:'Go straight for two blocks, then turn left at the bank. The museum is opposite the park.',question:'Bảo tàng nằm ở đâu?',options:['Bên cạnh ngân hàng','Đối diện công viên','Sau nhà ga'],correct:1,explanation:'Câu cuối nói “opposite the park”.'},{audio:'We planned to go hiking, but the weather forecast says it will rain, so we may visit the art gallery instead.',question:'Vì sao họ có thể đổi kế hoạch?',options:['Vì trời có thể mưa','Vì bảo tàng đóng cửa','Vì họ phải làm việc'],correct:0,explanation:'Dự báo có mưa nên họ cân nhắc đi phòng tranh.'},{audio:'Your room is on the third floor. Breakfast is served from seven to ten near the lobby.',question:'Bữa sáng kết thúc lúc mấy giờ?',options:['7 giờ','9 giờ','10 giờ'],correct:2,explanation:'“from seven to ten” nghĩa là từ 7 đến 10 giờ.'},{audio:'I ordered the blue jacket online, but the shop sent me a black one in the wrong size.',question:'Vấn đề với đơn hàng là gì?',options:['Giao trễ','Sai màu và sai kích thước','Áo bị rách'],correct:1,explanation:'Người nói đặt màu xanh nhưng nhận màu đen và sai size.'},{audio:'The doctor suggested drinking more water and going to bed a little earlier.',question:'Bác sĩ đưa ra lời khuyên gì?',options:['Tập nặng hơn','Uống nhiều nước và ngủ sớm hơn','Bỏ bữa sáng'],correct:1,explanation:'Hai lời khuyên là uống nước và đi ngủ sớm.'}],
      reading:[{title:'Kế hoạch cuối tuần',passage:'Nora wanted to stay home, but her friends invited her to a food festival. She decided to go because she enjoys trying dishes from different countries.',question:'Why did Nora decide to go?',options:['She likes international food.','She dislikes staying home.','She works at the festival.'],correct:0},{title:'Một chuyến tàu trễ',passage:'The 8:15 train was delayed by twenty minutes. Leo used the extra time to buy a sandwich and call his sister.',question:'What did Leo do while waiting?',options:['He took a taxi.','He bought food and made a call.','He went home.'],correct:1},{title:'Thói quen khỏe mạnh',passage:'Mai walks to work three times a week and prepares lunch at home. She says these small habits help her feel more energetic.',question:'How often does Mai walk to work?',options:['Every day.','Three times a week.','Only on weekends.'],correct:1},{title:'Email đổi lịch',passage:'Hi Sam, I cannot meet on Tuesday because I have a dentist appointment. Are you free on Wednesday afternoon instead?',question:'Why can’t the writer meet on Tuesday?',options:['A work meeting.','A dentist appointment.','A train journey.'],correct:1},{title:'Thông báo thư viện',passage:'The library will close early at 5 p.m. this Friday for staff training. Books can still be returned through the box outside.',question:'What can visitors still do after closing?',options:['Borrow a laptop.','Attend training.','Return books outside.'],correct:2}],
      speaking:[{target:'Could you tell me how to get to the station?',vi:'Bạn có thể chỉ tôi đường đến nhà ga không?'},{target:'I have booked a room for two nights.',vi:'Tôi đã đặt phòng trong hai đêm.'},{target:'I usually exercise before I go to work.',vi:'Tôi thường tập thể dục trước khi đi làm.'}],
      writing:[{title:'Kế hoạch cuối tuần',instruction:'Viết 4–6 câu về kế hoạch cuối tuần và lý do.',chips:['This weekend...','I am going to...','because...'],minWords:18},{title:'Một chuyến đi',instruction:'Kể lại ngắn một chuyến đi gần đây.',chips:['Last month...','I visited...','The best part was...'],minWords:20},{title:'Email mời bạn',instruction:'Viết email ngắn mời một người bạn đi chơi.',chips:['Would you like to...','We can...','Let me know...'],minWords:18}],
      vocabulary:[{word:'direction',phonetic:'/dəˈrek.ʃən/ · noun',icon:'🧭',meaning:'phương hướng',example:'Can you give me directions?',vi:'Bạn có thể chỉ đường cho tôi không?'},{word:'reservation',phonetic:'/ˌrez.əˈveɪ.ʃən/ · noun',icon:'🏨',meaning:'đặt chỗ',example:'I have a reservation.',vi:'Tôi có đặt chỗ.'},{word:'forecast',phonetic:'/ˈfɔː.kɑːst/ · noun',icon:'🌦️',meaning:'dự báo',example:'Check the weather forecast.',vi:'Hãy xem dự báo thời tiết.'},{word:'instead',phonetic:'/ɪnˈsted/ · adv',icon:'↪️',meaning:'thay vào đó',example:'Let’s walk instead.',vi:'Thay vào đó hãy đi bộ.'},{word:'available',phonetic:'/əˈveɪ.lə.bəl/ · adj',icon:'✅',meaning:'có sẵn',example:'Is this room available?',vi:'Phòng này còn trống không?'},{word:'energetic',phonetic:'/ˌen.əˈdʒet.ɪk/ · adj',icon:'⚡',meaning:'tràn đầy năng lượng',example:'I feel energetic today.',vi:'Hôm nay tôi thấy tràn đầy năng lượng.'}]
    },
    B1:{
      listening:[{audio:'The client moved the deadline to Friday, so we need to finish the first draft by Wednesday afternoon.',question:'Khi nào cần hoàn thành bản nháp đầu tiên?',options:['Thứ Tư chiều','Thứ Sáu sáng','Thứ Hai'],correct:0,explanation:'Deadline khách hàng là thứ Sáu, nhưng bản nháp phải xong chiều thứ Tư.'},{audio:'Although the flight was delayed, the airline arranged a hotel and a morning shuttle for all passengers.',question:'Hãng bay đã hỗ trợ điều gì?',options:['Hoàn tiền toàn bộ','Khách sạn và xe buýt sáng','Một chuyến tàu'],correct:1,explanation:'Họ sắp xếp khách sạn và morning shuttle.'},{audio:'The speaker argues that reusable packaging can reduce waste, but only if customers return it consistently.',question:'Điều kiện để bao bì tái sử dụng hiệu quả là gì?',options:['Giá phải rẻ','Khách hàng trả lại đều đặn','Cửa hàng mở lâu hơn'],correct:1,explanation:'Ý chính nằm sau “only if”.'},{audio:'I appreciated the offer, but I turned it down because the role required frequent travel and I wanted more stability.',question:'Vì sao người nói từ chối lời mời?',options:['Lương thấp','Phải đi công tác thường xuyên','Không thích đồng nghiệp'],correct:1,explanation:'Lý do là frequent travel và mong muốn ổn định hơn.'},{audio:'The event was supposed to be outdoors; however, the organizers moved it inside due to strong winds.',question:'Tại sao sự kiện chuyển vào trong?',options:['Gió mạnh','Thiếu khách','Trời quá nóng'],correct:0,explanation:'Cụm “due to strong winds” nêu nguyên nhân.'}],
      reading:[{title:'Làm việc linh hoạt',passage:'A small technology company tested a flexible schedule for three months. Productivity remained stable, while employees reported lower stress and fewer commuting problems.',question:'What was one reported benefit?',options:['Higher office costs.','Lower employee stress.','Longer commutes.'],correct:1},{title:'Du lịch có trách nhiệm',passage:'Visitors can support local communities by choosing locally owned hotels, respecting cultural rules, and reducing plastic waste during their trips.',question:'Which action supports local communities?',options:['Choosing local businesses.','Using more plastic.','Ignoring local customs.'],correct:0},{title:'Học qua lỗi sai',passage:'Researchers note that correcting every error immediately may interrupt communication. Focused feedback after a task can help learners notice patterns without losing confidence.',question:'Why can delayed feedback be useful?',options:['It removes all mistakes.','It protects communication flow and helps notice patterns.','It makes tasks shorter.'],correct:1},{title:'Đánh giá nhà hàng',passage:'The service was slower than expected, yet the staff remained polite and offered a free dessert. Overall, the reviewer would return for the creative menu.',question:'Why would the reviewer return?',options:['The restaurant was empty.','The menu was creative.','The service was fast.'],correct:1},{title:'Thay đổi nghề nghiệp',passage:'After ten years in finance, Daniel completed a design course. He accepted a junior role because it offered mentorship and room to develop new skills.',question:'Why did Daniel accept a junior role?',options:['It paid the most.','It required no training.','It offered guidance and growth.'],correct:2}],
      speaking:[{target:'In my opinion, flexible working can improve productivity.',vi:'Theo tôi, làm việc linh hoạt có thể cải thiện năng suất.'},{target:'The main challenge was communicating with the whole team.',vi:'Thách thức chính là giao tiếp với toàn bộ nhóm.'},{target:'If I had more time, I would learn another language.',vi:'Nếu có thêm thời gian, tôi sẽ học một ngôn ngữ khác.'}],
      writing:[{title:'Nêu quan điểm',instruction:'Viết 80–120 từ: làm việc từ xa có lợi hay có hại?',chips:['In my opinion...','On the other hand...','Overall...'],minWords:45},{title:'Email công việc',instruction:'Viết email báo tiến độ và đề nghị gia hạn ngắn.',chips:['I am writing to...','We have completed...','Could we...'],minWords:40},{title:'Kể một trải nghiệm',instruction:'Kể về một vấn đề bạn từng giải quyết thành công.',chips:['At first...','I decided to...','As a result...'],minWords:45}],
      vocabulary:[{word:'deadline',phonetic:'/ˈded.laɪn/ · noun',icon:'⏰',meaning:'hạn chót',example:'The deadline is Friday.',vi:'Hạn chót là thứ Sáu.'},{word:'productivity',phonetic:'/ˌprɒd.ʌkˈtɪv.ə.ti/ · noun',icon:'📈',meaning:'năng suất',example:'Productivity improved.',vi:'Năng suất đã cải thiện.'},{word:'sustainable',phonetic:'/səˈsteɪ.nə.bəl/ · adj',icon:'🌱',meaning:'bền vững',example:'We need sustainable travel.',vi:'Chúng ta cần du lịch bền vững.'},{word:'consistently',phonetic:'/kənˈsɪs.tənt.li/ · adv',icon:'🔁',meaning:'một cách đều đặn',example:'Practice consistently.',vi:'Hãy luyện tập đều đặn.'},{word:'perspective',phonetic:'/pəˈspek.tɪv/ · noun',icon:'👁️',meaning:'góc nhìn',example:'I understand your perspective.',vi:'Tôi hiểu góc nhìn của bạn.'},{word:'resolve',phonetic:'/rɪˈzɒlv/ · verb',icon:'🧩',meaning:'giải quyết',example:'We resolved the issue.',vi:'Chúng tôi đã giải quyết vấn đề.'}]
    },
    B2:{
      listening:[{audio:'The proposal offers greater autonomy, yet critics argue that it lacks clear accountability measures and could create inconsistent outcomes.',question:'Mối lo chính của những người phản đối là gì?',options:['Thiếu cơ chế trách nhiệm rõ ràng','Chi phí đào tạo thấp','Quá nhiều dữ liệu'],correct:0,explanation:'Họ lo thiếu accountability measures và kết quả thiếu nhất quán.'},{audio:'While the initial figures appear promising, the researcher cautions against drawing conclusions before the full longitudinal study is complete.',question:'Người nghiên cứu khuyên điều gì?',options:['Công bố ngay','Chờ nghiên cứu dài hạn hoàn tất','Hủy nghiên cứu'],correct:1,explanation:'Không nên kết luận trước khi nghiên cứu dài hạn hoàn tất.'},{audio:'We can accept the revised timeline provided that the supplier guarantees weekly updates and absorbs any additional shipping costs.',question:'Điều kiện chấp nhận timeline mới là gì?',options:['Giảm chất lượng','Cập nhật hằng tuần và chịu chi phí phát sinh','Thay toàn bộ nhà cung cấp'],correct:1,explanation:'Hai điều kiện được nêu sau “provided that”.'},{audio:'The policy may appear equitable in principle, but its impact depends largely on whether underfunded regions receive adequate implementation support.',question:'Điều gì quyết định tác động của chính sách?',options:['Tên chính sách','Hỗ trợ triển khai cho vùng thiếu nguồn lực','Số lượng quảng cáo'],correct:1,explanation:'Tác động phụ thuộc vào implementation support cho các vùng thiếu nguồn lực.'},{audio:'Rather than rejecting the findings outright, the panel requested a clearer account of the sampling method and potential sources of bias.',question:'Hội đồng yêu cầu điều gì?',options:['Hủy kết quả','Mô tả rõ phương pháp lấy mẫu và thiên lệch','Tăng ngân sách'],correct:1,explanation:'Họ muốn làm rõ sampling method và sources of bias.'}],
      reading:[{title:'Trí tuệ nhân tạo và công việc',passage:'Automation rarely replaces an entire occupation at once. More often, it changes a collection of tasks, increasing demand for judgment, communication, and the ability to work with new tools.',question:'What does the passage suggest automation usually changes?',options:['Whole industries immediately.','Collections of tasks within jobs.','Only communication skills.'],correct:1},{title:'Thiết kế đô thị',passage:'Compact neighborhoods can reduce car dependency, but density alone is insufficient. Residents also need reliable public transport, accessible services, and safe public spaces.',question:'What is needed in addition to density?',options:['More private cars.','Transport, services, and safe spaces.','Fewer local services.'],correct:1},{title:'Đánh giá bằng chứng',passage:'A persuasive claim is not necessarily a reliable one. Readers should examine the source, methodology, sample size, and whether alternative explanations were considered.',question:'Which factor helps assess reliability?',options:['The confidence of the writer.','The number of adjectives.','The methodology and evidence.'],correct:2},{title:'Giới hạn của chỉ số',passage:'A single performance metric can simplify comparison, but it may also encourage organizations to optimize what is measured while neglecting less visible forms of quality.',question:'What risk does a single metric create?',options:['It makes comparison impossible.','It may cause unmeasured quality to be ignored.','It always increases costs.'],correct:1},{title:'Đổi mới có trách nhiệm',passage:'Regulation and innovation are often presented as opposites. In practice, predictable standards can reduce uncertainty and encourage investment, provided they remain responsive to new evidence.',question:'When can standards encourage investment?',options:['When they are predictable and adaptable.','When they never change.','When evidence is ignored.'],correct:0}],
      speaking:[{target:'The evidence is compelling; nevertheless, we should consider alternative explanations.',vi:'Bằng chứng thuyết phục; tuy nhiên, ta nên xem xét các cách giải thích khác.'},{target:'I would argue that the long-term benefits outweigh the initial costs.',vi:'Tôi cho rằng lợi ích dài hạn lớn hơn chi phí ban đầu.'},{target:'Could we reach a compromise that addresses both concerns?',vi:'Chúng ta có thể đạt thỏa hiệp giải quyết cả hai mối lo không?'}],
      writing:[{title:'Bài luận lập luận',instruction:'Viết 120–180 từ về tác động của AI đối với giáo dục.',chips:['It is often argued that...','A key limitation is...','To conclude...'],minWords:70},{title:'Đề xuất chuyên nghiệp',instruction:'Viết một đề xuất cải thiện cách làm việc của nhóm.',chips:['This proposal aims to...','The primary benefit...','I recommend that...'],minWords:65},{title:'Phản biện quan điểm',instruction:'Trình bày một quan điểm, phản biện và kết luận cân bằng.',chips:['While it is true that...','However...','A balanced approach...'],minWords:70}],
      vocabulary:[{word:'accountability',phonetic:'/əˌkaʊn.təˈbɪl.ə.ti/ · noun',icon:'⚖️',meaning:'trách nhiệm giải trình',example:'The plan needs accountability.',vi:'Kế hoạch cần trách nhiệm giải trình.'},{word:'compelling',phonetic:'/kəmˈpel.ɪŋ/ · adj',icon:'🧲',meaning:'thuyết phục',example:'The evidence is compelling.',vi:'Bằng chứng rất thuyết phục.'},{word:'longitudinal',phonetic:'/ˌlɒn.dʒɪˈtʃuː.dɪ.nəl/ · adj',icon:'📊',meaning:'theo chiều dọc/dài hạn',example:'It is a longitudinal study.',vi:'Đó là nghiên cứu dài hạn.'},{word:'infer',phonetic:'/ɪnˈfɜːr/ · verb',icon:'🔎',meaning:'suy luận',example:'We can infer the cause.',vi:'Ta có thể suy luận nguyên nhân.'},{word:'nuanced',phonetic:'/ˈnjuː.ɑːnst/ · adj',icon:'🎛️',meaning:'có sắc thái tinh tế',example:'She gave a nuanced answer.',vi:'Cô ấy đưa ra câu trả lời nhiều sắc thái.'},{word:'trade-off',phonetic:'/ˈtreɪd.ɒf/ · noun',icon:'↔️',meaning:'sự đánh đổi',example:'There is a clear trade-off.',vi:'Có một sự đánh đổi rõ ràng.'}]
    }
  };

  function currentGoalId() { return CURRICULUM?.goals?.[state.learningGoal] ? state.learningGoal : 'general'; }
  function currentGoal() { return CURRICULUM?.goals?.[currentGoalId()] || {name:'Giao tiếp cơ bản',description:'Học tiếng Anh theo tình huống'}; }
  function goalOptions(selected) {
    if (!CURRICULUM) return '<option value="general">Giao tiếp cơ bản</option>';
    return Object.entries(CURRICULUM.goals).map(([id,goal])=>`<option value="${id}" ${id===selected?'selected':''}>${goal.icon} ${escapeHtml(goal.name)}</option>`).join('');
  }
  function curriculumDeck(type,topic) {
    if (!CURRICULUM) return practiceData[state.level]?.[type]||[];
    const requestedTopic=topic==null?(type==='vocabulary'?state.vocabularyTopic:state.practiceTopic):topic;
    if (type==='vocabulary'&&requestedTopic&&requestedTopic!=='all') {
      const priority=CURRICULUM.getVocabulary(currentGoalId(),state.level,requestedTopic),all=CURRICULUM.getVocabulary(currentGoalId(),state.level,'all'),seen=new Set(priority.map(card=>card.id));
      return priority.concat(all.filter(card=>!seen.has(card.id)));
    }
    return CURRICULUM.toPracticeDeck(currentGoalId(),state.level,type,requestedTopic||'all');
  }
  function populateTopicSelect(selector,selected,includeAll) {
    if (!CURRICULUM) return;
    const all=includeAll===false?'':`<option value="all">Tất cả 12 chủ đề</option>`;
    $(selector).html(all+CURRICULUM.getTopics(currentGoalId()).map(topic=>`<option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>`).join('')).val(selected||'all');
  }
  function resetGoalDrivenSessions() {
    practiceSession.level=''; practiceSession.goal=''; practiceSession.topic='all'; state.memoryIndex=0;
  }

  function saveState(sync) {
    if (!state.userId || !authUser) return;
    state.lastActive = todayKey();
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(USER_STORAGE_PREFIX + state.userId, JSON.stringify(state));
    renderState();
    if (sync && serverStatus.sheets) scheduleProgressSync();
  }

  function formatActiveTime(seconds) {
    const total=Math.max(0,Math.floor(Number(seconds)||0)),hours=Math.floor(total/3600),minutes=Math.floor((total%3600)/60);
    return hours+' giờ '+minutes+' phút';
  }

  function renderActivityStats() {
    const dates=Array.isArray(state.visitDates)?state.visitDates:[];
    state.visitDays=new Set(dates).size;
    $('#profileVisitDays').text(formatNumber(state.visitDays)).attr('data-visit-days',state.visitDays);
    $('#profileTotalTime').text(formatActiveTime(state.totalActiveSeconds)).attr('data-total-seconds',Math.floor(Number(state.totalActiveSeconds)||0));
    $('#profileLastVisit').text(dates.length?dates.slice().sort().pop().split('-').reverse().join('/'):'Chưa ghi nhận');
  }

  function persistActivity(sync) {
    if (!authUser||!state.userId) return;
    state.updatedAt=new Date().toISOString();
    localStorage.setItem(USER_STORAGE_PREFIX+state.userId,JSON.stringify(state));
    renderActivityStats();
    if (sync&&serverStatus.sheets) scheduleProgressSync(1200);
  }

  function activityIsEligible() {
    return !!authUser&&document.visibilityState==='visible'&&(Date.now()-activityLastInteraction)<300000;
  }

  function tickActiveTime(forceSave) {
    const now=Date.now(),elapsed=Math.max(0,(now-activityLastTick)/1000); activityLastTick=now;
    if (activityCounting&&authUser&&state.userId) {
      const counted=Math.min(elapsed,30); state.totalActiveSeconds=Math.max(0,Number(state.totalActiveSeconds)||0)+counted; activityUnsavedSeconds+=counted; activitySyncSeconds+=counted;
    }
    activityCounting=activityIsEligible();
    renderActivityStats();
    if (forceSave||activityUnsavedSeconds>=60) { const shouldSync=activitySyncSeconds>=60; persistActivity(shouldSync); activityUnsavedSeconds=0; if (shouldSync) activitySyncSeconds=0; }
  }

  function markUserActive() {
    const wasCounting=activityCounting; activityLastInteraction=Date.now(); activityCounting=activityIsEligible(); if (!wasCounting&&activityCounting) activityLastTick=Date.now();
  }

  function startActivityTracking() {
    clearInterval(activityTimer); activityLastTick=Date.now(); activityLastInteraction=Date.now(); activityCounting=true; activityUnsavedSeconds=0; activitySyncSeconds=0;
    const today=localDayKey(); state.visitDates=Array.isArray(state.visitDates)?[...new Set(state.visitDates.filter(Boolean))]:[];
    if (!state.visitDates.includes(today)) state.visitDates.push(today);
    state.visitDates=state.visitDates.slice(-730); state.visitDays=state.visitDates.length; persistActivity(false);
    activityTimer=setInterval(()=>tickActiveTime(false),10000);
  }

  function stopActivityTracking() {
    if (activityTimer||activityCounting) tickActiveTime(true);
    clearInterval(activityTimer); activityTimer=null; activityCounting=false;
  }

  function bindActivityTracking() {
    ['pointerdown','keydown','touchstart','scroll'].forEach(type=>document.addEventListener(type,markUserActive,{passive:true}));
    document.addEventListener('visibilitychange',()=>{ tickActiveTime(true); if (document.visibilityState==='visible') markUserActive(); });
    window.addEventListener('beforeunload',()=>tickActiveTime(true));
  }

  function firstName() { return (state.name || 'Bạn').trim().split(/\s+/).pop(); }
  function formatNumber(n) { return Number(n).toLocaleString('vi-VN'); }
  function renderState() {
    const shortName = firstName();
    $('#heroName,#sideUserName').text(shortName);
    $('#profileName').text(state.name);
    $('#profileUsername').text(state.username ? '@'+state.username : '@user');
    $('#profileEmail').text(state.email || 'Tài khoản FluentGo');
    $('#profileLevel').text(state.level + ' ' + ({A1:'Beginner',A2:'Elementary',B1:'Intermediate',B2:'Upper intermediate'}[state.level] || 'Learner'));
    $('.current-chat-level').text(state.level);
    $('#practiceLevelLabel').text(state.level); $('#practiceLevelSelect').val(state.level);
    $('#profileDailyGoal').text(state.dailyGoal+' phút'); $('#profileLearningGoal').text(currentGoal().name); $('#profileRoadmapPosition').text('Chặng '+(Number(state.roadmapUnit||0)+1)+' / 12');
    renderActivityStats();
    const currentUnit=CURRICULUM?.getRoadmap(currentGoalId(),state.level)?.[Math.min(11,Math.max(0,Number(state.roadmapUnit)||0))];
    $('#heroGoalCopy').text('Dành '+state.dailyGoal+' phút cho mục tiêu '+currentGoal().name.toLowerCase()+'. Mochi đã chọn chặng phù hợp cho bạn.');
    if (currentUnit) { $('#dailyLessonTitle').text(currentUnit.title); $('#dailyLessonCopy').text(currentUnit.description); }
    $('#roadmapGoalSelect,#practiceGoalSelect,#vocabularyGoalSelect,#settingLearningGoal').html(goalOptions(currentGoalId())).val(currentGoalId());
    $('.mini-avatar,.mobile-avatar,.profile-avatar').contents().filter(function(){ return this.nodeType === 3; }).first().replaceWith(initials(state.name));
    $('#headerXp').text(formatNumber(state.xp));
    $('#headerStreak,#streakDays').text(state.streak);
    $('#weekMinutes,#sideWeekMinutes').text(state.minutesWeek);
    $('#doneTodayCount').text(state.completedToday.length);
    $('.sidebar-plan .plan-ring').css('--progress', Math.min(100, Math.round(state.minutesWeek / 120 * 100))).find('span').text(Math.min(100, Math.round(state.minutesWeek / 120 * 100)) + '%');
    if (state.completedToday.length >= 3) $('#reminderBanner').hide();
    renderWeek(); renderStreak(); renderMistakes(); renderGoalScenarios();
  }
  function renderGoalScenarios() {
    if (!CURRICULUM || !$('#scenarioGroups').length) return;
    $('#scenarioGroups .goal-scenario-group').remove();
    const goal=currentGoal(),topics=CURRICULUM.getTopics(currentGoalId()).slice(0,6);
    const buttons=topics.map(topic=>`<button data-scenario="${escapeHtml(topic)}" data-ai-role="người hướng dẫn tình huống ${escapeHtml(topic.toLowerCase())}" data-user-role="người học theo mục tiêu ${escapeHtml(goal.name.toLowerCase())}">${goal.icon} ${escapeHtml(topic)}</button>`).join('');
    $('#scenarioGroups').prepend(`<div class="scenario-group goal-scenario-group"><h3><i class="study-dot"></i>Đề xuất cho ${escapeHtml(goal.name)}</h3><div>${buttons}</div></div>`);
  }
  function initials(name) { return (name || 'AN').split(/\s+/).slice(-2).map(v => v[0]).join('').toUpperCase(); }

  function renderWeek() {
    const days = ['T2','T3','T4','T5','T6','T7','CN'];
    const today = (new Date().getDay() + 6) % 7;
    $('#weekChart').html(state.week.map((v,i) => `<div class="chart-col ${v ? 'active' : ''} ${i === today ? 'today' : ''}" style="--h:${Math.max(v*3,5)}px"><em>${v || ''}</em><div class="bar" style="height:${Math.max(v*3,5)}px"></div><span>${days[i]}</span></div>`).join(''));
  }
  function renderStreak() {
    const days = ['T2','T3','T4','T5','T6','T7','CN'];
    const today = (new Date().getDay() + 6) % 7;
    $('#streakCalendar').html(days.map((day,i) => `<div class="streak-day ${i <= today ? 'done' : ''} ${i === today ? 'today' : ''}"><span>${day}</span><i>${i <= today ? '🔥' : '·'}</i></div>`).join(''));
  }

  const ROADMAP_MAP_POINTS = [
    {x:24,y:12},{x:54,y:25},{x:74,y:41},{x:47,y:57},{x:25,y:73},{x:55,y:88}
  ];
  const ROADMAP_MAP_THEMES = {
    general:{name:'Phố Kết Nối',className:'town',landmarks:[['🏡','Khu phố'],['☕','Quán trò chuyện'],['🌳','Công viên']]},
    developer:{name:'Thành phố Công Nghệ',className:'tech',landmarks:[['💻','Dev station'],['🛰️','API hub'],['🚀','Deploy port']]},
    workplace:{name:'Khu Công Sở',className:'office',landmarks:[['🏢','Văn phòng'],['📊','Phòng họp'],['🤝','Team hub']]},
    travel:{name:'Hành trình Thế giới',className:'travel',landmarks:[['🗼','Điểm đến'],['🏝️','Trạm khám phá'],['✈️','Sân bay']]},
    study:{name:'Học viện Tri thức',className:'academy',landmarks:[['🏫','Giảng đường'],['📚','Thư viện'],['🎓','Đích tốt nghiệp']]},
    service:{name:'Phố Dịch vụ',className:'market',landmarks:[['🏪','Cửa hàng'],['🛎️','Quầy hỗ trợ'],['⭐','Khách hài lòng']]}
  };

  function roadmapLessonIcon(type) {
    return {GUIDEBOOK:'📖',DIALOGUE:'🎧',STORY:'📚',PRACTICE:'🧩',PRODUCTION:'🎙️',CHECKPOINT:'🏆'}[String(type||'').toUpperCase()]||'⭐';
  }

  function roadmapWorldHtml(items,completed,firstPending,level,unitIndex,progress,lockFuture) {
    const theme=ROADMAP_MAP_THEMES[currentGoalId()]||ROADMAP_MAP_THEMES.general;
    const points=items.map((_,index)=>ROADMAP_MAP_POINTS[index]||{x:index%2?68:32,y:12+index*14});
    const routePath='M 24 12 C 33 16 44 18 54 25 S 79 33 74 41 S 58 51 47 57 S 24 64 25 73 S 43 82 55 88';
    const landmarks=theme.landmarks.map((landmark,index)=>`<div class="map-landmark landmark-${index+1}" aria-hidden="true"><span>${landmark[0]}</span><small>${escapeHtml(landmark[1])}</small></div>`).join('');
    let currentPoint=points[Math.max(0,firstPending)]||points[0]||{x:24,y:12};
    const guideX=currentPoint.x<50?Math.max(9,currentPoint.x-12):Math.min(91,currentPoint.x+12);
    const nodes=items.map((item,index)=>{
      const id=item.id||level+'-'+index,isDone=completed.has(id),status=isDone?'done':index===firstPending?'current':lockFuture?'locked':'available';
      const point=points[index],side=point.x>=52?'card-left':'card-right',icon=isDone?'✓':status==='current'?'▶':status==='locked'?'🔒':roadmapLessonIcon(item.type||item[1]);
      const title=item.title||item[0],type=item.type||item[1],minutes=item.minutes||'';
      const statusText=isDone?'ĐÃ XONG':status==='current'?'ĐANG HỌC':status==='locked'?'CHƯA MỞ':'CÓ THỂ HỌC';
      return `<button type="button" class="road-node map-node ${side} ${status}" style="--x:${point.x}%;--y:${point.y}%;--delay:${index*.07}s" data-index="${index}" data-level="${level}" data-unit="${unitIndex}" ${status==='locked'?'disabled aria-disabled="true"':''} aria-label="${escapeHtml(statusText+': '+title)}"><span class="node-circle"><i>${icon}</i></span><span class="node-info"><em>${statusText}</em><small>${escapeHtml(type)}${minutes?' · '+minutes+' PHÚT':''}</small><strong>${escapeHtml(title)}</strong></span></button>`;
    }).join('');
    $('.roadmap-card').attr('data-map-theme',theme.className);
    return `<div class="roadmap-scene" aria-label="Bản đồ ${escapeHtml(theme.name)}">
      <div class="map-horizon" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="map-cloud cloud-one" aria-hidden="true">☁</div><div class="map-cloud cloud-two" aria-hidden="true">☁</div>
      <div class="map-world-title"><span>KHÁM PHÁ</span><strong>${escapeHtml(theme.name)}</strong></div>
      ${landmarks}
      <svg class="roadmap-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path class="route-shadow" d="${routePath}" pathLength="100"></path>
        <path class="route-base" d="${routePath}" pathLength="100"></path>
        <path class="route-progress" d="${routePath}" pathLength="100" style="stroke-dasharray:${progress} 100"></path>
      </svg>
      <div class="map-gate map-start" aria-hidden="true"><span>🚩</span><small>BẮT ĐẦU</small></div>
      <div class="map-gate map-finish" aria-hidden="true"><span>🏰</span><small>CHINH PHỤC</small></div>
      ${nodes}
      <div class="map-guide" style="--guide-x:${guideX}%;--guide-y:${Math.max(7,currentPoint.y-1)}%" aria-hidden="true"><img src="assets/mochi.png" alt=""><span>Bạn đang ở đây!</span></div>
      <div class="map-legend"><span><i class="legend-done"></i>Đã xong</span><span><i class="legend-current"></i>Đang học</span><span><i class="legend-open"></i>Có thể học</span></div>
    </div>`;
  }

  function renderRoadmap(level) {
    level=level||state.level;
    if (!CURRICULUM) {
      const items=roadmapData[level]||roadmapData.A1,completed=new Set(state.completedLessons||[]),pendingIndex=items.findIndex((_,index)=>!completed.has(level+'-'+index)),nextIndex=pendingIndex<0?items.length-1:pendingIndex;
      const doneCount=items.filter((_,index)=>completed.has(level+'-'+index)).length,progress=Math.round(doneCount/items.length*100);
      $('#roadmapRing').css('--progress',progress).find('span').text(progress+'%'); $('#roadmapCount').text(doneCount+'/'+items.length+' bài');
      return $('#roadmap').html(roadmapWorldHtml(items,completed,nextIndex,level,0,progress,true));
    }
    const units=CURRICULUM.getRoadmap(currentGoalId(),level),unitIndex=Math.min(11,Math.max(0,Number(state.roadmapUnit)||0)),unit=units[unitIndex],items=unit.lessons,completed=new Set(state.completedLessons||[]);
    const doneCount=items.filter(item=>completed.has(item.id)).length,progress=Math.round(doneCount/items.length*100),pendingIndex=items.findIndex(item=>!completed.has(item.id)),firstPending=pendingIndex<0?items.length-1:pendingIndex;
    $('#roadmapGoalSelect').html(goalOptions(currentGoalId())).val(currentGoalId());
    $('#roadmapUnitSelect').html(units.map((value,index)=>`<option value="${index}">Chặng ${index+1} · ${escapeHtml(value.title)}</option>`).join('')).val(String(unitIndex));
    $('#previousRoadmapUnit').prop('disabled',unitIndex===0); $('#nextRoadmapUnit,#openNextUnit').prop('disabled',unitIndex===units.length-1);
    $('#roadmapStage').text('CHẶNG '+String(unitIndex+1).padStart(2,'0')+' / 12 · '+level+' · '+currentGoal().name.toUpperCase()); $('#roadmapTitle').text(unit.title); $('#roadmapDescription').text(unit.description+' Bạn có thể mở mọi bài và học vượt kế hoạch.');
    $('#guidebookTitle').text(unit.englishTitle+' · '+level); $('#guidebookOutcomes').html(unit.guidebook.outcomes.map(outcome=>`<span>✓ ${escapeHtml(outcome)}</span>`).join('')); $('#guidebookPhrases').html(`<small>KEY PHRASES</small>${unit.guidebook.keyPhrases.map(phrase=>`<button class="guidebook-sound" data-phrase="${escapeHtml(phrase)}">♫ ${escapeHtml(phrase)}</button>`).join('')}<em>Grammar: ${escapeHtml(unit.guidebook.grammar)}</em>`);
    $('.unit-header .unit-number').text(String(unitIndex+1).padStart(2,'0')); $('#roadmapRing').css('--progress',progress).find('span').text(progress+'%'); $('#roadmapCount').text(doneCount+'/'+items.length+' bài');
    const nextUnit=units[Math.min(unitIndex+1,units.length-1)]; $('#nextUnitTitle').text(unitIndex<units.length-1?'Chặng tiếp: '+nextUnit.title:'Bạn đã mở toàn bộ lộ trình'); $('#nextUnitDescription').text(unitIndex<units.length-1?nextUnit.description:'Hãy hoàn thiện các bài còn thiếu hoặc đổi mục tiêu để khám phá lộ trình mới.');
    $('#roadmap').html(roadmapWorldHtml(items,completed,firstPending,level,unitIndex,progress,false));
  }
  function renderMistakes() {
    $('#mistakeList').html(state.mistakes.map((m,i) => `<div class="mistake-item"><span class="mistake-icon">${m.type === 'Phát âm' ? '♫' : m.type === 'Từ vựng' ? 'Aa' : '✎'}</span><div class="mistake-copy"><small>${escapeHtml(m.type)} · ${escapeHtml(m.note)}</small><p><del>${escapeHtml(m.wrong)}</del><ins>→ ${escapeHtml(m.right)}</ins></p></div><button class="review-mistake" data-index="${i}">Ôn lại</button></div>`).join(''));
  }
  function escapeHtml(value) { return $('<div>').text(value == null ? '' : String(value)).html(); }

  function parseJsonObject(value, depth) {
    depth=Number(depth)||0;
    if (depth>8) return null;
    if (typeof value !== 'string') return value && typeof value === 'object' ? value : null;
    const clean=value.replace(/^\uFEFF/,'').replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
    if (!clean) return null;
    try { const parsed=JSON.parse(clean); return parsed && typeof parsed === 'object' ? parsed : (typeof parsed === 'string' ? parseJsonObject(parsed,depth+1) : null); }
    catch (_) {
      const start=clean.indexOf('{'),end=clean.lastIndexOf('}');
      if (start>=0 && end>start) try {
        const parsed=JSON.parse(clean.slice(start,end+1));
        return parsed && typeof parsed === 'object' ? parsed : (typeof parsed === 'string' ? parseJsonObject(parsed,depth+1) : null);
      } catch (__) {}
      return null;
    }
  }

  function extractJsonStringField(value,field) {
    if (typeof value!=='string') return '';
    const match=value.match(new RegExp('"'+field+'"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"','s'));
    if (!match) return '';
    try { return JSON.parse('"'+match[1]+'"'); }
    catch (_) { return match[1].replace(/\\n/g,' ').replace(/\\"/g,'"').replace(/\\\\/g,'\\').trim(); }
  }

  function normalizeAiResponse(data) {
    let result=data && typeof data === 'object' ? {...data} : {text:String(data||'')};
    const seen=new Set();
    for (let i=0;i<8;i++) {
      const sources=['reply','text','data','result','response','content','output'];
      let nested=null;
      for (const key of sources) {
        const candidate=result[key];
        if (candidate && typeof candidate==='object') { nested=candidate; break; }
        nested=parseJsonObject(candidate);
        if (nested) break;
      }
      if (!nested) break;
      let signature=''; try { signature=JSON.stringify(nested); } catch (_) {}
      if (signature && seen.has(signature)) break;
      if (signature) seen.add(signature);
      result={...result,...nested};
    }
    if (result.reply && typeof result.reply === 'object') result={...result,...result.reply};
    if (typeof result.reply==='string') {
      const nestedReply=parseJsonObject(result.reply);
      if (nestedReply) result={...result,...nestedReply};
      else if (/^\s*\{/.test(result.reply)) result.reply=extractJsonStringField(result.reply,'reply')||result.reply;
    }
    if (typeof result.reply !== 'string' && typeof result.text === 'string') result.reply=result.text;
    return result;
  }

  function aiText(value, fallback) {
    if (Array.isArray(value)) return value.map(item=>aiText(item,'')).filter(Boolean).join(' · ') || (fallback||'');
    if (value && typeof value === 'object') {
      const preferred=value.reply||value.feedback||value.comment||value.tip||value.text||value.value;
      if (preferred) return aiText(preferred,fallback);
      return Object.values(value).filter(item=>typeof item === 'string' || typeof item === 'number').join(' · ') || (fallback||'');
    }
    if (value == null || value === '') return fallback == null || fallback === '' ? '' : aiText(fallback,'');
    const text=String(value);
    const nested=parseJsonObject(text);
    if (nested) return aiText(nested.reply||nested.text||nested.content||nested.response,fallback);
    if (/^\s*\{/.test(text)) {
      const extracted=extractJsonStringField(text,'reply')||extractJsonStringField(text,'text');
      if (extracted) return extracted;
    }
    return text;
  }

  function routeTo(route) {
    const valid = ['home','learn','practice','review','profile'];
    route = valid.includes(route) ? route : 'home';
    if (route!=='practice'&&examSession.active) {
      if (!confirm('Đề thi đang chạy. Bạn có chắc muốn thoát? Kết quả chưa nộp sẽ không được lưu.')) return;
      abortExam();
    }
    if (route!=='practice') stopSpeakingRecording(true);
    $('.view').removeClass('active'); $('#view-' + route).addClass('active');
    $('[data-route]').removeClass('active').filter(`[data-route="${route}"]`).addClass('active');
    try { history.replaceState(null, '', '#' + route); } catch (_) { location.hash = route; }
    window.scrollTo({ top:0, behavior:'smooth' });
  }

  function switchPractice(type) {
    if (examSession.active&&type!=='exam') {
      if (!confirm('Đề thi đang chạy. Bạn có chắc muốn thoát? Kết quả chưa nộp sẽ không được lưu.')) return;
      abortExam();
    }
    if (type!=='speaking') stopSpeakingRecording(true);
    routeTo('practice');
    $('.practice-tab').removeClass('active').filter(`[data-practice="${type}"]`).addClass('active');
    $('.practice-pane').removeClass('active'); $('#practice-' + type).addClass('active');
    renderPractice(type);
    setTimeout(() => $('#view-practice')[0].scrollIntoView({ behavior:'smooth', block:'start' }), 50);
  }

  function stableHash(value) {
    let hash=2166136261;
    for (const char of String(value||'')) { hash^=char.charCodeAt(0); hash=Math.imul(hash,16777619); }
    return hash>>>0;
  }

  function seededIndexes(length,seed) {
    const values=Array.from({length},(_,index)=>index); let value=(Number(seed)||1)>>>0;
    const random=()=>{ value=(Math.imul(value,1664525)+1013904223)>>>0; return value/4294967296; };
    for (let index=values.length-1;index>0;index--) { const swap=Math.floor(random()*(index+1)); [values[index],values[swap]]=[values[swap],values[index]]; }
    return values;
  }

  function practiceQueueKey(type) {
    const topic=type==='vocabulary'?(state.vocabularyTopic||'all'):type==='challenge'?(state.challengeTopic||'all'):(state.practiceTopic||'all');
    return [currentGoalId(),state.level,type,topic].join(':');
  }

  function practiceSessionLimit(type,length) {
    return Math.min(length,{listening:8,reading:8,speaking:6,writing:6,vocabulary:12,challenge:20}[type]||10);
  }

  function buildPracticeQueue(type,source,retryEntries) {
    if (!source.length) return [];
    if (Array.isArray(retryEntries)&&retryEntries.length) return retryEntries.map(entry=>typeof entry==='object'?entry:{itemIndex:Number(entry)||0,variantCycle:0});
    state.practiceOffsets=state.practiceOffsets||{};
    const key=practiceQueueKey(type),offset=Math.max(0,Number(state.practiceOffsets[key])||0),limit=practiceSessionLimit(type,source.length),queue=[];
    for (let step=0;step<limit;step++) {
      const absolute=offset+step,cycle=Math.floor(absolute/source.length),position=absolute%source.length,order=seededIndexes(source.length,stableHash(key+'|'+cycle));
      queue.push({itemIndex:order[position],variantCycle:cycle});
    }
    state.practiceOffsets[key]=offset+limit;
    return queue;
  }

  function variantDialogue(text,cycle,index) {
    if (!cycle) return String(text||'');
    const pairs=[['Noah','Olivia'],['Ethan','Ava'],['Lucas','Sophia'],['Daniel','Emma'],['James','Mia'],['Henry','Chloe']],pair=pairs[(cycle+index)%pairs.length];
    const lines=String(text||'').split(/\n+/),renamed=lines.map(line=>line.replace(/^\s*Alex\s*:/i,pair[0]+':').replace(/^\s*Mia\s*:/i,pair[1]+':'));
    const closers=['That sounds useful.','Let us take the next step.','Thanks for explaining that clearly.','I understand the situation now.','That plan works for me.'];
    renamed.push(pair[cycle%2]+': '+closers[(cycle+index)%closers.length]);
    return renamed.join('\n');
  }

  function practiceVariantItem(type,item,cycle,index) {
    const value=$.extend(true,{},item||{}); if (!cycle) return value;
    const names=['Noah','Olivia','Ethan','Ava','Lucas','Sophia','Daniel','Emma'],name=names[(cycle+index)%names.length],suffix=' · Bộ mới '+(cycle+1);
    value.id=String(value.id||type+'-'+index)+'-cycle-'+cycle;
    if (type==='listening') { value.audio=variantDialogue(value.audio,cycle,index); value.question=(['What is the main focus of this exchange?','Which idea best summarizes the conversation?','What are the speakers mainly discussing?'][(cycle+index)%3]); }
    if (type==='reading') { value.title=String(value.title||'Reading')+suffix; value.passage=String(value.passage||'').replace(/\bSam\b/g,name)+' '+name+' writes down the most useful point before continuing.'; }
    if (type==='speaking') { const extra=['This is important to me.','That is my next step.','This helps everyone understand.','I can explain the reason clearly.'][(cycle+index)%4]; value.target=String(value.target||'').trim()+' '+extra; value.vi=String(value.vi||'')+' Hãy đọc thêm câu kết để luyện phản xạ.'; }
    if (type==='writing') { value.title=String(value.title||'Writing task')+suffix; value.instruction=String(value.instruction||'')+' Use a new example, explain one reason, and finish with a clear next step for '+name+'.'; }
    if (type==='vocabulary') { value.example=String(value.example||'')+' '+['Use it again in a new situation.','Say one personal example aloud.','Connect it with your learning goal.'][(cycle+index)%3]; value.vi=String(value.vi||'')+' Đây là ngữ cảnh ôn mới.'; }
    if (type==='challenge') { value.question='New scenario '+(cycle+1)+': '+String(value.question||''); if (value.audio) value.audio=variantDialogue(value.audio,cycle,index); if (value.passage) value.passage=String(value.passage).replace(/\bSam\b/g,name); }
    return value;
  }

  function activePracticeData(type) {
    const level=practiceData[state.level] ? state.level : 'A1';
    const goal=currentGoalId(),topic=type==='vocabulary'?(state.vocabularyTopic||'all'):(state.practiceTopic||'all');
    if (practiceSession.level!==level||practiceSession.goal!==goal||practiceSession.topic!==topic) resetPracticeSessions(level,goal,topic);
    const sourceDeck=curriculumDeck(type,topic),queueKey=type+'Queue',resultsKey=type+'Results';
    if (['listening','reading','speaking','writing','vocabulary'].includes(type) && !Array.isArray(practiceSession[queueKey])) {
      practiceSession[queueKey]=buildPracticeQueue(type,sourceDeck);
      practiceSession[resultsKey]=[];
    }
    const queue=Array.isArray(practiceSession[queueKey])?practiceSession[queueKey]:buildPracticeQueue(type,sourceDeck),deck=queue.map((entry,position)=>practiceVariantItem(type,sourceDeck[entry.itemIndex],entry.variantCycle,position));
    const index=Math.min(Math.max(0,Number(practiceSession[type])||0),Math.max(0,deck.length-1)),entry=queue[index]||{itemIndex:index,variantCycle:0},itemIndex=entry.itemIndex;
    return {level,deck,sourceDeck,queue,index,itemIndex,entry,item:deck[index]};
  }

  function resetPracticeSessions(level,goal,topic) {
    practiceSession.level=level||state.level;
    practiceSession.goal=goal||currentGoalId(); practiceSession.topic=topic||'all';
    ['listening','reading','speaking','writing','vocabulary','challenge'].forEach(type=>{ practiceSession[type]=0; });
    ['listening','reading','speaking','writing','vocabulary','challenge'].forEach(type=>{ practiceSession[type+'Queue']=null; practiceSession[type+'Results']=[]; });
    practiceSession.vocabularyQuiz=null;
  }

  function shuffledIndexes(length) {
    const values=Array.from({length},(_,index)=>index);
    for (let i=values.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [values[i],values[j]]=[values[j],values[i]]; }
    return values;
  }

  function vocabularyStrength(level,card) {
    return Number(state.vocabularyReview?.[currentGoalId()+':'+level+':'+card.word]?.strength)||0;
  }

  function updateVocabularyReview(level,card,remembered) {
    state.vocabularyReview=state.vocabularyReview||{}; const key=currentGoalId()+':'+level+':'+card.word,wasNew=!state.vocabularyReview[key],previous=state.vocabularyReview[key]||{strength:0};
    const strength=remembered?Math.min(3,Number(previous.strength||0)+1):Math.max(0,Number(previous.strength||0)-1),days=[0,1,3,7][strength];
    state.vocabularyReview[key]={strength,lastReviewed:new Date().toISOString(),nextReviewAt:new Date(Date.now()+days*86400000).toISOString()};
    return wasNew;
  }

  function exerciseStrength(item) {
    return Number(state.exerciseMastery?.[item?.id]?.mastery)||0;
  }

  function updateExerciseMastery(item,correct) {
    if (!item?.id) return;
    state.exerciseMastery=state.exerciseMastery||{};
    const previous=state.exerciseMastery[item.id]||{attempts:0,correct:0,streak:0,mastery:0};
    const streak=correct?Number(previous.streak||0)+1:0;
    state.exerciseMastery[item.id]={
      attempts:Number(previous.attempts||0)+1,
      correct:Number(previous.correct||0)+(correct?1:0),
      streak,
      mastery:correct?Math.min(5,Number(previous.mastery||0)+1):Math.max(0,Number(previous.mastery||0)-2),
      lastAttemptAt:new Date().toISOString()
    };
  }

  function startFiniteSession(type,indexes) {
    const source=curriculumDeck(type);
    practiceSession[type]=0; practiceSession[type+'Queue']=buildPracticeQueue(type,source,indexes); practiceSession[type+'Results']=[];
    if (type==='vocabulary') practiceSession.vocabularyQuiz=null;
    $('#practice-'+type).removeClass('session-complete'); $('#'+type+'Summary').addClass('hidden').empty(); renderPractice(type);
  }

  function choiceButtons(options,correct) {
    return options.map((option,index)=>`<button data-index="${index}" data-correct="${index===correct}"><b>${String.fromCharCode(65+index)}</b> ${escapeHtml(option)}</button>`).join('');
  }

  function renderPractice(type) {
    if (!practiceData[state.level]) return;
    if (type==='listening') renderListening();
    if (type==='reading') renderReading();
    if (type==='speaking') renderSpeaking();
    if (type==='writing') renderWriting();
    if (type==='vocabulary') updateFlashcard();
    if (type==='challenge') renderChallenge();
    if (type==='exam'&&!examSession.active) renderExamBank();
  }

  function renderListening() {
    const {level,deck,index,item}=activePracticeData('listening'); if (!item) return;
    $('#practice-listening').removeClass('session-complete'); $('#listeningSummary').addClass('hidden').empty();
    $('#listeningLevel').text('NGHE · '+level); $('#listeningProgress').text('Câu '+(index+1)+' / '+deck.length); $('#listeningQuestion').text(item.question);
    $('#listeningAnswers').removeData('done').html(choiceButtons(item.options,item.correct));
    $('#listeningFeedback').removeClass('show success error').empty(); $('#nextListening').text('Câu tiếp theo →'); $('#nextListening,#showListeningTranscript,#listeningTranscript').addClass('hidden'); $('#listeningTranscript').text(item.audio); $('#showListeningTranscript').text('▤ Xem transcript'); $('.audio-wave').removeClass('playing');
  }

  function renderReading() {
    const {level,deck,index,item}=activePracticeData('reading'); if (!item) return;
    $('#practice-reading').removeClass('session-complete'); $('#readingSummary').addClass('hidden').empty();
    $('#readingLevel').text('ĐỌC · '+level); $('#readingProgress').text('Bài '+(index+1)+' / '+deck.length); $('#readingTitle').text(item.title); $('#readingPassage').text(item.passage); $('#readingQuestion').text(item.question);
    $('#readingAnswers').removeData('done').html(choiceButtons(item.options,item.correct));
    $('#readingFeedback').removeClass('show success error').empty(); $('#nextReading').text('Bài tiếp theo →').addClass('hidden');
  }

  function renderSpeaking() {
    const {level,deck,index,item}=activePracticeData('speaking'); if (!item) return;
    $('#practice-speaking').removeClass('session-complete'); $('#speakingSummary').addClass('hidden').empty();
    stopSpeakingRecording(true);
    transcript=''; recordedAudio=null; $('#speakingLevel').text('NÓI · '+level+' · AI COACH'); $('#speakingProgress').text('Câu '+(index+1)+' / '+deck.length);
    $('#speakingTarget').text('“'+item.target+'”'); $('#speakingMeaning').text(item.vi); $('#liveTranscript').text('Lời bạn nói sẽ xuất hiện tại đây...'); $('#recordLabel').text('Chạm để bắt đầu nói');
    $('#recordBtn').removeClass('recording'); $('#analyzeSpeech,#nextSpeaking').addClass('hidden'); $('#nextSpeaking').text(index>=deck.length-1?'Xem kết quả →':'Luyện câu tiếp theo →'); $('#speechFeedback').removeClass('show').empty();
  }

  function renderWriting() {
    const {level,deck,index,item}=activePracticeData('writing'); if (!item) return;
    $('#practice-writing').removeClass('session-complete'); $('#writingSummary').addClass('hidden').empty();
    $('#writingLevel').text('VIẾT · '+level+' · AI COACH'); $('#writingProgress').text('Đề '+(index+1)+' / '+deck.length); $('#writingTitle').text(item.title); $('#writingInstruction').text(item.instruction);
    $('#writingChips').html(item.chips.map(chip=>`<button>${escapeHtml(chip)}</button>`).join('')); $('#writingInput').val('').trigger('input'); $('#writingFeedback').removeClass('show').empty(); $('#nextWriting').text(index>=deck.length-1?'Xem kết quả →':'Đề tiếp theo →').addClass('hidden'); $('#checkWriting').removeClass('hidden');
  }

  function activeChallengeData(reset) {
    if (!CURRICULUM) return {deck:[],index:0,item:null};
    const generated=Array.isArray(practiceSession.aiChallengeDeck)&&practiceSession.aiChallengeDeck.length?practiceSession.aiChallengeDeck:null;
    const source=generated||CURRICULUM.getExercises(currentGoalId(),state.level,state.challengeType||'all',state.challengeTopic||'all').filter(item=>!['speaking','writing'].includes(item.type));
    if (reset||!Array.isArray(practiceSession.challengeQueue)||practiceSession.challengeQueue.some(entry=>Number(entry?.itemIndex)>=source.length)) {
      practiceSession.challengeQueue=generated?shuffledIndexes(source.length).slice(0,Math.min(20,source.length)).map(itemIndex=>({itemIndex,variantCycle:0})):buildPracticeQueue('challenge',source);
      practiceSession.challenge=0; practiceSession.challengeResults=[];
    }
    const deck=practiceSession.challengeQueue.map((entry,position)=>practiceVariantItem('challenge',source[entry.itemIndex],entry.variantCycle,position)),index=Math.min(Number(practiceSession.challenge)||0,Math.max(0,deck.length-1));
    return {source,deck,index,item:deck[index],entry:practiceSession.challengeQueue[index]};
  }

  function renderChallenge(reset) {
    if (!CURRICULUM) return;
    const typeOptions='<option value="all">Trộn 8 dạng bài</option>'+CURRICULUM.types.filter(type=>!['speaking','writing'].includes(type[0])).map(type=>`<option value="${type[0]}">${escapeHtml(type[1])}</option>`).join('');
    $('#challengeTypeSelect').html(typeOptions).val(state.challengeType||'all'); populateTopicSelect('#challengeTopicSelect',state.challengeTopic||'all');
    const generated=Array.isArray(practiceSession.aiChallengeDeck)&&practiceSession.aiChallengeDeck.length;
    const {deck,index,item}=activeChallengeData(reset); if (!item) return;
    $('#practice-challenge').removeClass('session-complete'); $('#challengeSummary').addClass('hidden').empty();
    $('#challengeLevel').text((generated?'AI PRACTICE SET':'PRACTICE LAB')+' · '+state.level+' · PHIÊN KHÔNG LẶP'); $('#challengeProgress').text('Câu '+(index+1)+' / '+deck.length); $('#challengeTypeLabel').text(item.typeLabel.toUpperCase()+' · '+String(item.topicEn||item.topic).toUpperCase()); $('#challengeQuestion').text(item.question);
    $('#challengeAnswers').removeData('done').html(choiceButtons(item.options,item.options.indexOf(item.answer))); $('#challengeFeedback').removeClass('show success error').empty(); $('#challengeAiFeedback').removeClass('show').empty(); $('#explainChallenge,#nextChallenge').addClass('hidden');
    $('#playChallengeAudio').toggleClass('hidden',!item.audio).data('audio',item.audio||'');
    $('#challengePassage').toggleClass('hidden',!item.passage).text(item.passage||'');
  }

  const EXAM_TYPE_LABELS={listening:'Nghe',dictation:'Nghe chính tả',reading:'Đọc',speaking:'Nói',writing:'Viết',ordering:'Sắp xếp từ',grammar:'Ngữ pháp',tense:'Các thì',cloze:'Điền từ'};

  function buildTenseQuestion(level,seed,examNumber,slot,theme) {
    const names=['Maya','Noah','Liam','Emma','Leo','Sofia','Daniel','Chloe'],verbs=[
      {base:'write',third:'writes',past:'wrote',pp:'written',ing:'writing',object:'a short report'},
      {base:'send',third:'sends',past:'sent',pp:'sent',ing:'sending',object:'the confirmation email'},
      {base:'build',third:'builds',past:'built',pp:'built',ing:'building',object:'a useful prototype'},
      {base:'choose',third:'chooses',past:'chose',pp:'chosen',ing:'choosing',object:'the best option'},
      {base:'take',third:'takes',past:'took',pp:'taken',ing:'taking',object:'careful notes'},
      {base:'make',third:'makes',past:'made',pp:'made',ing:'making',object:'a clear plan'},
      {base:'find',third:'finds',past:'found',pp:'found',ing:'finding',object:'the right answer'},
      {base:'give',third:'gives',past:'gave',pp:'given',ing:'giving',object:'helpful feedback'}
    ],name=names[(seed+examNumber)%names.length],verb=verbs[seed%verbs.length],mode=seed%4;
    let question='',answer='',options=[];
    if (level==='A1') {
      if (mode===0) { question=`${name} ___ ${verb.object} every Monday.`; answer=verb.third; options=[verb.third,verb.base,verb.past]; }
      if (mode===1) { question=`${name} is ___ ${verb.object} right now.`; answer=verb.ing; options=[verb.ing,verb.base,verb.past]; }
      if (mode===2) { question=`Yesterday, ${name} ___ ${verb.object}.`; answer=verb.past; options=[verb.past,verb.third,verb.ing]; }
      if (mode===3) { question=`${name} ___ ready for task ${examNumber}.${slot}.`; answer='is'; options=['is','are','be']; }
    } else if (level==='A2') {
      if (mode===0) { question=`Last week, ${name} ___ ${verb.object}.`; answer=verb.past; options=[verb.past,verb.pp,verb.third]; }
      if (mode===1) { question=`${name} has just ___ ${verb.object}.`; answer=verb.pp; options=[verb.pp,verb.past,verb.ing]; }
      if (mode===2) { question=`Tomorrow, ${name} is going to ___ ${verb.object}.`; answer=verb.base; options=[verb.base,verb.past,verb.ing]; }
      if (mode===3) { question=`When I called, ${name} was ___ ${verb.object}.`; answer=verb.ing; options=[verb.ing,verb.pp,verb.third]; }
    } else if (level==='B1') {
      if (mode===0) { question=`${name} has ___ ${verb.object} since early this morning.`; answer=verb.pp; options=[verb.pp,verb.past,verb.ing]; }
      if (mode===1) { question=`${name} had ___ ${verb.object} before the meeting began.`; answer=verb.pp; options=[verb.pp,verb.past,verb.third]; }
      if (mode===2) { question=`If ${name} finishes early, they will ___ ${verb.object}.`; answer=verb.base; options=[verb.base,verb.past,verb.pp]; }
      if (mode===3) { question=`While ${name} was ___ ${verb.object}, the client called.`; answer=verb.ing; options=[verb.ing,verb.pp,verb.third]; }
    } else {
      if (mode===0) { question=`By next Friday, ${name} will have ___ ${verb.object}.`; answer=verb.pp; options=[verb.pp,verb.past,verb.ing]; }
      if (mode===1) { question=`${name} has been ___ ${verb.object} for two hours.`; answer=verb.ing; options=[verb.ing,verb.pp,verb.third]; }
      if (mode===2) { question=`If ${name} had ___ ${verb.object}, the delay could have been avoided.`; answer=verb.pp; options=[verb.pp,verb.past,verb.base]; }
      if (mode===3) { question=`Only after ${name} had ___ ${verb.object} did the team proceed.`; answer=verb.pp; options=[verb.pp,verb.past,verb.ing]; }
    }
    const order=seededIndexes(options.length,stableHash(level+'|tense|'+seed+'|'+examNumber)); options=order.map(index=>options[index]);
    return {id:`exam-${level}-${examNumber}-tense-${slot}`,type:'tense',typeLabel:'Các thì',question:`${theme||'Tense practice'} · ${slot}. ${question}`,options,answer,explanation:'Dấu hiệu thời gian và cấu trúc câu quyết định dạng động từ phù hợp.'};
  }

  function examSourceItem(level,type,absolute,examNumber,slot,theme) {
    const source=CURRICULUM?.getExercises(currentGoalId(),level,type,'all')||[]; if (!source.length) return null;
    const cycle=Math.floor(absolute/source.length),base=source[absolute%source.length],value=practiceVariantItem(type,base,cycle,absolute);
    value.id=`exam-${currentGoalId()}-${level}-${examNumber}-${slot}-${type}`; value.type=type; value.typeLabel=EXAM_TYPE_LABELS[type]||value.typeLabel||type;
    if (!value.answer&&Array.isArray(value.options)&&Number.isInteger(Number(value.correct))) value.answer=value.options[Number(value.correct)];
    if (type==='writing') {
      const requirements=['Give one concrete example and a clear next action.','Explain one reason and one expected result.','Describe a small problem and propose a practical solution.','Compare two choices and state which one you prefer.'];
      value.instruction=`${theme} · Writing task ${slot+1}. ${value.instruction||value.question||''} ${requirements[(examNumber+slot)%requirements.length]}`;
    }
    value.question=`${theme} · ${slot+1}. ${value.question||value.instruction||value.target||''}`;
    return value;
  }

  function buildExamBank(level) {
    if (!CURRICULUM) return [];
    const units=CURRICULUM.getRoadmap(currentGoalId(),level),baseMinutes={A1:25,A2:30,B1:35,B2:40}[level]||30;
    return Array.from({length:20},(_,examIndex)=>{
      const examNumber=examIndex+1,unit=units[examIndex%units.length],theme=unit.englishTitle+(examIndex>=12?' · Applied mission':' · Skills mission'),items=[],counts={};
      const add=type=>{
        const local=counts[type]||0; counts[type]=local+1;
        if (type==='tense') { items.push(buildTenseQuestion(level,examIndex*2+local,examNumber,items.length+1,theme)); return; }
        const perExam={listening:3,reading:2,speaking:2,writing:2}[type]||1,absolute=examIndex*perExam+local,item=examSourceItem(level,type,absolute,examNumber,items.length,theme);
        if (item) items.push(item);
      };
      add('listening'); add('reading'); add('grammar'); add('tense'); add('speaking'); add('ordering'); add('listening'); add('writing'); add('cloze'); add('reading'); add('tense'); add('speaking'); add('dictation'); add('writing'); add('listening');
      return {id:`${currentGoalId()}-${level}-exam-${examNumber}`,number:examNumber,level,title:`Đề ${String(examNumber).padStart(2,'0')} · ${unit.englishTitle}`,theme,durationMinutes:baseMinutes+Math.floor(examIndex/5)*3,items};
    });
  }

  function examResultKey(exam) { return [currentGoalId(),exam.level,exam.id].join(':'); }
  function formatExamTime(seconds) { const value=Math.max(0,Math.round(Number(seconds)||0)); return String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0'); }

  function renderExamBank() {
    if (!CURRICULUM) return;
    clearInterval(examSession.timer); examSession.timer=null; examSession.active=false; stopExamRecording(true); $('#practiceLevelSelect,#practiceGoalSelect,#vocabularyGoalSelect').prop('disabled',false);
    const exams=buildExamBank(state.level),records=state.examResults||{},completed=exams.filter(exam=>records[examResultKey(exam)]),passed=exams.filter(exam=>Number(records[examResultKey(exam)]?.bestScore)>=70),best=exams.reduce((score,exam)=>Math.max(score,Number(records[examResultKey(exam)]?.bestScore)||0),0);
    $('#examLevelLabel').text('LUYỆN ĐỀ · '+state.level+' · '+currentGoal().name.toUpperCase());
    $('#examOverview').html(`<div><strong>${completed.length}/20</strong><span>ĐÃ LÀM</span></div><div><strong>${passed.length}</strong><span>ĐÃ PASS</span></div><div><strong>${best}%</strong><span>ĐIỂM CAO NHẤT</span></div>`);
    $('#examBadgeGrid').html(exams.map(exam=>{ const result=records[examResultKey(exam)],status=!result?'new':Number(result.bestScore)>=70?'passed':'failed'; return `<button type="button" class="exam-badge ${status}" data-exam-index="${exam.number-1}"><span class="exam-number">${String(exam.number).padStart(2,'0')}</span><strong>Đề ${String(exam.number).padStart(2,'0')}</strong><small>⏱ ${exam.durationMinutes} phút</small><em>${result?'Cao nhất '+result.bestScore+'%':'Chưa làm'}</em></button>`; }).join(''));
    const history=Object.values(records).filter(record=>record.goalId===currentGoalId()&&record.level===state.level).flatMap(record=>(record.history||[]).map(item=>Object.assign({examNumber:record.examNumber},item))).sort((a,b)=>String(b.completedAt).localeCompare(String(a.completedAt))).slice(0,8);
    $('#examHistoryCount').text(history.length?history.length+' lượt gần nhất':'Chưa làm đề nào');
    $('#examHistoryList').html(history.length?history.map(item=>`<div><span class="history-exam-number">${String(item.examNumber).padStart(2,'0')}</span><strong>Đề ${String(item.examNumber).padStart(2,'0')}</strong><small>${new Date(item.completedAt).toLocaleString('vi-VN')} · ${formatExamTime(item.durationSeconds)}</small><b class="${item.score>=70?'passed':'failed'}">${item.score}%</b></div>`).join(''):'<p class="empty-exam-history">Kết quả mỗi lần luyện đề sẽ được lưu tại đây.</p>');
    $('#examBankView').removeClass('hidden'); $('#examPlayer,#examResult').addClass('hidden');
  }

  function startExam(examIndex) {
    const exam=buildExamBank(state.level)[Number(examIndex)]; if (!exam) return;
    if (!confirm(`Bắt đầu ${exam.title}? Bạn có ${exam.durationMinutes} phút và đồng hồ sẽ chạy liên tục.`)) return;
    examSession.active=true; examSession.exam=exam; examSession.index=0; examSession.scores=[]; examSession.answers=[]; examSession.startedAt=Date.now(); examSession.secondsLeft=exam.durationMinutes*60; examSession.answered=false;
    $('#practiceLevelSelect,#practiceGoalSelect,#vocabularyGoalSelect').prop('disabled',true);
    $('#examBankView,#examResult').addClass('hidden'); $('#examPlayer').removeClass('hidden'); updateExamTimer(); clearInterval(examSession.timer); examSession.timer=setInterval(()=>{ examSession.secondsLeft--; updateExamTimer(); if (examSession.secondsLeft<=0) finishExam(true); },1000); renderExamQuestion();
  }

  function updateExamTimer() { $('#examTimer').text(formatExamTime(examSession.secondsLeft)).toggleClass('warning',examSession.secondsLeft<=300); }

  function examQuestionHtml(item) {
    const type=item.type;
    if (type==='speaking') return `<div class="exam-speaking-card"><button type="button" class="exam-sample">♫ Nghe câu mẫu</button><h2>${escapeHtml(item.target||item.question)}</h2><p>${escapeHtml(item.vi||'Đọc đầy đủ và rõ ràng câu trên.')}</p><button type="button" class="exam-record-btn"><span>●</span></button><strong id="examRecordLabel">Nhấn để bắt đầu ghi</strong><div class="exam-transcript" id="examTranscript">Lời bạn nói sẽ xuất hiện ở đây...</div><button type="button" class="primary-btn wide hidden" id="gradeExamSpeaking">✦ Chấm phần nói</button></div>`;
    if (type==='writing') return `<div class="exam-writing-card"><h2>${escapeHtml(item.title||'Writing task')}</h2><p>${escapeHtml(item.instruction||item.question)}</p><textarea id="examWritingInput" maxlength="900" placeholder="Write your answer in English..."></textarea><div><span>Tối thiểu ${item.minWords||20} từ</span><b><i id="examWritingCount">0</i>/900</b></div><button type="button" class="primary-btn wide" id="gradeExamWriting">✦ Nộp phần viết</button></div>`;
    const media=item.audio?`<button type="button" class="exam-audio-button" data-audio="${escapeHtml(item.audio)}"><span>▶</span><strong>Nghe đoạn ghi âm</strong></button>`:'',passage=item.passage?`<div class="exam-reading-passage">${escapeHtml(item.passage)}</div>`:'';
    return `${media}${passage}<h2>${escapeHtml(item.question)}</h2><div class="answer-list exam-options">${choiceButtons(item.options||[],(item.options||[]).indexOf(item.answer))}</div>`;
  }

  function renderExamQuestion() {
    if (!examSession.active||!examSession.exam) return;
    stopExamRecording(true); examSession.answered=false; examAudio=null; examTranscript='';
    const exam=examSession.exam,item=exam.items[examSession.index];
    $('#examTitle').text(exam.title); $('#examQuestionNumber').text('Câu '+(examSession.index+1)+' / '+exam.items.length); $('#examQuestionType').text((EXAM_TYPE_LABELS[item.type]||item.type).toUpperCase()); $('#examProgressBar').css('width',((examSession.index)/exam.items.length*100)+'%');
    $('#examQuestionBody').html(examQuestionHtml(item)); $('#examQuestionFeedback').removeClass('show success error').empty(); $('#nextExamQuestion').addClass('hidden').text(examSession.index>=exam.items.length-1?'Nộp bài & xem điểm →':'Câu tiếp theo →');
  }

  function recordExamAnswer(score,answer,feedback) {
    if (!examSession.active||examSession.answered) return; examSession.answered=true;
    examSession.scores[examSession.index]=Math.max(0,Math.min(100,Math.round(Number(score)||0))); examSession.answers[examSession.index]=answer||'';
    $('#examQuestionFeedback').attr('class','exam-question-feedback show '+(score>=70?'success':'error')).html(feedback||('Điểm câu này: '+examSession.scores[examSession.index]+'/100')); $('#nextExamQuestion').removeClass('hidden');
  }

  function finishExam(timedOut) {
    if (!examSession.exam||!examSession.active) return; examSession.active=false; clearInterval(examSession.timer); examSession.timer=null; stopExamRecording(true);
    const exam=examSession.exam; while (examSession.scores.length<exam.items.length) examSession.scores.push(0);
    const score=Math.round(examSession.scores.reduce((sum,value)=>sum+(Number(value)||0),0)/exam.items.length),passed=score>=70,durationSeconds=Math.max(1,Math.round((Date.now()-examSession.startedAt)/1000)),groups={};
    exam.items.forEach((item,index)=>{ const group=['dictation'].includes(item.type)?'listening':['ordering','grammar','tense','cloze'].includes(item.type)?'language':item.type; groups[group]=groups[group]||[]; groups[group].push(examSession.scores[index]||0); });
    const skillScores=Object.keys(groups).map(group=>({group,label:{listening:'Nghe',reading:'Đọc',speaking:'Nói',writing:'Viết',language:'Ngữ pháp'}[group]||group,score:Math.round(groups[group].reduce((a,b)=>a+b,0)/groups[group].length)}));
    state.examResults=state.examResults||{}; const key=examResultKey(exam),previous=state.examResults[key]||{attempts:0,bestScore:0,history:[]},attempt={score,passed,completedAt:new Date().toISOString(),durationSeconds,timedOut:!!timedOut,skills:skillScores,answers:examSession.answers.slice(0,exam.items.length)};
    state.examResults[key]={goalId:currentGoalId(),level:exam.level,examId:exam.id,examNumber:exam.number,title:exam.title,attempts:Number(previous.attempts||0)+1,bestScore:Math.max(Number(previous.bestScore)||0,score),lastScore:score,completedAt:attempt.completedAt,history:[attempt].concat(previous.history||[]).slice(0,10)};
    const earnedMinutes=Math.max(1,Math.round(durationSeconds/60)),day=(new Date().getDay()+6)%7;
    state.xp+=passed?75:30; state.minutesWeek+=earnedMinutes; state.week[day]=(state.week[day]||0)+earnedMinutes; saveState(true); $('#practiceLevelSelect,#practiceGoalSelect,#vocabularyGoalSelect').prop('disabled',false);
    $('#examPlayer,#examBankView').addClass('hidden'); $('#examResult').removeClass('hidden').html(`<img src="assets/mochi.png" alt="Mochi"><span class="section-kicker">${timedOut?'HẾT GIỜ · ĐÃ TỰ ĐỘNG NỘP BÀI':'ĐÃ HOÀN THÀNH '+escapeHtml(exam.title)}</span><h2>${passed?'Bạn đã vượt qua đề thi!':'Chưa đạt 70% · hãy ôn và thử lại'}</h2><div class="exam-final-score ${passed?'passed':'failed'}"><strong>${score}</strong><span>/100</span></div><div class="exam-skill-results">${skillScores.map(skill=>`<div><span>${skill.label}</span><i><b style="width:${skill.score}%"></b></i><strong>${skill.score}%</strong></div>`).join('')}</div><div class="summary-actions"><button type="button" class="secondary-btn exam-back-bank">← Danh sách đề</button><button type="button" class="primary-btn exam-retry" data-exam-index="${exam.number-1}">Làm lại đề ${String(exam.number).padStart(2,'0')}</button></div>`);
    if (passed) confetti();
  }

  function abortExam() {
    clearInterval(examSession.timer); examSession.timer=null; examSession.active=false; examSession.exam=null; stopExamRecording(true); renderExamBank();
  }

  function nextPractice(type) {
    const data=activePracticeData(type); if (!data.deck.length) return;
    if (['listening','reading','speaking','writing'].includes(type)&&data.index>=data.deck.length-1) return renderFiniteSummary(type);
    practiceSession[type]=data.index+1; renderPractice(type);
  }

  function renderFiniteSummary(type) {
    const results=practiceSession[type+'Results']||[],total=results.length,correct=results.filter(result=>result.correct).length,wrong=total-correct,accuracy=total?Math.round(correct/total*100):0;
    const label={listening:'luyện nghe',reading:'luyện đọc',speaking:'luyện nói',writing:'luyện viết',vocabulary:'flashcard',challenge:'Practice Lab'}[type]||'luyện tập',unit=type==='vocabulary'?'từ':'câu';
    const canRetryWrong=['listening','reading','vocabulary'].includes(type);
    const retryButton=wrong&&canRetryWrong?`<button class="secondary-btn session-retry" data-type="${type}">↻ Luyện lại ${wrong} ${type==='vocabulary'?'từ khó':'câu sai'}</button>`:'';
    const quizButton=type==='vocabulary'&&total?'<button class="primary-btn start-vocabulary-quiz">✓ Làm bài kiểm tra 4 đáp án</button>':'';
    const html=`<img class="summary-mascot" src="assets/mochi.png" alt="Mochi chúc mừng"><span class="section-kicker">HOÀN THÀNH PHIÊN</span><h2>Bạn đã xong ${escapeHtml(label)}!</h2><p>Phiên học đã dừng để bạn xem kết quả. Hãy luyện lại phần chưa chắc hoặc bắt đầu một bộ đã trộn thứ tự.</p><div class="summary-score"><div><strong>${total}</strong><span>${unit.toUpperCase()} ĐÃ HỌC</span></div><div><strong>${correct}</strong><span>ĐÃ NẮM</span></div><div><strong>${accuracy}%</strong><span>CHÍNH XÁC</span></div></div><div class="summary-actions">${quizButton}${retryButton}<button class="secondary-btn session-restart" data-type="${type}">Trộn & học phiên mới →</button></div><small class="summary-note">Kết quả đã được lưu vào tiến độ học tập.</small>`;
    $('#practice-'+type).addClass('session-complete'); $('#'+type+'Summary').html(html).removeClass('hidden');
  }

  function startVocabularyQuiz() {
    const source=curriculumDeck('vocabulary'),studied=[...new Set((practiceSession.vocabularyResults||[]).map(result=>result.itemIndex))],indexes=studied.length?studied:practiceSession.vocabularyQueue||[];
    const items=indexes.map(itemIndex=>{
      const card=source[itemIndex]; if (!card) return null;
      const wrong=[];
      shuffledIndexes(source.length).forEach(index=>{ const meaning=source[index]?.meaning; if (meaning&&meaning!==card.meaning&&!wrong.includes(meaning)&&wrong.length<3) wrong.push(meaning); });
      if (wrong.length<3) return null;
      const options=[card.meaning].concat(wrong),order=shuffledIndexes(options.length),shuffled=order.map(index=>options[index]);
      return {itemIndex,card,options:shuffled,correct:shuffled.indexOf(card.meaning)};
    }).filter(Boolean);
    practiceSession.vocabularyQuiz={items,index:0,score:0,results:[],answered:false}; renderVocabularyQuiz();
  }

  function renderVocabularyQuiz() {
    const quiz=practiceSession.vocabularyQuiz,item=quiz?.items?.[quiz.index]; if (!item) return renderVocabularyQuizResult();
    quiz.answered=false;
    $('#vocabularySummary').html(`<span class="section-kicker">FLASHCARD CHECK</span><div class="vocabulary-quiz-progress"><strong>Question ${quiz.index+1} / ${quiz.items.length}</strong><span>Score: ${quiz.score} / ${quiz.index}</span></div><h2>What does “${escapeHtml(item.card.word)}” mean?</h2><p class="vocabulary-quiz-example">${escapeHtml(item.card.example)}</p><div class="answer-list vocabulary-quiz-options">${choiceButtons(item.options,item.correct)}</div><div class="exercise-feedback vocabulary-quiz-feedback"></div><button class="primary-btn wide vocabulary-quiz-next hidden">${quiz.index>=quiz.items.length-1?'Xem điểm →':'Câu tiếp theo →'}</button>`).removeClass('hidden');
  }

  function renderVocabularyQuizResult() {
    const quiz=practiceSession.vocabularyQuiz,total=quiz?.items?.length||0,score=Number(quiz?.score)||0,percent=total?Math.round(score/total*100):0,passed=percent>=80;
    $('#vocabularySummary').html(`<img class="summary-mascot" src="assets/mochi.png" alt="Mochi"><span class="section-kicker">KẾT QUẢ FLASHCARD CHECK</span><h2>${passed?'Bạn đã nắm vững bộ từ!':'Hãy ôn lại những từ chưa chắc'}</h2><div class="summary-score"><div><strong>${score}/${total}</strong><span>ĐÚNG</span></div><div><strong>${percent}%</strong><span>ĐIỂM</span></div><div><strong>${total-score}</strong><span>CẦN ÔN</span></div></div><div class="summary-actions"><button class="secondary-btn retry-vocabulary-quiz">↻ Làm lại bài kiểm tra</button><button class="primary-btn session-restart" data-type="vocabulary">Ôn bộ flashcard mới →</button></div>`);
    if (passed) confetti(); saveState(true);
  }

  function englishVoices() {
    if (!('speechSynthesis' in window)) return [];
    return speechSynthesis.getVoices().filter(voice=>/^en(?:-|_)/i.test(voice.lang||''));
  }

  function populateVoiceSettings() {
    const $select=$('#settingVoice'); if (!$select.length) return;
    const voices=englishVoices(),selected=String(state.voiceName||'');
    $select.html('<option value="">Giọng mặc định của thiết bị</option>'+voices.map(voice=>`<option value="${escapeHtml(voice.name)}">${escapeHtml(voice.name)} · ${escapeHtml(voice.lang)}</option>`).join('')).val(voices.some(voice=>voice.name===selected)?selected:'');
  }

  function inferredVoiceGender(voice) {
    const name=String(voice?.name||'').toLowerCase();
    if (/female|zira|samantha|victoria|karen|moira|tessa|susan|aria|jenny|emma|ava|allison|serena|hazel|salli/.test(name)) return 'female';
    if (/male|david|mark|daniel|george|james|ryan|guy|christopher|thomas|fred|aaron|arthur/.test(name)) return 'male';
    return '';
  }

  function speakerGender(name) {
    return /^(mia|anna|linh|emma|sarah|jenny|mary|lisa|olivia|ava|sophia|chloe|woman|female)$/i.test(String(name||'').trim())?'female':'male';
  }

  function selectDialogueVoice(gender,voices,used) {
    const preferred=voices.find(voice=>voice.name===state.voiceName&&inferredVoiceGender(voice)===gender&&!used.has(voice.name));
    return preferred||voices.find(voice=>inferredVoiceGender(voice)===gender&&!used.has(voice.name))||voices.find(voice=>!used.has(voice.name))||voices[0]||null;
  }

  function speechUtterance(text,rateMultiplier,voice,pitch) {
    const utterance=new SpeechSynthesisUtterance(text);
    const voices=englishVoices(),preferred=voices.find(value=>value.name===state.voiceName),fallback=voices.find(value=>/^en-(US|GB)$/i.test(value.lang))||voices[0]||null;
    utterance.voice=voice||preferred||fallback; utterance.lang=utterance.voice?.lang||'en-US'; utterance.rate=Math.max(.5,Math.min(1.4,Number(state.speechRate)||.9))*(Number(rateMultiplier)||1); utterance.pitch=Number(pitch)||1;
    return utterance;
  }

  function speak(text,rateMultiplier) {
    if (!('speechSynthesis' in window)) return toast('Trình duyệt chưa hỗ trợ đọc văn bản.', 'error');
    speechPlaybackToken++; speechSynthesis.cancel(); const utterance=speechUtterance(text,rateMultiplier); speechSynthesis.speak(utterance); return utterance;
  }

  function speakDialogue(text,rateMultiplier) {
    if (!('speechSynthesis' in window)) return toast('Trình duyệt chưa hỗ trợ đọc văn bản.', 'error');
    const segments=String(text||'').split(/\n+/).map(line=>{ const match=line.match(/^\s*([^:]{1,24}):\s*(.+)$/); return match?{speaker:match[1].trim(),text:match[2].trim()}:null; }).filter(Boolean);
    if (segments.length<2||new Set(segments.map(segment=>segment.speaker.toLowerCase())).size<2) return speak(text,rateMultiplier);
    const playbackToken=++speechPlaybackToken; speechSynthesis.cancel(); const controller={onend:null};
    const begin=(attempt)=>{
      if (playbackToken!==speechPlaybackToken) return;
      const voices=englishVoices();
      if (!voices.length&&attempt<8) return setTimeout(()=>begin(attempt+1),120);
      const used=new Set(),voiceBySpeaker={};
      segments.forEach(segment=>{ const key=segment.speaker.toLowerCase(); if (!voiceBySpeaker[key]) { const gender=speakerGender(segment.speaker),voice=selectDialogueVoice(gender,voices,used); voiceBySpeaker[key]={voice,gender}; if (voice) used.add(voice.name); } });
      let index=0;
      const playNext=()=>{
        if (playbackToken!==speechPlaybackToken) return;
        if (index>=segments.length) { if (typeof controller.onend==='function') controller.onend(); return; }
        const segment=segments[index++],profile=voiceBySpeaker[segment.speaker.toLowerCase()],female=profile.gender==='female',pitch=female?1.2:.8,roleRate=female?1.04:.93,utterance=speechUtterance(segment.text,(Number(rateMultiplier)||1)*roleRate,profile.voice,pitch);
        utterance.onend=()=>setTimeout(playNext,120); utterance.onerror=()=>setTimeout(playNext,80); speechSynthesis.speak(utterance);
      };
      playNext();
    };
    begin(0); return controller;
  }

  function spokenContentCoverage(target,spoken) {
    const tokens=value=>String(value||'').toLowerCase().replace(/[^a-z0-9'\s]/g,' ').split(/\s+/).filter(Boolean),expected=tokens(target),actual=tokens(spoken);
    if (!expected.length||!actual.length) return 0;
    const table=Array.from({length:expected.length+1},()=>Array(actual.length+1).fill(0));
    for (let i=1;i<=expected.length;i++) for (let j=1;j<=actual.length;j++) table[i][j]=expected[i-1]===actual[j-1]?table[i-1][j-1]+1:Math.max(table[i-1][j],table[i][j-1]);
    return Math.round(table[expected.length][actual.length]/expected.length*100);
  }

  function toast(message, type) {
    const $toast = $('<div>', { class:'toast ' + (type || ''), text:message }).appendTo('#toastStack');
    setTimeout(() => $toast.fadeOut(250, () => $toast.remove()), 3000);
  }

  function addXp(amount, minutes) {
    state.xp += amount; state.minutesWeek += minutes || 0;
    const day = (new Date().getDay() + 6) % 7;
    state.week[day] = (state.week[day] || 0) + (minutes || 0);
    saveState(true); toast(`+${amount} XP! Tiến bộ tuyệt vời ✨`, 'success');
  }

  async function getStatus() {
    const configured = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(APPS_SCRIPT_URL);
    if (configured) {
      try {
        await initBridge();
        const status = await bridgeCall('status',{});
        if (!status.ok) throw new Error(status.error || 'Apps Script chưa sẵn sàng.');
        serverStatus = { gemini:!!status.gemini, sheets:true, mode:'bridge', model:status.model || '' };
        renderConnectionStatus(); setAuthSystemState('ready','Hệ thống tài khoản đã sẵn sàng');
        await restoreAuth(); return;
      } catch (error) {
        serverStatus = { gemini:false, sheets:false, mode:'bridge', model:'' };
        renderConnectionStatus(error.message); setAuthSystemState('error',error.message); showAuthMessage(error.message); return;
      }
    }
    renderConnectionStatus('Chủ ứng dụng chưa cấu hình Apps Script URL.');
    setAuthSystemState('error','Chưa cấu hình Apps Script URL');
  }

  function renderConnectionStatus(error) {
    $('#aiStatus').toggleClass('offline', !serverStatus.gemini).find('span').text(serverStatus.gemini ? 'Gemini AI · Kết nối bảo mật' : 'Gemini chưa được cấu hình trên máy chủ');
    $('#syncState').toggleClass('active', !!serverStatus.sheets).text(serverStatus.sheets ? 'Đã kết nối' : 'Cục bộ');
    $('#syncDescription').text(serverStatus.sheets ? 'Tiến độ được lưu cục bộ và đồng bộ bảo mật với Google Sheets.' : 'Tiến độ đang được lưu trên thiết bị; kết nối hệ thống chưa sẵn sàng.');
  }

  function setAuthSystemState(type,message) {
    $('#authSystemState').attr('class','auth-system-state '+(type||'')).find('span').text(message);
  }

  function showAuthMessage(message,type) {
    $('#authMessage').attr('class','auth-message show '+(type||'')).text(message);
  }
  function clearAuthMessage() { $('#authMessage').removeClass('show success').text(''); }

  async function restoreAuth() {
    if (!currentSessionToken) { showAuthGate(); return; }
    setAuthSystemState('','Đang khôi phục phiên đăng nhập...');
    try {
      const result=await bridgeCall('restore',{});
      if (!result.ok) throw new Error(result.error || 'Phiên đăng nhập đã hết hạn.');
      completeAuth(result,false); setAuthSystemState('ready','Đã đăng nhập an toàn');
    } catch (_) {
      localStorage.removeItem(SESSION_TOKEN_KEY); currentSessionToken=''; showAuthGate();
      setAuthSystemState('ready','Hệ thống sẵn sàng · Vui lòng đăng nhập');
    }
  }

  function chooseProgress(userId,remote,isNewAccount) {
    const local=readJsonStorage(USER_STORAGE_PREFIX+userId);
    const legacy=isNewAccount ? readJsonStorage(LEGACY_STORAGE_KEY) : null;
    let selected=remote || local || legacy || {};
    if (remote && local) {
      const remoteTime=Date.parse(remote.syncedAt||remote.updatedAt||0)||0;
      const localTime=Date.parse(local.updatedAt||0)||0;
      selected=localTime>remoteTime ? local : remote;
    }
    const merged=$.extend(true,{},defaults,selected);
    ['completedToday','completedLessons','week','mistakes','visitDates'].forEach(key=>{ if (Array.isArray(selected[key])) merged[key]=selected[key].slice(); });
    if ((merged.completedLessons||[]).some(value=>typeof value==='number')) merged.completedLessons=merged.completedLessons.map(value=>typeof value==='number'?'A1-'+Math.max(0,value-1):String(value));
    merged.practiceStats=$.extend(true,{},defaults.practiceStats,merged.practiceStats||{});
    return merged;
  }

  function completeAuth(result,isNewAccount) {
    if (result.sessionToken) { currentSessionToken=result.sessionToken; localStorage.setItem(SESSION_TOKEN_KEY,currentSessionToken); }
    authUser=result.user;
    state=chooseProgress(authUser.userId,result.progress,isNewAccount);
    state.userId=authUser.userId; state.username=authUser.username||''; state.name=authUser.name; state.email=authUser.email;
    if (state.lastActive!==todayKey()) state.completedToday=[];
    startActivityTracking();
    localStorage.setItem(USER_STORAGE_PREFIX+state.userId,JSON.stringify(state));
    resetGoalDrivenSessions(); renderState(); populateTopicSelect('#vocabularyTopicSelect',state.vocabularyTopic||'all'); populateTopicSelect('#challengeTopicSelect',state.challengeTopic||'all'); renderRoadmap(state.level); updateFlashcard(); renderPractice($('.practice-tab.active').data('practice')||'listening');
    $('#authGate').addClass('hidden').attr('aria-hidden','true'); clearAuthMessage();
    setTimeout(() => syncProgress(false),250);
    if (isNewAccount) toast('Chào mừng bạn đến với FluentGo! ✨','success');
  }

  function showAuthGate(message) {
    stopActivityTracking();
    stopChatDictation();
    authUser=null; state=$.extend(true,{},defaults); conversation.active=false; conversation.history=[]; conversation.turns=0;
    $('#conversationRoom').addClass('hidden'); $('#conversationSetup').removeClass('hidden'); $('#chatMessages,#quickReplies').empty();
    $('#authGate').removeClass('hidden').attr('aria-hidden','false');
    if (message) showAuthMessage(message);
    $('#loginPassword,#registerPassword').val('');
  }

  async function logout() {
    const token=currentSessionToken;
    currentSessionToken=''; localStorage.removeItem(SESSION_TOKEN_KEY);
    showAuthGate(); setAuthSystemState('ready','Đã đăng xuất · Hệ thống sẵn sàng');
    if (token) try {
      currentSessionToken=token; await bridgeCall('logout',{});
    } catch (_) { /* Phiên cục bộ vẫn được xóa */ }
    finally { currentSessionToken=''; }
  }

  function initBridge() {
    if (bridgeReady) return Promise.resolve();
    return new Promise((resolve,reject) => {
      const timeout=setTimeout(() => reject(new Error('Không thể kết nối Apps Script. Hãy kiểm tra deployment URL và quyền Anyone.')),15000);
      const readyHandler=event => {
        if (!isTrustedBridgeEvent(event)) return;
        if (event.data.type==='boot') { bridgeMessageWindow=event.source; bridgeMessageWindow.postMessage({source:'fluentgo-parent',type:'ping'},'*'); }
        if (event.data.type==='ready' && event.source===bridgeMessageWindow) { clearTimeout(timeout); bridgeReady=true; window.removeEventListener('message',readyHandler); resolve(); }
      };
      window.addEventListener('message',readyHandler);
      if (!bridgeFrame) {
        bridgeFrame=document.createElement('iframe'); bridgeFrame.hidden=true; bridgeFrame.title='FluentGo secure connection';
        bridgeFrame.src=APPS_SCRIPT_URL+(APPS_SCRIPT_URL.includes('?')?'&':'?')+'bridge=1&v='+Date.now(); document.body.appendChild(bridgeFrame);
      } else if (bridgeMessageWindow) bridgeMessageWindow.postMessage({source:'fluentgo-parent',type:'ping'},'*');
    });
  }

  function isTrustedBridgeEvent(event) {
    if (event.data?.source!=='fluentgo-bridge') return false;
    try { const host=new URL(event.origin).hostname; return host==='script.google.com' || host.endsWith('.googleusercontent.com') || host==='googleusercontent.com'; }
    catch (_) { return false; }
  }

  window.addEventListener('message',event => {
    if (!bridgeMessageWindow || event.source!==bridgeMessageWindow || !isTrustedBridgeEvent(event) || event.data.type!=='response') return;
    const pending=bridgeRequests.get(event.data.id); if (!pending) return;
    clearTimeout(pending.timeout); bridgeRequests.delete(event.data.id); pending.resolve(event.data.result || {ok:false,error:'Phản hồi trống.'});
  });

  function bridgeCall(action,payload) {
    if (!bridgeReady || !bridgeMessageWindow) return Promise.reject(new Error('Apps Script chưa kết nối.'));
    return new Promise((resolve,reject) => {
      const id='req_'+Date.now()+'_'+(++bridgeSequence);
      const timeout=setTimeout(() => { bridgeRequests.delete(id); reject(new Error('Apps Script phản hồi quá thời gian.')); },90000);
      bridgeRequests.set(id,{resolve,reject,timeout});
      bridgeMessageWindow.postMessage({source:'fluentgo-parent',type:'request',id,action,payload,sessionToken:currentSessionToken},'*');
    });
  }

  async function askGemini(mode, input, context, extra) {
    if (!bridgeReady || !serverStatus.gemini) throw new Error('Gemini chưa sẵn sàng trên Apps Script. Hãy kiểm tra FluentGo Config.');
    if (!authUser || !currentSessionToken) throw new Error('Vui lòng đăng nhập để sử dụng Gemini AI.');
    if (aiRequestInFlight) throw new Error('Mochi đang xử lý một yêu cầu khác. Vui lòng chờ một chút.');
    const cooldownRemaining=1800-(Date.now()-lastAiRequestAt);
    if (cooldownRemaining>0) await new Promise(resolve=>setTimeout(resolve,cooldownRemaining));
    aiRequestInFlight=true;
    try {
      const curriculumContext='Learning goal: '+currentGoal().name+'. Current roadmap topic: '+(CURRICULUM?.getRoadmap(currentGoalId(),state.level)?.[Number(state.roadmapUnit)||0]?.title||'general')+'. ';
      const payload={mode:mode,input:input,context:curriculumContext+(context||''),level:state.level};
      if (mode==='speaking' && extra?.audioData) {
        payload.audioData=extra.audioData;
        payload.audioMime=extra.audioMime || 'audio/webm';
      }
      const result=await bridgeCall('gemini',payload);
      if (!result || !result.ok) throw new Error(result?.error || 'Gemini chưa thể xử lý yêu cầu.');
      return normalizeAiResponse(result);
    } finally { aiRequestInFlight=false; lastAiRequestAt=Date.now(); }
  }

  function showAiFeedback(selector, data, kind) {
    const score = Math.max(0, Math.min(100, Number(data.score) || 75));
    const title = data.title || (score >= 80 ? 'Làm rất tốt!' : 'Bạn đang tiến bộ!');
    const strengths = Array.isArray(data.strengths) ? data.strengths.join(' · ') : (data.strengths || 'Ý tưởng rõ ràng và đúng chủ đề.');
    const improvements = Array.isArray(data.improvements) ? data.improvements.join(' · ') : (data.improvements || 'Thử nói hoặc viết chậm và rõ hơn.');
    const corrected = data.corrected || data.better_version || '';
    const pronunciation = data.pronunciation || '';
    const speechMetrics=kind==='speech'?[['Đủ nội dung',data.contentScore],['Phát âm',data.pronunciationScore],['Trôi chảy',data.fluencyScore]].filter(metric=>Number.isFinite(Number(metric[1]))):[];
    const metricsHtml=speechMetrics.length?`<div class="speech-score-grid">${speechMetrics.map(metric=>`<div><strong>${Math.round(Number(metric[1]))}</strong><span>${escapeHtml(metric[0])}</span></div>`).join('')}</div>`:'';
    const html = `<div class="feedback-score"><span class="score-circle">${score}</span><div><h4>✦ ${escapeHtml(title)}</h4><p>Nhận xét bởi Gemini AI</p></div></div>
      ${metricsHtml}
      <div class="feedback-section"><strong>Điểm tốt</strong>${escapeHtml(strengths)}</div>
      <div class="feedback-section"><strong>Cần cải thiện</strong>${escapeHtml(improvements)}</div>
      ${corrected ? `<div class="feedback-section"><strong>${kind === 'speech' ? 'Câu gợi ý' : 'Bản chỉnh sửa'}</strong>${escapeHtml(corrected)}</div>` : ''}
      ${pronunciation ? `<div class="feedback-section"><strong>Mẹo phát âm</strong>${escapeHtml(pronunciation)}</div>` : ''}`;
    $(selector).html(html).addClass('show');
  }
  function showLoading(selector, text) { $(selector).html(`<div class="feedback-loading"><i></i><span>${escapeHtml(text)}</span></div>`).addClass('show'); }

  function progressFingerprint() {
    const copy={...state}; delete copy.updatedAt; delete copy.syncedAt;
    return JSON.stringify(copy);
  }

  function scheduleProgressSync(delay) {
    if (!serverStatus.sheets || !authUser) return;
    clearTimeout(syncTimer); syncTimer=setTimeout(() => syncProgress(false),delay||6500);
  }

  async function syncProgress(showMessage) {
    if (!serverStatus.sheets) { if (showMessage) toast('Hệ thống Google Sheets chưa được quản trị viên cấu hình. Tiến độ vẫn được lưu trên máy.', 'error'); return; }
    const fingerprint=progressFingerprint();
    if (!showMessage && fingerprint===lastSyncedFingerprint) return;
    if (syncInFlight) { syncPending=true; return; }
    syncInFlight=true; clearTimeout(syncTimer);
    $('#syncState').text('Đang đồng bộ...');
    try {
      let response;
      if (serverStatus.mode === 'server') response = await $.ajax({ url:'/api/sync', method:'POST', contentType:'application/json', data:JSON.stringify({ ...state, syncedAt:new Date().toISOString() }), timeout:20000 });
      else response=await bridgeCall('sync',{...state,syncedAt:new Date().toISOString()});
      if (response.ok===false) { expireSessionIfNeeded(response.error); throw new Error(response.error || 'Google Sheets không thể lưu tiến độ.'); }
      lastSyncedFingerprint=fingerprint;
      $('#syncState').addClass('active').text('Đã đồng bộ');
      if (showMessage) toast(response.message || 'Đã đồng bộ Google Sheets!', 'success');
    } catch (error) {
      $('#syncState').removeClass('active').text('Lỗi đồng bộ');
      if (showMessage) toast(error.responseJSON?.error || error.message || 'Không thể đồng bộ Google Sheets.', 'error');
    } finally { syncInFlight=false; if (syncPending) { syncPending=false; scheduleProgressSync(1800); } }
  }

  function expireSessionIfNeeded(message) {
    if (!/Phiên đăng nhập|Tài khoản không còn hoạt động/i.test(String(message||''))) return;
    currentSessionToken=''; localStorage.removeItem(SESSION_TOKEN_KEY);
    showAuthGate('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    setAuthSystemState('ready','Hệ thống sẵn sàng · Vui lòng đăng nhập');
  }

  let lessonSteps=[];
  let lessonCheckpoint=false,lessonCheckpointScore=0,lessonCheckpointAnswered=0;

  function lessonOptions(correct,distractors,seed) {
    const unique=[correct].concat(distractors||[]).filter((value,index,values)=>value&&values.indexOf(value)===index).slice(0,4);
    const order=seededIndexes(unique.length,seed); return order.map(index=>unique[index]);
  }

  function dedicatedLessonContent(level,unit,unitIndex,lessonIndex,attempt) {
    const all=CURRICULUM.getVocabulary(currentGoalId(),level,'all'),offset=(unitIndex*2+lessonIndex*3+attempt*5)%all.length;
    const cards=Array.from({length:6},(_,index)=>all[(offset+index)%all.length]),names=['Noah','Olivia','Ethan','Ava','Lucas','Sophia'],speakerA=names[(unitIndex+attempt)%names.length],speakerB=names[(unitIndex+attempt+3)%names.length];
    const option=(correct,values,seed)=>lessonOptions(correct,values,stableHash(currentGoalId()+'|'+level+'|'+unitIndex+'|'+lessonIndex+'|'+attempt+'|'+seed));
    const choice=(type,title,question,correct,distractors,extra,seed)=>{ const options=option(correct,distractors,seed); return Object.assign({type:'choice',skill:type,emoji:{listening:'🎧',reading:'📖',vocabulary:'🧠',grammar:'🧩',writing:'✍️'}[type]||'✅',title,question,options,correct:options.indexOf(correct),explanation:'Review the clue in this lesson context, then say the complete English answer aloud.'},extra||{}); };
    const dialogue=`${speakerA}: I am preparing for ${unit.englishTitle.toLowerCase()}. ${cards[0].example}\n${speakerB}: That is useful. ${cards[1].example}\n${speakerA}: Great, I will write down the next step.`;
    const passage=`${speakerB} is practicing ${unit.englishTitle.toLowerCase()} in a new situation. ${cards[2].example} Then ${speakerB} uses “${cards[3].word}” to make the message clearer. Before finishing, ${speakerB} checks the result and explains the next step.`;
    const flash=card=>({type:'flashcard',skill:'vocabulary',emoji:card.icon,title:'Learn a word in context',word:card.word,phonetic:card.phonetic,meaning:card.meaning,example:card.example,vi:card.vi});
    const speak=card=>({type:'speak',skill:'speaking',emoji:'🎤',title:'Say it in your own voice',copy:'Listen once, then say the complete sentence with clear stress.',question:card.example});
    const write=(card,second)=>({type:'write',skill:'writing',emoji:'✍️',title:'Write a useful response',prompt:`Write ${level==='A1'?'2–3 sentences':'a connected response'} about ${unit.englishTitle.toLowerCase()}. Use “${card.word}”${second?' and “'+second.word+'”':''}.`,minWords:{A1:8,A2:15,B1:28,B2:40}[level]||8});
    return {cards,dialogue,passage,choice,flash,speak,write,option};
  }

  function buildCheckpointSteps(level,unit,unitIndex,attempt) {
    const bank=dedicatedLessonContent(level,unit,unitIndex,5,attempt),c=bank.cards,choice=bank.choice,otherUnits=CURRICULUM.getRoadmap(currentGoalId(),level).filter(value=>value.id!==unit.id),readingTwo=`${bank.passage} ${c[4].example}`;
    return [
      choice('listening','Listen · main action',`During the “${c[0].word}” mission, what action does the first speaker take at the end?`,'The speaker writes down the next step.',['The speaker cancels the plan.','The speaker leaves without a decision.','The speaker changes the topic completely.'],{audio:bank.dialogue},1),
      choice('listening','Listen · exact sentence',`Which complete sentence containing “${c[0].word}” is spoken?`,c[0].example,[c[2].example,c[4].example,`I never use ${c[0].word}.`],{audio:bank.dialogue},2),
      choice('listening','Listen · key word',`Which key word follows the “${c[1].meaning}” idea in the second speaker’s line?`,c[1].word,[c[3].word,c[5].word,c[0].word],{audio:bank.dialogue},3),
      choice('reading','Read · main idea',`After reading the “${c[2].word} / ${c[3].word}” situation, what topic is the learner mainly practicing?`,unit.englishTitle,otherUnits.slice(0,3).map(value=>value.englishTitle),{copy:bank.passage},4),
      choice('reading','Read · evidence','Which statement is supported by the passage?',c[2].example,[c[0].example,c[5].example,'The learner refuses to check the result.'],{copy:bank.passage},5),
      choice('reading','Read · detail',`Before finishing the “${c[4].word}” task, what does the learner do?`,'Checks the result and explains the next step.',['Starts a completely different task.','Deletes every note immediately.','Waits without taking action.'],{copy:readingTwo},6),
      choice('vocabulary','Flashcard check',`What does “${c[0].word}” mean?`,c[0].meaning,[c[2].meaning,c[4].meaning,c[5].meaning],{},7),
      choice('vocabulary','Word in context',`Which word completes: “${c[1].example.replace(new RegExp(c[1].word,'i'),'_____')}”`,c[1].word,[c[3].word,c[5].word,c[0].word],{},8),
      choice('vocabulary','Choose the useful phrase','Which sentence correctly uses the lesson vocabulary?',c[4].example,[`She ${c[4].word} is every day.`,`He can ${c[4].word}s it.`,c[2].example],{},9),
      choice('grammar','Grammar in context','Choose the clearest complete English sentence.',c[3].example,[`Is ${c[3].example.toLowerCase()}`,c[3].example.replace(/\.$/,'')+' yesterday every day.',`Very ${c[3].word} the task.`],{},10),
      choice('grammar','Build the sentence',`Choose the correct order: ${c[5].example.replace(/[.!?]/g,'').split(' ').reverse().join(' / ')}`,c[5].example,[c[0].example,c[5].example.split(' ').reverse().join(' '),c[2].example],{},11),
      {type:'write-check',skill:'writing',emoji:'✍️',title:'Write the missing word',prompt:c[0].example.replace(new RegExp(c[0].word,'i'),'_____'),answer:c[0].word,hint:'Type one English word from this chặng.'},
      {type:'write-check',skill:'writing',emoji:'⌨️',title:'Complete the second sentence',prompt:c[1].example.replace(new RegExp(c[1].word,'i'),'_____'),answer:c[1].word,hint:'Spelling counts. Type the missing English word.'},
      Object.assign(bank.speak(c[2]),{checkpoint:true,title:'Speaking check · sentence 1'}),
      Object.assign(bank.speak(c[3]),{checkpoint:true,title:'Speaking check · sentence 2'})
    ].map((step,index)=>Object.assign(step,{checkpoint:true,questionNumber:index+1,attempt}));
  }

  function buildLessonSteps(level,index,unitIndex) {
    const unit=CURRICULUM?.getRoadmap(currentGoalId(),level)?.[unitIndex||0],lesson=unit?.lessons?.[index];
    if (!unit||!lesson) return [{type:'intro',emoji:'🚀',title:'English lesson',copy:'Practice English in context.'},{type:'complete',emoji:'✨',title:'Lesson complete!',copy:'Keep going.'}];
    const intro={type:'intro',emoji:['📘','🎧','📖','🧩','🎤','🏆'][index]||'🚀',title:lesson.title,copy:`${unit.englishTitle} · ${level} · ${lesson.minutes} minutes`,outcomes:unit.guidebook.outcomes};
    const complete={type:'complete',emoji:'✨',title:`${lesson.title} complete!`,copy:'You used English to understand and respond. The next lesson is ready.'};
    const checkpointKey=[currentGoalId(),level,unitIndex].join(':'),attempt=index===5?Number(state.checkpointAttempts?.[checkpointKey]||1):0,bank=dedicatedLessonContent(level,unit,unitIndex,index,attempt),c=bank.cards,choice=bank.choice;
    if (index===5) return [Object.assign({},intro,{copy:`15-question checkpoint · Attempt ${attempt}`,outcomes:['Complete listening, speaking, reading, writing and flashcard tasks','Score at least 70% to pass the chặng','A new set is created every time you enter']})].concat(buildCheckpointSteps(level,unit,unitIndex,attempt),[Object.assign({},complete,{checkpoint:true,title:'Checkpoint complete'})]);
    const plans=[
      [bank.flash(c[0]),bank.flash(c[1]),choice('vocabulary','Recognize the meaning',`What does “${c[0].word}” mean?`,c[0].meaning,[c[2].meaning,c[4].meaning,c[5].meaning],{},1),choice('grammar','Complete a new sentence',c[1].example.replace(new RegExp(c[1].word,'i'),'_____'),c[1].word,[c[3].word,c[5].word,c[0].word],{},2),bank.speak(c[0]),bank.write(c[1],c[0])],
      [choice('listening','Follow a new conversation','Why does the first speaker write something down?','To remember the next step.',['To cancel the discussion.','To change the subject.','To avoid the task.'],{audio:bank.dialogue},3),choice('listening','Catch the exact phrase','Which sentence do you hear?',c[1].example,[c[3].example,c[5].example,c[0].example],{audio:bank.dialogue},4),bank.flash(c[1]),bank.speak(c[0]),choice('vocabulary','Listening vocabulary','Which word did the second speaker use?',c[1].word,[c[2].word,c[4].word,c[5].word],{audio:bank.dialogue},5),bank.write(c[0])],
      [choice('reading','Read a fresh situation','What is the learner trying to make clearer?','The message.',['The weather forecast.','A restaurant menu.','A train ticket.'],{copy:bank.passage},6),choice('reading','Find textual evidence','What happens before the learner finishes?','The learner checks the result.',['The learner starts another course.','The learner deletes the message.','The learner ignores the result.'],{copy:bank.passage},7),bank.flash(c[2]),choice('vocabulary','Vocabulary from the story','Which word appears in the reading?',c[3].word,[c[0].word,c[4].word,c[5].word],{copy:bank.passage},8),bank.speak(c[2]),bank.write(c[3])],
      [choice('grammar','Choose natural English','Which sentence is complete and natural?',c[0].example,[`She ${c[0].word} is every day.`,`He can ${c[0].word}s it.`,c[0].example.split(' ').reverse().join(' ')],{},9),choice('grammar','Word order challenge',`Choose the correct order: ${c[1].example.replace(/[.!?]/g,'').split(' ').reverse().join(' / ')}`,c[1].example,[c[1].example.split(' ').reverse().join(' '),c[3].example,c[5].example],{},10),bank.flash(c[4]),bank.speak(c[1]),bank.write(c[0],c[1]),choice('listening','Grammar by ear','Which complete sentence sounds correct?',c[4].example,[`Is ${c[4].example.toLowerCase()}`,`Very ${c[4].word} the task.`,c[2].example],{audio:c[4].example},11)],
      [bank.speak(c[0]),bank.write(c[0],c[1]),choice('listening','Respond after listening','Which reply best continues the conversation?',c[2].example,[c[4].example,c[5].example,'I do not understand any word.'],{audio:bank.dialogue},12),bank.flash(c[3]),choice('reading','Read before you respond','Which sentence gives a useful next action?',c[5].example,[c[1].example,c[3].example,'There is no action to take.'],{copy:bank.passage},13),bank.speak(c[5])]
    ];
    return [intro].concat(plans[index]||plans[0],[complete]);
  }

  function openLesson(index,level,unitIndex) {
    level=typeof level==='string'?level:state.level; unitIndex=Number.isInteger(unitIndex)?unitIndex:Number(state.roadmapUnit)||0;
    const curriculumUnit=CURRICULUM?.getRoadmap(currentGoalId(),level)?.[unitIndex],items=curriculumUnit?.lessons||(roadmapData[level]||roadmapData.A1);
    if (!Number.isInteger(index)) { const completed=new Set(state.completedLessons||[]),next=items.findIndex((item,i)=>!completed.has(item.id||level+'-'+i)); index=next<0?items.length-1:next; }
    const selected=items[index]; state.roadmapUnit=unitIndex; activeRoadmapLesson={level,index,unit:unitIndex,id:selected.id||level+'-'+index,title:selected.title||selected[0]}; lessonCheckpoint=index===5; lessonCheckpointScore=0; lessonCheckpointAnswered=0;
    if (lessonCheckpoint) { const key=[currentGoalId(),level,unitIndex].join(':'); state.checkpointAttempts=state.checkpointAttempts||{}; state.checkpointAttempts[key]=Number(state.checkpointAttempts[key]||0)+1; localStorage.setItem(USER_STORAGE_PREFIX+state.userId,JSON.stringify(state)); }
    if (state.level!==level) { state.level=level; state.memoryIndex=0; saveState(true); renderState(); updateFlashcard(); }
    lessonSteps=buildLessonSteps(level,index,unitIndex); currentLessonStep=0; selectedLessonAnswer=null; renderLesson(); $('#lessonModal').addClass('open').attr('aria-hidden','false'); $('body').css('overflow','hidden');
  }
  function closeLesson() { $('#lessonModal').removeClass('open').attr('aria-hidden','true'); $('body').css('overflow',''); }
  function renderLesson() {
    const step = lessonSteps[currentLessonStep];
    $('#lessonProgressBar').css('width', ((currentLessonStep + 1) / lessonSteps.length * 100) + '%');
    $('#lessonStepLabel').text((currentLessonStep + 1) + ' / ' + lessonSteps.length);
    let body = '';
    if (step.type === 'intro') body = `<div class="lesson-screen"><div class="lesson-emoji">${step.emoji}</div><h2>${escapeHtml(step.title)}</h2><p>${escapeHtml(step.copy)}</p><div class="lesson-question"><strong>By the end of this lesson, you can:</strong>${(step.outcomes||[]).map(outcome=>`<p>✓ ${escapeHtml(outcome)}</p>`).join('')}</div><div class="lesson-nav"><button class="primary-btn lesson-next">Start lesson →</button></div></div>`;
    if (step.type === 'choice') body = `<div class="lesson-screen"><div class="lesson-emoji">${step.emoji}</div><h2>${escapeHtml(step.title)}</h2>${step.audio?'<button class="lesson-audio">▶ Listen</button>':''}${step.copy?`<div class="lesson-passage">${escapeHtml(step.copy)}</div>`:''}<div class="lesson-question"><strong>${escapeHtml(step.question)}</strong></div><div class="lesson-options">${step.options.map((o,i)=>`<button data-answer="${i}" data-correct="${i===step.correct}">${String.fromCharCode(65+i)}. ${escapeHtml(o)}</button>`).join('')}</div><div class="lesson-nav"><button class="primary-btn lesson-check" disabled>Check answer</button></div></div>`;
    if (step.type === 'flashcard') body = `<div class="lesson-screen"><div class="lesson-emoji">${step.emoji}</div><h2>${escapeHtml(step.title)}</h2><button class="lesson-flashcard" type="button"><span>${escapeHtml(step.word)}</span><small>${escapeHtml(step.phonetic)}</small><em>Tap to reveal</em><strong>${escapeHtml(step.meaning)}</strong><p>${escapeHtml(step.example)}</p><i>${escapeHtml(step.vi)}</i></button><div class="lesson-nav"><button class="secondary-btn lesson-sound" data-lesson-text="${escapeHtml(step.word)}">♫ Listen</button><button class="primary-btn lesson-next">Continue →</button></div></div>`;
    if (step.type === 'write') body = `<div class="lesson-screen"><div class="lesson-emoji">${step.emoji}</div><h2>${escapeHtml(step.title)}</h2><div class="lesson-question"><strong>${escapeHtml(step.prompt)}</strong></div><textarea class="lesson-writing" maxlength="600" placeholder="Write in English..."></textarea><div class="lesson-nav"><button class="primary-btn lesson-writing-done" data-min-words="${step.minWords||5}">Save response →</button></div></div>`;
    if (step.type === 'write-check') body = `<div class="lesson-screen"><div class="lesson-emoji">${step.emoji}</div><h2>${escapeHtml(step.title)}</h2><p>${escapeHtml(step.hint)}</p><div class="lesson-question"><strong>${escapeHtml(step.prompt)}</strong></div><input class="lesson-short-answer" autocomplete="off" placeholder="Type the missing word"><div class="lesson-nav"><button class="primary-btn lesson-write-check" disabled>Check writing</button></div></div>`;
    if (step.type === 'speak') body = `<div class="lesson-screen"><div class="lesson-emoji">${step.emoji}</div><h2>${escapeHtml(step.title)}</h2><p>${escapeHtml(step.copy)}</p><div class="lesson-question" style="text-align:center"><button class="tiny-sound lesson-sound">♫</button><h3>${escapeHtml(step.question)}</h3></div><div class="lesson-nav"><button class="secondary-btn lesson-sound">Listen again</button><button class="primary-btn ${step.checkpoint?'lesson-speak-done':'lesson-next'}">I said the full sentence →</button></div></div>`;
    if (step.type === 'complete') { const percent=lessonCheckpoint?Math.round(lessonCheckpointScore/15*100):100,passed=percent>=70; body = `<div class="lesson-screen lesson-complete"><img src="assets/mochi.png" class="mascot-img" alt="Mochi chúc mừng"><h2>${step.checkpoint?(passed?'Checkpoint passed!':'Keep practicing this chặng'):escapeHtml(step.title)}</h2><p>${step.checkpoint?'You answered '+lessonCheckpointScore+' of 15 tasks successfully.':escapeHtml(step.copy)}</p><div class="xp-earned">${step.checkpoint?percent+'%':'+25 XP'}</div><p>${step.checkpoint?'Listening · Speaking · Reading · Writing · Flashcards':'🔥 Không giới hạn số bài trong ngày'}</p><button class="primary-btn ${step.checkpoint&&!passed?'lesson-retry-checkpoint':'lesson-finish'}">${step.checkpoint&&!passed?'Try a fresh 15-question set →':'Nhận thưởng & mở bài tiếp'}</button></div>`; }
    $('#lessonContent').html(body);
  }
  function nextLesson() { currentLessonStep = Math.min(lessonSteps.length - 1, currentLessonStep + 1); selectedLessonAnswer = null; renderLesson(); }

  function setupRecognition() {
    speakingRecognitionCtor=window.SpeechRecognition||window.webkitSpeechRecognition||null;
  }

  function startSpeakingRecognitionCycle() {
    if (!speakingRecordingActive||!speakingRecognitionShouldRun||!speakingRecognitionCtor||recognition) return;
    const instance=new speakingRecognitionCtor();
    recognition=instance;
    instance.lang='en-US';
    instance.interimResults=true;
    instance.continuous=true;
    instance.maxAlternatives=1;
    instance.onstart=()=>setSpeakingRecordState(true,'Đang ghi liên tục... nhấn Stop khi nói xong');
    instance.onresult=event=>{
      let finalText='',interimText='';
      for (let i=0;i<event.results.length;i++) {
        const part=String(event.results[i][0]?.transcript||'').trim();
        if (!part) continue;
        if (event.results[i].isFinal) finalText+=(finalText?' ':'')+part;
        else interimText+=(interimText?' ':'')+part;
      }
      transcript=[speakingTranscriptBase,finalText,interimText].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
      $('#liveTranscript').text(transcript||'Đang nghe... bạn có thể tạm dừng rồi nói tiếp.');
    };
    instance.onerror=event=>{
      const error=String(event.error||'');
      if (error==='not-allowed'||error==='service-not-allowed') {
        speakingRecognitionShouldRun=false;
        $('#recordLabel').text('Đang ghi âm, nhưng chưa có quyền tạo transcript · nhấn Stop để dừng');
      } else if (error==='audio-capture') {
        toast('Không tìm thấy microphone.','error');
        stopSpeakingRecording();
      } else if (error!=='no-speech'&&error!=='aborted') {
        $('#recordLabel').text('Đang ghi âm · Mochi đang kết nối lại nhận diện giọng nói');
      }
    };
    instance.onend=()=>{
      if (recognition===instance) recognition=null;
      speakingTranscriptBase=transcript.trim();
      if (!speakingRecordingActive||!speakingRecognitionShouldRun) return;
      clearTimeout(speakingRecognitionRestartTimer);
      speakingRecognitionRestartTimer=setTimeout(startSpeakingRecognitionCycle,180);
    };
    try { instance.start(); }
    catch (_) {
      if (recognition===instance) recognition=null;
      if (speakingRecordingActive&&speakingRecognitionShouldRun) {
        clearTimeout(speakingRecognitionRestartTimer);
        speakingRecognitionRestartTimer=setTimeout(startSpeakingRecognitionCycle,350);
      }
    }
  }

  function stopSpeakingRecording(silent) {
    speakingRecordingActive=false;
    speakingRecognitionShouldRun=false;
    clearTimeout(speakingRecognitionRestartTimer);
    speakingRecognitionRestartTimer=null;
    const instance=recognition;
    recognition=null;
    if (instance) try { instance.stop(); } catch (_) { try { instance.abort(); } catch (__) {} }
    stopMediaCapture();
    setSpeakingRecordState(false,silent?'':(transcript?'Đã ghi nhận lời nói · sẵn sàng nhờ Gemini nhận xét':'Đã ghi âm · sẵn sàng nhờ Gemini nhận xét'));
    if (!silent) setTimeout(()=>$('#analyzeSpeech').toggleClass('hidden',!(transcript||recordedAudio)),220);
  }

  function setSpeakingRecordState(active,label) {
    $('#recordBtn').toggleClass('recording',!!active).attr({
      'aria-label':active?'Dừng ghi âm':'Bắt đầu ghi âm',
      'title':active?'Đang ghi liên tục · Nhấn Stop để dừng':'Bắt đầu ghi âm',
      'aria-pressed':String(!!active)
    }).find('span').text(active?'■':'●');
    if (label) $('#recordLabel').text(label);
  }

  async function startMediaCapture() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return;
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true } });
    const preferred = ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    mediaRecorder = new MediaRecorder(mediaStream, preferred ? { mimeType:preferred } : undefined);
    audioChunks = []; recordedAudio = null;
    mediaRecorder.ondataavailable = e => { if (e.data.size) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunks, { type:mediaRecorder.mimeType || 'audio/webm' });
      if (blob.size > 0 && blob.size < 6 * 1024 * 1024) {
        const reader = new FileReader();
        reader.onloadend = () => { recordedAudio = { audioData:String(reader.result).split(',')[1], audioMime:blob.type || 'audio/webm' }; $('#analyzeSpeech').removeClass('hidden'); };
        reader.readAsDataURL(blob);
      } else if (blob.size >= 6 * 1024 * 1024) toast('Bản ghi quá dài để gửi âm thanh; Mochi sẽ nhận xét dựa trên transcript.','error');
      if (transcript) $('#analyzeSpeech').removeClass('hidden');
    };
    mediaRecorder.start();
  }
  function stopMediaCapture() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (mediaStream) { mediaStream.getTracks().forEach(track => track.stop()); mediaStream = null; }
  }

  function startExamRecognitionCycle() {
    const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if (!examRecording||!Recognition||examRecognition) return;
    const instance=new Recognition(); examRecognition=instance; instance.lang='en-US'; instance.interimResults=true; instance.continuous=true; instance.maxAlternatives=1;
    instance.onresult=event=>{
      let finalText='',interimText='';
      for (let i=0;i<event.results.length;i++) {
        const part=String(event.results[i][0]?.transcript||'').trim(); if (!part) continue;
        if (event.results[i].isFinal) finalText+=(finalText?' ':'')+part; else interimText+=(interimText?' ':'')+part;
      }
      examTranscript=[examRecognitionBase,finalText,interimText].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
      $('#examTranscript').text(examTranscript||'Đang nghe... hãy đọc đầy đủ câu mẫu.');
    };
    instance.onerror=event=>{
      const error=String(event.error||'');
      if (['not-allowed','service-not-allowed'].includes(error)) $('#examRecordLabel').text('Đang ghi âm · trình duyệt chưa cấp quyền tạo transcript');
      else if (!['no-speech','aborted'].includes(error)) $('#examRecordLabel').text('Đang ghi âm · nhận diện giọng nói đang kết nối lại');
    };
    instance.onend=()=>{
      if (examRecognition===instance) examRecognition=null;
      examRecognitionBase=examTranscript.trim();
      if (examRecording) { clearTimeout(examRecognitionRestartTimer); examRecognitionRestartTimer=setTimeout(startExamRecognitionCycle,180); }
    };
    try { instance.start(); } catch (_) { examRecognition=null; if (examRecording) examRecognitionRestartTimer=setTimeout(startExamRecognitionCycle,350); }
  }

  async function startExamRecording() {
    if (examRecording) return;
    examTranscript=''; examRecognitionBase=''; examAudio=null; examChunks=[]; examAudioReady=Promise.resolve();
    const canRecognize=!!(window.SpeechRecognition||window.webkitSpeechRecognition),canRecord=!!(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder);
    if (!canRecognize&&!canRecord) throw new Error('Trình duyệt chưa hỗ trợ ghi hoặc nhận diện giọng nói.');
    if (canRecord) {
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}}); examStream=stream;
      const preferred=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type)),recorder=new MediaRecorder(stream,preferred?{mimeType:preferred}:undefined); examRecorder=recorder;
      examAudioReady=new Promise(resolve=>{
        recorder.ondataavailable=event=>{ if (event.data.size) examChunks.push(event.data); };
        recorder.onstop=()=>{
          const blob=new Blob(examChunks,{type:recorder.mimeType||'audio/webm'});
          if (!blob.size||blob.size>=6*1024*1024) { if (blob.size>=6*1024*1024) toast('Bản ghi quá dài; phần nói sẽ được chấm theo transcript.','error'); resolve(); return; }
          const reader=new FileReader(); reader.onloadend=()=>{ examAudio={audioData:String(reader.result).split(',')[1],audioMime:blob.type||'audio/webm'}; resolve(); }; reader.onerror=()=>resolve(); reader.readAsDataURL(blob);
        };
      });
      recorder.start();
    }
    examRecording=true; startExamRecognitionCycle();
    $('.exam-record-btn').addClass('recording').attr('aria-pressed','true').find('span').text('■'); $('#examRecordLabel').text('Đang ghi liên tục · nhấn Stop khi nói xong'); $('#examTranscript').text('Đang nghe...'); $('#gradeExamSpeaking').addClass('hidden');
  }

  async function stopExamRecording(silent) {
    examRecording=false; clearTimeout(examRecognitionRestartTimer); examRecognitionRestartTimer=null;
    const recognitionInstance=examRecognition; examRecognition=null; if (recognitionInstance) try { recognitionInstance.stop(); } catch (_) { try { recognitionInstance.abort(); } catch (__) {} }
    const recorder=examRecorder,stream=examStream,audioReady=examAudioReady; examRecorder=null; examStream=null;
    if (recorder&&recorder.state!=='inactive') try { recorder.stop(); } catch (_) {}
    if (stream) stream.getTracks().forEach(track=>track.stop());
    if (audioReady) try { await audioReady; } catch (_) {}
    $('.exam-record-btn').removeClass('recording').attr('aria-pressed','false').find('span').text('●');
    if (!silent) { $('#examRecordLabel').text(examTranscript?'Đã ghi nhận lời nói · sẵn sàng chấm điểm':'Đã ghi âm · sẵn sàng chấm điểm'); $('#gradeExamSpeaking').toggleClass('hidden',!(examTranscript||examAudio)); }
  }

  function bindEvents() {
    $(document).on('click','[data-auth-tab]',function(){
      const tab=$(this).data('auth-tab'); clearAuthMessage();
      $('.auth-tabs button').removeClass('active').filter(`[data-auth-tab="${tab}"]`).addClass('active');
      $('.auth-form').removeClass('active'); $('#'+tab+'Form').addClass('active');
    });
    $('.toggle-password').on('click',function(){ const $input=$(this).siblings('input'); const show=$input.attr('type')==='password'; $input.attr('type',show?'text':'password'); $(this).attr('aria-label',show?'Ẩn mật khẩu':'Hiện mật khẩu').text(show?'◌':'◉'); });
    $('#loginForm').on('submit',async function(event){
      event.preventDefault(); const identifier=$('#loginIdentifier').val().trim(),password=$('#loginPassword').val();
      if (!identifier || password.length<8) return showAuthMessage('Vui lòng nhập username/email và mật khẩu tối thiểu 8 ký tự.');
      await submitAuth('login',{identifier,password},$(this).find('.auth-submit'),false);
    });
    $('#registerForm').on('submit',async function(event){
      event.preventDefault(); const name=$('#registerName').val().trim(),username=$('#registerUsername').val().trim().toLowerCase(),email=$('#registerEmail').val().trim(),password=$('#registerPassword').val();
      if (name.length<2) return showAuthMessage('Tên cần có ít nhất 2 ký tự.');
      if (!/^[a-z0-9._]{3,24}$/.test(username)) return showAuthMessage('Username cần 3–24 ký tự, chỉ gồm chữ, số, dấu chấm hoặc gạch dưới.');
      if (!email || password.length<8) return showAuthMessage('Email không hợp lệ hoặc mật khẩu chưa đủ 8 ký tự.');
      if (!$('#acceptTerms').prop('checked')) return showAuthMessage('Bạn cần đồng ý lưu tiến độ để tạo tài khoản.');
      await submitAuth('register',{name,username,email,password},$(this).find('.auth-submit'),true);
    });
    $('.logout-action').on('click',function(){ if (confirm('Bạn muốn đăng xuất khỏi FluentGo?')) logout(); });
    $(document).on('click','[data-route]', function(){ routeTo($(this).data('route')); });
    $('.dismiss-btn').on('click', () => $('#reminderBanner').slideUp());
    $(document).on('click','.start-next',()=>openLesson());
    $(document).on('click','.open-practice,.practice-tab', function(){ switchPractice($(this).data('practice')); });
    $('#practiceLevelSelect').on('change',function(){ state.level=this.value; resetGoalDrivenSessions(); saveState(true); renderRoadmap(state.level); populateTopicSelect('#vocabularyTopicSelect',state.vocabularyTopic); populateTopicSelect('#challengeTopicSelect',state.challengeTopic); renderPractice($('.practice-tab.active').data('practice')||'listening'); toast('Đã tải bộ bài '+state.level+' theo mục tiêu '+currentGoal().name+'.','success'); });
    $('#practiceGoalSelect,#vocabularyGoalSelect').on('change',function(){ state.learningGoal=this.value; state.roadmapUnit=0; state.practiceTopic='all'; state.vocabularyTopic='all'; state.challengeTopic='all'; resetGoalDrivenSessions(); saveState(true); renderState(); renderRoadmap(state.level); populateTopicSelect('#vocabularyTopicSelect','all'); populateTopicSelect('#challengeTopicSelect','all'); renderPractice($('.practice-tab.active').data('practice')||'listening'); toast('Đã chuyển sang mục tiêu '+currentGoal().name+'.','success'); });
    $('#vocabularyTopicSelect').on('change',function(){ state.vocabularyTopic=this.value; resetGoalDrivenSessions(); saveState(true); updateFlashcard(); });
    $('.close-modal').on('click', closeLesson);
    $('#lessonModal').on('click', function(e){ if (e.target === this) closeLesson(); });
    $(document).on('click','.lesson-next', nextLesson);
    $(document).on('click','.lesson-sound',function(){ const step=lessonSteps[currentLessonStep],text=$(this).data('lesson-text')||step?.question||step?.word; if (text) speak(text); });
    $(document).on('click','.lesson-audio',()=>{ const step=lessonSteps[currentLessonStep]; if (step?.audio) speakDialogue(step.audio); });
    $(document).on('click','.guidebook-sound',function(){ speak($(this).data('phrase')||''); });
    $(document).on('click','.lesson-flashcard',function(){ $(this).toggleClass('revealed'); });
    $(document).on('input','.lesson-short-answer',function(){ $('.lesson-write-check').prop('disabled',!this.value.trim()); });
    $(document).on('click','.lesson-writing-done',function(){ const words=$('.lesson-writing').val().trim().split(/\s+/).filter(Boolean); if (words.length<Number($(this).data('min-words')||5)) return toast('Write at least '+($(this).data('min-words')||5)+' English words.','error'); nextLesson(); });
    $(document).on('click','.lesson-write-check',function(){ const step=lessonSteps[currentLessonStep],value=$('.lesson-short-answer').val().trim().toLowerCase().replace(/[^a-z'-]/g,''),answer=String(step.answer||'').trim().toLowerCase().replace(/[^a-z'-]/g,''),correct=value===answer; lessonCheckpointAnswered++; if (correct) lessonCheckpointScore++; $('.lesson-short-answer').prop('disabled',true).toggleClass('answer-correct',correct).toggleClass('answer-wrong',!correct); $('.lesson-nav').html(`<div class="lesson-feedback ${correct?'success':'error'}"><strong>${correct?'✓ Correct spelling!':'Check the word again'}</strong><span>${correct?'Your written answer matches.':'Correct answer: '+escapeHtml(step.answer)}</span></div><button class="primary-btn lesson-next">Continue →</button>`); });
    $(document).on('click','.lesson-speak-done',function(){ lessonCheckpointAnswered++; lessonCheckpointScore++; nextLesson(); });
    $(document).on('click','.lesson-retry-checkpoint',function(){ closeLesson(); openLesson(activeRoadmapLesson.index,activeRoadmapLesson.level,activeRoadmapLesson.unit); });
    $(document).on('click','.lesson-options button', function(){ selectedLessonAnswer = Number($(this).data('answer')); $('.lesson-options button').removeClass('selected'); $(this).addClass('selected'); $('.lesson-check').prop('disabled',false); });
    $(document).on('click','.lesson-check', function(){
      const step=lessonSteps[currentLessonStep],correct=selectedLessonAnswer===step.correct,$buttons=$('.lesson-options button');
      $buttons.prop('disabled',true).eq(step.correct).addClass('answer-correct'); if (!correct) $buttons.eq(selectedLessonAnswer).addClass('answer-wrong');
      $('.lesson-nav').html(`<div class="lesson-feedback ${correct?'success':'error'}"><strong>${correct?'✓ Correct!':'Not quite yet'}</strong><span>${escapeHtml(step.explanation||'Read the complete sentence once more.')}</span></div><button class="primary-btn lesson-next">Continue →</button>`);
      if (step.checkpoint) { lessonCheckpointAnswered++; if (correct) lessonCheckpointScore++; }
      if (!correct) state.mistakes.unshift({type:'Lesson',wrong:$buttons.eq(selectedLessonAnswer).text().replace(/^[A-Z]\.\s*/,''),right:$buttons.eq(step.correct).text().replace(/^[A-Z]\.\s*/,''),note:step.title});
    });
    $(document).on('click','.lesson-finish', function(){
      if (!activeRoadmapLesson) return closeLesson();
      if (lessonCheckpoint) { const key=[currentGoalId(),activeRoadmapLesson.level,activeRoadmapLesson.unit].join(':'); state.checkpointResults=state.checkpointResults||{}; const percent=Math.round(lessonCheckpointScore/15*100),previous=state.checkpointResults[key]||{}; state.checkpointResults[key]={bestScore:Math.max(Number(previous.bestScore)||0,percent),lastScore:percent,attempts:Number(previous.attempts||0)+1,completedAt:new Date().toISOString()}; }
      const firstCompletion=!state.completedLessons.includes(activeRoadmapLesson.id);
      if (firstCompletion) state.completedLessons.push(activeRoadmapLesson.id);
      if (!state.completedToday.includes(activeRoadmapLesson.id)) state.completedToday.push(activeRoadmapLesson.id);
      state.lessonProgress[activeRoadmapLesson.id]=100; if (firstCompletion) addXp(lessonCheckpoint?50:25,lessonCheckpoint?15:10); else saveState(true);
      confetti(); closeLesson(); renderRoadmap(activeRoadmapLesson.level);
      $('.task-card[data-lesson="daily"]').addClass('completed').removeClass('current').find('.mini-progress i').css('width','100%');
      toast(firstCompletion?'Bài tiếp theo đã mở — bạn có thể học tiếp ngay!':'Bạn vừa ôn lại bài này.','success');
    });

    $('#playListening').on('click', function(){
      const item=activePracticeData('listening').item; if (!item) return;
      $('.audio-wave').addClass('playing'); const u = speakDialogue(item.audio,listeningSpeedMultiplier);
      if (u) u.onend = () => $('.audio-wave').removeClass('playing');
    });
    $('#audioSpeed').on('click', function(){ listeningSpeedMultiplier=listeningSpeedMultiplier===1?.75:1; $(this).text(listeningSpeedMultiplier===1?'1×':'0.75×'); });
    $('#listeningAnswers,#readingAnswers').on('click','button',function(){
      const $list = $(this).parent(); if ($list.data('done')) return; $list.data('done',true);
      const type=$list.attr('id')==='listeningAnswers'?'listening':'reading',data=activePracticeData(type),item=data.item;
      const correct=Number($(this).data('index'))===item.correct; $(this).addClass(correct ? 'correct':'wrong');
      if (!correct) $list.find('[data-correct="true"]').addClass('correct');
      $list.find('button').prop('disabled',true);
      const target=type==='listening'?'#listeningFeedback':'#readingFeedback',explanation=item.explanation||('Đáp án đúng: '+item.options[item.correct]),status=correct?'✓ Chính xác!':'Chưa đúng.';
      const englishAnswer=type==='listening'?`<div class="listening-answer-english"><strong>English answer</strong><span>${escapeHtml(item.audio)}</span><button type="button" class="replay-listening-answer">▶ Nghe lại</button></div>`:'';
      $(target).attr('class','exercise-feedback show '+(correct?'success':'error')).html(`<span>${escapeHtml(status+' '+explanation+(correct?' +5 XP':''))}</span>${englishAnswer}`);
      practiceSession[type+'Results'].push({itemIndex:data.itemIndex,variantCycle:data.entry?.variantCycle||0,correct});
      updateExerciseMastery(item,correct);
      state.practiceStats[type]=state.practiceStats[type]||{done:0,correct:0}; state.practiceStats[type].done++; if (correct) state.practiceStats[type].correct++;
      if (!correct) state.mistakes.unshift({type:type==='listening'?'Nghe':'Đọc',wrong:$(this).text().replace(/^[A-Z]\s*/,''),right:item.options[item.correct],note:item.question});
      if (correct) addXp(5,2); else saveState(true);
      if (type==='listening') { $('#showListeningTranscript').removeClass('hidden'); $('#listeningTranscript').removeClass('hidden').text(item.audio); $('#showListeningTranscript').text('Ẩn transcript'); }
      $(type==='listening'?'#nextListening':'#nextReading').text(data.index>=data.deck.length-1?'Xem kết quả →':(type==='listening'?'Câu tiếp theo →':'Bài tiếp theo →')).removeClass('hidden');
    });
    $('#showListeningTranscript').on('click',function(){ const opening=$('#listeningTranscript').hasClass('hidden'); $('#listeningTranscript').toggleClass('hidden',!opening); $(this).text(opening?'Ẩn transcript':'▤ Xem transcript'); });
    $('#listeningFeedback').on('click','.replay-listening-answer',function(){ const item=activePracticeData('listening').item; if (item) speakDialogue(item.audio,listeningSpeedMultiplier); });
    $('#nextListening').on('click',()=>nextPractice('listening')); $('#nextReading').on('click',()=>nextPractice('reading'));
    $('#playSpeakingSample').on('click', () => { const item=activePracticeData('speaking').item; if (item) speak(item.target); });
    $('#readPassage').on('click', () => { const item=activePracticeData('reading').item; if (item) speak(item.passage); });
    $('#recordBtn').on('click', async function(){
      if (speakingRecordingActive) return stopSpeakingRecording();
      transcript = ''; recordedAudio = null; $('#liveTranscript').text('Đang khởi động microphone...'); $('#speechFeedback').removeClass('show').empty(); $('#analyzeSpeech,#nextSpeaking').addClass('hidden');
      try {
        await startMediaCapture();
        speakingRecordingActive=true;
        speakingRecognitionShouldRun=!!speakingRecognitionCtor;
        speakingTranscriptBase='';
        setSpeakingRecordState(true,'Đang ghi liên tục... nhấn Stop khi nói xong');
        if (speakingRecognitionCtor) startSpeakingRecognitionCycle();
        else $('#liveTranscript').text('Đang ghi âm — nhấn Stop khi nói xong. Gemini sẽ nghe file âm thanh.');
      } catch (_) { toast('Không thể mở microphone. Hãy kiểm tra quyền truy cập.', 'error'); }
    });
    $('#analyzeSpeech').on('click', async function(){
      const active=activePracticeData('speaking'),item=active.item; if (!item) return;
      showLoading('#speechFeedback','Mochi đang nghe lại và phân tích phát âm...'); $(this).prop('disabled',true);
      try {
        const data=await askGemini('speaking',transcript,'Target sentence: '+item.target+'. The learner must say the complete target sentence. Score pronunciation, content accuracy and fluency separately. Missing or substituted words must reduce contentScore.',recordedAudio);
        const transcriptCoverage=transcript?spokenContentCoverage(item.target,transcript):null,aiCoverage=Number(data.contentScore??data.accuracyScore??data.accuracy),coverage=Number.isFinite(aiCoverage)?Math.round(Math.max(0,Math.min(100,aiCoverage))):(transcriptCoverage===null?0:transcriptCoverage);
        const rawScore=Math.max(0,Math.min(100,Number(data.score)||0)),pronunciationScore=Math.max(0,Math.min(100,Number(data.pronunciationScore)||rawScore)),contentCap=coverage<SPEAKING_MIN_COVERAGE?SPEAKING_PASS_SCORE-1:100,score=Math.min(rawScore,pronunciationScore,contentCap),passed=score>=SPEAKING_PASS_SCORE&&pronunciationScore>=SPEAKING_PASS_SCORE&&coverage>=SPEAKING_MIN_COVERAGE;
        data.score=score; data.contentScore=coverage; data.pronunciationScore=pronunciationScore; data.fluencyScore=Math.max(0,Math.min(100,Number(data.fluencyScore)||rawScore));
        if (!passed) { data.title='Chưa đạt — hãy đọc lại'; const missingMessage=coverage<SPEAKING_MIN_COVERAGE?'Bạn chưa đọc đủ hoặc đã thay đổi một số từ trong câu mẫu. ':''; data.improvements=[missingMessage+'Cần đạt ít nhất '+SPEAKING_PASS_SCORE+'/100 và độ đầy đủ '+SPEAKING_MIN_COVERAGE+'% để sang câu tiếp theo.'].concat(Array.isArray(data.improvements)?data.improvements:[data.improvements||'']); }
        showAiFeedback('#speechFeedback',data,'speech');
        $('#speechFeedback').append(`<div class="speaking-pass-gate ${passed?'passed':'retry'}"><strong>${passed?'✓ PASS':'↻ CHƯA PASS'}</strong><span>${passed?'Bạn đã đọc đủ câu và đạt phát âm '+pronunciationScore+'/100. Có thể sang câu tiếp theo.':'Tổng '+score+'/100 · Nội dung '+coverage+'% · Phát âm '+pronunciationScore+'/100. Nhấn micro và đọc lại đầy đủ câu mẫu.'}</span></div>`);
        state.practiceStats.speaking.done++; updateExerciseMastery(item,passed); $('#analyzeSpeech').addClass('hidden');
        if (passed) { practiceSession.speakingResults.push({itemIndex:active.itemIndex,variantCycle:active.entry?.variantCycle||0,correct:true,score,coverage}); state.practiceStats.speaking.correct=Number(state.practiceStats.speaking.correct||0)+1; addXp(8,3); $('#nextSpeaking').removeClass('hidden'); }
        else { saveState(true); $('#nextSpeaking').addClass('hidden'); $('#recordLabel').text('Chưa đạt · nhấn micro để đọc lại câu đầy đủ'); }
      }
      catch (e) { $('#speechFeedback').removeClass('show'); toast(e.responseJSON?.error || e.message || 'Gemini chưa thể nhận xét.', 'error'); }
      finally { $(this).prop('disabled',false); }
    });
    $('#nextSpeaking').on('click',()=>nextPractice('speaking'));

    $('#writingInput').on('input', function(){ $('#writingCount').text($(this).val().length); });
    $('#writingChips').on('click','button',function(){ const $input=$('#writingInput'); $input.val(($input.val()+' '+$(this).text()).trim()).trigger('input').focus(); });
    $('#checkWriting').on('click', async function(){
      const active=activePracticeData('writing'),item=active.item,text=$('#writingInput').val().trim(),wordCount=text?text.split(/\s+/).length:0; if (!item) return;
      if (wordCount<item.minWords) return toast('Hãy viết ít nhất '+item.minWords+' từ cho đề này nhé!','error');
      showLoading('#writingFeedback','Gemini đang đọc và sửa bài của bạn...'); $(this).prop('disabled',true);
      try { const data = await askGemini('writing',text,'Writing task: '+item.instruction); const score=Math.max(0,Math.min(100,Number(data.score)||0)),correct=score>=70; showAiFeedback('#writingFeedback',data,'writing'); practiceSession.writingResults.push({itemIndex:active.itemIndex,variantCycle:active.entry?.variantCycle||0,correct,score}); updateExerciseMastery(item,correct); state.practiceStats.writing.done++; state.practiceStats.writing.correct=Number(state.practiceStats.writing.correct||0)+(correct?1:0); addXp(12,4); if (data.corrected&&data.corrected!==text) state.mistakes.unshift({type:'Ngữ pháp',wrong:text.slice(0,90),right:data.corrected.slice(0,90),note:item.title}); saveState(true); $('#checkWriting').addClass('hidden'); $('#nextWriting').removeClass('hidden'); }
      catch(e) { $('#writingFeedback').removeClass('show'); toast(e.responseJSON?.error || e.message || 'Gemini chưa thể sửa bài.', 'error'); }
      finally { $(this).prop('disabled',false); }
    });
    $('#nextWriting').on('click',()=>nextPractice('writing'));

    $('#flashcard').on('click keydown', function(e){ if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') $(this).toggleClass('flipped'); });
    $('.flash-actions button').on('click', function(){
      const data=activePracticeData('vocabulary'),isEasy=$(this).data('memory')==='easy';
      practiceSession.vocabularyResults.push({itemIndex:data.itemIndex,variantCycle:data.entry?.variantCycle||0,correct:isEasy});
      const isNewWord=updateVocabularyReview(data.level,data.item,isEasy);
      if (isEasy) { if (isNewWord) state.wordsLearned++; addXp(2,1); }
      else saveState(true);
      if (data.index>=data.deck.length-1) renderFiniteSummary('vocabulary');
      else { practiceSession.vocabulary=data.index+1; updateFlashcard(); }
    });
    $('#vocabularySummary').on('click','.start-vocabulary-quiz',startVocabularyQuiz);
    $('#vocabularySummary').on('click','.vocabulary-quiz-options button',function(){
      const quiz=practiceSession.vocabularyQuiz,item=quiz?.items?.[quiz.index]; if (!item||quiz.answered) return;
      quiz.answered=true; const selected=Number($(this).data('index')),correct=selected===item.correct,$options=$('.vocabulary-quiz-options button');
      $(this).addClass(correct?'correct':'wrong'); if (!correct) $options.eq(item.correct).addClass('correct'); $options.prop('disabled',true);
      if (correct) quiz.score++; else state.mistakes.unshift({type:'Từ vựng',wrong:item.options[selected]||'',right:item.card.meaning,note:item.card.word});
      quiz.results.push({itemIndex:item.itemIndex,correct}); updateVocabularyReview(state.level,item.card,correct);
      $('.vocabulary-quiz-feedback').attr('class','exercise-feedback vocabulary-quiz-feedback show '+(correct?'success':'error')).html(`<strong>${correct?'✓ Correct!':'Not quite.'}</strong> ${escapeHtml(item.card.word)} = ${escapeHtml(item.card.meaning)}`);
      $('.vocabulary-quiz-progress span').text('Score: '+quiz.score+' / '+(quiz.index+1)); $('.vocabulary-quiz-next').removeClass('hidden');
    });
    $('#vocabularySummary').on('click','.vocabulary-quiz-next',function(){ const quiz=practiceSession.vocabularyQuiz; if (!quiz?.answered) return; quiz.index++; if (quiz.index>=quiz.items.length) renderVocabularyQuizResult(); else renderVocabularyQuiz(); });
    $('#vocabularySummary').on('click','.retry-vocabulary-quiz',startVocabularyQuiz);
    $('#challengeTypeSelect,#challengeTopicSelect').on('change',function(){ state.challengeType=$('#challengeTypeSelect').val()||'all'; state.challengeTopic=$('#challengeTopicSelect').val()||'all'; practiceSession.aiChallengeDeck=null; practiceSession.challengeQueue=null; saveState(true); renderChallenge(true); });
    $('#generateAiChallenge').on('click',async function(){
      const $button=$(this),roadmap=CURRICULUM?.getRoadmap(currentGoalId(),state.level)||[],selectedTopic=state.challengeTopic&&state.challengeTopic!=='all'?state.challengeTopic:(roadmap[Number(state.roadmapUnit)||0]?.title||currentGoal().name),selectedType=state.challengeType||'all';
      $button.prop('disabled',true).text('✦ AI đang soạn...');
      try {
        const data=await askGemini('exercise','Create a fresh English practice set for this learner.','Topic: '+selectedTopic+'. Requested exercise type: '+selectedType+'. Keep all questions and answer options in English, except a translation prompt may start in Vietnamese.');
        const allowed=new Set(CURRICULUM.types.filter(type=>!['speaking','writing'].includes(type[0])).map(type=>type[0])),rawCandidates=[data.exercises,data.questions,data.items,data.tasks],raw=rawCandidates.find(Array.isArray)||[];
        const generated=raw.slice(0,8).map((item,index)=>{
          const type=allowed.has(item.type)?item.type:'grammar',rawOptions=Array.isArray(item.options)?item.options:Array.isArray(item.choices)?item.choices:Array.isArray(item.answers)?item.answers:[],optionText=value=>String(value&&typeof value==='object'?(value.text||value.label||value.value||''):value||'').trim();
          const options=rawOptions.map(optionText).filter(Boolean).slice(0,4); let answer=optionText(item.answer??item.correctAnswer??item.correct_option??item.correct);
          const numeric=Number(item.correctIndex??item.answerIndex),letter=answer.match(/^[A-D](?:[.)])?$/i);
          if (Number.isInteger(numeric)&&options[numeric]) answer=options[numeric]; else if (letter&&options[letter[0].toUpperCase().charCodeAt(0)-65]) answer=options[letter[0].toUpperCase().charCodeAt(0)-65];
          const matched=options.find(option=>option.toLowerCase()===answer.toLowerCase()); if (matched) answer=matched;
          if (answer&&!options.includes(answer)) { if (options.length<4) options.push(answer); else options[options.length-1]=answer; }
          ['A different response','Not enough information','None of these choices'].forEach(value=>{ if (options.length<3&&!options.includes(value)&&value!==answer) options.push(value); });
          const question=optionText(item.question||item.prompt||item.text);
          if (options.length<3||!answer||!options.includes(answer)||!question) return null;
          return {id:'ai-'+Date.now()+'-'+index,goalId:currentGoalId(),level:state.level,topic:selectedTopic,topicEn:selectedTopic,type,typeLabel:CURRICULUM.types.find(value=>value[0]===type)?.[1]||'AI practice',question,options,answer,explanation:optionText(item.explanation||item.feedback||'Review the answer in context.'),audio:optionText(item.audio||item.audioScript),passage:optionText(item.passage||item.context)};
        }).filter(Boolean);
        if (generated.length<6) {
          const fallback=CURRICULUM.getExercises(currentGoalId(),state.level,selectedType,selectedTopic).filter(item=>allowed.has(item.type)&&Array.isArray(item.options)&&item.options.includes(item.answer)),used=new Set(generated.map(item=>item.question+'|'+item.answer));
          seededIndexes(fallback.length,stableHash(currentGoalId()+'|'+state.level+'|'+selectedTopic+'|'+Date.now())).forEach(sourceIndex=>{ const item=fallback[sourceIndex],signature=item.question+'|'+item.answer; if (generated.length>=6||used.has(signature)) return; used.add(signature); generated.push(Object.assign({},item,{id:'ai-repaired-'+Date.now()+'-'+generated.length,question:'Fresh scenario: '+item.question})); });
        }
        if (generated.length<3) throw new Error('AI chưa tạo đủ câu hợp lệ và kho dự phòng không phù hợp bộ lọc hiện tại.');
        practiceSession.aiChallengeDeck=generated; practiceSession.challengeQueue=null; renderChallenge(true); toast('Đã tạo '+generated.length+' câu mới theo đúng mục tiêu và trình độ.','success');
      } catch(error) { toast(error.message||'Chưa thể tạo bộ bài AI.','error'); }
      finally { $button.prop('disabled',false).text('✦ AI tạo bộ mới'); }
    });
    $('#playChallengeAudio').on('click',function(){ speakDialogue($(this).data('audio')||''); });
    $('#challengeAnswers').on('click','button',function(){
      const $list=$('#challengeAnswers'); if ($list.data('done')) return; $list.data('done',true);
      const data=activeChallengeData(),item=data.item,correct=Number($(this).data('index'))===item.options.indexOf(item.answer); $(this).addClass(correct?'correct':'wrong'); if (!correct) $list.find('[data-correct="true"]').addClass('correct'); $list.find('button').prop('disabled',true);
      $('#challengeFeedback').attr('class','exercise-feedback show '+(correct?'success':'error')).text((correct?'✓ Chính xác! ':'Chưa đúng. ')+(item.explanation||'Đáp án: '+item.answer)); practiceSession.challengeResults.push({id:item.id,correct});
      updateExerciseMastery(item,correct);
      if (correct) addXp(5,2); else { state.mistakes.unshift({type:item.typeLabel,wrong:$(this).text().replace(/^[A-Z]\s*/,''),right:item.answer,note:item.topic}); saveState(true); }
      $('#explainChallenge,#nextChallenge').removeClass('hidden'); $('#nextChallenge').text(data.index>=data.deck.length-1?'Xem kết quả →':'Câu tiếp theo →');
    });
    $('#nextChallenge').on('click',function(){ const data=activeChallengeData(); if (data.index>=data.deck.length-1) renderFiniteSummary('challenge'); else { practiceSession.challenge=data.index+1; renderChallenge(); } });
    $('#explainChallenge').on('click',async function(){ const item=activeChallengeData().item; if (!item) return; showLoading('#challengeAiFeedback','Mochi đang giải thích theo trình độ của bạn...'); $(this).prop('disabled',true); try { const data=await askGemini('explain',item.question,'Correct answer: '+item.answer+'. Base explanation: '+item.explanation+'. Topic: '+item.topic); showAiFeedback('#challengeAiFeedback',data,'writing'); } catch(error) { $('#challengeAiFeedback').removeClass('show'); toast(error.message||'Chưa thể lấy giải thích AI.','error'); } finally { $(this).prop('disabled',false); } });
    $('#examBadgeGrid').on('click','.exam-badge',function(){ startExam(Number($(this).data('exam-index'))); });
    $('#exitExam').on('click',function(){ if (confirm('Thoát đề thi? Kết quả chưa nộp sẽ không được lưu.')) abortExam(); });
    $('#practice-exam').on('click','.exam-audio-button',function(){ speakDialogue($(this).data('audio')||''); });
    $('#practice-exam').on('click','.exam-sample',function(){ const item=examSession.exam?.items?.[examSession.index]; if (item) speak(item.target||item.question); });
    $('#practice-exam').on('click','.exam-options button',function(){
      if (!examSession.active||examSession.answered) return;
      const item=examSession.exam.items[examSession.index],$options=$('.exam-options button'),selected=Number($(this).data('index')),correct=String(item.options[selected])===String(item.answer);
      $(this).addClass(correct?'correct':'wrong'); $options.filter('[data-correct="true"]').addClass('correct'); $options.prop('disabled',true); updateExerciseMastery(item,correct);
      if (!correct) state.mistakes.unshift({type:EXAM_TYPE_LABELS[item.type]||item.type,wrong:item.options[selected]||'',right:item.answer,note:examSession.exam.title});
      recordExamAnswer(correct?100:0,item.options[selected]||'',`<strong>${correct?'✓ Correct!':'Not quite.'}</strong><span>Correct answer: ${escapeHtml(item.answer||'')}</span>${item.explanation?`<small>${escapeHtml(item.explanation)}</small>`:''}`);
    });
    $('#practice-exam').on('click','.exam-record-btn',async function(){
      if (examRecording) return stopExamRecording(false);
      try { await startExamRecording(); } catch(error) { stopExamRecording(true); toast(error.message||'Không thể mở microphone. Hãy kiểm tra quyền truy cập.','error'); }
    });
    $('#practice-exam').on('click','#gradeExamSpeaking',async function(){
      const item=examSession.exam?.items?.[examSession.index]; if (!item||examSession.answered) return;
      const $button=$(this).prop('disabled',true).text('✦ Đang chấm...');
      try {
        const data=await askGemini('speaking',examTranscript,'Target sentence: '+item.target+'. The learner must say every word in the complete target sentence. Grade pronunciation, content accuracy and fluency strictly.',examAudio);
        const transcriptCoverage=examTranscript?spokenContentCoverage(item.target,examTranscript):null,aiCoverage=Number(data.contentScore??data.accuracyScore??data.accuracy),coverage=Number.isFinite(aiCoverage)?Math.round(Math.max(0,Math.min(100,aiCoverage))):(transcriptCoverage===null?0:transcriptCoverage),raw=Math.max(0,Math.min(100,Number(data.score)||0)),pronunciation=Math.max(0,Math.min(100,Number(data.pronunciationScore)||raw)),score=Math.min(raw,pronunciation,coverage<SPEAKING_MIN_COVERAGE?79:100);
        recordExamAnswer(score,examTranscript,`<strong>Điểm nói: ${Math.round(score)}/100</strong><span>Nội dung ${coverage}% · Phát âm ${Math.round(pronunciation)}/100 · Trôi chảy ${Math.round(Number(data.fluencyScore)||raw)}/100</span><small>${escapeHtml(aiText(data.improvements,'Hãy đọc đủ câu, rõ âm cuối và giữ nhịp tự nhiên.'))}</small>`);
      } catch(error) {
        const coverage=examTranscript?spokenContentCoverage(item.target,examTranscript):0,score=Math.min(79,Math.round(coverage));
        recordExamAnswer(score,examTranscript,`<strong>Điểm nói dự phòng: ${score}/100</strong><span>Nội dung ${coverage}% · AI tạm gián đoạn nên chưa xác minh được phát âm.</span><small>Bạn vẫn có thể làm tiếp đề; hãy luyện lại câu này khi Gemini kết nối ổn định.</small>`);
        toast(error.message||'Gemini tạm gián đoạn; đã dùng điểm nội dung dự phòng.','error');
      }
      finally { $button.prop('disabled',false).text('✦ Chấm phần nói'); }
    });
    $('#practice-exam').on('input','#examWritingInput',function(){ $('#examWritingCount').text(this.value.length); });
    $('#practice-exam').on('click','#gradeExamWriting',async function(){
      const item=examSession.exam?.items?.[examSession.index],text=$('#examWritingInput').val().trim(),wordCount=text?text.split(/\s+/).length:0; if (!item||examSession.answered) return;
      if (wordCount<Number(item.minWords||20)) return toast('Hãy viết ít nhất '+(item.minWords||20)+' từ trước khi nộp.','error');
      const $button=$(this).prop('disabled',true).text('✦ Đang chấm...');
      try { const data=await askGemini('writing',text,'Timed exam writing task: '+(item.instruction||item.question)+'. Grade task completion, grammar, vocabulary and naturalness realistically.'); const score=Math.max(0,Math.min(100,Number(data.score)||0)); recordExamAnswer(score,text,`<strong>Điểm viết: ${Math.round(score)}/100</strong><span>${escapeHtml(aiText(data.explanation||data.improvements,'Bài viết đã được chấm theo độ đúng, đủ ý và tự nhiên.'))}</span>${data.corrected?`<small>Gợi ý: ${escapeHtml(data.corrected)}</small>`:''}`); }
      catch(error) {
        const target=Math.max(1,Number(item.minWords||20)),score=Math.min(75,Math.round(45+Math.min(30,wordCount/target*30)));
        recordExamAnswer(score,text,`<strong>Điểm viết dự phòng: ${score}/100</strong><span>Đã kiểm tra độ dài và mức hoàn thành cơ bản. AI tạm gián đoạn nên ngữ pháp, từ vựng chưa được chấm sâu.</span>`);
        toast(error.message||'Gemini tạm gián đoạn; đã dùng điểm viết dự phòng.','error');
      }
      finally { $button.prop('disabled',false).text('✦ Nộp phần viết'); }
    });
    $('#nextExamQuestion').on('click',function(){ if (!examSession.active||!examSession.answered) return; if (examSession.index>=examSession.exam.items.length-1) finishExam(false); else { examSession.index++; renderExamQuestion(); } });
    $('#practice-exam').on('click','.exam-back-bank',renderExamBank);
    $('#practice-exam').on('click','.exam-retry',function(){ startExam(Number($(this).data('exam-index'))); });
    $(document).on('click','.session-retry',function(){
      const type=String($(this).data('type')),wrong=(practiceSession[type+'Results']||[]).filter(result=>!result.correct).map(result=>({itemIndex:result.itemIndex,variantCycle:result.variantCycle||0}));
      if (wrong.length) startFiniteSession(type,wrong);
    });
    $(document).on('click','.session-restart',function(){ const type=String($(this).data('type')); if (type==='challenge') { practiceSession.aiChallengeDeck=null; practiceSession.challengeQueue=null; renderChallenge(true); } else startFiniteSession(type); });
    $('#scenarioGroups').on('click','button',function(){
      $('#scenarioGroups button').removeClass('selected'); $(this).addClass('selected'); $('#customScenario').val('').trigger('input');
      selectedScenario={scenario:$(this).data('scenario'),aiRole:$(this).data('ai-role'),userRole:$(this).data('user-role')};
      $('#startConversation').prop('disabled',false);
    });
    $('#customScenario').on('input',function(){
      $('#scenarioCount').text(this.value.length);
      if (this.value.trim()) { selectedScenario={scenario:this.value.trim(),aiRole:'người đối thoại phù hợp với tình huống',userRole:'người học tiếng Anh'}; $('#scenarioGroups button').removeClass('selected'); }
      else if (!$('#scenarioGroups button.selected').length) selectedScenario=null;
      $('#startConversation').prop('disabled',!selectedScenario);
    });
    $('#speakerToggle').on('click','button',function(){ $(this).addClass('active').siblings().removeClass('active'); conversation.first=$(this).data('first'); });
    $('#startConversation').on('click',startConversation);
    $('#backToScenarios,#endConversation').on('click',endConversation);
    $('#quickReplies').on('click','button',function(){ $('#chatInput').val($(this).text()); sendChat(); });
    $('#sendChat').on('click',sendChat); $('#chatInput').on('keydown',e => { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); sendChat(); } });
    $('#toggleAiVoice').on('click',function(){ aiVoiceEnabled=!aiVoiceEnabled; $(this).toggleClass('active',aiVoiceEnabled); toast(aiVoiceEnabled?'Đã bật giọng đọc AI.':'Đã tắt giọng đọc AI.'); });
    $('#chatMic').on('click',startChatDictation);
    $('#chatMessages').on('click','.toggle-chat-review',function(){
      const $button=$(this),$card=$('#'+$button.attr('aria-controls')),opening=$button.attr('aria-expanded')!=='true';
      $button.attr('aria-expanded',String(opening)).find('span:nth-child(2)').text(opening?'Ẩn nhận xét':'Xem nhận xét');
      $card.prop('hidden',!opening); if (opening) setTimeout(()=>$('#chatMessages').scrollTop(99999),50);
    });
    $('#chatMessages').on('click','.play-review-sentence',function(){ speak($(this).data('sentence')||''); });

    $('#levelTabs').on('click','button',function(){ const level=$(this).data('level'); state.level=level; state.roadmapUnit=0; resetGoalDrivenSessions(); saveState(true); $(this).addClass('active').siblings().removeClass('active'); renderRoadmap(level); });
    $('#levelPicker').on('click', function(e){ const r=this.getBoundingClientRect(); $('#levelMenu').css({top:r.bottom+6,left:Math.min(r.left,window.innerWidth-205)}).toggleClass('show'); e.stopPropagation(); });
    $('#levelMenu').on('click','button',function(){ const level=$(this).data('level'); state.level=level; state.roadmapUnit=0; resetGoalDrivenSessions(); saveState(true); $('#levelPicker strong').text(level+' · '+$(this).find('span').text()+'⌄'); $('#levelTabs button').removeClass('active').filter(`[data-level="${level}"]`).addClass('active'); renderRoadmap(level); renderPractice($('.practice-tab.active').data('practice')); $('#levelMenu').removeClass('show'); toast('Đã chuyển lộ trình sang '+level,'success'); });
    $(document).on('click', () => $('#levelMenu').removeClass('show'));
    $(document).on('click','.road-node:not(.locked)',function(){ openLesson(Number($(this).data('index')),String($(this).data('level')),Number($(this).data('unit'))); });
    $('#roadmapGoalSelect').on('change',function(){ state.learningGoal=this.value; state.roadmapUnit=0; state.practiceTopic='all'; state.vocabularyTopic='all'; state.challengeTopic='all'; resetGoalDrivenSessions(); saveState(true); renderState(); renderRoadmap(state.level); populateTopicSelect('#vocabularyTopicSelect','all'); populateTopicSelect('#challengeTopicSelect','all'); renderPractice($('.practice-tab.active').data('practice')||'listening'); });
    $('#roadmapUnitSelect').on('change',function(){ state.roadmapUnit=Number(this.value)||0; saveState(true); renderRoadmap(state.level); });
    $('#previousRoadmapUnit').on('click',function(){ state.roadmapUnit=Math.max(0,Number(state.roadmapUnit||0)-1); saveState(true); renderRoadmap(state.level); });
    $('#nextRoadmapUnit,#openNextUnit').on('click',function(){ state.roadmapUnit=Math.min(11,Number(state.roadmapUnit||0)+1); saveState(true); renderRoadmap(state.level); $('#view-learn')[0]?.scrollIntoView({behavior:'smooth'}); });

    $('.open-settings').on('click', function(){ $('#settingName').val(state.name); $('#settingGoal').val(state.dailyGoal); $('#settingLevel').val($('#settingLevel option').filter(function(){ return $(this).text().startsWith(state.level); }).val()); $('#settingLearningGoal').html(goalOptions(currentGoalId())).val(currentGoalId()); populateVoiceSettings(); $('#settingVoice').val(state.voiceName||''); $('#settingSpeechRate').val(String(Number(state.speechRate)||.9)); $('#settingsModal').addClass('open').attr('aria-hidden','false'); });
    $('.close-settings').on('click', () => $('#settingsModal').removeClass('open').attr('aria-hidden','true'));
    $('#settingsModal').on('click', function(e){ if(e.target===this) $(this).removeClass('open').attr('aria-hidden','true'); });
    $('#previewVoice').on('click',function(){ const previousVoice=state.voiceName,previousRate=state.speechRate; state.voiceName=$('#settingVoice').val()||''; state.speechRate=Number($('#settingSpeechRate').val())||.9; speak('Hello! This voice will be used across FluentGo.'); state.voiceName=previousVoice; state.speechRate=previousRate; });
    $('#saveSettings').on('click', async function(){
      const button=this,name=$('#settingName').val().trim(); if (name.length<2) return toast('Tên cần có ít nhất 2 ký tự.','error');
      $(button).prop('disabled',true).text('Đang lưu...');
      try {
        const response=await bridgeCall('profile',{name}); if (!response.ok) throw new Error(response.error||'Không thể cập nhật hồ sơ.');
        authUser=response.user; state.name=response.user.name; state.email=response.user.email; state.username=response.user.username||state.username;
        state.dailyGoal=Number($('#settingGoal').val()); const selected=$('#settingLevel').val(); state.level=selected.slice(0,2); state.learningGoal=$('#settingLearningGoal').val()||'general'; state.voiceName=$('#settingVoice').val()||''; state.speechRate=Number($('#settingSpeechRate').val())||.9; state.roadmapUnit=0; state.practiceTopic='all'; state.vocabularyTopic='all'; state.challengeTopic='all';
        resetGoalDrivenSessions(); saveState(true); renderRoadmap(state.level); populateTopicSelect('#vocabularyTopicSelect','all'); populateTopicSelect('#challengeTopicSelect','all'); updateFlashcard(); renderPractice($('.practice-tab.active').data('practice')||'listening'); $('#settingsModal').removeClass('open'); toast('Đã lưu lộ trình '+currentGoal().name+'!','success');
      } catch(error) { toast(error.message||'Không thể lưu hồ sơ.','error'); }
      finally { $(button).prop('disabled',false).text('Lưu thay đổi'); }
    });
    $('#syncNow').on('click', () => { clearTimeout(syncTimer); syncProgress(true); });
    $('#notificationBtn').on('click', () => toast(state.completedToday.length >= 3 ? 'Bạn đã hoàn thành kế hoạch hôm nay! 🎉' : `Bạn còn ${3-state.completedToday.length} nhiệm vụ hôm nay.`));
    $('#reviewAll').on('click', () => switchPractice('vocabulary'));
    $(document).on('click','.review-mistake',function(){ const m=state.mistakes[$(this).data('index')]; toast(`Ghi nhớ: ${m.right}`,'success'); speak(m.right); });
    $(document).on('keydown', e => { if(e.key==='Escape'){ closeLesson(); $('#settingsModal').removeClass('open'); } });
  }

  async function submitAuth(action,payload,$button,isNewAccount) {
    if (!bridgeReady) return showAuthMessage('Hệ thống tài khoản chưa kết nối. Vui lòng thử lại sau.');
    clearAuthMessage(); $button.addClass('loading').prop('disabled',true).find('span').text(action==='login'?'Đang đăng nhập...':'Đang tạo tài khoản...');
    try {
      const result=await bridgeCall(action,payload); if (!result.ok) throw new Error(result.error||'Không thể xác thực tài khoản.');
      completeAuth(result,isNewAccount);
      $('#loginForm,#registerForm').trigger('reset');
    } catch(error) { showAuthMessage(error.message||'Không thể kết nối tài khoản.'); }
    finally { $button.removeClass('loading').prop('disabled',false).find('span').text(action==='login'?'Đăng nhập':'Tạo tài khoản'); }
  }

  function startConversation() {
    if (!selectedScenario || conversation.active) return;
    stopChatDictation();
    conversation.active=true; conversation.scenario=selectedScenario.scenario; conversation.aiRole=selectedScenario.aiRole; conversation.userRole=selectedScenario.userRole; conversation.history=[]; conversation.turns=0; conversation.messageSequence=0;
    conversation.first=$('#speakerToggle button.active').data('first')||'user';
    $('.current-chat-level').text(state.level); $('#activeScenarioTitle').text(conversation.scenario);
    $('#userRoleLabel').text('Bạn: '+conversation.userRole); $('#aiRoleLabel').text('Mochi: '+conversation.aiRole);
    $('#chatMessages').empty(); $('#conversationSetup').addClass('hidden'); $('#conversationRoom').removeClass('hidden');
    appendSystemMessage(`Tình huống: ${conversation.scenario}. Hãy cố gắng trả lời bằng tiếng Anh nhé!`);
    updateConversationTurns();
    if (conversation.first==='ai') requestAiReply(true);
    else { setQuickReplies(['Hello! Can we start?','Hi, I’d like some help, please.']); $('#chatInput').focus(); }
  }

  function endConversation() {
    stopChatDictation();
    if (!conversation.active) { $('#conversationRoom').addClass('hidden'); $('#conversationSetup').removeClass('hidden'); return; }
    const learnerTurns=conversation.history.filter(item=>item.role==='user').length;
    conversation.active=false; speechPlaybackToken++; window.speechSynthesis?.cancel();
    $('#conversationRoom').addClass('hidden'); $('#conversationSetup').removeClass('hidden'); $('#quickReplies').empty();
    if (learnerTurns>0) { const reward=Math.min(20,5+learnerTurns*2); addXp(reward,Math.max(2,Math.min(10,learnerTurns))); toast(`Hoàn thành ${learnerTurns} lượt hội thoại. Tuyệt vời!`,'success'); }
  }

  function appendSystemMessage(text) {
    $('#chatMessages').append(`<div class="chat-message system"><div><p>${escapeHtml(text)}</p></div></div>`).scrollTop(99999);
  }

  function appendUserMessage(text) {
    const messageId='learner-message-'+(++conversation.messageSequence);
    $('#chatMessages').append(`<div class="chat-message user" id="${messageId}"><div class="user-message-wrap"><span>Bạn · ${escapeHtml(conversation.userRole)}</span><p>${escapeHtml(text)}</p><div class="user-review-slot"></div></div></div>`).scrollTop(99999);
    return messageId;
  }

  function appendAiMessage(rawData, showCorrection) {
    const data=normalizeAiResponse(rawData);
    const reply=aiText(data.reply||data.text,'Great! Please continue.');
    const correctionText=aiText(data.correction,'');
    const correction=showCorrection && correctionText ? `<p class="message-correction"><b>Mochi gợi ý:</b> ${escapeHtml(correctionText)}</p>`:'';
    $('#chatMessages').append(`<div class="chat-message bot"><img src="assets/mochi.png" alt=""><div><span>Mochi · ${escapeHtml(conversation.aiRole)}</span><p>${escapeHtml(reply)}</p>${correction}</div></div>`).scrollTop(99999);
    if (aiVoiceEnabled) speak(reply);
    return reply;
  }

  function reviewValue(review, data, keys, fallback) {
    for (const key of keys) if (review?.[key] || data?.[key]) return aiText(review?.[key] || data?.[key],fallback);
    return aiText('',fallback);
  }

  function renderUserReview(messageId, rawData, learnerText) {
    const data=normalizeAiResponse(rawData),review=data.review && typeof data.review === 'object' ? data.review : {};
    const numericScore=Number(data.score ?? review.score),score=Number.isFinite(numericScore)?Math.max(0,Math.min(100,Math.round(numericScore))):null;
    const grammar=reviewValue(review,data,['grammar','grammar_feedback'],'Cấu trúc câu phù hợp với trình độ hiện tại.');
    const spelling=reviewValue(review,data,['spelling','spelling_feedback'],'Không phát hiện lỗi chính tả đáng chú ý.');
    const naturalness=reviewValue(review,data,['naturalness','word_choice'],'Câu trả lời rõ ý; hãy ưu tiên cách diễn đạt tự nhiên, ngắn gọn.');
    const pronunciation=reviewValue(review,data,['pronunciation','pronunciation_tip'],'Nghe câu mẫu và chú ý trọng âm ở các từ mang nội dung chính.');
    const better=reviewValue(review,data,['better_version','betterVersion','corrected'],data.correction||learnerText);
    const scoreLabel=score===null?'AI review':score+' điểm';
    const scoreClass=score===null?'neutral':score>=80?'great':score>=60?'good':'practice';
    const reviewId=messageId+'-review';
    const html=`<button class="toggle-chat-review" type="button" aria-expanded="false" aria-controls="${reviewId}"><span class="review-score ${scoreClass}">${escapeHtml(scoreLabel)}</span><span>Xem nhận xét</span><i>⌄</i></button>
      <div class="chat-review-card" id="${reviewId}" hidden>
        <div class="chat-review-head"><div><small>✦ GEMINI REVIEW</small><strong>${score===null?'Nhận xét câu trả lời':score+' / 100 điểm'}</strong></div><span class="review-score-large ${scoreClass}">${score===null?'AI':score}</span></div>
        <div class="chat-review-row"><b>Ngữ pháp</b><span>${escapeHtml(grammar)}</span></div>
        <div class="chat-review-row"><b>Chính tả</b><span>${escapeHtml(spelling)}</span></div>
        <div class="chat-review-row"><b>Tự nhiên</b><span>${escapeHtml(naturalness)}</span></div>
        <div class="chat-review-row"><b>Phát âm</b><span>${escapeHtml(pronunciation)}</span></div>
        <div class="better-sentence"><small>CÁCH NÓI GỢI Ý</small><strong>${escapeHtml(better)}</strong><button class="play-review-sentence" type="button" aria-label="Nghe câu gợi ý">▶ Nghe mẫu</button></div>
      </div>`;
    const $slot=$('#'+messageId+' .user-review-slot').html(html);
    $slot.find('.play-review-sentence').data('sentence',String(better));
    $('#chatMessages').scrollTop(99999);
  }

  function setQuickReplies(suggestions) {
    const items=Array.isArray(suggestions)?suggestions.map(item=>aiText(item,'')).filter(Boolean).slice(0,3):[];
    $('#quickReplies').html(items.map(item=>`<button>${escapeHtml(item)}</button>`).join(''));
  }

  function updateConversationTurns() {
    $('#conversationTurnCount').text(conversation.turns+' lượt nói');
  }

  async function requestAiReply(opening, reviewTargetId) {
    const history=conversation.history.slice(-10).map(item=>(item.role==='user'?'Learner':'AI')+': '+item.text).join('\n');
    const context=`Scenario: ${conversation.scenario}. You are ${conversation.aiRole}. The learner is ${conversation.userRole}. CEFR level: ${state.level}. Stay in character. Use short, natural English appropriate for the level. Keep the roleplay moving with one useful question. Conversation so far:\n${history||'(not started yet)'}`;
    const input=opening?'Begin the roleplay now with a natural opening line.':conversation.history[conversation.history.length-1]?.text||'';
    $('#chatMessages').append('<div class="chat-message bot typing"><img src="assets/mochi.png" alt=""><div><span>Mochi · AI</span><p>Đang suy nghĩ...</p></div></div>').scrollTop(99999);
    $('#sendChat,#chatInput,#chatMic').prop('disabled',true);
    try {
      const data=normalizeAiResponse(await askGemini('chat',input,context));
      $('.chat-message.typing').remove();
      if (reviewTargetId) renderUserReview(reviewTargetId,data,input);
      const reply=appendAiMessage(data,!reviewTargetId);
      conversation.history.push({role:'assistant',text:reply}); conversation.turns++; updateConversationTurns(); setQuickReplies(data.suggestions);
    } catch(error) {
      $('.chat-message.typing').remove(); appendSystemMessage(error.message||'Mochi chưa thể trả lời. Hãy thử lại.');
    } finally { $('#sendChat,#chatInput,#chatMic').prop('disabled',false); $('#chatInput').focus(); }
  }

  async function sendChat() {
    if (!conversation.active) return;
    if (chatRecognitionShouldRun) return toast('Hãy nhấn nút Stop để kết thúc ghi âm trước khi gửi.','error');
    const input=$('#chatInput').val().trim(); if (!input) return;
    $('#chatInput').val(''); $('#quickReplies').empty(); const messageId=appendUserMessage(input);
    conversation.history.push({role:'user',text:input}); conversation.turns++; updateConversationTurns();
    await requestAiReply(false,messageId);
  }

  function startChatDictation() {
    const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if (!SpeechRecognition) return toast('Nhập giọng nói cần Chrome hoặc Edge.','error');
    if (chatRecognitionShouldRun) return stopChatDictation();
    chatRecognitionShouldRun=true;
    chatDictationBase=$('#chatInput').val().trim();
    setChatMicState(true);
    startChatRecognitionCycle(SpeechRecognition);
  }

  function startChatRecognitionCycle(SpeechRecognition) {
    if (!chatRecognitionShouldRun || !conversation.active || chatRecognition) return;
    const instance=new SpeechRecognition();
    chatRecognition=instance;
    instance.lang='en-US';
    instance.interimResults=true;
    instance.continuous=true;
    instance.maxAlternatives=1;
    instance.onstart=()=>setChatMicState(true);
    instance.onresult=event=>{
      let finalText='',interimText='';
      for (let i=0;i<event.results.length;i++) {
        const part=String(event.results[i][0]?.transcript||'').trim();
        if (!part) continue;
        if (event.results[i].isFinal) finalText+=(finalText?' ':'')+part;
        else interimText+=(interimText?' ':'')+part;
      }
      $('#chatInput').val([chatDictationBase,finalText,interimText].filter(Boolean).join(' ').replace(/\s+/g,' ').trim());
    };
    instance.onerror=event=>{
      const error=String(event.error||'');
      if (error==='not-allowed'||error==='service-not-allowed'||error==='audio-capture') {
        chatRecognitionShouldRun=false;
        setChatMicState(false);
        toast(error==='audio-capture'?'Không tìm thấy microphone.':'Bạn chưa cấp quyền microphone.','error');
      } else if (error!=='no-speech'&&error!=='aborted') {
        toast('Kết nối nhận diện giọng nói bị gián đoạn, Mochi đang kết nối lại.','error');
      }
    };
    instance.onend=()=>{
      if (chatRecognition===instance) chatRecognition=null;
      chatDictationBase=$('#chatInput').val().trim();
      if (!chatRecognitionShouldRun) { setChatMicState(false); $('#chatInput').focus(); return; }
      clearTimeout(chatRecognitionRestartTimer);
      chatRecognitionRestartTimer=setTimeout(()=>startChatRecognitionCycle(SpeechRecognition),180);
    };
    try { instance.start(); }
    catch (_) {
      if (chatRecognition===instance) chatRecognition=null;
      if (chatRecognitionShouldRun) {
        clearTimeout(chatRecognitionRestartTimer);
        chatRecognitionRestartTimer=setTimeout(()=>startChatRecognitionCycle(SpeechRecognition),350);
      }
    }
  }

  function stopChatDictation() {
    chatRecognitionShouldRun=false;
    clearTimeout(chatRecognitionRestartTimer);
    chatRecognitionRestartTimer=null;
    const instance=chatRecognition;
    chatRecognition=null;
    if (instance) try { instance.stop(); } catch (_) { try { instance.abort(); } catch (__) {} }
    chatDictationBase=$('#chatInput').val().trim();
    setChatMicState(false);
    $('#chatInput').focus();
  }

  function setChatMicState(listening) {
    $('#chatMic').toggleClass('listening',!!listening).attr({
      'aria-label':listening?'Dừng ghi âm':'Nhập bằng giọng nói',
      'title':listening?'Đang ghi liên tục · Nhấn Stop để dừng':'Nhập bằng giọng nói',
      'aria-pressed':String(!!listening)
    });
  }

  function updateFlashcard() {
    const {level,deck,index,item:card,itemIndex}=activePracticeData('vocabulary'); if (!card) return;
    state.memoryIndex=itemIndex; $('#practice-vocabulary').removeClass('session-complete'); $('#vocabularySummary').addClass('hidden').empty(); $('#flashcard').removeClass('flipped'); $('#vocabularyLevel').text('TỪ VỰNG · '+level+' · '+currentGoal().name);
    setTimeout(()=>{ $('#flashWord').text(card.word).next().text(card.phonetic).prev().prev().text(card.icon); $('#flashMeaning').text(card.meaning); $('#flashExample').text(card.example).next().text(card.vi); $('#flashCount').text((index+1)+' / '+deck.length); },220);
    saveState(false);
  }
  function confetti() {
    const colors=['#6454ed','#ff715b','#ffc94c','#22b887','#4b8df8'];
    for(let i=0;i<55;i++) $('<i>').css({left:Math.random()*100+'%',background:colors[i%colors.length],'--drift':(Math.random()*180-90)+'px',animationDelay:Math.random()*.5+'s'}).appendTo('#confetti');
    setTimeout(()=>$('#confetti').empty(),3200);
  }

  async function init() {
    if (!CURRICULUM) {
      $('body').prepend('<div class="content-load-error">Không tải được Content V2. Hãy deploy curriculum-data.js và hard refresh (Ctrl+F5); ứng dụng đang chặn bộ bài cũ.</div>');
      return;
    }
    document.documentElement.setAttribute('data-content-version',CURRICULUM.version||'v2');
    if (state.lastActive !== todayKey()) state.completedToday=[];
    renderState(); populateTopicSelect('#vocabularyTopicSelect',state.vocabularyTopic||'all'); populateTopicSelect('#challengeTopicSelect',state.challengeTopic||'all'); renderRoadmap(state.level); updateFlashcard(); renderPractice('listening'); setupRecognition(); bindEvents(); bindActivityTracking(); populateVoiceSettings();
    if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged',populateVoiceSettings);
    await getStatus();
    const route=location.hash.replace('#',''); routeTo(route || 'home');
  }

  $(init);
})(jQuery);
