RT7_CH5B_OPENAI_REAL_FACE_MATCH_SERVER_PATCH
================================================

使用方式：
1. 將 package_CH5B.json 內容覆蓋目前 package.json。
2. 將 server_CH5B_PATCHED.js 改名為 server.js。
3. Railway Variables 新增：
   OPENAI_API_KEY=你的 OpenAI API Key
   可選：RT7_FACE_THRESHOLD=85
   可選：RT7_FACE_MODEL=gpt-4o
4. GitHub 更新後 Railway 重新部署。
5. 開啟：
   /rt7_ch5_face_register

本 Patch 依據你上傳的 CH4 server.js 製作：
- 保留 CH4 Community / Push / Door Access / Command Queue。
- 新增 CH5B Face Register UI。
- 新增 OpenAI Vision 真實比對。
- Face Match >= 85 時寫入 commands.json OPEN_DOOR。
- 沿用 ESP32 /api/rt7/device/command 開門輪詢。

新增 API：
GET  /api/ch5/faces
POST /api/ch5/face/register
POST /api/ch5/face/delete
POST /api/ch5/snapshot
POST /api/ch5/face/check
GET  /api/ch5/face/log

新增資料：
data/faces.json
data/face_access_log.json
data/uploads/

測試：
1. A社區 / user01 建立完成。
2. 手機加入 A社區推播群組。
3. 開 /rt7_ch5_face_register。
4. 選 A社區、輸入 user01，拍照上傳註冊人臉。
5. 用 Snapshot 測試上傳另一張照片。
6. 按「上傳 Snapshot + OpenAI 比對」。
7. 若 confidence >= 85：
   - commands.json 出現 OPEN_DOOR
   - ESP32 串口收到 OPEN_DOOR
   - [DOOR] OPEN relay pulse
   - 手機收到人臉辨識成功推播
   - /api/ch5/face/log 有 OPEN_DOOR 紀錄
