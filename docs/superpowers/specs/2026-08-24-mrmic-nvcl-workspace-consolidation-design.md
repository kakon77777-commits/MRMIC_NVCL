# MRMIC／NVCL 正式工作區整併設計

日期：2026-08-24  
狀態：設計已由專案擁有者選定方案 A；等待書面規格審閱後進入實作計畫

## 1. 目標

將 `D:\Ai\work together\MRMIC_NVCL` 建立為 MRMIC／NVCL 唯一正式本機 Git checkout，讓程式碼、理論、工程文件、測試證據與 GitHub `kakon77777-commits/MRMIC_NVCL` 維持單一且可驗證的同步關係。

這次整併不是把整個研究資料夾鏡像進 Git。研究母本、階段 ZIP 與驗證暫存仍留在正式 checkout 之外；Git 儲存庫只保存可維護的程式碼、canonical 理論、文件與選定證據。

## 2. 已確認基準

- GitHub 預設分支：`main`
- 基準 commit：`6606b54532c0f327206e7c021120370044b6e0ff`
- 基準版本：Phase 12／v0.13.0
- 基準 checkout：乾淨，且與 `origin/main` 一致
- 未合併的 Phase 13 遠端分支只作為候選資料，不在本次整併中採用、合併或重寫
- 新目標資料夾在 clone 前為空；clone 後直接以目標根目錄作為 Git repository root，不再增加 `MRMIC_NVCL_MVP` 中間層

## 3. 權威來源層級

### 3.1 程式與工程文件

GitHub `main` 是本次整併的程式碼與工程文件基準。任何未合併分支、ZIP 內容或外部複本都不能靜默覆寫 `main`。

### 3.2 理論

`docs/theory/canonical/` 是正式工作樹中的唯一理論權威位置。研究母本只作為外部 upstream 與 byte-level 驗證來源；若檔名與雜湊均相同，就不建立第二份複本。

本次確認的 canonical 理論如下：

| 文件 | SHA-256 |
| --- | --- |
| `原生符號繪圖假說_命題猜想論文_v1.0.md` | `b753b1c6594f47f8ea2acfc14f49fd086a2fb3d41461d413160ac7d2900e3be9` |
| `原生視覺建構迴路_NVCL_命題猜想論文_v1.0.md` | `fc3883bb0d775422b4ffc9a00417edb3e0d9f6db13060f2503604530441ab045` |
| `MCP原生遞歸多模態無限畫布_MRMIC_架構命題論文_v1.0.md` | `e572b7e1c912242acf8f23b83c4a082ee5a81a266ac0cf38a262a1666c97d8e5` |
| `MRMIC_NVCL_MVP技術白皮書_v0.1.md` | `7cdbebffa010497502b69c5661bf7e894451d261d41ee40c8d5fc641f5db2451` |
| `視之基底系列_10_視之一般算子論_差異的場化位格化與回饋化_v1.0.md` | `4fc1356435bda6a7ef4d5ca89585ed026b9319cbefc621c9ddbb36f21a7704d9` |

前四篇已與外部研究母本逐 byte 相同；第五篇是現有 canonical 理論的一部分，必須保留。

### 3.3 Git 歷史與發布證據

Git 歷史保留被移除相容檔案的來源。`MANIFEST.json` 與 `SHA256SUMS.txt` 描述整理後的當前可發布樹，不是假裝被刪除檔案從未存在。

## 4. 目標結構

```text
D:\Ai\work together\MRMIC_NVCL\
├── .git\
├── apps\
├── packages\
├── tests\
├── scripts\
├── artifacts\                 # 只保留已追蹤、可發布的有界證據
├── docs\
│   ├── INDEX.md               # 文件總入口
│   ├── theory\
│   │   ├── README.md          # 理論權威與閱讀順序
│   │   └── canonical\         # 唯一正式理論全文
│   ├── provenance\
│   │   └── THEORY_SOURCE_MAP.md
│   ├── superpowers\specs\
│   └── 既有 ADR、Runtime、Phase 文件
├── README.md
├── MANIFEST.json
└── SHA256SUMS.txt
```

`node_modules/` 與 `dist/` 是可重建且被忽略的本機產物，不是同步來源。

## 5. 整理操作

1. 從 `origin/main` 建立隔離實作分支。
2. 再次確認工作樹乾淨、HEAD 與設計基準關係可追溯。
3. 驗證五篇 canonical 理論存在、UTF-8 可讀且 SHA-256 符合本規格。
4. 移除 `docs/theory/` 根目錄下四個 byte-identical、亂碼檔名的歷史相容複本；不修改 canonical 全文。
5. 新增 `docs/INDEX.md`，按「理論、架構契約、ADR、Phase 報告、測試／證據」整理入口。
6. 新增 `docs/theory/README.md`，宣告 `canonical/` 的唯一權威性、五篇閱讀順序與理論／工程宣稱邊界。
7. 新增 `docs/provenance/THEORY_SOURCE_MAP.md`，記錄檔名、雜湊、比對結果與母本不被修改的原則；公開文件不保存私人絕對路徑。
8. 更新根 `README.md`，加入工作區地圖、canonical 理論入口、正式同步規則與 Phase 13 未採用邊界。
9. 所有內容變更完成後才執行 `npm run release:manifest`，使 manifest 收錄整理後的 tracked／untracked candidate tree。
10. 立即執行 `npm run release:verify`，確認所有 manifest 路徑、大小與雜湊。
11. 通過完整驗證後提交、推送、開 PR；不直接改寫 `main`。

## 6. 明確排除

以下內容不複製到正式 checkout，也不推送 GitHub：

- Phase 0–7 ZIP 歷史封包
- 外部 `.release-verification` 暫存
- 外部研究資料夾的整體鏡像
- `node_modules/`、本機 `dist/`、log、資料庫與非追蹤 runtime 狀態
- 未經獨立審核的 Phase 13 候選分支內容
- Provider 憑證、環境變數、帳戶 Token 或真實 Provider 新呼叫結果

本次整理不執行真實 Provider A/B；所有驗證必須保持離線，除 Git fetch／push／PR／CI 之外不產生外部服務副作用。

## 7. 驗證閘門

實作完成後至少執行：

```powershell
npm ci
npm run check
npm test
npm run phase12:demo
npm run release:manifest
npm run release:verify
git diff --check
git status --short --branch
```

另外驗證：

- 五篇 canonical 理論 SHA-256 與本規格一致
- 四個亂碼檔名不再出現在當前工作樹、manifest 或 SHA sums
- `docs/INDEX.md` 的所有本機連結存在
- `docs/theory/README.md` 只把 `canonical/` 宣告為全文權威
- `MANIFEST.json.fileCount` 等於 `files.length`
- 正常 `npm test` 與 Phase 12 demo 不觸發真實 Provider
- GitHub CI 通過後才允許合併

## 8. 失敗與回復策略

- 若 canonical 理論雜湊不符：停止，不覆寫，回報哪一份漂移。
- 若亂碼檔案不是 canonical 的 byte-identical 複本：停止，不刪除。
- 若 manifest 生成後驗證失敗：保留分支，修正來源或生成流程，不手工修改雜湊掩蓋失敗。
- 若測試、Phase 12 demo 或 CI 失敗：不合併、不推送發布宣稱。
- 若遠端 `main` 在實作期間前進：先 fetch 並比較；不得 force-push 或靜默覆蓋協作者更新。
- 外部研究母本全程唯讀；本次工作不移動、改名或刪除母本與 ZIP。

## 9. 完成條件

完成時必須同時成立：

1. `D:\Ai\work together\MRMIC_NVCL` 是唯一正式本機 checkout。
2. 本機 `main` 與 GitHub `main` 指向同一個已驗證 merge commit。
3. 當前工作樹乾淨。
4. canonical 理論只有一套正常 UTF-8 檔名全文。
5. 文件入口、provenance、manifest 與 SHA sums 對整理後結構一致。
6. 完整離線測試、Phase 12 demo、release verification 與 GitHub CI 全部通過。

