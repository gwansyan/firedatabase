# RT7 EDU TEST V2A Push Send Result Debug

新增：
- /edu 顯示最新 push log 詳細內容
- 顯示 sent / total / removed / failures
- 新增「重新訂閱推播」
- 新增「檢查本機瀏覽器訂閱」
- 新增 /api/push/debug
- Node-RED 顯示 sent/total/failures

測試：
1. 手機開 /edu
2. 按「重新訂閱推播」
3. count = 1
4. 按「測試推播」
5. 若手機沒跳出通知，看最新 push log：
   - sent=1：Server 已送出，請查手機通知權限/勿擾/Chrome通知
   - sent=0 且 failures 有 400/403/410：重新訂閱
   - total=0：沒有訂閱
