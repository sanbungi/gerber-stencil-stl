# Gerber Stencil STL

Browser tool that turns KiCad Gerbers (Edge_Cuts + F_Paste / B_Paste) into a true-scale STL of a 3D-printable solder paste stencil.

**https://sanbungi.github.io/gerber-stencil-stl/**

1. Drop the Edge_Cuts and Paste Gerbers
2. Set the thickness
3. Click **Download STL**

Advanced: side (F/B), alignment frame, frame height / clearance / width, outer flange, aperture shrink.

- The STL is in print orientation (squeegee face on the bed, alignment frame pointing up), units in mm.
- Everything runs in your browser; files are never uploaded.
- Supports RS-274X, apertures C/R/O/P and macros (e.g. KiCad RoundRect), regions (G36/G37), arcs, clear polarity. Step & repeat is not supported.
- UI language: English / 日本語 (toggle at the top right).

Libraries: [Clipper](https://www.npmjs.com/package/clipper-lib), [earcut](https://github.com/mapbox/earcut), [JSZip](https://stuk.github.io/jszip/) (loaded from CDN)

---

## 日本語

KiCad の Gerber（Edge_Cuts と F_Paste / B_Paste）から、3Dプリント用のはんだペーストステンシルを実寸 STL で生成するブラウザツールです。

1. Edge_Cuts と Paste の Gerber をドロップ
2. 厚みを設定
3. 「STL ダウンロード」

STL は印刷向き（スキージ面がベッド側、位置合わせ枠が上）で出力されます。処理はすべてブラウザ内で完結し、ファイルはどこにも送信されません。右上で日本語に切り替えられます。
