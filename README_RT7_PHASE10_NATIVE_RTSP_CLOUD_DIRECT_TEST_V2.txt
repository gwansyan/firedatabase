RT7_PHASE10_NATIVE_RTSP_CLOUD_DIRECT_TEST_V2
============================================

目的
----
在 Railway 容器內直接測試：
1. FFmpeg 是否存在並可執行。
2. Railway 是否能連到 DVR RTSP TCP Port。
3. FFmpeg 是否能開啟 RTSP 並取得第一張影格。
4. 自動判斷失敗原因。

V2 修正
--------
- 完全取消前端 JavaScript、onclick、fetch 與 AJAX。
- 使用標準 HTML POST form 呼叫 /run。
- 避免 V1 的 Invalid regular expression flags 與 runTest is not defined。
- 密碼可留白，改由 Railway Variables 提供。
- 顯示 FFmpeg、TCP、RTSP 三階段結果與完整記錄。
- 日誌與頁面遮蔽密碼。

建議 Railway Variables
----------------------
RT7_RTSP_HOST=192.168.0.123
RT7_RTSP_PORT=554
RT7_RTSP_USER=admin
RT7_RTSP_PASSWORD=你的DVR密碼
RT7_RTSP_PATH=/main_0
RT7_RTSP_TRANSPORT=tcp
RT7_RTSP_TEST_SECONDS=8

部署
----
建議建立獨立 Railway Service，不覆蓋正式 RT7 Service。
上傳此資料夾內全部檔案。Railway 應使用 Dockerfile；Dockerfile 會安裝 FFmpeg。
部署完成後開啟 Public Domain 首頁，直接按「開始雲端直連測試」。

主要結果代碼
------------
CLOUD_DIRECT_RTSP_SUCCESS
  Railway 已直接取得一張 DVR 影格。

PRIVATE_LAN_NOT_REACHABLE_FROM_RAILWAY
  目標是 192.168.x.x、10.x.x.x 或 172.16-31.x.x，Railway 沒有到內網的路由。

RAILWAY_FFMPEG_UNAVAILABLE
  FFmpeg 未安裝或無法執行。確認 Dockerfile 是否真的被採用。

RTSP_AUTHENTICATION_FAILED
  DVR 可達，但帳密或權限錯誤。

RTSP_PATH_NOT_FOUND
  DVR 可達，但 RTSP Path 錯誤。

PUBLIC_RTSP_PORT_UNREACHABLE
  使用公網位址時 Port 不通，檢查 Port Forward、防火牆、CGNAT。

安全
----
不要將 DVR 密碼提交到 GitHub。請使用 Railway Variables。
不要把 RTSP 554 直接公開到 Internet 作為長期正式方案，除非已做好 VPN、ACL、強密碼及防火牆限制。
