function workerBody() {
    let MediaBunny = null;
    let libraryLoadPromise = null;
    let currentConversion = null; // 現在実行中のConversionインスタンス

    async function loadLibrary() {
        if (MediaBunny) return;
        try {
            // User provided URL: https://cdn.jsdelivr.net/npm/mediabunny/dist/modules/src/index.min.js
            // Using dynamic import for ESM compatibility in classic worker
            const module = await import('https://cdn.jsdelivr.net/npm/mediabunny@1.25.1/+esm');
            MediaBunny = module.default || module;
            console.log("[Worker] MediaBunny loaded. Keys:", Object.keys(MediaBunny));
        } catch (e) {
            console.error("[Worker] Library load failed:", e);
            self.postMessage({ type: 'error', error: 'ライブラリの読み込みに失敗しました。: ' + e.message });
            throw e;
        }
    }

    // Start loading immediately
    libraryLoadPromise = loadLibrary();

    self.onmessage = async (e) => {
        const { type, data } = e.data;

        // Ensure library is loaded
        if (!MediaBunny) {
            try {
                await libraryLoadPromise;
            } catch (e) {
                return; // Error already reported
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
                    new MediaBunny.QuickTimeInputFormat()
                ]
            });
            console.log("[Worker] inspectFile: Calling getTracks and computeDuration");
            const tracks = await input.getTracks();
            const duration = await input.computeDuration();
            console.log("[Worker] inspectFile: Tracks received", tracks);

            const videoTrack = tracks.find(t => t.type === 'video');
            const audioTrack = tracks.find(t => t.type === 'audio');

            // Bitrate estimation
            let videoBitrate = 0;
            let audioBitrate = 0;

            // Helper to get bitrate from track stats
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

            // Fallback to file size based estimation if specific bitrates are missing
            if ((!videoBitrate && videoTrack) || (!audioBitrate && audioTrack)) {
                const globalBitrate = (file.size * 8) / duration;
                if (videoTrack && !videoBitrate) {
                    // Assume video takes up most of the space (e.g. 90% if audio exists, 100% if not)
                    const ratio = audioTrack ? 0.9 : 1.0;
                    videoBitrate = globalBitrate * ratio;
                }
                if (audioTrack && !audioBitrate) {
                    // Assume audio takes remaining or small chunk (e.g. 128kbps or 10%)
                    // If we have video bitrate, use remainder, otherwise 10%
                    audioBitrate = videoBitrate ? (globalBitrate - videoBitrate) : (globalBitrate * 0.1);
                }
            }

            const result = {
                container: file.type || 'Unknown',
                duration: duration,
                fileSize: file.size,
                video: videoTrack ? {
                    codec: videoTrack.codec,
                    width: videoTrack.displayWidth || videoTrack.width,
                    height: videoTrack.displayHeight || videoTrack.height,
                    bitrate: Math.round(videoBitrate),
                    fps: videoTrack.frameRate || 0
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

        if (targetSetting === 'h264') return lowerInput.startsWith('avc1') || lowerInput.startsWith('h264');
        if (targetSetting === 'h265') return lowerInput.startsWith('hvc1') || lowerInput.startsWith('hev1');
        if (targetSetting === 'av1') return lowerInput.startsWith('av01');
        if (targetSetting === 'aac') return lowerInput.startsWith('mp4a') || lowerInput === 'aac';
        if (targetSetting === 'opus') return lowerInput.startsWith('opus');
        return false;
    }

    // トランスコード実行関数
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
                    new MediaBunny.QuickTimeInputFormat()
                ]
            });

            console.log("[Worker] startTranscode: Calling getTracks");
            const tracks = await input.getTracks();
            console.log("[Worker] startTranscode: Tracks received", tracks);

            const videoTrack = tracks.find(t => t.type === 'video');
            const audioTrack = tracks.find(t => t.type === 'audio');

            // 出力オプションの設定 (format と target のみ)
            let outputFormat;
            if (settings.format === 'mp4') {
                outputFormat = new MediaBunny.Mp4OutputFormat();
            } else if (settings.format === 'webm') {
                outputFormat = new MediaBunny.WebMOutputFormat();
            } else {
                outputFormat = new MediaBunny.Mp4OutputFormat();
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

            // --- Video Configuration ---
            // MediaBunnyはvideoオプションを指定しない場合、自動的にストリームをコピー（パススルー）します
            if (videoTrack) {
                if (settings.videoBitrate === -1 && isCodecCompatible(videoTrack.codec, settings.videoCodec)) {
                    // パススルーモード: videoオプションを指定しない
                    console.log("[Worker] Video: Passthrough mode enabled (stream copy)");
                    // conversionOptions.video を設定しない = パススルー
                } else {
                    // トランスコードモード
                    const targetBitrate = settings.videoBitrate === -1 ? (settings.originalVideoBitrate || 2000000) : settings.videoBitrate;
                    // MediaBunnyは短いコーデック名を要求: 'avc', 'hevc', 'av1', 'vp9', 'vp8'
                    let encoderCodec = settings.videoCodec === 'h265' ? 'hevc' :
                        (settings.videoCodec === 'av1' ? 'av1' : 'avc');

                    console.log("[Worker] Video: Transcoding mode enabled", { codec: encoderCodec, bitrate: targetBitrate });
                    conversionOptions.video = {
                        codec: encoderCodec,
                        bitrate: targetBitrate
                        // width/heightを指定しないとMediaBunnyが自動的に元の解像度を使用
                    };
                }
            }

            // --- Audio Configuration ---
            // MediaBunnyはaudioオプションを指定しない場合、自動的にストリームをコピー（パススルー）します
            if (audioTrack && settings.audioCodec) {
                if (settings.audioBitrate === -1 && isCodecCompatible(audioTrack.codec, settings.audioCodec)) {
                    // パススルーモード: audioオプションを指定しない
                    console.log("[Worker] Audio: Passthrough mode enabled (stream copy)");
                    // conversionOptions.audio を設定しない = パススルー
                } else {
                    // トランスコードモード
                    const targetBitrate = settings.audioBitrate === -1 ? (settings.originalAudioBitrate || 128000) : settings.audioBitrate;
                    let codec = settings.audioCodec === 'opus' ? 'opus' : 'mp4a.40.2';

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
            console.log("[Worker] startTranscode: Creating blob from buffer, size:", target.buffer.byteLength);
            const blob = new Blob([target.buffer], { type: settings.format === 'mp4' ? 'video/mp4' : 'video/webm' });
            console.log("[Worker] startTranscode: Blob created, size:", blob.size);

            console.log("[Worker] startTranscode: Posting completion message to main thread");
            self.postMessage({
                type: 'complete',
                blob: blob
            });
            console.log("[Worker] startTranscode: Completion message posted");
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
