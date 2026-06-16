# RT7 EDU TEST V2B Android Push Button Diagnostic Fix

修正手機按鈕沒反應時無法知道原因的問題。

新增：
- 所有按鈕都有 try/catch
- 錯誤會顯示在「即時診斷結果」
- 檢查 service worker / PushManager / Notification.permission / endpoint
- 前景通知測試
- 重新訂閱推播會先 unsubscribe 舊訂閱，再清除 server 訂閱，再重新 subscribe

測試：
1. 手機開 /edu
2. 按「檢查本機瀏覽器訂閱」
3. 看即時診斷結果
4. 按「重新訂閱推播」
5. 按「測試推播」
