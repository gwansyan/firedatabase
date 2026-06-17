# RT7_CH4_PUSH_GROUP_AUTO_REPLACE_SUBSCRIPTION

第4章修正版：Community Push Group 自動替換舊 Subscription。

## 修正
- POST /api/community/push/bind 會刪除同社區舊 endpoint，只保留最新手機 subscription。
- push 發送失敗 400/403/404/410 時，自動清除壞 endpoint。
- 新增 /api/rt7/community/list 與 /api/rt7/community/subscriptions。

## 測試順序
1. 手機開 /rt7_ch4_door_access
2. 第3區選 A社區
3. 按「重新訂閱推播」
4. 按「加入社區推播群組」
5. 確認社區群組數=1
6. 按「測試社區推播」
7. 最新 Push Log 應為 sent=1 total=1 status=SENT
