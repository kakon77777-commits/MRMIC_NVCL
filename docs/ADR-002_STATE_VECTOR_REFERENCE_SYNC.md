# ADR-002：Phase 2 採用 State-Vector Reference Sync

## 狀態

Accepted for MVP Phase 2；正式 Yjs Adapter 尚未完成。

## 背景

技術白皮書選定 Yjs 為增量同步候選。Phase 2 的工程目標是驗證多端同步、斷線補差、presence 與增量日誌，而非依賴特定套件才能測試架構。

## 決策

Phase 2 先實作零外部依賴的參考同步引擎：

$$
SV_c(a)=\max\{k\mid (a,k)\text{ 已被 client }c\text{ 接收}\}
$$

遠端缺少更新為：

$$
\Delta(U,SV_c)=\{u\in U\mid u.counter>SV_c[u.clientId]\}.
$$

Presence 不進入持久文件狀態，連線中斷後移除。

## 不宣稱的內容

- 不宣稱與 Yjs binary update 相容；
- 不宣稱具有 Yjs 的完整 CRDT 合併能力；
- 不以此引擎取代正式 Yjs Adapter；
- 離線並行修改同一物件仍可能需要語義衝突解決。

## 保留的替換邊界

- CanvasTransaction 不依賴同步引擎；
- SyncUpdatePersistence 可替換；
- WebSocket Hub 只依賴 Room contract；
- MCP 層未來只呼叫同步抽象；
- Yjs Adapter 可在不改 CanvasCore 的情況下加入。
