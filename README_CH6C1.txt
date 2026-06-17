RT7_CH6C1_VISITOR_FALLBACK_FIX

修正目的：
CH6C 若 OpenAI 回傳：
  visitor_type = unknown
  visitor_label = 無法判斷
  people_count >= 1

會自動改成：
  visitor_type = visitor
  visitor_label = 一般訪客
  action_suggestion = ASK_VISITOR
  summary = 有一般訪客到訪，建議詢問來意。

保留 CH6C 原功能：
- delivery_package：宅配員
- delivery_food：外送員
- postman：郵差
- maintenance：維修人員
- suspicious：可疑訪客
- visitor：一般訪客

新增核心函式：
ch6c1NormalizeDeliveryAnalysis(analysis)

測試：
1. 開 /rt7_ch6_ai_visitor
2. 選 A社區與 Master UID
3. 上傳一般訪客照片
4. 按「上傳 Snapshot + Delivery Detector」
5. Visitor Event Log 應顯示：
   visitor_type: visitor
   visitor_label: 一般訪客
   action_suggestion: ASK_VISITOR
