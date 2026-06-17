RT7_CH6A_VISITOR_ANALYZER

第6章：RT7 Community AI Visitor Assistant 初版實作。

新增頁面：
/rt7_ch6_ai_visitor

新增 API：
GET  /api/ch6/state
POST /api/ch6/visitor/snapshot
POST /api/ch6/visitor/check
POST /api/ch6/visitor/question
POST /api/ch6/visitor/open
GET  /api/ch6/visitor/log

功能：
- 手機/ESP32 Snapshot 上傳
- OpenAI Vision AI 訪客分析
- 包裹/物流/風險判斷
- Community Push 推播
- 住戶允許進入後寫入 OPEN_DOOR
- Visitor Event Log

部署：
1. 上傳 server.js 與 package.json 至 GitHub。
2. Railway Variables 保留 OPENAI_API_KEY。
3. 重新部署。
4. 測試 /api/ch6/state
5. 開啟 /rt7_ch6_ai_visitor

注意：
本版為 CH6A，先用手機上傳門口照片測試 AI 分析。
ESP32 真正拍照上傳可在 CH6B/CH6D 再整合。
