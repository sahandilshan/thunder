![ThunderID NPX](https://raw.githubusercontent.com/thunder-id/thunderid/refs/heads/main/docs/static/assets/images/readme/repo-banner-npx-thunderid.png)

Run ThunderID instantly — no manual download or setup required.

## Quick Start

```bash
npx thunderid
```

On first run this downloads the latest ThunderID release, initializes the platform, and starts it. Later runs reuse
the cached installation and start immediately.

## Options

| Option      | Description                                                              |
| ----------- | ------------------------------------------------------------------------ |
| `--setup`   | Re-run setup even if ThunderID is already installed                      |
| `-- <args>` | Forward arguments directly to ThunderID (e.g. `npx thunderid -- --help`) |

## Requirements

- **Node.js** `>= 18`
- **macOS / Linux:** `unzip` in `PATH`
- **Windows:** `tar` in `PATH` and a Unix-like shell (WSL or Git Bash)

## Supported Platforms

| OS      | Architectures               |
| ------- | --------------------------- |
| macOS   | `x64`, `arm64`              |
| Linux   | `x64`, `arm64`              |
| Windows | `x64` (via WSL or Git Bash) |

## About

- **npm:** [`thunderid`](https://www.npmjs.com/package/thunderid)
- **source:** <https://github.com/thunder-id/thunderid>
- **docs:** <https://thunderid.dev>

## License

[Apache License 2.0](https://github.com/thunder-id/thunderid/blob/main/LICENSE)
