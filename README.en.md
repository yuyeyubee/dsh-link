# DSH Link · Cross-device for DeepSeek Harness

> One private relay of your own connects **DeepSeek Harness (DSH)** installations on several computers and an **Android phone** into a private space that belongs only to you: browse and drive another computer's DSH Sessions from this one, let the local agent steer a remote DSH with tools, and use voice input on the phone while recognition stays on the target computer.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Plugin](https://img.shields.io/badge/plugin-1.2.2-brightgreen)
![Protocol](https://img.shields.io/badge/protocol-v1-blue)
![Android](https://img.shields.io/badge/Android-8.0%2B-3ddc84)

[中文](README.md) | **English**

![Remote Sessions in the DSH workspace](docs/images/link-sidebar-remote.png)

![Remote device badge in the native conversation](docs/images/link-chat.png)

## What you get

| Capability | What it does | Where |
| --- | --- | --- |
| **Mirrored remote workspaces** | Every online computer shows up under **Workspaces** as a `[Remote] <project> · <device>` group whose Session rows carry a **Remote** badge | Sidebar → Workspaces |
| **Native remote conversation** | Remote messages, tool calls/results and turn state render in the normal DSH chat; tool cards stay collapsed by default and remote replies stream token by token. Sending from the native composer forwards the prompt to that computer | Click a remote Session |
| **Cross-device manager** | One tab per computer (plus this one): search projects/Sessions, create Sessions, rename Sessions/projects, archive/unarchive, show archived, copy IDs, more actions | Sidebar → **Cross-device** |
| **Remote Session settings** | Session title, model, reasoning effort, Agent preset and archive; model/reasoning effort sync both ways with the local selector | Gear next to the remote Session title (or on the Session row) |
| **AI drives another computer** | 8 agent tools: list devices, list Sessions, read messages, create a Session, prompt and wait, cancel a turn, diagnostics | Just ask the AI in any DSH Session |
| **Streaming output switch** | When off, this computer no longer requests/forwards transient assistant chunks; each remote reply appears once, when committed. Per-computer display preference | Settings → Cross-device |
| **Android app** | One app for multiple computers: device switching, Session list/create/rename, send (queue/steer), stop, collapsible tool cards, dark/light, Chinese/English, foldable layout | `android/` |
| **Phone voice input** | Record on the phone → send to the selected computer → its local SenseVoice recognizer → **text returns to the phone's editable composer** | Mic button in the app |
| **No exposed ports** | Computers and the phone dial out to the relay; no public IP, port forwarding or VPN needed, and the relay forwards without storing conversation content | — |

## Architecture

```
┌──────────────────────┐        ┌──────────────────────┐
│ Computer A · DSH     │        │ Computer B · DSH     │
│  DSH Link plugin     │        │  DSH Link plugin     │
└──────────┬───────────┘        └──────────┬───────────┘
           │ WSS (outbound; no public IP)   │ WSS
           ▼                               ▼
      ┌─────────────────────────────────────────┐
      │ Your server · relay (TLS 8443)          │
      │ device directory + call/stream routing  │
      └────────────────────▲────────────────────┘
                           │ WSS
                    ┌──────┴───────┐
                    │ Android app  │
                    │ devices+voice│
                    └──────────────┘
```

| Component | Directory | Responsibility |
| --- | --- | --- |
| Plugin Host half | `plugin/index.js` | Pairing and token storage, relay client, remote RPC, local DSH adapters, agent tools, speech recognition, same-origin HTTP API |
| Plugin Web UI half | `plugin/client.js` | Cross-device manager, remote workspace decorations (badges, header chip, gear), settings page and the streaming switch |
| Relay | `relay/` | Public TLS WebSocket forwarding: online device directory only, no business data stored |
| Android app | `android/` | Kotlin + Jetpack Compose: multi-device Session control, voice round-trip, foldables |
| Protocol | `protocol/PROTOCOL.md` | The single contract for Host / Web UI / app / relay (v1) |
| Tools | `tools/` | `fake-host.mjs` simulates a remote computer, `probe-client.mjs` is a probe client |

## Repository layout

```
dsh-link/
├── plugin/      DSH bundle (Host + Web UI + locales + icon + unit tests)
├── relay/       relay server, deploy script, systemd unit, protocol tests
├── android/     Android app (Kotlin + Compose + foldables)
├── protocol/    v1 protocol specification
├── tools/       probe-client / fake-host development helpers
└── docs/        architecture, install, FAQ, screenshots
```

## Quick start

### 0. Requirements

- One Linux server with a public IP (Ubuntu 22.04 verified, 1 vCPU / 1 GB is enough; inbound 80 and 8443).
- One or more computers with **DSH Desktop 0.2.x** (0.2.1 / 0.2.2-rc.1 verified), macOS / Windows / Linux.
- An **Android 8.0+** phone (HarmonyOS devices can install the APK through their Android compatibility layer). iOS is not supported.

### 1. Deploy the relay (once, on the server)

The relay listens on **8443/TLS** with a Let's Encrypt certificate. No domain needed: use [sslip.io](https://sslip.io) to resolve `<server-ip>.sslip.io` to your address.

```bash
# on the server
apt-get update && apt-get install -y certbot
certbot certonly --standalone -d <server-ip>.sslip.io \
  --non-interactive --agree-tos --register-unsafely-without-email
git clone https://github.com/yuyeyubee/dsh-link.git /opt/dsh-link-src
cd /opt/dsh-link-src/relay
sudo ./deploy.sh        # install deps, generate token/pairing code, install systemd unit
# own domain: sudo DSHLINK_DOMAIN=relay.example.com ./deploy.sh
```

Afterwards:

- Service: `systemctl status dsh-link-relay` (Node.js ≥ 20 is required; `deploy.sh` checks it).
- Authoritative pairing code: `/opt/dsh-link/pairing.txt` (0600, contains the token — keep it secret).
- Public endpoint: `wss://<server-ip>.sslip.io:8443/`

> Certificate renewal, token rotation, ports/firewall and logs: see [relay/README.md](relay/README.md).

### 2. Install the plugin on every computer

```bash
git clone https://github.com/yuyeyubee/dsh-link.git
```

Install `dsh-link/plugin` as a **local bundle** in DSH (absolute path):

- ask the agent to call `plugin_manager` → `install_bundle`, or
- DSH Settings → Plugins → install a local bundle and pick that directory.

Refresh DSH afterwards (the desktop app usually applies it through HMR):

- **Cross-device** appears in the sidebar;
- **Settings → Cross-device** shows the pairing page;
- **Workspaces** gain `[Remote] …` groups while other computers are online.

> The plugin is installed as a `link:` bundle; do not move or delete the repository. If an update does not apply, toggle dsh-link off/on in Settings → Plugins or restart DSH; see [docs/faq.md](docs/faq.md).

### 3. Pair

1. Open **Settings → Cross-device**;
2. paste the whole `dshlink1.…` string from `/opt/dsh-link/pairing.txt`;
3. the device name is optional (defaults to the computer name and can be changed later);
4. click **Save pairing code**.

The page then shows **Connected**, this device, version, relay URL and the other online computers. Repeat on every computer.

> The same pairing code can be copied to the phone. It embeds the space token — treat it like a password and never paste it into public chats or commit it.

> **Auto-import**: on first start the plugin reads `~/.dsh/dsh-link/pairing.txt` when present, moves the token into the DSH credential store, and deletes the file — handy for batch or remote deployment.

### 4. Install the Android app

Download the APK from [Releases](https://github.com/yuyeyubee/dsh-link/releases) or build it yourself (`cd android && ./gradlew :app:assembleDebug`), then install it on the phone (allow "install unknown apps").

![Android app](docs/images/link-android.png)

Then:

1. Paste the **same** `dshlink1.…` pairing code (or expand "manual address and token" and enter `wss://` plus the token);
2. online computers appear as pills at the top; tap the one you want to drive;
3. browse Sessions, create, rename, send prompts (queue/steer), stop a running turn;
4. tap the mic → record → finish → wait for the selected computer to transcribe → text lands in the composer for review before sending.

> The app disables cleartext traffic (`usesCleartextTraffic=false`), so the relay must be `wss://`.

## Usage

### 1. Remote workspaces (native mirrors)

After pairing, **Workspaces** in the DSH sidebar looks like:

```
📁 [Remote] my-project · Home MacBook
   ├─ Session A        Remote
   └─ Session B        Remote
📁 [Remote] other · Home MacBook      ← Sessions without a project
📁 MyGitHub                           ← local project
```

- Group title format: `[Remote] <remote project> · <device>`; Sessions without a project go to `[Remote] other · <device>`.
- Remote Session rows carry a **Remote** badge; local rows do not.
- Click a remote Session to open it in the **native DSH conversation**: the header shows `Remote · <device>`, messages/tool calls/results/turns render natively, and tool calls collapse into native tool cards.
- Remote replies stream token by token while the remote turn generates; turn it off in **Settings → Cross-device → Streaming output** (below).
- Typing into the native composer forwards the prompt to that computer and appends the reply here; the local model is gated off, so it will not answer a second time.
- Each computer mirrors its **10 most recent** non-subagent Sessions (running ones are kept even beyond that), grouped by remote project. New remote Sessions appear within about 60 seconds and opening one immediately pulls the latest records.
- **When a computer goes offline its group is removed**, and rebuilt with the same mirror Session ids when it returns — no duplicates.
- **Creating a Session inside a remote group** creates the Session on that computer; its first prompt and every reply run there.
- **Archive syncs both ways**: archiving a remote Session here archives it there, and archiving there brings the mirror in line. Each mirror stores the direction the user asked for separately from the temporary state the plugin writes itself: rows hidden while the peer is offline are restored with that direction (including mirrors outside the recent-ten window), and a failed push is retried on the next pass, so an unarchive is never flipped back.
- **Model / reasoning effort sync both ways**: changing the local selector (or the remote-settings gear) reaches the computer that executes prompts within 5 seconds, and is pushed again right before a prompt is sent. Changes made there sync back to the mirror. Agent presets are controlled by the remote-settings gear.

### 2. Cross-device manager

Open **Cross-device** in the sidebar (or the gear inside the panel):

- **Tabs**: this computer plus every online computer; a connection dot shows relay state and the gear opens the settings sheet.
- **Search**: filter by project name, project path, Session title or cwd.
- **New Session**: create on the active device's tab, optionally choosing a project ("let the remote device choose" is available) and a title.
- **Session/project actions**: rename, archive/unarchive, copy Session ID / project ID, create a Session inside a project, and more actions.
- **Archived**: show/hide archived Sessions with a count, so they never mix into the normal list.
- **Pinned Sessions** sort first inside their group, following the target device's pinned order.
- **Refresh**: force-reload the target device's project and Session tree.

### 3. Remote Session settings (gear)

Use the gear next to a remote Session title (or on the manager's Session row) to change, remotely:

| Item | Notes |
| --- | --- |
| Session title | Rename the remote Session; the local mirror title follows |
| Model | Pick provider/model from the remote `model.catalog` |
| Reasoning effort | Options offered by the selected model |
| Agent preset | The remote plugin / Agent preset (same list as DSH presets) |
| Archive | Archive the remote Session and bring the mirror in line |

> With an older plugin on the other side you get "The plugin on the other computer is too old. Update it there to use model and preset settings."

### 4. Streaming output switch

**Settings → Cross-device → Streaming output** controls how remote replies are displayed:

- **On (default)**: replies stream token by token while the other computer generates them, in native mirror Sessions and in the plugin's own remote view.
- **Off**: this computer stops requesting/forwarding transient assistant chunks; each reply appears once, after it is committed. Open Sessions re-subscribe immediately.
- It is a **per-computer display preference**: it never changes other devices. Stored in this machine's `~/.dsh/dsh-link/config.json` under `streaming`, never written to the relay.

### 5. Let the AI drive another computer

Ask in any DSH Session ("what's on the travel laptop?", "let the home computer continue the tests") and the agent uses:

| Tool | Parameters | Purpose |
| --- | --- | --- |
| `link_status` | — | This device, relay state, version, online devices |
| `link_devices` | — | List other online computers |
| `link_sessions` | `device` | List Sessions on one computer (running state, cwd) |
| `link_read` | `device`, `session_id`, `max_messages`? | Read the latest messages of a remote Session (default 30, max 200) |
| `link_create` | `device`, `cwd`? | Create a Session on a remote computer and return its id |
| `link_prompt` | `device`, `session_id`, `text`, `wait_seconds`? | Prompt a remote Session, wait for the turn, return the newest assistant text (default 120 s, max 600 s) |
| `link_cancel` | `device`, `session_id` | Stop the active turn of a remote Session |
| `link_debug` | `what`, `session_id`?, `before_seq`?, `device`?, `title`? | Diagnostics: config, Session/title projections, workspaces, speech providers, mirror state, event streams |

`device` accepts either a peer id (`dev_…`) or the display name.

### 6. Android app

- **Connection**: paste the same pairing code; drops are retried with exponential backoff 1 s, 2 s, 4 s … up to 30 s (±20% jitter).
- **Computers**: switch targets from the pill list; the badge shows connecting/offline.
- **Sessions**: `+` creates one (workspace and `cwd` optional), `⋮` renames it; opening a Session subscribes with `session.follow` and merges `session.history` by `seq`.
- **Conversation**: user bubbles, DSH replies (collapsible reasoning), collapsible tool call/result cards with pretty-printed JSON args, turn separators and error cards. Sending can be **queue** or **steer**; a running turn can be stopped.
- **Voice**: mic → record (16 kHz mono PCM16, up to 60 s, with timer, level bar and cancel) → finish → the target computer transcribes → text is appended to the composer for editing, retry or cancel.
- **Foldables**: two panes at ≥ 720 dp or with a separating hinge; a vertical hinge splits left/right, a horizontal one stacks top/bottom, and the hinge area stays clear. Folding/rotating keeps the current device, Session and draft.
- **Theme/language**: follows system dark/light; Chinese (default) and English.

### 7. Voice path

```
phone recording (16 kHz mono PCM16) → standard WAV → base64
      → relay → target computer's DSH Link → local speechToText / SenseVoice
      → text → relay → phone composer (editable, never auto-sent)
```

- Recognition runs on the **target computer**; the phone downloads no model and audio never reaches a third-party cloud.
- Only standard 44-byte-header WAV is accepted (`fmt ` followed by `data`), decoded size ≤ 4 MiB.
- The first recognition may load the local model (the Host prepares it for up to 120 s).

## Settings and data

**Settings → Cross-device** contains:

- **Connection**: this device's name/ID, connection state, relay URL, plugin version;
- **Streaming output**: the per-computer display preference described above;
- **Pairing code**: paste/save the code, optional device name, disconnect and forget;
- **This device's pairing code**: copy it for another computer or the phone;
- **Online devices**: names, platforms and count of the other computers in the space;
- **Speech recognition**: whether the local provider is available, its phase and provider list;
- **Android pairing**: a hint to paste the same code in the app.

Local files:

| Path | Content | Mode |
| --- | --- | --- |
| `~/.dsh/dsh-link/config.json` | relay URL, device id/name, `streaming` and other non-secret config | 0600 |
| DSH credential store `dsh-link/token` | space token (the secret) | credential store |
| `~/.dsh/dsh-link/mirrors.json` | mirror map, archive direction, remote sequence | 0600 |
| `~/.dsh/dsh-link/mirrors/<deviceId>/` | mirror directories used as local workspace paths | 0700 |
| `~/.dsh/dsh-link/pairing.txt` | optional; auto-imported on first start and then deleted | 0600 |

The plugin never edits the profile's `cordis.patch.yml`; the settings page talks to the Host through a same-origin HTTP API.

## Security

- The only public surface is the relay on 8443 (TLS); computers and the phone dial out and expose no inbound ports.
- One space token is the whole permission set. If it leaks, rotate it and re-pair every device (see [relay/README.md](relay/README.md)).
- The token lives in the DSH credential store (`dsh-link/token`); config is 0600; the phone keeps it in app-private storage; the relay logs no request/response bodies.
- This is a personal tool: no multi-tenancy, roles, audit trail or sharing permissions.

## Known limits

- The relay keeps no offline queue: remote calls fail immediately when the target computer is not running DSH.
- Remote Sessions are **mirrors**: each computer mirrors its 10 most recent non-subagent Sessions (running ones kept); deleting a Session remotely does not remove the local mirror workspace entry.
- Mirrors reuse native DSH tool cards; attachments, approval prompts and the rest of the full DSH UI still require the target computer.
- Mirrors created before 1.1.0 keep the old text-style history; run `link_debug what=rebuild-mirrors` to rebuild them (old mirrors are archived, new ones replay remote history).
- Sending from the native composer uses "gate the local step, forward the prompt": the local turn ends blocked and the remote reply is appended afterwards; wait for a reply before sending again.
- Long text is truncated to keep frames bounded: user/assistant text 8 KiB, reasoning 4 KiB, tool args 4 KiB, tool results 2 KiB. The full content stays on the target computer.
- Protocol v1 makes no cross-version compatibility promise; keep plugin, relay and app on the same version (plugin 1.2.2 / protocol v1).
- The APK is a self-signed debug build; installing requires allowing unknown sources, and publishing to an app store needs release signing.

## Troubleshooting

See [docs/faq.md](docs/faq.md) for common questions, including:

- no **Cross-device** entry after installing the plugin;
- the settings page says **Connected** but no other computer appears;
- the remote computer goes offline or the version does not change after updating the plugin (restart DSH or toggle the plugin off/on);
- empty Session titles or an apparently empty remote workspace (`link_debug` first);
- speech recognition fails or returns empty text (check the target's speech provider).

## Development and verification

```bash
# Plugin Host half (pure Node tests, 29 cases)
cd plugin && node --test test/

# relay (protocol suite against the public WSS endpoint)
cd relay && npm install && node test-client.mjs
cd relay && node test-client.mjs --slow

# Android
cd android && ./gradlew :app:assembleDebug
cd android && ./gradlew :app:testDebugUnitTest

# Development helpers: a fake remote computer / a probe client
node tools/fake-host.mjs --pairing-file ~/.dsh/dsh-link/pairing-code.txt --name "Fake laptop"
node tools/probe-client.mjs --pairing-file ~/.dsh/dsh-link/pairing-code.txt --method device.info
```

Deeper design notes live in [docs/architecture.md](docs/architecture.md); installation and troubleshooting in [docs/install.md](docs/install.md) and [docs/faq.md](docs/faq.md); the wire contract in [protocol/PROTOCOL.md](protocol/PROTOCOL.md).

## Versions and compatibility

| Component | Version | Notes |
| --- | --- | --- |
| DSH Link plugin | 1.2.2 | Fixes offline restore and unarchive syncing: the archive direction is persisted as user intent and hidden mirrors come back intact; includes the streaming switch, cross-device manager and remote Session settings |
| Protocol | v1 | New fields are backwards compatible; new methods do not bump `v` |
| Relay | 1.0.0 (protocol v1) | Node.js ≥ 20, single `ws` dependency |
| Android app | 1.2.1 | minSdk 26 (Android 8.0+), protocol v1 (compatible with the 1.2.2 plugin) |

If the version does not change after updating the plugin, the Host half is still running the old module in memory: toggle dsh-link off/on in Settings → Plugins, or restart DSH.

## License

[MIT](LICENSE)
