# MCP 原生遞歸多模態無限畫布：作為原生視覺建構迴路落地環境的多代理視覺作業基底

**英文題名：** MCP-Native Recursive Multimodal Infinite Canvas: A Multi-Agent Visual Operating Substrate for Native Visual Construction Loops  
**作者：** Neo.K  
**日期：** 2026-07-30  
**文件類型：** 架構命題與工程理論論文  
**版本：** v1.0  
**系列位置：** 原生 AI 視覺建構系列第三篇

---

## 摘要

前述「原生符號繪圖假說」提出：當語言或多模態模型不依賴專用像素生成器，而直接透過向量路徑、圖形原語與程序指令產生圖像時，其語義壓縮、物件分解與構圖偏好可能以較少遮蔽的形式外顯。「原生視覺建構迴路」進一步主張：模型繪圖能力的增長單位不是完成圖片，而是可反覆執行的感知—動作—渲染—診斷—修正循環。然而，若此循環只能在一次性工具呼叫、短暫檔案與線性對話中運作，模型便缺乏一個持續存在、可局部觀察、可即時修改、可多代理協作並保存完整因果軌跡的視覺環境。

本文提出「MCP 原生遞歸多模態無限畫布」架構。其核心不是在既有繪圖軟體旁附加一個 MCP 介面，而是把 Model Context Protocol 定義為所有 AI 可感知資源、可執行動作、長時任務與狀態通知的統一系統呼叫層；以遞歸無限畫布作為視覺與多模態世界；以 CRDT、原子交易與事件帳本作為高頻共享狀態及經驗記憶；以超圖、時間軸、版本分支及權限系統保存物件間的語義、因果及治理關係；再把原生視覺建構迴路嵌入其中，令 AI 能持續聚焦、操作、觀看後果、局部修補、分支試驗及動態收斂。

本文特別區分「MCP 作為系統基底」與「MCP 承擔全部資料同步」兩種不同主張。前者可行且具有架構價值：所有對 Agent 有意義的資源、能力與操作都由 MCP 命名、發現、授權和呼叫；後者則不適合高頻畫布狀態，因而需要 CRDT 或等價增量狀態層。本文提出完整形式化模型、多模態物件綱要、遞歸子畫布結構、注意力投影、原子動作協定、多代理分支合併、即時同步、可反證命題與最小可行產品路徑。最終命題是：NVCL 要從短暫繪圖流程演化為可持續學習的視覺智能，必須先擁有一個 MCP 原生、狀態持久、遞歸可展開且由 AI 自主操作的多模態世界。

**關鍵詞：** Model Context Protocol、無限畫布、遞歸畫布、多模態代理人、CRDT、原生視覺建構迴路、視覺作業系統、即時協作、超圖

---

## 一、研究背景與問題

### 1.1 從「會生成圖片」到「能持續進行視覺工作」

專用圖像模型已能從提示生成高品質圖片，但真實創作通常包含：

- 蒐集參考資料；
- 建立草圖；
- 產生多個方案；
- 比較與淘汰；
- 局部修改；
- 版本分支；
- 圖層合成；
- 動畫與時間軸；
- 文字、圖像、音訊、影片及程式碼交互；
- 多位參與者的批評、批准與協作。

因此，完整視覺創作並非單一映射：

$$
P\rightarrow Y,
$$

而是長時狀態演化：

$$
\mathcal{W}_0
\xrightarrow{a_0}
\mathcal{W}_1
\xrightarrow{a_1}
\cdots
\xrightarrow{a_{n-1}}
\mathcal{W}_n.
$$

其中 $\mathcal{W}_t$ 是時間 $t$ 的完整工作世界，$a_t$ 是人類或 AI 所執行的視覺行動。

近期 CanvasAgent 將複雜圖像創作建模為多工具、長軌跡的視覺操作問題，並保存中間視覺資產及多輪工具決策[1]；JarvisHub 則明確把可編輯畫布視為 Agent 的外部記憶、行動空間與共享專案狀態[2]。這些工作證明「畫布原生 Agent」已成為獨立技術方向，但仍留下更深層的架構問題：

> 畫布能否不只是某個 Agent 應用程式的介面，而成為所有多模態資源、工具、狀態與 AI 行動的統一作業基底？

### 1.2 NVCL 缺少持續世界

原生視覺建構迴路可寫為：

$$
P
\rightarrow
H^s
\rightarrow
H^p
\rightarrow
a_t
\rightarrow
R
\rightarrow
o_{t+1}
\rightarrow
\Delta_{t+1}
\rightarrow
a_{t+1},
$$

其中：

- $H^s$：語義超圖；
- $H^p$：空間超圖；
- $a_t$：繪圖動作；
- $R$：渲染器；
- $o_{t+1}$：新觀察；
- $\Delta_{t+1}$：誤差或差異。

若每一輪都透過獨立工具重新讀取及輸出完整檔案，會產生：

1. 狀態重建成本；
2. 物件身分不穩定；
3. 上下文重複傳輸；
4. 局部修改困難；
5. 多 AI 競爭寫入；
6. 視覺歷史與因果來源遺失；
7. 長時任務難以中斷、恢復或分支。

因此 NVCL 不只需要繪圖工具，而需要一個持續環境：

$$
\boxed{
\text{NVCL}
+
\text{Persistent Multimodal World}
}
$$

### 1.3 本文的核心研究問題

本文回答四個問題：

1. 如何把 MCP 從外接整合協定提升為 AI 畫布的統一系統呼叫層？
2. 如何建立可無限展開、局部載入並支援多模態物件的遞歸畫布？
3. 如何讓多個 AI 即時、自主且安全地讀寫同一共享世界？
4. 如何使該世界成為 NVCL 的感知、行動、記憶與學習環境？

---

## 二、核心命題

本文提出：

## MCP 原生遞歸多模態無限畫布命題

> 若一個多模態畫布將所有 AI 可感知內容表示為可尋址資源，將所有可執行改變表示為具型別、可驗證的 MCP 動作，將高頻共享狀態交由增量同步層維持，並允許每個物件遞歸展開為具有獨立狀態、時間、版本和權限的子畫布，則該畫布可成為原生視覺建構迴路的持續環境，使模型由一次性圖像產生者轉化為能長時操作、觀察、修正、協作與學習的視覺 Agent。

這一命題可分解為：

$$
\boxed{
\text{MRMIC}
=
\text{MCP Control}
+
\text{Recursive Canvas World}
+
\text{CRDT State}
+
\text{Event Memory}
+
\text{Hypergraph Semantics}
+
\text{NVCL Runtime}
}
$$

其中 MRMIC 代表：

$$
\text{MCP-Native Recursive Multimodal Infinite Canvas}.
$$

---

## 三、「MCP 作為基底」的精確定義

### 3.1 不是插件，而是 Agent 系統呼叫層

MCP 穩定規格將 Server 原語區分為 Prompts、Resources 與 Tools；其中 Resources 是應用程式控制的上下文，Tools 是模型控制的可執行能力[3]。Resources 可用唯一 URI 表示，支援模板、訂閱及更新通知；Tools 則以結構化輸入綱要被模型發現和呼叫[4][5]。

因此「MCP 作為畫布基底」應定義為：

$$
\forall x\in
\{
\text{AI-visible state},
\text{AI-invocable action}
\},
\quad
x
\text{ 必須具有 MCP 可尋址或可呼叫表示。}
$$

換句話說：

- 所有 AI 可讀狀態均可映射為 Resource；
- 所有 AI 可做操作均可映射為 Tool；
- 長時間操作可映射為 Task 或等價持久工作；
- 狀態變化可透過通知或訂閱暴露；
- 權限與作用域在呼叫層明確處理。

這相當於把 MCP 定義為 Agent 的系統呼叫介面：

$$
\operatorname{syscall}_{AI}
:
(\text{intent},\text{context})
\rightarrow
(\text{action},\text{result}).
$$

### 3.2 MCP 不應取代高頻狀態同步

然而，MCP 主要是 JSON-RPC 型的上下文與工具互動協定，穩定版 Streamable HTTP 使用 POST、GET 與可選 SSE 進行請求、回應和通知[6]。它並未被設計為每一筆游標移動、自由筆跡採樣或像素變動的高頻同步引擎。

因此必須區分：

$$
\text{控制平面}
\neq
\text{資料平面}.
$$

本文建議：

$$
\boxed{
\text{MCP}
=
\text{命名、發現、授權、語境與動作控制平面}
}
$$

$$
\boxed{
\text{CRDT / Delta Stream}
=
\text{高頻共享狀態資料平面}
}
$$

MCP 呼叫可啟動、提交、查詢或驗證一筆畫布交易；交易內部的細粒度差異則由 CRDT 或等價同步機制傳播。

### 3.3 MCP 資源命名

畫布可使用 URI 形成統一資源空間：

```text
canvas://workspace-01/root
canvas://workspace-01/canvas/main
canvas://workspace-01/canvas/main/region/7
canvas://workspace-01/object/obj-194
canvas://workspace-01/object/obj-194/subcanvas
canvas://workspace-01/timeline/1200..1380
canvas://workspace-01/branch/agent-a-03
canvas://workspace-01/trajectory/nvcl-run-812
```

資源模板可表示可參數化區域：

```text
canvas://{workspace}/canvas/{canvas_id}/region/{region_id}
```

客戶端可訂閱特定資源，當區域或物件更新時接收通知，而不必反覆輪詢整個世界。

### 3.4 MCP 動作集合

最小 MCP 畫布能力包括：

```text
canvas.inspect
canvas.query
canvas.focus
canvas.subscribe
canvas.create_object
canvas.update_object
canvas.delete_object
canvas.transform
canvas.group
canvas.reorder
canvas.patch
canvas.render
canvas.verify
canvas.snapshot
canvas.branch
canvas.merge
canvas.replay
canvas.open_subcanvas
canvas.fold_subcanvas
```

每個動作必須具有：

- 型別化參數；
- 目標作用域；
- 前置條件；
- 預期結果；
- 權限需求；
- 可逆性；
- 來源 Agent；
- 交易識別碼。

---

## 四、遞歸多模態無限畫布

### 4.1 從無限平面到遞歸世界

普通無限畫布可近似為：

$$
\mathcal{C}
=
\mathbb{R}^2
\times
\mathcal{O},
$$

其中 $\mathcal{O}$ 是平面上的物件集合。

遞歸畫布則定義為：

$$
\mathcal{C}_i
=
(
id_i,
\mathcal{O}_i,
\mathcal{E}_i,
\mathcal{C}^{sub}_i,
\mathcal{T}_i,
\mathcal{V}_i,
\mathcal{P}_i
),
$$

其中：

- $\mathcal{O}_i$：當層物件；
- $\mathcal{E}_i$：物件關係；
- $\mathcal{C}^{sub}_i$：子畫布集合；
- $\mathcal{T}_i$：時間與事件；
- $\mathcal{V}_i$：版本及分支；
- $\mathcal{P}_i$：權限及治理。

任一物件可指向子畫布：

$$
o_j
\mapsto
\mathcal{C}_{j}^{sub}.
$$

而子畫布內部物件又可遞歸展開：

$$
o_{jk}
\mapsto
\mathcal{C}_{jk}^{sub}.
$$

Yjs 的 Subdocuments 機制已證明文件可嵌入文件，並能以 GUID 分離同步房間、按需載入內容，適合管理大量遞歸文件[7]。本文將此概念由文件樹擴展為多模態畫布世界。

### 4.2 語義縮放而非純幾何縮放

在普通畫布中，Zoom 只改變視口比例；在遞歸畫布中，Zoom 可以改變語義解析度：

$$
Z_0:
\text{專案總覽}
$$

$$
Z_1:
\text{作品或場景}
$$

$$
Z_2:
\text{物件}
$$

$$
Z_3:
\text{部件與圖層}
$$

$$
Z_4:
\text{路徑、參數與時間}
$$

$$
Z_5:
\text{生成軌跡、來源與評估}
$$

因此：

$$
\operatorname{Zoom}
=
\operatorname{GeometricScale}
+
\operatorname{SemanticDepth}.
$$

### 4.3 多模態原生物件

每個畫布物件定義為：

$$
o_i
=
(
id_i,
type_i,
payload_i,
transform_i,
relations_i,
timeline_i,
state_i,
permissions_i,
provenance_i,
subcanvas_i
).
$$

可支援的型別包括：

- vector；
- raster；
- text；
- rich document；
- audio；
- video；
- animation；
- 3D object；
- code；
- dataset；
- simulation；
- live stream；
- embedded application；
- agent；
- tool；
- recursive canvas。

物件不是單純附件，而是可觀察、可操作及可展開的狀態實體。例如影片可以分解為：

$$
\text{Video}
=
(
\text{Frames},
\text{Audio},
\text{Transcript},
\text{Objects},
\text{Motion},
\text{Events},
\text{Timeline}
).
$$

音訊可以分解為：

$$
\text{Audio}
=
(
\text{Waveform},
\text{Spectrum},
\text{Speech},
\text{Speaker},
\text{SemanticSegments}
).
$$

### 4.4 開放交換格式

Open Canvas Working Group 已提出 OCIF，目標包括建立無限畫布交換格式、展示不同工具間的即時同步，且其規格已進入 Candidate Recommendation 階段[8]。MRMIC 不必完全等同 OCIF，但應提供：

$$
\operatorname{Export}_{OCIF}
:
\mathcal{C}
\rightarrow
D_{OCIF},
$$

及：

$$
\operatorname{Import}_{OCIF}
:
D_{OCIF}
\rightarrow
\mathcal{C},
$$

以避免形成不可遷移的封閉世界。

---

## 五、共享狀態、事件與即時同步

### 5.1 狀態差異

每次畫布改變表示為：

$$
\delta_t
=
(
id_t,
agent_t,
target_t,
op_t,
params_t,
pre_t,
origin_t,
time_t
).
$$

狀態更新為：

$$
\mathcal{C}_{t+1}
=
\mathcal{C}_t
\oplus
\delta_t.
$$

Yjs 將文件改變編碼為壓縮二進位更新；更新具有交換律、結合律及冪等性，並可透過狀態向量只交換遠端缺少的差異[9]。這使多 Agent 在網路延遲、重送及不同抵達順序下仍可最終收斂。

### 5.2 原子交易

多步視覺操作應被包裝為：

$$
\Delta_t
=
\{
\delta_t^1,\delta_t^2,\ldots,\delta_t^n
\}.
$$

Yjs 的 `transact` 能把多個變更合併為單一交易，並為交易指定 origin[10]。MRMIC 在此基礎上加入前置條件與驗證：

$$
\operatorname{Commit}(\Delta_t)
\iff
\operatorname{Auth}(\Delta_t)=1
\land
\operatorname{Precondition}(\Delta_t)=1
\land
\operatorname{Verify}(\Delta_t)=1.
$$

否則：

$$
\operatorname{Rollback}(\Delta_t).
$$

### 5.3 事件帳本

CRDT 解決狀態收斂，但不能單獨取代完整的可審計因果記錄。系統應另維護 append-only 事件帳本：

$$
\mathcal{L}
=
(e_1,e_2,\ldots,e_n).
$$

每個事件保存：

- Agent 身分；
- MCP 呼叫；
- 交易 origin；
- 前後狀態雜湊；
- 意圖與預期；
- 驗證結果；
- 合併或回滾狀態；
- 對應 NVCL 軌跡。

因此：

$$
\text{CRDT}
=
\text{現在狀態如何一致}
$$

而：

$$
\text{Event Ledger}
=
\text{現在狀態如何形成}.
$$

### 5.4 Presence 與活動狀態

Yjs Awareness CRDT 可傳播游標、在線狀態等非持久 presence 資料，離線後自動移除[11]。對 AI Agent，awareness 可擴展為：

$$
p_i
=
(
agent_i,
focus_i,
viewport_i,
selected_i,
task_i,
intent_i,
lock_i,
confidence_i
).
$$

但 presence 不應保存敏感內部推理，只需暴露協作必要的可行動狀態。

---

## 六、AI 如何觀看無限畫布

### 6.1 無限世界與有限注意力

無限畫布不代表模型每次讀取全部內容。大型設計文件可能包含數萬節點，Figma 官方文件也提醒遍歷整棵文件樹可能非常緩慢[12]。

因此模型取得的是任務條件化投影：

$$
\mathcal{C}^{*}_{q,t}
=
\Pi
(
\mathcal{C}_t
\mid
q,
f_t,
B_t,
P_t
),
$$

其中：

- $q$：任務；
- $f_t$：目前焦點；
- $B_t$：上下文及運算預算；
- $P_t$：權限；
- $\Pi$：主動投影函數。

### 6.2 多重觀察

AI 每輪觀察定義為：

$$
O_t
=
(
I_t,
S_t,
G_t,
L_t,
T_t,
A_t,
E_t,
M_t
),
$$

其中：

- $I_t$：目前視口截圖；
- $S_t$：視口內結構化物件；
- $G_t$：相關超圖；
- $L_t$：圖層與遮蔽；
- $T_t$：近期事件；
- $A_t$：自身及其他 Agent presence；
- $E_t$：驗證錯誤與未完成項；
- $M_t$：折疊後工作記憶。

tldraw 的 Agent 架構已採用「視口截圖＋視口內簡化物件＋視口外物件群集＋選取與近期操作」的混合觀察，並透過具型別動作讓 Agent 建立及修改形狀[13]。這支持「像素觀察與結構觀察必須並存」。

### 6.3 主動感知

模型不應被動接收固定截圖，而應能呼叫：

```text
canvas.focus_region
canvas.zoom_to_object
canvas.inspect_occlusion
canvas.inspect_timeline
canvas.compare_versions
canvas.list_offscreen_clusters
canvas.render_modality
```

近期 OmniAgent 將長影片理解建模為 POMDP 式的 Observation–Thought–Action 主動感知迴路，按需選擇片段並把資訊蒸餾到持久記憶[14]。MRMIC 將同樣原則應用於無限畫布：

$$
\text{不觀看全部}
\rightarrow
\text{根據任務決定看哪裡與看多深}.
$$

---

## 七、MCP 原生畫布行動模型

### 7.1 動作綱要

單次動作表示為：

$$
a_t
=
(
agent,
canvas,
focus,
operation,
target,
parameters,
intent,
expected,
confidence,
scope
).
$$

例如：

```json
{
  "agent": "Aletheia",
  "canvas": "nova/card-layout",
  "focus": "character-frame",
  "operation": "adjust_composition",
  "target": ["portrait-layer", "title-layer"],
  "parameters": {
    "portraitScale": 1.12,
    "titleOffset": [0, -24]
  },
  "intent": "increase visual hierarchy",
  "expected": "portrait becomes primary focus",
  "confidence": 0.83,
  "scope": "branch:agent-a-03"
}
```

### 7.2 執行鏈

$$
a_t
\xrightarrow{\mathrm{MCP}}
\operatorname{Validate}
\xrightarrow{}
\operatorname{Transaction}
\xrightarrow{\mathrm{CRDT}}
\mathcal{C}_{t+1}
\xrightarrow{\mathrm{Render}}
O_{t+1}
\xrightarrow{\mathrm{MCP}}
\text{Agent}.
$$

MCP 是 Agent 可理解的動作與結果介面；CRDT 是交易結果在多端同步的底層。

### 7.3 長時任務

MCP 2025-11-25 規格已提供實驗性 Tasks：任務具有持久 ID、狀態、輪詢、結果取得、取消與狀態通知[15]。MRMIC 可把下列操作建模為長時任務：

- 大型畫布重排；
- 全專案一致性檢查；
- 多分支方案生成；
- 影片解析；
- 3D 場景渲染；
- 長時間 NVCL 自主改稿；
- 批量匯出與驗證。

畫布狀態本身不儲存在 MCP Task 中；Task 保存工作生命週期，實際狀態仍位於畫布及事件層。

---

## 八、多 Agent 自主協作

### 8.1 三種寫入模式

#### 直接交易

適合低風險、可逆的小修改：

$$
\mathcal{C}'
=
\mathcal{C}\oplus\Delta_A.
$$

#### 私有分支

Agent 在獨立分支操作：

$$
\mathcal{C}^{A}
=
\operatorname{Branch}(\mathcal{C},A).
$$

完成後驗證及合併：

$$
\mathcal{C}'
=
\operatorname{Merge}
(
\mathcal{C},
\mathcal{C}^{A}
).
$$

#### 提案模式

Agent 只提交 patch：

$$
\Delta_A^{proposal},
$$

由人類、另一 Agent 或規則驗證器批准。

### 8.2 空間與語義租約

為避免多個 Agent 同時修改同一區域，可建立短期租約：

$$
\ell
=
(
holder,
scope,
expires,
mode
).
$$

作用域不只可以是空間區域，也可以是：

- 物件群；
- 圖層；
- 時間段；
- 子畫布；
- 語義主題；
- 工具類型。

### 8.3 衝突分類

衝突可分為：

1. **資料衝突：** 同一屬性被同時更新；
2. **幾何衝突：** 物件重疊或越界；
3. **語義衝突：** 修改破壞任務意圖；
4. **審美衝突：** 不同 Agent 偏好不一致；
5. **治理衝突：** 權限或批准條件不符。

CRDT 可解決部分資料層合併，但不能自動解決語義與審美衝突。因此需要：

$$
\operatorname{Resolve}
=
\operatorname{CRDTMerge}
+
\operatorname{SemanticVerifier}
+
\operatorname{GovernancePolicy}.
$$

### 8.4 平行分支與收斂

多 Agent 可並行探索：

$$
\{
\mathcal{C}^{A_1},
\mathcal{C}^{A_2},
\ldots,
\mathcal{C}^{A_k}
\}.
$$

再由評估 Agent 聚合：

$$
\mathcal{C}^{*}
=
\operatorname{Aggregate}
(
\mathcal{C}^{A_1},
\ldots,
\mathcal{C}^{A_k}
).
$$

長時 Agent 研究顯示，直接拼接全部軌跡會造成上下文膨脹，而讓聚合 Agent 以工具按需檢視不同軌跡可以提高效率[16]。因此 MRMIC 應讓聚合者「進入」候選分支、查詢差異與局部比較，而不是把所有歷史塞入一次提示。

---

## 九、遞歸展開、外擴與收斂

### 9.1 深度展開

對物件 $v$，深度展開為：

$$
D_k(v)
=
\operatorname{ExpandDepth}(v,k).
$$

它可以從成品展開到：

- 物件；
- 部件；
- 路徑；
- 參數；
- 來源；
- 歷史；
- 評估；
- 子問題。

### 9.2 關係外擴

$$
O_r(v)
=
\{
u
\mid
d_{\mathcal{H}}(u,v)\le r
\}.
$$

外擴依超圖而非純空間距離，可連接：

- 相關參考；
- 相同角色；
- 同一風格規則；
- 其他畫布中的版本；
- 生成該物件的工具；
- 批評與修正事件。

### 9.3 自由展開

$$
F(v,q,s)
=
\operatorname{AdaptiveExpand}(v\mid q,s).
$$

模型依任務與狀態選擇：

- 向內看細節；
- 向外找關聯；
- 沿時間回溯；
- 沿來源追蹤；
- 開啟不同模態；
- 進入候選分支。

### 9.4 動態收斂與折疊

完成子任務後，子畫布可折疊成摘要：

$$
\operatorname{Fold}(\mathcal{C}_{sub})
=
(
summary,
outputs,
constraints,
provenance,
reopenHandle
).
$$

Context Folding 研究提出，Agent 可主動進入子軌跡處理子任務，再把中間過程折疊為簡潔結果，以管理長時上下文[17]。在 MRMIC 中，折疊不是刪除，而是保留可重新開啟的 handle。

---

## 十、MRMIC 與 NVCL 的整合

### 10.1 NVCL 的環境化

原本 NVCL 是一個視覺操作循環；在 MRMIC 中，它變成對持續世界的狀態轉移：

$$
\operatorname{NVCL}_A
:
\mathcal{C}_t
\rightarrow
\mathcal{C}_{t+1}.
$$

完整流程為：

$$
P
\rightarrow
\operatorname{AcquireHandle}(\mathcal{C})
\rightarrow
\operatorname{Project}(\mathcal{C}^{*}_{q,t})
\rightarrow
H^s_t
\rightarrow
H^p_t
\rightarrow
a_t
\rightarrow
\operatorname{MCPCall}
\rightarrow
\operatorname{Commit}(\Delta_t)
\rightarrow
O_{t+1}.
$$

### 10.2 畫布作為虛擬身體

在此架構下：

$$
\text{畫布}
=
\text{環境}
$$

$$
\text{視口與焦點}
=
\text{感覺器官方向}
$$

$$
\text{選取、游標與作用域}
=
\text{本體感覺}
$$

$$
\text{MCP Tool}
=
\text{可執行動作}
$$

$$
\text{CRDT Delta}
=
\text{行動造成的世界變化}
$$

$$
\text{Render / Verify}
=
\text{感覺回饋}
$$

$$
\text{Event Ledger}
=
\text{經驗記憶}
$$

### 10.3 畫布作為訓練資料產生器

每次 NVCL 操作都可保存為：

$$
\tau_i
=
(
O_t,
a_t,
\Delta_t,
O_{t+1},
r_t,
provenance_t
).
$$

長期累積後形成：

- 成功繪圖軌跡；
- 失敗與回滾；
- Agent 間批評；
- 分支比較；
- 局部修補；
- 長時創作策略；
- 個別模型視覺簽名。

這使 MRMIC 不只是執行環境，也是原生繪圖模型的資料引擎。

---

## 十一、與現有系統的差異

### 11.1 與 tldraw Agent 的差異

tldraw 已提供：

- 無限畫布 SDK；
- 即時協作；
- AI 讀取截圖與結構資料；
- 具型別動作；
- 視口移動；
- 即時串流操作[13][18]。

MRMIC 的差異在於：

1. MCP 是跨工具統一系統呼叫層；
2. 物件可遞歸成獨立子畫布；
3. 所有模態、任務及 Agent 都是畫布原生物件；
4. NVCL 軌跡直接成為持久學習資料；
5. 超圖、事件帳本、版本與治理是核心而非附加功能。

### 11.2 與 CanvasAgent 的差異

CanvasAgent 側重學習如何協調異質視覺工具完成複雜圖像創作[1]。MRMIC 不限定使用專用圖像工具；其重點是建立所有視覺行動共同存在的持續世界，並可支援原生符號繪圖。

### 11.3 與 JarvisHub 的差異

JarvisHub 已提出三層架構：畫布狀態、協定橋接及 Agent runtime，並把畫布當作共享專案狀態[2]。MRMIC 與其高度相鄰，但進一步提出：

- MCP 不只是橋接層，而是所有 AI 能力與語境的規範性基底；
- CRDT／事件帳本分離；
- 遞歸子畫布與語義縮放；
- NVCL 內生化；
- 多 Agent 分支、超圖及可驗證治理。

### 11.4 與 Photoshop／Figma 的差異

傳統創作工具以人類 UI 為第一介面，Agent 再透過插件或 UI automation 操作。MRMIC 則要求：

$$
\text{Agent API}
\text{ 與 }
\text{World State}
\text{ 先於人類視覺介面定義}.
$$

人類介面只是同一世界的另一個客戶端。

---

## 十二、安全、治理與可追溯性

### 12.1 最小權限

每個 Agent 權限表示為：

$$
P_A
=
(
resources,
tools,
regions,
modalities,
branches,
time,
approval
).
$$

例如 Agent 可以：

- 讀取整個畫布；
- 只修改自己的分支；
- 不得刪除來源物件；
- 只能產生提案；
- 不得呼叫外部網路工具。

### 12.2 高風險操作

以下動作需要更高級批准：

- 永久刪除；
- 覆寫主分支；
- 對外發布；
- 呼叫付費服務；
- 匯出私人資料；
- 執行任意程式；
- 修改其他 Agent 身分或權限。

MCP 官方規格亦強調工具執行涉及任意資料及程式路徑，應重視使用者同意、控制與清楚的工具暴露[3][5]。

### 12.3 可追溯輸出

任何輸出物件應可回溯：

$$
\operatorname{Trace}(o)
=
\{
\text{sources},
\text{agents},
\text{tools},
\text{transactions},
\text{branches},
\text{approvals}
\}.
$$

這對 AI 作品著作權、資料治理、模型評估及錯誤重現都至關重要。

---

## 十三、可反證命題

### 命題一：MCP 原生動作降低工具碎片化

若所有畫布操作使用統一的 MCP Tool schema，跨 Agent 或跨模型移植時的介面重寫量應顯著低於每個 Agent 使用私有 API 的架構。

### 命題二：結構化觀察優於純截圖

在相同 Token 預算下：

$$
Q(I_t+S_t+G_t)
>
Q(I_t),
$$

其中 $Q$ 衡量物件辨識、關係理解及操作成功率。

### 命題三：增量同步優於整體重傳

在畫布規模增加時，CRDT 差異同步的平均傳輸量及更新延遲應顯著低於重傳完整畫布。

### 命題四：遞歸子畫布改善長時上下文管理

使用子畫布按需載入與折疊的 Agent，在大型專案中的任務成功率、上下文成本及錯誤恢復能力應優於單一扁平畫布。

### 命題五：持續畫布提高 NVCL 學習效率

保存完整動作—狀態軌跡的 NVCL，在局部修補及跨任務遷移上應優於只保存提示與完成圖的系統。

### 命題六：分支式多 Agent 優於直接共享寫入

在複雜創作任務中，私有分支加驗證合併應比所有 Agent 直接修改主畫布具有更低破壞率。

### 命題七：MCP 不足以單獨承擔高頻狀態

若完全以 MCP JSON-RPC 傳播每個細粒度畫布變化，其頻寬、延遲或序列化成本應劣於 MCP 控制平面加 CRDT 資料平面的混合架構。若實驗相反，本文的平面分離主張應被修正。

---

## 十四、MVP 架構

### 14.1 MVP 目標

第一版不追求所有模態及無限遞歸，而證明：

1. AI 能透過 MCP 讀取及修改畫布；
2. 畫布狀態可即時增量同步；
3. AI 能觀看修改後結果並局部修補；
4. 所有操作可回放及追溯；
5. 至少支援一層子畫布。

### 14.2 建議技術分層

```text
mrmic/
├── client/
│   ├── canvas-ui/
│   ├── viewport/
│   └── agent-presence/
├── canvas-core/
│   ├── object-model/
│   ├── transforms/
│   ├── layers/
│   ├── bindings/
│   └── subcanvas/
├── sync/
│   ├── crdt/
│   ├── awareness/
│   └── persistence/
├── mcp-server/
│   ├── tools/
│   ├── resources/
│   ├── subscriptions/
│   └── tasks/
├── agent-runtime/
│   ├── perception/
│   ├── planner/
│   ├── nvcl/
│   └── verifier/
├── graph/
│   ├── semantic-hypergraph/
│   ├── spatial-index/
│   └── temporal-index/
├── ledger/
│   ├── events/
│   ├── provenance/
│   └── replay/
└── governance/
    ├── permissions/
    ├── leases/
    └── approvals/
```

### 14.3 MVP 物件型別

第一版只需：

- vector shape；
- freehand path；
- text；
- raster image；
- group；
- frame；
- embedded subcanvas；
- agent note。

### 14.4 MVP MCP Tools

```text
canvas.get_state
canvas.get_viewport
canvas.render_viewport
canvas.query_objects
canvas.create_objects
canvas.patch_objects
canvas.delete_objects
canvas.move_viewport
canvas.verify
canvas.create_snapshot
canvas.create_branch
canvas.merge_branch
canvas.open_subcanvas
```

### 14.5 MVP Resources

```text
canvas://workspace/current
canvas://workspace/current/viewport
canvas://workspace/current/objects/{id}
canvas://workspace/current/events
canvas://workspace/current/branch/{id}
```

### 14.6 MVP NVCL 迴路

$$
\text{User Goal}
\rightarrow
\text{MCP Read}
\rightarrow
\text{Screenshot + Objects}
\rightarrow
\text{Plan}
\rightarrow
\text{MCP Patch}
\rightarrow
\text{CRDT Sync}
\rightarrow
\text{Render}
\rightarrow
\text{Verify}
\rightarrow
\text{Patch or Stop}.
$$

### 14.7 MVP 成功指標

- MCP tool-call 有效率；
- 物件 ID 引用正確率；
- 局部 patch 成功率；
- 主畫布破壞率；
- 平均同步延遲；
- 平均差異封包大小；
- 多輪任務完成率；
- 分支合併衝突率；
- 軌跡完整可回放率。

---

## 十五、系列中的位置

目前已完成：

1. **《原生符號繪圖假說》**：研究非專用圖像生成條件下的模型視覺殘差；
2. **《原生視覺建構迴路》**：研究 AI 如何透過感知—動作—修正循環提升繪圖能力；
3. **本文**：研究 NVCL 所需的持續多模態世界及系統基底。

三篇關係為：

$$
\text{原生視覺表達是否存在}
$$

$$
\downarrow
$$

$$
\text{原生視覺能力如何成長}
$$

$$
\downarrow
$$

$$
\text{原生視覺智能在哪個世界中持續運作}
$$

後續系列不應重寫以上三篇，而應展開尚未處理的子問題，例如：

- 多模態物件協定；
- 遞歸畫布與超圖形式；
- MCP 畫布工具規格；
- CRDT 與事件帳本的雙層一致性；
- 多 Agent 視覺治理；
- 畫布軌跡訓練；
- 原生視覺簽名保護；
- MVP 與正式版本工程白皮書。

---

## 十六、限制

第一，MCP 目前提供通用資源與工具協定，並未直接定義畫布語義，因此本文仍需提出領域專屬 schema。

第二，CRDT 的最終一致性不等於語義正確；多 Agent 合併需要額外驗證。

第三，遞歸畫布可能造成無限展開與注意力失控，必須具備按需載入、層級摘要與預算限制。

第四，多模態物件的即時同步成本差異很大；影片、3D 與直播資料不能和文字或向量物件使用完全相同的傳輸策略。

第五，Agent 在長時互動中仍可能累積錯誤。VisGym 顯示前沿模型在視覺多步互動中成功率有限，且無界歷史可能比截斷歷史更差[19]。

第六，畫布作為外部記憶可能儲存敏感資料，資源訂閱與自動上下文投影必須遵守最小揭露原則。

第七，最新的 CanvasAgent、JarvisHub 等工作與本文高度相鄰，因此本文的新穎性不在「AI 可以操作畫布」本身，而在 MCP 基底化、遞歸世界、雙層狀態、NVCL 內生化及多代理治理的整體綜合。

---

## 十七、結論

本文提出，原生視覺建構迴路要真正落地，不能只依賴一次性 SVG 生成、短暫工具呼叫或線性對話。它需要一個持續存在的多模態世界，使 AI 能知道自己正在看什麼、操作什麼、剛才改變了什麼，以及其他 Agent 正在何處工作。

此世界的核心關係可概括為：

$$
\boxed{
\text{Recursive Multimodal Infinite Canvas}
=
\text{World}
}
$$

$$
\boxed{
\text{MCP}
=
\text{Agent System Call and Context Layer}
}
$$

$$
\boxed{
\text{CRDT}
=
\text{Shared Incremental State}
}
$$

$$
\boxed{
\text{Event Ledger}
=
\text{Causal Experience Memory}
}
$$

$$
\boxed{
\text{Hypergraph}
=
\text{Semantic and Relational Structure}
}
$$

$$
\boxed{
\text{NVCL}
=
\text{Visual Cognitive and Action Loop}
}
$$

合併後形成：

$$
\boxed{
\text{MRMIC}
=
\text{原生多模態視覺智能作業基底}
}
$$

它不是把 AI 放入 Photoshop，也不只是替無限畫布增加聊天機器人，而是建立一個從底層就可被 AI 尋址、觀看、呼叫、修改、同步、分支、驗證及學習的視覺世界。

本文最終命題為：

$$
\boxed{
\text{只有當畫布成為持續世界，}
\text{MCP 成為行動神經系統，}
\text{NVCL 才能由演算法變成可成長的視覺智能。}
}
$$

---

## 參考文獻

[1] Zhu, H., Yang, Y., Weng, T., et al. *CanvasAgent: Enabling Complex Image Creation and Editing via Visual Tool Orchestration*. arXiv:2607.05465, 2026.

[2] Lin, Y., Lin, Z., Xing, Z., et al. *JarvisHub: An Open Harness for Canvas-Native Multimodal Creative Agents*. arXiv:2607.23588, 2026.

[3] Model Context Protocol. *Specification 2025-11-25: Server Overview*. 2025.

[4] Model Context Protocol. *Specification 2025-11-25: Resources*. 2025.

[5] Model Context Protocol. *Specification 2025-11-25: Tools*. 2025.

[6] Model Context Protocol. *Specification 2025-11-25: Transports*. 2025.

[7] Yjs. *Subdocuments: Embedding Yjs Documents into Yjs Documents*. Official Documentation.

[8] Open Canvas Working Group. *Open Canvas Interchange Format*. Candidate Recommendation.

[9] Yjs. *Document Updates*. Official Documentation.

[10] Yjs. *Y.Doc API and Transactions*. Official Documentation.

[11] Yjs. *Awareness & Presence*. Official Documentation.

[12] Figma. *Plugin API: DocumentNode.findAll*. Official Developer Documentation.

[13] tldraw. *AI Integrations*. Official Documentation, updated 2026.

[14] Xing, Z., Xu, R., Wang, Y., et al. *Native Active Perception as Reasoning for Omni-Modal Understanding*. ICML, 2026.

[15] Model Context Protocol. *Specification 2025-11-25: Tasks*. Experimental Utility.

[16] Lee, Y., Yen, H., Ye, X., & Chen, D. *Agentic Aggregation for Parallel Scaling of Long-Horizon Agentic Tasks*. ICML AIWILD, 2026.

[17] Sun, W., Lu, M., Ling, Z., et al. *Scaling Long-Horizon Agent via Context Folding*. ICML, 2026.

[18] tldraw. *Agent Starter Kit*. Official Documentation and Reference Implementation.

[19] Wang, Z., Zhang, J., Ge, J., et al. *VisGym: Diverse, Customizable, Scalable Environments for Multimodal Agents*. ICLR Workshop, 2026.

[20] Yun, Y., Lee, S. W., Choi, J., & Hyun, K. H. *Modeling Sequential Design Actions as Designer Externalization on an Infinite Canvas*. arXiv:2603.11569, 2026.

---

## 文件狀態

- 本文為架構命題與工程理論論文，不宣稱完整系統已實作。
- 本文以 MCP 2025-11-25 穩定規格為主要協定依據；後續草案應經版本適配層處理。
- 「MCP 作為基底」指 AI 可見資源及能力的規範性控制層，不表示以 MCP 取代 CRDT、資料庫、物件儲存或媒體串流。
- MRMIC 為本文暫定縮寫，正式產品命名可於 MVP 階段另行收斂。
