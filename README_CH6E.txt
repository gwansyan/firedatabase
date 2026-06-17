RT7_CH6E_VISITOR_APPOINTMENT

建立在 CH6D Visitor Whitelist 之上。

新增功能：
- 訪客預約
- 邀請碼 invite_code
- 預約有效時段 start_time / end_time
- 關鍵字比對
- 可選自動開門
- 預約訪客推播
- Visitor Event Log

新增資料檔：
data/visitor_appointments.json

新增 API：
GET  /api/ch6/appointments
POST /api/ch6/appointments/add
POST /api/ch6/appointments/delete
POST /api/ch6/appointments/check

測試：
1. 開 /rt7_ch6_ai_visitor
2. 選 A社區與 Master UID
3. 建立訪客預約：
   訪客姓名：李小姐
   拜訪住戶：user01
   目的：訪客到訪
   邀請碼：RT7-TEST01
   關鍵字：一般訪客
   勾選：預約有效時自動開門
4. 上傳一般訪客照片
5. 按「上傳 Snapshot + 預約檢查」
6. Event Log 應顯示：
   result: APPOINTMENT_MATCH
   appointment.matched: true
   command.cmd: OPEN_DOOR
