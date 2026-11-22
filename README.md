# UFI-Proxy-Studio

Unified **Clash for UFI** plugin (`v2.0.0`) + LAN-only **Pro Debug HTTP API** (`port 17789`) for ZTE U30 Air (`UFI-TOOLS`).

## Highlights

- **Unified Plugin**: Merges the old standalone `UFI Proxy Console` card into `Clash for UFI`, removing brittle PID-file conflicts (`console.pid` reuse after reboot).
- **Streamlined UI + Zashboard**: Keeps `Clash.Core` lifecycle controls, embedded Zashboard (`7788/ui/`), working **`热刷新订阅`**, **`⚙️ 参数设置`**, and a collapsible **`🛠️ 维护与调试`** drawer.
- **One-Click Self-Update (`🔄 更新插件`)**: Fetches `manifest.json` from `lack9921/UFI-Proxy-Studio`, verifies SHA-256 + structural sentinels, backs up the old plugin block to `localStorage`, and atomically replaces only the `Clash for UFI` block via `/api/set_custom_head` (`dist/clash-for-ufi.js`).
- **LAN-Only Pro Debug HTTP API (`127.0.0.1:17789` & `192.168.0.1:17789`)**:
  - Bearer token auth (`/data/clash/debug/api.token`, 5 failed attempts -> 60s lockout)
  - Read endpoints: `GET /v1/health`, `GET /v1/overview`, `GET /v1/network`, `GET /v1/mihomo/summary`, `GET /v1/config/meta`, `GET /v1/logs?target=clash|config_test|audit&lines=100`
  - Controlled action endpoints: `POST /v1/config/check`, `POST /v1/subscription/refresh`, `POST /v1/service/{start|stop|restart|reload}`, `POST /v1/probe/latency`, `POST /v1/mihomo/select`
