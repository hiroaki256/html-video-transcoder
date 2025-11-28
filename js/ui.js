// --- メインスレッドのロジック ---

// Workerの初期化: workerBody関数を文字列化してBlob URLを作成
const blob = new Blob([`(${workerBody.toString()})()`], { type: 'application/javascript' });
const worker = new Worker(URL.createObjectURL(blob));

// UI References
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const selectBtn = document.getElementById('select-btn');
const fileNameDisplay = document.getElementById('file-name');
const fileStatusDisplay = document.getElementById('file-status');
const settingsArea = document.getElementById('settings-area');
const convertBtn = document.getElementById('convert-btn');
const cancelBtn = document.getElementById('cancel-btn');

const bitrateInput = document.getElementById('bitrate-input');
const bitrateDisplay = document.getElementById('bitrate-display');
const videoBitrateMid = document.getElementById('video-bitrate-mid');

const audioBitrateInput = document.getElementById('audio-bitrate-input');
const audioBitrateDisplay = document.getElementById('audio-bitrate-display');
const audioBitrateMid = document.getElementById('audio-bitrate-mid');


const infoLinkContainer = document.getElementById('info-link-container');
const infoLinkLabel = document.getElementById('info-link-label');
const modalInfoContent = document.getElementById('modal-info-content');
const videoInfoModalCheckbox = document.getElementById('video-info-modal');
const h265Option = document.getElementById('h265-option');
const videoBitrateMax = document.getElementById('video-bitrate-max');
const audioBitrateMax = document.getElementById('audio-bitrate-max');
const audioBitrateMin = document.getElementById('audio-bitrate-min');
const audioBitrateWarning = document.getElementById('audio-bitrate-warning');
const elapsedTimeDisplay = document.getElementById('elapsed-time');

const presetModeInputs = document.querySelectorAll('input[name="preset_mode"]');
const presetContainer = document.getElementById('preset-container');
const resolutionInputs = document.querySelectorAll('input[name="resolution"]');
const fpsInputs = document.querySelectorAll('input[name="fps"]');
const resolutionSection = document.getElementById('resolution-section');
const fpsSection = document.getElementById('fps-section');
const videoCodecContainer = document.getElementById('video-codec-container');
const videoSettingsSection = document.getElementById('video-settings-section');
const audioSettingsSection = document.querySelector('#video-settings-section + div'); // 音声設定は次の兄弟要素
const videoBitrateContainer = document.getElementById('video-bitrate-container');
const audioBitrateContainer = document.getElementById('audio-bitrate-container');
const resolutionValueDisplay = document.getElementById('resolution-value-display');
const fpsValueDisplay = document.getElementById('fps-value-display');

let selectedFile = null;
let fileInfo = null;
let conversionStartTime = null;
let elapsedTimer = null;

// --- UI Utility Functions ---

function showAlert(message) {
    const alertModal = document.createElement('div');
    alertModal.className = 'fixed inset-0 z-[99] flex items-center justify-center bg-black/70 backdrop-blur-sm transition-opacity duration-300';
    alertModal.innerHTML = `
    <div class="bg-white dark:bg-slate-700 rounded-xl p-6 shadow-2xl max-w-sm mx-4 transform transition-transform duration-300 scale-100">
        <h3 class="text-lg font-bold text-slate-800 dark:text-white mb-3">エラーが発生しました</h3>
        <p class="text-sm text-slate-600 dark:text-slate-300 mb-4 whitespace-pre-wrap break-words">${message}</p>
        <button id="close-alert-btn" class="w-full rounded-lg bg-primary py-2 text-base font-bold text-white hover:bg-primary/90">OK</button>
    </div>
`;
    document.body.appendChild(alertModal);

    document.getElementById('close-alert-btn').addEventListener('click', () => {
        alertModal.classList.add('opacity-0');
        setTimeout(() => alertModal.remove(), 300);
    });
}

function updateInfoLinkState(isEnabled) {
    if (isEnabled) {
        infoLinkLabel.classList.remove('opacity-50', 'pointer-events-none');
        infoLinkLabel.classList.add('cursor-pointer', 'border-slate-200', 'dark:border-slate-700', 'text-slate-700', 'dark:text-white');
        infoLinkLabel.classList.remove('text-slate-400', 'dark:text-slate-600');
        videoInfoModalCheckbox.disabled = false;
    } else {
        infoLinkLabel.classList.add('opacity-50', 'pointer-events-none');
        infoLinkLabel.classList.remove('cursor-pointer', 'border-slate-200', 'dark:border-slate-700', 'text-slate-700', 'dark:text-white');
        infoLinkLabel.classList.add('text-slate-400', 'dark:text-slate-600');
        videoInfoModalCheckbox.checked = false;
        videoInfoModalCheckbox.disabled = true;
    }
    infoLinkContainer.classList.toggle('border-slate-200', isEnabled);
    infoLinkContainer.classList.toggle('dark:border-slate-700', isEnabled);
}

updateInfoLinkState(false);

async function checkH265Support() {
    const config = {
        codec: "hvc1.1.6.L93.B0",
        width: 1920,
        height: 1080,
        bitrate: 2000000,
        framerate: 30
    };
    VideoEncoder.isConfigSupported(config).then(support => {
        const h265Input = h265Option.querySelector('input');
        if (support.supported) {
            h265Option.classList.remove('opacity-30', 'cursor-not-allowed');
            if (h265Input) h265Input.disabled = false;
        } else {
            h265Option.classList.add('opacity-30', 'cursor-not-allowed');
            if (h265Input) h265Input.disabled = true;
        }
    }).catch(e => {
        console.error('H.265 check failed:', e);
        const h265Input = h265Option.querySelector('input');
        h265Option.classList.add('opacity-30', 'cursor-not-allowed');
        if (h265Input) h265Input.disabled = true;
    });
}

checkH265Support();

// Audio Only Toggle Logic
const audioOnlyToggle = document.getElementById('audio-only-toggle');

audioOnlyToggle.addEventListener('change', (e) => {
    const outputFormatSection = document.getElementById('output-format-section');
    const simpleSettingsSection = document.getElementById('simple-settings-section');
    const resolutionSection = document.getElementById('resolution-section');
    const fpsSection = document.getElementById('fps-section');

    if (e.target.checked) {
        // Audio Only Mode: Hide video related sections
        if (outputFormatSection) outputFormatSection.classList.add('hidden');
        // if (simpleSettingsSection) simpleSettingsSection.classList.add('hidden');
        if (presetContainer) presetContainer.classList.add('hidden');
        if (resolutionSection) resolutionSection.classList.add('hidden');
        if (fpsSection) fpsSection.classList.add('hidden');
        if (videoCodecContainer) videoCodecContainer.classList.add('hidden');
        if (videoBitrateContainer) videoBitrateContainer.classList.add('hidden');
        // if (audioBitrateContainer) audioBitrateContainer.classList.remove('hidden');

        // Ensure Audio Codec is visible (it's inside videoSettingsSection which was previously hidden entirely)
        // We need to make sure videoSettingsSection itself is visible, but hide its video parts
        // if (videoSettingsSection) videoSettingsSection.classList.add('hidden');
        // if (audioCodecContainer) audioCodecContainer.classList.remove('hidden');

    } else {
        // Normal Mode: Show all sections
        if (outputFormatSection) outputFormatSection.classList.remove('hidden');
        // if (simpleSettingsSection) simpleSettingsSection.classList.remove('hidden');
        if (presetContainer) presetContainer.classList.remove('hidden');
        if (resolutionSection) resolutionSection.classList.remove('hidden');
        if (fpsSection) fpsSection.classList.remove('hidden');
        if (videoCodecContainer) videoCodecContainer.classList.remove('hidden');
        if (videoBitrateContainer) videoBitrateContainer.classList.remove('hidden');
        // if (audioBitrateContainer) audioBitrateContainer.classList.remove('hidden');
    }
    updateEstimate();
});

function updateEstimate() {
    if (!fileInfo) return;

    let targetVideoBitrate = 0;
    // 音声のみでない場合のみ映像ビットレートを計算
    if (!audioOnlyToggle.checked && fileInfo.video) {
        targetVideoBitrate = parseInt(bitrateInput.value);
        if (targetVideoBitrate >= parseInt(bitrateInput.max)) {
            targetVideoBitrate = fileInfo.video.bitrate;
        }
    }

    let targetAudioBitrate = 0;
    if (fileInfo.audio) {
        targetAudioBitrate = parseInt(audioBitrateInput.value);
        if (targetAudioBitrate >= parseInt(audioBitrateInput.max)) {
            targetAudioBitrate = fileInfo.audio.bitrate;
        }
    }

    if (targetVideoBitrate === 0 && targetAudioBitrate === 0) {
        convertBtn.textContent = `変換開始 (予想サイズ: -- MB)`;
        return;
    }

    const duration = fileInfo.duration;
    const totalBits = (targetVideoBitrate + targetAudioBitrate) * duration;
    const estimatedSizeMB = totalBits / 8 / 1024 / 1024;

    convertBtn.textContent = `変換開始 (予想サイズ: ~${estimatedSizeMB.toFixed(1)} MB)`;

    // Check audio config support
    if (fileInfo && fileInfo.audio) {
        const codec = document.querySelector('input[name="audio_codec"]:checked')?.value;
        const isMaintain = parseInt(audioBitrateInput.value) >= parseInt(audioBitrateInput.max);

        // Use target bitrate if set, otherwise original
        const bitrate = targetAudioBitrate > 0 ? targetAudioBitrate : fileInfo.audio.bitrate;

        // Check for passthrough
        const compatible = isCodecCompatible(fileInfo.audio.codec, codec);

        if (isMaintain && compatible) {
            // Passthrough case: No warning needed
            if (audioBitrateWarning) {
                audioBitrateWarning.classList.add('hidden');
                convertBtn.disabled = false;
            }
        } else {
            // Transcoding case: Worker uses 48000Hz / 2ch
            const sampleRate = 48000;
            const channels = 2;

            checkAudioConfigSupport(codec, bitrate, sampleRate, channels).then(supported => {
                if (audioBitrateWarning) {
                    if (supported) {
                        audioBitrateWarning.classList.add('hidden');
                        convertBtn.disabled = false;
                    } else {
                        audioBitrateWarning.classList.remove('hidden');
                        convertBtn.disabled = true;
                    }
                }
            });
        }
    }
}

function isCodecCompatible(inputCodec, targetSetting) {
    if (!inputCodec) return false;
    const lowerInput = inputCodec.toLowerCase();

    if (targetSetting === 'aac') return lowerInput.includes('mp4a') || lowerInput.includes('aac');
    if (targetSetting === 'opus') return lowerInput.includes('opus');
    return false;
}

async function checkAudioConfigSupport(codec, bitrate, sampleRate, channels) {
    if (!codec) return true;

    // Map UI codec names to valid codec strings for AudioEncoder
    let codecString = codec;
    if (codec === 'aac') codecString = 'mp4a.40.2';
    if (codec === 'opus') codecString = 'opus';

    const config = {
        codec: codecString,
        sampleRate: sampleRate,
        numberOfChannels: channels,
        bitrate: bitrate
    };

    try {
        const support = await AudioEncoder.isConfigSupported(config);
        return support.supported;
    } catch (e) {
        console.warn("Audio config check failed:", e);
        return true; // Assume supported on error to avoid blocking
    }
}

// 2. イベントリスナー
selectBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-active');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-active'));

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-active');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

infoLinkLabel.addEventListener('click', (e) => {
    if (!selectedFile) {
        e.preventDefault();
        modalInfoContent.innerHTML = `<p class="text-center text-slate-500">ファイルが選択されていません。</p>`;
    }
});

document.querySelectorAll('input[name="output_format"], input[name="video_codec"], input[name="audio_codec"]').forEach(input => {
    input.addEventListener('change', updateEstimate);
});

bitrateInput.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    const max = parseInt(e.target.max);

    if (val >= max) {
        bitrateDisplay.textContent = "現在のビットレートを維持";
    } else {
        bitrateDisplay.textContent = (val / 1000000).toFixed(1) + " Mbps";
    }
    updateEstimate();
});

audioBitrateInput.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    const max = parseInt(e.target.max);

    if (val >= max) {
        audioBitrateDisplay.textContent = "現在のビットレートを維持";
    } else {
        audioBitrateDisplay.textContent = Math.round(val / 1000) + " kbps";
    }
    updateEstimate();
});


function updateAudioBitrateRange() {
    const audioCodec = document.querySelector('input[name="audio_codec"]:checked')?.value;
    if (!audioCodec) return;

    let minBitrate = 32000; // Default AAC
    let minLabel = "32k";

    if (audioCodec === 'opus') {
        minBitrate = 16000;
        minLabel = "16k";
    }

    audioBitrateInput.min = minBitrate;
    if (audioBitrateMin) audioBitrateMin.textContent = minLabel;

    // If current value is below new min, clamp it
    if (parseInt(audioBitrateInput.value) < minBitrate) {
        audioBitrateInput.value = minBitrate;
        audioBitrateInput.dispatchEvent(new Event('input'));
    }
    updateEstimate();
}

document.querySelectorAll('input[name="audio_codec"]').forEach(input => {
    input.addEventListener('change', () => {
        updateAudioBitrateRange();
        updateEstimate();
    });
});

// --- 簡易設定モードの新しいロジック ---

presetModeInputs.forEach(input => {
    input.addEventListener('change', (e) => {
        applyPreset(e.target.value);
        updateBoldSelection();
    });
});

function updateResolutionOptions() {
    if (!fileInfo || !fileInfo.video) return;
    const w = fileInfo.video.width;
    const h = fileInfo.video.height;
    const longSide = Math.max(w, h);

    const resolutions = {
        '4k': 3840,
        'fhd': 1920,
        'hd': 1280,
        'sd': 854
    };

    resolutionInputs.forEach(input => {
        const label = input.parentElement;
        const target = resolutions[input.value];
        if (target > longSide) {
            input.disabled = true;
            label.classList.add('opacity-50', 'cursor-not-allowed', 'bg-slate-100', 'dark:bg-slate-800');
            label.classList.remove('cursor-pointer', 'hover:bg-slate-200');
        } else {
            input.disabled = false;
            label.classList.remove('opacity-50', 'cursor-not-allowed', 'bg-slate-100', 'dark:bg-slate-800');
            label.classList.add('cursor-pointer');
        }
    });
}

function getMaxAllowedResolution() {
    const options = ['4k', 'fhd', 'hd', 'sd'];
    for (const opt of options) {
        const input = document.querySelector(`input[name="resolution"][value="${opt}"]`);
        if (input && !input.disabled) return opt;
    }
    return 'sd';
}

function applyPreset(mode) {
    if (!fileInfo || !fileInfo.video) return;

    const originalBitrate = fileInfo.video.bitrate;
    const originalFPS = fileInfo.video.framerate || 30;

    const disableSection = (section, disable) => {
        if (disable) {
            section.classList.add('opacity-50', 'pointer-events-none');
        } else {
            section.classList.remove('opacity-50', 'pointer-events-none');
        }
    };

    const getStandardFpsKey = (fps) => {
        if (Math.abs(fps - 15) < 1.0 || Math.abs(fps - 14.47) < 0.1) return '15';
        if (Math.abs(fps - 24) < 1.0 || Math.abs(fps - 23.976) < 0.1) return '24';
        if (Math.abs(fps - 30) < 1.0 || Math.abs(fps - 29.97) < 0.1) return '30';
        if (Math.abs(fps - 60) < 1.0 || Math.abs(fps - 59.94) < 0.1) return '60';
        return 'keep';
    };

    const getResolutionKey = (width, height) => {
        const longSide = Math.max(width, height);
        if (Math.abs(longSide - 3840) < 10) return '4k';
        if (Math.abs(longSide - 1920) < 10) return 'fhd';
        if (Math.abs(longSide - 1280) < 10) return 'hd';
        if (Math.abs(longSide - 854) < 10) return 'sd';
        return 'keep';
    };

    const setRadio = (name, value) => {
        let targetValue = value;
        if (name === 'resolution') {
            const input = document.querySelector(`input[name="resolution"][value="${value}"]`);
            if (input && input.disabled) {
                targetValue = getMaxAllowedResolution();
            }
        }

        // Try exact match first
        let input = document.querySelector(`input[name="${name}"][value="${targetValue}"]`);

        // Fuzzy match for FPS if exact match fails (e.g. target '15' vs input '14.985')
        if (!input && name === 'fps' && value !== 'keep') {
            const targetNum = parseFloat(targetValue);
            if (!isNaN(targetNum)) {
                const inputs = document.querySelectorAll(`input[name="${name}"]`);
                let minDiff = 0.5; // Tolerance
                inputs.forEach(inp => {
                    const val = parseFloat(inp.value);
                    if (!isNaN(val)) {
                        const diff = Math.abs(val - targetNum);
                        if (diff < minDiff) {
                            minDiff = diff;
                            input = inp;
                        }
                    }
                });
            }
        }

        if (input) input.checked = true;
    };

    if (mode === 'custom') {
        disableSection(resolutionSection, false);
        disableSection(fpsSection, false);
        disableSection(videoBitrateContainer, false);
        disableSection(audioBitrateContainer, false);

        // Reset to original values (Keep)
        const maxBitrate = parseInt(bitrateInput.max);
        bitrateInput.value = maxBitrate;
        bitrateInput.dispatchEvent(new Event('input'));

        const maxAudioBitrate = parseInt(audioBitrateInput.max);
        audioBitrateInput.value = maxAudioBitrate;
        audioBitrateInput.dispatchEvent(new Event('input'));

        setRadio('resolution', getResolutionKey(fileInfo.video.width, fileInfo.video.height));
        setRadio('fps', getStandardFpsKey(originalFPS));
        return;
    }

    disableSection(resolutionSection, true);
    // FPSセクションも無効にする（ユーザー要望により変更）
    disableSection(fpsSection, true);
    disableSection(videoBitrateContainer, true);
    disableSection(audioBitrateContainer, true);

    let targetBitrate = originalBitrate;
    let targetFPS = 'keep';
    let targetResolution = 'sd';

    if (mode === 'low') {
        targetBitrate = Math.max(1000000, originalBitrate / 4);
        targetFPS = (originalFPS > 15) ? '15' : getStandardFpsKey(originalFPS);
        targetResolution = 'sd';
    } else if (mode === 'medium') {
        targetBitrate = Math.max(3000000, originalBitrate / 2);
        targetFPS = (originalFPS > 30) ? '30' : getStandardFpsKey(originalFPS);
        targetResolution = 'hd';
    } else if (mode === 'high') {
        targetBitrate = Math.max(6000000, originalBitrate);
        targetFPS = (originalFPS > 60) ? '60' : getStandardFpsKey(originalFPS);
        targetResolution = 'fhd';
    }

    const maxBitrate = parseInt(bitrateInput.max);
    const finalBitrate = Math.min(targetBitrate, maxBitrate);
    bitrateInput.value = finalBitrate;
    bitrateInput.dispatchEvent(new Event('input'));

    setRadio('fps', targetFPS);
    setRadio('resolution', targetResolution);

    updateEstimate();
}

function handleFile(file) {
    if (!file) return;
    selectedFile = file;

    fileNameDisplay.textContent = file.name;
    fileStatusDisplay.textContent = "解析中...";

    settingsArea.classList.add('opacity-50', 'pointer-events-none');
    convertBtn.disabled = true;

    // 新しいファイルを選択したときに以前の完了時間をクリアする
    // document.getElementById('progress-text').textContent = '処理中: 0%';
    conversionStartTime = null;

    updateInfoLinkState(true);

    worker.postMessage({ type: 'inspect', data: { file: file } });
}

// ユーザーフレンドリーなコーデック名を取得するヘルパー関数
function getCodecDisplayName(codec) {
    if (!codec) return '不明';
    const c = codec.toLowerCase();
    if (c.startsWith('avc') || c.startsWith('h264')) return 'H.264';
    if (c.startsWith('hvc') || c.startsWith('hev')) return 'H.265';
    if (c.startsWith('av01')) return 'AV1';
    if (c.startsWith('mp4a') || c === 'aac') return 'AAC';
    if (c.startsWith('opus')) return 'Opus';
    if (c.startsWith('vp8')) return 'VP8';
    if (c.startsWith('vp9')) return 'VP9';
    return codec;
}

function getContainerDisplayName(mimeType) {
    if (!mimeType) return 'Unknown';
    const lower = mimeType.toLowerCase();
    if (lower.includes('mp4')) return 'MP4';
    if (lower.includes('webm')) return 'WebM';
    if (lower.includes('quicktime')) return 'MOV';
    if (lower.includes('matroska') || lower.includes('mkv')) return 'MKV';
    return mimeType;
}

function updateFileInfo(info) {
    console.log("[UI] updateFileInfo received:", info);
    fileInfo = info;
    fileStatusDisplay.textContent = `${getContainerDisplayName(info.container)} | ${(info.fileSize / 1024 / 1024).toFixed(1)} MB`;
    settingsArea.classList.remove('opacity-50', 'pointer-events-none');
    convertBtn.disabled = false;

    const originalVideoBitrate = info.video && info.video.bitrate > 0 ? info.video.bitrate : 2000000;
    const SAFE_MAX_VIDEO = 10000000;
    // ステップを100kbpsに固定
    const videoStep = 100000;
    // 最大値をステップの倍数に切り上げ
    const maxVideoBitrate = Math.ceil(Math.min(Math.max(originalVideoBitrate, 1000000), SAFE_MAX_VIDEO) / videoStep) * videoStep;

    bitrateInput.max = maxVideoBitrate;
    bitrateInput.step = videoStep;
    bitrateInput.value = maxVideoBitrate;
    bitrateDisplay.textContent = "現在のビットレートを維持";
    videoBitrateMid.textContent = (maxVideoBitrate / 2 / 1000000).toFixed(1) + "M";
    videoBitrateMax.textContent = (maxVideoBitrate / 1000000).toFixed(1) + "M";

    const originalAudioBitrate = info.audio && info.audio.bitrate > 0 ? info.audio.bitrate : 128000;
    const SAFE_MAX_AUDIO = 320000;
    // ステップを16kbpsに固定
    const audioStep = 16000;
    // 最大値をステップの倍数に切り上げ
    const maxAudioBitrate = Math.ceil(Math.min(Math.max(originalAudioBitrate, 32000), SAFE_MAX_AUDIO) / audioStep) * audioStep;

    audioBitrateInput.max = maxAudioBitrate;
    audioBitrateInput.step = audioStep;
    audioBitrateInput.value = maxAudioBitrate;
    audioBitrateDisplay.textContent = "現在のビットレートを維持";
    audioBitrateMid.textContent = Math.round(maxAudioBitrate / 2 / 1000) + "k";
    audioBitrateMax.textContent = Math.round(maxAudioBitrate / 1000) + "k";

    // コンテナ（出力フォーマット）の自動選択
    let targetFormat = 'mp4'; // デフォルト
    if (info.container && info.container.toLowerCase().includes('webm')) {
        targetFormat = 'webm';
    } else if (selectedFile && selectedFile.name.toLowerCase().endsWith('.webm')) {
        targetFormat = 'webm';
    }
    // MOVなどはmp4をデフォルトにする
    const formatRadio = document.querySelector(`input[name="output_format"][value="${targetFormat}"]`);
    if (formatRadio) formatRadio.checked = true;

    // フォーマットのラベル更新
    document.querySelectorAll('input[name="output_format"]').forEach(input => {
        const labelSpan = input.nextElementSibling;
        if (labelSpan && labelSpan.tagName === 'SPAN') {
            let text = labelSpan.textContent.replace(/[\[\]]/g, '').trim();
            if (input.value === targetFormat) {
                text = `[ ${text} ]`;
            }
            labelSpan.textContent = text;
        }
    });

    // コーデックの自動選択（パススルー推奨）
    let targetVideoCodec = null;
    if (info.video && info.video.codec) {
        const c = info.video.codec.toLowerCase();
        if (c.includes('avc') || c.includes('h264')) targetVideoCodec = 'h264';
        else if (c.includes('hvc') || c.includes('hev')) targetVideoCodec = 'h265';
        else if (c.includes('av01') || c.includes('av1')) targetVideoCodec = 'av1';

        if (targetVideoCodec) {
            const radio = document.querySelector(`input[name="video_codec"][value="${targetVideoCodec}"]`);
            if (radio && !radio.disabled && !radio.parentElement.classList.contains('hidden')) {
                radio.checked = true;
            }
        }
    }

    // 動画コーデックのラベル更新
    document.querySelectorAll('input[name="video_codec"]').forEach(input => {
        const labelSpan = input.nextElementSibling;
        if (labelSpan && labelSpan.tagName === 'SPAN') {
            let text = labelSpan.textContent.replace(/[\[\]]/g, '').trim();
            if (input.value === targetVideoCodec) {
                text = `[ ${text} ]`;
            }
            labelSpan.textContent = text;
        }
    });

    let targetAudioCodec = null;
    if (info.audio && info.audio.codec) {
        const c = info.audio.codec.toLowerCase();
        if (c.includes('mp4a') || c.includes('aac')) targetAudioCodec = 'aac';
        else if (c.includes('opus')) targetAudioCodec = 'opus';

        if (targetAudioCodec) {
            const radio = document.querySelector(`input[name="audio_codec"][value="${targetAudioCodec}"]`);
            if (radio) radio.checked = true;
        }
    }

    // 音声コーデックのラベル更新
    document.querySelectorAll('input[name="audio_codec"]').forEach(input => {
        const labelSpan = input.nextElementSibling;
        if (labelSpan && labelSpan.tagName === 'SPAN') {
            let text = labelSpan.textContent.replace(/[\[\]]/g, '').trim();
            if (input.value === targetAudioCodec) {
                text = `[ ${text} ]`;
            }
            labelSpan.textContent = text;
        }
    });

    updateAudioBitrateRange(); // Initialize range based on default/detected codec

    modalInfoContent.innerHTML = `
    <div class="space-y-3">
        <div class="flex items-center justify-between border-b border-slate-100 pb-2"><span class="text-sm text-slate-500 dark:text-slate-400">コンテナ</span><span class="font-medium text-slate-800 dark:text-white">${getContainerDisplayName(info.container)}</span></div>
        <div class="flex items-center justify-between border-b border-slate-100 pb-2"><span class="text-sm text-slate-500 dark:text-slate-400">ファイルサイズ</span><span class="font-medium text-slate-800 dark:text-white">${(info.fileSize / 1024 / 1024).toFixed(2)} MB</span></div>
        <div class="flex items-center justify-between border-b border-slate-100 pb-2"><span class="text-sm text-slate-500 dark:text-slate-400">再生時間</span><span class="font-medium text-slate-800 dark:text-white">${info.duration.toFixed(2)} 秒</span></div>

        
        <p class="text-xs font-bold text-slate-400 pt-4 border-t border-slate-100 dark:border-slate-700">映像ストリーム</p>
        ${info.video ? `
            <div class="flex items-center justify-between"><span class="text-sm text-slate-500 dark:text-slate-400">コーデック</span><span class="font-medium text-slate-800 dark:text-white">${info.video.codec}</span></div>
            <div class="flex items-center justify-between"><span class="text-sm text-slate-500 dark:text-slate-400">解像度</span><span class="font-medium text-slate-800 dark:text-white">${info.video.width}x${info.video.height}</span></div>
            <div class="flex items-center justify-between"><span class="text-sm text-slate-500 dark:text-slate-400">FPS</span><span class="font-medium text-slate-800 dark:text-white">${info.video.framerate ? info.video.framerate.toFixed(2) + ' fps' : '不明'}</span></div>
            <div class="flex items-center justify-between"><span class="text-sm text-slate-500 dark:text-slate-400">ビットレート</span><span class="font-medium text-slate-800 dark:text-white">${Math.round(info.video.bitrate / 1000)} kbps</span></div>
        ` : '<p class="text-sm text-slate-500 dark:text-slate-400">映像ストリームなし</p>'}

        <p class="text-xs font-bold text-slate-400 pt-4 border-t border-slate-100 dark:border-slate-700">音声ストリーム</p>
        ${info.audio ? `
            <div class="flex items-center justify-between"><span class="text-sm text-slate-500 dark:text-slate-400">コーデック</span><span class="font-medium text-slate-800 dark:text-white">${info.audio.codec}</span></div>
            <div class="flex items-center justify-between"><span class="text-sm text-slate-500 dark:text-slate-400">チャンネル数</span><span class="font-medium text-slate-800 dark:text-white">${info.audio.channels} ch</span></div>
            <div class="flex items-center justify-between"><span class="text-sm text-slate-500 dark:text-slate-400">ビットレート</span><span class="font-medium text-slate-800 dark:text-white">${Math.round(info.audio.bitrate / 1000)} kbps</span></div>
        ` : '<p class="text-sm text-slate-500 dark:text-slate-400">音声ストリームなし</p>'}
    </div>
    `;

    updateResolutionOptions();

    // 解像度のラベル更新（一致するものを[]で囲む）
    const width = info.video.width;
    const height = info.video.height;
    const longSide = Math.max(width, height);

    const resolutions = {
        '4k': 3840,
        'fhd': 1920,
        'hd': 1280,
        'sd': 854
    };

    resolutionInputs.forEach(input => {
        const labelSpan = input.nextElementSibling;
        if (labelSpan && labelSpan.tagName === 'SPAN') {
            let text = labelSpan.textContent.replace(/[\[\]]/g, '').trim(); // 既存の[]を削除
            const target = resolutions[input.value];

            // 解像度が一致する場合（許容誤差10px）
            if (target && Math.abs(longSide - target) < 10) {
                text = `[ ${text} ]`;
            }
            labelSpan.textContent = text;
        }
    });

    // 解像度の自動選択
    // width, height, longSide は上で定義済み
    let resValue = 'custom';

    // 解像度マッチングの許容範囲 (例: 1920x1080 vs 1920x1088)
    if (Math.abs(longSide - 3840) < 10) resValue = '4k';
    else if (Math.abs(longSide - 1920) < 10) resValue = 'fhd';
    else if (Math.abs(longSide - 1280) < 10) resValue = 'hd';
    else if (Math.abs(longSide - 854) < 10) resValue = 'sd';

    // FPSの自動選択
    const fps = info.video.framerate || 30;
    let fpsValue = 'custom';

    // 15, 30, 60 の特定のロジック (~29.97 などの処理)
    if (Math.abs(fps - 15) < 1.0 || Math.abs(fps - 14.47) < 0.1) fpsValue = '15';
    else if (Math.abs(fps - 30) < 1.0 || Math.abs(fps - 29.97) < 0.1) fpsValue = '30';
    else if (Math.abs(fps - 60) < 1.0 || Math.abs(fps - 59.94) < 0.1) fpsValue = '60';
    else {
        // 上記で一致しない場合は標準チェックにフォールバック
        const standardFps = [15, 24, 30, 60];
        for (const sFps of standardFps) {
            if (Math.abs(fps - sFps) < 0.5) {
                fpsValue = sFps.toString();
                break;
            }
        }
    }

    // カスタムラベルの更新
    const resCustomText = document.getElementById('res-custom-text');
    if (resCustomText) {
        resCustomText.textContent = `カスタム (${width}x${height})`;
    }
    const fpsCustomText = document.getElementById('fps-custom-text');
    if (fpsCustomText) {
        fpsCustomText.textContent = `カスタム (${fps.toFixed(2)})`;
    }

    // 選択の適用
    const resInput = document.querySelector(`input[name="resolution"][value="${resValue}"]`);
    if (resInput && !resInput.disabled) {
        resInput.checked = true;
    } else {
        // 計算された解像度が無効な場合のフォールバック (例: 小さい動画での4K? updateResolutionOptionsのロジックで最大値を処理)
        // カスタムが選択されているが無効な場合（カスタムでは起こらないはず）、許可された最大値にフォールバック
        if (resValue !== 'custom') {
            const maxRes = getMaxAllowedResolution();
            const fallbackInput = document.querySelector(`input[name="resolution"][value="${maxRes}"]`);
            if (fallbackInput) fallbackInput.checked = true;
        } else {
            // カスタムが何らかの理由で無効な場合、またはカスタムを強制したい場合
            const customInput = document.querySelector(`input[name="resolution"][value="custom"]`);
            if (customInput) customInput.checked = true;
        }
    }

    const fpsInput = document.querySelector(`input[name="fps"][value="${fpsValue}"]`);
    if (fpsInput) fpsInput.checked = true;
    else {
        const customFpsInput = document.querySelector(`input[name="fps"][value="custom"]`);
        if (customFpsInput) customFpsInput.checked = true;
    }

    // 特定の値を設定している場合は、デフォルトでカスタムプリセットモードにする
    // しかし、プリセットと一致する場合は、それを選択すべきか？ 
    // 今のところ、混乱を避けるために「カスタム」（自由）モードに固執するか、シンプルに保つ。
    // 要件には次のようにある：「動画の解像度/FPSが標準プリセットと一致する場合、その特定のプリセットオプションを太字にする。」
    // 「簡易設定モード」を低/中/高に変更するとは明示されていない。
    // したがって、これらの特定の選択を可能にするために、簡易設定で「カスタム」（自由）を選択する。
    const customPreset = document.querySelector('input[name="preset_mode"][value="custom"]');
    if (customPreset) {
        customPreset.checked = true;
        applyPreset('custom'); // これによりすべてのセクションが有効になる
    }

    // 解像度説明の更新
    const resDesc = document.getElementById('resolution-desc');
    if (resDesc && info.video) {
        resDesc.textContent = `現在のサイズ：${info.video.width}px x ${info.video.height}px (元の縦横比を維持し、長辺を基準に32の倍数で調整されます。)`;
    }

    // ソースより高いFPSオプションを無効にする
    const sourceFps = info.video ? (info.video.framerate || 30) : 30;
    // ソースFPS系列に基づいてFPSオプションを更新
    const standardFpsValues = [15, 24, 30, 60];
    let fpsRatio = 1.0;

    // 「系列」を決定するために最も近い標準FPSを見つける
    let closestStandard = 30;
    let minDiff = Infinity;

    for (const sFps of standardFpsValues) {
        const diff = Math.abs(sourceFps - sFps);
        if (diff < minDiff) {
            minDiff = diff;
            closestStandard = sFps;
        }
    }

    // ソースが標準に近いが正確な整数でない場合（例: 29.97 vs 30）、比率を計算する
    // 30.0 が 29.99999 になるのを避けるために小さな閾値を使用する
    if (minDiff < 1.0 && minDiff > 0.001) {
        fpsRatio = sourceFps / closestStandard;
    }

    // ラベルと値を更新
    fpsInputs.forEach((input, index) => {
        // Skip non-numeric options (keep, custom)
        if (index >= standardFpsValues.length) return;

        let baseValue = 0;
        if (index < standardFpsValues.length) {
            baseValue = standardFpsValues[index];
        } else {
            baseValue = Math.round(parseFloat(input.value));
        }

        const newValue = baseValue * fpsRatio;

        // value属性を更新
        input.value = newValue;

        // ラベルテキストを更新
        // HTML構造: <label><input ...><span ...>...</span></label>
        // input.nextElementSibling は span 要素そのもの
        const labelSpan = input.nextElementSibling;
        if (labelSpan && labelSpan.tagName === 'SPAN') {
            // 小数点以下2桁まで表示、整数の場合は末尾のゼロを削除
            let text = parseFloat(newValue.toFixed(2)).toString();

            // ソースFPSと一致する場合、[]で囲む
            // 許容誤差: 0.01 (29.97 vs 29.970001 etc)
            if (Math.abs(newValue - sourceFps) < 0.01) {
                text = `[ ${text} ]`;
            }

            labelSpan.textContent = text;
        }

        const val = parseFloat(input.value);
        const label = input.parentElement;
        // 29.97fpsソースに対して30fps、59.94fpsソースに対して60fpsなどを選択できるようにする
        if (val > sourceFps + 0.5) {
            input.disabled = true;
            label.classList.add('opacity-50', 'cursor-not-allowed', 'bg-slate-100', 'dark:bg-slate-800');
            label.classList.remove('cursor-pointer', 'hover:bg-slate-200');
            if (input.checked) {
                // 無効なオプションがチェックされていた場合（新しいファイルではありえないが、可能性はある）、'keep' に切り替える
                const keepInput = document.querySelector('input[name="fps"][value="keep"]');
                if (keepInput) keepInput.checked = true;
            }
        } else {
            input.disabled = false;
            label.classList.remove('opacity-50', 'cursor-not-allowed', 'bg-slate-100', 'dark:bg-slate-800');
            label.classList.add('cursor-pointer');
        }
    });

    updateEstimate();
    updateBoldSelection(); // 選択されたオプションを太字にするために呼び出す
    updateDisplayValues();
}

function updateDisplayValues() {
    if (!fileInfo || !fileInfo.video) return;

    // --- Resolution ---
    let width = fileInfo.video.width;
    let height = fileInfo.video.height;
    const selectedRes = document.querySelector('input[name="resolution"]:checked')?.value || 'keep';

    if (selectedRes !== 'keep') {
        const longSide = Math.max(width, height);
        const aspectRatio = width / height;
        let targetLongSide = longSide;

        if (selectedRes === '4k') targetLongSide = 3840;
        else if (selectedRes === 'fhd') targetLongSide = 1920;
        else if (selectedRes === 'hd') targetLongSide = 1280;
        else if (selectedRes === 'sd') targetLongSide = 854;

        // ターゲットがソースより小さい場合、縮小する
        if (targetLongSide < longSide) {
            if (width >= height) {
                width = targetLongSide;
                height = Math.round(width / aspectRatio);
            } else {
                height = targetLongSide;
                width = Math.round(height * aspectRatio);
            }
            // 2の倍数（または説明にあるように32の倍数だが、コーデックの標準は通常2または4）を確保する
            // 説明には「32の倍数」とあるので、可能ならそれを尊重するか、少なくとも偶数にする。
            // 表示目的のために単純なスケーリングに固執し、おそらく2に丸める。
            width = Math.round(width / 2) * 2;
            height = Math.round(height / 2) * 2;
        }
    }
    if (resolutionValueDisplay) {
        resolutionValueDisplay.textContent = `${width}x${height}`;
    }

    // --- FPS ---
    let fps = fileInfo.video.framerate || 30;
    const selectedFps = document.querySelector('input[name="fps"]:checked')?.value || 'keep';

    if (selectedFps !== 'keep') {
        const targetFps = parseFloat(selectedFps);
        // If the target FPS is close to the source FPS (e.g. 30 vs 29.97, or 15 vs 14.47),
        // use the source FPS for display to indicate we are maintaining the original timing.
        if (Math.abs(targetFps - fps) >= 1.0) {
            fps = targetFps;
        }
    }

    if (fpsValueDisplay) {
        // 最大2桁の小数にフォーマット、例: 29.97, 30, 60
        fpsValueDisplay.textContent = `${parseFloat(fps.toFixed(2))}fps`;
    }
}

function updateBoldSelection() {
    // チェックされた入力のラベルを太字にし、他を太字解除するヘルパー
    const updateBold = (name) => {
        document.querySelectorAll(`input[name="${name}"]`).forEach(input => {
            const labelSpan = input.nextElementSibling;
            if (input.checked) {
                labelSpan.classList.add('font-bold');
            } else {
                labelSpan.classList.remove('font-bold');
            }
        });
    };

    updateBold('resolution');
    updateBold('fps');
    updateBold('preset_mode');
}

// ユーザーが選択を変更したときに太字を更新するリスナーを追加
document.querySelectorAll('input[name="resolution"], input[name="fps"], input[name="preset_mode"]').forEach(input => {
    input.addEventListener('change', () => {
        updateBoldSelection();
        if (input.name === 'preset_mode') {
            applyPreset(input.value);
        }
        updateDisplayValues();
    });
});



// 経過時間をフォーマットするヘルパー関数 [mm:ss]
function formatElapsedTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `[${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
}
// 経過時間表示を更新
function updateElapsedTime() {
    if (!conversionStartTime) return;
    const elapsed = (Date.now() - conversionStartTime) / 1000;
    const percentage = document.getElementById('progress-bar').style.width.replace('%', '') || '0';
    // document.getElementById('progress-text').textContent = `処理中: ${percentage}% (${formatElapsedTime(elapsed)})`;
    cancelBtn.textContent = `中断 (${percentage}% ${formatElapsedTime(elapsed)})`;
}

convertBtn.addEventListener('click', () => {
    if (!selectedFile) return;

    convertBtn.classList.add('hidden');
    cancelBtn.classList.remove('hidden'); // キャンセルボタンを表示
    document.getElementById('progress-container').classList.remove('hidden');
    settingsArea.classList.add('opacity-50', 'pointer-events-none');
    document.getElementById('progress-bar').style.width = '0%';
    // document.getElementById('progress-text').textContent = "処理中: 0%";
    cancelBtn.textContent = "中断 (0%)";

    // 変換中にボタンに進行状況%を表示
    convertBtn.textContent = "処理中: 0%";

    const vBitrate = parseInt(bitrateInput.value) >= parseInt(bitrateInput.max) ? -1 : parseInt(bitrateInput.value);
    const aBitrate = parseInt(audioBitrateInput.value) >= parseInt(audioBitrateInput.max) ? -1 : parseInt(audioBitrateInput.value);

    const settings = {
        format: document.querySelector('input[name="output_format"]:checked').value,
        videoCodec: document.querySelector('input[name="video_codec"]:checked').value,
        audioCodec: document.querySelector('input[name="audio_codec"]:checked').value,
        videoBitrate: vBitrate,
        audioBitrate: aBitrate,
        originalVideoBitrate: fileInfo.video && fileInfo.video.bitrate > 0 ? fileInfo.video.bitrate : 2000000,
        originalVideoBitrate: fileInfo.video && fileInfo.video.bitrate > 0 ? fileInfo.video.bitrate : 2000000,
        originalAudioBitrate: fileInfo.audio && fileInfo.audio.bitrate > 0 ? fileInfo.audio.bitrate : 128000,
        audioOnly: document.getElementById('audio-only-toggle').checked,
        resolution: document.querySelector('input[name="resolution"]:checked')?.value || 'sd',
        fps: document.querySelector('input[name="fps"]:checked')?.value || 'keep'
    };
    // 経過時間の追跡を開始
    conversionStartTime = Date.now();

    elapsedTimer = setInterval(updateElapsedTime, 1000);

    worker.postMessage({ type: 'start', data: { file: selectedFile, settings } });
});

// キャンセルボタンのイベント
cancelBtn.addEventListener('click', () => {
    console.log("Cancel button clicked");
    worker.postMessage({ type: 'cancel' });
});

worker.onmessage = (e) => {
    const { type, value, blob, error, data, outputExtension } = e.data;

    if (type === 'analysis_result') {
        updateFileInfo(data);
    } else if (type === 'progress') {
        document.getElementById('progress-bar').style.width = `${value}%`;
        // Update progress text with elapsed time
        /*
        if (conversionStartTime) {
            const elapsed = (Date.now() - conversionStartTime) / 1000;
            document.getElementById('progress-text').textContent = `処理中: ${value}% (${formatElapsedTime(elapsed)})`;
        } else {
            document.getElementById('progress-text').textContent = `処理中: ${value}%`;
        }
        */
        const elapsed = conversionStartTime ? (Date.now() - conversionStartTime) / 1000 : 0;
        cancelBtn.textContent = `中断 (${value}%)  ${formatElapsedTime(elapsed)}`;
        // Update button text with progress
        convertBtn.textContent = `処理中: ${value}%`;
    } else if (type === 'complete') {
        // Stop timer and show completion time
        if (elapsedTimer) {
            clearInterval(elapsedTimer);
            elapsedTimer = null;
        }
        if (conversionStartTime) {
            const totalTime = (Date.now() - conversionStartTime) / 1000;
            // document.getElementById('progress-text').textContent = `完了! (処理時間: ${formatElapsedTime(totalTime)})`;
            convertBtn.textContent = `変換完了 ${formatElapsedTime(totalTime)}`;
        }

        downloadFile(blob, outputExtension);
        setTimeout(() => {
            convertBtn.classList.remove('hidden');
            cancelBtn.classList.add('hidden');
            document.getElementById('progress-container').classList.add('hidden');
            settingsArea.classList.remove('opacity-50', 'pointer-events-none');
            // Revert to "Start Conversion" with estimate
            // updateEstimate(); // 完了表示を残すためにコメントアウト、または遅延させる
            // ユーザーが次のアクションを起こすまで完了表示を残したいが、
            // 3秒後にリセットされるロジックになっている。
            // ユーザーの要望は「変換完了後、変換開始ボタンを...変えてください」なので、
            // ここでテキストを変更し、リセットを遅らせるか、リセットしないか。
            // 現在のロジックでは3秒後にリセットされる。
            // リセットされると「変換開始...」に戻る。
            // 完了時間を表示し続けたいなら、updateEstimateを呼ばない、あるいは
            // updateEstimate内で完了状態を考慮する必要がある。
            // しかし、新しいファイルを選んだり設定を変えたりしたらリセットされるべき。
            // ここでは3秒後にリセットされる挙動を変更し、ユーザーが何か操作するまで残すか、
            // あるいは単に3秒間表示するテキストを変更するか。
            // 文脈からすると、完了直後の表示を変更したいと思われる。
            // もし永続的に表示したいなら、3000msのsetTimeoutを削除すべき。
            // しかし、次の変換のためにボタンを有効化する必要がある。
            // ボタンは有効化しつつ、テキストは「変換完了」のままにするのが良いUXかも。
            // でも updateEstimate が呼ばれると上書きされる。
            // とりあえず3秒間の表示を変更する。
        }, 3000); // 3秒間完了時間を表示
    } else if (type === 'cancelled') {
        console.log("Transcoding cancelled by user");
        // Clean up timer
        if (elapsedTimer) {
            clearInterval(elapsedTimer);
            elapsedTimer = null;
        }
        conversionStartTime = null;

        convertBtn.classList.remove('hidden');
        cancelBtn.classList.add('hidden'); // キャンセルボタンを隠す
        document.getElementById('progress-container').classList.add('hidden');
        settingsArea.classList.remove('opacity-50', 'pointer-events-none');
        settingsArea.classList.remove('opacity-50', 'pointer-events-none');
        showAlert("変換がキャンセルされました");
        // Revert to "Start Conversion" with estimate
        updateEstimate();
    } else if (type === 'error') {
        // Clean up timer
        if (elapsedTimer) {
            clearInterval(elapsedTimer);
            elapsedTimer = null;
        }
        conversionStartTime = null;

        showAlert(error);
        console.error(error);
        convertBtn.classList.remove('hidden');
        cancelBtn.classList.add('hidden'); // キャンセルボタンを隠す
        document.getElementById('progress-container').classList.add('hidden');
        settingsArea.classList.remove('opacity-50', 'pointer-events-none');
        // Revert to "Start Conversion" with estimate
        updateEstimate();
    }
};

function downloadFile(blob, outputExtension) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // workerから拡張子が提供されている場合はそれを使用、なければ従来通り
    const ext = outputExtension || document.querySelector('input[name="output_format"]:checked').value;
    const baseName = selectedFile.name.split('.').slice(0, -1).join('_') || 'input';
    a.download = `${baseName}_transcoded.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
