RT7_PHASE10_DVR_CLOUD_CAPABILITY_SCANNER_V1
===========================================

用途
----
第一版能力掃描器：
1. Network Scanner：測試指定 DVR Host 的 TCP Ports。
2. RTSP Scanner：測試自訂路徑與常見品牌 RTSP 路徑。
3. FFmpeg Scanner：確認 Railway 容器可啟動 FFmpeg／ffprobe。
4. Frame Test：找到 RTSP 後擷取第一張 JPEG，確認不是只有 Port 開啟。

安全範圍
--------
只掃描使用者在表單中指定的單一 Host；一次最多 16 個 TCP Ports；不做整個網段掃描。
請只測試您擁有或獲授權管理的 DVR／NVR。

Railway 部署
------------
1. 解壓縮 ZIP。
2. 將資料夾內檔案上傳到獨立 GitHub Repository，或更新目前的測試 Service。
3. Railway 使用 Dockerfile 建置。
4. 部署成功後開啟 Public Domain。
5. /health 應顯示：
   "version": "RT7_PHASE10_DVR_CLOUD_CAPABILITY_SCANNER_V1"

可選 Railway Variables
----------------------
RT7_DVR_HOST=192.168.0.123
RT7_DVR_RTSP_PORT=554
RT7_DVR_USER=admin
RT7_DVR_PASSWORD=您的密碼
RT7_DVR_PATH=/main_0
RT7_TCP_TIMEOUT_MS=1800
RT7_PROBE_TIMEOUT_MS=6000

注意：密碼不要提交到 GitHub。

主要網址
--------
/                 掃描表單
/health           健康檢查
/api/last-report  最近一次 JSON 報告

結果代碼
--------
RTSP_AND_FFMPEG_SUCCESS
  成功解析 RTSP 並擷取第一張 JPEG。

PRIVATE_LAN_NOT_REACHABLE_FROM_RAILWAY
  私有內網 IP 無法由 Railway 到達。

RAILWAY_FFMPEG_UNAVAILABLE
  Railway 容器無法啟動 FFmpeg。

RTSP_TCP_PORT_UNREACHABLE
  RTSP Port 無法建立 TCP 連線。

RTSP_AUTHENTICATION_FAILED
  Port 可達，但帳號或密碼驗證失敗。

RTSP_PORT_OPEN_BUT_STREAM_NOT_FOUND
  Port 可達，但未找到可用路徑或串流格式。

本版限制
--------
- V1 不做 ONVIF SOAP 掃描。
- V1 不做 HTTP API 品牌指紋辨識。
- UDP RTSP 在雲端環境可能受 NAT／防火牆影響，優先使用 TCP。
- 只有 Railway 能實際到達 DVR 時，RTSP 路徑掃描才會執行。
