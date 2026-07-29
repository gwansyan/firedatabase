RT7_PHASE10_GATEWAY_DIAGNOSTIC_SCANNER_V1

用途：診斷 DVR → Native RTSP Gateway → MJPEG 的本機端到端狀態。

最重要：
- 若 Gateway 位於你的電腦 127.0.0.1:8080，請在同一台電腦執行本 Scanner。
- 不要期待部署在 Railway 的 Scanner 可以存取你電腦的 127.0.0.1 或 192.168.x.x。

本機測試：
1. 先啟動 RT7 Native RTSP Gateway V2，確認 http://127.0.0.1:8080/live.html 有影像。
2. 雙擊 START_GATEWAY_DIAGNOSTIC_SCANNER.bat。
3. 瀏覽器開啟 http://127.0.0.1:8090。
4. Gateway Base URL 保持 http://127.0.0.1:8080。
5. 按「開始 Gateway 端到端診斷」。

診斷項目：
- TCP 是否可連。
- /status、/health、/api/channel。
- current_channel、target_channel、state、FPS、frame age、clients、FFmpeg 狀態。
- /stream.mjpg 與 /api/camera/stream 是否可取得完整 JPEG SOI/EOI。
- /api/last-report JSON。

主要結果：
- GATEWAY_END_TO_END_SUCCESS
- GATEWAY_PRIVATE_ADDRESS_NOT_REACHABLE_FROM_SCANNER
- GATEWAY_TCP_UNREACHABLE
- GATEWAY_API_UNAVAILABLE
- GATEWAY_STREAM_NO_JPEG_FRAME

本工具不會主動切換 DVR 通道，也不會修改 Gateway 設定。
