# Product-track roadmap

Each stage should produce something testable rather than a pile of scaffolding.

## Stage 0 — shell prototype and live ISO

- [x] movable/resizable windows
- [x] focus, minimise and maximise
- [x] edge snapping with preview
- [x] dock, menu bar and clock
- [x] design token pipeline
- [x] light/dark themes, accent colours and wallpapers
- [x] notifications
- [x] About, Files, Terminal, Editor and Settings prototypes
- [x] ArchISO build pipeline
- [ ] **UN-20261024-155-0016** keyboard-driven window management
- [ ] **UN-20261024-155-0017** global launcher / command palette
- [ ] **UN-20261024-155-0018** tiling beyond halves
- [ ] **UN-20261024-155-0019** manual VirtualBox smoke test of the generated ISO

## Stage 1 — Josh OS 1.x: real desktop, Linux underneath

- [x] choose a Linux-backed compatibility path for the first usable product
- [ ] **UN-20261024-155-0024** spike both Smithay and wlroots before choosing
- [ ] **UN-20261024-155-0025** implement a Wayland compositor
- [ ] **UN-20261024-155-0026** port the shared window model
- [ ] **UN-20261024-155-0027** real panel, dock, launcher and notification surfaces
- [ ] **UN-20261024-155-0028** Settings backed by real system services
- [ ] **UN-20261024-155-0029** installer
- [ ] **UN-20261024-155-0030** signed app repository and Flatpak application packaging/update story
- [ ] **UN-20261024-155-0031** Wine-managed Windows application compatibility layer
- [ ] **UN-20261024-155-0032** accessibility and keyboard-navigation pass

## Stage 2 — own more userland where it helps

- [ ] **UN-20261024-155-0036** Josh file-service/API model
- [ ] **UN-20261024-155-0037** Josh session/device concepts
- [ ] **UN-20261024-155-0038** Josh application manifest/capability model
- [ ] **UN-20261024-155-0039** stable app-facing APIs insulated from Linux implementation details

## Stage 3 — converge with the native Josh kernel

The independent kernel already boots and produces its own ISO. The long-term
goal is to make Josh applications, window concepts and system APIs portable
enough to run there as the kernel gains processes, filesystems, drivers and
services.

The kernel track is real engineering, but the usable desktop does not wait for
it to reinvent every modern PC driver.
