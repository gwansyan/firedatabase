# RT7_EDU_TEST_V1C_REAL_UID_FROM_MAC

可直接上傳 Railway 的完整 `server.js` 教學版 V1C。

## V1C 重點

- ESP32 Master UID 由真實 Wi-Fi MAC 自動產生。
- 規則與正式 RT7 Cloud 一致。
- 範例：
  - MAC：`14:C1:9F:29:F2:68`
  - UID：`RT7-MASTER-68F2299FC114`
- 若舊 ESP32 韌體仍送 `RT7-MASTER-TEST-A001`，server 收到真實 MAC 後會自動改成真實 UID。
- 網頁模擬器預設關閉，不會覆蓋真實 ESP32 MAC / UID。

## Railway 測試

```bash
npm install
npm start
```

開啟：

```text
https://你的Railway網址/edu
```

## ESP32 測試

打開：

```text
esp32/RT7_EDU_HEARTBEAT_DOORBELL_TEST.ino
```

修改：

```cpp
const char* WIFI_SSID = "你的 WiFi";
const char* WIFI_PASS = "你的密碼";
const char* SERVER_BASE = "https://你的Railway網址";
```

序列埠應看到：

```text
[WIFI] OK ip=192.168.0.179 mac=14:C1:9F:29:F2:68
[RT7_EDU_UID][V1C] UID=RT7-MASTER-68F2299FC114
[HTTP] POST /edu/master/heartbeat code=200
```

## 教學流程

1. ESP32 開機，自動產生 UID。
2. ESP32 heartbeat 上傳 UID / IP / MAC。
3. `/edu` Master Registry 顯示 ONLINE。
4. 建立 A社區 admin，綁定該 UID。
5. 登入測試。
6. 門鈴事件與開門命令測試。


## V1C1 Node-RED Observer 修正

原本 node-red flow 使用 HTTP In 節點，所以 ESP32 若直接送到 Railway，Node-RED 本機不會有反應。
本版改成 Node-RED 每 5 秒輪詢 Railway `/edu/state`，因此按 ESP32 門鈴後，Debug 視窗會看到新事件。

匯入：`node-red/RT7_EDU_NODE_RED_FLOW.json`
部署後觀察右側 Debug。

