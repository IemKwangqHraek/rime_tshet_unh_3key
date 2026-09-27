# prengQvm 小改版：中古漢語全拼與三拼

基於 [IemKwangqHraek/prengQvm](https://github.com/IemKwangqHraek/prengQvm)，保留原拼音的大部分拼式，以固定三鍵輸入一個帶聲調的中古漢語音節。全拼僅用小寫拉丁字母，三拼按鍵不需要 Shift。

本版採用東一、侯 `wu`（尤仍爲 `u`）、豪 `oaw`、蒸 C 韻核 `v`；保留 `a/ae`、冬韻 `ow`、顯式等類標記，取消莊組庚三歸二等。特殊字與全部聲韻規則見[完整說明](docs/全拼與三拼方案.md)。

| 第一鍵 | 第二鍵 | 第三鍵 |
| --- | --- | --- |
| 聲母基幹，24 鍵 | 等類、開合與韻核，23 鍵 | 韻尾與聲調，21 鍵 |

同一字面片段固定查同一鍵，允許不同片段共鍵，由完整三鍵消歧；不要求每按一鍵都立即確定此前片段。已核對 3,808 個音韻地位及補充「怎」，全拼與完整三鍵均無碰撞。這不是對所有理論地位或其他韻書的無碰撞保證。

| 字 | 全拼 | 分段 | 三鍵 |
| --- | --- | --- | --- |
| 東 | `twung` | `t / wu / ng` | `TGD` |
| 冬 | `towng` | `t / ow / ng` | `TWD` |
| 豪 | `ghoaw` | `gh / oa / w` | `EBL` |
| 生，平聲 | `sriaeng` | `s / riae / ng` | `SUD` |
| 怎 | `tsvmq` | `ts / v / mq` | `FNV` |

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

- [全拼與三拼方案](docs/全拼與三拼方案.md)：完整聲韻規則、26 鍵表、例字及用法。
- [設計取捨](docs/設計取捨.md)：輸入局部性、共鍵與解析要求。
- [音系與豪韻](docs/音系與豪韻.md)：拼寫與擬音的區別、豪韻證據及反切核查。
- [資料來源與重現](docs/資料來源與重現.md)：固定版本、下載地址、校驗值及可選反切分析。
- [全拼與三鍵對照](data/positions.tsv)、[鍵表](data/keyboard.tsv)、[核對摘要](data/check.json)。

`prengQvm.js` 是可單獨匯入的推導方案；`scripts/` 是本地查詢與驗證工具；`data/` 收錄本方案產生的結果及來源清單。上游原始碼、完整《廣韻》CSV、`node_modules` 和下載快取不隨庫提交。未採用的元音與順序解析實驗不列入發布內容。

本倉庫提供全拼、三拼與推導基礎設施；目前尚未交付可安裝的 Rime schema、字詞典和候選介面。
