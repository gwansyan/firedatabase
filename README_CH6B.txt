RT7_CH6B_VISITOR_CLASSIFIER

把 CH6A「AI 訪客分析」升級成「訪客分類器」。

分類：
- delivery_package：包裹物流
- delivery_food：外送員
- resident：住戶
- guest：一般訪客
- maintenance：維修人員
- security：保全/管理員
- unknown：無法分類
- suspicious：可疑訪客

新增欄位：
visitor_type, visitor_label, carrier, uniform_or_logo, vehicle_or_bag,
risk, action_suggestion, summary

新增 API：
GET  /api/ch6/classifier/types
POST /api/ch6/visitor/classify

測試：
1. 開啟 /rt7_ch6_ai_visitor
2. 選 A社區與 Master UID
3. 上傳門口照片
4. 按「上傳 Snapshot + AI 分類」
5. 查看 Visitor Event Log。
