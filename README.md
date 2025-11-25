# WebCodec Transcoder

A high-performance video transcoder that runs entirely in your browser. Built with the MediaBunny library, it enables easy format conversion, codec switching, and bitrate adjustment for video files.

## Features

### 🎬 Supported Formats
- **Input**: MP4, MOV, WebM
- **Output**: MP4, WebM

### 🎨 Modern UI
- Responsive design
- Dark mode support
- Drag & drop file selection
- Real-time progress display

### ⚡ Key Features

#### Video Conversion
- **Codec Selection**
  - H.264 (AVC)
  - H.265 (HEVC) - supported environments only
  - AV1
- **Bitrate Adjustment**: 0.1Mbps to 2.0Mbps
- **Passthrough Mode**: Maintain original bitrate

#### Audio Conversion
- **Codec Selection**
  - AAC
  - Opus
- **Bitrate Adjustment**: 32kbps to 128kbps
- **Audio-Only Extraction**: Extract audio track from video

#### Additional Features
- **File Size Estimation**: Preview estimated output size before conversion
- **Video Information Display**: View original codec, bitrate, resolution, etc.
- **Elapsed Time Display**: Real-time conversion progress tracking
- **Cancellation Support**: Stop conversion at any time

## Usage

### 1. Select File
- Click the "選択" (Select) button or drag & drop a file

### 2. Configure Conversion Settings
- **Output Format**: Choose MP4 or WebM
- **Audio-Only Extraction**: Toggle ON to hide video settings and extract audio only
- **Video Settings**: Select codec and bitrate
- **Audio Settings**: Select codec and bitrate

### 3. Start Conversion
- Click the "変換開始" (Start Conversion) button
- Monitor progress via the progress bar
- File will automatically download upon completion

## Performance Optimization

This transcoder is built on WebCodecs and MediaBunny for maximum performance. Key optimizations include:

- **Hardware Acceleration**: Automatic GPU utilization for encoding/decoding
- **Passthrough Mode**: Ultra-fast stream copying when bitrate is set to "maintain"
- **Zero-Copy Transfer**: Efficient memory management between workers
- **Smart Codec Selection**: H.264 for speed, AV1 for compression

**📖 For detailed performance tips and codec selection guidelines, see [Performance Guide](performance-guide.md)**

### Speed Expectations
- **Passthrough Mode**: 10-30 seconds for any file (container remux only)
- **H.264 Transcoding**: 2-4x realtime on 1080p with hardware acceleration
- **H.265/AV1**: Slower but better compression (see guide for details)

## Technical Specifications

### Libraries Used
- **MediaBunny**: Core video processing library
- **Tailwind CSS**: Styling framework
- **Material Symbols**: Icon set
- **Space Grotesk**: Typography

### Browser Requirements
- Chrome 94+ (recommended)
- Edge 94+ (recommended)
- Safari and Firefox may have limited functionality

### Architecture
```
index.html          # Main UI
├── js/
│   ├── ui.js       # UI control and event handling
│   └── worker.js   # Video processing worker (MediaBunny)
```

## Development

### File Structure
```
WebCodec/
├── index.html           # Main HTML
├── js/
│   ├── ui.js           # UI logic
│   └── worker.js       # Conversion processing
├── SPEC.md             # Specifications
├── README.md           # This file (English)
└── README.ja.md        # Japanese version
```

### Implementation Details

#### Audio-Only Extraction
The `ui.js` monitors the state of `audio-only-toggle`, hiding `video-settings-section` when enabled. The `worker.js` receives the `audioOnly` flag and filters video tracks during MediaBunny input processing.

#### Bitrate Passthrough
Setting the slider to maximum value enables "passthrough mode," which maintains the original bitrate.

#### File Size Estimation
Calculates estimated size based on video duration, selected bitrate, and codec compression ratio.

## License

This project is open source.

## Notes

- Processing is done in the browser, so large files may take considerable time
- H.265 encoding is only supported in certain browsers
- Files are processed locally and never uploaded to a server
