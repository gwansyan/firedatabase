RT7_CH7A1_PUSH_DEBUG_PANEL

新增頁面：
/rt7_push_debug_panel

新增 API：
GET  /api/rt7/push/debug
GET  /api/rt7/push/groups
GET  /api/rt7/push/log
POST /api/rt7/push/test

測試：
1. 部署後開 /rt7_push_debug_panel
2. 看全域訂閱數是否 > 0
3. 看 A社區 group_count 是否 > 0
4. 按「測試選取社區推播」
5. 手機應收到：RT7 CH7A1 推播偵錯測試
