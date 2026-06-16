# RT7 EDU TEST V2 Push Notification

第2章：RT7 推播系統 Push Notification

## 內容
- server.js：Railway 可直接部署的完整教學版
- ESP32 測試程式：esp32/RT7_EDU_V2_PUSH_ESP32_TEST.ino
- Node-RED flow 已分開：
  - CH2_1_PUSH_MONITOR.json：監看 Railway /edu/state
  - CH2_2_SIMULATE_DOORBELL_PUSH.json：模擬門鈴並觸發推播
  - CH2_3_PUSH_TOOLS.json：測試推播、清除訂閱、開門命令
  - CH2_ALL_SEPARATED_TABS.json：一次匯入，但會分成 3 個 tab

## Railway 測試
1. 上傳 server.js/package.json 到 GitHub
2. Railway Deploy
3. 開啟 /edu
4. 手機 Chrome 按「啟用推播」
5. 按「測試推播」
6. ESP32 按門鈴，手機應收到「有人按門鈴」

## ESP32
修改：
- WIFI_SSID
- WIFI_PASS
- SERVER_BASE

燒錄後序列埠應看到：
- POST /edu/master/heartbeat code=200
- POST /edu/event/doorbell code=200
- GET /edu/device/command
- OPEN_DOOR 時 Relay pulse

## Node-RED
建議分開匯入，方便上課閱讀：
1. CH2_1_PUSH_MONITOR.json
2. CH2_2_SIMULATE_DOORBELL_PUSH.json
3. CH2_3_PUSH_TOOLS.json

如果網址不是 firedatabase-production.up.railway.app，請修改 HTTP request 節點 URL。
