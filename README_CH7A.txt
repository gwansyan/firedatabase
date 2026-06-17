RT7_CH7A_INTRUDER_DETECTOR

以你上傳的 RT7_CH6E_VISITOR_APPOINTMENT 為基礎新增：
- AI 入侵者偵測
- 遮臉 / 口罩 / 安全帽分析
- 翻牆 / 闖入 / 可疑行為分析
- MEDIUM/HIGH 風險推播
- Intruder Event Log

新增頁面：
/rt7_ch7_ai_security

新增 API：
GET  /api/ch7/state
POST /api/ch7/intruder/snapshot
POST /api/ch7/intruder/check
GET  /api/ch7/intruder/log

測試：
1. 開 /rt7_ch7_ai_security
2. 選 A社區與 Master UID
3. 上傳正常照片：預期 LOW / SAFE
4. 上傳口罩或安全帽照片：預期 MEDIUM
5. 上傳遮臉或可疑照片：預期 HIGH / INTRUDER / 推播
