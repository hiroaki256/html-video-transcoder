function workerBody() {
    let MediaBunny = null;
    let libraryLoadPromise = null;
    let currentConversion = null; // 現在実行中のConversionインスタンス

    async function loadLibrary() {
        if (MediaBunny) return;
        try {
            // ユーザー提供のURL: https://cdn.jsdelivr.net/npm/mediabunny/dist/modules/src/index.min.js
            // クラシックワーカーでのESM互換性のために動的インポートを使用
            const module = await import('https://cdn.jsdelivr.net/npm/mediabunny@1.25.1/+esm');
            MediaBunny = module.default || module;
            console.log("[Worker] MediaBunny loaded. Keys:", Object.keys(MediaBunny));
        } catch (e) {
            console.error("[Worker] Library load failed:", e);
            self.postMessage({ type: 'error', error: 'ライブラリの読み込みに失敗しました。: ' + e.message });
            throw e;
        }
    }

    // すぐに読み込みを開始
    libraryLoadPromise = loadLibrary();

    self.onmessage = async (e) => {
        const { type, data } = e.data;

        // ライブラリが読み込まれていることを確認
        if (!MediaBunny) {
            try {
                await libraryLoadPromise;
            } catch (e) {
                return; // エラーは既に報告済み
            }
        }

        try {
            if (type === 'inspect') {
                await inspectFile(data.file);
            } else if (type === 'start') {
                await startTranscode(data);
            } else if (type === 'cancel') {
                await cancelTranscode();
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            self.postMessage({ type: 'error', error: errorMessage });
        }
    };

    // ファイル情報を解析する関数
    async function inspectFile(file) {
        try {
            // MediaBunny Inputの作成
            // formatsオプションが必須: MP4, WebM, QTFF(MOV)などを指定
            // エラー "options.formats must be an array of InputFormat" の修正:
            // Inputコンストラクタは単一のoptionsオブジェクトを受け取り、sourceプロパティにSourceインスタンス(BlobSource等)を要求します。
            const source = new MediaBunny.BlobSource(file);
            const input = new MediaBunny.Input({
                source: source,
                formats: [
                    new MediaBunny.Mp4InputFormat(),
                    new MediaBunny.WebMInputFormat(),
                    new MediaBunny.QuickTimeInputFormat(),
                    new MediaBunny.MatroskaInputFormat()
                ]
            });
            console.log("[Worker] inspectFile: Calling getTracks and computeDuration");
            const tracks = await input.getTracks();
            const duration = await input.computeDuration();
            console.log("[Worker] inspectFile: Tracks received", tracks);

            const videoTrack = tracks.find(t => t.type === 'video');
            const audioTrack = tracks.find(t => t.type === 'audio');

            // ビットレート推定
            let videoBitrate = 0;
            let audioBitrate = 0;

            // トラック統計からビットレートを取得するヘルパー
            const getTrackBitrate = async (track) => {
                if (track && track.computePacketStats) {
                    try {
                        const stats = await track.computePacketStats();
                        return stats.averageBitrate || stats.bitrate || 0;
                    } catch (e) {
                        console.warn("[Worker] Failed to compute packet stats:", e);
                    }
                }
                return 0;
            };

            if (videoTrack) videoBitrate = await getTrackBitrate(videoTrack);
            if (audioTrack) audioBitrate = await getTrackBitrate(audioTrack);

            if ((!videoBitrate && videoTrack) || (!audioBitrate && audioTrack)) {
                const globalBitrate = (file.size * 8) / duration;
                if (videoTrack && !videoBitrate) {
                    const ratio = audioTrack ? 0.9 : 1.0;
                    videoBitrate = globalBitrate * ratio;
                }
                if (audioTrack && !audioBitrate) {
                    audioBitrate = videoBitrate ? (globalBitrate - videoBitrate) : (globalBitrate * 0.1);
                }
            }

            // FPS検出の改善
            if (videoTrack) {
                console.log("[Worker] Video Track:", videoTrack);
                if (!videoTrack.frameRate) {
                    console.log("[Worker] frameRate missing, trying to compute...");
                    // 利用可能な場合、統計からFPSを計算してみる
                    if (videoTrack.computePacketStats) {
                        try {
                            const stats = await videoTrack.computePacketStats();
                            console.log("[Worker] Packet stats:", stats);

                            if (stats.averagePacketRate) {
                                videoTrack.frameRate = stats.averagePacketRate;
                                console.log("[Worker] Using averagePacketRate for FPS:", videoTrack.frameRate);
                            } else if ((stats.sampleCount || stats.packetCount) && duration > 0) {
                                videoTrack.frameRate = (stats.sampleCount || stats.packetCount) / duration;
                                console.log("[Worker] Computed FPS from count:", videoTrack.frameRate);
                            }
                        } catch (e) {
                            console.warn("[Worker] Failed to compute stats for FPS:", e);
                        }
                    } else {
                        console.log("[Worker] computePacketStats not available");
                    }
                } else {
                    console.log("[Worker] frameRate found:", videoTrack.frameRate);
                }
            }

            let container = file.type;
            if (!container && file.name) {
                const ext = file.name.split('.').pop().toLowerCase();
                if (ext === 'mkv') container = 'video/x-matroska';
                else if (ext === 'mov') container = 'video/quicktime';
                else if (ext === 'mp4') container = 'video/mp4';
                else if (ext === 'webm') container = 'video/webm';
            }

            const result = {
                container: container || 'Unknown',
                duration: duration,
                fileSize: file.size,
                video: videoTrack ? {
                    codec: videoTrack.codec,
                    width: videoTrack.displayWidth || videoTrack.width,
                    height: videoTrack.displayHeight || videoTrack.height,
                    bitrate: Math.round(videoBitrate),
                    fps: videoTrack.frameRate || 0,
                    framerate: videoTrack.frameRate || 0 // UI互換性のために追加
                } : null,
                audio: audioTrack ? {
                    codec: audioTrack.codec,
                    bitrate: Math.round(audioBitrate),
                    channels: audioTrack.numberOfChannels || audioTrack.channels,
                    sampleRate: audioTrack.sampleRate
                } : null
            };
            self.postMessage({ type: 'analysis_result', data: result });
        } catch (e) {
            self.postMessage({ type: 'error', error: "File Parse Error: " + e.message });
        }
    }

    // コーデックの互換性チェック
    function isCodecCompatible(inputCodec, targetSetting) {
        if (!inputCodec) return false;
        const lowerInput = inputCodec.toLowerCase();

        if (targetSetting === 'h264') return lowerInput.includes('avc') || lowerInput.includes('h264');
        if (targetSetting === 'h265') return lowerInput.includes('hvc') || lowerInput.includes('hev');
        if (targetSetting === 'av1') return lowerInput.includes('av01') || lowerInput.includes('av1');
        if (targetSetting === 'aac') return lowerInput.includes('mp4a') || lowerInput.includes('aac');
        if (targetSetting === 'opus') return lowerInput.includes('opus');
        return false;
    }

    // トランスコード実行関数
    // パフォーマンス最適化:
    // - MediaBunnyは内部でWebCodecsを使用し、ハードウェアアクセラレーションを自動的に利用
    // - パススルーモード（再エンコードなし）が最速
    // - コーデック選択: H.264 > VP9 > H.265 > AV1 (速度順)
    async function startTranscode(params) {
        console.log("[Worker] startTranscode called with:", params);
        const { file, settings } = params;

        try {
            // MediaBunny Inputの作成
            const source = new MediaBunny.BlobSource(file);
            const input = new MediaBunny.Input({
                source: source,
                formats: [
                    new MediaBunny.Mp4InputFormat(),
                    new MediaBunny.WebMInputFormat(),
                    new MediaBunny.QuickTimeInputFormat(),
                    new MediaBunny.MatroskaInputFormat()
                ]
            });

            console.log("[Worker] startTranscode: Calling getTracks");
            const tracks = await input.getTracks();
            console.log("[Worker] startTranscode: Tracks received", tracks);

            const videoTrack = tracks.find(t => t.type === 'video');
            const audioTrack = tracks.find(t => t.type === 'audio');

            // 出力オプションの設定 (format と target のみ)
            // 音声のみの場合は適切なオーディオフォーマットを選択
            let outputFormat;
            let outputMimeType;
            let outputExtension;

            if (settings.audioOnly) {
                // 音声のみの場合、コーデックに応じたフォーマットを選択
                if (settings.audioCodec === 'opus') {
                    // Opus用のWebMコンテナ（.opus として扱える）
                    outputFormat = new MediaBunny.WebMOutputFormat();
                    outputMimeType = 'audio/webm; codecs=opus';
                    outputExtension = 'opus';
                } else {
                    // AAC用のMP4コンテナ (.m4a)
                    outputFormat = new MediaBunny.Mp4OutputFormat();
                    outputMimeType = 'audio/mp4';
                    outputExtension = 'm4a';
                }
            } else {
                // 映像を含む場合は従来通り
                if (settings.format === 'mp4') {
                    outputFormat = new MediaBunny.Mp4OutputFormat();
                    outputMimeType = 'video/mp4';
                    outputExtension = 'mp4';
                } else if (settings.format === 'webm') {
                    outputFormat = new MediaBunny.WebMOutputFormat();
                    outputMimeType = 'video/webm';
                    outputExtension = 'webm';
                } else if (settings.format === 'mkv') {
                    outputFormat = new MediaBunny.MkvOutputFormat();
                    outputMimeType = 'video/x-matroska';
                    outputExtension = 'mkv';
                } else {
                    outputFormat = new MediaBunny.Mp4OutputFormat();
                    outputMimeType = 'video/mp4';
                    outputExtension = 'mp4';
                }
            }

            const target = new MediaBunny.BufferTarget();
            const output = new MediaBunny.Output({
                format: outputFormat,
                target: target
            });

            // 変換オプションを準備 (Conversion.init に渡す)
            const conversionOptions = {
                input: input,
                output: output
            };

            // --- 動画設定 ---
            // MediaBunnyはvideoオプションを指定しない場合、自動的にストリームをコピー（パススルー）します
            // audioOnlyモードの場合はvideoオプションを設定せず、かつvideoトラックを無視する必要があるが、
            // MediaBunnyの仕様上、Inputにvideoトラックがあるとデフォルトでパススルーしようとする可能性がある。
            // しかし、Conversion.initのoptionsにvideoプロパティを含めなければパススルーになる。
            // 音声のみにするには、videoトラックをInputから除外するか、Outputで映像を含めないようにする必要がある。
            // MediaBunny 1.25.1 では、options.video = null または undefined だとパススルー。
            // 明示的に映像を無効化する方法が必要。

            // 解決策: audioOnlyの場合は videoTrack 変数を無視し、conversionOptions.video を設定しない。
            // さらに、MediaBunnyが勝手にパススルーしないように、Inputのトラック選択を制御できればベストだが、
            // ここでは簡易的に、audioOnlyなら video設定をスキップするだけでなく、
            // そもそも映像を出力しないようにしたい。
            // MediaBunnyの仕様を確認すると、options.video を省略するとパススルー。
            // 映像を消すには... 実はMediaBunnyで「映像なし」を作るのは難しいかもしれない。
            // しかし、Inputのtracksをフィルタリングして渡すことができれば...
            // Inputコンストラクタでtracksを指定することはできない。getTracks()で取得するだけ。

            // 代替案: audioOnlyの場合は、OutputFormatを音声専用にするか、
            // あるいは、MP4/WebMコンテナは映像なしでも作成可能。
            // 問題はMediaBunnyが「入力に映像があるなら出力にも映像を入れる（パススルー）」という挙動をデフォルトですること。

            // 試行: conversionOptions.tracks を指定して、audioトラックのみを対象にする機能があるか？
            // ドキュメントにはない。

            // 強引な方法: audioOnlyの場合、videoTrackをnullとして扱う。
            // そして、MediaBunnyが「設定がないからパススルー」と判断しないようにする... 
            // いや、設定がない = パススルー です。

            // 確実な方法: 
            // settings.audioOnly が true の場合でも、MediaBunnyの現在のAPIでは
            // 「特定のトラックだけを変換/パススルーする」という制御が難しい可能性があります。
            // しかし、conversionOptions.video = 'disabled' のような指定ができるか？ 不明。

            // 今回は「音声だけ抜き出す」なので、
            // もしMediaBunnyで制御できないなら、生成されたファイルから映像を削除するのは難しい。
            // しかし、WebCodecsを直接使うプランは却下されたので、MediaBunnyでなんとかするしかない。

            // MediaBunnyのソースコード（推測）:
            // if (input.hasVideo && !options.video) -> passthrough

            // ワークアラウンド:
            // audioOnlyの場合、videoの設定をあえて「無効」にするAPIがないか探る。
            // なさそうなら、ユーザーには「映像も含まれるが無視してください」とは言えない。

            // 待てよ、Inputを作成する際に、sourceから特定のトラックだけを読み込ませることはできないか？
            // できない。

            // ★重要★
            // MediaBunnyの `Conversion` は `tracks` オプションを受け取る可能性があります。
            // conversionOptions.tracks = [audioTrack]; のように。

            let targetTracks = tracks;
            if (settings.audioOnly) {
                console.log("[Worker] Audio Only mode enabled. Filtering tracks.");
                targetTracks = tracks.filter(t => t.type === 'audio');
                // videoTrack変数はnull扱い
            }

            // Conversion.init には tracks オプションはないが、
            // 内部で input.getTracks() を呼んでいるはず。
            // しかし input インスタンスはすでに作成済み。

            // ここで input.getTracks = async () => targetTracks; と上書きしてしまえば騙せるかも？
            if (settings.audioOnly) {
                input.getTracks = async () => targetTracks;
            }

            if (videoTrack && !settings.audioOnly) { // audioOnlyなら映像処理スキップ
                if (settings.videoBitrate === -1 && isCodecCompatible(videoTrack.codec, settings.videoCodec)) {
                    // パススルーモード: videoオプションを指定しない
                    // ★最速★ デコード・エンコードを行わず、ストリームをそのままコピー
                    console.log("[Worker] Video: Passthrough mode enabled (stream copy)");
                    // conversionOptions.video を設定しない = パススルー
                } else {
                    // トランスコードモード
                    // パフォーマンスノート:
                    // - H.264 (avc): 最速、最も広くハードウェアサポート、リアルタイム処理可能
                    // - H.265 (hevc): 圧縮効率25-30%向上だが、エンコード負荷高い
                    // - AV1: 最高圧縮率だが、エンコード速度最も遅い（3-5倍遅い）
                    // - MediaBunnyは内部でWebCodecsのハードウェアアクセラレーションを自動利用
                    const targetBitrate = settings.videoBitrate === -1 ? (settings.originalVideoBitrate || 2000000) : settings.videoBitrate;
                    // MediaBunnyは短いコーデック名を要求: 'avc', 'hevc', 'av1', 'vp9', 'vp8'
                    let encoderCodec = settings.videoCodec === 'h265' ? 'hevc' :
                        (settings.videoCodec === 'av1' ? 'av1' : 'avc');

                    console.log("[Worker] Video: Transcoding mode enabled", { codec: encoderCodec, bitrate: targetBitrate });

                    // 明示的な設定のためにソースビデオのプロパティを抽出
                    let width = videoTrack.displayWidth || videoTrack.width;
                    let height = videoTrack.displayHeight || videoTrack.height;
                    let framerate = videoTrack.frameRate || 30;

                    // --- 解像度ロジック ---
                    if (settings.resolution && settings.resolution !== 'keep') {
                        const resolutions = {
                            '4k': 3840,
                            'fhd': 1920,
                            'hd': 1280,
                            'sd': 854
                        };
                        const targetLongSide = resolutions[settings.resolution];
                        if (targetLongSide) {
                            const currentLongSide = Math.max(width, height);
                            // ターゲットが現在より小さい場合のみ縮小
                            if (targetLongSide < currentLongSide) {
                                const ratio = targetLongSide / currentLongSide;
                                width = Math.round(width * ratio);
                                height = Math.round(height * ratio);
                                // 32の倍数を確保（UIテキストに従う）
                                width = Math.ceil(width / 32) * 32;
                                height = Math.ceil(height / 32) * 32;
                            }
                        }
                    }

                    // --- FPSロジック ---
                    if (settings.fps && settings.fps !== 'keep') {
                        const targetFPS = parseFloat(settings.fps);
                        if (!isNaN(targetFPS)) {
                            // スマートFPSマッチング: ターゲットがソースに近い場合（1.0以内）、ソースを維持
                            // これにより 29.97->30, 59.94->60, 23.976->24, そして 14.47->15 を処理
                            if (Math.abs(targetFPS - framerate) < 1.0) {
                                // 元のフレームレートを維持
                                console.log(`[Worker] FPS close match: keeping source ${framerate} for target ${targetFPS}`);
                            } else {
                                framerate = targetFPS;
                            }
                        }
                    }

                    conversionOptions.video = {
                        codec: encoderCodec,
                        bitrate: targetBitrate,
                        width: width,
                        height: height,
                        framerate: framerate,
                        bitrateMode: 'constant', // 固定ビットレートを強制
                        fit: 'fill' // width/heightが指定されている場合に必須
                    };
                    console.log("[Worker] Video configuration:", conversionOptions.video);
                }
            }

            // --- 音声設定 ---
            // MediaBunnyはaudioオプションを指定しない場合、自動的にストリームをコピー（パススルー）します
            if (audioTrack && settings.audioCodec) {
                if (settings.audioBitrate === -1 && isCodecCompatible(audioTrack.codec, settings.audioCodec)) {
                    // パススルーモード: audioオプションを指定しない
                    // ★最速★ 音声ストリームをそのままコピー
                    console.log("[Worker] Audio: Passthrough mode enabled (stream copy)");
                    // conversionOptions.audio を設定しない = パススルー
                } else {
                    // トランスコードモード
                    // パフォーマンスノート:
                    // - Opus: 一般的にAACより高速、WebM推奨
                    // - AAC (mp4a.40.2): MP4標準、広くハードウェアサポート
                    const targetBitrate = settings.audioBitrate === -1 ? (settings.originalAudioBitrate || 128000) : settings.audioBitrate;
                    let codec = settings.audioCodec === 'opus' ? 'opus' : 'aac';

                    console.log("[Worker] Audio: Transcoding mode enabled", { codec: codec, bitrate: targetBitrate });
                    conversionOptions.audio = {
                        codec: codec,
                        sampleRate: 48000,
                        numberOfChannels: 2,
                        bitrate: targetBitrate
                    };
                }
            }

            // 変換実行
            console.log("[Worker] startTranscode: Initializing Conversion with options:", conversionOptions);
            currentConversion = await MediaBunny.Conversion.init(conversionOptions);

            // 進捗コールバック (Conversion に設定)
            currentConversion.onProgress = (progress) => {
                console.log("[Worker] Progress:", Math.round(progress * 100) + "%");
                self.postMessage({ type: 'progress', value: Math.round(progress * 100) });
            };

            console.log("[Worker] startTranscode: Starting execution");
            await currentConversion.execute();
            console.log("[Worker] startTranscode: Execution complete");

            // BufferTargetからBlobを作成
            // ゼロコピー転送: Blobは参照渡しで、postMessage時にTransferableではないが、
            // 内部的にはStructured Clone Algorithmで効率的に転送される
            console.log("[Worker] startTranscode: Creating blob from buffer, size:", target.buffer.byteLength);
            const blob = new Blob([target.buffer], { type: outputMimeType });
            console.log("[Worker] startTranscode: Blob created, size:", blob.size, "type:", outputMimeType);

            console.log("[Worker] startTranscode: Posting completion message to main thread");
            self.postMessage({
                type: 'complete',
                blob: blob,
                outputExtension: outputExtension
            });
            console.log("[Worker] startTranscode: Completion message posted");

            // メモリ管理: MediaBunnyは内部でVideoFrameやその他リソースを自動管理
            // conversionインスタンスへの参照を解放することで、ガベージコレクションを促進
            currentConversion = null; // クリーンアップ

        } catch (e) {
            currentConversion = null; // エラー時もクリーンアップ
            console.error("Transcode Error:", e);
            self.postMessage({ type: 'error', error: "Transcode Error: " + e.message });
        }
    }

    // トランスコードをキャンセルする関数
    async function cancelTranscode() {
        try {
            if (currentConversion) {
                console.log("[Worker] Cancelling conversion...");
                await currentConversion.cancel();
                console.log("[Worker] Conversion cancelled successfully");
                currentConversion = null;
                self.postMessage({ type: 'cancelled' });
            } else {
                console.warn("[Worker] No active conversion to cancel");
            }
        } catch (e) {
            console.error("[Worker] Cancel error:", e);
            self.postMessage({ type: 'error', error: "Cancel Error: " + e.message });
        }
    }
}
