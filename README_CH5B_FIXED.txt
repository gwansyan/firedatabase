RT7_CH5B_OPENAI_REAL_FACE_MATCH_FIXED

修正內容：
1. express.json limit 由 2mb 改成 20mb，避免手機照片 base64 上傳失敗。
2. 新增 GET /api/ch5/state，用來檢查 CH5B、OpenAI package、OPENAI_API_KEY。
3. app.listen 顯示版本改為 RT7_CH5B_OPENAI_REAL_FACE_MATCH。
4. package.json 增加 openai dependency。

部署方式：
1. 將 server.js 與 package.json 上傳到 GitHub 專案根目錄。
2. Railway Variables 確認已新增 OPENAI_API_KEY。
3. Railway 重新部署。
4. 測試：
   /api/ch5/state
   /rt7_ch5_face_register

成功 /api/ch5/state 應看到：
{
  "ok": true,
  "ch5b": true,
  "openai_package": true,
  "openai_key": true
}
