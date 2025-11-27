// --- Main Thread Logic ---

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

const estSizeDisplay = document.getElementById('est-size');
const infoLinkContainer = document.getElementById('info-link-container');
const infoLinkLabel = document.getElementById('info-link-label');
const modalInfoContent = document.getElementById('modal-info-content');
const videoInfoModalCheckbox = document.getElementById('video-info-modal');
const h265Option = document.getElementById('h265-option');
const originalVideoCodec = document.getElementById('original-video-codec');
const originalAudioCodec = document.getElementById('original-audio-codec');
const videoBitrateMax = document.getElementById('video-bitrate-max');
const audioBitrateMax = document.getElementById('audio-bitrate-max');
const elapsedTimeDisplay = document.getElementById('elapsed-time');

const presetModeInputs = document.querySelectorAll('input[name="preset_mode"]');
const resolutionInputs = document.querySelectorAll('input[name="resolution"]');
const fpsInputs = document.querySelectorAll('input[name="fps"]');
const resolutionSection = document.getElementById('resolution-section');
const fpsSection = document.getElementById('fps-section');
const videoSettingsSection = document.getElementById('video-settings-section');
const audioSettingsSection = document.querySelector('#video-settings-section + div'); // Audio settings is next sibling
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
    try {
        const support = await VideoEncoder.isConfigSupported(config);
        if (support.supported) {
            h265Option.classList.remove('hidden');
            h265Option.classList.add('flex');
        }
    } catch (e) {
        console.log("H.265 not supported");
    }
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
        if (outputFormatSection) outputFormatSection.classList.add('hidden');
        videoSettingsSection.classList.add('hidden');
        if (simpleSettingsSection) simpleSettingsSection.classList.add('hidden');
        if (resolutionSection) resolutionSection.classList.add('hidden');
        if (fpsSection) fpsSection.classList.add('hidden');
    } else {
        if (outputFormatSection) outputFormatSection.classList.remove('hidden');
        videoSettingsSection.classList.remove('hidden');
        if (simpleSettingsSection) simpleSettingsSection.classList.remove('hidden');
        if (resolutionSection) resolutionSection.classList.remove('hidden');
        if (fpsSection) fpsSection.classList.remove('hidden');
    }
    updateEstimate();
});

function updateEstimate() {
    if (!fileInfo) return;

    let targetVideoBitrate = 0;
    // Only calculate video bitrate if not audio-only
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
        estSizeDisplay.textContent = `-- MB`;
        return;
    }

    const duration = fileInfo.duration;
    const totalBits = (targetVideoBitrate + targetAudioBitrate) * duration;
    const estimatedSizeMB = totalBits / 8 / 1024 / 1024;

    estSizeDisplay.textContent = `~${estimatedSizeMB.toFixed(1)} MB`;
}

// 2. Event Listeners
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

// --- New Logic for Simple Settings ---

presetModeInputs.forEach(input => {
    input.addEventListener('change', (e) => {
        applyPreset(e.target.value);
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

    const setRadio = (name, value) => {
        let targetValue = value;
        if (name === 'resolution') {
            const input = document.querySelector(`input[name="resolution"][value="${value}"]`);
            if (input && input.disabled) {
                targetValue = getMaxAllowedResolution();
            }
        }

        const input = document.querySelector(`input[name="${name}"][value="${targetValue}"]`);
        if (input) input.checked = true;
    };

    if (mode === 'custom') {
        disableSection(resolutionSection, false);
        disableSection(fpsSection, false);
        disableSection(videoSettingsSection, false);
        disableSection(audioSettingsSection, false);
        return;
    }

    disableSection(resolutionSection, true);
    disableSection(fpsSection, true);
    disableSection(videoSettingsSection, true);
    disableSection(audioSettingsSection, true);

    let targetBitrate = originalBitrate;
    let targetFPS = 'keep';
    let targetResolution = 'sd';

    if (mode === 'low') {
        targetBitrate = Math.max(1000000, originalBitrate / 4);
        targetFPS = (originalFPS > 15) ? '15' : 'keep';
        targetResolution = 'sd';
    } else if (mode === 'medium') {
        targetBitrate = Math.max(3000000, originalBitrate / 2);
        targetFPS = (originalFPS > 30) ? '30' : 'keep';
        targetResolution = 'hd';
    } else if (mode === 'high') {
        targetBitrate = Math.max(6000000, originalBitrate);
        targetFPS = (originalFPS > 60) ? '60' : 'keep';
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

    updateInfoLinkState(true);

    worker.postMessage({ type: 'inspect', data: { file: file } });
}

// Helper function to get user-friendly codec name
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

function updateFileInfo(info) {
    fileInfo = info;
    fileStatusDisplay.textContent = `${info.container} | ${(info.fileSize / 1024 / 1024).toFixed(1)} MB`;
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
    // ステップを1kbpsに固定
    const audioStep = 1000;
    // 最大値をステップの倍数に切り上げ
    const maxAudioBitrate = Math.ceil(Math.min(Math.max(originalAudioBitrate, 32000), SAFE_MAX_AUDIO) / audioStep) * audioStep;

    audioBitrateInput.max = maxAudioBitrate;
    audioBitrateInput.step = audioStep;
    audioBitrateInput.value = maxAudioBitrate;
    audioBitrateDisplay.textContent = "現在のビットレートを維持";
    audioBitrateMid.textContent = Math.round(maxAudioBitrate / 2 / 1000) + "k";
    audioBitrateMax.textContent = Math.round(maxAudioBitrate / 1000) + "k";

    // Display original codecs
    if (info.video && info.video.codec) {
        originalVideoCodec.textContent = `元のコーデック: ${getCodecDisplayName(info.video.codec)}`;
    } else {
        originalVideoCodec.textContent = '元のコーデック: 映像なし';
    }
    if (info.audio && info.audio.codec) {
        originalAudioCodec.textContent = `元のコーデック: ${getCodecDisplayName(info.audio.codec)}`;
    } else {
        originalAudioCodec.textContent = '元のコーデック: 音声なし';
    }

    // コンテナ（出力フォーマット）の自動選択
    let targetFormat = 'mp4'; // Default
    if (info.container && info.container.toLowerCase().includes('webm')) {
        targetFormat = 'webm';
    } else if (selectedFile && selectedFile.name.toLowerCase().endsWith('.webm')) {
        targetFormat = 'webm';
    }
    // MOV or others default to mp4
    const formatRadio = document.querySelector(`input[name="output_format"][value="${targetFormat}"]`);
    if (formatRadio) formatRadio.checked = true;

    // コーデックの自動選択（パススルー推奨）
    if (info.video && info.video.codec) {
        const c = info.video.codec.toLowerCase();
        let targetVal = null;
        if (c.includes('avc') || c.includes('h264')) targetVal = 'h264';
        else if (c.includes('hvc') || c.includes('hev')) targetVal = 'h265';
        else if (c.includes('av01') || c.includes('av1')) targetVal = 'av1';

        if (targetVal) {
            const radio = document.querySelector(`input[name="video_codec"][value="${targetVal}"]`);
            if (radio && !radio.disabled && !radio.parentElement.classList.contains('hidden')) {
                radio.checked = true;
            }
        }
    }

    if (info.audio && info.audio.codec) {
        const c = info.audio.codec.toLowerCase();
        let targetVal = null;
        if (c.includes('mp4a') || c.includes('aac')) targetVal = 'aac';
        else if (c.includes('opus')) targetVal = 'opus';

        if (targetVal) {
            const radio = document.querySelector(`input[name="audio_codec"][value="${targetVal}"]`);
            if (radio) radio.checked = true;
        }
    }

    modalInfoContent.innerHTML = `
    <div class="space-y-3">
        <div class="flex items-center justify-between border-b border-slate-100 pb-2"><span class="text-sm text-slate-500 dark:text-slate-400">コンテナ</span><span class="font-medium text-slate-800 dark:text-white">${info.container}</span></div>
        <div class="flex items-center justify-between border-b border-slate-100 pb-2"><span class="text-sm text-slate-500 dark:text-slate-400">ファイルサイズ</span><span class="font-medium text-slate-800 dark:text-white">${(info.fileSize / 1024 / 1024).toFixed(2)} MB</span></div>
        <div class="flex items-center justify-between border-b border-slate-100 pb-2"><span class="text-sm text-slate-500 dark:text-slate-400">再生時間</span><span class="font-medium text-slate-800 dark:text-white">${info.duration.toFixed(2)} 秒</span></div>
        
        <p class="text-xs font-bold text-slate-400 pt-4 border-t border-slate-100 dark:border-slate-700">映像ストリーム</p>
        ${info.video ? `
            <div class="flex items-center justify-between"><span class="text-sm text-slate-500 dark:text-slate-400">コーデック</span><span class="font-medium text-slate-800 dark:text-white">${info.video.codec}</span></div>
            <div class="flex items-center justify-between"><span class="text-sm text-slate-500 dark:text-slate-400">解像度</span><span class="font-medium text-slate-800 dark:text-white">${info.video.width}x${info.video.height}</span></div>
            <div class="flex items-center justify-between"><span class="text-sm text-slate-500 dark:text-slate-400">FPS</span><span class="font-medium text-slate-800 dark:text-white">${info.video.framerate ? info.video.framerate.toFixed(2) : '不明'}</span></div>
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

    // Default to Custom mode
    const customPreset = document.querySelector('input[name="preset_mode"][value="custom"]');
    if (customPreset) {
        customPreset.checked = true;
        applyPreset('custom');
    }

    // Default resolution selection
    const maxRes = getMaxAllowedResolution();
    const resInput = document.querySelector(`input[name="resolution"][value="${maxRes}"]`);
    if (resInput) resInput.checked = true;

    updateEstimate();
}



// Helper function to format elapsed time
function formatElapsedTime(seconds) {
    if (seconds < 60) {
        return `${seconds.toFixed(0)}秒`;
    } else {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}分${secs}秒`;
    }
}
// Update elapsed time display
function updateElapsedTime() {
    if (!conversionStartTime) return;
    const elapsed = (Date.now() - conversionStartTime) / 1000;
    elapsedTimeDisplay.textContent = `経過時間: ${formatElapsedTime(elapsed)}`;
}

convertBtn.addEventListener('click', () => {
    if (!selectedFile) return;

    convertBtn.classList.add('hidden');
    cancelBtn.classList.remove('hidden'); // キャンセルボタンを表示
    document.getElementById('progress-container').classList.remove('hidden');
    settingsArea.classList.add('opacity-50', 'pointer-events-none');
    document.getElementById('progress-bar').style.width = '0%';
    document.getElementById('progress-text').textContent = "処理中: 0%";

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
    // Start elapsed time tracking
    conversionStartTime = Date.now();
    elapsedTimeDisplay.textContent = '経過時間: 0秒';
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
        document.getElementById('progress-text').textContent = `処理中: ${value}%`;
    } else if (type === 'complete') {
        // Stop timer and show completion time
        if (elapsedTimer) {
            clearInterval(elapsedTimer);
            elapsedTimer = null;
        }
        if (conversionStartTime) {
            const totalTime = (Date.now() - conversionStartTime) / 1000;
            elapsedTimeDisplay.textContent = `完了時間: ${formatElapsedTime(totalTime)}`;
        }

        document.getElementById('progress-text').textContent = "完了!";
        downloadFile(blob, outputExtension);
        setTimeout(() => {
            convertBtn.classList.remove('hidden');
            cancelBtn.classList.add('hidden');
            document.getElementById('progress-container').classList.add('hidden');
            settingsArea.classList.remove('opacity-50', 'pointer-events-none');
            convertBtn.textContent = "別のファイルを変換";
        }, 3000); // 3秒間完了時間を表示
    } else if (type === 'cancelled') {
        console.log("Transcoding cancelled by user");
        // Clean up timer
        if (elapsedTimer) {
            clearInterval(elapsedTimer);
            elapsedTimer = null;
        }
        conversionStartTime = null;
        elapsedTimeDisplay.textContent = '';

        convertBtn.classList.remove('hidden');
        cancelBtn.classList.add('hidden'); // キャンセルボタンを隠す
        document.getElementById('progress-container').classList.add('hidden');
        settingsArea.classList.remove('opacity-50', 'pointer-events-none');
        showAlert("変換がキャンセルされました");
    } else if (type === 'error') {
        // Clean up timer
        if (elapsedTimer) {
            clearInterval(elapsedTimer);
            elapsedTimer = null;
        }
        conversionStartTime = null;
        elapsedTimeDisplay.textContent = '';

        showAlert(error);
        console.error(error);
        convertBtn.classList.remove('hidden');
        cancelBtn.classList.add('hidden'); // キャンセルボタンを隠す
        document.getElementById('progress-container').classList.add('hidden');
        settingsArea.classList.remove('opacity-50', 'pointer-events-none');
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
