# Windows Build

## Installed prerequisites

- Rust MSVC toolchain through rustup.
- Visual Studio 2022 Build Tools with the desktop C++ workload.
- Tauri 2 CLI as a project development dependency.

## Build

Run from a Visual Studio x64 developer command prompt:

```powershell
npm run desktop:build
```

The build creates the desktop executable and an NSIS installer. The installer is unsigned during development. No build command deploys, uploads, pushes, or connects to Dropbox.

## Desktop network boundary

The Rust command accepts only:

- HTTPS URLs ending in `/mcp`.
- Local development URLs on `127.0.0.1`, `localhost`, or `::1`, also ending in `/mcp`.

The desktop layer exposes no general filesystem command and no direct Dropbox operation.
