RT7_CH7A2_FORCE_SW_REFRESH

建立在 CH7A1 Push Debug Panel 之上。

新增目的：
- 強制註銷舊 Service Worker
- 重新註冊新版 /sw.js
- 檢查 Notification.permission
- 檢查目前 Subscription endpoint
- 重新訂閱推播
- 測試 CH7A2 推播

新增頁面：
/rt7_sw_refresh

新增 API：
GET  /api/rt7/sw/status
POST /api/rt7/sw/test

測試：
1. 部署後手機開 /rt7_sw_refresh
2. 按「① 註銷舊SW + 重新註冊新版SW」
3. 按「② 重新訂閱推播」
4. 選 A社區
5. 按「③ 測試 CH7A2 推播」
6. 手機應收到：RT7 CH7A2 SW刷新測試
