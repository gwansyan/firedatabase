RT7_PHASE10_NATIVE_RTSP_CLOUD_DIRECT_TEST
=========================================

目的
----
此專案部署在 Railway 後，直接由 Railway 容器執行三項測試：
1. Railway 是否能啟動 FFmpeg。
2. Railway 是否能建立 DVR RTSP Port 的 TCP 連線。
3. Railway 是否能實際開啟 RTSP 並解碼影格。

此測試不會透過 Windows RTSP Gateway。

重要安全提醒
------------
請不要把 DVR 密碼寫進 GitHub 的 server.js 或 package.json。
請在 Railway Variables 設定：

RT7_RTSP_HOST=192.168.0.123
RT7_RTSP_PORT=554
RT7_RTSP_USER=admin
RT7_RTSP_PASSWORD=你的DVR密碼
RT7_RTSP_CHANNEL=1
RT7_RTSP_PATH=/main_0
RT7_RTSP_TRANSPORT=tcp
RT7_RTSP_TEST_SECONDS=8

部署
----
1. 建立新的 Railway Service，避免影響目前正式 RT7 專案。
2. 將本資料夾全部上傳到新的 GitHub Repository。
3. Railway 連接此 Repository。
4. Railway 應偵測 Dockerfile；部署紀錄中應看到 ffmpeg 安裝。
5. 設定上述 Variables。
6. 開啟 Railway 網址首頁。
7. 按「開始雲端直連測試」。

判讀
----
CLOUD_DIRECT_RTSP_SUCCESS
- Railway 可啟動 FFmpeg，也能取得 DVR 影格。
- 技術上可以移除本機 Gateway，但正式使用前仍要測試長時間穩定性、頻寬與多使用者。

PRIVATE_LAN_NOT_REACHABLE_FROM_RAILWAY
- 192.168.x.x 是私有 IP，Railway 沒有路由可到達。
- 這不是 FFmpeg 限制，也不是 RTSP 格式問題。
- 需要保留同網段 Gateway，或建立安全 VPN／反向通道，或讓 DVR RTSP 成為受保護的公網端點。

RAILWAY_FFMPEG_UNAVAILABLE
- Railway 沒有 FFmpeg，通常是沒有使用 Dockerfile 部署。

RTSP_AUTHENTICATION_FAILED
- 網路可達，但帳密錯誤。

RTSP_PATH_NOT_FOUND
- 網路可達，但 main_0～main_3 路徑不正確。

PUBLIC_RTSP_PORT_UNREACHABLE
- 使用公網主機時，可能是 Port Forward、防火牆、CGNAT 或 ISP 阻擋。

關於「DVR 僅提供拉流」
----------------------
目前已確認這台 DVR 提供標準 RTSP Server，FFmpeg/VLC 以拉流方式讀取。
「Railway 能否直接使用」主要取決於網路可達性，不是 DVR 一定要主動推流。
若 DVR 沒有 RTMP/SRT 推送功能，仍可由 Railway 拉 RTSP，但 RTSP 位址必須能被 Railway 安全地存取。

API
---
GET  /health
GET  /api/rt7/rtsp-cloud/config
GET  /api/rt7/rtsp-cloud/status
POST /api/rt7/rtsp-cloud/run
POST /api/rt7/rtsp-cloud/stop

POST run 範例：
{
  "host": "192.168.0.123",
  "port": 554,
  "user": "admin",
  "password": "請勿提交到GitHub",
  "channel": 1,
  "path": "/main_0",
  "transport": "tcp",
  "seconds": 8
}
