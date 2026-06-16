# RT7_EDU_TEST_V1B_REAL_ESP32_HEARTBEAT_PRIORITY

教學版 RT7 API，重點修正：真實 ESP32 heartbeat 優先。

## V1B 修正

- Master Registry 新增「來源」欄位：ESP32 / SIM。
- 預設不啟用網頁自動模擬 heartbeat，避免覆蓋真實 ESP32 MAC。
- 若已收到真實 ESP32 MAC，例如 `14:C1:9F:29:F2:68`，網頁模擬器 `AA:BB:CC:DD:EE:01` 不會覆蓋真機資料。
- 模擬 heartbeat 只在勾選「啟用網頁模擬器自動 heartbeat」時自動送出。
- ONLINE 判斷維持 5 分鐘，適合課堂操作。

## 測試網址

```text
https://你的Railway網址/edu
```

## ESP32 測試

ESP32 開機後應送出：

```json
{
  "master_uid": "RT7-MASTER-TEST-A001",
  "ip": "192.168.0.179",
  "mac": "14:C1:9F:29:F2:68"
}
```

網頁 Master Registry 應顯示：

```text
來源：ESP32
MAC：14:C1:9F:29:F2:68
```

## 模擬器測試

沒有 ESP32 時，才勾選：

```text
啟用網頁模擬器自動 heartbeat
```

模擬 MAC：

```text
AA:BB:CC:DD:EE:01
```

會顯示來源：

```text
SIM
```
