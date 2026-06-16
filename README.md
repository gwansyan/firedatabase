# RT7_EDU_TEST_V1_NODE_RED_AND_SERVER_API

教學版 RT7 測試專案，將正式 RT7 的大型 `server.js` 拆成學生容易理解的 API：

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
