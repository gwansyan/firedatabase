RT7_CH6C_DELIVERY_DETECTOR

建立在 CH6B1 Safe Visitor QA 之上，新增 Delivery Detector。

新增 API：
GET  /api/ch6/delivery/types
POST /api/ch6/delivery/detect

分類：
- delivery_package：📦 宅配員
- delivery_food：🍔 外送員
- postman：📮 郵差
- maintenance：🔧 維修人員
- visitor：👤 一般訪客
- suspicious：⚠️ 可疑訪客
- unknown：❔ 無法判斷

新增欄位：
visitor_type
visitor_label
delivery_company
package_detected
food_delivery_bag
uniform_detected
logo_detected
tool_detected
id_badge
risk
push_title
push_body
action_suggestion

測試：
1. 開 /rt7_ch6_ai_visitor
2. 選 A社區與 Master UID
3. 選門口照片
4. 按「上傳 Snapshot + Delivery Detector」
5. 查看 Visitor Event Log 與手機推播。
