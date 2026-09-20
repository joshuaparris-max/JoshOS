#!/usr/bin/env python3
import hashlib
import hmac
import json
import os
import shlex
import shutil
import subprocess
try:
    import pwd
except ImportError:
    pwd = None
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HOST = "127.0.0.1"
PORT = 8765
SHELL_ROOT = "/opt/josh-os/shell"
APP_CATALOG = "/opt/josh-os/app-store/catalog.json"
APP_CATALOG_DIGEST = "/opt/josh-os/app-store/catalog.sha256"
APP_USER = "josh"


def run(args, *, input_text=None, timeout=20):
    try:
        result = subprocess.run(
            args,
            input=input_text,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 127, "", str(exc)


def split_nmcli(line):
    fields, current, escaped = [], [], False
    for ch in line:
        if escaped:
            current.append(ch)
            escaped = False
        elif ch == "\\":
            escaped = True
        elif ch == ":":
            fields.append("".join(current))
            current = []
        else:
            current.append(ch)
    fields.append("".join(current))
    return fields


def wifi_device():
    code, out, _ = run(["nmcli", "-t", "-e", "yes", "-f", "DEVICE,TYPE", "device", "status"])
    if code != 0:
        return None
    for line in out.splitlines():
        fields = split_nmcli(line)
        if len(fields) >= 2 and fields[1] == "wifi":
            return fields[0]
    return None


def network_status():
    _, state, _ = run(["nmcli", "-t", "-f", "STATE", "general"])
    _, connectivity, _ = run(["nmcli", "-t", "-f", "CONNECTIVITY", "general"])
    _, radio, _ = run(["nmcli", "-t", "-f", "WIFI", "radio"])
    device = wifi_device()

    wifi_state = "unavailable"
    connection = ""
    if device:
        _, detail, _ = run(
            ["nmcli", "-t", "-e", "yes", "-f", "GENERAL.STATE,GENERAL.CONNECTION", "device", "show", device]
        )
        values = {}
        for line in detail.splitlines():
            fields = split_nmcli(line)
            if len(fields) >= 2:
                values[fields[0]] = ":".join(fields[1:])
        wifi_state = values.get("GENERAL.STATE", "unknown")
        connection = values.get("GENERAL.CONNECTION", "")

    _, addresses, _ = run(["ip", "-j", "address", "show"])
    _, routes, _ = run(["ip", "-j", "route", "show", "default"])
    try:
        address_json = json.loads(addresses or "[]")
    except json.JSONDecodeError:
        address_json = []
    try:
        route_json = json.loads(routes or "[]")
    except json.JSONDecodeError:
        route_json = []

    return {
        "state": state or "unknown",
        "connectivity": connectivity or "unknown",
        "wifi_radio": radio or "unknown",
        "wifi_device": device,
        "wifi_state": wifi_state,
        "connection": connection if connection != "--" else "",
        "addresses": address_json,
        "default_routes": route_json,
    }


def wifi_scan(rescan=True):
    device = wifi_device()
    if not device:
        return []
    args = [
        "nmcli", "-t", "-e", "yes",
        "-f", "IN-USE,SSID,SECURITY,SIGNAL",
        "device", "wifi", "list", "ifname", device,
    ]
    if rescan:
        args += ["--rescan", "yes"]
    code, out, _ = run(args, timeout=30)
    if code != 0:
        return []

    rows = []
    seen = set()
    for line in out.splitlines():
        fields = split_nmcli(line)
        if len(fields) != 4:
            continue
        active, ssid, security, signal = fields
        if not ssid or ssid in seen:
            continue
        seen.add(ssid)
        try:
            signal_value = int(signal)
        except ValueError:
            signal_value = 0
        rows.append({
            "ssid": ssid,
            "security": security or "Open",
            "signal": signal_value,
            "active": active == "*",
        })
    rows.sort(key=lambda row: (not row["active"], -row["signal"], row["ssid"].lower()))
    return rows


def connect_wifi(payload):
    ssid = str(payload.get("ssid", "")).strip()
    password = str(payload.get("password", ""))
    if not ssid or len(ssid.encode("utf-8")) > 32:
        return False, "Invalid Wi-Fi network name."

    device = wifi_device()
    if not device:
        return False, "No Wi-Fi adapter detected."

    run(["nmcli", "radio", "wifi", "on"])
    args = ["nmcli", "--ask", "device", "wifi", "connect", ssid, "ifname", device]
    input_text = (password + "\n") if password else "\n"
    code, out, err = run(args, input_text=input_text, timeout=45)
    if code != 0:
        return False, err or out or "NetworkManager could not connect."

    # Make successful profiles resilient. Zero means retry forever.
    run(["nmcli", "connection", "modify", ssid, "connection.autoconnect", "yes",
         "connection.autoconnect-retries", "0"])
    return True, out or "Connected."


def disconnect_wifi():
    device = wifi_device()
    if not device:
        return False, "No Wi-Fi adapter detected."
    code, out, err = run(["nmcli", "device", "disconnect", device])
    return code == 0, out if code == 0 else (err or out or "Disconnect failed.")


def app_catalog():
    try:
        with open(APP_CATALOG, "rb") as catalog_file:
            catalog_bytes = catalog_file.read()
        with open(APP_CATALOG_DIGEST, encoding="utf-8") as digest_file:
            expected = digest_file.read().strip().split()[0]
        actual = hashlib.sha256(catalog_bytes).hexdigest()
        if not expected or not hmac.compare_digest(expected, actual):
            return {"format": 1, "apps": [], "trusted": False}
        payload = json.loads(catalog_bytes.decode("utf-8"))
        return payload if isinstance(payload.get("apps"), list) else {"format": 1, "apps": [], "trusted": False}
    except (OSError, IndexError, UnicodeDecodeError, json.JSONDecodeError):
        return {"format": 1, "apps": [], "trusted": False}


def app_record(app_id):
    return next((app for app in app_catalog()["apps"] if app.get("id") == app_id), None)


def run_as_app_user(args, timeout=600, extra_env=None):
    environment = ["HOME=/home/josh", "XDG_RUNTIME_DIR=/run/user/1000"]
    environment.extend(extra_env or [])
    return run(
        ["runuser", "-u", APP_USER, "--", "env"] + environment + args,
        timeout=timeout,
    )


def install_app(app_id):
    app = app_record(app_id)
    if not app:
        return False, "That app is not in the Josh OS catalog."
    if app.get("runtime") == "wine":
        return install_windows_app(app, app_id)
    if app.get("runtime") != "flatpak" or app.get("installable") is False:
        return False, app.get("reason", "This app cannot be installed on this Josh OS release.")
    remote = app.get("remote")
    ref = app.get("ref")
    if not remote or not ref or not all(isinstance(value, str) for value in (remote, ref)):
        return False, "The app manifest is incomplete."
    remote_code, _, remote_err = run_as_app_user([
        "flatpak", "remote-add", "--user", "--if-not-exists", "flathub",
        "https://dl.flathub.org/repo/flathub.flatpakrepo"
    ], timeout=60)
    if remote_code != 0:
        return False, remote_err or "Could not configure the Flatpak application remote."
    code, out, err = run_as_app_user(
        ["flatpak", "install", "--user", "--noninteractive", remote, ref]
    )
    return code == 0, out if code == 0 else (err or out or "Installation failed.")


def wine_prefix(app_id):
    safe_id = "".join(character if character.isalnum() else "_" for character in app_id)
    return "/home/josh/.local/share/josh-os/wine/" + safe_id


def wine_marker(app_id):
    return wine_prefix(app_id) + "/.josh-installed"


def wine_launcher(app_id):
    safe_id = "".join(character if character.isalnum() else "_" for character in app_id)
    return "/home/josh/.local/bin/joshos-wine-" + safe_id


def install_windows_app(app, app_id, installer_name=None, executable_name=None):
    if app.get("installable") is False or app.get("installerSource") != "downloads":
        return False, app.get("reason", "This Windows app cannot be installed here.")
    if installer_name is None:
        return False, "Choose a Windows .exe installer from Downloads."
    if not isinstance(installer_name, str) or os.path.basename(installer_name) != installer_name:
        return False, "The installer must be a file name from Downloads."
    if not installer_name.lower().endswith(".exe"):
        return False, "The Windows installer must use the .exe format."
    installer = "/home/josh/Downloads/" + installer_name
    if not os.path.isfile(installer):
        return False, "That installer was not found in Downloads."
    prefix = wine_prefix(app_id)
    environment = [
        "WINEPREFIX=" + prefix,
        "WINEARCH=win64",
        "DISPLAY=:0",
        "XAUTHORITY=/home/josh/.Xauthority",
        "WINEDEBUG=-all",
    ]
    code, _, err = run_as_app_user(["wineboot", "--init"], timeout=120, extra_env=environment)
    if code != 0:
        return False, err or "Wine could not create the application prefix."
    code, out, err = run_as_app_user(["wine", installer], timeout=900, extra_env=environment)
    if code != 0:
        return False, err or out or "The Windows installer failed."
    if not isinstance(executable_name, str) or not executable_name or executable_name.startswith(("/", "\\")):
        return False, "Enter the installed Windows executable path relative to Program Files."
    executable_name = executable_name.replace("\\", "/")
    if ".." in executable_name.split("/") or not executable_name.lower().endswith(".exe"):
        return False, "The executable path must be a relative .exe path without parent traversal."
    prefix_root = os.path.realpath(os.path.join(prefix, "drive_c"))
    executable = os.path.realpath(os.path.join(prefix_root, *executable_name.split("/")))
    if not executable.startswith(prefix_root + os.sep) or not os.path.isfile(executable):
        return False, "That executable was not found inside the Wine prefix."
    if pwd is None:
        return False, "Windows app installation is only available inside Josh OS."
    launcher = wine_launcher(app_id)
    os.makedirs(os.path.dirname(launcher), mode=0o755, exist_ok=True)
    with open(launcher, "w", encoding="utf-8") as launcher_file:
        launcher_file.write("#!/bin/sh\n")
        launcher_file.write("export WINEPREFIX=" + shlex.quote(prefix) + "\n")
        launcher_file.write("exec wine " + shlex.quote(executable) + "\n")
    os.chmod(launcher, 0o755)
    user = pwd.getpwnam(APP_USER)
    os.chown(launcher, user.pw_uid, user.pw_gid)
    code, _, err = run_as_app_user(["touch", wine_marker(app_id)], timeout=20, extra_env=environment)
    return code == 0, "Windows app installed in its isolated Wine prefix." if code == 0 else (err or "Could not record the installation.")


def uninstall_app(app_id):
    app = app_record(app_id)
    if not app:
        return False, "That app cannot be removed by Josh OS."
    if app.get("runtime") == "wine":
        if not os.path.isdir(wine_prefix(app_id)):
            return False, "That Windows app is not installed."
        code, _, err = run_as_app_user(["rm", "-rf", wine_prefix(app_id)], timeout=120)
        try:
            os.remove(wine_launcher(app_id))
        except FileNotFoundError:
            pass
        return code == 0, "Windows app removed." if code == 0 else (err or "Removal failed.")
    if app.get("runtime") != "flatpak" or not app.get("ref"):
        return False, "That app cannot be removed by Josh OS."
    code, out, err = run_as_app_user(
        ["flatpak", "uninstall", "--user", "--noninteractive", app["ref"]]
    )
    return code == 0, out if code == 0 else (err or out or "Removal failed.")


def launch_app(app_id):
    app = app_record(app_id)
    if not app:
        return False, "This app does not have a managed launcher yet."
    if app.get("runtime") == "wine":
        if not os.path.isfile(wine_launcher(app_id)):
            return False, "Install the Windows app before launching it."
        command = ["runuser", "-u", APP_USER, "--", wine_launcher(app_id)]
        try:
            subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True)
        except OSError as exc:
            return False, "Could not launch the app: " + str(exc)
        return True, app["name"] + " is launching."
    if app.get("runtime") != "flatpak" or not app.get("ref"):
        return False, "This app does not have a managed launcher yet."
    if app["ref"] not in installed_app_ids():
        return False, "Install the app before launching it."
    command = [
        "runuser", "-u", APP_USER, "--", "env",
        "HOME=/home/josh", "XDG_RUNTIME_DIR=/run/user/1000",
        "DISPLAY=:0", "XAUTHORITY=/home/josh/.Xauthority",
        "flatpak", "run", app["ref"],
    ]
    try:
        subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
    except OSError as exc:
        return False, "Could not launch the app: " + str(exc)
    return True, app["name"] + " is launching."


def installed_app_ids():
    code, out, _ = run_as_app_user(
        ["flatpak", "list", "--user", "--app", "--columns=application"]
    )
    if code != 0:
        return set()
    installed = {line.strip() for line in out.splitlines() if line.strip()}
    for app in app_catalog()["apps"]:
        if app.get("runtime") == "wine" and os.path.isfile(wine_marker(app.get("id", ""))):
            installed.add(app["id"])
    return installed


def exec_terminal(command, cwd=None, shell_type="bash"):
    user_home = "/home/josh" if os.path.isdir("/home/josh") else os.path.expanduser("~")
    if not cwd or not os.path.isdir(cwd):
        cwd = user_home

    raw = command.strip()
    if not raw:
        return {"ok": True, "stdout": "", "stderr": "", "returncode": 0, "cwd": cwd}

    # Handle directory navigation (cd / Set-Location)
    if raw == "cd" or raw.startswith("cd ") or raw.startswith("Set-Location ") or raw == "Set-Location":
        target = ""
        if raw.startswith("Set-Location "):
            target = raw[13:].strip()
        elif raw.startswith("cd "):
            target = raw[3:].strip()

        target = target.strip("'\"")
        if not target or target == "~":
            target = user_home
        elif target.startswith("~/"):
            target = os.path.join(user_home, target[2:])
        elif not os.path.isabs(target):
            target = os.path.normpath(os.path.join(cwd, target))

        if os.path.isdir(target):
            return {"ok": True, "stdout": "", "stderr": "", "returncode": 0, "cwd": target}
        else:
            return {"ok": False, "stdout": "", "stderr": f"cd: no such file or directory: {target}", "returncode": 1, "cwd": cwd}

    # Common PowerShell alias mappings for compatibility
    if shell_type == "powershell":
        ps_map = {
            "gci": "ls -la", "get-childitem": "ls -la", "dir": "ls -la",
            "gps": "ps aux", "get-process": "ps aux",
            "gl": "pwd", "get-location": "pwd",
            "cls": "clear", "clear-host": "clear",
            "get-date": "date",
            "get-content": "cat", "gc": "cat",
            "select-string": "grep", "sls": "grep",
            "copy-item": "cp", "cpi": "cp",
            "move-item": "mv", "mi": "mv",
            "remove-item": "rm", "ri": "rm",
        }
        parts = raw.split(maxsplit=1)
        lower_cmd = parts[0].lower()
        if lower_cmd in ps_map:
            args = parts[1] if len(parts) > 1 else ""
            raw = f"{ps_map[lower_cmd]} {args}".strip()

    has_pwsh = shutil.which("pwsh") is not None
    if shell_type == "powershell" and has_pwsh and not raw.startswith(("ls", "clear", "pwd")):
        cmd_to_run = f"cd {shlex.quote(cwd)} && pwsh -NoLogo -NonInteractive -Command {shlex.quote(raw)}"
    else:
        cmd_to_run = f"cd {shlex.quote(cwd)} && {raw}"

    environment = [
        f"HOME={user_home}",
        f"PWD={cwd}",
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        "DISPLAY=:0",
        "XAUTHORITY=/home/josh/.Xauthority",
        "TERM=xterm-256color",
        "LANG=en_US.UTF-8",
    ]

    try:
        proc = subprocess.run(
            ["runuser", "-u", APP_USER, "--", "env"] + environment + ["bash", "-c", cmd_to_run],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return {
            "ok": proc.returncode == 0,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "returncode": proc.returncode,
            "cwd": cwd,
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "stdout": "", "stderr": "Command timed out after 30 seconds.", "returncode": 124, "cwd": cwd}
    except Exception as exc:
        return {"ok": False, "stdout": "", "stderr": str(exc), "returncode": 1, "cwd": cwd}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SHELL_ROOT, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def send_json(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > 4096:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {}

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json(200, {"ok": True})
        elif path == "/api/apps/catalog":
            payload = app_catalog()
            if not payload.get("trusted", True):
                self.send_json(503, {"ok": False, "message": "The Josh OS app catalog failed integrity verification."})
                return
            installed = installed_app_ids()
            payload["apps"] = [dict(app, installed=(app.get("ref") if app.get("runtime") == "flatpak" else app.get("id")) in installed)
                                for app in payload["apps"]]
            self.send_json(200, payload)
        elif path == "/api/network/status":
            self.send_json(200, network_status())
        elif path == "/api/network/wifi":
            self.send_json(200, {"networks": wifi_scan(True)})
        else:
            super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        payload = self.read_json()
        if path == "/api/apps/install":
            app_id = str(payload.get("id", ""))
            app = app_record(app_id)
            if app and app.get("runtime") == "wine":
                ok, message = install_windows_app(app, app_id, payload.get("filename"), payload.get("executable"))
            else:
                ok, message = install_app(app_id)
            self.send_json(200 if ok else 400, {"ok": ok, "message": message})
        elif path == "/api/apps/launch":
            ok, message = launch_app(str(payload.get("id", "")))
            self.send_json(200 if ok else 400, {"ok": ok, "message": message})
        elif path == "/api/apps/uninstall":
            ok, message = uninstall_app(str(payload.get("id", "")))
            self.send_json(200 if ok else 400, {"ok": ok, "message": message})
        elif path == "/api/network/connect":
            ok, message = connect_wifi(payload)
            self.send_json(200 if ok else 400, {"ok": ok, "message": message})
        elif path == "/api/network/disconnect":
            ok, message = disconnect_wifi()
            self.send_json(200 if ok else 400, {"ok": ok, "message": message})
        elif path == "/api/network/wifi-radio":
            enabled = bool(payload.get("enabled", True))
            code, out, err = run(["nmcli", "radio", "wifi", "on" if enabled else "off"])
            ok = code == 0
            self.send_json(200 if ok else 400, {"ok": ok, "message": out if ok else err})
        elif path == "/api/terminal/exec":
            cmd = str(payload.get("command", ""))
            cwd = payload.get("cwd") or "/home/josh"
            shell_type = str(payload.get("shell", "bash"))
            result = exec_terminal(cmd, cwd=cwd, shell_type=shell_type)
            self.send_json(200, result)
        else:
            self.send_json(404, {"ok": False, "message": "Unknown API endpoint."})


if __name__ == "__main__":
    os.chdir(SHELL_ROOT)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()
