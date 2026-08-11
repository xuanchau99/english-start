/* global jQuery */
(function ($) {
  'use strict';

  const LEGACY_STORAGE_KEY = 'fluentgo_state_v1';
  const USER_STORAGE_PREFIX = 'fluentgo_state_v2_';
  const SESSION_TOKEN_KEY = 'fluentgo_session_token';
  const APPS_SCRIPT_URL = String(window.FLUENTGO_CONFIG?.appsScriptUrl || '').trim();
  const CURRICULUM = window.FLUENTGO_CURRICULUM || null;
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const defaults = {
    userId: '', username:'', name: 'Người học', email:'', level: 'A1', dailyGoal: 15,
    learningGoal:'general', roadmapUnit:0, practiceTopic:'all', vocabularyTopic:'all', challengeTopic:'all', challengeType:'all', voiceName:'', speechRate:0.9,
    xp: 1240, streak: 7, longestStreak: 12, minutesWeek: 78,
    lastActive: todayKey(), lastCompletedDay: '', completedToday: ['warmup'],
    completedLessons: ['A1-0','A1-1','A1-2','A1-3','A1-4'], lessonProgress: { daily: 35 },
    wordsLearned: 24, vocabularyReview:{}, exerciseMastery:{}, practiceStats:{listening:{done:0,correct:0},reading:{done:0,correct:0},speaking:{done:0},writing:{done:0}}, mistakes: [
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
  let mediaRecorder = null;
  let mediaStream = null;
  let audioChunks = [];
  let recordedAudio = null;
  let syncTimer = null;
  let syncInFlight = false;
  let syncPending = false;
  let lastSyncedFingerprint = '';
  let aiRequestInFlight = false;
  let lastAiRequestAt = 0;
  let selectedScenario = null;
  let aiVoiceEnabled = true;
  let chatRecognition = null;
  let chatRecognitionShouldRun = false;
  let chatRecognitionRestartTimer = null;
  let chatDictationBase = '';
  const practiceSession = {level:'',goal:'',topic:'all',listening:0,reading:0,speaking:0,writing:0,vocabulary:0,challenge:0,listeningQueue:null,readingQueue:null,vocabularyQueue:null,challengeQueue:null,aiChallengeDeck:null,listeningResults:[],readingResults:[],speakingResults:[],writingResults:[],vocabularyResults:[],challengeResults:[]};
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
  function renderRoadmap(level) {
    level=level||state.level;
    if (!CURRICULUM) {
      const items=roadmapData[level]||roadmapData.A1,completed=new Set(state.completedLessons||[]),nextIndex=Math.max(0,items.findIndex((_,index)=>!completed.has(level+'-'+index)));
      const doneCount=items.filter((_,index)=>completed.has(level+'-'+index)).length,progress=Math.round(doneCount/items.length*100);
      $('#roadmapRing').css('--progress',progress).find('span').text(progress+'%'); $('#roadmapCount').text(doneCount+'/'+items.length+' bài');
      return $('#roadmap').html(items.map((item,i)=>`<div class="road-node ${i%2?'right':'left'} ${completed.has(level+'-'+i)?'done':i===nextIndex?'current':'locked'}" data-index="${i}" data-level="${level}"><div class="node-circle">${completed.has(level+'-'+i)?'✓':i===nextIndex?'▶':'🔒'}</div><div class="node-info"><small>${item[1]}</small><strong>${item[0]}</strong></div></div>`).join(''));
    }
    const units=CURRICULUM.getRoadmap(currentGoalId(),level),unitIndex=Math.min(11,Math.max(0,Number(state.roadmapUnit)||0)),unit=units[unitIndex],items=unit.lessons,completed=new Set(state.completedLessons||[]);
    const doneCount=items.filter(item=>completed.has(item.id)).length,progress=Math.round(doneCount/items.length*100),firstPending=Math.max(0,items.findIndex(item=>!completed.has(item.id)));
    $('#roadmapGoalSelect').html(goalOptions(currentGoalId())).val(currentGoalId());
    $('#roadmapUnitSelect').html(units.map((value,index)=>`<option value="${index}">Chặng ${index+1} · ${escapeHtml(value.title)}</option>`).join('')).val(String(unitIndex));
    $('#previousRoadmapUnit').prop('disabled',unitIndex===0); $('#nextRoadmapUnit,#openNextUnit').prop('disabled',unitIndex===units.length-1);
    $('#roadmapStage').text('CHẶNG '+String(unitIndex+1).padStart(2,'0')+' / 12 · '+level+' · '+currentGoal().name.toUpperCase()); $('#roadmapTitle').text(unit.title); $('#roadmapDescription').text(unit.description+' Bạn có thể mở mọi bài và học vượt kế hoạch.');
    $('#guidebookTitle').text(unit.englishTitle+' · '+level); $('#guidebookOutcomes').html(unit.guidebook.outcomes.map(outcome=>`<span>✓ ${escapeHtml(outcome)}</span>`).join('')); $('#guidebookPhrases').html(`<small>KEY PHRASES</small>${unit.guidebook.keyPhrases.map(phrase=>`<button class="guidebook-sound" data-phrase="${escapeHtml(phrase)}">♫ ${escapeHtml(phrase)}</button>`).join('')}<em>Grammar: ${escapeHtml(unit.guidebook.grammar)}</em>`);
    $('.unit-header .unit-number').text(String(unitIndex+1).padStart(2,'0')); $('#roadmapRing').css('--progress',progress).find('span').text(progress+'%'); $('#roadmapCount').text(doneCount+'/'+items.length+' bài');
    const nextUnit=units[Math.min(unitIndex+1,units.length-1)]; $('#nextUnitTitle').text(unitIndex<units.length-1?'Chặng tiếp: '+nextUnit.title:'Bạn đã mở toàn bộ lộ trình'); $('#nextUnitDescription').text(unitIndex<units.length-1?nextUnit.description:'Hãy hoàn thiện các bài còn thiếu hoặc đổi mục tiêu để khám phá lộ trình mới.');
    $('#roadmap').html(items.map((item,i)=>{
      const status=completed.has(item.id)?'done':i===firstPending?'current':'available',icon=status==='done'?'✓':status==='current'?'▶':String(i+1);
      return `<div class="road-node ${i%2?'right':'left'} ${status}" data-index="${i}" data-level="${level}" data-unit="${unitIndex}"><div class="node-circle">${icon}</div><div class="node-info"><small>${escapeHtml(item.type)} · ${item.minutes} PHÚT</small><strong>${escapeHtml(item.title)}</strong></div></div>`;
    }).join(''));
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
    if (route!=='practice') stopSpeakingRecording(true);
    $('.view').removeClass('active'); $('#view-' + route).addClass('active');
    $('[data-route]').removeClass('active').filter(`[data-route="${route}"]`).addClass('active');
    try { history.replaceState(null, '', '#' + route); } catch (_) { location.hash = route; }
    window.scrollTo({ top:0, behavior:'smooth' });
  }

  function switchPractice(type) {
    if (type!=='speaking') stopSpeakingRecording(true);
    routeTo('practice');
    $('.practice-tab').removeClass('active').filter(`[data-practice="${type}"]`).addClass('active');
    $('.practice-pane').removeClass('active'); $('#practice-' + type).addClass('active');
    renderPractice(type);
    setTimeout(() => $('#view-practice')[0].scrollIntoView({ behavior:'smooth', block:'start' }), 50);
  }

  function activePracticeData(type) {
    const level=practiceData[state.level] ? state.level : 'A1';
    const goal=currentGoalId(),topic=type==='vocabulary'?(state.vocabularyTopic||'all'):(state.practiceTopic||'all');
    if (practiceSession.level!==level||practiceSession.goal!==goal||practiceSession.topic!==topic) resetPracticeSessions(level,goal,topic);
    const sourceDeck=curriculumDeck(type,topic),queueKey=type+'Queue',resultsKey=type+'Results';
    if (['listening','reading','vocabulary'].includes(type) && !Array.isArray(practiceSession[queueKey])) {
      practiceSession[queueKey]=sourceDeck.map((_,index)=>index);
      if (type==='vocabulary') practiceSession[queueKey]=practiceSession[queueKey].sort((a,b)=>vocabularyStrength(level,sourceDeck[a])-vocabularyStrength(level,sourceDeck[b])).slice(0,Math.min(12,sourceDeck.length));
      practiceSession[resultsKey]=[];
    }
    const queue=Array.isArray(practiceSession[queueKey])?practiceSession[queueKey]:sourceDeck.map((_,index)=>index),deck=queue.map(index=>sourceDeck[index]);
    const index=Math.min(Math.max(0,Number(practiceSession[type])||0),Math.max(0,deck.length-1)),itemIndex=queue[index]??index;
    return {level,deck,sourceDeck,queue,index,itemIndex,item:sourceDeck[itemIndex]};
  }

  function resetPracticeSessions(level,goal,topic) {
    practiceSession.level=level||state.level;
    practiceSession.goal=goal||currentGoalId(); practiceSession.topic=topic||'all';
    ['listening','reading','speaking','writing','vocabulary','challenge'].forEach(type=>{ practiceSession[type]=0; });
    ['listening','reading','speaking','writing','vocabulary','challenge'].forEach(type=>{ practiceSession[type+'Queue']=null; practiceSession[type+'Results']=[]; });
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
    const previous=(practiceSession[type+'Results']||[]).map(result=>result.itemIndex),previousSet=new Set(previous);
    const fresh=indexes?.length?indexes.slice():(type==='vocabulary'?shuffledIndexes(source.length).filter(index=>!previousSet.has(index)).concat(shuffledIndexes(source.length).filter(index=>previousSet.has(index))):shuffledIndexes(source.length));
    practiceSession[type]=0; practiceSession[type+'Queue']=type==='vocabulary'&&!indexes?.length?fresh.slice(0,Math.min(12,source.length)):fresh; practiceSession[type+'Results']=[];
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
    if (reset||!Array.isArray(practiceSession.challengeQueue)||practiceSession.challengeQueue.some(index=>index>=source.length)) {
      const randomOrder=shuffledIndexes(source.length),randomRank={}; randomOrder.forEach((value,index)=>{ randomRank[value]=index; });
      practiceSession.challengeQueue=source.map((_,index)=>index).sort((a,b)=>exerciseStrength(source[a])-exerciseStrength(source[b])||randomRank[a]-randomRank[b]).slice(0,Math.min(20,source.length)); practiceSession.challenge=0; practiceSession.challengeResults=[];
    }
    const deck=practiceSession.challengeQueue.map(index=>source[index]),index=Math.min(Number(practiceSession.challenge)||0,Math.max(0,deck.length-1));
    return {source,deck,index,item:deck[index]};
  }

  function renderChallenge(reset) {
    if (!CURRICULUM) return;
    const typeOptions='<option value="all">Trộn 8 dạng bài</option>'+CURRICULUM.types.filter(type=>!['speaking','writing'].includes(type[0])).map(type=>`<option value="${type[0]}">${escapeHtml(type[1])}</option>`).join('');
    $('#challengeTypeSelect').html(typeOptions).val(state.challengeType||'all'); populateTopicSelect('#challengeTopicSelect',state.challengeTopic||'all');
    const {deck,index,item}=activeChallengeData(reset); if (!item) return;
    $('#practice-challenge').removeClass('session-complete'); $('#challengeSummary').addClass('hidden').empty();
    $('#challengeLevel').text((generated?'AI PRACTICE SET':'PRACTICE LAB')+' · '+state.level+' · ƯU TIÊN NỘI DUNG YẾU'); $('#challengeProgress').text('Câu '+(index+1)+' / '+deck.length); $('#challengeTypeLabel').text(item.typeLabel.toUpperCase()+' · '+String(item.topicEn||item.topic).toUpperCase()); $('#challengeQuestion').text(item.question);
    $('#challengeAnswers').removeData('done').html(choiceButtons(item.options,item.options.indexOf(item.answer))); $('#challengeFeedback').removeClass('show success error').empty(); $('#challengeAiFeedback').removeClass('show').empty(); $('#explainChallenge,#nextChallenge').addClass('hidden');
    $('#playChallengeAudio').toggleClass('hidden',!item.audio).data('audio',item.audio||'');
    $('#challengePassage').toggleClass('hidden',!item.passage).text(item.passage||'');
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
    const html=`<img class="summary-mascot" src="assets/mochi.png" alt="Mochi chúc mừng"><span class="section-kicker">HOÀN THÀNH PHIÊN</span><h2>Bạn đã xong ${escapeHtml(label)}!</h2><p>Phiên học đã dừng để bạn xem kết quả. Hãy luyện lại phần chưa chắc hoặc bắt đầu một bộ đã trộn thứ tự.</p><div class="summary-score"><div><strong>${total}</strong><span>${unit.toUpperCase()} ĐÃ HỌC</span></div><div><strong>${correct}</strong><span>ĐÃ NẮM</span></div><div><strong>${accuracy}%</strong><span>CHÍNH XÁC</span></div></div><div class="summary-actions">${retryButton}<button class="primary-btn session-restart" data-type="${type}">Trộn & học phiên mới →</button></div><small class="summary-note">Kết quả đã được lưu vào tiến độ học tập.</small>`;
    $('#practice-'+type).addClass('session-complete'); $('#'+type+'Summary').html(html).removeClass('hidden');
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

  function speak(text, rateMultiplier) {
    if (!('speechSynthesis' in window)) return toast('Trình duyệt chưa hỗ trợ đọc văn bản.', 'error');
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices=englishVoices(),preferred=voices.find(voice=>voice.name===state.voiceName),fallback=voices.find(voice=>/^en-(US|GB)$/i.test(voice.lang))||voices[0]||null;
    utterance.voice=preferred||fallback; utterance.lang=utterance.voice?.lang||'en-US'; utterance.rate=Math.max(.5,Math.min(1.4,Number(state.speechRate)||.9))*(Number(rateMultiplier)||1); utterance.pitch=1;
    speechSynthesis.speak(utterance); return utterance;
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
    ['completedToday','completedLessons','week','mistakes'].forEach(key=>{ if (Array.isArray(selected[key])) merged[key]=selected[key].slice(); });
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
    localStorage.setItem(USER_STORAGE_PREFIX+state.userId,JSON.stringify(state));
    resetGoalDrivenSessions(); renderState(); populateTopicSelect('#vocabularyTopicSelect',state.vocabularyTopic||'all'); populateTopicSelect('#challengeTopicSelect',state.challengeTopic||'all'); renderRoadmap(state.level); updateFlashcard(); renderPractice($('.practice-tab.active').data('practice')||'listening');
    $('#authGate').addClass('hidden').attr('aria-hidden','true'); clearAuthMessage();
    setTimeout(() => syncProgress(false),250);
    if (isNewAccount) toast('Chào mừng bạn đến với FluentGo! ✨','success');
  }

  function showAuthGate(message) {
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
      const timeout=setTimeout(() => { bridgeRequests.delete(id); reject(new Error('Apps Script phản hồi quá thời gian.')); },60000);
      bridgeRequests.set(id,{resolve,reject,timeout});
      bridgeMessageWindow.postMessage({source:'fluentgo-parent',type:'request',id,action,payload,sessionToken:currentSessionToken},'*');
    });
  }

  async function askGemini(mode, input, context, extra) {
    if (!bridgeReady || !serverStatus.gemini) throw new Error('Gemini chưa sẵn sàng trên Apps Script. Hãy kiểm tra FluentGo Config.');
    if (!authUser || !currentSessionToken) throw new Error('Vui lòng đăng nhập để sử dụng Gemini AI.');
    if (aiRequestInFlight) throw new Error('Mochi đang xử lý một yêu cầu khác. Vui lòng chờ một chút.');
    if (Date.now()-lastAiRequestAt<1800) throw new Error('Bạn thao tác hơi nhanh. Hãy chờ 2 giây rồi thử lại.');
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
    const html = `<div class="feedback-score"><span class="score-circle">${score}</span><div><h4>✦ ${escapeHtml(title)}</h4><p>Nhận xét bởi Gemini AI</p></div></div>
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

  function buildLessonSteps(level,index,unitIndex) {
    const unit=CURRICULUM?.getRoadmap(currentGoalId(),level)?.[unitIndex||0],lesson=unit?.lessons?.[index];
    if (!unit||!lesson) return [{type:'intro',emoji:'🚀',title:'English lesson',copy:'Practice English in context.'},{type:'complete',emoji:'✨',title:'Lesson complete!',copy:'Keep going.'}];
    const byType=type=>unit.exercises.filter(exercise=>exercise.type===type),choice=(exercise,emoji,title)=>({type:'choice',emoji,title:title||exercise.typeLabel,copy:exercise.passage||'',question:exercise.question,options:exercise.options,correct:exercise.options.indexOf(exercise.answer),audio:exercise.audio||'',explanation:exercise.explanation||''});
    const intro={type:'intro',emoji:['📘','🎧','📖','🧩','🎤','🏆'][index]||'🚀',title:lesson.title,copy:`${unit.englishTitle} · ${level} · ${lesson.minutes} minutes`,outcomes:unit.guidebook.outcomes};
    const complete={type:'complete',emoji:'✨',title:`${lesson.title} complete!`,copy:'You used English to understand and respond. The next lesson is ready.'};
    const speaking=byType('speaking'),listening=byType('listening'),reading=byType('reading'),cloze=byType('cloze'),grammar=byType('grammar'),ordering=byType('ordering'),matching=byType('matching'),translation=byType('translation'),dictation=byType('dictation');
    const plans=[
      [choice(matching[0],'🔗','Match a key phrase'),choice(cloze[0],'✍️','Complete the sentence'),choice(ordering[0],'🧱','Build the sentence'),{type:'speak',emoji:'🎤',title:'Say the key phrase',copy:'Listen first, then repeat it naturally.',question:speaking[0].target}],
      [choice(listening[0],'🎧','Listen for the main idea'),choice(listening[1],'👂','Listen for a key word'),choice(dictation[0],'⌨️','Sound-to-sentence'),{type:'speak',emoji:'🎤',title:'Shadow the speaker',copy:'Copy the rhythm and stress, not only the words.',question:speaking[0].target}],
      [choice(reading[0],'📖','Read for the main idea'),choice(reading[1],'🔎','Find evidence'),choice(cloze[1],'✍️','Use a word from the story'),{type:'speak',emoji:'💬',title:'Retell one idea',copy:'Say the sentence, then change one detail.',question:speaking[1].target}],
      [choice(grammar[0],'🧩','Choose correct usage'),choice(grammar[1],'✅','Check the second phrase'),choice(ordering[0],'🧱','Build an accurate sentence'),choice(ordering[1],'⚡','Build another sentence')],
      [{type:'speak',emoji:'🎤',title:'Speak with confidence',copy:'Listen, repeat, then make one personal example.',question:speaking[0].target},{type:'speak',emoji:'🗣️',title:'Extend your answer',copy:'Repeat the model and add one reason.',question:speaking[1].target},choice(translation[0],'🌐','Express the idea in English'),choice(translation[1],'✍️','Choose a natural response')],
      [choice(listening[1],'🎧','Listening checkpoint'),choice(reading[1],'📖','Reading checkpoint'),choice(grammar[0],'🧩','Grammar checkpoint'),choice(cloze[1],'✍️','Vocabulary checkpoint'),choice(ordering[1],'🏁','Final challenge')]
    ];
    return [intro].concat(plans[index]||plans[0],[complete]);
  }

  function openLesson(index,level,unitIndex) {
    level=typeof level==='string'?level:state.level; unitIndex=Number.isInteger(unitIndex)?unitIndex:Number(state.roadmapUnit)||0;
    const curriculumUnit=CURRICULUM?.getRoadmap(currentGoalId(),level)?.[unitIndex],items=curriculumUnit?.lessons||(roadmapData[level]||roadmapData.A1);
    if (!Number.isInteger(index)) { const completed=new Set(state.completedLessons||[]),next=items.findIndex((item,i)=>!completed.has(item.id||level+'-'+i)); index=next<0?items.length-1:next; }
    const selected=items[index]; state.roadmapUnit=unitIndex; activeRoadmapLesson={level,index,unit:unitIndex,id:selected.id||level+'-'+index,title:selected.title||selected[0]};
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
    if (step.type === 'choice') body = `<div class="lesson-screen"><div class="lesson-emoji">${step.emoji}</div><h2>${escapeHtml(step.title)}</h2>${step.audio?'<button class="lesson-audio">▶ Listen</button>':''}${step.copy?`<div class="lesson-passage">${escapeHtml(step.copy)}</div>`:''}<div class="lesson-question"><strong>${escapeHtml(step.question)}</strong></div><div class="lesson-options">${step.options.map((o,i)=>`<button data-answer="${i}">${String.fromCharCode(65+i)}. ${escapeHtml(o)}</button>`).join('')}</div><div class="lesson-nav"><button class="primary-btn lesson-check" disabled>Check answer</button></div></div>`;
    if (step.type === 'speak') body = `<div class="lesson-screen"><div class="lesson-emoji">${step.emoji}</div><h2>${escapeHtml(step.title)}</h2><p>${escapeHtml(step.copy)}</p><div class="lesson-question" style="text-align:center"><button class="tiny-sound lesson-sound">♫</button><h3>${escapeHtml(step.question)}</h3></div><div class="lesson-nav"><button class="secondary-btn lesson-sound">Listen again</button><button class="primary-btn lesson-next">I said it →</button></div></div>`;
    if (step.type === 'complete') body = `<div class="lesson-screen lesson-complete"><img src="assets/mochi.png" class="mascot-img" alt="Mochi chúc mừng"><h2>${escapeHtml(step.title)}</h2><p>${escapeHtml(step.copy)}</p><div class="xp-earned">+25 XP</div><p>🔥 Không giới hạn số bài trong ngày</p><button class="primary-btn lesson-finish">Nhận thưởng & mở bài tiếp</button></div>`;
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
    $(document).on('click','.lesson-sound',()=>{ const step=lessonSteps[currentLessonStep]; if (step?.question) speak(step.question); });
    $(document).on('click','.lesson-audio',()=>{ const step=lessonSteps[currentLessonStep]; if (step?.audio) speak(step.audio); });
    $(document).on('click','.guidebook-sound',function(){ speak($(this).data('phrase')||''); });
    $(document).on('click','.lesson-options button', function(){ selectedLessonAnswer = Number($(this).data('answer')); $('.lesson-options button').removeClass('selected'); $(this).addClass('selected'); $('.lesson-check').prop('disabled',false); });
    $(document).on('click','.lesson-check', function(){
      const step=lessonSteps[currentLessonStep],correct=selectedLessonAnswer===step.correct,$buttons=$('.lesson-options button');
      $buttons.prop('disabled',true).eq(step.correct).addClass('answer-correct'); if (!correct) $buttons.eq(selectedLessonAnswer).addClass('answer-wrong');
      $('.lesson-nav').html(`<div class="lesson-feedback ${correct?'success':'error'}"><strong>${correct?'✓ Correct!':'Not quite yet'}</strong><span>${escapeHtml(step.explanation||'Read the complete sentence once more.')}</span></div><button class="primary-btn lesson-next">Continue →</button>`);
      if (!correct) state.mistakes.unshift({type:'Lesson',wrong:$buttons.eq(selectedLessonAnswer).text().replace(/^[A-Z]\.\s*/,''),right:$buttons.eq(step.correct).text().replace(/^[A-Z]\.\s*/,''),note:step.title});
    });
    $(document).on('click','.lesson-finish', function(){
      if (!activeRoadmapLesson) return closeLesson();
      const firstCompletion=!state.completedLessons.includes(activeRoadmapLesson.id);
      if (firstCompletion) state.completedLessons.push(activeRoadmapLesson.id);
      if (!state.completedToday.includes(activeRoadmapLesson.id)) state.completedToday.push(activeRoadmapLesson.id);
      state.lessonProgress[activeRoadmapLesson.id]=100; if (firstCompletion) addXp(25,10); else saveState(true);
      confetti(); closeLesson(); renderRoadmap(activeRoadmapLesson.level);
      $('.task-card[data-lesson="daily"]').addClass('completed').removeClass('current').find('.mini-progress i').css('width','100%');
      toast(firstCompletion?'Bài tiếp theo đã mở — bạn có thể học tiếp ngay!':'Bạn vừa ôn lại bài này.','success');
    });

    $('#playListening').on('click', function(){
      const item=activePracticeData('listening').item; if (!item) return;
      $('.audio-wave').addClass('playing'); const u = speak(item.audio,listeningSpeedMultiplier);
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
      practiceSession[type+'Results'].push({itemIndex:data.itemIndex,correct});
      updateExerciseMastery(item,correct);
      state.practiceStats[type]=state.practiceStats[type]||{done:0,correct:0}; state.practiceStats[type].done++; if (correct) state.practiceStats[type].correct++;
      if (!correct) state.mistakes.unshift({type:type==='listening'?'Nghe':'Đọc',wrong:$(this).text().replace(/^[A-Z]\s*/,''),right:item.options[item.correct],note:item.question});
      if (correct) addXp(5,2); else saveState(true);
      if (type==='listening') { $('#showListeningTranscript').removeClass('hidden'); $('#listeningTranscript').removeClass('hidden').text(item.audio); $('#showListeningTranscript').text('Ẩn transcript'); }
      $(type==='listening'?'#nextListening':'#nextReading').text(data.index>=data.deck.length-1?'Xem kết quả →':(type==='listening'?'Câu tiếp theo →':'Bài tiếp theo →')).removeClass('hidden');
    });
    $('#showListeningTranscript').on('click',function(){ const opening=$('#listeningTranscript').hasClass('hidden'); $('#listeningTranscript').toggleClass('hidden',!opening); $(this).text(opening?'Ẩn transcript':'▤ Xem transcript'); });
    $('#listeningFeedback').on('click','.replay-listening-answer',function(){ const item=activePracticeData('listening').item; if (item) speak(item.audio,listeningSpeedMultiplier); });
    $('#nextListening').on('click',()=>nextPractice('listening')); $('#nextReading').on('click',()=>nextPractice('reading'));
    $('#playSpeakingSample').on('click', () => { const item=activePracticeData('speaking').item; if (item) speak(item.target); });
    $('#readPassage').on('click', () => { const item=activePracticeData('reading').item; if (item) speak(item.passage); });
    $('#recordBtn').on('click', async function(){
      if (speakingRecordingActive) return stopSpeakingRecording();
      transcript = ''; recordedAudio = null; $('#liveTranscript').text('Đang khởi động microphone...');
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
      try { const data = await askGemini('speaking', transcript, 'Target sentence: '+item.target+'. Listen to the attached recording when present. Evaluate accuracy, clarity, rhythm and useful pronunciation improvements.', recordedAudio); const score=Math.max(0,Math.min(100,Number(data.score)||0)),correct=score>=70; showAiFeedback('#speechFeedback', data, 'speech'); practiceSession.speakingResults.push({itemIndex:active.itemIndex,correct,score}); updateExerciseMastery(item,correct); state.practiceStats.speaking.done++; state.practiceStats.speaking.correct=Number(state.practiceStats.speaking.correct||0)+(correct?1:0); addXp(8,3); $('#analyzeSpeech').addClass('hidden'); $('#nextSpeaking').removeClass('hidden'); }
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
      try { const data = await askGemini('writing',text,'Writing task: '+item.instruction); const score=Math.max(0,Math.min(100,Number(data.score)||0)),correct=score>=70; showAiFeedback('#writingFeedback',data,'writing'); practiceSession.writingResults.push({itemIndex:active.itemIndex,correct,score}); updateExerciseMastery(item,correct); state.practiceStats.writing.done++; state.practiceStats.writing.correct=Number(state.practiceStats.writing.correct||0)+(correct?1:0); addXp(12,4); if (data.corrected&&data.corrected!==text) state.mistakes.unshift({type:'Ngữ pháp',wrong:text.slice(0,90),right:data.corrected.slice(0,90),note:item.title}); saveState(true); $('#checkWriting').addClass('hidden'); $('#nextWriting').removeClass('hidden'); }
      catch(e) { $('#writingFeedback').removeClass('show'); toast(e.responseJSON?.error || e.message || 'Gemini chưa thể sửa bài.', 'error'); }
      finally { $(this).prop('disabled',false); }
    });
    $('#nextWriting').on('click',()=>nextPractice('writing'));

    $('#flashcard').on('click keydown', function(e){ if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') $(this).toggleClass('flipped'); });
    $('.flash-actions button').on('click', function(){
      const data=activePracticeData('vocabulary'),isEasy=$(this).data('memory')==='easy';
      practiceSession.vocabularyResults.push({itemIndex:data.itemIndex,correct:isEasy});
      const isNewWord=updateVocabularyReview(data.level,data.item,isEasy);
      if (isEasy) { if (isNewWord) state.wordsLearned++; addXp(2,1); }
      else saveState(true);
      if (data.index>=data.deck.length-1) renderFiniteSummary('vocabulary');
      else { practiceSession.vocabulary=data.index+1; updateFlashcard(); }
    });
    $('#challengeTypeSelect,#challengeTopicSelect').on('change',function(){ state.challengeType=$('#challengeTypeSelect').val()||'all'; state.challengeTopic=$('#challengeTopicSelect').val()||'all'; practiceSession.aiChallengeDeck=null; practiceSession.challengeQueue=null; saveState(true); renderChallenge(true); });
    $('#generateAiChallenge').on('click',async function(){
      const $button=$(this),roadmap=CURRICULUM?.getRoadmap(currentGoalId(),state.level)||[],selectedTopic=state.challengeTopic&&state.challengeTopic!=='all'?state.challengeTopic:(roadmap[Number(state.roadmapUnit)||0]?.title||currentGoal().name),selectedType=state.challengeType||'all';
      $button.prop('disabled',true).text('✦ AI đang soạn...');
      try {
        const data=await askGemini('exercise','Create a fresh English practice set for this learner.','Topic: '+selectedTopic+'. Requested exercise type: '+selectedType+'. Keep all questions and answer options in English, except a translation prompt may start in Vietnamese.');
        const allowed=new Set(CURRICULUM.types.filter(type=>!['speaking','writing'].includes(type[0])).map(type=>type[0])),raw=Array.isArray(data.exercises)?data.exercises:[];
        const generated=raw.slice(0,8).map((item,index)=>{
          const type=allowed.has(item.type)?item.type:'grammar',options=Array.isArray(item.options)?item.options.map(String).filter(Boolean).slice(0,4):[],answer=String(item.answer||'');
          if (options.length<3||!options.includes(answer)||!String(item.question||'').trim()) return null;
          return {id:'ai-'+Date.now()+'-'+index,goalId:currentGoalId(),level:state.level,topic:selectedTopic,topicEn:selectedTopic,type,typeLabel:CURRICULUM.types.find(value=>value[0]===type)?.[1]||'AI practice',question:String(item.question),options,answer,explanation:String(item.explanation||'Review the answer in context.'),audio:item.audio?String(item.audio):'',passage:item.passage?String(item.passage):''};
        }).filter(Boolean);
        if (generated.length<3) throw new Error('AI chưa tạo đủ câu hợp lệ. Hãy thử lại.');
        practiceSession.aiChallengeDeck=generated; practiceSession.challengeQueue=null; renderChallenge(true); toast('Đã tạo '+generated.length+' câu mới theo đúng mục tiêu và trình độ.','success');
      } catch(error) { toast(error.message||'Chưa thể tạo bộ bài AI.','error'); }
      finally { $button.prop('disabled',false).text('✦ AI tạo bộ mới'); }
    });
    $('#playChallengeAudio').on('click',function(){ speak($(this).data('audio')||''); });
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
    $(document).on('click','.session-retry',function(){
      const type=String($(this).data('type')),wrong=(practiceSession[type+'Results']||[]).filter(result=>!result.correct).map(result=>result.itemIndex);
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
    conversation.active=false; window.speechSynthesis?.cancel();
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
    renderState(); populateTopicSelect('#vocabularyTopicSelect',state.vocabularyTopic||'all'); populateTopicSelect('#challengeTopicSelect',state.challengeTopic||'all'); renderRoadmap(state.level); updateFlashcard(); renderPractice('listening'); setupRecognition(); bindEvents(); populateVoiceSettings();
    if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged',populateVoiceSettings);
    await getStatus();
    const route=location.hash.replace('#',''); routeTo(route || 'home');
  }

  $(init);
})(jQuery);
