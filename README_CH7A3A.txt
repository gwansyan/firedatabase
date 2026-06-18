RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR

新增頁面：/rt7_auto_push_repair_safe

修正：不先 unsubscribe，避免本機 Subscription 從 YES 變 NO。

測試：
1. 手機開 /rt7_auto_push_repair_safe
2. 按「安全修復：不先取消訂閱」
3. 本機 Subscription 應為 YES
4. 按「測試社區推播」
