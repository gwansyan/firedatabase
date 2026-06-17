# RT7 CH4 COMMUNITY DOOR ACCESS CONTROL

第4章：社區遠端門禁控制系統

## Railway 頁面
/rt7_ch4_door_access

## 新增功能
- 遠端開門 API：POST /api/rt7/community/open
- ESP32 命令佇列：GET /api/rt7/device/command?master_uid=...
- 開門紀錄：door_access_log.json
- Access Log API：GET /api/rt7/community/access_logs
- Node-RED 獨立 Flow

## data 檔案
- master_registry.json
- communities.json
- users.json
- community_push_groups.json
- commands.json
- door_access_log.json
- events.json
- push_log.json

## 測試流程
1. ESP32 上線 heartbeat
2. 建立 A社區 + admin
3. 新增 user01
4. 手機加入社區推播群組
5. 按門鈴，手機收到 A社區推播
6. 在頁面「遠端開門」選 A社區、輸入 user01
7. Railway 排入 OPEN_DOOR command queue
8. ESP32 輪詢 /api/rt7/device/command 後 relay pulse
9. Node-RED 顯示 Door Access Log

## Node-RED
- CH4_DOOR_ACCESS_MONITOR.json
- CH4_DOOR_ACCESS_TOOLS.json
- CH4_ALL_SEPARATED_TABS.json
