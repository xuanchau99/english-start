/**
 * Cấu hình dành cho chủ ứng dụng, không hiển thị trong UI.
 * Cấu hình nằm trong source vì ứng dụng được chủ dự án dùng riêng.
 * LƯU Ý: mọi key trong frontend đều có thể xem bằng DevTools dù repository private.
 */
window.FLUENTGO_CONFIG = Object.freeze({
  appsScriptUrl: 'https://script.google.com/macros/s/AKfycbz1Ks-lMPvDKDdCVFZnuGifSVKW589WPDHVovLlGC3Bz6s3acm8o4nxZk0_ou9Uc3xDWQ/exec',
  geminiApiKey: 'AQ.Ab8RN6K1G1ocIkKkSG7O0uu_t3SnMovQgoOULkKCQa0Cgb_LrQ',
  geminiKeyFile: 'key_ai.txt',
  geminiModel: 'gemini-3.5-flash',
  dailyAiLimit: 100
});
