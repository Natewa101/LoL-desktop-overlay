import base64
import logging
import os
import string
import subprocess
from pathlib import Path
from typing import Dict, Iterator, Optional

logger = logging.getLogger(__name__)

# Standard Windows install path for the League client lockfile, kept as a
# last-resort default. The lockfile only exists while the client is running.
DEFAULT_LOCKFILE_PATH = Path(r"C:\Riot Games\League of Legends\lockfile")

# The lockfile always lives in the League install directory under this name.
LOCKFILE_NAME = "lockfile"

# The two client processes that own the lockfile.
PROCESS_NAMES = ("LeagueClientUx.exe", "LeagueClient.exe")

# Common install sub-paths, scanned per drive letter as a fallback when process
# inspection is unavailable.
COMMON_SUBPATHS = (
    r"Riot Games\League of Legends",
    r"Program Files\Riot Games\League of Legends",
    r"Program Files (x86)\Riot Games\League of Legends",
)

# Prevent a console window from flashing when we shell out on Windows (the app
# is packaged with --noconsole, so any popped window would be a visible glitch).
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _install_dir_from_args(args) -> Optional[Path]:
    """Extract the --install-directory value from a list of cmdline args."""
    for arg in args:
        if isinstance(arg, str) and arg.startswith("--install-directory="):
            value = arg.split("=", 1)[1].strip().strip('"')
            if value:
                return Path(value)
    return None


def _iter_dirs_via_psutil() -> Iterator[Path]:
    """Yield candidate install dirs by inspecting running processes with psutil.

    psutil is an optional dependency; if it isn't installed we simply yield
    nothing and let the other strategies take over.
    """
    try:
        import psutil  # optional; import lazily so it's never a hard requirement
    except ImportError:
        return

    try:
        procs = psutil.process_iter(["name", "exe", "cmdline"])
    except Exception as err:  # noqa: BLE001 - psutil can raise assorted OS errors
        logger.debug("psutil process_iter failed: %s", err)
        return

    for proc in procs:
        try:
            name = (proc.info.get("name") or "")
            if name not in PROCESS_NAMES:
                continue

            # Primary: the --install-directory launch argument.
            install_dir = _install_dir_from_args(proc.info.get("cmdline") or [])
            if install_dir:
                yield install_dir

            # Secondary: the directory containing the client executable itself.
            exe = proc.info.get("exe")
            if exe:
                yield Path(exe).parent
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
        except Exception as err:  # noqa: BLE001 - never let one bad proc abort the scan
            logger.debug("Skipping process during psutil scan: %s", err)
            continue


def _run_capture(cmd) -> Optional[str]:
    """Run a command and return stdout, or None on any failure."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=_NO_WINDOW,
        )
        return result.stdout
    except (FileNotFoundError, PermissionError, subprocess.SubprocessError, OSError) as err:
        logger.debug("Command %s failed: %s", cmd[0] if cmd else "?", err)
        return None


def _iter_dirs_via_wmic() -> Iterator[Path]:
    """Yield candidate install dirs using the legacy `wmic` tool."""
    for name in PROCESS_NAMES:
        out = _run_capture(
            [
                "wmic",
                "process",
                "where",
                f"name='{name}'",
                "get",
                "ExecutablePath,CommandLine",
                "/format:list",
            ]
        )
        if not out:
            continue
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("ExecutablePath=") and len(line) > len("ExecutablePath="):
                exe = line.split("=", 1)[1].strip()
                if exe:
                    yield Path(exe).parent
            elif line.startswith("CommandLine=") and "--install-directory=" in line:
                # Parse the (possibly quoted) install-directory value.
                after = line.split("--install-directory=", 1)[1]
                after = after[1:] if after.startswith('"') else after
                # Value ends at the next quote (quoted) or the next flag.
                end = after.find('"')
                value = (after[:end] if end != -1 else after.split(" --", 1)[0]).strip()
                if value:
                    yield Path(value)


def _iter_dirs_via_powershell() -> Iterator[Path]:
    """Yield candidate install dirs using PowerShell CIM (wmic replacement)."""
    name_filter = " or ".join(f"name='{n}'" for n in PROCESS_NAMES)
    out = _run_capture(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            (
                f"Get-CimInstance Win32_Process -Filter \"{name_filter}\" | "
                "Select-Object -ExpandProperty ExecutablePath"
            ),
        ]
    )
    if not out:
        return
    for line in out.splitlines():
        exe = line.strip()
        if exe:
            yield Path(exe).parent


def _iter_process_install_dirs() -> Iterator[Path]:
    """Try each process-inspection strategy in order of reliability."""
    yield from _iter_dirs_via_psutil()
    yield from _iter_dirs_via_wmic()
    yield from _iter_dirs_via_powershell()


def _iter_drive_candidates() -> Iterator[Path]:
    """Yield lockfile paths across every active drive and common install dir."""
    for letter in string.ascii_uppercase:
        drive = f"{letter}:\\"
        try:
            if not os.path.exists(drive):
                continue
        except OSError:
            continue
        for sub in COMMON_SUBPATHS:
            yield Path(drive) / sub / LOCKFILE_NAME


def _resolve_lockfile_path() -> Optional[Path]:
    """Locate the League lockfile dynamically across any PC configuration.

    Resolution order:
        1. Running-process inspection (psutil -> wmic -> PowerShell CIM), using
           the --install-directory argument or the client executable's folder.
        2. Multi-drive scan of common Riot install locations.

    Returns the first existing lockfile Path, or None if none is found.
    """
    # 1. Process inspection (primary, works on any drive/custom path).
    for install_dir in _iter_process_install_dirs():
        candidate = install_dir / LOCKFILE_NAME
        try:
            if candidate.is_file():
                logger.debug("Lockfile located via process inspection: %s", candidate)
                return candidate
        except OSError as err:
            logger.debug("Could not stat candidate %s: %s", candidate, err)
            continue

    # 2. Multi-drive directory scan (fallback).
    for candidate in _iter_drive_candidates():
        try:
            if candidate.is_file():
                logger.debug("Lockfile located via drive scan: %s", candidate)
                return candidate
        except OSError as err:
            logger.debug("Could not stat candidate %s: %s", candidate, err)
            continue

    logger.debug("Lockfile not found via process inspection or drive scan.")
    return None


def get_lcu_credentials(lockfile_path: Optional[Path] = None) -> Optional[Dict]:
    """Read the League Client lockfile and extract connection credentials.

    The lockfile is a colon-delimited string with the following fields:
        <process_name>:<pid>:<port>:<auth_token>:<protocol>

    When ``lockfile_path`` is None (the default), the lockfile is located
    dynamically via running-process inspection and multi-drive scanning, so the
    client is found regardless of which drive or folder it was installed to.
    An explicit path may still be passed (e.g. for tests).

    Returns a dict containing:
        - base_url: the local LCU URL (e.g. https://127.0.0.1:<port>)
        - headers: a dict with a configured HTTP Basic Auth header
        - port: the dynamic port the client is listening on
        - token: the raw auth token

    Returns None if the client is not running or the lockfile cannot be read.
    """
    if lockfile_path is None:
        lockfile_path = _resolve_lockfile_path()

    # Nothing found by any strategy -> fall back to the standard default so an
    # unusual-but-standard setup still works before giving up.
    if lockfile_path is None:
        lockfile_path = DEFAULT_LOCKFILE_PATH

    try:
        if not lockfile_path.is_file():
            logger.debug("Lockfile does not exist at %s (client closed?).", lockfile_path)
            return None

        # The lockfile may be locked for writing by the client, but we can still
        # read it. Read as text and strip any trailing whitespace/newlines.
        raw = lockfile_path.read_text(encoding="utf-8").strip()
        if not raw:
            logger.debug("Lockfile at %s was empty.", lockfile_path)
            return None

        parts = raw.split(":")
        if len(parts) < 5:
            logger.warning("Malformed lockfile at %s (got %d fields).", lockfile_path, len(parts))
            return None

        port = parts[2]
        auth_token = parts[3]
        protocol = parts[4]

        # The LCU expects HTTP Basic Auth with username "riot" and the token
        # from the lockfile as the password.
        raw_auth = f"riot:{auth_token}".encode("utf-8")
        encoded_auth = base64.b64encode(raw_auth).decode("utf-8")

        return {
            "base_url": f"{protocol}://127.0.0.1:{port}",
            "headers": {
                "Authorization": f"Basic {encoded_auth}",
                "Accept": "application/json",
            },
            "port": port,
            "token": auth_token,
        }

    except PermissionError as err:
        logger.warning("Permission denied reading lockfile at %s: %s", lockfile_path, err)
        return None
    except FileNotFoundError as err:
        logger.debug("Lockfile disappeared at %s: %s", lockfile_path, err)
        return None
    except (OSError, ValueError, IndexError) as err:
        logger.warning("Failed to read/parse lockfile at %s: %s", lockfile_path, err)
        return None
