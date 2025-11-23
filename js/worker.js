function workerBody() {
    try {
        importScripts('https://cdn.jsdelivr.net/npm/mp4box@0.5.2/dist/mp4box.all.min.js');
        importScripts('https://cdn.jsdelivr.net/npm/mp4-muxer@1.0.3/build/mp4-muxer.min.js');
        importScripts('https://cdn.jsdelivr.net/npm/webm-muxer@1.0.0/build/webm-muxer.min.js');
    } catch (e) {
        self.postMessage({ type: 'error', error: 'ライブラリの読み込みに失敗しました。: ' + e.message });
    }

    let mp4boxfile = null;

    self.onmessage = async (e) => {
        const { type, data } = e.data;
        try {
            if (type === 'inspect') {
                await inspectFile(data.file);
            } else if (type === 'start') {
                await startTranscode(data);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            self.postMessage({ type: 'error', error: errorMessage });
        }
    };

    // ファイル情報を解析する関数
    async function inspectFile(file) {
        if (mp4boxfile) {
            mp4boxfile.flush();
            mp4boxfile = null;
        }

        const arrayBuffer = await file.arrayBuffer();
        arrayBuffer.fileStart = 0;
        mp4boxfile = MP4Box.createFile();

        return new Promise((resolve, reject) => {
            mp4boxfile.onError = (e) => {
                const errorMessage = "MP4Box Parse Error: " + (e instanceof Error ? e.message : String(e));
                self.postMessage({ type: 'error', error: errorMessage });
                reject(new Error(errorMessage));
            };

            mp4boxfile.onReady = (info) => {
                const videoTrack = info.videoTracks[0];
                const audioTrack = info.audioTracks[0];

                const result = {
                    container: file.type || 'Unknown',
                    duration: info.duration / info.timescale,
                    fileSize: file.size,
                    video: videoTrack ? {
                        codec: videoTrack.codec,
                        width: videoTrack.video.width,
                        height: videoTrack.video.height,
                        bitrate: videoTrack.bitrate || 0,
                        fps: videoTrack.nb_samples / (info.duration / info.timescale)
                    } : null,
                    audio: audioTrack ? {
                        codec: audioTrack.codec,
                        bitrate: audioTrack.bitrate || 0,
                        channels: audioTrack.audio.channel_count,
                        sampleRate: audioTrack.audio.sample_rate
                    } : null
                };
                self.postMessage({ type: 'analysis_result', data: result });
                resolve();
            };

            mp4boxfile.appendBuffer(arrayBuffer);
            mp4boxfile.flush();
        });
    }

    // コーデックの互換性チェック（パススルー判定用）
    function isCodecCompatible(inputCodec, targetSetting) {
        if (!inputCodec) return false;
        const lowerInput = inputCodec.toLowerCase();

        // H.264
        if (targetSetting === 'h264') {
            return lowerInput.startsWith('avc1') || lowerInput.startsWith('h264');
        }
        // H.265 (HEVC)
        if (targetSetting === 'h265') {
            return lowerInput.startsWith('hvc1') || lowerInput.startsWith('hev1');
        }
        // AV1
        if (targetSetting === 'av1') {
            return lowerInput.startsWith('av01');
        }
        // AAC
        if (targetSetting === 'aac') {
            return lowerInput.startsWith('mp4a') || lowerInput === 'aac';
        }
        // Opus
        if (targetSetting === 'opus') {
            return lowerInput.startsWith('opus');
        }
        return false;
    }

    // トランスコード実行関数
    async function startTranscode(params) {
        console.log("[Worker] startTranscode called with:", params);
        const { file, settings } = params;

        const arrayBuffer = await file.arrayBuffer();
        arrayBuffer.fileStart = 0;
        const demuxerFile = MP4Box.createFile();

        // 処理用変数の初期化
        let muxer = null;

        // ビデオ処理用
        let videoEncoder = null;
        let videoDecoder = null;
        let videoPassthrough = false;

        // オーディオ処理用
        let audioEncoder = null;
        let audioDecoder = null;
        let audioPassthrough = false;

        let processedVideoFrames = 0;
        let totalVideoFrames = 0;

        // 準備ができたら設定を行う
        demuxerFile.onReady = async (info) => {
            console.log("[Worker] Demuxer ready. Info:", info);
            const videoTrack = info.videoTracks[0];
            const audioTrack = info.audioTracks[0];

            // パススルー判定
            if (videoTrack) {
                totalVideoFrames = videoTrack.nb_samples;
                // ビットレートが維持(-1) かつ コーデックが互換性ありの場合、パススルー
                if (settings.videoBitrate === -1 && isCodecCompatible(videoTrack.codec, settings.videoCodec)) {
                    videoPassthrough = true;
                    console.log("Video: Passthrough mode enabled");
                }
            }

            if (audioTrack) {
                // ビットレートが維持(-1) かつ コーデックが互換性ありの場合、パススルー
                if (settings.audioBitrate === -1 && isCodecCompatible(audioTrack.codec, settings.audioCodec)) {
                    audioPassthrough = true;
                    console.log("Audio: Passthrough mode enabled");
                } else {
                    console.log("Audio: Transcode mode. Bitrate:", settings.audioBitrate, "Codec:", settings.audioCodec, "Input:", audioTrack.codec);
                }
            }

            // --- Muxer Setup ---
            // パススルーの場合は元のコーデック文字列を使用、そうでなければターゲット設定を使用

            // ビデオのMuxer設定
            let muxerVideoConfig = undefined;
            if (videoTrack) {
                if (videoPassthrough) {
                    muxerVideoConfig = {
                        codec: videoTrack.codec,
                        width: videoTrack.video.width,
                        height: videoTrack.video.height
                    };
                } else {
                    // 再エンコード時のターゲット設定
                    let codecString = settings.videoCodec === 'av1' ? (settings.format === 'mp4' ? 'av01' : 'V_AV1')
                        : (settings.format === 'mp4' ? 'avc' : 'V_MPEG4/ISO/AVC');
                    // ※ 実際にはEncoderからの出力時に確定するが、初期化用ダミーとして
                    muxerVideoConfig = {
                        codec: codecString,
                        width: videoTrack.video.width,
                        height: videoTrack.video.height
                    };
                }
            }

            // オーディオのMuxer設定
            let muxerAudioConfig = undefined;
            if (audioTrack && settings.audioCodec) { // オーディオ出力が有効な場合
                if (audioPassthrough) {
                    muxerAudioConfig = {
                        codec: audioTrack.codec,
                        sampleRate: audioTrack.audio.sample_rate,
                        numberOfChannels: audioTrack.audio.channel_count
                    };
                } else {
                    let codecString = settings.audioCodec === 'opus' ? (settings.format === 'mp4' ? 'opus' : 'A_OPUS')
                        : (settings.format === 'mp4' ? 'mp4a.40.2' : 'A_AAC');
                    muxerAudioConfig = {
                        codec: codecString,
                        sampleRate: 48000, // 再エンコード時のデフォルト
                        numberOfChannels: 2
                    };
                    console.log("[Worker] Audio Muxer Config:", muxerAudioConfig);
                }
            }

            const muxerOptions = {
                target: settings.format === 'mp4' ? new Mp4Muxer.ArrayBufferTarget() : new WebMMuxer.ArrayBufferTarget(),
                video: muxerVideoConfig,
                audio: muxerAudioConfig,
                fastStart: 'in-memory'
            };

            const createMuxer = (options) => {
                if (settings.format === 'mp4') {
                    return new Mp4Muxer.Muxer(options);
                } else {
                    return new WebMMuxer.Muxer(options);
                }
            };

            try {
                muxer = createMuxer(muxerOptions);
            } catch (e) {
                console.warn("[Worker] Muxer creation failed:", e);
                // フォールバック: コーデックが原因の場合、安全なコーデックで再試行
                if (muxerVideoConfig && muxerVideoConfig.codec.startsWith('avc1')) {
                    // Constrained Baseline Profile Level 3.0 (最も互換性が高い)
                    const fallbackCodec = 'avc1';
                    console.log(`[Worker] Retrying Muxer with fallback codec: ${fallbackCodec}`);
                    muxerVideoConfig.codec = fallbackCodec;
                    muxerOptions.video = muxerVideoConfig;
                    try {
                        muxer = createMuxer(muxerOptions);
                    } catch (retryError) {
                        console.error("[Worker] Muxer retry failed:", retryError);
                        throw retryError;
                    }
                } else {
                    throw e;
                }
            }

            // --- Video Pipeline Setup ---
            if (videoTrack) {
                demuxerFile.setExtractionOptions(videoTrack.id);

                if (!videoPassthrough) {
                    // トランスコードモード: Decoder -> Encoder のセットアップ
                    const initVideoEncoder = (width, height) => {
                        const targetBitrate = settings.videoBitrate === -1 ? (settings.originalVideoBitrate || 2000000) : settings.videoBitrate;
                        let encoderCodec = settings.videoCodec === 'h265' ? 'hvc1.1.6.L93.B0' :
                            (settings.videoCodec === 'av1' ? 'av01.0.04M.08' : 'avc1.42001f');

                        const config = {
                            codec: encoderCodec,
                            width: width,
                            height: height,
                            bitrate: targetBitrate,
                            framerate: 30
                        };

                        videoEncoder = new VideoEncoder({
                            output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
                            error: (e) => console.error("Video Encode Error", e)
                        });
                        console.log("[Worker] Configuring Video Encoder:", config);
                        videoEncoder.configure(config);
                    };

                    videoDecoder = new VideoDecoder({
                        output: (frame) => {
                            if (!videoEncoder) {
                                const w = frame.displayWidth % 2 === 0 ? frame.displayWidth : frame.displayWidth - 1;
                                const h = frame.displayHeight % 2 === 0 ? frame.displayHeight : frame.displayHeight - 1;
                                initVideoEncoder(w, h);
                            }
                            if (videoEncoder && videoEncoder.state === "configured") {
                                videoEncoder.encode(frame);
                                processedVideoFrames++;
                                if (totalVideoFrames > 0) {
                                    self.postMessage({
                                        type: 'progress',
                                        value: Math.min(100, Math.round((processedVideoFrames / totalVideoFrames) * 100))
                                    });
                                }
                                frame.close();
                            } else {
                                frame.close();
                            }
                        },
                        error: (e) => self.postMessage({ type: 'error', error: "Video Decode Error: " + e.message })
                    });

                    let config = {
                        codec: videoTrack.codec,
                        codedWidth: videoTrack.video.width,
                        codedHeight: videoTrack.video.height,
                        description: _getDescription(demuxerFile.getTrackById(videoTrack.id))
                    };

                    // サポートチェックとフォールバック
                    try {
                        const support = await VideoDecoder.isConfigSupported(config);
                        if (!support.supported) {
                            console.warn(`[Worker] Original codec ${config.codec} not supported. Trying fallback.`);
                            if (config.codec.startsWith('avc1')) {
                                // Baseline Profile Level 3.1 (広くサポートされている)
                                config.codec = 'avc1.42001f';
                            } else if (config.codec.startsWith('hvc1') || config.codec.startsWith('hev1')) {
                                // Main Profile
                                config.codec = 'hvc1.1.6.L93.B0';
                            }

                            const fallbackSupport = await VideoDecoder.isConfigSupported(config);
                            if (fallbackSupport.supported) {
                                console.log("[Worker] Fallback codec supported:", config.codec);
                            } else {
                                console.error("[Worker] Fallback codec also not supported:", config.codec);
                            }
                        }
                    } catch (e) {
                        console.error("[Worker] isConfigSupported check failed:", e);
                    }

                    console.log("[Worker] Configuring Video Decoder:", config);
                    videoDecoder.configure(config);
                }
            }

            // --- Audio Pipeline Setup ---
            if (audioTrack) {
                demuxerFile.setExtractionOptions(audioTrack.id);

                if (!audioPassthrough) {
                    // トランスコードモード
                    const initAudioEncoder = (sampleRate, numberOfChannels) => {
                        const targetBitrate = settings.audioBitrate === -1 ? (settings.originalAudioBitrate || 128000) : settings.audioBitrate;
                        let codec = 'mp4a.40.2';
                        if (settings.audioCodec === 'opus') codec = 'opus';

                        audioEncoder = new AudioEncoder({
                            output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
                            error: (e) => console.error("Audio Encode Error", e)
                        });

                        const config = {
                            codec: codec,
                            sampleRate: sampleRate,
                            numberOfChannels: numberOfChannels,
                            bitrate: targetBitrate
                        };
                        console.log("[Worker] Configuring Audio Encoder:", config);

                        AudioEncoder.isConfigSupported(config).then((support) => {
                            if (support.supported) audioEncoder.configure(config);
                            else self.postMessage({ type: 'error', error: `音声エンコード設定がサポートされていません: ${codec}` });
                        }).catch(e => console.error("Audio check failed", e));
                    };

                    audioDecoder = new AudioDecoder({
                        output: (data) => {
                            if (!audioEncoder) {
                                initAudioEncoder(data.sampleRate, data.numberOfChannels);
                            }
                            if (audioEncoder && audioEncoder.state === "configured") {
                                audioEncoder.encode(data);
                                data.close();
                            } else {
                                data.close();
                            }
                        },
                        error: (e) => console.error("Audio Decode Error", e)
                    });

                    // Audio Decoder Config
                    const audioCodec = audioTrack.codec;
                    let description = _getDescription(demuxerFile.getTrackById(audioTrack.id));
                    if (!description && (audioCodec.startsWith('mp4a') || audioCodec === 'aac')) {
                        description = generateAACDescription(audioTrack.audio.sample_rate, audioTrack.audio.channel_count);
                    }
                    let decoderCodec = audioCodec;
                    if (audioCodec.startsWith('mp4a') && (audioCodec === 'mp4a' || audioCodec.split('.').length < 3)) {
                        decoderCodec = 'mp4a.40.2';
                    }

                    const config = {
                        codec: decoderCodec,
                        sampleRate: audioTrack.audio.sample_rate,
                        numberOfChannels: audioTrack.audio.channel_count,
                        ...(description && { description: description })
                    };
                    try {
                        console.log("[Worker] Configuring Audio Decoder:", config);
                        audioDecoder.configure(config);
                    } catch (e) {
                        console.error("Audio Decoder Config Error", e);
                    }
                }
            }

            demuxerFile.start();
        };

        demuxerFile.onSamples = (id, user, samples) => {
            const videoTrackId = demuxerFile.videoTracks[0]?.id;
            const audioTrackId = demuxerFile.audioTracks[0]?.id;

            for (const sample of samples) {
                // タイムスタンプ変換: MP4 timescale -> マイクロ秒 (1/1,000,000秒)
                // WebCodecs EncodedChunk はマイクロ秒を要求する
                const timestampUs = (sample.cts * 1000000) / sample.timescale;
                const durationUs = (sample.duration * 1000000) / sample.timescale;

                // チャンク種別
                const type = sample.is_sync ? "key" : "delta";

                const chunkInit = {
                    type: type,
                    timestamp: timestampUs,
                    duration: durationUs,
                    data: sample.data
                };

                if (id === videoTrackId) {
                    if (videoPassthrough) {
                        // パススルー: 直接Muxerへ (EncodedVideoChunkとしてラップ)
                        // EncodedVideoChunkコンストラクタに渡してMuxerへ
                        const chunk = new EncodedVideoChunk(chunkInit);

                        // 最初のチャンク、またはキーフレーム時にメタデータを渡す必要がある場合がある
                        // mp4-muxer/webm-muxerは通常addVideoChunkの第2引数でmetaを受け取る
                        // パススルーの場合、Demuxerから取得したdescriptionを渡す
                        let meta = undefined;
                        if (type === 'key') {
                            meta = {
                                decoderConfig: {
                                    codec: demuxerFile.videoTracks[0].codec,
                                    description: _getDescription(demuxerFile.getTrackById(videoTrackId))
                                }
                            };
                        }
                        muxer.addVideoChunk(chunk, meta);

                        processedVideoFrames++;
                        if (totalVideoFrames > 0) {
                            self.postMessage({
                                type: 'progress',
                                value: Math.min(100, Math.round((processedVideoFrames / totalVideoFrames) * 100))
                            });
                        }
                    } else {
                        // トランスコード
                        if (videoDecoder && videoDecoder.state === 'configured') {
                            try { videoDecoder.decode(new EncodedVideoChunk(chunkInit)); } catch (e) { }
                        }
                    }
                } else if (id === audioTrackId) {
                    if (audioPassthrough) {
                        // パススルー: 直接Muxerへ
                        const chunk = new EncodedAudioChunk(chunkInit);
                        let meta = undefined;
                        if (type === 'key' || processedVideoFrames === 0) { // 音声は最初のフレームなどでメタデータを
                            meta = {
                                decoderConfig: {
                                    codec: demuxerFile.audioTracks[0].codec,
                                    description: _getDescription(demuxerFile.getTrackById(audioTrackId))
                                }
                            };
                        }
                        muxer.addAudioChunk(chunk, meta);
                    } else {
                        // トランスコード
                        if (audioDecoder && audioDecoder.state === 'configured') {
                            try { audioDecoder.decode(new EncodedAudioChunk(chunkInit)); } catch (e) { }
                        }
                    }
                }
            }
        };

        // --- Flush & Finalize ---
        // 注意: MP4Boxはブロック単位でappendBufferされるとonSamplesを呼ぶ。
        // 完全に読み終わったタイミングでflush処理が必要。
        // 今回の実装では一括でappendBufferしているため、ここに来る時点ですべてのサンプル処理が
        // キューに入っている（同期的なループ内）。
        // ただし、WebCodecsのdecode/encodeは非同期。

        // パススルーの場合は同期的に addChunk しているので待ち時間は不要だが、
        // トランスコードの場合は flush() を待つ必要がある。

        demuxerFile.appendBuffer(arrayBuffer);
        demuxerFile.flush();

        // トランスコード処理がある場合のみFlush待ち
        if (!videoPassthrough && videoDecoder && videoDecoder.state === 'configured') await videoDecoder.flush();
        if (!videoPassthrough && videoEncoder && videoEncoder.state === 'configured') await videoEncoder.flush();

        if (demuxerFile.audioTracks[0]) {
            if (!audioPassthrough && audioDecoder && audioDecoder.state === 'configured') await audioDecoder.flush();
            if (!audioPassthrough && audioEncoder && audioEncoder.state === 'configured') await audioEncoder.flush();
        }

        muxer.finalize();

        const { buffer } = muxer.target;
        self.postMessage({
            type: 'complete',
            blob: new Blob([buffer], { type: settings.format === 'mp4' ? 'video/mp4' : 'video/webm' })
        });
    }

    function _getDescription(track) {
        const box = track.mdia.minf.stbl.stsd.entries[0];
        if (box.avcC) return box.avcC.toBuffer();
        if (box.hvcC) return box.hvcC.toBuffer();
        if (box.av1C) return box.av1C.toBuffer();
        if (box.esds && box.esds.esd && box.esds.esd.decoderConfigDescriptor && box.esds.esd.decoderConfigDescriptor.decoderSpecificInfo) {
            const data = box.esds.esd.decoderConfigDescriptor.decoderSpecificInfo.data;
            if (data && data.length > 0) return data.slice(0).buffer;
        }
        return null;
    }

    function generateAACDescription(sampleRate, channels) {
        const sampleRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
        let sfi = sampleRates.indexOf(sampleRate);
        if (sfi === -1) sfi = 4;
        const aot = 2;
        const firstByte = (aot << 3) | (sfi >> 1);
        const secondByte = ((sfi & 1) << 7) | (channels << 3);
        return new Uint8Array([firstByte, secondByte]).buffer;
    }
}
