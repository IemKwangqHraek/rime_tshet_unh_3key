# prengQvm 小改版：中古漢語全拼與三拼

基於 [IemKwangqHraek/prengQvm](https://github.com/IemKwangqHraek/prengQvm)，保留原拼音的大部分拼式，以固定三鍵輸入一個帶聲調的中古漢語音節。全拼僅用小寫拉丁字母，三拼按鍵不需要 Shift。

本版採用東一、侯 `wu`（尤仍爲 `u`）、豪 `oaw`、蒸 C 韻核 `v`；保留 `a/ae`、冬韻 `ow`、顯式等類標記，取消莊組庚三歸二等。特殊字與全部聲韻規則見[完整說明](docs/全拼與三拼方案.md)。

| 第一鍵 | 第二鍵 | 第三鍵 |
| --- | --- | --- |
| 聲母基幹，24 鍵 | 等類、開合與韻核，23 鍵 | 韻尾與聲調，21 鍵 |

同一字面片段固定查同一鍵，允許不同片段共鍵，由完整三鍵消歧；不要求每按一鍵都立即確定此前片段。已核對 3,808 個音韻地位及補充「怎」，全拼與完整三鍵均無碰撞。這不是對所有理論地位或其他韻書的無碰撞保證。

| 字 | 全拼 | 分段 | 三鍵 |
| --- | --- | --- | --- |
| 東 | `twung` | `t / wu / ng` | `FJL` |
| 冬 | `towng` | `t / ow / ng` | `FQL` |
| 豪 | `ghoaw` | `gh / oa / w` | `ALY` |
| 生，平聲 | `sriaeng` | `s / riae / ng` | `LSL` |
| 怎 | `tsvmq` | `ts / v / mq` | `REM` |

## 使用推導方案

開啓[切韻音系推導器](https://nk2028.shn.hk/tshet-uinh-deriver/)，新增自訂方案，貼入 [prengQvm.js](prengQvm.js) 的全部內容。可選全拼、三拼、三段、全拼及三拼四種輸出。

腳本是推導器的 JavaScript 函數體，不能直接用 `node prengQvm.js` 執行。怎不在官方內建字表中，透過以下本地入口補充查詢。

## 本地查詢與驗證

使用 Node.js 22 以上版本：

```sh
npm ci --ignore-scripts
npm test
npm run derive -- --char 冬 豪 打 冷 地 爹 怎 𩦠
npm run derive -- --position 端一冬平 生開三庚平
```

`npm test` 使用固定版本的官方執行器，檢查完整拼式、三鍵、片段查鍵、特殊讀音、已提交碼表及文檔鍵表，不覆寫結果。明確修改方案後，以 `npm run build:data` 重新生成 `data/` 並審核差異，再執行測試。

[自動驗證流程](.github/workflows/verify.yml)在 Node.js 22、24 上執行相同測試，並校驗固定上游資料及反切統計；CI 不回寫生成結果。

## 文檔與資料

- [Rime 使用與改鍵](docs/Rime使用與改鍵.md)：生成、安裝全拼／三拼方案，修改 JSON 鍵位配置及擴充詞典。
- [全拼與三拼方案](docs/全拼與三拼方案.md)：完整聲韻規則、26 鍵表、例字及用法。
- [設計取捨](docs/設計取捨.md)：輸入局部性、共鍵與解析要求。
- [鍵位評價框架](docs/鍵位評價框架.md)：固定三段順序、不計記憶成本，以古今語料評估按鍵負擔與跨字連打。
- [鍵位搜尋實現計劃](docs/鍵位搜尋實現計劃.md)：語料固定、等概率讀音統計、評分及候選搜尋的實作步驟。
- [鍵位優化結果](docs/鍵位優化結果.md)：古今混合語料、二鍵／三鍵動作對照、最終選擇及重現方法。
- [音系與豪韻](docs/音系與豪韻.md)：拼寫與擬音的區別、豪韻證據及反切核查。
- [資料來源與重現](docs/資料來源與重現.md)：固定版本、下載地址、校驗值及可選反切分析。
- [全拼與三鍵對照](data/positions.tsv)、[鍵表](data/keyboard.tsv)、[核對摘要](data/check.json)。

`prengQvm.js` 是可單獨匯入的推導方案；`scripts/` 是本地查詢、鍵位分析與驗證工具；`data/` 收錄本方案產生的碼表。外部語料、衍生頻率矩陣、上游原始碼、完整《廣韻》CSV、`node_modules` 和下載快取不隨庫提交；只保留固定來源連結、校驗值及可重現工具。

## Rime 輸入方案

```sh
npm run build:rime
```

生成可安裝的全拼／三拼方案及共用字典至 `dist/rime/`。三拼按鍵由 [config/keyboards/default.json](config/keyboards/default.json) 配置；修改後再次生成即可，亦支援 `npm run build:rime -- --layout config/keyboards/my-layout.json --out dist/my-layout`。生成時檢查漏配、非法按鍵及完整三鍵碰撞，候選提供全拼提示。

安裝及改鍵流程見 [Rime 使用與改鍵](docs/Rime使用與改鍵.md)。預設 JSON、推導器與已提交碼表均使用「古今混合頻率優化 v1」；原始試排保存在 [baseline.json](config/keyboards/baseline.json) 供比較。
