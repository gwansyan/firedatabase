RT7_CH6B1_SAFE_VISITOR_QA

修正 CH6B AI 問答會出現 JSON_PARSE_FAILED 或拒答的問題。

新增 API：
GET  /api/ch6/safe_qa/questions
POST /api/ch6/visitor/safe_qa

Safe QA 只允許：
- 是否有包裹
- 是否有物流制服或公司標誌
- 是否有外送箱
- 是否有工作證
- 是否有工具或維修用品
- 現場有幾個人
- 是否多人聚集
- 是否有危險物品或可疑行為
- 風險高不高
- 建議住戶如何處理

禁止：
- 他是誰
- 是不是某人
- 是不是住戶
- 是不是 user01/admin
- 是否同一人

部署：
1. 上傳 server.js、package.json 到 GitHub。
2. Railway 保留 OPENAI_API_KEY。
3. 重新部署。
4. 測試：
   /api/ch6/safe_qa/questions
   /rt7_ch6_ai_visitor
