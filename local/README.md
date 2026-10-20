# 本機 REFPROP 水計算

此模式直接呼叫已安裝的 REFPROP，不複製 DLL、FLD、混合物資料或 Fortran 原始碼。請自行持有適用的 REFPROP 使用授權。

## 啟動

Windows 安裝 Python 3.11 或更新版本後，在儲存庫目錄執行：

```powershell
py -3.11 local\serve_refprop.py
```

開啟輸出的網址：<http://127.0.0.1:8768/pycool.html?water=refprop>。保留服務視窗，完成後按 Ctrl+C 停止。不需要安裝 Python 套件。

預設讀取 `C:\Program Files (x86)\REFPROP`。64 位元 Python 使用 `REFPRP64.DLL`；32 位元 Python 使用 `REFPROP.DLL`。可自行指定安裝位置或連接埠：

```powershell
py -3.11 local\serve_refprop.py --refprop 'C:\Program Files (x86)\REFPROP' --port 8769
```

## 計算範圍

- 水的基本常數、飽和輸入、指定任兩性質、氣液飽和表、Ph 圖與滑鼠讀值均改由安裝的 REFPROP 計算，輸入輸出在介面邊界統一轉為 SI。
- 水的熔化／昇華壓力使用原生介面。舊版 `MELTT` 可能選到高壓冰分支，因此 Ice Ih 使用 `MELTP` 在其低壓分支反算，端點也遵守該 DLL 的原生限制，不沿用其他引擎的壓力。舊版熔化線上端可能比 273.16 K 略低，這不是外推。
- 冰的完整物性仍由既有 IAPWS Ice Ih 模型補充，**並非 REFPROP 的冰物性輸出**；這份舊版 DLL 未公開冰相 Gibbs 模型介面。焓熵參考與水模型保持三相點液體內能／熵為零。
- 共存液相／氣相僅在原生流體模型範圍內計算，低於其下限時顯示「無資料」。兩相混合物不提供 cp、cv、黏度。TH、TS、TU 可能多解，使用原生 `kr=1`（低密度根）；HU、HQ、SQ、UQ 沒有對應的原生 flash 介面時明確拒絕。舊版 `DQFL2` 的結果精度不足，因此 DQ 完全使用原生 `TQFLSH` 在飽和範圍內數值反算，核對輸出密度，多解取較高溫根；避開臨界點最後 1e-7 K 的奇異端點。
- 每次 flash 核對兩個輸入與 `h = u + pv`，兩相狀態以原生 `TQFLSH` 重算核對；舊版 DH、DS、DU、SU 如有不一致，使用原生 TD／TS 計算數值修正至輸入吻合，不採用不收斂卻回報成功的數值，也不切換其他模型。
- 舊版 `PQFLSH` 接近三相點時可能返回錯誤狀態；PQ 改由原生 `TQFLSH` 在三相點至臨界點之間反算，核對壓力至 1 ppm，端點僅吸附原生數值精度差，不外推。
- 其他冷媒保持原本的瀏覽器計算。沒有 `?water=refprop` 的靜態網站也保持原模式；不會嘗試跨來源連接使用者電腦。REFPROP 模式失聯會報錯，不會悄悄改回其他引擎。

Windows DLL 不能直接在瀏覽器或 GitHub Pages 執行。本機模式需此服務；推送網站不會讓公開網站自動取得 REFPROP。公開提供 REFPROP 運算需另行確認授權並部署合適的後端。

服務僅監聽 `127.0.0.1`，檢查 Host、Origin 與 Fetch Metadata，計算 POST 需每次啟動產生的工作階段 token，不開放 CORS；靜態檔案限網站內容，不公開本機程式、隱藏目錄或安裝資料。原生 DLL 非執行緒安全，所有計算由單一 HTTP 執行緒序列化。

前端最多同時送出四筆計算請求，其他請求排隊，避免大量產表耗盡瀏覽器連線資源。每筆請求開始送出後限時 15 秒，排隊時間不計入；連線失敗會停止後續排隊請求並要求重新整理。

## 驗證

```powershell
py -3.11 -m unittest discover -s tests -p 'test_refprop*.py' -v
```

原生測試需在有上述 REFPROP 安裝的 Windows 執行。瀏覽器回歸頁 [water-tests.html](../tests/water-tests.html) 驗證靜態模式的冰模型與氣液模型，並以模擬 API 驗證 REFPROP 前端的路由、快取、四筆請求上限與失聯處理；此頁不需安裝 REFPROP。
