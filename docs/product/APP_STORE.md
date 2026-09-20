# Josh OS app store

The Josh OS app store is a signed application catalog and installer, not an
unrestricted executable download site. The first production target is the
Linux-backed Josh desktop; the Stage 0 live ISO may expose the catalog, but
installation is only durable when a writable system and user data volume exist.

## Runtime classes

### Linux applications

Use Flatpak bundles and remotes. Flatpak provides application isolation,
per-user installation, desktop-file integration, runtime sharing and update
transactions. Josh OS should own the catalog, trust policy and presentation,
while Flatpak remains the execution and sandbox layer.

### Windows applications

Use Wine-managed prefixes. A Windows entry must declare its installer source,
architecture, required Wine version, dependencies and known limitations. The
store must never imply that every Windows executable will work. Windows apps
are currently installed from a user-provided `.exe` in `Downloads` into an
isolated prefix. Generated desktop entries and verified remote Windows
artifacts remain follow-up work.

## Repository contract

Each repository publishes:

- `index.json`: repository identity, format version and signed catalog URL;
- `apps/<app-id>.json`: application metadata and release channels;
- `signatures/`: detached signatures for the index, manifests and artifacts;
- immutable artifact URLs with SHA-256 digests;
- a public signing key distributed by Josh OS or explicitly trusted by the user.

The current built-in Stage 0 catalog also ships with a SHA-256 sidecar and is
rejected if its bytes do not match. Publisher signatures and remote catalog
updates remain required before third-party repositories are enabled.

An app manifest contains at least:

```json
{
  "id": "org.example.App",
  "name": "Example App",
  "version": "1.0.0",
  "runtime": "flatpak",
  "architectures": ["x86_64"],
  "license": "MIT",
  "artifact": {
    "url": "https://repo.example/apps/org.example.App/1.0.0.flatpak",
    "sha256": "..."
  },
  "permissions": ["network"],
  "homepage": "https://example.org"
}
```

Windows manifests use `"runtime": "wine"` and additionally declare a
prefix identifier, installer checksum, Wine/Winetricks requirements and the
installer's supported silent-install arguments. Arbitrary URLs and shell
commands are not valid manifest fields.

## Installation boundary

The shell talks to a small privileged Josh app service over a local authenticated
IPC endpoint. The service:

1. verifies repository and artifact signatures;
2. downloads to a temporary location;
3. verifies the digest and architecture;
4. asks for explicit permission approval;
5. installs through Flatpak or the managed Wine runner;
6. refreshes the app registry and records an uninstall/update transaction.

The browser shell must not run `sudo`, `flatpak`, Wine, or downloaded
installers directly. Installation must be transactional and resumable, with
logs available to the user.

## Delivery phases

1. Define the manifest, signing and repository format.
2. Build a read-only Store app against a local catalog.
3. Add per-user Flatpak install/update/uninstall on the installed Linux system.
4. Add permissions, rollback and repository management.
5. Add generated desktop entries and verified remote Windows artifacts.
6. Add an installer and persistence volume before promising installation from
   the live ISO.

The first useful milestone is now implemented for the built-in catalog:
per-user Flatpak installation and launching, plus user-provided Windows
installers in isolated Wine prefixes. The next milestone is a signed remote
repository with generated desktop entries and update/rollback transactions.