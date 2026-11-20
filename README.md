# Threat Detector (Tauri)

Offline desktop threat inspection for suspicious URLs, messages and CSV batches.
The Rust core (`crates/threat-core`) validates and scores input; the Tauri v2 shell
serves the HTML front-end in `src/` and exposes the IPC bridge. Nothing is ever
fetched or opened: the backend inspects strings and structure only.

This is the Tauri/Rust edition. Two sibling projects use the same front-end with a
Java backend: `threat-detector-java-webkit` (JavaFX WebKit) and
`threat-detector-java-jcef` (JavaFX + Chromium via JCEF).

## Download

Windows x64 installer:
[ThreatDetector-Tauri-x64-Setup.exe](https://github.com/Jad-m40tg/threat-detector-tauri/releases/latest/download/ThreatDetector-Tauri-x64-Setup.exe)

The installer is unsigned, so Windows SmartScreen shows "Unknown publisher".
Click **More info**, then **Run anyway**. Windows 10/11 with the WebView2 runtime
is required (preinstalled on current systems; the installer can bootstrap it).

## Requirements

- Windows 10/11 x64
- Rust stable with the MSVC toolchain, and Tauri CLI 2 (`cargo install tauri-cli --version "^2"`)

## Build and run from source

```bat
cargo tauri dev
cargo tauri build --bundles nsis
```

The installer is written to `src-tauri\target\release\bundle\nsis\`.

## Tests

```bat
cargo test
```

The core crate holds the rule, parser and scoring tests, including the
differential goldens shared with the Java port.

## License

MIT, see `LICENSE`.
