# **WebCodec Transcoder 設計書**

## **1\. 概要**

本アプリケーションは、ブラウザのWebCodecs APIと外部ライブラリ（MP4Box, mp4-muxer, webm-muxer）を利用し、動画ファイルの再エンコードおよびコンテナ変換を行うWebトランスコーダーです。

v2.0 改定の主要な変更点:  
ユーザーが動画および音声のビットレートを「現在のビットレートを維持」に設定した場合、再エンコードをスキップし、元のストリームデータをデコード/エンコードプロセスを経ずに直接出力コンテナにコピーする「パススルー（ストリームコピー）処理」を導入しました。これにより、処理速度の劇的な向上と画質・音質の完全な維持を実現します。

## **2\. システム構成**

| 要素 | 技術/ライブラリ | 役割 |
| :---- | :---- | :---- |
| フロントエンド | HTML, Tailwind CSS, JavaScript | UI表示、ファイル選択、設定管理 |
| 処理コア | Web Worker | メインスレッドからの分離、トランスコード実行 |
| デムクサ/パーサ | MP4Box.js | 入力ファイルの解析、ストリームデータの分離 |
| エンコーダ/デコーダ | WebCodecs API (VideoDecoder/Encoder, AudioDecoder/Encoder) | ストリームの復号化と再圧縮（トランスコード時） |
| ムクサ | mp4-muxer/webm-muxer | 最終的な動画ファイル（MP4/WebM）の組み立て |

## **3\. 処理フロー**

### **3.1. ファイル解析 (inspectFile)**

1. ユーザーがファイルをドロップ/選択。  
2. Web Workerにファイルを渡し、MP4Box.createFile()で初期化。  
3. mp4boxfile.appendBuffer() でファイル内容を解析し、onReady イベントで動画・音声トラック情報を取得。  
4. 元のコーデック、ビットレート、解像度、チャンネル数などを抽出し、メインスレッドに返却 (analysis\_result)。  
5. UIが設定領域を有効化し、元のビットレートを基準にスライダーの最大値を設定。

### **3.2. トランスコード/パススルー実行 (startTranscode)**

1. ユーザーが「変換開始」をクリック。  
2. Web Workerにファイルと出力設定（コーデック、ビットレート、フォーマット）を送信。  
3. **パススルー判定**を実行。  
4. 処理パイプラインを構築し、MP4Boxからサンプルデータを取得。  
5. 処理完了後、Muxerを終了し、結果のBlobをメインスレッドに返却 (complete)。

## **4\. パススルー判定ロジック（重要）**

startTranscode 関数内で、映像および音声ストリームごとにパススルーの可否を判定します。

| ストリーム | 判定フラグ | パススルー条件 | 処理内容 |
| :---- | :---- | :---- | :---- |
| 映像 | videoPassthrough | **① ビットレート設定が「維持」（-1）** AND **② 入力と出力のコーデックが互換性を持つ** | DemuxerからMuxerへ直接 EncodedVideoChunk をコピー |
| 音声 | audioPassthrough | **① ビットレート設定が「維持」（-1）** AND **② 入力と出力のコーデックが互換性を持つ** | DemuxerからMuxerへ直接 EncodedAudioChunk をコピー |

### **互換性チェック詳細 (isCodecCompatible 関数)**

入力ファイルの元のコーデック文字列（例: avc1.42001f, mp4a.40.2）と、ユーザーの出力設定（例: h264, aac）を比較します。

| ユーザー設定 (targetSetting) | 判定に用いる入力コーデックプレフィックス |
| :---- | :---- |
| h264 | avc1, h264 |
| h265 | hvc1, hev1 |
| av1 | av01 |
| aac | mp4a, aac |
| opus | opus |

## **5\. データパイプラインと処理分岐**

MP4Boxからサンプル（チャンク）が取得される onSamples イベント内で、パススルー判定結果に基づき処理を分岐します。

### **5.1. トランスコードモード（Passthrough が false の場合）**

従来のプロセス。再エンコードが必要な場合（ビットレート変更、またはコーデック変更）。

1. **Decoder**: MP4Boxから取得した EncodedChunk を VideoDecoder/AudioDecoder に投入。  
2. **Raw Data**: デコードされた VideoFrame/AudioData （非圧縮データ）が出力される。  
3. **Encoder**: VideoFrame/AudioData を VideoEncoder/AudioEncoder に投入し、新しい設定で再圧縮。  
4. **Muxer**: エンコーダから出力された新しい EncodedChunk を Muxer に投入。

### **5.2. パススルーモード（Passthrough が true の場合）**

エンコード・デコード処理を完全にスキップします。

1. **Demuxer**: MP4Boxから取得したサンプルデータ (sample.data) をそのまま利用。  
2. **Chunk Creation**: サンプルデータ、タイムスケール、タイプ情報を用いて new EncodedVideoChunk() または new EncodedAudioChunk() を作成。  
   * **重要**: タイムスタンプはMP4BoxのタイムスケールからWebCodecsで要求される**マイクロ秒** (timestampUs \= (sample.cts \* 1000000\) / sample.timescale) に変換して使用します。  
3. **Muxer**: 作成した EncodedChunk を直接 Muxer (muxer.addVideoChunk/muxer.addAudioChunk) に投入。最初のフレームまたはキーフレーム時に元のコーデックの description も一緒に渡します。

## **6\. 入出力仕様**

### **6.1. 入力**

| 項目 | 詳細 |
| :---- | :---- |
| ファイル形式 | MP4, MOV (QuickTime), WebM (MP4Boxが解析可能なコンテナ) |
| 映像コーデック | H.264 (AVC), H.265 (HEVC), AV1 (WebCodecsがデコード可能なもの) |
| 音声コーデック | AAC, Opus (WebCodecsがデコード可能なもの) |

### **6.2. 出力**

| 項目 | 詳細 |
| :---- | :---- |
| ファイル形式 | MP4 (mp4-muxer), WebM (webm-muxer) |
| 映像コーデック | H.264, AV1, H.265 (ブラウザサポートによる) |
| 音声コーデック | AAC, Opus |
| ビットレート | 100 kbps から最大 10 Mbps まで調整可能、または元のビットレートを維持（パススルー） |

## **7\. エラー処理**

* MP4Boxによるファイル解析エラー、WebCodecsによるデコード/エンコード設定エラーが発生した場合、Web Worker内で捕捉し、メインスレッドにエラーメッセージを送信 (type: 'error')。  
* メインスレッドではカスタムアラートモーダルを表示し、ユーザーにエラー内容を伝達。  
* エラー発生時は、プログレスバーを非表示にし、「変換開始」ボタンを元に戻します。