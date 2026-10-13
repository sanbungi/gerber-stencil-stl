# Gerber ステンシル STL

KiCad の Gerber（Edge_Cuts と F_Paste / B_Paste）から、3Dプリント用のはんだペーストステンシルを実寸 STL で生成するブラウザツールです。

**https://sanbungi.github.io/gerber-stencil-stl/**

1. Edge_Cuts と Paste の Gerber をドロップ
2. 厚みを設定
3. 「STL ダウンロード」

アドバンス設定: 面 (F/B)、位置合わせ枠、枠の高さ・すき間・幅、外側のつば、開口の縮小。

- STL は印刷向き（スキージ面がベッド側、位置合わせ枠が上）で出力されます。単位は mm。
- 処理はすべてブラウザ内で完結し、ファイルはどこにも送信されません。
- 対応: RS-274X、アパーチャ C/R/O/P とマクロ（KiCad RoundRect 等）、領域 (G36/G37)、円弧、クリア極性。ステップ&リピートは未対応。

依存ライブラリ: [Clipper](https://www.npmjs.com/package/clipper-lib)、[earcut](https://github.com/mapbox/earcut)、[JSZip](https://stuk.github.io/jszip/)（CDN 読み込み）
