# compat_frame_v0 → native_resource_portal_v1

`compat_frame_v0` 是 PMW 在 MRMIC 尚無 first-class portal 時使用的相容投影。Migration 只轉換穩定 resource identity、Canvas geometry、display/interaction mode 與可選 preview reference。

不遷移：URL、WebContents、terminal status、principal token、claimed identity、runtime coordinates 或其他 provider-owned volatile state。

Canonical fixtures：

- `contracts/phase13/fixtures/compat-frame-v0.json`
- `contracts/phase13/fixtures/native-resource-portal-v1.json`

Migration 由 `migrateCompatFrameV0()` 執行；malformed 或帶 identity 欄位的輸入 fail closed。
