# -*- mode: python ; coding: utf-8 -*-
# PyInstaller build spec for the LoL Draft Assistant backend.
# Build with:  python -m PyInstaller main.spec
# Produces a single, console-less dist/main.exe with the DB + model files
# bundled and unpacked to sys._MEIPASS at runtime (see resource_path()).

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    # Bundled data files: (source_on_disk, destination_dir_inside_bundle).
    # '.' places them at the root of sys._MEIPASS so resource_path() finds them.
    datas=[
        ('league_database.db', '.'),
        ('draft_model.pkl', '.'),
        ('model_features.pkl', '.'),
    ],
    # Uvicorn lazily imports its loop/protocol/lifespan backends, so PyInstaller
    # cannot detect them statically. Declare them explicitly.
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.protocols.websockets.websockets_impl',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='main',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,            # equivalent to --noconsole
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
