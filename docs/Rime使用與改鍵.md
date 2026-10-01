# Rime 全拼與三拼框架

兩套方案共用全拼字典 `preng`，以 Rime 內建的 `script_translator` 提供候選、連續輸入、自造詞及用戶詞典。全拼方案爲 `preng`，三拼方案爲 `preng_sp`；兩者各有自己的 prism（輸入碼索引），共用用戶詞典。不需要 Lua、TUPA 字典或額外反查方案。

架構參考 [rime-tupa](https://github.com/nk2028/rime-tupa) 及 [rime-tupa-sp](https://github.com/syimyuzya/rime-tupa-sp)：共用全拼字典、獨立三拼 prism，以及候選全拼提示。拼音規則仍使用本倉庫的 [prengQvm.js](../prengQvm.js)，不是 TUPA 拼音；預設採用[古今混合頻率優化鍵表](鍵位優化結果.md)。

## 生成與安裝

使用 Node.js 22 以上版本，在倉庫目錄執行：

```sh
npm ci --ignore-scripts
npm run build:rime
npm test
```

生成目錄爲 `dist/rime/`，可以離線重建（安裝 npm 依賴後不再下載字庫）。將其中以下三個檔案複製到 Rime 用戶目錄：

```text
preng.schema.yaml
preng_sp.schema.yaml
preng.dict.yaml
```

常見用戶目錄：鼠鬚管 `~/Library/Rime/`，小狼毫 `%APPDATA%\Rime\`，Fcitx5 `~/.local/share/fcitx5/rime/`。以輸入法選單提供的用戶資料夾爲準。

在現有 `default.custom.yaml` 的 `patch/schema_list` 加入以下兩项，保留其他已有方案；沒有該檔時，可從輸出目錄的 `default.custom.yaml.example` 複製建立：

```yaml
patch:
  schema_list:
    - schema: preng
    - schema: preng_sp
```

重新部署後，在方案選單選擇「中古漢語·全拼」或「中古漢語·三拼」。生成命令只寫入輸出目錄，不會修改現用 Rime 配置或自動部署。

## 輸入與候選

- 全拼輸入小寫完整拼音，例如 `twung` → 東、`towng` → 冬、`tsvmq` → 怎。上、去聲的 `q/h` 和入聲韻尾均保留。
- 三拼輸入小寫三鍵，例如預設配置的 `fjl` → 東、`fql` → 冬、`rem` → 怎。不需要 Shift，空片段仍佔一鍵。
- 連續輸入可組詞，例如全拼 `trungkoq`、三拼 `fnlkdj` → 中古；也可用單引號明確分開音節，例如 `trung'koq` 或 `fnl'kdj`。
- 空格選定候選；數字選詞、翻頁及中西文切換沿用 Rime 預設。三拼滿三鍵不會自動上屏，可以繼續輸入詞語。
- 候選註釋顯示全拼；不滿三鍵時可補全候選。共鍵音節可能要到第三鍵才能區分，前兩鍵沒有唯一的逐段還原提示。

全拼暫不增加聲母簡拼或省調規則。字典以《廣韻》單字爲主，另有五條示例詞；權重統一爲 100，並非現代語料字頻。自動組句的選詞品質受字庫和用戶學習影響。簡繁轉換、普通話／粵語反查尚未接入，可在此框架上另加 Rime custom 配置。

## 修改鍵位

編輯 [config/keyboards/default.json](../config/keyboards/default.json)，再執行 `npm run build:rime`。也可以複製一份配置試排：

```sh
npm run build:rime -- --layout config/keyboards/my-layout.json --out dist/my-layout
```

JSON 格式爲：

```json
{
  "version": 1,
  "name": "我的試排",
  "keys": {
    "k1": { "p": "p", "ph": "o", "": "w" },
    "k2": { "wu": "g", "ow": "w" },
    "k3": { "ng": "d", "": "k" }
  }
}
```

以上僅示意，實際配置須從完整預設檔修改。`k1/k2/k3` 分別對應第一、第二、第三段；物件的鍵是完整字面片段，值是單個小寫 `a`–`z` 按鍵。空片段以 JSON 空字串 `""` 表示，不使用字面 `∅`。目前遵循 26 個英文字母鍵的設計。

允許不同片段共鍵，但不允許不同已驗證音節的完整三鍵相同。生成前檢查：

1. 三段片段全部有配置，沒有拼錯或多餘的片段。
2. 每項都是單個合法按鍵。
3. 3,808 個聯集地位及補充「怎」的完整三鍵無碰撞。
4. 字典的每個全拼都在已驗證音節集合內；示例詞每字的選讀確實存在。

配置錯誤會報出片段或碰撞音節，並在寫入前停止，保留上一份輸出。例如將 K2 `ia` 改成與 `rae` 同鍵，會報出 `biangq` 與 `braengq` 的衝突。

重建後檢查輸出目錄的 `keyboard.tsv`、`codes.tsv` 和 `build.json`，再複製更新後的三個 YAML 檔並重新部署。僅改鍵位不改全拼字典、詞條或用戶詞典；三拼 schema 的版本包含配置雜湊，以觸發 prism 更新。`schema_id` 保持不變，因此不同試排預設是互相替換使用。

預設 [JSON 鍵表](../config/keyboards/default.json)、根目錄 `prengQvm.js`、`data/keyboard.tsv` 及 `data/positions.tsv` 使用同一最終配置。原始試排另存爲 [baseline.json](../config/keyboards/baseline.json)，可用 `--layout` 生成比較版；自訂 JSON 不會自動改寫推導腳本或文檔。

## 擴充詞典與生成原理

[rime/phrases.tsv](../rime/phrases.tsv) 是手工詞庫入口，每行以 Tab 分成「詞語、空格分隔的全拼、正整數權重」。多音字必須明確選讀；改鍵位時不用重編詞語讀音。重建會將這些詞條合入共用字典。若要擴充字庫或補充讀音，應先擴充推導及字音來源、納入片段／碰撞校驗，再產生詞典。

[scripts/build_rime.mjs](../scripts/build_rime.mjs) 從固定版本 `tshet-uinh` 內建字庫逐條取有效地位，經現有推導器產生字音；排除上游無有效地位的四條資料，具體清單寫入 `build.json`。相同「字＋全拼」去重，加入「怎」，目前共 25,304 個字音。四個舊版兼容地位參與編碼驗證，但不爲它們另造現行字庫沒有的字音。

三拼規則由每個已驗證音節生成精確的 `xform/^全拼$/三鍵/`，中間使用大寫三鍵、最後一次轉小寫，避免一條規則的輸出誤入另一條規則。不猜測共鍵片段，也不將三段硬拼回全拼，因而保留「爹」`tiae` 與 `t / va / ∅` 等例外。這些規則由 Rime 在部署時編譯成 prism，不是在每次按鍵時逐條套用。完整音節映射比手寫聲韻正則長，但能隨配置重生並逐音節核對。

[rime/templates/schema.yaml](../rime/templates/schema.yaml) 控制兩套方案共用的介面和引擎配置。`dist/` 是可重建產物，不提交 Git；分發生成字典時應連同 `SOURCES.txt` 保留來源與授權。

## 驗證

`npm test` 包含原有音系／文檔測試，以及 [Rime 生成測試](../scripts/test_rime.mjs)：遍歷全部 3,809 音節執行生成規則、整體置換鍵位後重建、確認全拼字典不變、非法配置攔截、CLI 輸出和逐位元重現。CI 亦生成一次安裝產物。

另附 [librime 整合測試](../scripts/test_rime_engine.cc)，需要 C++17 編譯器、librime 開發頭文件與函式庫。Linux 安裝相應開發套件後，可用以下命令編譯；第二個參數是安裝環境的 Rime 共用資料目錄：

```sh
c++ -std=c++17 scripts/test_rime_engine.cc $(pkg-config --cflags --libs rime) -o /tmp/preng-test-rime
npm run build:rime
test_dir=$(mktemp -d)
cp dist/rime/* "$test_dir/"
/tmp/preng-test-rime "$test_dir" /usr/share/rime-data
```

務必使用臨時目錄作第一個參數，測試會編譯 schema 並建立測試用戶詞典。測試涵蓋全拼及三拼的普通字、特殊字、擴展區字、補充字、連寫及單引號分音節詞語、全拼註釋、候選選定／上屏，以及未完成音節補全。也可將其他鍵位配置的生成目錄複製進新的臨時目錄後執行，測試從 `codes.tsv` 讀取該次按鍵。
