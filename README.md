# RT7_EDU_TEST_V1A_INPUT_FOCUS_AUTO_HEARTBEAT_FIX

教學版 RT7 測試專案（V1A：輸入框焦點保護 + 自動 heartbeat），將正式 RT7 的大型 `server.js` 拆成學生容易理解的 API：

1. ESP32 Heartbeat：模組上線
2. 多社區綁定：A社區 / B社區各綁不同 Master UID
3. 登入驗證：同名 admin 可依社區分辨
4. 門鈴事件：紀錄有人按門鈴
5. 開門控制：手機送命令，ESP32 輪詢執行
6. Node-RED Flow：用流程圖學習同樣邏輯

## 1. server.js 教學版

```bash
npm install
npm start
```

開啟：

```text
http://localhost:3000/edu
```

## 2. 測試 API

### Heartbeat

```http
POST /edu/master/heartbeat
```

```json
{
  "master_uid":"RT7-MASTER-TEST-A001",
  "ip":"192.168.0.179",
  "mac":"AA:BB:CC:DD:EE:01"
}
```

### 社區註冊

```http
POST /edu/community/register
```

```json
{
  "community":"A社區",
  "username":"admin",
  "password":"1234",
  "master_uid":"RT7-MASTER-TEST-A001",
  "master_ip":"192.168.0.179"
}
```

### 登入

```http
POST /edu/login
```

```json
{
  "community":"A社區",
  "username":"admin",
  "password":"1234"
}
```

### 門鈴事件

```http
POST /edu/event/doorbell
```

```json
{
  "master_uid":"RT7-MASTER-TEST-A001",
  "event":"doorbell",
  "message":"有人按門鈴"
}
```

### 開門命令

```http
POST /edu/door/open
```

```json
{
  "master_uid":"RT7-MASTER-TEST-A001"
}
```

ESP32 輪詢：

```http
GET /edu/device/command?master_uid=RT7-MASTER-TEST-A001
```

## 3. Node-RED

匯入：

```text
node-red/RT7_EDU_NODE_RED_FLOW.json
```

這個 Flow 示範：

```text
HTTP In → Function → Flow Memory → HTTP Response
```

## 4. ESP32

開啟：

```text
esp32/RT7_EDU_HEARTBEAT_DOORBELL_TEST.ino
```

修改：

```cpp
WIFI_SSID
WIFI_PASS
SERVER_BASE
MASTER_UID
```

再上傳到 ESP32。


## V1A 修正

- 修正 `/edu` 頁面每 10 秒重畫整個表單，造成輸入 `A社區` 時游標跳出。
- 改成每 30 秒自動送 heartbeat。
- 使用者正在輸入 input/select/textarea 時，不重新載入整個頁面。
- 教學版 ONLINE 判斷由 60 秒延長為 5 分鐘，避免學生填表時太快 OFFLINE。

測試：

1. 開啟 `/edu`。
2. 按「送出 heartbeat」。
3. 在「社區名稱」完整輸入 `A社區`，確認游標不會跳出。
4. 選擇在線主門禁，按「建立帳號並綁定」。
