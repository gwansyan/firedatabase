RT7_CH6D_VISITOR_WHITELIST

建立在 CH6C1 Visitor Fallback Fix 之上。

新增功能：
- 常客白名單
- 保全白名單
- 管委會白名單
- 維修人員白名單
- 固定物流白名單
- 可選白名單自動開門

新增資料檔：
data/visitor_whitelist.json

新增 API：
GET  /api/ch6/whitelist
POST /api/ch6/whitelist/add
POST /api/ch6/whitelist/delete
POST /api/ch6/whitelist/check

測試：
1. 開 /rt7_ch6_ai_visitor
2. 選 A社區與 Master UID
3. 新增白名單：
   名稱：張先生
   類型：常客
   關鍵字：一般訪客,中年男性
4. 按「上傳 Snapshot + 白名單檢查」
5. 若 AI 分析文字命中關鍵字，Event Log 會出現：
   result: WHITELIST_MATCH
   whitelist.matched: true
